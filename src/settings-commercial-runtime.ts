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
type CloudEntitlement = { id: string; plan_code: string; cloud_code: string; status: string; starts_at: string; expires_at: string; last_backup_at?: string | null };
type CloudSnapshot = { id: string; snapshot_key: string; database_bytes: number; status: string; completed_at?: string | null };
type CloudState = {
  plans: CloudPlan[];
  request: CloudPurchase | null;
  entitlement: CloudEntitlement | null;
  snapshots: CloudSnapshot[];
  connected: boolean;
  automatic_backup: boolean;
  syncing: boolean;
  lastError?: string;
  checkedAt?: string;
};

type RuntimeWindow = Window & {
  __CPIPOS_CONTROL_STATE__?: ControlState;
  __CPIPOS_LICENSE_RUNTIME__?: LicenseState;
  __CPIPOS_CLOUD_BACKUP__?: CloudState;
};

const runtimeWindow = () => window as RuntimeWindow;
const UPDATE_POLICY_KEY = "cpipos.update.policy.v1";
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
  if (value == null) return "รอกำหนดราคา";
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
      const enabled = runtimeWindow().__CPIPOS_CONTROL_STATE__?.remote_management_enabled !== false;
      meta.textContent = navigator.onLine && enabled ? "ออนไลน์ · เชื่อมต่ออัตโนมัติ" : "ออฟไลน์";
    }
    if (label.includes("Backup") || label.includes("สำรอง")) {
      const cloud = runtimeWindow().__CPIPOS_CLOUD_BACKUP__;
      if (cloud?.entitlement && cloud.connected) meta.textContent = `Cloud ${cloud.entitlement.plan_code} · ออนไลน์`;
      else if (cloud?.request?.status === "pending") meta.textContent = "รอ IT ยืนยัน Cloud";
      else meta.textContent = "Cloud สำรองข้อมูลแบบซื้อเพิ่ม";
    }
    if (label.includes("เวอร์ชัน") || label.includes("Version")) {
      const policy = runtimeWindow().__CPIPOS_CONTROL_STATE__?.update || readUpdatePolicy();
      meta.textContent = `CpIPOS Desktop ${policy?.current_version || "0.3.0"}`;
    }
  });
}

function renderRemote(host: HTMLElement) {
  const online = navigator.onLine;
  const enabled = runtimeWindow().__CPIPOS_CONTROL_STATE__?.remote_management_enabled !== false;
  const connected = online && enabled && runtimeWindow().__CPIPOS_LICENSE_RUNTIME__?.mode === "licensed";
  host.innerHTML = `<div class="commercial-card connection-only-card">
    <span class="commercial-kicker">REMOTE MANAGEMENT / MDM</span>
    <div class="mdm-connection-visual ${connected ? "is-online" : "is-offline"}">
      <div class="mdm-node mdm-computer" aria-label="CpIPOS Desktop"><span class="mdm-screen">▰</span><strong>POS</strong></div>
      <div class="mdm-link"><span></span><b>${connected ? "●" : "○"}</b><span></span></div>
      <div class="mdm-node mdm-server" aria-label="CpIPOS IT Server"><span class="mdm-server-icon">▤</span><strong>IT</strong></div>
    </div>
    <h3>${connected ? "ออนไลน์ · เชื่อมต่อระบบ IT แล้ว" : "ออฟไลน์ · รอการเชื่อมต่อ"}</h3>
    <p>MDM เชื่อมต่ออัตโนมัติเมื่อมีอินเทอร์เน็ต ไม่ต้องกรอก URL หรือ Token ในเครื่องลูกค้า และคำสั่งที่ฝ่าย IT ส่งจะถูกรับและทำงานอัตโนมัติเมื่อเครื่องออนไลน์</p>
    <div class="connection-badge ${connected ? "online" : "offline"}">${connected ? "ONLINE" : "OFFLINE"}</div>
  </div>`;
}

function renderBackup(host: HTMLElement) {
  const cloud = runtimeWindow().__CPIPOS_CLOUD_BACKUP__;
  const license = runtimeWindow().__CPIPOS_LICENSE_RUNTIME__;
  const online = navigator.onLine;
  const licensed = license?.mode === "licensed";
  const pending = cloud?.request?.status === "pending" ? cloud.request : null;
  const entitlement = cloud?.entitlement || null;
  const plans = cloud?.plans || [];

  const planCards = plans.map(plan => {
    const unavailable = plan.price_thb == null || !online || !licensed || Boolean(pending) || Boolean(cloud?.syncing);
    return `<button class="cloud-plan-card" data-plan="${cell(plan.code)}" ${unavailable ? "disabled" : ""}>
      <span class="cloud-days">${plan.days} วัน</span>
      <strong>${cell(plan.label_th)}</strong>
      <em>${cell(formatMoney(plan.price_thb))}</em>
      <small>${plan.price_thb == null ? "รอฝ่ายบริษัทกำหนดราคา" : "กดซื้อเพื่อส่งคำขอไปยังฝ่าย IT"}</small>
    </button>`;
  }).join("");

  host.innerHTML = `<div class="commercial-card cloud-backup-card">
    <span class="commercial-kicker">CLOUD BACKUP / RESTORE</span>
    ${entitlement ? `<div class="cloud-active-card">
      <div><span class="cloud-live-dot">●</span><strong>Cloud เชื่อมต่อแล้ว</strong></div>
      <code>${cell(entitlement.cloud_code)}</code>
      <span>แพ็กเกจ: ${cell(entitlement.plan_code)}</span>
      <span>ใช้งานถึง: ${cell(formatDate(entitlement.expires_at))}</span>
      <span>สำรองล่าสุด: ${cell(formatDate(entitlement.last_backup_at))}</span>
      <span>ระบบสำรองข้อมูลอัตโนมัติเมื่อออนไลน์ และเร่งสำรองเมื่อฐานข้อมูลโตหรือพื้นที่เครื่องเหลือน้อย</span>
      <button class="commercial-cloud-now" data-action="backup-now" ${!online || cloud?.syncing ? "disabled" : ""}>${cloud?.syncing ? "กำลังสำรองข้อมูล..." : "สำรองข้อมูลตอนนี้"}</button>
    </div>` : ""}
    ${pending ? `<div class="cloud-pending-card"><strong>รอฝ่าย IT ยืนยันการซื้อ Cloud</strong><span>${pending.plan_days} วัน · ${cell(formatMoney(pending.price_thb))}</span><small>คำขอถูกล็อกไว้แล้ว เมื่อ IT ยืนยัน ระบบจะสร้าง Cloud Code และเชื่อมต่อเครื่องนี้ให้อัตโนมัติเมื่อมีอินเทอร์เน็ต</small></div>` : ""}
    ${!entitlement && !pending ? `<h3>เลือกแพ็กเกจ Cloud สำรองข้อมูล</h3><p>บริการนี้เป็นส่วนเสริมแบบชำระเงิน ข้อมูลจะสำรองไปยังระบบ Cloud ของบริษัทหลังจากฝ่าย IT ยืนยันสิทธิ์เท่านั้น</p><div class="cloud-plan-grid">${planCards || `<div class="commercial-status">${licensed ? (online ? "กำลังโหลดแพ็กเกจจากระบบ IT..." : "ออฟไลน์ — เชื่อมต่ออินเทอร์เน็ตเพื่อดูแพ็กเกจ") : "ต้องเปิดใช้งาน License Desktop ก่อนซื้อ Cloud"}</div>`}</div>` : ""}
    ${entitlement ? `<div class="cloud-snapshots"><strong>Cloud Archive ล่าสุด</strong>${(cloud?.snapshots || []).slice(0, 5).map(item => `<span>${cell(formatDate(item.completed_at))} · ${cell(item.status)} · ${Math.max(0, Number(item.database_bytes || 0) / 1024 / 1024).toFixed(1)} MB</span>`).join("") || "<span>ยังไม่มี Snapshot</span>"}</div>` : ""}
    ${cloud?.lastError ? `<p class="commercial-status cloud-error">${cell(cloud.lastError)}</p>` : ""}
    <div class="cloud-connection-line"><span>${online ? "● ONLINE" : "○ OFFLINE"}</span><span>${licensed ? cell(licenseStatus()) : "ต้องเปิด License"}</span><span>${entitlement ? "AUTO BACKUP ON" : "CLOUD NOT ACTIVE"}</span></div>
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
  if (online && licensed && !cloud?.checkedAt) window.dispatchEvent(new CustomEvent("cpipos:cloud-refresh"));
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
  const stateKey = `${section}:${navigator.onLine}:${runtimeWindow().__CPIPOS_LICENSE_RUNTIME__?.mode || "unknown"}:${runtimeWindow().__CPIPOS_CONTROL_STATE__?.update?.latest_version || ""}:${cloud?.request?.status || ""}:${cloud?.entitlement?.cloud_code || ""}:${cloud?.syncing ? "sync" : "idle"}:${cloud?.snapshots?.[0]?.id || ""}:${cloud?.checkedAt || ""}`;
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
  window.addEventListener("cpipos:cloud-state", refresh);
  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startRuntime, { once: true });
else startRuntime();

export {};
