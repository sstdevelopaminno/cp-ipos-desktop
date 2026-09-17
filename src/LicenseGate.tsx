import { useEffect, useMemo, useState, type ReactNode } from "react";
import Database from "@tauri-apps/plugin-sql";
import "./license-gate.css";

const TRIAL_DAYS = 7;
const CLOCK_ROLLBACK_TOLERANCE_MS = 6 * 60 * 60 * 1000;
const PRODUCT_ID = "CPIPOS-DESKTOP";
const ISSUER = "CUTTING-POINT-TECH-IT";
const PUBLIC_KEY_SPKI_BASE64 = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEs9PUGIOQlWxNNFA23/Rfcqk1yRCZN2Jq09f3qL8633xktajPKMpOY580I1MwxW5ocb826zeuthot/7FcXJASVQ==";

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

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function decodeJsonPart(value: string) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as LicensePayload;
}

async function importPublicKey() {
  const binary = Uint8Array.from(atob(PUBLIC_KEY_SPKI_BASE64), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "spki",
    binary,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

async function verifyToken(token: string, deviceCode: string, nowMs: number): Promise<LicensePayload> {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "CP1") throw new Error("LICENSE_FORMAT_INVALID");
  const payload = decodeJsonPart(parts[1]);
  const signature = decodeBase64Url(parts[2]);
  const publicKey = await importPublicKey();
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    signature,
    textEncoder.encode(parts[1]),
  );
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
  try {
    const db = await openRuntimeDb();
    let rows = await db.select<RuntimeRow[]>("SELECT install_id, trial_started_at, last_seen_at, token FROM cpipos_license_runtime WHERE id = 1");
    if (!rows.length) {
      const installId = crypto.randomUUID();
      await db.execute("INSERT INTO cpipos_license_runtime(id, install_id, trial_started_at, last_seen_at, token) VALUES(1, $1, $2, $2, '')", [installId, now]);
      rows = [{ install_id: installId, trial_started_at: now, last_seen_at: now, token: "" }];
    }
    const row = rows[0];
    return { db, row, deviceCode: await sha256Code(`${PRODUCT_ID}|${row.install_id}`) };
  } catch {
    const installKey = "cpipos.license.install.v1";
    const startKey = "cpipos.license.trial.start.v1";
    const seenKey = "cpipos.license.last.seen.v1";
    const tokenKey = "cpipos.license.token.v1";
    const installId = localStorage.getItem(installKey) || crypto.randomUUID();
    localStorage.setItem(installKey, installId);
    const trialStarted = localStorage.getItem(startKey) || now;
    localStorage.setItem(startKey, trialStarted);
    const lastSeen = localStorage.getItem(seenKey) || now;
    return {
      db: null,
      row: { install_id: installId, trial_started_at: trialStarted, last_seen_at: lastSeen, token: localStorage.getItem(tokenKey) || "" },
      deviceCode: await sha256Code(`${PRODUCT_ID}|${installId}`),
    };
  }
}

async function saveRuntime(db: Database | null, row: RuntimeRow, token: string, lastSeen: string) {
  if (db) {
    await db.execute("UPDATE cpipos_license_runtime SET token = $1, last_seen_at = $2, updated_at = CURRENT_TIMESTAMP WHERE id = 1", [token, lastSeen]);
  } else {
    localStorage.setItem("cpipos.license.token.v1", token);
    localStorage.setItem("cpipos.license.last.seen.v1", lastSeen);
  }
  row.token = token;
  row.last_seen_at = lastSeen;
}

function friendlyError(code?: string) {
  switch (code) {
    case "LICENSE_SIGNATURE_INVALID": return "ลายเซ็น License ไม่ถูกต้องหรือถูกแก้ไข";
    case "LICENSE_DEVICE_NOT_ALLOWED": return "License นี้ไม่ได้ออกให้รหัสเครื่องนี้";
    case "LICENSE_EXPIRED": return "License หมดอายุแล้ว";
    case "LICENSE_NOT_ACTIVE_YET": return "License ยังไม่ถึงวันที่เริ่มใช้งาน";
    case "CLOCK_ROLLBACK_DETECTED": return "ตรวจพบวันที่/เวลาของเครื่องย้อนหลัง ระบบจึงล็อกชั่วคราว";
    default: return code ? "License ไม่ผ่านการตรวจสอบจาก CUTTING POINT TECH IT" : "";
  }
}

async function evaluateGate(candidateToken?: string): Promise<GateState> {
  const runtime = await loadRuntime();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const lastSeenMs = Date.parse(runtime.row.last_seen_at);
  const token = candidateToken ?? runtime.row.token;

  if (Number.isFinite(lastSeenMs) && nowMs + CLOCK_ROLLBACK_TOLERANCE_MS < lastSeenMs) {
    return { loading: false, mode: "locked", deviceCode: runtime.deviceCode, token, message: friendlyError("CLOCK_ROLLBACK_DETECTED") };
  }

  if (token.trim()) {
    try {
      const payload = await verifyToken(token, runtime.deviceCode, nowMs);
      await saveRuntime(runtime.db, runtime.row, token.trim(), nowIso);
      return { loading: false, mode: "licensed", deviceCode: runtime.deviceCode, token: token.trim(), payload };
    } catch (error) {
      const code = error instanceof Error ? error.message : "LICENSE_INVALID";
      const trialStartedMs = Date.parse(runtime.row.trial_started_at);
      const trialEndsMs = trialStartedMs + TRIAL_DAYS * 86400000;
      if (nowMs < trialEndsMs) {
        await saveRuntime(runtime.db, runtime.row, token.trim(), nowIso);
        return { loading: false, mode: "trial", deviceCode: runtime.deviceCode, token: token.trim(), trialEndsAt: new Date(trialEndsMs).toISOString(), daysRemaining: Math.max(1, Math.ceil((trialEndsMs - nowMs) / 86400000)), message: friendlyError(code) };
      }
      return { loading: false, mode: "locked", deviceCode: runtime.deviceCode, token: token.trim(), message: friendlyError(code) };
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

export function LicenseGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ loading: true, mode: "trial", deviceCode: "", token: "" });
  const [open, setOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyText, setCopyText] = useState("คัดลอกรหัสเครื่อง");

  useEffect(() => {
    let alive = true;
    void evaluateGate().then(next => { if (alive) { setState(next); setTokenInput(next.token); if (next.mode === "locked") setOpen(true); } });
    return () => { alive = false; };
  }, []);

  const statusLabel = useMemo(() => state.mode === "licensed" ? "License ใช้งานจริง" : state.mode === "trial" ? `ทดลอง ${state.daysRemaining || 0} วัน` : "ระบบถูกล็อก", [state]);

  const activate = async () => {
    setBusy(true);
    const next = await evaluateGate(tokenInput.trim());
    setState(next);
    setTokenInput(next.token);
    setBusy(false);
    if (next.mode === "licensed") setOpen(false);
  };

  const copyDevice = async () => {
    await navigator.clipboard.writeText(state.deviceCode);
    setCopyText("คัดลอกแล้ว");
    window.setTimeout(() => setCopyText("คัดลอกรหัสเครื่อง"), 1400);
  };

  if (state.loading) return <main className="license-loading"><section><img src="/icon.png" alt="CpIPOS" /><h1>กำลังตรวจสอบสิทธิ์การใช้งาน</h1><p>ตรวจสอบ License แบบออฟไลน์...</p></section></main>;

  const locked = state.mode === "locked" || state.mode === "error";
  return <>
    {!locked && children}
    {locked && <main className="license-lock-page"><section className="license-lock-card"><img src="/icon.png" alt="CpIPOS" /><span className="license-lock-pill">OFFLINE LICENSE REQUIRED</span><h1>CpIPOS ถูกล็อกการใช้งานชั่วคราว</h1><p>{state.message || "กรุณาใส่ License ที่ออกโดย CUTTING POINT TECH IT"}</p><div className="license-device-box"><span>รหัสเครื่องสำหรับส่งให้ IT</span><strong>{state.deviceCode}</strong><button onClick={() => void copyDevice()}>{copyText}</button></div><button className="license-primary" onClick={() => setOpen(true)}>ใส่ License เพื่อเปิดใช้งาน</button></section></main>}

    {!locked && <button className={`license-floating ${state.mode}`} onClick={() => setOpen(true)} title="สถานะ License"><span>{state.mode === "licensed" ? "✓" : "T"}</span><strong>{statusLabel}</strong></button>}

    {open && <div className="license-modal-backdrop"><section className="license-modal">
      <header><div><span className="license-kicker">CUTTING POINT TECH CO., LTD.</span><h2>เปิดใช้งาน CpIPOS Desktop</h2></div>{!locked && <button className="license-close" onClick={() => setOpen(false)}>×</button>}</header>
      <div className="license-status-grid">
        <div><span>สถานะ</span><strong>{statusLabel}</strong></div>
        <div><span>รหัสเครื่อง</span><strong>{state.deviceCode}</strong></div>
        {state.payload && <><div><span>License ID</span><strong>{state.payload.licenseId}</strong></div><div><span>แพ็กเกจ</span><strong>{state.payload.plan}</strong></div><div><span>จำนวนเครื่อง</span><strong>{state.payload.devices.length}/{state.payload.maxDevices}</strong></div><div><span>หมดอายุ</span><strong>{formatDate(state.payload.expiresAt)}</strong></div></>}
        {state.mode === "trial" && <><div><span>ทดลองคงเหลือ</span><strong>{state.daysRemaining} วัน</strong></div><div><span>ทดลองถึง</span><strong>{formatDate(state.trialEndsAt)}</strong></div></>}
      </div>
      <div className="license-device-box compact"><span>ส่งรหัสนี้ให้ฝ่าย IT เพื่อออก License สำหรับเครื่องนี้</span><strong>{state.deviceCode}</strong><button onClick={() => void copyDevice()}>{copyText}</button></div>
      <label className="license-token-field">License Key ที่ออกโดย IT<textarea value={tokenInput} onChange={e => setTokenInput(e.target.value.trim())} placeholder="CP1.xxxxx.xxxxx" spellCheck={false} /></label>
      {state.message && <p className="license-error">{state.message}</p>}
      <div className="license-actions"><button className="license-primary" disabled={busy || !tokenInput.trim()} onClick={() => void activate()}>{busy ? "กำลังตรวจสอบ..." : "ตรวจสอบและเปิดใช้งาน"}</button>{!locked && <button className="license-secondary" onClick={() => setOpen(false)}>กลับ</button>}</div>
      <p className="license-help">License ถูกตรวจสอบด้วยลายเซ็นดิจิทัล ECDSA P-256 แบบออฟไลน์ โปรแกรมไม่มี private key ของบริษัทอยู่ภายในเครื่องลูกค้า</p>
    </section></div>}
  </>;
}
