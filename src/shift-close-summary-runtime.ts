import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

type SettingRow = { key: string; value: string };
type ShiftRow = { id: string; opened_at?: string | null; opening_cash?: number | null };
type SaleRow = {
  id: string;
  receipt_no: string;
  total: number;
  paid?: number | null;
  change_amount?: number | null;
  payment_method: string;
  status: string;
  created_at: string;
  cashier_name?: string | null;
  employee_code?: string | null;
  items_json?: string | null;
};
type AppSettingsLite = {
  storeName: string;
  branchName: string;
  receiptHeader: string;
  receiptFooter: string;
  address: string;
  phone: string;
  taxId: string;
  storeLogoPath: string;
  printerName: string;
  printerPaperWidthMm: string;
};
type ProductAgg = { name: string; quantity: number; total: number };
type ShiftPrintData = {
  settings: AppSettingsLite;
  shift: ShiftRow | null;
  sales: SaleRow[];
  cashierName: string;
  closedAt: string;
  source: "sqlite" | "browser";
};

const SYSTEM_LOGO = "/icon.png";
const PRINT_WIDTH = 576;
const CUTTER_SAFE_FEED_PX = 180;
const textOf = (element: Element | null) => (element?.textContent || "").trim();
const moneyValue = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;
const money = (value: unknown) => `฿${moneyValue(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (value: unknown) => Math.round((Number(value) || 0) * 1000) / 1000;
const thaiDateTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString("th-TH") : "-";

const defaultSettings = (): AppSettingsLite => ({
  storeName: "CpIPOS Store",
  branchName: "Main Branch",
  receiptHeader: "CpIPOS",
  receiptFooter: "ขอบคุณที่ใช้บริการ",
  address: "",
  phone: "",
  taxId: "",
  storeLogoPath: "",
  printerName: "",
  printerPaperWidthMm: "80",
});

const rowsToSettings = (rows: SettingRow[]) => {
  const map = new Map(rows.map(row => [row.key, row.value]));
  const base = defaultSettings();
  return {
    ...base,
    storeName: map.get("storeName") || base.storeName,
    branchName: map.get("branchName") || base.branchName,
    receiptHeader: map.get("receiptHeader") || base.receiptHeader,
    receiptFooter: map.get("receiptFooter") || base.receiptFooter,
    address: map.get("address") || "",
    phone: map.get("phone") || "",
    taxId: map.get("taxId") || "",
    storeLogoPath: map.get("storeLogoPath") || "",
    printerName: map.get("printerName") || "",
    printerPaperWidthMm: "80",
  };
};

const getBrowserSettings = () => {
  try {
    const saved = JSON.parse(localStorage.getItem("cpipos.desktop.demo.settings") || "{}") as Partial<AppSettingsLite>;
    return { ...defaultSettings(), ...saved, printerPaperWidthMm: "80" };
  } catch {
    return defaultSettings();
  }
};

const getCashierNameFromUi = () => {
  const topbar = textOf(document.querySelector(".topbar-meta"));
  const match = topbar.match(/แคชเชียร์:\s*([^สิทธิ์]+)/);
  return match?.[1]?.trim() || "ผู้ดูแลร้าน";
};

const loadShiftPrintData = async (): Promise<ShiftPrintData> => {
  const closedAt = new Date().toISOString();
  try {
    const db = await Database.load("sqlite:cpipos.db");
    const settings = rowsToSettings(await db.select<SettingRow[]>("SELECT key,value FROM app_settings"));
    const shifts = await db.select<ShiftRow[]>("SELECT id,opened_at,opening_cash FROM shifts WHERE status='open' ORDER BY opened_at DESC LIMIT 1");
    const shift = shifts[0] || null;
    const sales = shift
      ? await db.select<SaleRow[]>("SELECT id,receipt_no,total,paid,change_amount,payment_method,status,created_at,cashier_name,employee_code,items_json FROM sales WHERE shift_id=$1 ORDER BY created_at ASC", [shift.id])
      : await db.select<SaleRow[]>("SELECT id,receipt_no,total,paid,change_amount,payment_method,status,created_at,cashier_name,employee_code,items_json FROM sales WHERE created_at >= $1 ORDER BY created_at ASC", [new Date().toISOString().slice(0, 10) + "T00:00:00.000"]);
    return { settings, shift, sales, cashierName: sales.at(-1)?.cashier_name || getCashierNameFromUi(), closedAt, source: "sqlite" };
  } catch {
    let settings = getBrowserSettings();
    let shift: ShiftRow | null = null;
    let sales: SaleRow[] = [];
    try { shift = JSON.parse(localStorage.getItem("cpipos.desktop.demo.shift") || "null") as ShiftRow | null; } catch { shift = null; }
    try { sales = JSON.parse(localStorage.getItem("cpipos.desktop.demo.sales") || "[]") as SaleRow[]; } catch { sales = []; }
    settings = { ...settings, printerPaperWidthMm: "80" };
    return { settings, shift, sales: shift?.id ? sales.filter(sale => sale.shift_id === shift?.id || sale.shiftId === shift?.id) : sales, cashierName: getCashierNameFromUi(), closedAt, source: "browser" };
  }
};

const parseItems = (sale: SaleRow) => {
  try {
    const rows = JSON.parse(sale.items_json || "[]") as Array<{ name?: string; productId?: string; quantity?: number; unitPrice?: number; lineTotal?: number }>;
    return rows.map(row => ({ name: row.name || row.productId || "สินค้า", quantity: qty(row.quantity || 0), total: moneyValue(row.lineTotal ?? (Number(row.quantity || 0) * Number(row.unitPrice || 0))) }));
  } catch {
    return [];
  }
};

const aggregateProducts = (sales: SaleRow[]) => {
  const map = new Map<string, ProductAgg>();
  for (const sale of sales.filter(row => row.status === "completed")) {
    for (const item of parseItems(sale)) {
      const row = map.get(item.name) || { name: item.name, quantity: 0, total: 0 };
      row.quantity = qty(row.quantity + item.quantity);
      row.total = moneyValue(row.total + item.total);
      map.set(item.name, row);
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5);
};

const loadImage = (src: string) => new Promise<HTMLImageElement | null>(resolve => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = src || SYSTEM_LOGO;
});

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words.length ? words : [text]) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) { line = next; continue; }
    if (line) lines.push(line);
    if (ctx.measureText(word).width <= maxWidth) { line = word; continue; }
    let chunk = "";
    for (const char of word) {
      const nextChunk = chunk + char;
      if (ctx.measureText(nextChunk).width > maxWidth && chunk) { lines.push(chunk); chunk = char; }
      else chunk = nextChunk;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

function drawCentered(ctx: CanvasRenderingContext2D, text: string, y: number, font: string, width = PRINT_WIDTH) {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.fillText(text, width / 2, y);
}

function drawWrappedCentered(ctx: CanvasRenderingContext2D, text: string, y: number, font: string, lineHeight = 24) {
  ctx.font = font;
  ctx.textAlign = "center";
  for (const line of wrapText(ctx, text, PRINT_WIDTH - 64)) {
    ctx.fillText(line, PRINT_WIDTH / 2, y);
    y += lineHeight;
  }
  return y;
}

function drawPair(ctx: CanvasRenderingContext2D, left: string, right: string, y: number, font = "24px Tahoma, 'Segoe UI', sans-serif") {
  ctx.font = font;
  ctx.textAlign = "left";
  ctx.fillText(left, 32, y);
  ctx.textAlign = "right";
  ctx.fillText(right, PRINT_WIDTH - 32, y);
}

function line(ctx: CanvasRenderingContext2D, y: number, dashed = true) {
  ctx.save();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  if (dashed) ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(32, y);
  ctx.lineTo(PRINT_WIDTH - 32, y);
  ctx.stroke();
  ctx.restore();
}

function rasterBytes(canvas: HTMLCanvasElement, usedHeight: number) {
  const width = canvas.width;
  const height = Math.min(canvas.height, Math.ceil(usedHeight));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_NOT_READY");
  const image = ctx.getImageData(0, 0, width, height).data;
  const widthBytes = Math.ceil(width / 8);
  const data: number[] = [0x1d, 0x76, 0x30, 0x00, widthBytes & 0xff, (widthBytes >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff];
  for (let y = 0; y < height; y += 1) {
    for (let xb = 0; xb < widthBytes; xb += 1) {
      let b = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const x = xb * 8 + bit;
        if (x >= width) continue;
        const i = (y * width + x) * 4;
        const alpha = image[i + 3];
        const lum = image[i] * 0.299 + image[i + 1] * 0.587 + image[i + 2] * 0.114;
        if (alpha > 80 && lum < 245) b |= 0x80 >> bit;
      }
      data.push(b);
    }
  }
  return data;
}

const printCloseShiftSummary = async (statusNode?: HTMLElement | null) => {
  const data = await loadShiftPrintData();
  const printerName = data.settings.printerName?.trim();
  if (!printerName) {
    statusNode && (statusNode.textContent = "ยังไม่ได้ตั้งค่าเครื่องพิมพ์ จึงปิดกะโดยไม่พิมพ์สรุป");
    window.dispatchEvent(new CustomEvent("cpipos:shift-print-error", { detail: "PRINTER_NOT_CONFIGURED" }));
    return;
  }

  statusNode && (statusNode.textContent = "กำลังส่งงานพิมพ์ใบสรุปปิดกะ 80mm...");
  const completed = data.sales.filter(row => row.status === "completed");
  const cancelled = data.sales.filter(row => row.status === "cancelled");
  const total = moneyValue(completed.reduce((sum, row) => sum + Number(row.total || 0), 0));
  const cash = moneyValue(completed.filter(row => row.payment_method === "cash").reduce((sum, row) => sum + Number(row.total || 0), 0));
  const transfer = moneyValue(completed.filter(row => row.payment_method === "transfer").reduce((sum, row) => sum + Number(row.total || 0), 0));
  const products = aggregateProducts(data.sales);
  const canvas = document.createElement("canvas");
  canvas.width = PRINT_WIDTH;
  canvas.height = 980 + products.length * 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_NOT_READY");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";

  let y = 52;
  const logo = await loadImage(data.settings.storeLogoPath || SYSTEM_LOGO);
  if (logo) {
    ctx.drawImage(logo, PRINT_WIDTH / 2 - 38, y - 36, 76, 76);
    y += 78;
  }
  drawCentered(ctx, data.settings.receiptHeader || data.settings.storeName || "CpIPOS", y, "bold 34px Tahoma, 'Segoe UI', sans-serif"); y += 36;
  drawCentered(ctx, data.settings.branchName || "Main Branch", y, "22px Tahoma, 'Segoe UI', sans-serif"); y += 28;
  if (data.settings.address) y = drawWrappedCentered(ctx, data.settings.address, y, "18px Tahoma, 'Segoe UI', sans-serif", 24);
  if (data.settings.phone) { drawCentered(ctx, `โทร ${data.settings.phone}`, y, "18px Tahoma, 'Segoe UI', sans-serif"); y += 24; }
  if (data.settings.taxId) { drawCentered(ctx, `เลขผู้เสียภาษี ${data.settings.taxId}`, y, "18px Tahoma, 'Segoe UI', sans-serif"); y += 24; }
  y += 14;
  line(ctx, y); y += 36;
  drawCentered(ctx, "ใบสรุปก่อนปิดกะ", y, "bold 30px Tahoma, 'Segoe UI', sans-serif"); y += 42;
  drawPair(ctx, "กะ", data.shift?.id ? data.shift.id.slice(0, 8) : "-", y); y += 32;
  drawPair(ctx, "แคชเชียร์", data.cashierName || "-", y); y += 32;
  drawPair(ctx, "เปิดกะ", thaiDateTime(data.shift?.opened_at), y); y += 32;
  drawPair(ctx, "ปิดกะ", thaiDateTime(data.closedAt), y); y += 32;
  drawPair(ctx, "เงินต้นกะ", money(data.shift?.opening_cash || 0), y); y += 32;
  line(ctx, y); y += 42;
  drawPair(ctx, "จำนวนบิล", completed.length.toLocaleString("th-TH"), y, "bold 26px Tahoma, 'Segoe UI', sans-serif"); y += 38;
  drawPair(ctx, "ยอดขายรวม", money(total), y, "bold 30px Tahoma, 'Segoe UI', sans-serif"); y += 44;
  drawPair(ctx, "เงินสด", money(cash), y); y += 32;
  drawPair(ctx, "เงินโอน", money(transfer), y); y += 32;
  drawPair(ctx, "Void/ยกเลิก", `${cancelled.length.toLocaleString("th-TH")} บิล`, y); y += 36;
  line(ctx, y); y += 38;
  drawCentered(ctx, "สินค้าขายดี", y, "bold 24px Tahoma, 'Segoe UI', sans-serif"); y += 34;
  if (!products.length) {
    drawCentered(ctx, "ไม่มีรายละเอียดสินค้าในรอบกะนี้", y, "20px Tahoma, 'Segoe UI', sans-serif"); y += 34;
  } else {
    for (const item of products) {
      ctx.font = "bold 21px Tahoma, 'Segoe UI', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(item.name.slice(0, 28), 32, y);
      ctx.textAlign = "right";
      ctx.fillText(money(item.total), PRINT_WIDTH - 32, y);
      y += 28;
      drawPair(ctx, "จำนวน", item.quantity.toLocaleString("th-TH"), y, "18px Tahoma, 'Segoe UI', sans-serif");
      y += 28;
    }
  }
  line(ctx, y); y += 36;
  drawCentered(ctx, "หลังปิดกะ ระบบจะกลับไปหน้าเข้าสู่ระบบ", y, "20px Tahoma, 'Segoe UI', sans-serif"); y += 34;
  drawCentered(ctx, data.settings.receiptFooter || "ขอบคุณที่ใช้บริการ", y, "20px Tahoma, 'Segoe UI', sans-serif"); y += 44;

  await invoke("print_receipt_raster", { printerName, bytes: rasterBytes(canvas, y + CUTTER_SAFE_FEED_PX) });
  statusNode && (statusNode.textContent = "ส่งงานพิมพ์ใบสรุปปิดกะแล้ว");
};

const readSettingsPreview = async () => {
  try {
    const db = await Database.load("sqlite:cpipos.db");
    return rowsToSettings(await db.select<SettingRow[]>("SELECT key,value FROM app_settings"));
  } catch {
    return getBrowserSettings();
  }
};

const enhanceCloseShiftModal = async () => {
  const modal = document.querySelector<HTMLElement>(".modal");
  const title = textOf(modal?.querySelector("header h2") || null);
  if (!modal || !title.includes("สรุปก่อนปิดกะ")) return;
  modal.classList.add("shift-close-modern-modal");
  const contentRoot = modal.querySelector<HTMLElement>("header")?.nextElementSibling as HTMLElement | null;
  if (!contentRoot) return;
  let status = modal.querySelector<HTMLElement>("[data-shift-print-status]");
  if (!modal.querySelector(".shift-close-hero")) {
    const settings = await readSettingsPreview();
    const logo = settings.storeLogoPath || SYSTEM_LOGO;
    const hero = document.createElement("div");
    hero.className = "shift-close-hero";
    hero.innerHTML = `<div class="shift-close-logo-wrap"><img src="${logo}" alt="CpIPOS" /></div><div><span>Shift closing</span><strong>สรุปยอดก่อนปิดกะ</strong><small>ระบบจะพิมพ์ใบสรุป 80mm เมื่อกดปุ่มยืนยันปิดกะ หากไม่ได้ใส่โลโก้ร้านจะใช้โลโก้ระบบ CpIPOS อัตโนมัติ</small></div>`;
    hero.querySelector("img")?.addEventListener("error", event => { (event.currentTarget as HTMLImageElement).src = SYSTEM_LOGO; });
    modal.insertBefore(hero, contentRoot);
  }
  if (!status) {
    status = document.createElement("p");
    status.dataset.shiftPrintStatus = "1";
    status.className = "shift-close-print-status";
    status.textContent = "พร้อมพิมพ์ใบสรุปปิดกะ 80mm";
    const actions = modal.querySelector(".actions");
    actions?.parentElement?.insertBefore(status, actions);
  }
  const confirmButton = Array.from(modal.querySelectorAll<HTMLButtonElement>(".actions button")).find(button => !button.classList.contains("secondary"));
  if (confirmButton && !confirmButton.dataset.shiftClosePrintBound) {
    confirmButton.dataset.shiftClosePrintBound = "1";
    confirmButton.textContent = "พิมพ์สรุป + ยืนยันปิดกะ";
    confirmButton.addEventListener("click", () => {
      if (confirmButton.dataset.shiftClosePrinted === "1") return;
      confirmButton.dataset.shiftClosePrinted = "1";
      const currentStatus = modal.querySelector<HTMLElement>("[data-shift-print-status]");
      window.setTimeout(() => {
        void printCloseShiftSummary(currentStatus).catch(error => {
          const message = error instanceof Error ? error.message : String(error);
          currentStatus && (currentStatus.textContent = `พิมพ์ใบสรุปไม่สำเร็จ: ${message}`);
          window.dispatchEvent(new CustomEvent("cpipos:shift-print-error", { detail: message }));
        });
      }, 0);
    }, true);
  }
};

const startShiftCloseSummaryRuntime = () => {
  void enhanceCloseShiftModal();
  const observer = new MutationObserver(() => window.requestAnimationFrame(() => { void enhanceCloseShiftModal(); }));
  observer.observe(document.body, { childList: true, subtree: true });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startShiftCloseSummaryRuntime, { once: true });
} else {
  startShiftCloseSummaryRuntime();
}

export {};
