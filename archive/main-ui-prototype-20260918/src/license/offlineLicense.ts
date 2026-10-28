export type DesktopLicensePayload = {
  v: 1;
  product: "CPIPOS-DESKTOP";
  issuer: "CUTTING-POINT-TECH-IT";
  licenseId: string;
  customer: string;
  plan: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string | null;
  maxDevices: 1 | 2;
  devices: string[];
  features: string[];
};

export type DesktopLicenseStatus =
  | "missing"
  | "valid"
  | "not_yet_valid"
  | "expired"
  | "device_mismatch"
  | "clock_rollback"
  | "invalid";

export type DesktopLicenseVerification = {
  status: DesktopLicenseStatus;
  payload: DesktopLicensePayload | null;
  error?: string;
};

export type LicensedSalesModes = {
  takeaway: boolean;
  dineIn: boolean;
  grocery: boolean;
};

const TOKEN_STORAGE_KEY = "cpipos.desktop.license.token.v1";
const CLOCK_STORAGE_KEY = "cpipos.desktop.license.last_valid_time.v1";
const PUBLIC_KEY_SPKI_BASE64 = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEs9PUGIOQlWxNNFA23/Rfcqk1yRCZN2Jq09f3qL8633xktajPKMpOY580I1MwxW5ocb826zeuthot/7FcXJASVQ==";
const DEVICE_PATTERN = /^CP-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}$/;
const LICENSE_PATTERN = /^CP-\d{8}-[A-F0-9]{8}$/;
const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;

function base64Bytes(value: string) {
  const raw = atob(value.replace(/\s+/g, ""));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function base64UrlBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return base64Bytes(padded);
}

function decodePayload(value: string): DesktopLicensePayload {
  const text = new TextDecoder().decode(base64UrlBytes(value));
  return JSON.parse(text) as DesktopLicensePayload;
}

function validPayloadShape(payload: DesktopLicensePayload) {
  if (payload.v !== 1 || payload.product !== "CPIPOS-DESKTOP" || payload.issuer !== "CUTTING-POINT-TECH-IT") return false;
  if (!LICENSE_PATTERN.test(String(payload.licenseId ?? ""))) return false;
  if (!payload.customer?.trim() || !payload.plan?.trim()) return false;
  if (!Array.isArray(payload.devices) || payload.devices.length < 1 || payload.devices.length > 2) return false;
  if (payload.devices.some((device) => !DEVICE_PATTERN.test(String(device ?? "").trim().toUpperCase()))) return false;
  if (payload.maxDevices !== payload.devices.length) return false;
  if (!Array.isArray(payload.features) || !payload.features.includes("offline-pos")) return false;
  const notBefore = Date.parse(payload.notBefore || payload.issuedAt);
  if (!Number.isFinite(notBefore)) return false;
  if (payload.expiresAt) {
    const expiresAt = Date.parse(payload.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= notBefore) return false;
  }
  return true;
}

async function verifySignature(payloadPart: string, signaturePart: string) {
  const key = await crypto.subtle.importKey(
    "spki",
    base64Bytes(PUBLIC_KEY_SPKI_BASE64),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64UrlBytes(signaturePart),
    new TextEncoder().encode(payloadPart)
  );
}

function readLastTrustedTime() {
  try {
    const value = Number(localStorage.getItem(CLOCK_STORAGE_KEY) ?? 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function rememberTrustedTime(now: number) {
  try {
    const previous = readLastTrustedTime();
    localStorage.setItem(CLOCK_STORAGE_KEY, String(Math.max(previous, now)));
  } catch {
    // Clock rollback protection is best-effort when web storage is unavailable.
  }
}

export function loadDesktopLicenseToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveDesktopLicenseToken(token: string) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
}

export function clearDesktopLicenseToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function licensedSalesModes(features: string[] | null | undefined): LicensedSalesModes {
  const normalized = new Set((features ?? []).map((feature) => String(feature).trim().toLowerCase()));
  const grocery = normalized.has("sales-grocery");
  return {
    grocery,
    takeaway: normalized.has("sales-takeaway") || grocery,
    dineIn: normalized.has("sales-dine-in")
  };
}

export async function verifyDesktopLicenseToken(token: string, deviceCode: string): Promise<DesktopLicenseVerification> {
  const cleanToken = token.trim();
  if (!cleanToken) return { status: "missing", payload: null };
  try {
    const parts = cleanToken.split(".");
    if (parts.length !== 3 || parts[0] !== "CP1") return { status: "invalid", payload: null, error: "LICENSE_FORMAT_INVALID" };
    const payload = decodePayload(parts[1]);
    if (!validPayloadShape(payload)) return { status: "invalid", payload: null, error: "LICENSE_PAYLOAD_INVALID" };
    if (!(await verifySignature(parts[1], parts[2]))) return { status: "invalid", payload: null, error: "LICENSE_SIGNATURE_INVALID" };

    const normalizedDevice = deviceCode.trim().toUpperCase();
    if (!DEVICE_PATTERN.test(normalizedDevice) || !payload.devices.map((device) => device.toUpperCase()).includes(normalizedDevice)) {
      return { status: "device_mismatch", payload, error: "LICENSE_DEVICE_MISMATCH" };
    }

    const now = Date.now();
    const previousTrustedTime = readLastTrustedTime();
    if (previousTrustedTime > 0 && now + CLOCK_ROLLBACK_TOLERANCE_MS < previousTrustedTime) {
      return { status: "clock_rollback", payload, error: "LICENSE_CLOCK_ROLLBACK" };
    }

    const notBefore = Date.parse(payload.notBefore || payload.issuedAt);
    if (now < notBefore) return { status: "not_yet_valid", payload, error: "LICENSE_NOT_ACTIVE" };
    if (payload.expiresAt && now >= Date.parse(payload.expiresAt)) {
      return { status: "expired", payload, error: "LICENSE_EXPIRED" };
    }

    rememberTrustedTime(now);
    return { status: "valid", payload };
  } catch (error) {
    return { status: "invalid", payload: null, error: error instanceof Error ? error.message : "LICENSE_INVALID" };
  }
}
