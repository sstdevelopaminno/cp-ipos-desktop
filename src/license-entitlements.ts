export type CpiposSalesMode = "grocery" | "takeaway" | "dine-in";

const ALL_SALES_MODES: CpiposSalesMode[] = ["grocery", "takeaway", "dine-in"];

type RuntimeShape = {
  mode?: "trial" | "licensed" | "locked" | "error";
  token?: string;
  payload?: { features?: string[] };
};

function decodeBase64UrlText(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(normalized), c => c.charCodeAt(0)));
}

function runtimeLicense() {
  return (window as Window & { __CPIPOS_LICENSE_RUNTIME__?: RuntimeShape }).__CPIPOS_LICENSE_RUNTIME__;
}

export function readSignedLicenseFeatures() {
  const runtime = runtimeLicense();
  if (!runtime || runtime.mode !== "licensed") return [] as string[];
  if (Array.isArray(runtime.payload?.features)) return runtime.payload.features.map(String);

  // Legacy fallback for older builds that still published the token internally.
  if (!runtime.token) return [];
  try {
    const parts = runtime.token.trim().split(".");
    if (parts.length !== 3 || parts[0] !== "CP1") return [];
    const payload = JSON.parse(decodeBase64UrlText(parts[1])) as { features?: unknown };
    return Array.isArray(payload.features) ? payload.features.map(String) : [];
  } catch {
    return [];
  }
}

export function licensedSalesModes(): CpiposSalesMode[] {
  const runtime = runtimeLicense();
  if (!runtime || runtime.mode === "trial") return ALL_SALES_MODES;
  const features = readSignedLicenseFeatures();
  const modes: CpiposSalesMode[] = [];
  if (features.includes("sales-grocery")) modes.push("grocery");
  if (features.includes("sales-takeaway")) modes.push("takeaway");
  if (features.includes("sales-dine-in")) modes.push("dine-in");
  if (!modes.length && runtime.mode === "licensed") modes.push("grocery");
  return modes;
}

export function salesModeAllowed(mode: CpiposSalesMode) {
  return licensedSalesModes().includes(mode);
}
