type ControlState = { remote_management_enabled?: boolean };
type LicenseState = { mode?: "trial" | "licensed" | "locked" | "error" };
type CloudState = {
  connected?: boolean;
  syncing?: boolean;
  entitlement?: { plan_code?: string; expires_at?: string; last_backup_at?: string | null } | null;
  request?: { status?: string; plan_days?: number } | null;
  lastError?: string;
};

type RuntimeWindow = Window & {
  __CPIPOS_CONTROL_STATE__?: ControlState;
  __CPIPOS_LICENSE_RUNTIME__?: LicenseState;
  __CPIPOS_CLOUD_BACKUP__?: CloudState;
};

const runtimeWindow = () => window as RuntimeWindow;
const STATUS_ID = "cpipos-sales-service-status";

function statusCard(className: string, icon: string, label: string, value: string) {
  return `<div class="sales-service-item ${className}"><span class="sales-service-icon">${icon}</span><span><small>${label}</small><strong>${value}</strong></span></div>`;
}

function render(host: HTMLElement) {
  const runtime = runtimeWindow();
  const licenseMode = runtime.__CPIPOS_LICENSE_RUNTIME__?.mode || "trial";
  const online = navigator.onLine;
  const mdmEnabled = runtime.__CPIPOS_CONTROL_STATE__?.remote_management_enabled !== false;
  const itOnline = online && licenseMode === "licensed" && mdmEnabled;
  const cloud = runtime.__CPIPOS_CLOUD_BACKUP__;
  const cloudActive = Boolean(cloud?.entitlement);
  const cloudConnected = online && cloudActive && cloud?.connected !== false;
  const cloudPending = cloud?.request?.status === "pending";
  const cloudText = cloud?.syncing
    ? "กำลังสำรอง"
    : cloudConnected
      ? "Cloud พร้อม"
      : cloudPending
        ? "รอ IT ยืนยัน"
        : cloudActive
          ? "รออินเทอร์เน็ต"
          : "ไม่ได้ซื้อ Cloud";

  host.innerHTML = [
    statusCard("local-ready", "▣", "ฐานข้อมูลเครื่อง", "พร้อมขายออฟไลน์"),
    statusCard(itOnline ? "online" : "offline", itOnline ? "↔" : "—", "ระบบ IT / MDM", itOnline ? "เชื่อมต่อ" : "ออฟไลน์"),
    statusCard(cloudConnected ? "online" : cloudPending ? "pending" : "offline", "☁", "Cloud Backup", cloudText),
  ].join("") + `<div class="sales-service-network ${online ? "online" : "offline"}"><b>${online ? "● ONLINE" : "○ OFFLINE"}</b><span>${online ? "ระบบขายทำงาน Local และบริการออนไลน์พร้อมเชื่อมต่อ" : "ขายต่อได้จากฐานข้อมูลในเครื่อง · จะ Sync เมื่ออินเทอร์เน็ตกลับมา"}</span></div>`;
}

function ensureStatus() {
  const scanZone = document.querySelector<HTMLElement>(".grocery-scan-zone");
  if (!scanZone) return;
  let host = document.getElementById(STATUS_ID) as HTMLElement | null;
  if (!host) {
    host = document.createElement("div");
    host.id = STATUS_ID;
    host.className = "sales-service-status";
    const title = scanZone.querySelector(".grocery-scan-title");
    if (title?.nextSibling) scanZone.insertBefore(host, title.nextSibling);
    else scanZone.appendChild(host);
  }
  render(host);
}

function start() {
  const refresh = () => window.requestAnimationFrame(ensureStatus);
  ensureStatus();
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  window.addEventListener("cpipos:cloud-state", refresh);
  window.addEventListener("cpipos:license-online-status", refresh);
  window.addEventListener("cpipos:license-entitlements", refresh);
  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();

export {};
