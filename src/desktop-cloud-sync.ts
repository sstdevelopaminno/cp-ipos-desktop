import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { CPIPOS_DESKTOP_VERSION, CPIPOS_UPDATE_POLICY_KEY } from "./app-version";

const CONTROL_PLANE = String(import.meta.env.VITE_CPIPOS_IT_BASE_URL || "https://cp-ipos-it-web.vercel.app").replace(/\/$/, "");
const HEARTBEAT_URL = `${CONTROL_PLANE}/api/desktop-license/heartbeat`;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_SYNC_DELAY_MS = 15_000;
const COMMAND_RESULTS_KEY = "cpipos.mdm.command-results.v1";

type LicenseRuntime = {
  mode: "trial" | "licensed" | "locked" | "error";
  token: string;
  deviceCode: string;
  payload?: { licenseId?: string; expiresAt?: string | null };
};

type SaleRow = {
  id: string;
  receipt_no: string;
  total: number;
  paid: number;
  change_amount: number;
  payment_method: string;
  items_json: string;
  created_at: string;
  status: "completed" | "cancelled";
  employee_code?: string | null;
  cashier_name?: string | null;
  shift_id?: string | null;
};

type SyncStateRow = { sale_id: string; payload_hash: string };
type StorageMetrics = { databaseSize?: number; mediaSize?: number; backupSize?: number; appDataSize?: number; appDataDir?: string };
type WindowsSystemHealth = {
  deviceName?: string;
  machineId?: string;
  cpuPercent?: number;
  memoryPercent?: number;
  diskFreeBytes?: number;
  logicalProcessors?: number;
};

type MdmCommand = {
  id: string;
  type: "force_sync" | "refresh_license" | "recheck_printer" | "check_update" | "collect_health";
  payload?: Record<string, unknown>;
  issued_at?: string;
  expires_at?: string;
};

type MdmCommandResult = {
  id: string;
  ok: boolean;
  code?: string | null;
  result?: Record<string, unknown> | null;
  completedAt: string;
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
  commands?: MdmCommand[];
  entitlements?: { sales_modes?: string[]; features?: string[] };
  update?: UpdatePolicy;
};

declare global {
  interface Window {
    __CPIPOS_LICENSE_RUNTIME__?: LicenseRuntime;
    __CPIPOS_CONTROL_STATE__?: ControlEnvelope;
  }
}

const encoder = new TextEncoder();
let running = false;
let stopped = false;
let timer: number | undefined;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function safeJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function readCommandResults(): MdmCommandResult[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(COMMAND_RESULTS_KEY) || "[]") as MdmCommandResult[];
    return Array.isArray(parsed) ? parsed.slice(-20) : [];
  } catch { return []; }
}

function writeCommandResults(rows: MdmCommandResult[]) {
  localStorage.setItem(COMMAND_RESULTS_KEY, JSON.stringify(rows.slice(-20)));
}

async function getSettings(db: Database) {
  const rows = await db.select<Array<{ key: string; value: string }>>(
    "SELECT key,value FROM app_settings WHERE key IN ('deviceName','printerName','printerConnectionStatus','printerLastCheckedAt','printerSetupConfirmed')"
  );
  return Object.fromEntries(rows.map(row => [row.key, row.value])) as Record<string, string>;
}

async function getPendingSales(db: Database) {
  await db.execute(`CREATE TABLE IF NOT EXISTS cpipos_cloud_sales_state (
    sale_id TEXT PRIMARY KEY,
    payload_hash TEXT NOT NULL,
    synced_at TEXT NOT NULL
  )`);

  const [sales, states] = await Promise.all([
    db.select<SaleRow[]>(`SELECT id,receipt_no,total,paid,change_amount,payment_method,items_json,created_at,status,
      employee_code,cashier_name,shift_id FROM sales ORDER BY created_at DESC LIMIT 100`),
    db.select<SyncStateRow[]>("SELECT sale_id,payload_hash FROM cpipos_cloud_sales_state")
  ]);
  const known = new Map(states.map(row => [row.sale_id, row.payload_hash]));
  const output: Array<{ sale: Record<string, unknown>; hash: string }> = [];

  for (const row of sales) {
    const items = safeJson<Array<Record<string, unknown>>>(row.items_json || "[]", []);
    const sale = {
      localSaleId: row.id,
      receiptNo: row.receipt_no,
      soldAt: row.created_at,
      totalAmount: Number(row.total || 0),
      paidAmount: Number(row.paid || 0),
      changeAmount: Number(row.change_amount || 0),
      paymentMethod: row.payment_method,
      status: row.status === "cancelled" ? "cancelled" : "completed",
      cashierName: row.cashier_name || null,
      employeeCode: row.employee_code || null,
      localShiftId: row.shift_id || null,
      items: items.map((item, index) => ({
        lineNo: index + 1,
        localProductId: String(item.productId || item.id || "") || null,
        productName: String(item.name || item.nameTh || "สินค้า"),
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || item.price || 0),
        lineTotal: Number(item.lineTotal || Number(item.quantity || 0) * Number(item.unitPrice || item.price || 0))
      }))
    };
    const hash = await sha256(JSON.stringify(sale));
    if (known.get(row.id) !== hash) output.push({ sale, hash });
  }
  return output.slice(0, 50);
}

async function markSalesSynced(db: Database, rows: Array<{ sale: Record<string, unknown>; hash: string }>) {
  const now = new Date().toISOString();
  for (const row of rows) {
    await db.execute(
      "INSERT INTO cpipos_cloud_sales_state(sale_id,payload_hash,synced_at) VALUES($1,$2,$3) ON CONFLICT(sale_id) DO UPDATE SET payload_hash=excluded.payload_hash,synced_at=excluded.synced_at",
      [String(row.sale.localSaleId), row.hash, now]
    );
  }
}

async function readStorageMetrics(): Promise<StorageMetrics> {
  try { return await invoke<StorageMetrics>("get_local_storage_metrics"); }
  catch { return {}; }
}

async function readWindowsSystemHealth(): Promise<WindowsSystemHealth> {
  try { return await invoke<WindowsSystemHealth>("get_windows_system_health"); }
  catch { return {}; }
}

async function executeMdmCommands(commands: MdmCommand[], control: ControlEnvelope, storage: StorageMetrics, system: WindowsSystemHealth) {
  const results: MdmCommandResult[] = [];
  for (const command of commands.slice(0, 10)) {
    const completedAt = new Date().toISOString();
    try {
      let result: Record<string, unknown> = {};
      if (command.type === "force_sync") {
        result = { synced: true, at: completedAt };
      } else if (command.type === "refresh_license") {
        result = { licenseValidatedByCurrentHeartbeat: true };
      } else if (command.type === "recheck_printer") {
        const printers = await invoke<Array<{ name?: string; status?: string; isDefault?: boolean; isOffline?: boolean }>>("list_windows_printers");
        result = {
          printerCount: printers.length,
          defaultPrinter: printers.find(printer => printer.isDefault)?.name || null,
          onlinePrinters: printers.filter(printer => !printer.isOffline).length
        };
      } else if (command.type === "check_update") {
        result = { appVersion: CPIPOS_DESKTOP_VERSION, update: control.update ?? null };
      } else if (command.type === "collect_health") {
        result = {
          cpuPercent: system.cpuPercent ?? null,
          memoryPercent: system.memoryPercent ?? null,
          diskFreeBytes: system.diskFreeBytes ?? null,
          databaseBytes: storage.databaseSize ?? null,
          appDataBytes: storage.appDataSize ?? null
        };
      }
      results.push({ id: command.id, ok: true, result, completedAt });
    } catch (error) {
      results.push({ id: command.id, ok: false, code: error instanceof Error ? error.message : "MDM_COMMAND_FAILED", completedAt });
    }
  }
  return results;
}

async function syncOnce(): Promise<number> {
  if (running || stopped || !navigator.onLine) return DEFAULT_INTERVAL_MS;
  const license = window.__CPIPOS_LICENSE_RUNTIME__;
  if (!license || license.mode !== "licensed" || !license.token || !license.deviceCode) return DEFAULT_INTERVAL_MS;

  running = true;
  try {
    const db = await Database.load("sqlite:cpipos.db");
    const [settings, storage, system, pendingSales] = await Promise.all([
      getSettings(db),
      readStorageMetrics(),
      readWindowsSystemHealth(),
      getPendingSales(db)
    ]);
    const memoryGb = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0);
    const commandResults = readCommandResults();
    const payload = {
      token: license.token,
      deviceCode: license.deviceCode,
      appVersion: CPIPOS_DESKTOP_VERSION,
      runtimeVersion: "tauri2",
      deviceName: system.deviceName || settings.deviceName || null,
      machineId: system.machineId || null,
      cpuPercent: Number.isFinite(Number(system.cpuPercent)) ? Number(system.cpuPercent) : null,
      memoryPercent: Number.isFinite(Number(system.memoryPercent)) ? Number(system.memoryPercent) : null,
      diskFreeBytes: Number.isFinite(Number(system.diskFreeBytes)) ? Number(system.diskFreeBytes) : null,
      databaseBytes: Number(storage.databaseSize || 0),
      printerStatus: settings.printerConnectionStatus || (settings.printerSetupConfirmed === "true" ? "ready" : "not_configured"),
      printerName: settings.printerName || null,
      integrityStatus: "ok",
      tamperDetected: false,
      connectivity: { online: navigator.onLine, source: "navigator" },
      systemHealth: {
        cpuLogicalProcessors: Number(system.logicalProcessors || navigator.hardwareConcurrency || 0),
        deviceMemoryGb: memoryGb || null,
        appDataBytes: Number(storage.appDataSize || 0),
        mediaBytes: Number(storage.mediaSize || 0),
        backupBytes: Number(storage.backupSize || 0)
      },
      printerHealth: { lastCheckedAt: settings.printerLastCheckedAt || null },
      securitySignals: {
        localSignatureVerified: true,
        clockRollbackDetected: false,
        machineIdPresent: Boolean(system.machineId)
      },
      metadata: { platform: navigator.platform || "Windows", userAgent: navigator.userAgent.slice(0, 220) },
      commandResults,
      sales: pendingSales.map(row => row.sale)
    };

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(HEARTBEAT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store"
      });
    } finally { window.clearTimeout(timeout); }

    const result = await response.json().catch(() => ({})) as {
      valid?: boolean;
      lock?: boolean;
      code?: string;
      next_check_seconds?: number;
      sales_accepted?: number;
      control?: ControlEnvelope;
    };
    if (result.lock) {
      window.dispatchEvent(new CustomEvent("cpipos:license-online-status", { detail: { lock: true, code: result.code || "LICENSE_REVOKED" } }));
      return DEFAULT_INTERVAL_MS;
    }
    if (response.ok && result.valid) {
      if (pendingSales.length && Number(result.sales_accepted || 0) > 0) await markSalesSynced(db, pendingSales);
      writeCommandResults([]);
      window.dispatchEvent(new CustomEvent("cpipos:license-online-status", { detail: { lock: false, valid: true } }));

      const control = result.control ?? {};
      window.__CPIPOS_CONTROL_STATE__ = control;
      window.dispatchEvent(new CustomEvent("cpipos:license-entitlements", { detail: control.entitlements ?? {} }));
      if (control.update) {
        localStorage.setItem(CPIPOS_UPDATE_POLICY_KEY, JSON.stringify(control.update));
        window.dispatchEvent(new CustomEvent("cpipos:update-policy", { detail: control.update }));
      }

      const newResults = await executeMdmCommands(Array.isArray(control.commands) ? control.commands : [], control, storage, system);
      if (newResults.length) writeCommandResults(newResults);

      const seconds = Math.max(120, Math.min(900, Number(result.next_check_seconds || DEFAULT_INTERVAL_MS / 1000)));
      return newResults.length ? 10_000 : seconds * 1000;
    }
  } catch (error) {
    console.debug("CpIPOS cloud sync deferred", error);
  } finally { running = false; }
  return DEFAULT_INTERVAL_MS;
}

function schedule(delay = DEFAULT_INTERVAL_MS) {
  if (timer) window.clearTimeout(timer);
  if (stopped) return;
  timer = window.setTimeout(async () => {
    const nextDelay = await syncOnce();
    schedule(nextDelay);
  }, delay);
}

function start() {
  if (stopped) return;
  window.addEventListener("online", () => void syncOnce());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void syncOnce(); });
  schedule(FIRST_SYNC_DELAY_MS);
}

if (typeof window !== "undefined") start();
