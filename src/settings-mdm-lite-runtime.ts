type RuntimeWindow = Window & {
  __CPIPOS_CONTROL_STATE__?: {
    connected?: boolean;
    checked_at?: string;
    last_error?: string;
    remote_management_enabled?: boolean;
  };
  __CPIPOS_LICENSE_RUNTIME__?: { mode?: string };
};

const runtimeWindow = () => window as RuntimeWindow;

const textOf = (node: Element | null) => (node?.textContent || "").trim();
const isRemoteModal = (node: Element) => /Remote Management|การจัดการระยะไกล|MDM/i.test(textOf(node));

function remoteState() {
  const control = runtimeWindow().__CPIPOS_CONTROL_STATE__;
  const connected = Boolean(navigator.onLine && control?.remote_management_enabled !== false && control?.connected);
  return {
    connected,
    label: connected ? "ออนไลน์" : "ออฟไลน์",
    headline: connected ? "เชื่อมต่อระบบหลังบ้าน IT แล้ว" : "รอการเชื่อมต่อจากระบบหลังบ้าน IT",
    sub: "ระบบ MDM ทำงานอัตโนมัติและควบคุมจากฝั่ง IT เครื่องลูกค้าจะแสดงเฉพาะสถานะการเชื่อมต่อเท่านั้น"
  };
}

function liteHtml() {
  const state = remoteState();
  return `<div class="mdm-lite-card ${state.connected ? "is-online" : "is-offline"}">
    <div class="mdm-lite-visual" aria-label="MDM connection status">
      <div class="mdm-lite-node"><span>POS</span></div>
      <div class="mdm-lite-link"><i></i><b>${state.connected ? "●" : "○"}</b><i></i></div>
      <div class="mdm-lite-node"><span>IT</span></div>
    </div>
    <strong>${state.headline}</strong>
    <small>${state.sub}</small>
    <em>${state.label}</em>
  </div>`;
}

function simplifyModal() {
  document.querySelectorAll<HTMLElement>(".commercial-card.connection-only-card,.mdm-connection-visual").forEach((node) => {
    const host = node.closest<HTMLElement>(".commercial-card") || node.parentElement;
    if (!host || host.dataset.mdmLite === "1") return;
    host.dataset.mdmLite = "1";
    host.innerHTML = liteHtml();
  });

  document.querySelectorAll<HTMLElement>("[role='dialog'],.settings-popup,.settings-modal,.commercial-modal,.modal").forEach((dialog) => {
    if (!isRemoteModal(dialog) || dialog.dataset.mdmLitePatched === "1") return;
    const candidates = Array.from(dialog.querySelectorAll<HTMLElement>("section,article,div"))
      .filter((el) => /CPU|RAM|Token|URL|Database|ฐานข้อมูล|License|ตรวจล่าสุด|DB_LOAD|TIMEOUT/i.test(textOf(el)));
    const target = candidates.find((el) => el.className && String(el.className).includes("card")) || candidates[0];
    if (target) {
      target.innerHTML = liteHtml();
      dialog.dataset.mdmLitePatched = "1";
    }
  });
}

function refreshSettingsMenu() {
  document.querySelectorAll<HTMLElement>(".settings-menu-card").forEach((card) => {
    const label = textOf(card.querySelector("strong"));
    if (!/Remote Management|การจัดการระยะไกล/i.test(label)) return;
    const meta = card.querySelector<HTMLElement>("em");
    if (meta) meta.textContent = remoteState().connected ? "ออนไลน์" : "ออฟไลน์";
  });
}

let raf = 0;
function schedulePatch() {
  window.cancelAnimationFrame(raf);
  raf = window.requestAnimationFrame(() => {
    refreshSettingsMenu();
    simplifyModal();
  });
}

const observer = new MutationObserver(schedulePatch);
if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("cpipos:control-state", schedulePatch);
window.addEventListener("online", schedulePatch);
window.addEventListener("offline", schedulePatch);
window.addEventListener("beforeunload", () => { window.cancelAnimationFrame(raf); observer.disconnect(); }, { once: true });
schedulePatch();

export {};
