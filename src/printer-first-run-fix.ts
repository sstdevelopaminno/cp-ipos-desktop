import Database from "@tauri-apps/plugin-sql";

const FAST_PRINTER_MODE_KEY = "cpipos.printer.fastFirstSetup.v1";
const PRINTER_SETUP_NOTE_KEY = "cpipos.printer.firstSetupNote.v1";

type TauriInternals = {
  invoke?: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>;
  [key: string]: unknown;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

const nowIso = () => new Date().toISOString();

const isFastMode = () => localStorage.getItem(FAST_PRINTER_MODE_KEY) !== "0";

const patchPrinterInvoke = () => {
  const internals = window.__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== "function") return false;
  const current = internals.invoke as typeof internals.invoke & { __cpiposFastPrinterPatched?: boolean };
  if (current.__cpiposFastPrinterPatched) return true;
  const original = current.bind(internals);
  const patched = ((cmd: string, args?: unknown, options?: unknown) => {
    if (cmd === "list_windows_printers" && isFastMode()) {
      localStorage.setItem(PRINTER_SETUP_NOTE_KEY, "ข้ามการค้นหาเครื่องพิมพ์อัตโนมัติ เพื่อลดอาการค้างตอนติดตั้งรอบแรก");
      return Promise.resolve([]);
    }
    return original(cmd, args, options);
  }) as typeof current;
  patched.__cpiposFastPrinterPatched = true;
  internals.invoke = patched;
  return true;
};

const markPrinterSetupConfirmed = async () => {
  localStorage.setItem(PRINTER_SETUP_NOTE_KEY, "ยืนยันใช้งานโปรแกรมก่อน และตั้งค่าเครื่องพิมพ์ภายหลัง");
  try {
    const db = await Database.load("sqlite:cpipos.db");
    const rows: Array<[string, string]> = [
      ["printerSetupConfirmed", "true"],
      ["printerConnectionStatus", "skipped_first_setup"],
      ["printerConnectionNote", "ข้ามการค้นหาเครื่องพิมพ์ตอนติดตั้งรอบแรก สามารถกลับมาตั้งค่าเครื่องพิมพ์ภายหลังได้"],
      ["printerLastCheckedAt", nowIso()],
    ];
    for (const [key, value] of rows) {
      await db.execute("INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP", [key, value]);
    }
  } catch {
    try {
      const key = "cpipos.desktop.demo.settings";
      const settings = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({
        ...settings,
        printerSetupConfirmed: true,
        printerConnectionStatus: "skipped_first_setup",
        printerConnectionNote: "ข้ามการค้นหาเครื่องพิมพ์ตอนติดตั้งรอบแรก สามารถกลับมาตั้งค่าเครื่องพิมพ์ภายหลังได้",
        printerLastCheckedAt: nowIso(),
      }));
    } catch {
      // Ignore preview storage errors.
    }
  }
};

const textOf = (element: Element | null) => (element?.textContent || "").trim();

const enhancePrinterSetup = () => {
  const card = document.querySelector<HTMLElement>(".printer-required-card");
  if (!card) return;
  card.classList.add("printer-first-run-compact");
  if (card.dataset.fastPrinterEnhanced === "1") return;
  card.dataset.fastPrinterEnhanced = "1";

  const title = card.querySelector("h1");
  if (title && textOf(title).includes("เครื่องพิมพ์")) title.textContent = "ตั้งค่าเครื่องพิมพ์";
  const intro = card.querySelector("p");
  if (intro) intro.textContent = "เลือกเครื่องพิมพ์ได้ภายหลัง เพื่อลดปัญหาหน้าติดตั้งรอบแรกค้างหรือยาวเกินจอ";

  const status = document.createElement("p");
  status.className = "printer-first-run-status";
  status.textContent = localStorage.getItem(PRINTER_SETUP_NOTE_KEY) || "โหมดติดตั้งเร็ว: ยังไม่ค้นหาเครื่องพิมพ์อัตโนมัติ";
  card.appendChild(status);

  const actions = card.querySelector<HTMLElement>(".actions.modal-footer") || card;
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "secondary printer-first-run-skip";
  skip.textContent = "ใช้งานก่อน / ตั้งค่าเครื่องพิมพ์ภายหลัง";
  skip.addEventListener("click", async () => {
    skip.setAttribute("disabled", "true");
    skip.textContent = "กำลังบันทึก...";
    status.textContent = "กำลังบันทึกสถานะติดตั้งเร็ว...";
    await markPrinterSetupConfirmed();
    status.textContent = "บันทึกแล้ว กำลังเข้าโปรแกรม...";
    window.setTimeout(() => window.location.reload(), 500);
  });
  actions.insertBefore(skip, actions.firstChild);

  const slowScan = document.createElement("button");
  slowScan.type = "button";
  slowScan.className = "secondary printer-first-run-deep-scan";
  slowScan.textContent = "ค้นหาเครื่องพิมพ์แบบละเอียด";
  slowScan.addEventListener("click", () => {
    localStorage.setItem(FAST_PRINTER_MODE_KEY, "0");
    status.textContent = "เปิดโหมดค้นหาเครื่องพิมพ์จริงแล้ว กดตรวจเครื่องพิมพ์อีกครั้ง";
  });
  actions.insertBefore(slowScan, skip.nextSibling);
};

const start = () => {
  if (!patchPrinterInvoke()) {
    const timer = window.setInterval(() => {
      if (patchPrinterInvoke()) window.clearInterval(timer);
    }, 100);
    window.setTimeout(() => window.clearInterval(timer), 5000);
  }
  enhancePrinterSetup();
  const observer = new MutationObserver(() => window.requestAnimationFrame(enhancePrinterSetup));
  observer.observe(document.body, { childList: true, subtree: true });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

export {};
