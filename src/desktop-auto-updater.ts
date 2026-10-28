import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { CPIPOS_DESKTOP_VERSION, CPIPOS_RELEASE_CHANNEL, CPIPOS_UPDATE_POLICY_KEY } from "./app-version";

type LicenseRuntime = { mode?: "trial" | "licensed" | "locked" | "error"; token?: string; deviceCode?: string };
type UpdatePolicy = {
  channel?: string;
  current_version?: string;
  latest_version?: string;
  minimum_version?: string;
  update_available?: boolean;
  below_minimum?: boolean;
  mandatory?: boolean;
  auto_install?: boolean;
  download_url?: string | null;
  notes?: string | null;
};
type AutoUpdaterState = {
  status: "idle" | "waiting_policy" | "checking" | "current" | "downloading" | "installing" | "offline" | "license_required" | "skipped" | "failed";
  reason?: string;
  currentVersion: string;
  targetVersion?: string;
  updatedAt: string;
  downloadedBytes?: number;
  contentLength?: number;
};
type RuntimeWindow = Window & {
  __CPIPOS_LICENSE_RUNTIME__?: LicenseRuntime;
  __CPIPOS_CONTROL_STATE__?: { update?: UpdatePolicy };
  __CPIPOS_UPDATER_STATE__?: AutoUpdaterState;
};

const STATUS_KEY = "cpipos.updater.status.v1";
const LAST_ATTEMPT_KEY = "cpipos.updater.last-attempt.v1";
const RETRY_AFTER_MS = 30 * 60 * 1000;
const STARTUP_DEFER_MS = 45_000;
const CHECK_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

let running = false;
let pendingTimer = 0;

function runtimeWindow() { return window as RuntimeWindow; }
function nowIso() { return new Date().toISOString(); }
function licenseReady() {
  const license = runtimeWindow().__CPIPOS_LICENSE_RUNTIME__;
  return license?.mode === "licensed" && license.token && license.deviceCode;
}
function readStoredPolicy(): UpdatePolicy | null {
  try {
    const raw = localStorage.getItem(CPIPOS_UPDATE_POLICY_KEY);
    if (!raw) return runtimeWindow().__CPIPOS_CONTROL_STATE__?.update || null;
    const parsed = JSON.parse(raw) as UpdatePolicy;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return runtimeWindow().__CPIPOS_CONTROL_STATE__?.update || null; }
}
function writeStatus(next: AutoUpdaterState) {
  runtimeWindow().__CPIPOS_UPDATER_STATE__ = next;
  try { localStorage.setItem(STATUS_KEY, JSON.stringify(next)); } catch { /* best effort */ }
  window.dispatchEvent(new CustomEvent("cpipos:auto-updater-status", { detail: next }));
}
function status(status: AutoUpdaterState["status"], reason: string, policy?: UpdatePolicy, extra: Partial<AutoUpdaterState> = {}) {
  writeStatus({ status, reason, currentVersion: CPIPOS_DESKTOP_VERSION, targetVersion: policy?.latest_version || extra.targetVersion, updatedAt: nowIso(), ...extra });
}
function versionToken(policy: UpdatePolicy) {
  return [CPIPOS_DESKTOP_VERSION, policy.channel || CPIPOS_RELEASE_CHANNEL, policy.latest_version || "latest", policy.minimum_version || "", policy.mandatory ? "mandatory" : "optional", policy.auto_install ? "auto" : "manual"].join("|");
}
function recentlyAttempted(policy: UpdatePolicy) {
  try {
    const raw = localStorage.getItem(LAST_ATTEMPT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { token?: string; at?: number };
    return parsed.token === versionToken(policy) && Date.now() - Number(parsed.at || 0) < RETRY_AFTER_MS;
  } catch { return false; }
}
function markAttempt(policy: UpdatePolicy) {
  try { localStorage.setItem(LAST_ATTEMPT_KEY, JSON.stringify({ token: versionToken(policy), at: Date.now() })); } catch { /* best effort */ }
}
function shouldAutoInstall(policy: UpdatePolicy | null) {
  if (!policy) return false;
  const forcedByIt = Boolean(policy.auto_install || policy.mandatory || policy.below_minimum);
  if (!forcedByIt) return false;
  if (policy.channel && policy.channel !== CPIPOS_RELEASE_CHANNEL) return false;
  if (policy.update_available || policy.below_minimum) return true;
  return Boolean(policy.latest_version && policy.latest_version !== CPIPOS_DESKTOP_VERSION);
}
function downloadProgress(policy: UpdatePolicy) {
  let downloadedBytes = 0;
  let contentLength: number | undefined;
  return (event: DownloadEvent) => {
    if (event.event === "Started") {
      downloadedBytes = 0;
      contentLength = event.data.contentLength;
      status("downloading", "started", policy, { downloadedBytes, contentLength });
    } else if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
      status("downloading", "progress", policy, { downloadedBytes, contentLength });
    } else if (event.event === "Finished") {
      status("installing", "download_finished", policy, { downloadedBytes, contentLength });
    }
  };
}
async function runAutoInstall(policy: UpdatePolicy, reason: string) {
  if (running) return;
  if (!shouldAutoInstall(policy)) { status("waiting_policy", "auto_install_not_requested", policy); return; }
  if (!navigator.onLine) { status("offline", reason, policy); return; }
  if (!licenseReady()) { status("license_required", reason, policy); return; }
  if (recentlyAttempted(policy)) { status("skipped", "recent_attempt", policy); return; }

  running = true;
  markAttempt(policy);
  try {
    status("checking", reason, policy);
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    if (!update) { status("current", "no_signed_update", policy); return; }
    status("downloading", "signed_update_available", policy, { targetVersion: update.version });
    await update.downloadAndInstall(downloadProgress({ ...policy, latest_version: update.version }), { timeout: DOWNLOAD_TIMEOUT_MS, restartAfterInstall: true });
    status("installing", "installer_started", policy, { targetVersion: update.version });
  } catch (error) {
    status("failed", error instanceof Error ? error.message : "AUTO_UPDATE_FAILED", policy);
  } finally {
    running = false;
  }
}
function scheduleFromPolicy(policy: UpdatePolicy | null, reason: string, delayMs = 1200) {
  window.clearTimeout(pendingTimer);
  if (!shouldAutoInstall(policy)) {
    status("waiting_policy", "no_auto_install_policy", policy || undefined);
    return;
  }
  const readyPolicy = policy as UpdatePolicy;
  pendingTimer = window.setTimeout(() => { void runAutoInstall(readyPolicy, reason); }, delayMs);
}
function eventPolicy(event: Event) {
  return (event as CustomEvent<UpdatePolicy>).detail || null;
}

window.addEventListener("cpipos:update-policy", event => scheduleFromPolicy(eventPolicy(event), "policy"));
window.addEventListener("cpipos:control-state", () => scheduleFromPolicy(runtimeWindow().__CPIPOS_CONTROL_STATE__?.update || readStoredPolicy(), "control_state"));
window.addEventListener("online", () => scheduleFromPolicy(readStoredPolicy(), "online"));
window.addEventListener("beforeunload", () => window.clearTimeout(pendingTimer), { once: true });
window.addEventListener("cpipos:app-ready", () => {
  window.setTimeout(() => scheduleFromPolicy(readStoredPolicy(), "startup", 0), STARTUP_DEFER_MS);
}, { once: true });

status("idle", "loaded");

export {};