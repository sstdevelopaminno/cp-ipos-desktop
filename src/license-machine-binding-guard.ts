import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

type LicenseRuntime = {
  mode?: "trial" | "licensed" | "locked" | "error";
  token?: string;
  deviceCode?: string;
  payload?: { licenseId?: string };
};

type WindowsSystemHealth = { machineId?: string };
type BindingRow = { machine_id: string; device_code: string; license_id: string; token_sha256: string };

const encoder = new TextEncoder();
const FIRST_CHECK_DELAY_MS = 60 * 1000;
const PERIODIC_CHECK_MS = 15 * 60 * 1000;
const MIN_CHECK_GAP_MS = 5 * 60 * 1000;
const MACHINE_ID_CACHE_MS = 60 * 60 * 1000;
let checking = false;
let lastToken = "";
let stopped = false;
let lastCheckAt = 0;
let cachedMachineId = "";
let cachedMachineIdAt = 0;

function runtime() {
  return (window as Window & { __CPIPOS_LICENSE_RUNTIME__?: LicenseRuntime }).__CPIPOS_LICENSE_RUNTIME__;
}

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function currentMachineId() {
  if (cachedMachineId && Date.now() - cachedMachineIdAt < MACHINE_ID_CACHE_MS) return cachedMachineId;
  try {
    const system = await invoke<WindowsSystemHealth>("get_windows_system_health");
    cachedMachineId = String(system.machineId || "").trim().toUpperCase();
    cachedMachineIdAt = Date.now();
    return cachedMachineId;
  } catch { return cachedMachineId; }
}

async function checkBinding(force = false) {
  if (checking || stopped) return;
  if (!force && Date.now() - lastCheckAt < MIN_CHECK_GAP_MS) return;
  const license = runtime();
  if (!license || license.mode !== "licensed" || !license.token || !license.deviceCode) return;
  if (lastToken === license.token) return;
  checking = true;
  lastCheckAt = Date.now();
  try {
    const machineId = await currentMachineId();
    if (!machineId) return;
    const tokenHash = await sha256(license.token);
    const licenseId = String(license.payload?.licenseId || "");
    const db = await Database.load("sqlite:cpipos.db");
    await db.execute(`CREATE TABLE IF NOT EXISTS cpipos_license_machine_binding (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      machine_id TEXT NOT NULL,
      device_code TEXT NOT NULL,
      license_id TEXT NOT NULL,
      token_sha256 TEXT NOT NULL,
      bound_at TEXT NOT NULL,
      last_verified_at TEXT NOT NULL
    )`);
    const rows = await db.select<BindingRow[]>("SELECT machine_id,device_code,license_id,token_sha256 FROM cpipos_license_machine_binding WHERE id=1");
    if (!rows.length) {
      const now = new Date().toISOString();
      await db.execute(
        "INSERT INTO cpipos_license_machine_binding(id,machine_id,device_code,license_id,token_sha256,bound_at,last_verified_at) VALUES(1,$1,$2,$3,$4,$5,$5)",
        [machineId, license.deviceCode, licenseId, tokenHash, now]
      );
      lastToken = license.token;
      return;
    }

    const bound = rows[0];
    const sameMachine = String(bound.machine_id || "").toUpperCase() === machineId;
    const sameDevice = String(bound.device_code || "").toUpperCase() === String(license.deviceCode).toUpperCase();
    if (!sameMachine || !sameDevice) {
      window.dispatchEvent(new CustomEvent("cpipos:license-online-status", {
        detail: { lock: true, code: "LICENSE_MACHINE_MISMATCH" }
      }));
      return;
    }

    await db.execute(
      "UPDATE cpipos_license_machine_binding SET license_id=$1,token_sha256=$2,last_verified_at=$3 WHERE id=1",
      [licenseId, tokenHash, new Date().toISOString()]
    );
    lastToken = license.token;
  } catch (error) {
    console.debug("CpIPOS local machine binding check deferred", error);
  } finally {
    checking = false;
  }
}

function start() {
  const check = () => void checkBinding(false);
  window.addEventListener("cpipos:license-online-status", check);
  window.addEventListener("focus", check);
  const periodic = window.setInterval(check, PERIODIC_CHECK_MS);
  const first = window.setTimeout(() => void checkBinding(true), FIRST_CHECK_DELAY_MS);
  window.addEventListener("beforeunload", () => { stopped = true; window.clearInterval(periodic); window.clearTimeout(first); }, { once: true });
}

if (typeof window !== "undefined") start();