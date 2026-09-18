import { invoke } from "@tauri-apps/api/core";
import { licensedSalesModes } from "./license-entitlements";

const CONTROL_PLANE = String(import.meta.env.VITE_CPIPOS_IT_BASE_URL || "https://cp-ipos-it-web.vercel.app").replace(/\/$/, "");
const HEARTBEAT_URL = `${CONTROL_PLANE}/api/desktop-license/heartbeat`;
const APP_VERSION = "0.3.1";
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const ONLINE_FIRST_CHECK_MS = 20_000;
const FAST_ACK_MS = 2500;
const COMMAND_RESULTS_KEY = "cpipos.mdm.command-results.v1";
const UPDATE_POLICY_KEY = "cpipos.update.policy.v1";

type LicenseRuntime = {
  mode?: "trial" | "licensed" | "locked" | "error";
  token?: string;
  deviceCode?: string;
  payload?: { licenseId?: string; expiresAt?: string | null };
};

type SystemHealth = {
  deviceName?: string;
  machineId?: string;
  cpuPercent?: number;
  memoryPercent?: number;
  diskFreeBytes?: number;
  logicalProcessors?: number;
};

type ControlCommand = {
  id: string;
  type: "force_sync" | "refresh_license" | "recheck_printer" | "check_update" | "collect_health";
  payload?: Record<string, unknown>;
};

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

type ControlEnvelope = {
  remote_management_enabled?: boolean;
  commands?: ControlCommand[];
  entitlements?: { sales_modes?: string[]; features?: string[] };
  update?: UpdatePolicy;
};

type CommandResult = {
  id: string;
  ok: boolean;
  code?: string | null;
  result?: Record<string, unknown> | null;
  completedAt: string;
};

type HeartbeatResponse = {
  valid?: boolean;
  lock?: boolean;
  code?: string;
  server_time?: string;
  status?: string;
  expires_at?: string | null;
  next_check_seconds?: number;
  control?: ControlEnvelope;
};

type RuntimeWindow = Window & {
  __CPIPOS_LICENSE_RUNTIME__?: LicenseRuntime;
  __CPIPOS_CONTROL_STATE__?: ControlEnvelope & {
    connected?: boolean;
    checked_at?: string;
    last_error?: string;
    server_time?: string;
  };
};

let stopped = false;
let running = false;
let timer = 0;
let fastAckTimer = 0;

function runtimeWindow() {
  return window as RuntimeWindow;
}

function licenseReady() {
  const value = runtimeWindow().__CPIPOS_LICENSE_RUNTIME__;
  return value?.mode === "licensed" && value.token && value.deviceCode ? value : null;
}

function readCommandResults(): CommandResult[] {
  try {
    const raw = localStorage.getItem(COMMAND_RESULTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-20) : [];
  } catch {
    return [];
  }
}

function saveCommandResults(rows: CommandResult[]) {
  try { localStorage.setItem(COMMAND_RESULTS_KEY, JSON.stringify(rows.slice(-20))); } catch { /* best effort */ }
}

function addCommandResult(result: CommandResult) {
  const current = readCommandResults().filter(item => item.id !== result.id);
  saveCommandResults([...current, result]);
}

function publishControl(control: ControlEnvelope | null, extra: Record<string, unknown> = {}) {
  const previous = runtimeWindow().__CPIPOS_CONTROL_STATE__ || {};
  runtimeWindow().__CPIPOS_CONTROL_STATE__ = { ...previous, ...(control || {}), ...extra };
  window.dispatchEvent(new CustomEvent("cpipos:control-state", { detail: runtimeWindow().__CPIPOS_CONTROL_STATE__ }));
}

function publishUpdate(policy?: UpdatePolicy) {
  if (!policy) return;
  try { localStorage.setItem(UPDATE_POLICY_KEY, JSON.stringify(policy)); } catch { /* best effort */ }
  window.dispatchEvent(new CustomEvent("cpipos:update-policy", { detail: policy }));
}

async function collectLightHealth() {
  try {
    return await invoke<SystemHealth>("get_windows_system_health");
  } catch {
    return {} as SystemHealth;
  }
}

async function executeCommand(command: ControlCommand, health: SystemHealth, control: ControlEnvelope): Promise<CommandResult> {
  const completedAt = new Date().toISOString();
  try {
    switch (command.type) {
      case "force_sync":
        window.dispatchEvent(new CustomEvent("cpipos:cloud-refresh"));
        window.dispatchEvent(new CustomEvent("cpipos:cloud-backup-now"));
        return { id: command.id, ok: true, code: "SYNC_TRIGGERED", result: { cloud: "triggered" }, completedAt };
      case "refresh_license":
        window.dispatchEvent(new CustomEvent("cpipos:license-entitlements", { detail: { source: "mdm" } }));
        return { id: command.id, ok: true, code: "LICENSE_REFRESHED", result: { modes: licensedSalesModes(), licenseId: licenseReady()?.payload?.licenseId || null }, completedAt };
      case "recheck_printer":
        window.dispatchEvent(new CustomEvent("cpipos:printer-recheck"));
        return { id: command.id, ok: true, code: "PRINTER_RECHECK_TRIGGERED", result: null, completedAt };
      case "check_update":
        publishUpdate(control.update);
        return { id: command.id, ok: true, code: control.update?.update_available ? "UPDATE_AVAILABLE" : "UPDATE_CURRENT", result: { update: control.update || null }, completedAt };
      case "collect_health":
        return {
          id: command.id,
          ok: true,
          code: "HEALTH_COLLECTED",
          result: {
            cpuPercent: Number(health.cpuPercent || 0),
            memoryPercent: Number(health.memoryPercent || 0),
            diskFreeBytes: Number(health.diskFreeBytes || 0),
            logicalProcessors: Number(health.logicalProcessors || 0)
          },
          completedAt
        };
      default:
        return { id: command.id, ok: false, code: "COMMAND_UNSUPPORTED", result: null, completedAt };
    }
  } catch (error) {
    return { id: command.id, ok: false, code: error instanceof Error ? error.message : "COMMAND_FAILED", result: null, completedAt };
  }
}

async function heartbeat() {
  if (running || stopped || !navigator.onLine) return DEFAULT_INTERVAL_MS;
  const license = licenseReady();
  if (!license) {
    publishControl(null, { connected: false, checked_at: new Date().toISOString(), last_error: "" });
    return DEFAULT_INTERVAL_MS;
  }

  running = true;
  try {
    const health = await collectLightHealth();
    const pendingResults = readCommandResults();
    const response = await fetch(HEARTBEAT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        token: license.token,
        deviceCode: license.deviceCode,
        appVersion: APP_VERSION,
        runtimeVersion: "tauri-2-webview2-lite-mdm",
        deviceName: health.deviceName || null,
        machineId: health.machineId || null,
        cpuPercent: Number(health.cpuPercent || 0),
        memoryPercent: Number(health.memoryPercent || 0),
        diskFreeBytes: Number(health.diskFreeBytes || 0),
        printerStatus: "managed_by_desktop",
        printerName: null,
        integrityStatus: health.machineId ? "ok" : "unknown",
        tamperDetected: false,
        connectivity: { online: navigator.onLine, controlPlane: CONTROL_PLANE, remoteManagement: true, mode: "it_driven_light" },
        systemHealth: { logicalProcessors: Number(health.logicalProcessors || 0) },
        printerHealth: { mode: "it_command_recheck" },
        securitySignals: { machineBinding: health.machineId ? "present" : "unknown", signedLicense: true },
        metadata: { salesModes: licensedSalesModes(), source: "cpipos-desktop", heartbeatVersion: 2, dbTelemetry: "disabled_client_ui" },
        sales: [],
        commandResults: pendingResults
      })
    });

    const payload = await response.json().catch(() => ({})) as HeartbeatResponse;
    if (!response.ok || payload.valid === false) {
      if (payload.lock) window.dispatchEvent(new CustomEvent("cpipos:license-online-status", { detail: { lock: true, code: payload.code || "LICENSE_CHECK_FAILED" } }));
      throw new Error(payload.code || `HEARTBEAT_HTTP_${response.status}`);
    }

    if (pendingResults.length) saveCommandResults([]);
    const control = payload.control || {};
    publishControl(control, { connected: true, checked_at: new Date().toISOString(), last_error: "", server_time: payload.server_time || "" });
    publishUpdate(control.update);
    window.dispatchEvent(new CustomEvent("cpipos:license-online-status", { detail: { lock: false, valid: true, status: payload.status, expiresAt: payload.expires_at || null } }));
    window.dispatchEvent(new CustomEvent("cpipos:license-entitlements", { detail: { source: "heartbeat", serverModes: control.entitlements?.sales_modes || [] } }));

    const commands = Array.isArray(control.commands) ? control.commands : [];
    const alreadyDone = new Map(readCommandResults().map(item => [item.id, item]));
    let executed = false;
    for (const command of commands.slice(0, 10)) {
      if (!command?.id || alreadyDone.has(command.id)) continue;
      const result = await executeCommand(command, health, control);
      addCommandResult(result);
      executed = true;
    }
    if (executed) {
      window.clearTimeout(fastAckTimer);
      fastAckTimer = window.setTimeout(() => schedule(0), FAST_ACK_MS);
    }

    const seconds = Number(payload.next_check_seconds || 300);
    return Math.min(15 * 60 * 1000, Math.max(60 * 1000, seconds * 1000));
  } catch (error) {
    publishControl(null, { connected: false, checked_at: new Date().toISOString(), last_error: error instanceof Error ? error.message : "HEARTBEAT_FAILED" });
    return DEFAULT_INTERVAL_MS;
  } finally {
    running = false;
  }
}

function schedule(delayMs = DEFAULT_INTERVAL_MS) {
  window.clearTimeout(timer);
  if (stopped) return;
  timer = window.setTimeout(async () => {
    const next = await heartbeat();
    schedule(next);
  }, Math.max(0, delayMs));
}

function start() {
  publishControl(null, { connected: false, checked_at: "", last_error: "" });
  schedule(ONLINE_FIRST_CHECK_MS);
  window.addEventListener("online", () => schedule(ONLINE_FIRST_CHECK_MS));
  window.addEventListener("offline", () => { window.clearTimeout(timer); publishControl(null, { connected: false, checked_at: new Date().toISOString(), last_error: "OFFLINE" }); schedule(DEFAULT_INTERVAL_MS); });
  window.addEventListener("cpipos:license-entitlements", () => { if (licenseReady() && navigator.onLine) schedule(ONLINE_FIRST_CHECK_MS); });
  window.addEventListener("cpipos:mdm-refresh", () => schedule(0));
  window.addEventListener("beforeunload", () => { stopped = true; window.clearTimeout(timer); window.clearTimeout(fastAckTimer); }, { once: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();

export {};
