import { useEffect, useState } from "react";
import { licensedSalesModes } from "../../license-entitlements";

type RuntimeLicense = {
  mode?: "trial" | "licensed" | "locked" | "error";
  token?: string;
  deviceCode?: string;
  payload?: { licenseId?: string; expiresAt?: string | null };
};

type LicenseWindow = Window & {
  __CPIPOS_LICENSE_RUNTIME__?: RuntimeLicense;
};

function trialDaysRemaining() {
  try {
    const raw = localStorage.getItem("cpipos.license.trial.start.v1");
    const startedAt = raw ? Date.parse(raw) : NaN;
    if (!Number.isFinite(startedAt)) return 7;
    const remaining = Math.ceil((startedAt + 7 * 86400000 - Date.now()) / 86400000);
    return Math.max(0, Math.min(7, remaining));
  } catch {
    return 7;
  }
}

function readLicenseView() {
  const runtime = (window as LicenseWindow).__CPIPOS_LICENSE_RUNTIME__;
  const modes = licensedSalesModes();
  return {
    status: runtime?.mode || "trial",
    payload: runtime?.payload || null,
    deviceCode: runtime?.deviceCode || "",
    modes: {
      grocery: modes.includes("grocery"),
      takeaway: modes.includes("takeaway"),
      dineIn: modes.includes("dine-in"),
    },
    trialDaysRemaining: trialDaysRemaining(),
    trialExpiresAt: null as string | null,
    refresh: async () => undefined,
  };
}

export function useDesktopLicense() {
  const [value, setValue] = useState(readLicenseView);

  useEffect(() => {
    const refresh = () => setValue(readLicenseView());
    const first = window.setTimeout(refresh, 0);
    const second = window.setTimeout(refresh, 500);
    window.addEventListener("cpipos:license-online-status", refresh);
    window.addEventListener("cpipos:license-entitlements", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
      window.removeEventListener("cpipos:license-online-status", refresh);
      window.removeEventListener("cpipos:license-entitlements", refresh);
      window.removeEventListener("online", refresh);
    };
  }, []);

  return value;
}
