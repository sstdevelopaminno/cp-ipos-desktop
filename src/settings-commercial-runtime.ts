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

declare global {
  interface Window {
    __CPIPOS_CONTROL_STATE__?: ControlState;
    __CPIPOS_LICENSE_RUNTIME__?: {
      mode?: "trial" | "licensed" | "locked" | "error";
      deviceCode?: string;
      payload?: { licenseId?: string; expiresAt?: string | null };
    };
  }
}

const UPDATE_POLICY_KEY = "cpipos.update.policy.v1";
const CONTROL_PLANE = String(import.meta.env.VITE_CPIPOS_IT_BASE_URL || "https://cp-ipos-it-web.vercel.app").replace(/\/$/, "");
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
  const runtime = window.__CPIPOS_LICENSE_RUNTIME__;
  if (runtime?.mode === "licensed") return "License ใช้งานจริง";
  if (runtime?.mode === "trial") return "ทดลองใช้งาน";
  if (runtime?.mode === "locked") return "ถูกล็อก";
  return "กำลังตรวจสอบ";
}

function renderRemote(host: HTMLElement) {
  const control = window.__CPIPOS_CONTROL_STATE__;
  const online = navigator.onLine;
  const enabled = control?.remote_management_enabled !== false;
  const modes = control?.entitlements?.sales_modes?.join(" / ") || "รอ License / heartbeat";
  host.innerHTML = `<div class="commercial-card">
    <span class="commercial-kicker">Remote Management / MDM</span>
    <h3>${enabled ? "CpIPOS IT Control Plane" : "Remote Management ถูกปิดโดย IT"}</h3>
    <p>Desktop ทำงานแบบ Offline-first แต่เมื่อมีอินเทอร์เน็ตจะตรวจ License, ส่งสถานะเครื่อง/Printer/ยอดขาย และรับคำสั่ง MDM แบบ allow-list จากระบบหลังบ้าน IT</p>
    <div class="commercial-summary">
      <span>Network: ${online ? "ONLINE" : "OFFLINE"}</span>
      <span>Control Plane: ${cell(CONTROL_PLANE)}</span>
      <span>Heartbeat: ทุกประมาณ 5 นาทีเมื่อออนไลน์</span>
      <span>Sales modes: ${cell(modes)}</span>
      <span>License: ${cell(licenseStatus())}</span>
    </div>
    <div class="commercial-button-row"><button data-action="sync">ตรวจสอบ / Sync ตอนนี้</button></div>
    <p class="commercial-status" data-status>${online ? "พร้อมเชื่อมต่อระบบหลังบ้านเมื่อ License ใช้งานจริง" : "ขณะนี้ออฟไลน์ ระบบขายยังทำงานตาม License ที่เซ็นไว้"}</p>
  </div>`;
  host.querySelector("[data-action='sync']")?.addEventListener("click", () => {
    const status = host.querySelector<HTMLElement>("[data-status]");
    if (status) status.textContent = navigator.onLine ? "ส่งคำขอตรวจสอบระบบหลังบ้านแล้ว..." : "ยังออฟไลน์ จึงยังส่ง heartbeat ไม่ได้";
    window.dispatchEvent(new CustomEvent("cpipos:request-sync"));
  });
}

function renderLicense(host: HTMLElement) {
  const runtime = window.__CPIPOS_LICENSE_RUNTIME__;
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
  const policy = window.__CPIPOS_CONTROL_STATE__?.update || readUpdatePolicy();
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
  if (title.includes("ลายเส้นโปรแกรม") || title.includes("Program License") || bodyText.includes("License")) return "license";
  if (title.includes("เวอร์ชัน") || title.includes("Version")) return "release";
  return "";
}

function enhanceModal() {
  const body = document.querySelector<HTMLElement>(".modal .settings-modal-body");
  if (!body) return;
  const section = sectionFromModal();
  if (!section) return;
  const stateKey = `${section}:${navigator.onLine}:${window.__CPIPOS_LICENSE_RUNTIME__?.mode || "unknown"}:${window.__CPIPOS_CONTROL_STATE__?.update?.latest_version || ""}`;
  if (body.dataset.commercialEnhanced === stateKey) return;
  body.dataset.commercialEnhanced = stateKey;
  body.querySelector(".commercial-settings-extension")?.remove();
  const host = document.createElement("div");
  host.className = "commercial-settings-extension";
  const footer = body.querySelector(".actions.modal-footer");
  body.insertBefore(host, footer || null);
  if (section === "remote") renderRemote(host);
  if (section === "license") renderLicense(host);
  if (section === "release") renderRelease(host);
}

function startRuntime() {
  enhanceModal();
  const refresh = () => window.requestAnimationFrame(enhanceModal);
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  window.addEventListener("cpipos:license-online-status", refresh);
  window.addEventListener("cpipos:license-entitlements", refresh);
  window.addEventListener("cpipos:update-policy", refresh);
  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startRuntime, { once: true });
else startRuntime();

export {};
