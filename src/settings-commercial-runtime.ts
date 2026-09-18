type UpdatePolicy = {
  channel?: string;
  current_version?: string;
  latest_version?: string;
  minimum_version?: string;
  update_available?: boolean;
  below_minimum?: boolean;
  mandatory?: boolean;
  auto_install?: boolean;
  notes?: string | null;
};

type ControlState = {
  remote_management_enabled?: boolean;
  connected?: boolean;
  checked_at?: string;
  last_error?: string;
  entitlements?: { sales_modes?: string[]; features?: string[] };
  update?: UpdatePolicy;
};

type LicensePayload = {
  licenseId?: string;
  plan?: string;
  customer?: string;
  expiresAt?: string | null;
  issuedAt?: string;
  notBefore?: string;
  maxDevices?: number;
  devices?: string[];
  features?: string[];
};

type LicenseState = {
  mode?: "trial" | "licensed" | "locked" | "error";
  deviceCode?: string;
  trialEndsAt?: string;
  daysRemaining?: number;
  payload?: LicensePayload;
};

type CloudPlan = { code: string; days: number; label_th: string; label_en: string; price_thb: number | null; active: boolean };
type CloudPurchase = { id: string; plan_code: string; plan_days: number; price_thb: number | null; status: string; requested_at: string; decided_at?: string | null; decision_note?: string | null };
type CloudEntitlement = { id: string; plan_code: string; cloud_code: string; status: string; starts_at: string; expires_at: string; last_backup_at?: string | null; expired_at?: string | null; cancelled_at?: string | null; cancellation_reason?: string | null };
type CloudSnapshot = { id: string; snapshot_key: string; database_bytes: number; status: string; completed_at?: string | null };
type CloudState = {
  plans: CloudPlan[];
  request: CloudPurchase | null;
  entitlement: CloudEntitlement | null;
  snapshots: CloudSnapshot[];
  connected: boolean;
  renewal_required?: boolean;
  lifecycle_status?: string;
  automatic_backup: boolean;
  syncing: boolean;
  lastError?: string;
  checkedAt?: string;
  lastOffloadedRows?: number;
  lastOffloadedAt?: string;
};

type RuntimeWindow = Window & {
  __CPIPOS_CONTROL_STATE__?: ControlState;
  __CPIPOS_LICENSE_RUNTIME__?: LicenseState;
  __CPIPOS_CLOUD_BACKUP__?: CloudState;
};

const runtimeWindow = () => window as RuntimeWindow;
const UPDATE_POLICY_KEY = "cpipos.update.policy.v1";
const FALLBACK_CLOUD_PLANS: CloudPlan[] = [7, 15, 30, 60, 90].map(days => ({
  code: `BACKUP_${days}D`,
  days,
  label_th: `Cloud สำรองข้อมูล ${days} วัน`,
  label_en: `Cloud backup ${days} days`,
  price_thb: null,
  active: true
}));

const textOf = (element: Element | null) => (element?.textContent || "").trim();
const cell = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;");

function readUpdatePolicy(): UpdatePolicy | null {
  try {
    const raw = localStorage.getItem(UPDATE_POLICY_KEY);
    return raw ? JSON.parse(raw) as UpdatePolicy : null;
  } catch { return null; }
}

function formatMoney(value: number | null | undefined) {
  if (value == null) return "รอฝ่าย IT กำหนดราคา";
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 }).format(value);
}

function formatDate(value?: string | null) {
  if (!value) return "ไม่จำกัด";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("th-TH");
}

function runtimeLicense() {
  return runtimeWindow().__CPIPOS_LICENSE_RUNTIME__;
}

function featureModes(features?: string[]) {
  const list = Array.isArray(features) ? features : [];
  const modes: string[] = [];
  if (list.includes("sales-grocery")) modes.push("ร้านชำ / ค้าปลีก");
  if (list.includes("sales-takeaway")) modes.push("กลับบ้าน");
  if (list.includes("sales-dine-in")) modes.push("นั่งโต๊ะ");
  return modes;
}

function featureNames(features?: string[]) {
  const list = Array.isArray(features) ? features : [];
  const names: string[] = [];
  if (list.includes("inventory-stock")) names.push("สินค้าและสต็อก");
  if (list.includes("reports")) names.push("รายงาน");
  if (list.includes("receipt-print")) names.push("พิมพ์ใบเสร็จ");
  if (list.includes("staff-pin")) names.push("พนักงานและ PIN");
  return names;
}

function licenseStatus() {
  const runtime = runtimeLicense();
  if (runtime?.mode === "licensed") return "ลายเส้นใช้งานจริง";
  if (runtime?.mode === "trial") return `ทดลองใช้งาน${runtime.daysRemaining ? ` · เหลือ ${runtime.daysRemaining} วัน` : ""}`;
  if (runtime?.mode === "locked") return "ถูกล็อก · ต้องใส่ลายเส้น";
  return "กำลังตรวจสอบ";
}

function conciseModes() {
  const runtime = runtimeLicense();
  if (runtime?.mode === "trial") return "ทดลอง · ทุกโหมด";
  const modes = featureModes(runtime?.payload?.features);
  return modes.length ? modes.join(" / ") : "—";
}

function reconcileSettingsMenu() {
  document.querySelectorAll<HTMLElement>(".settings-menu-card").forEach(card => {
    const label = textOf(card.querySelector("strong"));
    if (label === "เจ้าของร้าน" || label === "Owner") {
      card.remove();
      return;
    }

    const meta = card.querySelector<HTMLElement>("em");
    if (!meta) return;

    if (label.includes("ลายเส้น") || label.includes("License")) {
      const runtime = runtimeLicense();
      const id = runtime?.payload?.licenseId ? ` · ID ${runtime.payload.licenseId}` : "";
      meta.textContent = runtime?.mode === "licensed" ? `${licenseStatus()}${id}` : licenseStatus();
    }

    if (label.includes("Remote Management")) {
      const control = runtimeWindow().__CPIPOS_CONTROL_STATE__;
      const enabled = control?.remote_management_enabled !== false;
      meta.textContent = navigator.onLine && enabled && control?.connected ? "ออนไลน์ · เชื่อมต่อ IT แล้ว" : "ออฟไลน์";
    }

    if (label.includes("Backup") || label.includes("สำรอง")) {
      const cloud = runtimeWindow().__CPIPOS_CLOUD_BACKUP__;
      if (cloud?.renewal_required) meta.textContent = "Cloud หมดอายุ · รอ IT";
      else if (cloud?.entitlement && cloud.connected) meta.textContent = `Cloud ${cloud.entitlement.plan_code} · ออนไลน์`;
      else if (cloud?.request?.status === "pending") meta.textContent = "รอ IT ยืนยัน Cloud";
      else meta.textContent = "เลือกซื้อ Cloud สำรองข้อมูล";
    }

    if (label.includes("เวอร์ชัน") || label.includes("Version")) {
      const policy = runtimeWindow().__CPIPOS_CONTROL_STATE__?.update || readUpdatePolicy();
      meta.textContent = `CpIPOS Desktop ${policy?.current_version || "0.3.1"}`;
    }
  });
}

function renderRemote(host: HTMLElement) {
  const online = navigator.onLine;
  const control = runtimeWindow().__CPIPOS_CONTROL_STATE__;
  const enabled = control?.remote_management_enabled !== false;
  const licensed = runtimeLicense()?.mode === "licensed";
  const connected = Boolean(online && enabled && licensed && control?.connected);
  const checkedAt = control?.checked_at ? formatDate(control.checked_at) : "—";
  const error = control?.last_error && control.last_error !== "OFFLINE" ? control.last_error : "";
  host.innerHTML = `<div class="commercial-card connection-only-card">
    <span class="commercial-kicker">REMOTE MANAGEMENT / MDM</span>
    <div class="mdm-connection-visual ${connected ? "is-online" : "is-offline"}">
      <div class="mdm-node mdm-computer" aria-label="CpIPOS Desktop"><span class="mdm-screen">▰</span><strong>POS</strong></div>
      <div class="mdm-link"><span></span><b>${connected ? "●" : "○"}</b><span></span></div>
      <div class="mdm-node mdm-server" aria-label="CpIPOS IT Server"><span class="mdm-server-icon">▤</span><strong>IT</strong></div>
    </div>
    <h3>${connected ? "ออนไลน์ · เชื่อมต่อระบบ IT แล้ว" : enabled ? "ออฟไลน์ · รอการเชื่อมต่อ IT" : "Remote Management ถูกปิดจาก IT"}</h3>
    <p>MDM เชื่อมต่ออัตโนมัติเมื่อมีอินเทอร์เน็ต ส่งเฉพาะสถานะที่จำเป็น เช่น CPU / RAM / พื้นที่ / ฐานข้อมูล / เครื่องพิมพ์ และยอดขายล่าสุด โดยไม่แสดงลายเส้นหรือ token ใน UI</p>
    <div class="connection-badge ${connected ? "online" : "offline"}">${connected ? "ONLINE" : "OFFLINE"}</div>
    <p class="commercial-status">ตรวจสอบล่าสุด: ${cell(checkedAt)}${error ? ` · ${cell(error)}` : ""}</p>
  </div>`;
}

function renderBackup(host: HTMLElement) {
  const cloud = runtimeWindow().__CPIPOS_CLOUD_BACKUP__;
  const license = runtimeLicense();
  const online = navigator.onLine;
  const licensed = license?.mode === "licensed";
  const pending = cloud?.request?.status === "pending" ? cloud.request : null;
  const entitlement = cloud?.entitlement || null;
  const plans = cloud?.plans?.length ? cloud.plans : FALLBACK_CLOUD_PLANS;

  const planCards = plans.map(plan => {
    const noPrice = plan.price_thb == null;
    const disabled = noPrice || !online || !licensed || Boolean(pending) || Boolean(entitlement) || Boolean(cloud?.syncing);
    return `<button class="cloud-plan-card" data-plan="${cell(plan.code)}" ${disabled ? "disabled" : ""}>
      <span class="cloud-plan-icon">☁</span><span class="cloud-days">${plan.days} วัน</span>
      <strong>${cell(plan.label_th)}</strong><em>${cell(formatMoney(plan.price_thb))}</em>
      <small>${!online ? "รออินเทอร์เน็ต" : noPrice ? "รอ IT กำหนดราคา" : !licensed ? "ต้องเปิด License ก่อน" : "ส่งคำขอซื้อไปยัง IT"}</small>
    </button>`;
  }).join("");

  const lifecycle = entitlement
    ? `<div class="cloud-active-card"><div><span class="cloud-live-dot">●</span><strong>Cloud เชื่อมต่อแล้ว</strong></div><code>${cell(entitlement.cloud_code)}</code><span>แพ็กเกจ: ${cell(entitlement.plan_code)}</span><span>ใช้งานถึง: ${cell(formatDate(entitlement.expires_at))}</span><span>สำรองล่าสุด: ${cell(formatDate(entitlement.last_backup_at))}</span><button class="commercial-cloud-now" data-action="backup-now" ${!online || cloud?.syncing ? "disabled" : ""}>${cloud?.syncing ? "กำลังสำรองข้อมูล..." : "สำรองข้อมูลตอนนี้"}</button></div>`
    : cloud?.renewal_required
      ? `<div class="cloud-expired-card"><div><span>!</span><strong>Cloud หมดอายุ · รอฝ่าย IT</strong></div><p>ข้อมูล Cloud จะอยู่ในโหมดอ่านได้เมื่อออนไลน์ จนกว่าฝ่าย IT จะต่ออายุหรือยกเลิก</p></div>`
      : "";

  host.innerHTML = `<div class="commercial-card cloud-backup-card">
    <div class="cloud-hero"><span class="cloud-hero-icon">☁</span><div><span class="commercial-kicker">CLOUD BACKUP / RESTORE</span><h3>Cloud สำรองข้อมูล CpIPOS Desktop</h3><p>เลือกแพ็กเกจ Cloud แล้วรอฝ่าย IT ยืนยันก่อนเชื่อมต่ออัตโนมัติ</p></div></div>
    ${lifecycle}
    ${pending ? `<div class="cloud-pending-card"><strong>รอฝ่าย IT ยืนยันการซื้อ Cloud</strong><span>${pending.plan_days} วัน · ${cell(formatMoney(pending.price_thb))}</span></div>` : ""}
    ${!entitlement && !pending ? `<div class="cloud-plan-grid">${planCards}</div>` : ""}
    ${entitlement ? `<div class="cloud-snapshots"><strong>Cloud Archive ล่าสุด</strong>${(cloud?.snapshots || []).slice(0, 5).map(item => `<span>${cell(formatDate(item.completed_at))} · ${cell(item.status)} · ${Math.max(0, Number(item.database_bytes || 0) / 1024 / 1024).toFixed(1)} MB</span>`).join("") || "<span>ยังไม่มี Snapshot</span>"}</div>` : ""}
    ${cloud?.lastError ? `<p class="commercial-status cloud-error">${cell(cloud.lastError)}</p>` : ""}
    <div class="cloud-connection-line"><span>${online ? "● ONLINE" : "○ OFFLINE"}</span><span>${licensed ? "LICENSED" : "TRIAL"}</span><span>${entitlement ? "AUTO BACKUP ON" : "CLOUD NOT ACTIVE"}</span></div>
  </div>`;

  host.querySelectorAll<HTMLButtonElement>("[data-plan]").forEach(button => {
    button.addEventListener("click", () => {
      const planCode = button.dataset.plan || "";
      if (!planCode) return;
      button.disabled = true;
      button.textContent = "กำลังส่งคำขอ...";
      window.dispatchEvent(new CustomEvent("cpipos:cloud-purchase", { detail: { planCode } }));
    });
  });
  host.querySelector<HTMLButtonElement>("[data-action='backup-now']")?.addEventListener("click", event => {
    (event.currentTarget as HTMLButtonElement).disabled = true;
    window.dispatchEvent(new CustomEvent("cpipos:cloud-backup-now"));
  });
  if (online && !cloud?.checkedAt) window.dispatchEvent(new CustomEvent("cpipos:cloud-refresh"));
}

function renderLicense(host: HTMLElement) {
  const runtime = runtimeLicense();
  const payload = runtime?.payload || {};
  const modes = runtime?.mode === "trial" ? ["ร้านชำ / ค้าปลีก", "กลับบ้าน", "นั่งโต๊ะ"] : featureModes(payload.features);
  const systems = featureNames(payload.features);
  const deviceUsed = Array.isArray(payload.devices) ? payload.devices.length : runtime?.mode === "licensed" ? 1 : 0;
  const expiry = runtime?.mode === "trial" ? runtime.trialEndsAt : payload.expiresAt;
  host.innerHTML = `<div class="commercial-card commercial-license secure-license-card">
    <span class="commercial-kicker">CUTTING POINT TECH IT SIGNED LICENSE</span>
    <h3>${cell(licenseStatus())}</h3>
    <p>หน้านี้แสดงเฉพาะสถานะ License ที่ผ่านการตรวจลายเซ็นแล้ว ไม่แสดง License Key / token เพื่อป้องกันการคัดลอกหรือแก้ไขในเครื่องลูกค้า</p>
    <div class="commercial-summary secure-license-summary">
      <span>สถานะ: ${cell(licenseStatus())}</span>
      <span>License ID: ${cell(payload.licenseId || "—")}</span>
      <span>แพ็กเกจ: ${cell(payload.plan || (runtime?.mode === "trial" ? "Trial 7 วัน" : "—"))}</span>
      <span>ลูกค้า: ${cell(payload.customer || "—")}</span>
      <span>รหัสเครื่อง: ${cell(runtime?.deviceCode || "—")}</span>
      <span>จำนวนเครื่อง: ${cell(runtime?.mode === "trial" ? "ทดลอง" : `${deviceUsed}/${payload.maxDevices || 1}`)}</span>
      <span>โหมดขาย: ${cell(modes.length ? modes.join(" / ") : "—")}</span>
      <span>สิทธิ์ระบบ: ${cell(systems.length ? systems.join(" / ") : "—")}</span>
      <span>เริ่มใช้งาน: ${cell(formatDate(payload.notBefore || payload.issuedAt))}</span>
      <span>หมดอายุ: ${cell(formatDate(expiry))}</span>
    </div>
    <p class="commercial-status">ถ้า License หมดอายุหรือถูกยกเลิก โปรแกรมจะแสดงหน้าซื้อ/ใส่ลายเส้นอีกครั้งโดยอัตโนมัติ</p>
  </div>`;
}

function renderRelease(host: HTMLElement) {
  const policy = runtimeWindow().__CPIPOS_CONTROL_STATE__?.update || readUpdatePolicy();
  const current = policy?.current_version || "0.3.1";
  const latest = policy?.latest_version || "0.3.1";
  const minimum = policy?.minimum_version || "0.3.1";
  const available = Boolean(policy?.update_available);
  host.innerHTML = `<div class="commercial-card"><span class="commercial-kicker">CpIPOS Desktop Release</span><h3>เวอร์ชัน ${cell(current)}</h3><p>ระบบ IT จะตรวจ current / latest / minimum version ทุก heartbeat เมื่อเครื่องออนไลน์</p><div class="commercial-summary"><span>Current: ${cell(current)}</span><span>Latest: ${cell(latest)}</span><span>Minimum: ${cell(minimum)}</span><span>Channel: ${cell(policy?.channel || "stable")}</span><span>Status: ${available ? (policy?.mandatory ? "UPDATE REQUIRED" : "UPDATE AVAILABLE") : "CURRENT"}</span></div></div>`;
}

function sectionFromModal() {
  const title = textOf(document.querySelector(".modal header h2"));
  const bodyText = textOf(document.querySelector(".modal .settings-modal-body"));
  if (title.includes("Remote Management")) return "remote";
  if (title.includes("Backup") || title.includes("สำรอง") || title.includes("กู้คืน")) return "backup";
  if (title.includes("ลายเส้นโปรแกรม") || title.includes("Program License") || bodyText.includes("License และการผูกเครื่อง")) return "license";
  if (title.includes("เวอร์ชัน") || title.includes("Version")) return "release";
  return "";
}

function hideLegacyFields(section: string, body: HTMLElement) {
  if (section === "remote") body.querySelectorAll<HTMLElement>(".settings-form-grid,.warning").forEach(element => { element.style.display = "none"; });
  if (section === "backup") body.querySelectorAll<HTMLElement>(":scope > .warning").forEach(element => { element.style.display = "none"; });
  if (section === "license") body.querySelectorAll<HTMLElement>(".settings-form-grid,.warning,.license-settings").forEach(element => { element.style.display = "none"; });
}

function enhanceModal() {
  const body = document.querySelector<HTMLElement>(".modal .settings-modal-body");
  if (!body) return;
  const section = sectionFromModal();
  if (!section) return;
  hideLegacyFields(section, body);
  const cloud = runtimeWindow().__CPIPOS_CLOUD_BACKUP__;
  const license = runtimeLicense();
  const stateKey = [
    section,
    navigator.onLine ? "online" : "offline",
    license?.mode || "unknown",
    license?.payload?.licenseId || "",
    license?.payload?.expiresAt || "",
    (license?.payload?.features || []).join(","),
    runtimeWindow().__CPIPOS_CONTROL_STATE__?.update?.latest_version || "",
    runtimeWindow().__CPIPOS_CONTROL_STATE__?.connected ? "mdm-on" : "mdm-off",
    cloud?.request?.status || "",
    cloud?.entitlement?.cloud_code || "",
    cloud?.syncing ? "sync" : "idle",
    cloud?.checkedAt || ""
  ].join(":");
  if (body.dataset.commercialEnhanced === stateKey) return;
  body.dataset.commercialEnhanced = stateKey;
  body.querySelector(".commercial-settings-extension")?.remove();
  const host = document.createElement("div");
  host.className = "commercial-settings-extension";
  const footer = body.querySelector(".actions.modal-footer");
  body.insertBefore(host, footer || null);
  if (section === "remote") renderRemote(host);
  if (section === "backup") renderBackup(host);
  if (section === "license") renderLicense(host);
  if (section === "release") renderRelease(host);
}

function startRuntime() {
  let queued = false;
  let throttle: number | null = null;
  const run = () => {
    queued = false;
    throttle = null;
    window.requestAnimationFrame(() => {
      reconcileSettingsMenu();
      enhanceModal();
    });
  };
  const refresh = () => {
    if (queued) return;
    queued = true;
    throttle = window.setTimeout(run, 160);
  };

  run();
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  window.addEventListener("cpipos:license-online-status", refresh);
  window.addEventListener("cpipos:license-entitlements", refresh);
  window.addEventListener("cpipos:update-policy", refresh);
  window.addEventListener("cpipos:control-state", refresh);
  window.addEventListener("cpipos:cloud-state", refresh);
  window.addEventListener("cpipos:cloud-archive-updated", refresh);
  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { childList: true });
  window.addEventListener("beforeunload", () => {
    if (throttle) window.clearTimeout(throttle);
    observer.disconnect();
  }, { once: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startRuntime, { once: true });
else startRuntime();

export {};
