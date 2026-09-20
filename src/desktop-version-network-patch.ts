import { CPIPOS_DESKTOP_VERSION } from "./app-version";

window.dispatchEvent(new CustomEvent("cpipos:update-policy", {
  detail: {
    current_version: CPIPOS_DESKTOP_VERSION,
    latest_version: CPIPOS_DESKTOP_VERSION,
    minimum_version: CPIPOS_DESKTOP_VERSION,
    update_available: false
  }
}));

export {};
