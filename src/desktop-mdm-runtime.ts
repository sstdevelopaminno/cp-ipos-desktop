import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { licensedSalesModes } from "./license-entitlements";

const CONTROL_PLANE = String(import.meta.env.VITE_CPIPOS_IT_BASE_URL || "https://cp-ipos-it-web.vercel.app").replace(/\/$/, "");
const HEARTBEAT_URL = `${CONTROL_PLANE}/api/desktop-license/heartbeat`;
const APP_VERSION = "0.3.0";
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;
const MAX_INTERVAL_MS = 15 * 60 * 1000;
const COMMAND_RESULTS_KEY = "cpipos.mdm.command-results.v1";
const SALES_CURSOR_KEY = "cpipos.mdm.sales-cursor.v1";
const UPDATE_POLICY_KEY = "cpipos.update.policy.v1";
const SALES_BATCH_SIZE = 25;

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

type LocalStorageMetrics = {
  database_size?: number;
  databaseSize?: number;
  media_size?: number;
  mediaSize?: number;
  backup_size?: number;
  backupSize?: number;
  app_data_size?: number;
  appDataSize?: number;
};

type PrinterInfo = {
  name: string;
  status?: string;
  isDefault?: boolean;
  isOffline?: boolean;
};

type ControlCommand = {
  id: string;
  type: "force_sync" | "refresh_license" | "recheck_printer" | "check_update" | "collect_health";
  payload?: Record<string, unknown>;
  issued_at?: string;
  expires_at?: string;
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
  sales_accepted?: number;
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

type SettingRow = { key: string; value: string };
type SaleRow = {
  id: string;
  receipt_no: string;
  total: number;
  paid: number;
  change_amount: number;
  payment_method: string;
  status: "completed" | "cancelled";
  cashier_name?: string | null;
  employee_code?: string | null;
  shift_id?: string | null;
  items_json?: string | null;
  created_at: string;
  cancelled_at?: string | null;
  sync_at: string;
};

type SalesBatch = {
  rows: Array<Record<string, unknown>>;
  maxCursor: string | null;
  hasMore: boolean;
};

let stopped = false;
let running = false;
let timer: number | undefined;
let fastAckTimer: number | undefined;

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
  try {
    localStorage.setItem(COMMAND_RESULTS_KEY, JSON.stringify(rows.slice(-20)));
  } catch {
    // Local storage is best effort. A later heartbeat can redeliver the command.
  }
}

function addCommandResult(result: CommandResult) {
  const current = readCommandResults().filter(item => item.id !== result.id);
  saveCommandResults([...current, result]);
}

function publishControl(control: ControlEnvelope | null, extra: Record<string, unknown> = {}) {
  const previous = runtimeWindow().__CPIPOS_CONTROL_STATE__ || {};
  runtimeWindow().__CPIPOS_CONTROL_STATE__ = {
    ...previous,
    ...(control || {}),
    ...extra,
  };
  window.dispatchEvent(new CustomEvent("cpipos:control-state", { detail: runtimeWindow().__CPIPOS_CONTROL_STATE__ }));
}

function publishUpdate(policy?: UpdatePolicy) {
  if (!policy) return;
  try { localStorage.setItem(UPDATE_POLICY_KEY, JSON.stringify(policy)); } catch { /* best effort */ }
  window.dispatchEvent(new CustomEvent("cpipos:update-policy", { detail: policy }));
}

async function openDb() {
  return await Database.load("sqlite:cpipos.db");
}

async function readSettings(db: Database) {
  try {
    const rows = await db.select<SettingRow[]>(
      "SELECT key,value FROM app_settings WHERE key IN ('deviceName','deviceId','printerName','printerType','printerSetupConfirmed')"
    );
    return Object.fromEntries(rows.map(row => [row.key, row.value]));
  } catch {
    return {} as Record<string, string>;
  }
}

async function readSalesBatch(db: Database): Promise<SalesBatch> {
  const cursor = (() => {
    try { return localStorage.getItem(SALES_CURSOR_KEY) || "1970-01-01T00:00:00.000Z"; }
    catch { return "1970-01-01T00:00:00.000Z"; }
  })();

  try {
    const rows = await db.select<SaleRow[]>(
      `SELECT id,receipt_no,total,paid,change_amount,payment_method,status,cashier_name,employee_code,shift_id,items_json,created_at,cancelled_at,
        CASE WHEN cancelled_at IS NOT NULL AND cancelled_at <> '' THEN cancelled_at ELSE created_at END AS sync_at
       FROM sales
       WHERE created_at > $1 OR (cancelled_at IS NOT NULL AND cancelled_at > $1)
       ORDER BY sync_at ASC
       LIMIT ${SALES_BATCH_SIZE}`,
      [cursor]
    );

    const payload = rows.map(row => {
      let items: any[] = [];
      try {
        const parsed = JSON.parse(row.items_json || "[]");
        items = Array.isArray(parsed) ? parsed.slice(0, 120) : [];
      } catch {
        items = [];
      }
      return {
        localSaleId: row.id,
        receiptNo: row.receipt_no,
        soldAt: row.created_at,
        totalAmount: Number(row.total || 0),
        paidAmount: Number(row.paid || 0),
        changeAmount: Number(row.change_amount || 0),
        paymentMethod: row.payment_method || "unknown",
        status: row.status === "cancelled" ? "cancelled" : "completed",
        cashierName: row.cashier_name || null,
        employeeCode: row.employee_code || null,
        localShiftId: row.shift_id || null,
        items: items.map((item, index) => ({
          lineNo: index + 1,
          localProductId: item.productId || null,
          productName: String(item.name || item.nameTh || item.productCode || "Item"),
          quantity: Number(item.quantity || 0),
          unitPrice: Number(item.unitPrice || 0),
          lineTotal: Number(item.quantity || 0) * Number(item.unitPrice || 0)
        })),
        payload: {
          salesMode: itemModeFromPayload(items),
          itemCount: items.length,
          cancelledAt: row.cancelled_at || null
        }
      };
    });

    const maxCursor = rows.length ? rows[rows.length - 1].sync_at : null;
    return { rows: payload, maxCursor, hasMore: rows.length >= SALES_BATCH_SIZE };
  } catch {
    return { rows: [], maxCursor: null, hasMore: false };
  }
}

function saveSalesCursor(value: string | null) {
  if (!value) return;
  try { localStorage.setItem(SALES_CURSOR_KEY, value); } catch { /* best effort */ }
}

function itemModeFromPayload(items: any[]) {
  const mode = items.find(item => typeof item?.salesMode === "string")?.salesMode;
  return mode || null;
}

async function collectHealth() {
  const [systemResult, storageResult] = await Promise.allSettled([
    invoke<SystemHealth>("get_windows_system_health"),
    invoke<LocalStorageMetrics>("get_local_storage_metrics")
  ]);
  return {
    system: systemResult.status === "fulfilled" ? systemResult.value : ({} as SystemHealth),
    storage: storageResult.status === "fulfilled" ? storageResult.value : ({} as LocalStorageMetrics)
  };
}

async function printerHealth(settings: Record<string, string>) {
  const configuredName = String(settings.printerName || "").trim();
  if (!configuredName) return { status: "not_configured", name: "", detail: {} as Record<string, unknown> };
  try {
    const printers = await invoke<PrinterInfo[]>("list_windows_printers");
    const target = printers.find(item => item.name === configuredName);
    if (!target) return { status: "missing", name: configuredName, detail: { found: false } };
    return {
      status: target.isOffline ? "offline" : String(target.status || "ready"),
      name: configuredName,
      detail: { found: true, isDefault: Boolean(target.isDefault), isOffline: Boolean(target.isOffline), windowsStatus: target.status || "" }
    };
  } catch (error) {
    return { status: "check_failed", name: configuredName, detail: { error: error instanceof Error ? error.message : String(error) } };
  }
}

function storageNumber(storage: LocalStorageMetrics, camel: keyof LocalStorageMetrics, snake: keyof LocalStorageMetrics) {
  const value = Number(storage[camel] ?? storage[snake] ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

async function executeCommand(command: ControlCommand, context: {
  system: SystemHealth;
  storage: LocalStorageMetrics;
  printer: Awaited<ReturnType<typeof printerHealth>>;
  control: ControlEnvelope;
}) {
  const completedAt = new Date().toISOString();
  try {
    switch (command.type) {
      case "force_sync":
        window.dispatchEvent(new CustomEvent("cpipos:cloud-refresh"));
        window.dispatchEvent(new CustomEvent("cpipos:cloud-backup-now"));
        return { id: command.id, ok: true, code: "SYNC_TRIGGERED", result: { sales: "heartbeat", cloud: "triggered" }, completedAt };
      case "refresh_license":
        window.dispatchEvent(new CustomEvent("cpipos:license-entitlements", { detail: { source: "mdm" } }));
        return {
          id: command.id,
          ok: true,
          code: "LICENSE_REFRESHED",
          result: { modes: licensedSalesModes(), licenseId: licenseReady()?.payload?.licenseId || null },
          completedAt
        };
      case "recheck_printer": {
        const state = context.printer;
        return { id: command.id, ok: state.status !== "check_failed", code: state.status, result: { printer: state }, completedAt };
      }
      case "check_update":
        publishUpdate(context.control.update);
        return {
          id: command.id,
          ok: true,
          code: context.control.update?.update_available ? "UPDATE_AVAILABLE" : "UPDATE_CURRENT",
          result: { update: context.control.update || null },
          completedAt
        };
      case "collect_health":
        return {
          id: command.id,
          ok: true,
          code: "HEALTH_COLLECTED",
          result: {
            cpuPercent: Number(context.system.cpuPercent || 0),
            memoryPercent: Number(context.system.memoryPercent || 0),
            diskFreeBytes: Number(context.system.diskFreeBytes || 0),
            databaseBytes: storageNumber(context.storage, "databaseSize", "database_size"),
            printerStatus: context.printer.status
          },
          completedAt
        };
      default:
        return { id: command.id, ok: false, code: "COMMAND_UNSUPPORTED", result: null, completedAt };
    }
  } catch (error) {
    return {
      id: command.id,
      ok: false,
      code: error instanceof Error ? error.message : "COMMAND_FAILED",
      result: null,
      completedAt
    };
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
    const db = await openDb();
    const [settings, health, salesBatch] = await Promise.all([
      readSettings(db),
      collectHealth(),
      readSalesBatch(db)
    ]);
    const sales = salesBatch.rows;
    const printer = await printerHealth(settings);
    const pendingResults = readCommandResults();

    const response = await fetch(HEARTBEAT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        token: license.token,
        deviceCode: license.deviceCode,
        appVersion: APP_VERSION,
        runtimeVersion: "tauri-2-webview2",
        deviceName: health.system.deviceName || settings.deviceName || null,
        machineId: health.system.machineId || null,
        cpuPercent: Number(health.system.cpuPercent || 0),
        memoryPercent: Number(health.system.memoryPercent || 0),
        diskFreeBytes: Number(health.system.diskFreeBytes || 0),
        databaseBytes: storageNumber(health.storage, "databaseSize", "database_size"),
        printerStatus: printer.status,
        printerName: printer.name || null,
        integrityStatus: health.system.machineId ? "ok" : "unknown",
        tamperDetected: false,
        connectivity: {
          online: navigator.onLine,
          controlPlane: CONTROL_PLANE,
          remoteManagement: true
        },
        systemHealth: {
          logicalProcessors: Number(health.system.logicalProcessors || 0),
          appDataBytes: storageNumber(health.storage, "appDataSize", "app_data_size"),
          mediaBytes: storageNumber(health.storage, "mediaSize", "media_size"),
          backupBytes: storageNumber(health.storage, "backupSize", "backup_size")
        },
        printerHealth: printer.detail,
        securitySignals: {
          machineBinding: health.system.machineId ? "present" : "unknown",
          signedLicense: true
        },
        metadata: {
          salesModes: licensedSalesModes(),
          source: "cpipos-desktop",
          heartbeatVersion: 1
        },
        sales,
        commandResults: pendingResults
      })
    });

    const payload = await response.json().catch(() => ({})) as HeartbeatResponse;
    if (!response.ok || payload.valid === false) {
      if (payload.lock) {
        window.dispatchEvent(new CustomEvent("cpipos:license-online-status", {
          detail: { lock: true, code: payload.code || "LICENSE_CHECK_FAILED" }
        }));
      }
      throw new Error(payload.code || `HEARTBEAT_HTTP_${response.status}`);
    }

    if (pendingResults.length) saveCommandResults([]);
    if (sales.length && Number(payload.sales_accepted || 0) >= sales.length) {
      saveSalesCursor(salesBatch.maxCursor);
    }

    const control = payload.control || {};
    publishControl(control, {
      connected: true,
      checked_at: new Date().toISOString(),
      last_error: "",
      server_time: payload.server_time || ""
    });
    publishUpdate(control.update);
    window.dispatchEvent(new CustomEvent("cpipos:license-online-status", {
      detail: { lock: false, valid: true, status: payload.status, expiresAt: payload.expires_at || null }
    }));
    window.dispatchEvent(new CustomEvent("cpipos:license-entitlements", {
      detail: { source: "heartbeat", serverModes: control.entitlements?.sales_modes || [] }
    }));

    const commands = Array.isArray(control.commands) ? control.commands : [];
    const alreadyDone = new Map(readCommandResults().map(item => [item.id, item]));
    let executed = false;
    for (const command of commands.slice(0, 10)) {
      if (!command?.id || alreadyDone.has(command.id)) continue;
      const result = await executeCommand(command, { system: health.system, storage: health.storage, printer, control });
      addCommandResult(result);
      executed = true;
    }

    if (executed) {
      window.clearTimeout(fastAckTimer);
      fastAckTimer = window.setTimeout(() => schedule(0), 1500);
    }

    if (salesBatch.hasMore && Number(payload.sales_accepted || 0) >= sales.length) {
      return MIN_INTERVAL_MS;
    }
    const seconds = Number(payload.next_check_seconds || 300);
    return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, seconds * 1000));
  } catch (error) {
    publishControl(null, {
      connected: false,
      checked_at: new Date().toISOString(),
      last_error: error instanceof Error ? error.message : "HEARTBEAT_FAILED"
    });
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
  schedule(1500);

  window.addEventListener("online", () => schedule(500));
  window.addEventListener("offline", () => {
    window.clearTimeout(timer);
    publishControl(null, { connected: false, checked_at: new Date().toISOString(), last_error: "OFFLINE" });
    schedule(DEFAULT_INTERVAL_MS);
  });
  window.addEventListener("cpipos:license-entitlements", () => {
    if (licenseReady() && navigator.onLine) schedule(800);
  });
  window.addEventListener("cpipos:mdm-refresh", () => schedule(0));
  window.addEventListener("beforeunload", () => {
    stopped = true;
    window.clearTimeout(timer);
    window.clearTimeout(fastAckTimer);
  }, { once: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();

export {};
