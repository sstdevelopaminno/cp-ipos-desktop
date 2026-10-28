import { invoke } from "@tauri-apps/api/core";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  clearDesktopLicenseToken,
  licensedSalesModes,
  loadDesktopLicenseToken,
  saveDesktopLicenseToken,
  verifyDesktopLicenseToken,
  type DesktopLicensePayload,
  type DesktopLicenseStatus,
  type LicensedSalesModes
} from "../../license/offlineLicense";
import "./license-gate.css";

type DesktopAccessStatus = DesktopLicenseStatus | "trial" | "development";

type LicenseContextValue = {
  status: DesktopAccessStatus;
  payload: DesktopLicensePayload | null;
  deviceCode: string;
  modes: LicensedSalesModes;
  trialDaysRemaining: number;
  trialExpiresAt: string | null;
  refresh: () => Promise<void>;
};

const LicenseContext = createContext<LicenseContextValue | null>(null);
const DEV_DEVICE_CODE = "CP-DE000-DE000-DE000-DE000";
const TRIAL_DAYS = 7;
const TRIAL_STARTED_KEY = "cpipos.desktop.trial.started_at.v1";
const LICENSE_ACTIVATED_KEY = "cpipos.desktop.license.ever_activated.v1";
const canUseDevPreview = () => typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);

function readTrialWindow() {
  const now = Date.now();
  try {
    let startedAt = Number(localStorage.getItem(TRIAL_STARTED_KEY) ?? 0);
    if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > now + 5 * 60 * 1000) {
      startedAt = now;
      localStorage.setItem(TRIAL_STARTED_KEY, String(startedAt));
    }
    const expiresAt = startedAt + TRIAL_DAYS * 24 * 60 * 60 * 1000;
    return {
      active: now < expiresAt,
      startedAt,
      expiresAt,
      daysRemaining: Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)))
    };
  } catch {
    const expiresAt = now + TRIAL_DAYS * 24 * 60 * 60 * 1000;
    return { active: true, startedAt: now, expiresAt, daysRemaining: TRIAL_DAYS };
  }
}

function hasActivatedRealLicense() {
  try { return localStorage.getItem(LICENSE_ACTIVATED_KEY) === "1"; } catch { return false; }
}

function rememberRealLicenseActivation() {
  try { localStorage.setItem(LICENSE_ACTIVATED_KEY, "1"); } catch { /* best effort */ }
}

export function useDesktopLicense() {
  const value = useContext(LicenseContext);
  if (!value) {
    return {
      status: "development" as const,
      payload: null,
      deviceCode: DEV_DEVICE_CODE,
      modes: { takeaway: true, dineIn: true, grocery: true },
      trialDaysRemaining: TRIAL_DAYS,
      trialExpiresAt: null,
      refresh: async () => undefined
    };
  }
  return value;
}

function statusText(status: DesktopLicenseStatus, language: "th" | "en") {
  if (language === "en") {
    const map: Record<DesktopLicenseStatus, string> = {
      missing: "No license has been activated on this device.",
      valid: "License ready",
      not_yet_valid: "This license is not active yet.",
      expired: "This license has expired.",
      device_mismatch: "This license belongs to another device.",
      clock_rollback: "The device clock moved backwards. Contact IT to verify the license.",
      invalid: "The license key is invalid or its signature could not be verified."
    };
    return map[status];
  }
  const map: Record<DesktopLicenseStatus, string> = {
    missing: "เครื่องนี้ยังไม่ได้เปิดใช้งาน License",
    valid: "License พร้อมใช้งาน",
    not_yet_valid: "License นี้ยังไม่ถึงวันเริ่มใช้งาน",
    expired: "License นี้หมดอายุแล้ว",
    device_mismatch: "License นี้ไม่ได้ออกให้กับเครื่องนี้",
    clock_rollback: "ตรวจพบเวลาของเครื่องย้อนหลัง กรุณาติดต่อฝ่าย IT เพื่อตรวจสอบ License",
    invalid: "License Key ไม่ถูกต้อง หรือตรวจสอบลายเซ็นดิจิทัลไม่ผ่าน"
  };
  return map[status];
}

export function LicenseGate({ children, language = "th" }: { children: ReactNode; language?: "th" | "en" }) {
  const [deviceCode, setDeviceCode] = useState("");
  const [token, setToken] = useState(() => loadDesktopLicenseToken());
  const [status, setStatus] = useState<DesktopLicenseStatus>("missing");
  const [payload, setPayload] = useState<DesktopLicensePayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [devBypass, setDevBypass] = useState(false);
  const [copied, setCopied] = useState(false);

  const resolveDeviceCode = async () => {
    try {
      const value = await invoke<string>("get_license_device_code");
      return String(value || "").trim().toUpperCase() || DEV_DEVICE_CODE;
    } catch {
      return DEV_DEVICE_CODE;
    }
  };

  const refresh = async () => {
    setBusy(true);
    const code = deviceCode || (await resolveDeviceCode());
    if (!deviceCode) setDeviceCode(code);
    const currentToken = loadDesktopLicenseToken();
    setToken(currentToken);
    const result = await verifyDesktopLicenseToken(currentToken, code);
    if (result.status === "valid") rememberRealLicenseActivation();
    setStatus(result.status);
    setPayload(result.payload);
    setBusy(false);
  };

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      const code = await resolveDeviceCode();
      if (!alive) return;
      setDeviceCode(code);
      const currentToken = loadDesktopLicenseToken();
      const result = await verifyDesktopLicenseToken(currentToken, code);
      if (!alive) return;
      if (result.status === "valid") rememberRealLicenseActivation();
      setToken(currentToken);
      setStatus(result.status);
      setPayload(result.payload);
      setBusy(false);
    };
    void boot();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !devBypass) void refresh();
    }, 60_000);
    const onFocus = () => { if (!devBypass) void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [deviceCode, devBypass]);

  const trial = readTrialWindow();
  const trialActive = status !== "valid" && !hasActivatedRealLicense() && trial.active;
  const licensedModes = useMemo(() => licensedSalesModes(payload?.features), [payload]);
  const allTrialModes: LicensedSalesModes = { takeaway: true, dineIn: true, grocery: true };
  const contextValue = useMemo<LicenseContextValue>(() => ({
    status: devBypass ? "development" : trialActive ? "trial" : status,
    payload: devBypass || trialActive ? null : payload,
    deviceCode,
    modes: devBypass || trialActive ? allTrialModes : licensedModes,
    trialDaysRemaining: trialActive ? trial.daysRemaining : 0,
    trialExpiresAt: trialActive ? new Date(trial.expiresAt).toISOString() : null,
    refresh
  }), [devBypass, trialActive, trial.daysRemaining, trial.expiresAt, status, payload, deviceCode, licensedModes]);

  if (busy) {
    return <main className="license-screen"><section className="license-card license-card--loading"><img src="/icon.png" alt="CpIPOS"/><h1>CpIPOS Desktop</h1><p>{language === "th" ? "กำลังตรวจสอบ License..." : "Checking license..."}</p></section></main>;
  }

  if (devBypass || status === "valid" || trialActive) {
    return <LicenseContext.Provider value={contextValue}>{children}</LicenseContext.Provider>;
  }

  const save = async () => {
    saveDesktopLicenseToken(token);
    await refresh();
  };
  const clear = async () => {
    clearDesktopLicenseToken();
    setToken("");
    await refresh();
  };
  const copyDevice = async () => {
    await navigator.clipboard?.writeText(deviceCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return <main className="license-screen">
    <section className="license-card">
      <div className="license-brand"><img src="/icon.png" alt="CpIPOS"/><div><strong>CpIPOS Desktop</strong><span>OFFLINE LICENSE</span></div></div>
      <div className={`license-status license-status--${status}`}><span className="license-status__dot"/><div><strong>{statusText(status, language)}</strong>{payload?.expiresAt ? <small>{language === "th" ? "หมดอายุ" : "Expires"}: {new Date(payload.expiresAt).toLocaleString(language === "th" ? "th-TH" : "en-US")}</small> : null}{status === "missing" && !hasActivatedRealLicense() && !trial.active ? <small>{language === "th" ? "ทดลองใช้งาน 7 วันสิ้นสุดแล้ว กรุณาใส่ License Key ที่ออกโดยฝ่าย IT" : "The 7-day trial has ended. Enter a License Key issued by IT."}</small> : null}</div></div>
      <div className="license-device-box"><span>{language === "th" ? "รหัสเครื่องสำหรับออก License" : "Device code for license issuing"}</span><strong>{deviceCode}</strong><button type="button" onClick={() => void copyDevice()}>{copied ? (language === "th" ? "คัดลอกแล้ว" : "Copied") : (language === "th" ? "คัดลอกรหัสเครื่อง" : "Copy device code")}</button></div>
      <div className="license-guide"><b>1</b><span>{language === "th" ? "นำรหัสเครื่องด้านบนไปใส่ในระบบ IT > ออก License POS Desktop" : "Use the device code in IT > Issue POS Desktop License."}</span><b>2</b><span>{language === "th" ? "เลือกโหมดขายที่อนุญาตและอายุ License แล้วสร้าง License Key" : "Choose licensed sales modes and term, then issue the License Key."}</span><b>3</b><span>{language === "th" ? "นำ License Key ที่ได้มาวางด้านล่างและกดเปิดใช้งาน" : "Paste the issued License Key below and activate it."}</span></div>
      <label className="license-token-label">License Key<textarea value={token} onChange={(event) => setToken(event.target.value)} placeholder="CP1...." spellCheck={false}/></label>
      <div className="license-actions"><button type="button" className="license-primary" disabled={!token.trim()} onClick={() => void save()}>{language === "th" ? "ตรวจสอบและเปิดใช้งาน" : "Verify & activate"}</button>{loadDesktopLicenseToken() ? <button type="button" onClick={() => void clear()}>{language === "th" ? "ล้าง License เดิม" : "Clear license"}</button> : null}</div>
      {canUseDevPreview() ? <button type="button" className="license-dev" onClick={() => setDevBypass(true)}>DEV PREVIEW · {language === "th" ? "เปิดดู UI โดยไม่ใช้ License" : "Preview UI without license"}</button> : null}
      <p className="license-footnote">{language === "th" ? "License ถูกตรวจด้วยลายเซ็นดิจิทัล, รหัสเครื่อง, วันเริ่มใช้งาน และวันหมดอายุทุกครั้งก่อนเข้าโปรแกรม" : "The app verifies the digital signature, device binding, start date and expiry before opening the POS."}</p>
    </section>
  </main>;
}
