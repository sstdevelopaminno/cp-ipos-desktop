let mdmLoaded = false;
let mdmTimer = 0;

const MDM_BOOT_DELAY_MS = 2 * 60 * 1000;

const loadMdm = () => {
  if (mdmLoaded) return;
  mdmLoaded = true;
  window.clearTimeout(mdmTimer);
  void import("./desktop-mdm-runtime");
};

const scheduleMdm = (delayMs = MDM_BOOT_DELAY_MS) => {
  if (mdmLoaded) return;
  window.clearTimeout(mdmTimer);
  mdmTimer = window.setTimeout(loadMdm, delayMs);
};

// Keep IT heartbeat away from first render/SQLite startup on low-spec Windows 10.
// Operators can still force an early check from the settings button.
scheduleMdm(MDM_BOOT_DELAY_MS);
window.addEventListener("cpipos:app-ready", () => scheduleMdm(MDM_BOOT_DELAY_MS), { once: true });
window.addEventListener("cpipos:mdm-refresh", loadMdm, { once: true });
window.addEventListener("beforeunload", () => window.clearTimeout(mdmTimer), { once: true });

export {};