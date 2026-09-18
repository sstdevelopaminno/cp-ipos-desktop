let mdmLoaded = false;
let mdmTimer = 0;

const loadMdm = () => {
  if (mdmLoaded) return;
  mdmLoaded = true;
  window.clearTimeout(mdmTimer);
  void import("./desktop-mdm-runtime");
};

// MDM opens the same local SQLite database for telemetry. Starting it while the
// main app is creating/migrating the database can make first-run startup appear
// as DATABASE_INITIALIZE_TIMEOUT on slower Windows machines. Defer MDM until the
// UI has had time to finish normal boot; operators can still trigger an earlier
// check explicitly after the app is ready.
mdmTimer = window.setTimeout(loadMdm, 30000);
window.addEventListener("cpipos:app-ready", loadMdm, { once: true });
window.addEventListener("cpipos:mdm-refresh", loadMdm, { once: true });
window.addEventListener("beforeunload", () => window.clearTimeout(mdmTimer), { once: true });

export {};