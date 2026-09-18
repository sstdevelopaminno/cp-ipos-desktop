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

type LicenseState = {
  mode?: "trial" | "licensed" | "locked" | "error";
  token?: string;
  deviceCode?: string;
  payload?: { licenseId?: string; expiresAt?: string | null };
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

function licenseStatus() {
  const runtime = runtimeWindow().__CPIPOS_LICENSE_RUNTIME__;
  if (runtime?.mode === "licensed") return "License ใช้งานจริง";
  if (runtime?.mode === "trial") return "ทดลองใช้งาน";
  if (runtime?.mode === "locked") return "ถูกล็อก";
  return "กำลังตรวจสอบ";
}

function formatMoney(value: number | null | undefined) {
  if (value == null) return "รอฝ่าย IT กำหนดราคา";
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 }).format(value);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("th-TH");
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
      meta.textContent = `CpIPOS Desktop ${policy?.current_version || "0.3.0"}`;
    }
  });
}

function renderRemote(host: HTMLElement) {
  const online = navigator.onLine;
  const control = runtimeWindow().__CPIPOS_CONTROL_STATE__;
  const enabled = control?.remote_management_enabled !== false;
  const licensed = runtimeWindow().__CPIPOS_LICENSE_RUNTIME__?.mode === "licensed";
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
    <p>MDM เชื่อมต่ออัตโนมัติเมื่อมีอินเทอร์เน็ต ส่งสถานะเครื่อง CPU / RAM / พื้นที่ / ฐานข้อมูล / เครื่องพิมพ์และยอดขายล่าสุดไปยังระบบหลังบ้าน พร้อมรับคำสั่งที่ได้รับอนุญาตจาก IT โดยไม่ต้องกรอก URL หรือ Token ที่เครื่องลูกค้า</p>
    <div class="connection-badge ${connected ? "online" : "offline"}">${connected ? "ONLINE" : "OFFLINE"}</div>
    <p class="commercial-status">ตรวจสอบล่าสุด: ${cell(checkedAt)}${error ? ` · ${cell(error)}` : ""}</p>
  </div>`;
}

function renderBackup(host: HTMLElement) {
  const cloud = runtimeWindow().__CPIPOS_CLOUD_BACKUP__;
  const license = runtimeWindow().__CPIPOS_LICENSE_RUNTIME__;
  const online = navigator.onLine;
  const licensed = license?.mode === "licensed";
  const pending = cloud?.request?.status === "pending" ? cloud.request : null;
  const entitlement = cloud?.entitlement || null;
  const expiredPending = entitlement?.status === "expired_pending" || cloud?.renewal_required;
  const plans = cloud?.plans?.length ? cloud.plans : FALLBACK_CLOUD_PLANS;

  const planCards = plans.map(plan => {
    const noPrice = plan.price_thb == null;
    const unavailable = noPrice || !online || !licensed || Boolean(pending) || Boolean(entitlement) || Boolean(cloud?.syncing);
    const note = !online
      ? "เชื่อมต่ออินเทอร์เน็ตเพื่อดึงราคาและส่งคำขอซื้อ"
      : noPrice
        ? "เชื่อมระบบ IT แล้ว · รอฝ่าย IT กำหนดราคาแพ็กเกจ"
        : !licensed
          ? "แพ็กเกจจากระบบ IT · เปิด License Desktop ก่อนส่งคำขอซื้อ"
          : "คลิกเพื่อส่งคำขอซื้อไปยังระบบหลังบ้าน IT";
    return `<button class="cloud-plan-card" data-plan="${cell(plan.code)}" ${unavailable ? "disabled" : ""}>
      <span class="cloud-plan-icon">☁</span>
      <span class="cloud-days">${plan.days} วัน</span>
      <strong>${cell(plan.label_th)}</strong>
      <em>${cell(formatMoney(plan.price_thb))}</em>
      <small>${cell(note)}</small>
    </button>`;
  }).join("");

  const lifecycle = expiredPending
    ? `<div class="cloud-expired-card"><div><span>!</span><strong>Cloud หมดอายุ · รอฝ่าย IT ตัดสินใจ</strong></div><p>หยุด Backup ใหม่ชั่วคราว แต่ข้อมูลเดิมบน Cloud ยังเปิดอ่านได้เมื่อออนไลน์ ฝ่าย IT จะเลือก “ต่อ Cloud” หรือ “ยกเลิก Cloud” หากยกเลิก ข้อมูล Cloud ของ License เครื่องนี้จะถูกลบทันที</p><span>หมดอายุ: ${cell(formatDate(entitlement?.expires_at))}</span></div>`
    : entitlement
      ? `<div class="cloud-active-card">
        <div><span class="cloud-live-dot">●</span><strong>Cloud เชื่อมต่อแล้ว</strong></div>
        <code>${cell(entitlement.cloud_code)}</code>
        <span>แพ็กเกจ: ${cell(entitlement.plan_code)}</span>
        <span>ใช้งานถึง: ${cell(formatDate(entitlement.expires_at))}</span>
        <span>สำรองล่าสุด: ${cell(formatDate(entitlement.last_backup_at))}</span>
        <span>เมื่อฐานข้อมูลใหญ่หรือพื้นที่ดิสก์ต่ำ ระบบจะส่ง Snapshot ไป Cloud ตรวจสอบความครบถ้วน แล้วล้างเฉพาะข้อมูลประวัติที่ย้ายสำเร็จออกจากเครื่องโดยอัตโนมัติ</span>
        ${cloud?.lastOffloadedAt ? `<span>ย้ายออกจากเครื่องล่าสุด: ${cell(formatDate(cloud.lastOffloadedAt))} · ${Number(cloud.lastOffloadedRows || 0).toLocaleString("th-TH")} รายการ</span>` : ""}
        <button class="commercial-cloud-now" data-action="backup-now" ${!online || cloud?.syncing ? "disabled" : ""}>${cloud?.syncing ? "กำลังสำรองข้อมูล..." : "สำรองข้อมูลตอนนี้"}</button>
      </div>`
      : "";

  host.innerHTML = `<div class="commercial-card cloud-backup-card">
    <div class="cloud-hero"><span class="cloud-hero-icon">☁</span><div><span class="commercial-kicker">CLOUD BACKUP / RESTORE</span><h3>Cloud สำรองข้อมูล CpIPOS Desktop</h3><p>เลือกแพ็กเกจ Cloud 7 / 15 / 30 / 60 / 90 วัน เมื่อกดซื้อระบบจะส่งคำขอไปยังฝ่าย IT และเชื่อมต่ออัตโนมัติหลังอนุมัติ</p></div></div>
    ${lifecycle}
    ${pending ? `<div class="cloud-pending-card"><strong>รอฝ่าย IT ยืนยันการซื้อ Cloud</strong><span>${pending.plan_days} วัน · ${cell(formatMoney(pending.price_thb))}</span><small>คำขอถูกล็อกไว้แล้ว เมื่อ IT ยืนยัน ระบบจะสร้าง Cloud Code และเชื่อมต่อเครื่องนี้อัตโนมัติเมื่อมีอินเทอร์เน็ต</small></div>` : ""}
    ${!entitlement && !pending ? `<div class="cloud-plan-grid">${planCards}</div>` : ""}
    ${entitlement ? `<div class="cloud-snapshots"><strong>Cloud Archive ล่าสุด</strong>${(cloud?.snapshots || []).slice(0, 5).map(item => `<span>${cell(formatDate(item.completed_at))} · ${cell(item.status)} · ${Math.max(0, Number(item.database_bytes || 0) / 1024 / 1024).toFixed(1)} MB</span>`).join("") || "<span>ยังไม่มี Snapshot</span>"}</div>` : ""}
    ${cloud?.lastError ? `<p class="commercial-status cloud-error">${cell(cloud.lastError)}</p>` : ""}
    <div class="cloud-connection-line"><span>${online ? "● ONLINE" : "○ OFFLINE"}</span><span>${online && cloud?.checkedAt ? "เชื่อมต่อรายการ Cloud จาก IT" : "รอเชื่อมระบบ IT"}</span><span>${licensed ? cell(licenseStatus()) : "TRIAL · ดูแพ็กเกจได้"}</span><span>${expiredPending ? "READ ONLY · WAIT IT" : entitlement ? "AUTO BACKUP ON" : "CLOUD NOT ACTIVE"}</span></div>
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
  const runtime = runtimeWindow().__CPIPOS_LICENSE_RUNTIME__;
  host.innerHTML = `<div class="commercial-card commercial-license">
    <span class="commercial-kicker">CUTTING POINT TECH IT SIGNED LICENSE</span>
    <h3>${cell(licenseStatus())}</h3>
    <p>สิทธิ์ใช้งานจริงมาจาก License Key แบบลายเซ็นดิจิทัลที่ออกโดยฝ่าย IT เท่านั้น ไม่มี Free Forever bypass และไม่มีการสร้าง License จากเครื่องลูกค้า</p>
    <div class="commercial-summary">
      <span>Device Code: ${cell(runtime?.deviceCode || "-")}</span>
      <span>License ID: ${cell(runtime?.payload?.licenseId || "-")}</span>
      <span>Expires: ${cell(runtime?.payload?.expiresAt || "ไม่จำกัด / ยังไม่เปิดใช้งาน")}</span>
    </div>
    <p class="commercial-status">เปิดหน้าต่าง “เปิดใช้งาน CpIPOS Desktop” เพื่อคัดลอก Device Code และใส่ License Key ที่ IT ออกให้</p>
  </div>`;
}

function renderRelease(host: HTMLElement) {
  const policy = runtimeWindow().__CPIPOS_CONTROL_STATE__?.update || readUpdatePolicy();
  const current = policy?.current_version || "0.3.0";
  const latest = policy?.latest_version || "0.3.0";
  const minimum = policy?.minimum_version || "0.3.0";
  const available = Boolean(policy?.update_available);
  host.innerHTML = `<div class="commercial-card">
    <span class="commercial-kicker">CpIPOS Desktop Release</span>
    <h3>เวอร์ชัน ${cell(current)}</h3>
    <p>เมื่อเครื่องออนไลน์ ระบบ IT จะตรวจ current / latest / minimum version ทุก heartbeat และบันทึกสถานะกลับ Control Plane</p>
    <div class="commercial-summary">
      <span>Current: ${cell(current)}</span>
      <span>Latest: ${cell(latest)}</span>
      <span>Minimum: ${cell(minimum)}</span>
      <span>Channel: ${cell(policy?.channel || "stable")}</span>
      <span>Status: ${available ? (policy?.mandatory ? "UPDATE REQUIRED" : "UPDATE AVAILABLE") : "CURRENT"}</span>
    </div>
    <p class="commercial-status">${available ? "มีเวอร์ชันใหม่จากระบบ IT — ขั้นติดตั้งอัตโนมัติจะทำผ่าน Tauri signed updater เพื่อป้องกันไฟล์ปลอม" : "เวอร์ชันปัจจุบันตรงกับ policy ล่าสุดที่ได้รับ"}</p>
  </div>`;
}

function sectionFromModal() {
  const title = textOf(document.querySelector(".modal header h2"));
  const bodyText = textOf(document.querySelector(".modal .settings-modal-body"));
  if (title.includes("Remote Management")) return "remote";
  if (title.includes("Backup") || title.includes("สำรอง") || title.includes("กู้คืน")) return "backup";
  if (title.includes("ลายเส้นโปรแกรม") || title.includes("Program License") || bodyText.includes("License")) return "license";
  if (title.includes("เวอร์ชัน") || title.includes("Version")) return "release";
  return "";
}

function hideLegacyFields(section: string, body: HTMLElement) {
  if (section === "remote") {
    body.querySelectorAll<HTMLElement>(".settings-form-grid,.warning").forEach(element => { element.style.display = "none"; });
  }
  if (section === "backup") {
    body.querySelectorAll<HTMLElement>(":scope > .warning").forEach(element => { element.style.display = "none"; });
  }
}

function enhanceModal() {
  const body = document.querySelector<HTMLElement>(".modal .settings-modal-body");
  if (!body) return;
  const section = sectionFromModal();
  if (!section) return;
  hideLegacyFields(section, body);
  const cloud = runtimeWindow().__CPIPOS_CLOUD_BACKUP__;
  const stateKey = `${section}:${navigator.onLine}:${runtimeWindow().__CPIPOS_LICENSE_RUNTIME__?.mode || "unknown"}:${runtimeWindow().__CPIPOS_CONTROL_STATE__?.update?.latest_version || ""}:${cloud?.request?.status || ""}:${cloud?.entitlement?.cloud_code || ""}:${cloud?.lifecycle_status || ""}:${cloud?.syncing ? "sync" : "idle"}:${cloud?.snapshots?.[0]?.id || ""}:${cloud?.checkedAt || ""}:${cloud?.lastOffloadedAt || ""}`;
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
  const refresh = () => window.requestAnimationFrame(() => {
    reconcileSettingsMenu();
    enhanceModal();
  });
  reconcileSettingsMenu();
  enhanceModal();
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  window.addEventListener("cpipos:license-online-status", refresh);
  window.addEventListener("cpipos:license-entitlements", refresh);
  window.addEventListener("cpipos:update-policy", refresh);
  window.addEventListener("cpipos:control-state", refresh);
  window.addEventListener("cpipos:cloud-state", refresh);
  window.addEventListener("cpipos:cloud-archive-updated", refresh);
  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startRuntime, { once: true });
else startRuntime();

export {};
