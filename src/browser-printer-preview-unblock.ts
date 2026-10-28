const BROWSER_SETTINGS_KEY = "cpipos.desktop.demo.settings";

type BrowserSettingsSnapshot = {
  printerSetupConfirmed?: boolean;
  printerName?: string;
  printerType?: string;
  printerConnectionStatus?: string;
  printerLastCheckedAt?: string;
  printerConnectionNote?: string;
};

const isTauriRuntime = () =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

const isLocalBrowserPreview = () =>
  typeof window !== "undefined" &&
  !isTauriRuntime() &&
  ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);

const unblockBrowserPrinterSetup = () => {
  if (!isLocalBrowserPreview() || typeof localStorage === "undefined") return;

  try {
    const raw = localStorage.getItem(BROWSER_SETTINGS_KEY);
    const current: BrowserSettingsSnapshot = raw ? JSON.parse(raw) : {};

    if (current.printerSetupConfirmed) return;

    localStorage.setItem(
      BROWSER_SETTINGS_KEY,
      JSON.stringify({
        ...current,
        printerSetupConfirmed: true,
        printerType: current.printerType || "windows-print-dialog",
        printerName: current.printerName || "Browser Preview Printer",
        printerConnectionStatus: "browser_preview",
        printerLastCheckedAt: new Date().toISOString(),
        printerConnectionNote:
          "Browser preview mode: ข้ามหน้าตั้งค่าเครื่องพิมพ์เพื่อให้ทดสอบ UI ที่ localhost:5173 ได้ โดยโปรแกรม Windows จริงยังต้องตั้งค่าเครื่องพิมพ์จากเมนูตั้งค่า",
      }),
    );
  } catch {
    // Never block app boot because of preview-only localStorage migration.
  }
};

unblockBrowserPrinterSetup();

export {};
