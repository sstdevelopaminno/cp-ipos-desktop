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
let checking = false;
let lastToken = "";
let stopped = false;

function runtime() {
  return (window as Window & { __CPIPOS_LICENSE_RUNTIME__?: LicenseRuntime }).__CPIPOS_LICENSE_RUNTIME__;
}

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function currentMachineId() {
  try {
    const system = await invoke<WindowsSystemHealth>("get_windows_system_health");
    return String(system.machineId || "").trim().toUpperCase();
  } catch { return ""; }
}

async function checkBinding() {
  if (checking || stopped) return;
  const license = runtime();
  if (!license || license.mode !== "licensed" || !license.token || !license.deviceCode) return;
  if (lastToken === license.token) return;
  checking = true;
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

    // A legitimate IT reissue for the same physical Windows machine is allowed.
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
  const check = () => void checkBinding();
  window.addEventListener("cpipos:license-online-status", check);
  window.addEventListener("focus", check);
  const timer = window.setInterval(check, 5000);
  window.setTimeout(check, 800);
  window.addEventListener("beforeunload", () => { stopped = true; window.clearInterval(timer); }, { once: true });
}

if (typeof window !== "undefined") start();
