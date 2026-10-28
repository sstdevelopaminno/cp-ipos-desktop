import type { AppSettings, Receipt, Sale, SaleItem } from "./domain/types";

const CONTROL_PLANE = String(import.meta.env.VITE_CPIPOS_IT_BASE_URL || "https://cp-ipos-it-web.vercel.app").replace(/\/$/, "");
const CLOUD_URL = `${CONTROL_PLANE}/api/desktop-license/cloud`;
const CLOUD_FETCH_TIMEOUT_MS = 8000;

type LicenseRuntime = { mode?: "trial" | "licensed" | "locked" | "error"; token?: string; deviceCode?: string };
type RuntimeWindow = Window & {
  __CPIPOS_LICENSE_RUNTIME__?: LicenseRuntime;
  __CPIPOS_CLOUD_BACKUP__?: { cloud_readable?: boolean; lifecycle_status?: string; entitlement?: { status?: string } | null };
};

type CloudSalesResponse = { rows?: Sale[]; entitlement_status?: string };
type CloudReceiptResponse = { sale?: Sale; items?: SaleItem[]; entitlement_status?: string };

function runtime() { return window as RuntimeWindow; }
function license() {
  const value = runtime().__CPIPOS_LICENSE_RUNTIME__;
  return value?.mode === "licensed" && value.token && value.deviceCode ? value : null;
}

async function callCloud<T>(body: Record<string, unknown>): Promise<T> {
  const current = license();
  if (!current) throw new Error("LICENSE_REQUIRED");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CLOUD_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(CLOUD_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, token: current.token, deviceCode: current.deviceCode }),
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await response.json() as { data?: T | null; error?: { code?: string; message?: string } | null };
    if (!response.ok || payload.data == null) throw new Error(payload.error?.code || payload.error?.message || "CLOUD_ARCHIVE_REQUEST_FAILED");
    return payload.data;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function cloudArchiveReadable() {
  if (!navigator.onLine || !license()) return false;
  const state = runtime().__CPIPOS_CLOUD_BACKUP__;
  if (!state) return true;
  return state.cloud_readable === true || ["active", "expired_pending"].includes(String(state.lifecycle_status || state.entitlement?.status || ""));
}

export async function listCloudArchivedSales(limit = 3000) {
  if (!cloudArchiveReadable()) return [] as Sale[];
  try {
    const data = await callCloud<CloudSalesResponse>({ action: "sales", limit });
    return Array.isArray(data.rows) ? data.rows : [];
  } catch (error) {
    const code = error instanceof Error ? error.message : "CLOUD_ARCHIVE_REQUEST_FAILED";
    if (["CLOUD_ENTITLEMENT_REQUIRED", "LICENSE_REQUIRED", "OFFLINE"].includes(code)) return [];
    console.debug("CpIPOS cloud archive sales unavailable", error);
    return [];
  }
}

export async function getCloudArchivedReceipt(saleId: string, settings: AppSettings): Promise<Receipt | null> {
  if (!saleId || !cloudArchiveReadable()) return null;
  try {
    const data = await callCloud<CloudReceiptResponse>({ action: "receipt", saleId });
    if (!data.sale) return null;
    return { ...data.sale, items: Array.isArray(data.items) ? data.items : [], settings };
  } catch (error) {
    console.debug("CpIPOS cloud archive receipt unavailable", error);
    return null;
  }
}

export function mergeLocalAndCloudSales(localRows: Sale[], cloudRows: Sale[]) {
  const map = new Map<string, Sale>();
  for (const row of cloudRows) map.set(row.id, row);
  for (const row of localRows) map.set(row.id, row);
  return Array.from(map.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
