import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

const STORAGE_BUTTON_ID = "cpipos-storage-cleanup-button";
const BROWSER_KEYS = [
  "cpipos.desktop.demo.shift",
  "cpipos.desktop.demo.sales",
  "cpipos.desktop.demo.items",
  "cpipos.desktop.demo.audit",
  "cpipos.desktop.demo.stock",
  "cpipos.desktop.demo.session"
];
const PRODUCT_KEY = "cpipos.desktop.demo.products";
const SETTINGS_KEY = "cpipos.desktop.demo.settings";

const textOf = (element: Element | null) => (element?.textContent || "").trim();

function isStorageModal() {
  const title = textOf(document.querySelector(".modal header h2"));
  const body = document.querySelector<HTMLElement>(".modal .settings-modal-body");
  if (!body) return false;
  const bodyText = textOf(body);
  return title.includes("ข้อมูลและพื้นที่")
    || title.includes("Storage")
    || bodyText.includes("พื้นที่จัดเก็บ ฐานข้อมูล ยอดขาย และ audit")
    || (bodyText.includes("DB") && bodyText.includes("Media") && bodyText.includes("Sales") && bodyText.includes("Audit"));
}

function resetBrowserPreviewStorage() {
  for (const key of BROWSER_KEYS) localStorage.removeItem(key);

  try {
    const rawProducts = localStorage.getItem(PRODUCT_KEY);
    if (rawProducts) {
      const products = JSON.parse(rawProducts) as Array<Record<string, unknown>>;
      localStorage.setItem(PRODUCT_KEY, JSON.stringify(products.map(product => ({
        ...product,
        imagePath: undefined
      }))));
    }
  } catch {
    // Keep existing demo data if the local payload cannot be parsed.
  }

  try {
    const rawSettings = localStorage.getItem(SETTINGS_KEY);
    if (rawSettings) {
      const settings = JSON.parse(rawSettings) as Record<string, unknown>;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        ...settings,
        storeLogoPath: "",
        paymentQrImage: ""
      }));
    }
  } catch {
    // Keep existing settings if the local payload cannot be parsed.
  }
}

async function resetDesktopStorage() {
  const db = await Database.load("sqlite:cpipos.db");
  const statements = [
    "PRAGMA busy_timeout=5000",
    "DELETE FROM sale_items",
    "DELETE FROM sale_cancellations",
    "DELETE FROM stock_movements",
    "DELETE FROM sales",
    "DELETE FROM shifts",
    "DELETE FROM sync_queue",
    "DELETE FROM audit_events",
    "DELETE FROM app_meta WHERE key='current_staff_id'",
    "UPDATE products SET image_path=NULL, updated_at=CURRENT_TIMESTAMP"
  ];

  for (const sql of statements) {
    try {
      await db.execute(sql);
    } catch (error) {
      console.warn("CpIPOS storage cleanup skipped", sql, error);
    }
  }

  try {
    await db.execute("VACUUM");
  } catch (error) {
    console.warn("CpIPOS VACUUM skipped", error);
  }

  try {
    await invoke("clear_local_media_cache");
  } catch (error) {
    console.warn("CpIPOS media cleanup command is not available yet", error);
  }
}

async function resetStorage(button: HTMLButtonElement) {
  const confirmed = window.confirm(
    "ยืนยันล้างพื้นที่จัดเก็บ?\n\nระบบจะลบรายการขาย ประวัติใบเสร็จ audit กะขาย และตัดการอ้างอิงไฟล์ media เดิม โดยยังเก็บสินค้า พนักงาน และการตั้งค่าหลักไว้"
  );
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "กำลังล้างพื้นที่...";

  try {
    await resetDesktopStorage();
    resetBrowserPreviewStorage();
    window.dispatchEvent(new CustomEvent("cpipos:storage-cleaned"));
    window.alert("ล้างพื้นที่เรียบร้อย ระบบจะรีเฟรชหน้าเพื่อโหลดข้อมูลล่าสุด");
    window.location.reload();
  } catch (error) {
    console.error("CpIPOS storage cleanup failed", error);
    button.disabled = false;
    button.textContent = "ล้างพื้นที่";
    window.alert("ล้างพื้นที่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
  }
}

function injectStorageCleanupButton() {
  if (!isStorageModal()) return;

  const body = document.querySelector<HTMLElement>(".modal .settings-modal-body");
  const footer = body?.querySelector<HTMLElement>(".actions.modal-footer");
  if (!body || !footer || body.querySelector(`#${STORAGE_BUTTON_ID}`)) return;

  const panel = document.createElement("div");
  panel.className = "storage-cleanup-panel";
  panel.innerHTML = `
    <div>
      <strong>ล้างพื้นที่จัดเก็บในเครื่อง</strong>
      <small>ลบยอดขาย ประวัติใบเสร็จ audit กะขาย และตัดการอ้างอิงไฟล์ media เดิม โดยยังเก็บสินค้า พนักงาน และการตั้งค่าหลักไว้</small>
    </div>
  `;

  const button = document.createElement("button");
  button.id = STORAGE_BUTTON_ID;
  button.type = "button";
  button.className = "danger storage-cleanup-button";
  button.textContent = "ล้างพื้นที่";
  button.addEventListener("click", () => void resetStorage(button));

  panel.appendChild(button);
  body.insertBefore(panel, footer);
}

function startStorageCleanupRuntime() {
  const refresh = () => window.requestAnimationFrame(injectStorageCleanupButton);
  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startStorageCleanupRuntime, { once: true });
else startStorageCleanupRuntime();

export {};
