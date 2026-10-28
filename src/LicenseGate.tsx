import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import "./license-gate.css";

const TRIAL_DAYS = 7;
const CLOCK_ROLLBACK_TOLERANCE_MS = 6 * 60 * 60 * 1000;
const PRODUCT_ID = "CPIPOS-DESKTOP";
const ISSUER = "CUTTING-POINT-TECH-IT";
const PUBLIC_KEY_SPKI_BASE64 = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEIagxxGZeSGgXhE0/CBZcjTOGoROhwdIrtu+PjG24XkAZ98WpxF2quymaZbzGrzyO7+bvBnN5n3Lpg2AUK3EjQA==";
const LEGACY_PUBLIC_KEY_SPKI_BASE64 = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEs9PUGIOQlWxNNFA23/Rfcqk1yRCZN2Jq09f3qL8633xktajPKMpOY580I1MwxW5ocb826zeuthot/7FcXJASVQ==";
const PUBLIC_KEY_RING = [PUBLIC_KEY_SPKI_BASE64, LEGACY_PUBLIC_KEY_SPKI_BASE64];
const LINE_CONTACT_URL = "https://lin.ee/zlvGPLz";
const SALES_PHONE = "0985460355";

type LicensePayload = {
  v: 1;
  product: string;
  issuer: string;
  licenseId: string;
  customer?: string;
  plan: string;
  issuedAt: string;
  notBefore?: string;
  expiresAt?: string | null;
  maxDevices: 1 | 2;
  devices: string[];
  features?: string[];
};

type RuntimeRow = {
  install_id: string;
  trial_started_at: string;
  last_seen_at: string;
  token: string;
};

type GateState = {
  loading: boolean;
  mode: "trial" | "licensed" | "locked" | "error";
  deviceCode: string;
  trialEndsAt?: string;
  daysRemaining?: number;
  payload?: LicensePayload;
  token: string;
  message?: string;
};

const textEncoder = new TextEncoder();
const runtimeBridge = () => window as Window & { __CPIPOS_LICENSE_RUNTIME__?: any };

function normalizeLicenseToken(value: string) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function decodeJsonPart(value: string) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as LicensePayload;
}

async function importPublicKeys() {
  return await Promise.all([...new Set(PUBLIC_KEY_RING)].map((keyBase64) => {
    const binary = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
    return crypto.subtle.importKey("spki", binary, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }));
}

async function verifyToken(tokenInput: string, deviceCode: string, nowMs: number): Promise<LicensePayload> {
  const token = normalizeLicenseToken(tokenInput);
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "CP1") throw new Error("LICENSE_FORMAT_INVALID");
  const payload = decodeJsonPart(parts[1]);
  const signature = decodeBase64Url(parts[2]);
  const publicKeys = await importPublicKeys();
  let ok = false;
  for (const publicKey of publicKeys) {
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, textEncoder.encode(parts[1]));
    if (ok) break;
  }
  if (!ok) throw new Error("LICENSE_SIGNATURE_INVALID");
  if (payload.v !== 1 || payload.product !== PRODUCT_ID || payload.issuer !== ISSUER) throw new Error("LICENSE_PRODUCT_INVALID");
  if (![1, 2].includes(payload.maxDevices)) throw new Error("LICENSE_DEVICE_LIMIT_INVALID");
  if (!Array.isArray(payload.devices) || payload.devices.length < 1 || payload.devices.length > payload.maxDevices || payload.devices.length > 2) throw new Error("LICENSE_DEVICE_LIST_INVALID");
  if (!payload.devices.includes(deviceCode)) throw new Error("LICENSE_DEVICE_NOT_ALLOWED");
  const notBefore = payload.notBefore ? Date.parse(payload.notBefore) : Date.parse(payload.issuedAt);
  if (Number.isFinite(notBefore) && nowMs < notBefore) throw new Error("LICENSE_NOT_ACTIVE_YET");
  if (payload.expiresAt) {
    const expiresAt = Date.parse(payload.expiresAt);
    if (!Number.isFinite(expiresAt) || nowMs > expiresAt) throw new Error("LICENSE_EXPIRED");
  }
  return payload;
}

async function sha256Code(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
  const hex = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `CP-${hex.slice(0, 5)}-${hex.slice(5, 10)}-${hex.slice(10, 15)}-${hex.slice(15, 20)}`;
}

async function readNativeTrialStartedAt() {
  try {
    const value = await invoke<number>("get_or_create_trial_started_at_ms");
    if (!Number.isFinite(value) || value <= 0) return null;
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function earliestIso(...values: Array<string | null | undefined>) {
  const valid = values.map(value => ({ value, time: value ? Date.parse(value) : NaN }))
    .filter((entry): entry is { value: string; time: number } => Boolean(entry.value) && Number.isFinite(entry.time))
    .sort((a, b) => a.time - b.time);
  return valid[0]?.value || null;
}

async function openRuntimeDb() {
  const db = await Database.load("sqlite:cpipos.db");
  await db.execute(`CREATE TABLE IF NOT EXISTS cpipos_license_runtime (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    install_id TEXT NOT NULL,
    trial_started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    token TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  return db;
}

async function loadRuntime(): Promise<{ db: Database | null; row: RuntimeRow; deviceCode: string }> {
  const now = new Date().toISOString();
  const nativeTrialStartedAt = await readNativeTrialStartedAt();
  try {
    const db = await openRuntimeDb();
    let rows = await db.select<RuntimeRow[]>("SELECT install_id, trial_started_at, last_seen_at, token FROM cpipos_license_runtime WHERE id = 1");
    if (!rows.length) {
      const installId = crypto.randomUUID();
      const trialStartedAt = earliestIso(nativeTrialStartedAt, now) || now;
      await db.execute("INSERT INTO cpipos_license_runtime(id, install_id, trial_started_at, last_seen_at, token) VALUES(1, $1, $2, $3, '')", [installId, trialStartedAt, now]);
      rows = [{ install_id: installId, trial_started_at: trialStartedAt, last_seen_at: now, token: "" }];
    }
    const row = rows[0];
    const anchoredTrialStartedAt = earliestIso(row.trial_started_at, nativeTrialStartedAt) || row.trial_started_at;
    if (anchoredTrialStartedAt !== row.trial_started_at) {
      await db.execute("UPDATE cpipos_license_runtime SET trial_started_at = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1", [anchoredTrialStartedAt]);
      row.trial_started_at = anchoredTrialStartedAt;
    }
    return { db, row, deviceCode: await sha256Code(`${PRODUCT_ID}|${row.install_id}`) };
  } catch {
    const installKey = "cpipos.license.install.v1";
    const startKey = "cpipos.license.trial.start.v1";
    const seenKey = "cpipos.license.last.seen.v1";
    const tokenKey = "cpipos.license.token.v1";
    const installId = localStorage.getItem(installKey) || crypto.randomUUID();
    localStorage.setItem(installKey, installId);
    const trialStarted = earliestIso(localStorage.getItem(startKey), nativeTrialStartedAt, now) || now;
    localStorage.setItem(startKey, trialStarted);
    const lastSeen = localStorage.getItem(seenKey) || now;
    return { db: null, row: { install_id: installId, trial_started_at: trialStarted, last_seen_at: lastSeen, token: localStorage.getItem(tokenKey) || "" }, deviceCode: await sha256Code(`${PRODUCT_ID}|${installId}`) };
  }
}

async function saveRuntime(db: Database | null, row: RuntimeRow, tokenInput: string, lastSeen: string) {
  const token = normalizeLicenseToken(tokenInput);
  if (db) await db.execute("UPDATE cpipos_license_runtime SET token = $1, last_seen_at = $2, updated_at = CURRENT_TIMESTAMP WHERE id = 1", [token, lastSeen]);
  else {
    localStorage.setItem("cpipos.license.token.v1", token);
    localStorage.setItem("cpipos.license.last.seen.v1", lastSeen);
  }
  row.token = token;
  row.last_seen_at = lastSeen;
}

function friendlyError(code?: string) {
  switch (code) {
    case "LICENSE_SIGNATURE_INVALID": return "ลายเซ็น License ไม่ถูกต้อง หรือใช้ License ที่ออกจาก Key คนละชุดกับเวอร์ชันโปรแกรมนี้";
    case "LICENSE_DEVICE_NOT_ALLOWED": return "License นี้ไม่ได้ออกให้รหัสเครื่องนี้";
    case "LICENSE_EXPIRED": return "License หมดอายุแล้ว";
    case "LICENSE_NOT_ACTIVE_YET": return "License ยังไม่ถึงวันที่เริ่มใช้งาน";
    case "LICENSE_REVOKED": return "ฝ่าย IT ได้ยกเลิก License นี้แล้ว กรุณาติดต่อบริษัทเพื่อเปิดใช้งานอีกครั้ง";
    case "LICENSE_SUPERSEDED": return "License นี้มี Revision ใหม่แล้ว กรุณาใส่ License Key ล่าสุดจากฝ่าย IT";
    case "LICENSE_NOT_REGISTERED": return "ไม่พบ License นี้ในระบบหลังบ้าน IT";
    case "CLOCK_ROLLBACK_DETECTED": return "ตรวจพบวันที่/เวลาของเครื่องย้อนหลัง ระบบจึงล็อกชั่วคราว";
    default: return code ? "License ไม่ผ่านการตรวจสอบจาก CUTTING POINT TECH IT" : "";
  }
}

async function evaluateGate(candidateToken?: string): Promise<GateState> {
  const runtime = await loadRuntime();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const lastSeenMs = Date.parse(runtime.row.last_seen_at);
  const token = normalizeLicenseToken(candidateToken ?? runtime.row.token);
  if (Number.isFinite(lastSeenMs) && nowMs + CLOCK_ROLLBACK_TOLERANCE_MS < lastSeenMs) return { loading: false, mode: "locked", deviceCode: runtime.deviceCode, token, message: friendlyError("CLOCK_ROLLBACK_DETECTED") };
  if (token.trim()) {
    try {
      const payload = await verifyToken(token, runtime.deviceCode, nowMs);
      await saveRuntime(runtime.db, runtime.row, token, nowIso);
      return { loading: false, mode: "licensed", deviceCode: runtime.deviceCode, token, payload };
    } catch (error) {
      const code = error instanceof Error ? error.message : "LICENSE_INVALID";
      const trialStartedMs = Date.parse(runtime.row.trial_started_at);
      const trialEndsMs = trialStartedMs + TRIAL_DAYS * 86400000;
      if (nowMs < trialEndsMs) {
        await saveRuntime(runtime.db, runtime.row, token, nowIso);
        return { loading: false, mode: "trial", deviceCode: runtime.deviceCode, token, trialEndsAt: new Date(trialEndsMs).toISOString(), daysRemaining: Math.max(1, Math.ceil((trialEndsMs - nowMs) / 86400000)), message: friendlyError(code) };
      }
      return { loading: false, mode: "locked", deviceCode: runtime.deviceCode, token, message: friendlyError(code) };
    }
  }
  const trialStartedMs = Date.parse(runtime.row.trial_started_at);
  const trialEndsMs = trialStartedMs + TRIAL_DAYS * 86400000;
  if (!Number.isFinite(trialStartedMs)) return { loading: false, mode: "error", deviceCode: runtime.deviceCode, token: "", message: "ไม่สามารถอ่านสถานะทดลองใช้งานได้" };
  if (nowMs >= trialEndsMs) return { loading: false, mode: "locked", deviceCode: runtime.deviceCode, token: "", trialEndsAt: new Date(trialEndsMs).toISOString(), message: "หมดระยะทดลองใช้งาน กรุณาใส่ License ที่ออกโดย IT ของบริษัท" };
  await saveRuntime(runtime.db, runtime.row, "", nowIso);
  return { loading: false, mode: "trial", deviceCode: runtime.deviceCode, token: "", trialEndsAt: new Date(trialEndsMs).toISOString(), daysRemaining: Math.max(1, Math.ceil((trialEndsMs - nowMs) / 86400000)) };
}

function formatDate(value?: string | null) {
  if (!value) return "ไม่จำกัด";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("th-TH");
}

function publishLicenseRuntime(state: GateState) {
  runtimeBridge().__CPIPOS_LICENSE_RUNTIME__ = {
    mode: state.mode,
    token: state.token,
    deviceCode: state.deviceCode,
    trialEndsAt: state.trialEndsAt,
    daysRemaining: state.daysRemaining,
    payload: state.payload ? {
      licenseId: state.payload.licenseId,
      plan: state.payload.plan,
      customer: state.payload.customer,
      issuedAt: state.payload.issuedAt,
      notBefore: state.payload.notBefore,
      expiresAt: state.payload.expiresAt,
      maxDevices: state.payload.maxDevices,
      deviceCount: state.payload.devices?.length || 0,
      features: state.payload.features || []
    } : undefined
  };
}

function featureModes(features?: string[]) {
  const list = Array.isArray(features) ? features : [];
  const modes: string[] = [];
  if (list.includes("sales-grocery")) modes.push("ร้านชำ / ค้าปลีก");
  if (list.includes("sales-takeaway")) modes.push("กลับบ้าน");
  if (list.includes("sales-dine-in")) modes.push("นั่งโต๊ะ");
  return modes;
}

export function LicenseGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ loading: true, mode: "trial", deviceCode: "", token: "" });
  const [open, setOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyText, setCopyText] = useState("คัดลอกรหัสเครื่อง");

  useEffect(() => {
    let alive = true;
    void evaluateGate().then(next => {
      if (!alive) return;
      setState(next);
      setTokenInput(next.mode === "licensed" ? "" : next.token);
      if (next.mode === "locked") setOpen(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    publishLicenseRuntime(state);
    window.dispatchEvent(new CustomEvent("cpipos:license-entitlements", { detail: { mode: state.mode, features: state.payload?.features || [], licenseId: state.payload?.licenseId || null, expiresAt: state.payload?.expiresAt || state.trialEndsAt || null } }));
  }, [state.mode, state.token, state.deviceCode, state.payload, state.trialEndsAt, state.daysRemaining]);

  useEffect(() => {
    const onOnlineStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ lock?: boolean; code?: string }>).detail;
      if (!detail?.lock) return;
      setState(current => ({ ...current, loading: false, mode: "locked", message: friendlyError(detail.code || "LICENSE_REVOKED") }));
      setOpen(true);
    };
    window.addEventListener("cpipos:license-online-status", onOnlineStatus);
    return () => window.removeEventListener("cpipos:license-online-status", onOnlineStatus);
  }, []);

  const statusLabel = useMemo(() => state.mode === "licensed" ? "License ใช้งานจริง" : state.mode === "trial" ? `ทดลองใช้งานฟรี ${state.daysRemaining || 0} วัน` : "ระบบถูกล็อก", [state]);
  const activate = async () => {
    setBusy(true);
    const cleanToken = normalizeLicenseToken(tokenInput);
    const next = await evaluateGate(cleanToken);
    setState(next);
    setTokenInput(next.mode === "licensed" ? "" : (next.token || cleanToken));
    setBusy(false);
    if (next.mode === "licensed") setOpen(false);
  };
  const copyDevice = async () => { await navigator.clipboard.writeText(state.deviceCode); setCopyText("คัดลอกแล้ว"); window.setTimeout(() => setCopyText("คัดลอกรหัสเครื่อง"), 1400); };

  if (state.loading) return <main className="license-loading"><section><img src="/icon.png" alt="CpIPOS" /><h1>กำลังตรวจสอบสิทธิ์การใช้งาน</h1><p>ตรวจสอบ License แบบออฟไลน์...</p></section></main>;
  publishLicenseRuntime(state);
  const locked = state.mode === "locked" || state.mode === "error";
  const showActivationForm = locked || state.mode === "trial";
  const modes = state.payload ? featureModes(state.payload.features) : [];

  return <>
    {!locked && children}
    {locked && <main className="license-lock-page"><section className="license-lock-card"><img src="/icon.png" alt="CpIPOS" /><span className="license-lock-pill">TRIAL ENDED · LICENSE REQUIRED</span><h1>ครบกำหนดทดลองใช้งาน CpIPOS Desktop</h1><p>{state.message || "กรุณาซื้อโปรแกรมและใส่ลายเส้น License ที่ออกโดยฝ่าย IT"}</p><div className="license-lock-contact"><img src="/line-contact-qr.svg" alt="LINE ซื้อโปรแกรม CpIPOS" /><div><strong>ติดต่อซื้อโปรแกรม</strong><span>โทร {SALES_PHONE}</span><span>LINE: สแกน QR Code</span></div></div><div className="license-device-box"><span>รหัสเครื่องสำหรับส่งให้ IT</span><strong>{state.deviceCode}</strong><button onClick={() => void copyDevice()}>{copyText}</button></div><button className="license-primary" onClick={() => setOpen(true)}>ซื้อ / ใส่ลายเส้น License</button></section></main>}
    {state.mode === "trial" && <button className="license-floating trial" onClick={() => setOpen(true)} title="ทดลองใช้งานฟรี"><span>T</span><strong>{statusLabel}</strong></button>}
    {open && <div className="license-modal-backdrop"><section className="license-modal">
      <header><div><span className="license-kicker">CUTTING POINT TECH CO., LTD.</span><h2>{locked ? "ซื้อโปรแกรม / เปิดใช้งาน CpIPOS Desktop" : state.mode === "licensed" ? "สถานะ License" : "เปิดใช้งาน CpIPOS Desktop"}</h2></div>{!locked && <button className="license-close" onClick={() => setOpen(false)}>×</button>}</header>
      {locked && <div className="license-purchase-panel"><div className="license-purchase-brand"><img src="/icon.png" alt="CpIPOS" /><div><strong>หมดช่วงทดลองใช้งาน 7 วัน</strong><p>สแกน LINE เพื่อติดต่อซื้อโปรแกรม จากนั้นส่งรหัสเครื่องด้านล่างให้ฝ่าย IT เพื่อออกลายเส้น License สำหรับเครื่องนี้</p><div className="license-contact-chips"><span>โทร {SALES_PHONE}</span><span>LINE {LINE_CONTACT_URL.replace("https://", "")}</span></div></div></div><div className="license-line-qr"><img src="/line-contact-qr.svg" alt="LINE ซื้อโปรแกรม CpIPOS" /><b>สแกน LINE เพื่อซื้อโปรแกรม</b></div></div>}
      <div className="license-status-grid"><div><span>สถานะ</span><strong>{statusLabel}</strong></div><div><span>รหัสเครื่อง</span><strong>{state.deviceCode}</strong></div>{state.payload && <><div><span>License ID</span><strong>{state.payload.licenseId}</strong></div><div><span>แพ็กเกจ</span><strong>{state.payload.plan}</strong></div><div><span>จำนวนเครื่อง</span><strong>{state.payload.devices.length}/{state.payload.maxDevices}</strong></div><div><span>หมดอายุ</span><strong>{formatDate(state.payload.expiresAt)}</strong></div><div><span>โหมดที่ใช้งาน</span><strong>{modes.length ? modes.join(" / ") : "-"}</strong></div></>}{state.mode === "trial" && <><div><span>ทดลองคงเหลือ</span><strong>{state.daysRemaining} วัน</strong></div><div><span>ทดลองถึง</span><strong>{formatDate(state.trialEndsAt)}</strong></div></>}</div>
      <div className="license-device-box compact"><span>ส่งรหัสนี้ให้ฝ่าย IT เพื่อออก License สำหรับเครื่องนี้</span><strong>{state.deviceCode}</strong><button onClick={() => void copyDevice()}>{copyText}</button></div>
      {showActivationForm && <label className="license-token-field">{locked ? "ใส่ลายเส้น License ที่ได้รับจากฝ่าย IT" : "ใส่ License Key ที่ออกโดย IT"}<textarea value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder="CP1.xxxxx.xxxxx" spellCheck={false} /></label>}
      {state.mode === "licensed" && <p className="license-secure-note">โปรแกรมตรวจสอบ License สำเร็จแล้ว จึงซ่อนลายเส้น License Key ทั้งหมดจากหน้าจอ เหลือเฉพาะสถานะและข้อมูลสัญญาที่จำเป็นเท่านั้น</p>}
      {state.message && <p className="license-error">{state.message}</p>}
      <div className="license-actions">{showActivationForm && <button className="license-primary" disabled={busy || !normalizeLicenseToken(tokenInput)} onClick={() => void activate()}>{busy ? "กำลังตรวจสอบลายเส้น..." : (locked ? "ตรวจสอบลายเส้นและเปิดใช้งานทันที" : "ตรวจสอบและเปิดใช้งาน")}</button>}{!locked && <button className="license-secondary" onClick={() => setOpen(false)}>กลับ</button>}</div>
      <p className="license-help">License ถูกตรวจสอบด้วยลายเซ็นดิจิทัล ECDSA P-256 แบบออฟไลน์ และเมื่อมีอินเทอร์เน็ตจะตรวจสถานะกับระบบ IT เป็นระยะ โดยโปรแกรมไม่มี private key ของบริษัทอยู่ภายในเครื่องลูกค้า</p>
    </section></div>}
  </>;
}
