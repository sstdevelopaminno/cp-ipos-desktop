const PERF_STATE_KEY = "cpipos.desktop.runtime.health.v1";
const MAX_HEALTH_LOGS = 20;
const STALE_RUNTIME_KEY_PREFIXES = [
  "cpipos.sales.draft.v1.",
  "cpipos.printer.firstSetupNote.v1",
];

const writeHealthLog = (kind: string, detail: unknown) => {
  try {
    const raw = localStorage.getItem(PERF_STATE_KEY);
    const rows = raw ? JSON.parse(raw) as Array<Record<string, unknown>> : [];
    const message = detail instanceof Error ? detail.message : typeof detail === "string" ? detail : JSON.stringify(detail ?? "");
    rows.unshift({ kind, message, at: new Date().toISOString() });
    localStorage.setItem(PERF_STATE_KEY, JSON.stringify(rows.slice(0, MAX_HEALTH_LOGS)));
  } catch {
    // Keep runtime logging non-blocking.
  }
};

const pruneStaleLocalStorage = () => {
  try {
    const now = Date.now();
    for (const key of Object.keys(localStorage)) {
      if (!STALE_RUNTIME_KEY_PREFIXES.some(prefix => key.startsWith(prefix))) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { updatedAt?: string };
        if (parsed.updatedAt && now - Date.parse(parsed.updatedAt) > 1000 * 60 * 60 * 24) localStorage.removeItem(key);
      } catch {
        // Non-JSON runtime keys are intentionally kept.
      }
    }
  } catch {
    // no-op
  }
};

const startPerformanceGuard = () => {
  document.documentElement.dataset.cpiposRuntimeMode = "stable";
  pruneStaleLocalStorage();
  window.addEventListener("error", event => writeHealthLog("window.error", event.error || event.message));
  window.addEventListener("unhandledrejection", event => writeHealthLog("promise.rejection", event.reason));
  window.setInterval(pruneStaleLocalStorage, 1000 * 60 * 15);
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startPerformanceGuard, { once: true });
else startPerformanceGuard();

export {};
