import { invoke } from "@tauri-apps/api/core";
import { CPIPOS_DESKTOP_VERSION, CPIPOS_UPDATE_POLICY_KEY } from "./app-version";
import { licensedSalesModes } from "./license-entitlements";

const CONTROL_PLANE = String(import.meta.env.VITE_CPIPOS_IT_BASE_URL || "https://cp-ipos-it-web.vercel.app").replace(/\/$/, "");
const HEARTBEAT_URL = `${CONTROL_PLANE}/api/desktop-license/heartbeat`;
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const MIN_INTERVAL_MS = 10 * 60 * 1000;
const MAX_INTERVAL_MS = 60 * 60 * 1000;
const ONLINE_FIRST_CHECK_MS = 2 * 60 * 1000;
const FAST_ACK_MS = 60 * 1000;
const MANUAL_REFRESH_MIN_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const HEALTH_CACHE_MS = 30 * 60 * 1000;
const HEALTH_STARTUP_GRACE_MS = 5 * 60 * 1000;
const COMMAND_RESULTS_KEY = "cpipos.mdm.command-results.v1";

type LicenseRuntime = { mode?: "trial" | "licensed" | "locked" | "error"; token?: string; deviceCode?: string; payload?: { licenseId?: string; expiresAt?: string | null } };
type SystemHealth = { deviceName?: string; machineId?: string; cpuPercent?: number; memoryPercent?: number; diskFreeBytes?: number; logicalProcessors?: number };
type ControlCommand = { id: string; type: "force_sync" | "refresh_license" | "recheck_printer" | "check_update" | "collect_health"; payload?: Record<string, unknown> };
type UpdatePolicy = { channel?: string; current_version?: string; latest_version?: string; minimum_version?: string; update_available?: boolean; below_minimum?: boolean; mandatory?: boolean; auto_install?: boolean; download_url?: string | null; notes?: string | null };
type ControlEnvelope = { remote_management_enabled?: boolean; commands?: ControlCommand[]; entitlements?: { sales_modes?: string[]; features?: string[] }; update?: UpdatePolicy };
type CommandResult = { id: string; ok: boolean; code?: string | null; result?: Record<string, unknown> | null; completedAt: string };
type HeartbeatResponse = { valid?: boolean; lock?: boolean; code?: string; server_time?: string; status?: string; expires_at?: string | null; next_check_seconds?: number; control?: ControlEnvelope };
type RuntimeWindow = Window & { __CPIPOS_LICENSE_RUNTIME__?: LicenseRuntime; __CPIPOS_CONTROL_STATE__?: ControlEnvelope & { connected?: boolean; checked_at?: string; last_error?: string; server_time?: string } };

let stopped = false;
let running = false;
let started = false;
let timer = 0;
let fastAckTimer = 0;
let failureCount = 0;
let lastManualRefreshAt = 0;
let lastHealthAt = 0;
let lastHealth: SystemHealth = {};
const loadedAt = Date.now();

function runtimeWindow() { return window as RuntimeWindow; }
function licenseReady() { const value = runtimeWindow().__CPIPOS_LICENSE_RUNTIME__; return value?.mode === "licensed" && value.token && value.deviceCode ? value : null; }
function readCommandResults(): CommandResult[] { try { const raw = localStorage.getItem(COMMAND_RESULTS_KEY); if (!raw) return []; const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.slice(-20) : []; } catch { return []; } }
function saveCommandResults(rows: CommandResult[]) { try { localStorage.setItem(COMMAND_RESULTS_KEY, JSON.stringify(rows.slice(-20))); } catch { /* best effort */ } }
function addCommandResult(result: CommandResult) { const current = readCommandResults().filter(item => item.id !== result.id); saveCommandResults([...current, result]); }
function publishControl(control: ControlEnvelope | null, extra: Record<string, unknown> = {}) { const previous = runtimeWindow().__CPIPOS_CONTROL_STATE__ || {}; runtimeWindow().__CPIPOS_CONTROL_STATE__ = { ...previous, ...(control || {}), ...extra }; window.dispatchEvent(new CustomEvent("cpipos:control-state", { detail: runtimeWindow().__CPIPOS_CONTROL_STATE__ })); }
function publishUpdate(policy?: UpdatePolicy) { if (!policy) return; try { localStorage.setItem(CPIPOS_UPDATE_POLICY_KEY, JSON.stringify(policy)); } catch { /* best effort */ } window.dispatchEvent(new CustomEvent("cpipos:update-policy", { detail: policy })); }
function nextBackoffMs() { return Math.min(MAX_INTERVAL_MS, DEFAULT_INTERVAL_MS * Math.max(1, 2 ** Math.min(failureCount, 2))); }
function clampInterval(seconds?: number) { return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Number(seconds || DEFAULT_INTERVAL_MS / 1000) * 1000)); }
function shouldCollectHealth(force = false) { if (force) return true; if (Date.now() - loadedAt < HEALTH_STARTUP_GRACE_MS) return false; return Date.now() - lastHealthAt >= HEALTH_CACHE_MS; }
async function collectLightHealth(force = false) {
  if (!shouldCollectHealth(force)) return lastHealth;
  try {
    lastHealth = await invoke<SystemHealth>("get_windows_system_health");
    lastHealthAt = Date.now();
    return lastHealth;
  } catch { return lastHealth; }
}
async function fetchHeartbeat(body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(HEARTBEAT_URL, { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: controller.signal, body: JSON.stringify(body) });
  } finally { window.clearTimeout(timeout); }
}

async function executeCommand(command: ControlCommand, health: SystemHealth, control: ControlEnvelope): Promise<CommandResult> {
  const completedAt = new Date().toISOString();
  try {
    switch (command.type) {
      case "force_sync": window.dispatchEvent(new CustomEvent("cpipos:cloud-refresh")); window.dispatchEvent(new CustomEvent("cpipos:cloud-backup-now")); return { id: command.id, ok: true, code: "SYNC_TRIGGERED", result: { cloud: "triggered" }, completedAt };
      case "refresh_license": window.dispatchEvent(new CustomEvent("cpipos:license-entitlements", { detail: { source: "mdm" } })); return { id: command.id, ok: true, code: "LICENSE_REFRESHED", result: { modes: licensedSalesModes(), licenseId: licenseReady()?.payload?.licenseId || null }, completedAt };
      case "recheck_printer": window.dispatchEvent(new CustomEvent("cpipos:printer-recheck")); return { id: command.id, ok: true, code: "PRINTER_RECHECK_TRIGGERED", result: null, completedAt };
      case "check_update": publishUpdate(control.update); return { id: command.id, ok: true, code: control.update?.update_available ? "UPDATE_AVAILABLE" : "UPDATE_CURRENT", result: { update: control.update || null }, completedAt };
      case "collect_health": { const current = await collectLightHealth(true); return { id: command.id, ok: true, code: "HEALTH_COLLECTED", result: { cpuPercent: Number(current.cpuPercent || 0), memoryPercent: Number(current.memoryPercent || 0), diskFreeBytes: Number(current.diskFreeBytes || 0), logicalProcessors: Number(current.logicalProcessors || 0) }, completedAt }; }
      default: return { id: command.id, ok: false, code: "COMMAND_UNSUPPORTED", result: null, completedAt };
    }
  } catch (error) { return { id: command.id, ok: false, code: error instanceof Error ? error.message : "COMMAND_FAILED", result: null, completedAt }; }
}

async function heartbeat() {
  if (running || stopped || !navigator.onLine) return DEFAULT_INTERVAL_MS;
  const license = licenseReady();
  if (!license) { publishControl(null, { connected: false, checked_at: new Date().toISOString(), last_error: "" }); return DEFAULT_INTERVAL_MS; }
  running = true;
  try {
    const health = await collectLightHealth(false);
    const pendingResults = readCommandResults();
    const response = await fetchHeartbeat({ token: license.token, deviceCode: license.deviceCode, appVersion: CPIPOS_DESKTOP_VERSION, runtimeVersion: "tauri-2-webview2-low-impact-mdm", deviceName: health.deviceName || null, machineId: health.machineId || null, cpuPercent: Number(health.cpuPercent || 0), memoryPercent: Number(health.memoryPercent || 0), diskFreeBytes: Number(health.diskFreeBytes || 0), printerStatus: "managed_by_desktop", printerName: null, integrityStatus: health.machineId ? "ok" : "deferred", tamperDetected: false, connectivity: { online: navigator.onLine, controlPlane: CONTROL_PLANE, remoteManagement: true, mode: "it_driven_low_impact" }, systemHealth: { logicalProcessors: Number(health.logicalProcessors || 0), sampled: Boolean(lastHealthAt) }, printerHealth: { mode: "it_command_recheck" }, securitySignals: { machineBinding: health.machineId ? "present" : "deferred", signedLicense: true }, metadata: { salesModes: licensedSalesModes(), source: "cpipos-desktop", desktopVersion: CPIPOS_DESKTOP_VERSION, heartbeatVersion: 5, dbTelemetry: "disabled_client_ui", lowImpactMode: true }, sales: [], commandResults: pendingResults });
    const payload = await response.json().catch(() => ({})) as HeartbeatResponse;
    if (!response.ok || payload.valid === false) { if (payload.lock) window.dispatchEvent(new CustomEvent("cpipos:license-online-status", { detail: { lock: true, code: payload.code || "LICENSE_CHECK_FAILED" } })); throw new Error(payload.code || `HEARTBEAT_HTTP_${response.status}`); }
    failureCount = 0;
    if (pendingResults.length) saveCommandResults([]);
    const control = payload.control || {};
    publishControl(control, { connected: true, checked_at: new Date().toISOString(), last_error: "", server_time: payload.server_time || "" });
    publishUpdate(control.update);
    window.dispatchEvent(new CustomEvent("cpipos:license-online-status", { detail: { lock: false, valid: true, status: payload.status, expiresAt: payload.expires_at || null } }));
    window.dispatchEvent(new CustomEvent("cpipos:license-entitlements", { detail: { source: "heartbeat", serverModes: control.entitlements?.sales_modes || [] } }));
    const commands = Array.isArray(control.commands) ? control.commands : [];
    const alreadyDone = new Map(readCommandResults().map(item => [item.id, item]));
    let executed = false;
    for (const command of commands.slice(0, 5)) { if (!command?.id || alreadyDone.has(command.id)) continue; addCommandResult(await executeCommand(command, health, control)); executed = true; }
    if (executed) { window.clearTimeout(fastAckTimer); fastAckTimer = window.setTimeout(() => schedule(MIN_INTERVAL_MS), FAST_ACK_MS); }
    return clampInterval(payload.next_check_seconds);
  } catch (error) {
    failureCount += 1;
    publishControl(null, { connected: false, checked_at: new Date().toISOString(), last_error: error instanceof Error ? error.message : "HEARTBEAT_FAILED" });
    return nextBackoffMs();
  } finally { running = false; }
}

function schedule(delayMs = DEFAULT_INTERVAL_MS) { window.clearTimeout(timer); if (stopped || !started) return; timer = window.setTimeout(async () => { const next = await heartbeat(); schedule(next); }, Math.max(0, delayMs)); }
function manualRefresh() { const now = Date.now(); if (now - lastManualRefreshAt < MANUAL_REFRESH_MIN_MS) return; lastManualRefreshAt = now; schedule(MIN_INTERVAL_MS); }
function start() {
  if (started) return;
  started = true;
  publishControl(null, { connected: false, checked_at: "", last_error: "" });
  schedule(ONLINE_FIRST_CHECK_MS);
  window.addEventListener("online", () => schedule(ONLINE_FIRST_CHECK_MS));
  window.addEventListener("offline", () => { window.clearTimeout(timer); publishControl(null, { connected: false, checked_at: new Date().toISOString(), last_error: "OFFLINE" }); schedule(DEFAULT_INTERVAL_MS); });
  window.addEventListener("cpipos:license-entitlements", () => { if (licenseReady() && navigator.onLine) schedule(DEFAULT_INTERVAL_MS); });
  window.addEventListener("cpipos:mdm-refresh", manualRefresh);
  window.addEventListener("beforeunload", () => { stopped = true; window.clearTimeout(timer); window.clearTimeout(fastAckTimer); }, { once: true });
}

window.addEventListener("cpipos:app-ready", start, { once: true });
window.setTimeout(() => {
  if (!started) start();
}, 2 * 60 * 1000);

export {};