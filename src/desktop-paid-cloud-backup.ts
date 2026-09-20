import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

const CONTROL_PLANE = String(import.meta.env.VITE_CPIPOS_IT_BASE_URL || "https://cp-ipos-it-web.vercel.app").replace(/\/$/, "");
const CLOUD_URL = `${CONTROL_PLANE}/api/desktop-license/cloud`;
const STATUS_INTERVAL_MS = 30 * 60 * 1000;
const BACKUP_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const BACKUP_GROWTH_BYTES = 1024 * 1024;
const LOW_DISK_BYTES = 2 * 1024 * 1024 * 1024;
const CRITICAL_DISK_BYTES = 512 * 1024 * 1024;
const LOCAL_DB_ARCHIVE_TRIGGER_BYTES = 512 * 1024 * 1024;
const CHUNK_ROWS = 150;
const BACKUP_STATE_KEY = "cpipos.cloud.backup.state.v2";
const BACKUP_TABLES = [
  "app_meta",
  "app_settings",
  "staff",
  "employee_permissions",
  "products",
  "shifts",
  "sales",
  "sale_items",
  "sale_cancellations",
  "stock_movements",
  "audit_events"
] as const;

type CloudPlan = { code: string; days: number; label_th: string; label_en: string; price_thb: number | null; active: boolean };
type CloudPurchase = { id: string; plan_code: string; plan_days: number; price_thb: number | null; status: string; requested_at: string; decided_at?: string | null; decision_note?: string | null };
type CloudEntitlement = { id: string; plan_code: string; cloud_code: string; status: string; starts_at: string; expires_at: string; last_backup_at?: string | null; last_snapshot_id?: string | null; expired_at?: string | null; cancelled_at?: string | null; cancellation_reason?: string | null };
type CloudSnapshot = { id: string; snapshot_key: string; database_bytes: number; row_counts: Record<string, number>; status: string; started_at: string; completed_at?: string | null };
type CloudState = {
  plans: CloudPlan[];
  request: CloudPurchase | null;
  entitlement: CloudEntitlement | null;
  snapshots: CloudSnapshot[];
  connected: boolean;
  cloud_readable?: boolean;
  renewal_required?: boolean;
  lifecycle_status?: string;
  automatic_backup: boolean;
  syncing: boolean;
  lastError?: string;
  checkedAt?: string;
  lastOffloadedRows?: number;
  lastOffloadedAt?: string;
};
type LocalBackupState = {
  lastCompletedAt?: string;
  lastDatabaseBytes?: number;
  lastSnapshotKey?: string;
  lastOffloadedRows?: number;
  lastOffloadedAt?: string;
  lastOffloadedThrough?: string;
};
type StorageMetrics = { databaseSize?: number; diskFreeBytes?: number; appDataSize?: number };
type CompleteResponse = CloudSnapshot & { archive?: { sales?: number; items?: number } };

declare global {
  interface Window {
    __CPIPOS_CLOUD_BACKUP__?: CloudState;
  }
}

let running = false;
let stopped = false;
let statusTimer: number | undefined;

function publish(next: Partial<CloudState>) {
  const current = window.__CPIPOS_CLOUD_BACKUP__ || { plans: [], request: null, entitlement: null, snapshots: [], connected: false, automatic_backup: true, syncing: false };
  window.__CPIPOS_CLOUD_BACKUP__ = { ...current, ...next };
  window.dispatchEvent(new CustomEvent("cpipos:cloud-state", { detail: window.__CPIPOS_CLOUD_BACKUP__ }));
}

function licenseReady() {
  const runtime = window.__CPIPOS_LICENSE_RUNTIME__;
  return runtime?.mode === "licensed" && Boolean(runtime.token && runtime.deviceCode) ? runtime : null;
}

async function callCloud(body: Record<string, unknown>) {
  const license = licenseReady();
  if (!license) throw new Error("LICENSE_REQUIRED");
  const response = await fetch(CLOUD_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, token: license.token, deviceCode: license.deviceCode }),
    cache: "no-store"
  });
  const payload = await response.json() as { data?: any; error?: { code?: string; message?: string } | null };
  if (!response.ok || payload.data == null) throw new Error(payload.error?.code || payload.error?.message || "CLOUD_REQUEST_FAILED");
  return payload.data;
}

async function fetchPublicPlans() {
  const response = await fetch(CLOUD_URL, { method: "GET", cache: "no-store" });
  const payload = await response.json() as { data?: { plans?: CloudPlan[] } | null; error?: { code?: string; message?: string } | null };
  if (!response.ok || payload.data == null) throw new Error(payload.error?.code || payload.error?.message || "CLOUD_PLANS_FAILED");
  return Array.isArray(payload.data.plans) ? payload.data.plans : [];
}

async function refreshCloudState() {
  if (!navigator.onLine) {
    publish({ connected: false, checkedAt: new Date().toISOString() });
    return null;
  }

  const license = licenseReady();
  if (!license) {
    try {
      const plans = await fetchPublicPlans();
      publish({
        plans,
        connected: false,
        checkedAt: new Date().toISOString(),
        lastError: ""
      });
      return null;
    } catch (error) {
      publish({
        connected: false,
        checkedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : "CLOUD_PLANS_FAILED"
      });
      return null;
    }
  }

  try {
    const data = await callCloud({ action: "status" });
    const local = readLocalBackupState();
    publish({
      plans: Array.isArray(data.plans) ? data.plans : [],
      request: data.request || null,
      entitlement: data.entitlement || null,
      snapshots: Array.isArray(data.snapshots) ? data.snapshots : [],
      connected: Boolean(data.connected),
      cloud_readable: Boolean(data.cloud_readable),
      renewal_required: Boolean(data.renewal_required),
      lifecycle_status: String(data.lifecycle_status || "not_active"),
      automatic_backup: data.automatic_backup !== false,
      checkedAt: new Date().toISOString(),
      lastError: "",
      lastOffloadedRows: local.lastOffloadedRows,
      lastOffloadedAt: local.lastOffloadedAt
    });
    return data as CloudState;
  } catch (error) {
    publish({ connected: false, checkedAt: new Date().toISOString(), lastError: error instanceof Error ? error.message : "CLOUD_STATUS_FAILED" });
    return null;
  }
}

async function requestPlan(planCode: string) {
  if (!navigator.onLine) throw new Error("OFFLINE");
  const data = await callCloud({ action: "request", planCode });
  publish({ request: data, lastError: "" });
  await refreshCloudState();
  return data;
}

function readLocalBackupState(): LocalBackupState {
  try { return JSON.parse(localStorage.getItem(BACKUP_STATE_KEY) || "{}") as LocalBackupState; }
  catch { return {}; }
}
function writeLocalBackupState(value: LocalBackupState) { localStorage.setItem(BACKUP_STATE_KEY, JSON.stringify(value)); }

async function storageMetrics(): Promise<StorageMetrics> {
  try {
    const local = await invoke<StorageMetrics>("get_local_storage_metrics");
    try {
      const system = await invoke<{ diskFreeBytes?: number }>("get_windows_system_health");
      return { ...local, diskFreeBytes: system.diskFreeBytes };
    } catch { return local; }
  } catch { return {}; }
}

async function availableTables(db: Database) {
  const rows = await db.select<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='table'");
  const names = new Set(rows.map(row => row.name));
  return BACKUP_TABLES.filter(name => names.has(name));
}

async function tableCount(db: Database, table: string) {
  const rows = await db.select<Array<{ count: number }>>(`SELECT COUNT(*) AS count FROM "${table}"`);
  return Number(rows[0]?.count || 0);
}

async function purgeIfExists(db: Database, sql: string, params: unknown[] = []) {
  try { await db.execute(sql, params); } catch { /* legacy schemas may not have every optional table/column */ }
}

async function offloadVerifiedHistory(metrics: StorageMetrics, expectedSales: number, expectedItems: number, complete: CompleteResponse) {
  const archivedSales = Number(complete.archive?.sales ?? -1);
  const archivedItems = Number(complete.archive?.items ?? -1);
  if (archivedSales < expectedSales || archivedItems < expectedItems) throw new Error("CLOUD_ARCHIVE_VERIFY_FAILED");

  const critical = Number(metrics.diskFreeBytes || 0) > 0 && Number(metrics.diskFreeBytes || 0) <= CRITICAL_DISK_BYTES;
  const keepDays = critical ? 1 : 7;
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
  const db = await Database.load("sqlite:cpipos.db");
  const rows = await db.select<Array<{ id: string }>>("SELECT id FROM sales WHERE created_at < $1 ORDER BY created_at", [cutoff]);
  if (!rows.length) return 0;
  const ids = rows.map(row => row.id);

  await db.execute("BEGIN IMMEDIATE");
  try {
    for (const id of ids) {
      await purgeIfExists(db, "DELETE FROM sale_cancellations WHERE sale_id=$1", [id]);
      await purgeIfExists(db, "DELETE FROM sale_items WHERE sale_id=$1", [id]);
      await db.execute("DELETE FROM sales WHERE id=$1", [id]);
    }
    await purgeIfExists(db, "DELETE FROM audit_events WHERE timestamp < $1", [cutoff]);
    await purgeIfExists(db, "DELETE FROM stock_movements WHERE created_at < $1", [cutoff]);
    await purgeIfExists(db, "DELETE FROM shifts WHERE status='closed' AND opened_at < $1", [cutoff]);
    await db.execute("COMMIT");
  } catch (error) {
    await db.execute("ROLLBACK").catch(() => undefined);
    throw error;
  }

  await db.execute("PRAGMA wal_checkpoint(TRUNCATE)").catch(() => undefined);
  await db.execute("VACUUM").catch(() => undefined);
  const local = readLocalBackupState();
  const now = new Date().toISOString();
  writeLocalBackupState({ ...local, lastOffloadedRows: ids.length, lastOffloadedAt: now, lastOffloadedThrough: cutoff });
  publish({ lastOffloadedRows: ids.length, lastOffloadedAt: now });
  window.dispatchEvent(new CustomEvent("cpipos:cloud-archive-updated", { detail: { rows: ids.length, cutoff } }));
  return ids.length;
}

async function uploadSnapshot(entitlement: CloudEntitlement, databaseBytes: number, metrics: StorageMetrics, shouldOffload: boolean) {
  const db = await Database.load("sqlite:cpipos.db");
  const tables = await availableTables(db);
  const rowCounts: Record<string, number> = {};
  for (const table of tables) rowCounts[table] = await tableCount(db, table);
  const snapshotKey = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  publish({ syncing: true, lastError: "" });

  for (const table of tables) {
    const total = rowCounts[table] || 0;
    if (total === 0) {
      await callCloud({ action: "chunk", entitlementId: entitlement.id, snapshotKey, tableName: table, chunkIndex: 0, rows: [], databaseBytes, rowCounts });
      continue;
    }
    let offset = 0;
    let chunkIndex = 0;
    while (offset < total) {
      const rows = await db.select<Array<Record<string, unknown>>>(`SELECT * FROM "${table}" LIMIT ${CHUNK_ROWS} OFFSET ${offset}`);
      await callCloud({ action: "chunk", entitlementId: entitlement.id, snapshotKey, tableName: table, chunkIndex, rows, databaseBytes, rowCounts });
      offset += rows.length;
      chunkIndex += 1;
      if (!rows.length) break;
    }
  }

  const completed = await callCloud({ action: "complete", entitlementId: entitlement.id, snapshotKey, databaseBytes, rowCounts }) as CompleteResponse;
  const now = new Date().toISOString();
  const previous = readLocalBackupState();
  writeLocalBackupState({ ...previous, lastCompletedAt: now, lastDatabaseBytes: databaseBytes, lastSnapshotKey: snapshotKey });

  if (shouldOffload) {
    await offloadVerifiedHistory(metrics, Number(rowCounts.sales || 0), Number(rowCounts.sale_items || 0), completed);
  }
  publish({ syncing: false, lastError: "" });
  await refreshCloudState();
  return completed;
}

async function maybeBackup(force = false) {
  if (running || stopped || !navigator.onLine) return;
  const cloud = window.__CPIPOS_CLOUD_BACKUP__;
  const entitlement = cloud?.entitlement;
  if (!licenseReady() || !entitlement || entitlement.status !== "active" || Date.parse(entitlement.expires_at) <= Date.now()) return;
  running = true;
  try {
    const metrics = await storageMetrics();
    const databaseBytes = Math.max(0, Number(metrics.databaseSize || 0));
    const local = readLocalBackupState();
    const lastAt = local.lastCompletedAt ? Date.parse(local.lastCompletedAt) : 0;
    const age = Number.isFinite(lastAt) ? Date.now() - lastAt : Number.POSITIVE_INFINITY;
    const growth = databaseBytes - Number(local.lastDatabaseBytes || 0);
    const lowDisk = Number(metrics.diskFreeBytes || 0) > 0 && Number(metrics.diskFreeBytes || 0) <= LOW_DISK_BYTES;
    const databaseLarge = databaseBytes >= LOCAL_DB_ARCHIVE_TRIGGER_BYTES;
    const shouldOffload = lowDisk || databaseLarge;
    if (!force && age < BACKUP_MAX_AGE_MS && growth < BACKUP_GROWTH_BYTES && !shouldOffload) return;
    await uploadSnapshot(entitlement, databaseBytes, metrics, shouldOffload);
  } catch (error) {
    publish({ syncing: false, lastError: error instanceof Error ? error.message : "CLOUD_BACKUP_FAILED" });
  } finally { running = false; }
}

async function cycle() {
  const state = await refreshCloudState();
  if (state?.entitlement?.status === "active") await maybeBackup(false);
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => { void cycle(); }, STATUS_INTERVAL_MS);
}

function start() {
  const local = readLocalBackupState();
  publish({ plans: [], request: null, entitlement: null, snapshots: [], connected: false, automatic_backup: true, syncing: false, lastOffloadedRows: local.lastOffloadedRows, lastOffloadedAt: local.lastOffloadedAt });
  window.setTimeout(() => { void cycle(); }, 2 * 60 * 1000);
  window.addEventListener("online", () => { window.setTimeout(() => { void cycle(); }, 30_000); });
  window.addEventListener("offline", () => publish({ connected: false }));
  window.addEventListener("cpipos:cloud-refresh", () => { void refreshCloudState(); });
  window.addEventListener("cpipos:cloud-backup-now", () => { void maybeBackup(true); });
  window.addEventListener("cpipos:cloud-purchase", event => {
    const planCode = String((event as CustomEvent<{ planCode?: string }>).detail?.planCode || "");
    if (!planCode) return;
    void requestPlan(planCode).catch(error => publish({ lastError: error instanceof Error ? error.message : "CLOUD_REQUEST_FAILED" }));
  });
}

window.addEventListener("beforeunload", () => { stopped = true; window.clearTimeout(statusTimer); });
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();

export {};
