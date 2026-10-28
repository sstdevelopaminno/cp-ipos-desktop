// Final boot stabilizer for installed Windows builds.
// It runs before App imports so first-run database work does not fail only
// because a slower Windows machine needs a little longer to open SQLite/migrate.
const BOOT_WINDOW_MS = 75_000;
const bootStartedAt = Date.now();
const nativeSetTimeout = window.setTimeout.bind(window);

const appMounted = () => Boolean(
  window.__CPIPOS_APP_RENDERED__ ||
  document.querySelector(".workspace,.login-card,.shift-card,.printer-required-card,.settings-page,.sales-screen")
);

window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  const ms = Number(timeout || 0);
  const inBoot = Date.now() - bootStartedAt < BOOT_WINDOW_MS && !appMounted();
  let adjusted = ms;
  if (inBoot) {
    if (ms === 2500) adjusted = 8000;
    if (ms === 5000) adjusted = 20000;
    if (ms === 5500) adjusted = 12000;
    if (ms === 7000 || ms === 8000) adjusted = 30000;
    if (ms === 9500) adjusted = 18000;
    if (ms === 12000) adjusted = 30000;
  }
  return nativeSetTimeout(handler, adjusted, ...args);
}) as typeof window.setTimeout;

let readySent = false;
const publishReady = () => {
  if (readySent || !appMounted()) return;
  readySent = true;
  window.__CPIPOS_APP_RENDERED__ = true;
  window.dispatchEvent(new CustomEvent("cpipos:app-ready", { detail: { at: new Date().toISOString() } }));
};

const observer = new MutationObserver(publishReady);
if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
nativeSetTimeout(publishReady, 1000);
nativeSetTimeout(() => observer.disconnect(), BOOT_WINDOW_MS + 5000);

export {};
