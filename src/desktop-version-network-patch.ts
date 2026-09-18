const CPIPOS_DESKTOP_VERSION = "0.3.2";
const nativeFetch = window.fetch.bind(window);

window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (target.includes("/api/desktop-license/heartbeat") && init?.body && typeof init.body === "string") {
    try {
      const payload = JSON.parse(init.body);
      payload.appVersion = CPIPOS_DESKTOP_VERSION;
      payload.metadata = { ...(payload.metadata || {}), desktopVersion: CPIPOS_DESKTOP_VERSION };
      return nativeFetch(input, { ...init, body: JSON.stringify(payload) });
    } catch {
      return nativeFetch(input, init);
    }
  }
  return nativeFetch(input, init);
}) as typeof window.fetch;

window.dispatchEvent(new CustomEvent("cpipos:update-policy", {
  detail: { current_version: CPIPOS_DESKTOP_VERSION, latest_version: CPIPOS_DESKTOP_VERSION, update_available: false }
}));

export {};
