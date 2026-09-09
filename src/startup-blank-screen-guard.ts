const APP_READY_SELECTORS = [
  ".app-shell",
  ".login-card",
  ".shift-card",
  ".printer-required-card",
  ".center-screen",
  ".splash"
].join(",");

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const appHasMounted = () => Boolean(
  window.__CPIPOS_APP_RENDERED__ ||
  document.querySelector(APP_READY_SELECTORS)
);

const renderRecovery = (title: string, detail: string, tone: "loading" | "error" = "loading") => {
  if (appHasMounted()) return;
  const root = document.getElementById("root");
  if (!root) return;

  const actionHint = tone === "error"
    ? "ให้ปิดโปรแกรม แล้วติดตั้งรุ่นแก้ไขล่าสุดอีกครั้ง ถ้ายังขึ้นจอนี้ให้ส่งรูปหน้าจอนี้มาให้ตรวจสอบ"
    : "ระบบกำลังเปิดฐานข้อมูลและหน้าจอขาย ถ้านานเกิน 15 วินาทีให้ปิดโปรแกรมแล้วเปิดใหม่";

  root.innerHTML = `
    <main class="cpipos-boot-fallback cpipos-boot-fallback--${tone}" data-cpipos-boot-fallback>
      <section>
        <img src="/icon.png" alt="CpIPOS" />
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(detail)}</p>
        <small>${escapeHtml(actionHint)}</small>
        <button type="button" data-cpipos-reload>ลองเปิดใหม่</button>
      </section>
    </main>
  `;

  root.querySelector("[data-cpipos-reload]")?.addEventListener("click", () => window.location.reload());
};

window.addEventListener("error", (event) => {
  const message = event.error instanceof Error ? event.error.message : event.message || "UNKNOWN_SCRIPT_ERROR";
  renderRecovery("CpIPOS เปิดหน้าหลักไม่สำเร็จ", message, "error");
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || "UNKNOWN_PROMISE_ERROR");
  renderRecovery("CpIPOS โหลดระบบไม่สำเร็จ", reason, "error");
});

window.setTimeout(() => {
  if (!appHasMounted()) {
    renderRecovery("CpIPOS Desktop กำลังเปิดระบบ", "กำลังโหลดหน้าจอหลัก โปรดรอสักครู่", "loading");
  }
}, 2500);

window.setTimeout(() => {
  if (!appHasMounted()) {
    renderRecovery("CpIPOS Desktop ยังโหลดไม่เสร็จ", "ระบบใช้เวลานานกว่าปกติ อาจเกิดจากฐานข้อมูลหรือ WebView กำลังเริ่มต้น", "loading");
  }
}, 12000);

declare global {
  interface Window {
    __CPIPOS_APP_RENDERED__?: boolean;
  }
}

export {};
