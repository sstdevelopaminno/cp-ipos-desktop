const APP_VERSION = "0.3.0";

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

  document.querySelectorAll<HTMLElement>(".settings-modal-body.rose").forEach((legacyLicenseModal) => {
    if (legacyLicenseModal.dataset.cpiposLicenseAuthorityApplied === "1") return;
    legacyLicenseModal.dataset.cpiposLicenseAuthorityApplied = "1";
    legacyLicenseModal.innerHTML = `
      <div class="license-security-list">
        <strong>License ถูกควบคุมโดย CUTTING POINT TECH IT</strong>
        <span>จำนวนเครื่อง แพ็กเกจ วันเริ่มใช้งาน และวันหมดอายุอ่านจาก License ที่มีลายเซ็นดิจิทัลเท่านั้น</span>
        <span>กลับไปใช้ปุ่มสถานะ License ที่มุมหน้าจอเพื่อดู Device Code และใส่รหัส CP1 ที่ฝ่าย IT ออกให้</span>
      </div>`;
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
