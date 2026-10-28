import { CPIPOS_DESKTOP_VERSION } from "./app-version";

type RuntimeWindow = Window & {
  __CPIPOS_CONTROL_STATE__?: {
    connected?: boolean;
    checked_at?: string;
    last_error?: string;
    remote_management_enabled?: boolean;
    update?: { current_version?: string; latest_version?: string; minimum_version?: string; channel?: string; update_available?: boolean; mandatory?: boolean };
  };
  __CPIPOS_LICENSE_RUNTIME__?: { mode?: string; payload?: { licenseId?: string; features?: string[] } };
};

const runtimeWindow = () => window as RuntimeWindow;
const textOf = (el: Element | null) => (el?.textContent || "").trim();
const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;");
const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("th-TH");
};

function modalTitle(modal: HTMLElement) {
  return textOf(modal.querySelector("header h2"));
}

function modalBody(modal: HTMLElement) {
  return modal.querySelector<HTMLElement>(".settings-modal-body") || modal;
}

function hideLegacy(body: HTMLElement) {
  body.querySelectorAll<HTMLElement>(".settings-form-grid,.warning,.metric-grid,.license-settings,.commercial-settings-extension").forEach(node => {
    node.style.display = "none";
  });
}

function ensureHost(body: HTMLElement) {
  let host = body.querySelector<HTMLElement>(".cpipos-live-settings-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "cpipos-live-settings-host";
    const footer = body.querySelector(".actions.modal-footer");
    body.insertBefore(host, footer || null);
  }
  return host;
}

function renderRemote(host: HTMLElement) {
  const control = runtimeWindow().__CPIPOS_CONTROL_STATE__ || {};
  const enabled = control.remote_management_enabled !== false;
  const licensed = runtimeWindow().__CPIPOS_LICENSE_RUNTIME__?.mode === "licensed";
  const connected = Boolean(navigator.onLine && enabled && licensed && control.connected);
  const lastError = control.last_error && control.last_error !== "OFFLINE" ? control.last_error : "";
  host.innerHTML = `<section class="cpipos-live-card cpipos-live-card--remote">
    <span class="cpipos-live-pill ${connected ? "is-ok" : "is-wait"}">${connected ? "ONLINE" : navigator.onLine ? "CONNECTING" : "OFFLINE"}</span>
    <div class="cpipos-mdm-visual ${connected ? "is-online" : "is-offline"}"><b>POS</b><i></i><strong>IT</strong></div>
    <h3>${connected ? "เชื่อมต่อระบบหลังบ้าน IT แล้ว" : enabled ? "กำลังรอเชื่อมต่อระบบหลังบ้าน IT" : "Remote Management ถูกปิดจาก IT"}</h3>
    <p>ระบบ MDM ทำงานอัตโนมัติ ไม่ต้องกรอก URL หรือ Token ในเครื่องลูกค้า และส่งเฉพาะสถานะที่จำเป็น เช่น CPU / RAM / พื้นที่ฐานข้อมูล / เครื่องพิมพ์ / ยอดขายล่าสุด</p>
    <div class="cpipos-live-grid"><span>License</span><strong>${licensed ? "ใช้งานจริง" : "ทดลอง / ยังไม่เปิด License"}</strong><span>ตรวจล่าสุด</span><strong>${escapeHtml(formatDate(control.checked_at))}</strong><span>สถานะ</span><strong>${escapeHtml(lastError || (connected ? "พร้อมใช้งาน" : "รอ heartbeat"))}</strong></div>
    <button type="button" data-mdm-refresh>ตรวจสอบการเชื่อมต่ออีกครั้ง</button>
  </section>`;
  host.querySelector("[data-mdm-refresh]")?.addEventListener("click", () => window.dispatchEvent(new CustomEvent("cpipos:mdm-refresh")));
}

function renderAbout(host: HTMLElement) {
  const policy = runtimeWindow().__CPIPOS_CONTROL_STATE__?.update;
  const current = policy?.current_version || CPIPOS_DESKTOP_VERSION;
  const latest = policy?.latest_version || CPIPOS_DESKTOP_VERSION;
  const status = policy?.update_available ? (policy.mandatory ? "ต้องอัปเดต" : "มีอัปเดต") : "ล่าสุด";
  host.innerHTML = `<section class="cpipos-live-card cpipos-live-card--about">
    <span class="cpipos-live-pill is-ok">VERSION</span>
    <h3>CpIPOS Desktop ${escapeHtml(current)}</h3>
    <div class="cpipos-live-grid"><span>App</span><strong>CpIPOS Desktop</strong><span>Version</span><strong>${escapeHtml(current)}</strong><span>Latest</span><strong>${escapeHtml(latest)}</strong><span>Mode</span><strong>Offline POS</strong><span>Status</span><strong>${escapeHtml(status)}</strong></div>
  </section>`;
}

function enhanceCurrentModal() {
  const modal = document.querySelector<HTMLElement>(".modal");
  if (!modal) return;
  const title = modalTitle(modal);
  const body = modalBody(modal);
  const section = title.includes("Remote Management") ? "remote" : title.includes("เวอร์ชัน") || title.includes("Version") ? "about" : "";
  if (!section) return;
  const state = [section, navigator.onLine ? "1" : "0", JSON.stringify(runtimeWindow().__CPIPOS_CONTROL_STATE__ || {}), runtimeWindow().__CPIPOS_LICENSE_RUNTIME__?.mode || ""].join("|");
  if (body.dataset.cpiposLiveSettingsState === state) return;
  body.dataset.cpiposLiveSettingsState = state;
  hideLegacy(body);
  const host = ensureHost(body);
  if (section === "remote") renderRemote(host);
  if (section === "about") renderAbout(host);
}

function start() {
  const refresh = () => window.requestAnimationFrame(enhanceCurrentModal);
  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  ["online", "offline", "cpipos:control-state", "cpipos:license-entitlements", "cpipos:update-policy"].forEach(event => window.addEventListener(event, refresh));
  window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();

export {};
