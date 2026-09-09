import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

type LooseDb = {
  select?: (...args: unknown[]) => Promise<unknown>;
  execute?: (...args: unknown[]) => Promise<unknown>;
  __cpiposTimeoutPatched?: boolean;
};

type LooseDatabaseCtor = typeof Database & {
  load: (url: string) => Promise<LooseDb>;
  __cpiposStartupPatched?: boolean;
};

const STARTUP_GUARD_MS = 9500;
const DB_LOAD_TIMEOUT_MS = 7000;
const DB_QUERY_TIMEOUT_MS = 8000;
const STARTUP_RECOVERY_KEY = "cpipos.startup.recoveryShown.v1";
const FAST_PRINTER_MODE_KEY = "cpipos.printer.fastFirstSetup.v1";
const FREE_MODE_KEY = "cpipos.license.freeForever.enabled";

const textOf = (element: Element | null) => (element?.textContent || "").trim();

const timeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer = 0;
  return new Promise<T>((resolve, reject) => {
    timer = window.setTimeout(() => reject(new Error(label)), ms);
    promise.then(value => {
      window.clearTimeout(timer);
      resolve(value);
    }).catch(error => {
      window.clearTimeout(timer);
      reject(error);
    });
  });
};

const patchDbInstance = (db: LooseDb) => {
  if (db.__cpiposTimeoutPatched) return db;
  db.__cpiposTimeoutPatched = true;

  if (typeof db.select === "function") {
    const originalSelect = db.select.bind(db);
    db.select = (...args: unknown[]) => timeout(originalSelect(...args), DB_QUERY_TIMEOUT_MS, "DB_SELECT_TIMEOUT");
  }

  if (typeof db.execute === "function") {
    const originalExecute = db.execute.bind(db);
    db.execute = (...args: unknown[]) => timeout(originalExecute(...args), DB_QUERY_TIMEOUT_MS, "DB_EXECUTE_TIMEOUT");
  }

  return db;
};

const patchDatabaseLoad = () => {
  const SqlDatabase = Database as LooseDatabaseCtor;
  if (SqlDatabase.__cpiposStartupPatched) return;
  SqlDatabase.__cpiposStartupPatched = true;
  const originalLoad = SqlDatabase.load.bind(SqlDatabase);
  SqlDatabase.load = async (url: string) => {
    const db = await timeout(originalLoad(url), DB_LOAD_TIMEOUT_MS, "DB_LOAD_TIMEOUT");
    return patchDbInstance(db);
  };
};

const isStartupSplashStillVisible = () => {
  if (document.querySelector(".workspace, .login-card, .shift-card, .printer-required-card, .settings-page, .sales-screen")) return false;
  const splash = document.querySelector(".splash-card, .splash .splash-card");
  const text = textOf(splash);
  return Boolean(splash && text.includes("CpIPOS Desktop") && (text.includes("กำลัง") || text.includes("Loading") || text.includes("Preparing")));
};

const setRecoveryStatus = (message: string) => {
  const node = document.querySelector<HTMLElement>("[data-startup-recovery-status]");
  if (node) node.textContent = message;
};

const repairStartupState = async () => {
  setRecoveryStatus("กำลังซ่อมสถานะเริ่มต้น...");
  localStorage.setItem(FAST_PRINTER_MODE_KEY, "1");
  localStorage.setItem(FREE_MODE_KEY, "1");
  localStorage.setItem("cpipos.printer.firstSetupNote.v1", "เปิดโหมดติดตั้งเร็วเพื่อป้องกันค้างตอนค้นหาเครื่องพิมพ์");

  try {
    const db = await Database.load("sqlite:cpipos.db");
    if (typeof db.execute === "function") {
      await db.execute("DELETE FROM app_meta WHERE key='current_staff_id'");
      const rows: Array<[string, string]> = [
        ["printerSetupConfirmed", "true"],
        ["printerConnectionStatus", "skipped_first_setup"],
        ["printerConnectionNote", "ข้ามการค้นหาเครื่องพิมพ์ตอนติดตั้งรอบแรก สามารถตั้งค่าภายหลังได้"],
        ["programLicenseKey", "CPIPOS-FREE-FOREVER"],
        ["programLicenseStatus", "active"],
        ["programLicensePlan", "Free Forever"],
        ["programLicenseToken", "LOCAL-FREE-MODE"],
        ["remoteManagementEnabled", "false"],
      ];
      for (const [key, value] of rows) {
        await db.execute("INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value]);
      }
    }
    setRecoveryStatus("ซ่อมสถานะแล้ว กำลังเปิดโปรแกรมใหม่...");
  } catch {
    setRecoveryStatus("ซ่อมผ่านฐานข้อมูลไม่สำเร็จ แต่จะลองเปิดใหม่ในโหมดปลอดภัย...");
  }

  window.setTimeout(() => window.location.reload(), 650);
};

const showRecoveryPanel = () => {
  if (!isStartupSplashStillVisible()) return;
  const card = document.querySelector<HTMLElement>(".splash-card") || document.querySelector<HTMLElement>(".splash");
  if (!card || card.querySelector(".startup-recovery-panel")) return;

  void invoke("complete_startup_splash").catch(() => undefined);
  localStorage.setItem(STARTUP_RECOVERY_KEY, new Date().toISOString());

  const panel = document.createElement("div");
  panel.className = "startup-recovery-panel";
  panel.innerHTML = `<strong>โปรแกรมใช้เวลาตรวจสอบกะนานผิดปกติ</strong><small>ระบบจะไม่ปล่อยให้ค้างเงียบ ๆ ให้ลองเปิดใหม่ หรือซ่อม session/ตั้งค่าเครื่องพิมพ์รอบแรกโดยไม่ลบข้อมูลขาย</small><p data-startup-recovery-status>พร้อมกู้คืนการเริ่มต้น</p><div><button type="button" data-reload>ลองเปิดใหม่</button><button type="button" data-repair>ซ่อมแล้วเปิดใหม่</button></div>`;
  panel.querySelector("[data-reload]")?.addEventListener("click", () => window.location.reload());
  panel.querySelector("[data-repair]")?.addEventListener("click", () => void repairStartupState());
  card.appendChild(panel);
};

const start = () => {
  try { patchDatabaseLoad(); } catch { /* keep startup alive even if patching fails */ }
  window.setTimeout(showRecoveryPanel, STARTUP_GUARD_MS);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

export {};
