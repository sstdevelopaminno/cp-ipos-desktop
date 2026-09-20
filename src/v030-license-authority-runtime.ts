import { CPIPOS_DESKTOP_VERSION as APP_VERSION } from "./app-version";

function applyV030LicenseAuthorityUi() {
  document.querySelectorAll<HTMLElement>(".settings-menu-card").forEach((card) => {
    const text = card.textContent || "";
    if (text.includes("ลายเส้นโปรแกรม") || text.includes("License และการผูกเครื่อง")) {
      if (!card.hidden) card.hidden = true;
      if (card.getAttribute("aria-hidden") !== "true") card.setAttribute("aria-hidden", "true");
    }
  });

  const aboutVersion = `CpIPOS Desktop ${APP_VERSION}`;
  document.querySelectorAll<HTMLElement>(".settings-menu-card.gray .settings-menu-copy em").forEach((meta) => {
    if (meta.textContent?.includes("CpIPOS Desktop") && meta.textContent !== aboutVersion) {
      meta.textContent = aboutVersion;
    }
  });

  document.querySelectorAll<HTMLElement>(".settings-modal-body.gray .metric").forEach((metric) => {
    const label = metric.querySelector("span")?.textContent?.trim();
    if (label === "Version") {
      const value = metric.querySelector<HTMLElement>("strong");
      if (value && value.textContent !== APP_VERSION) value.textContent = APP_VERSION;
    }
  });
}

let scheduled = false;
function scheduleApply() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    applyV030LicenseAuthorityUi();
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", scheduleApply, { once: true });
  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleApply();
}
