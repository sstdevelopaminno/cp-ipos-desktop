import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

type Row = Record<string, string | number | null | undefined>;
type Settings = {
  storeName: string;
  branchName: string;
  receiptHeader: string;
  receiptFooter: string;
  address: string;
  phone: string;
  taxId: string;
  storeLogoPath: string;
  printerName: string;
};
type ShiftInfo = { id: string; openedAt: string; openingCash: number };
type SaleInfo = {
  id: string;
  receiptNo: string;
  total: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  cashierName: string;
  itemsJson: string;
};
type ProductAgg = { name: string; quantity: number; total: number };

const SYSTEM_LOGO = "/icon.png";
const PRINT_WIDTH = 576;
const CUTTER_SAFE_FEED_PX = 180;
const textOf = (element: Element | null) => (element?.textContent || "").trim();
const moneyValue = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;
const money = (value: unknown) => `฿${moneyValue(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (value: unknown) => Math.round((Number(value) || 0) * 1000) / 1000;
const thaiDateTime = (iso?: string) => iso ? new Date(iso).toLocaleString("th-TH") : "-";
const defaults = (): Settings => ({ storeName: "CpIPOS Store", branchName: "Main Branch", receiptHeader: "CpIPOS", receiptFooter: "ขอบคุณที่ใช้บริการ", address: "", phone: "", taxId: "", storeLogoPath: "", printerName: "" });

const settingRows = (rows: Array<{ key: string; value: string }>) => {
  const map = new Map(rows.map(row => [row.key, row.value]));
  const base = defaults();
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
  };
};

const browserSettings = () => {
  try { return { ...defaults(), ...(JSON.parse(localStorage.getItem("cpipos.desktop.demo.settings") || "{}") as Partial<Settings>) }; }
  catch { return defaults(); }
};

const cashierFromUi = () => {
  const match = textOf(document.querySelector(".topbar-meta")).match(/แคชเชียร์:\s*([^สิทธิ์]+)/);
  return match?.[1]?.trim() || "ผู้ดูแลร้าน";
};

const readSqlite = async () => {
  const db = await Database.load("sqlite:cpipos.db");
  const settings = settingRows(await db.select<Array<{ key: string; value: string }>>("SELECT key,value FROM app_settings"));
  const shifts = await db.select<Row[]>("SELECT id,opened_at,opening_cash FROM shifts WHERE status='open' ORDER BY opened_at DESC LIMIT 1");
  const shift: ShiftInfo | null = shifts[0] ? { id: String(shifts[0].id || ""), openedAt: String(shifts[0].opened_at || ""), openingCash: Number(shifts[0].opening_cash || 0) } : null;
  const salesRows = shift
    ? await db.select<Row[]>("SELECT id,receipt_no,total,payment_method,status,created_at,cashier_name,employee_code,items_json FROM sales WHERE shift_id=$1 ORDER BY created_at ASC", [shift.id])
    : await db.select<Row[]>("SELECT id,receipt_no,total,payment_method,status,created_at,cashier_name,employee_code,items_json FROM sales WHERE created_at >= $1 ORDER BY created_at ASC", [new Date().toISOString().slice(0, 10) + "T00:00:00.000"]);
  const sales: SaleInfo[] = salesRows.map(row => ({
    id: String(row.id || ""),
    receiptNo: String(row.receipt_no || ""),
    total: Number(row.total || 0),
    paymentMethod: String(row.payment_method || ""),
    status: String(row.status || ""),
    createdAt: String(row.created_at || ""),
    cashierName: String(row.cashier_name || row.employee_code || ""),
    itemsJson: String(row.items_json || "[]"),
  }));
  return { settings, shift, sales, cashierName: sales.at(-1)?.cashierName || cashierFromUi(), closedAt: new Date().toISOString() };
};

const readBrowser = () => {
  let shift: ShiftInfo | null = null;
  let sales: SaleInfo[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem("cpipos.desktop.demo.shift") || "null") as Row | null;
    if (raw) shift = { id: String(raw.id || ""), openedAt: String(raw.openedAt || raw.opened_at || ""), openingCash: Number(raw.openingCash || raw.opening_cash || 0) };
  } catch { shift = null; }
  try {
    const rows = JSON.parse(localStorage.getItem("cpipos.desktop.demo.sales") || "[]") as Row[];
    sales = rows.map(row => ({ id: String(row.id || ""), receiptNo: String(row.receiptNo || row.receipt_no || ""), total: Number(row.total || 0), paymentMethod: String(row.paymentMethod || row.payment_method || ""), status: String(row.status || ""), createdAt: String(row.createdAt || row.created_at || ""), cashierName: String(row.cashierName || row.cashier_name || row.employeeCode || row.employee_code || ""), itemsJson: String(row.itemsJson || row.items_json || "[]") }));
  } catch { sales = []; }
  return { settings: browserSettings(), shift, sales, cashierName: cashierFromUi(), closedAt: new Date().toISOString() };
};

const loadData = async () => {
  try { return await readSqlite(); }
  catch { return readBrowser(); }
};

const parseItems = (sale: SaleInfo) => {
  try {
    const rows = JSON.parse(sale.itemsJson || "[]") as Array<{ name?: string; productId?: string; quantity?: number; unitPrice?: number; lineTotal?: number }>;
    return rows.map(row => ({ name: row.name || row.productId || "สินค้า", quantity: qty(row.quantity), total: moneyValue(row.lineTotal ?? (Number(row.quantity || 0) * Number(row.unitPrice || 0))) }));
  } catch { return []; }
};

const aggregateProducts = (sales: SaleInfo[]) => {
  const map = new Map<string, ProductAgg>();
  for (const sale of sales.filter(row => row.status === "completed")) {
    for (const item of parseItems(sale)) {
      const current = map.get(item.name) || { name: item.name, quantity: 0, total: 0 };
      current.quantity = qty(current.quantity + item.quantity);
      current.total = moneyValue(current.total + item.total);
      map.set(item.name, current);
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

function drawCentered(ctx: CanvasRenderingContext2D, text: string, y: number, font: string) {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.fillText(text, PRINT_WIDTH / 2, y);
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
  const data = await loadData();
  const printerName = data.settings.printerName?.trim();
  if (!printerName) {
    statusNode && (statusNode.textContent = "ยังไม่ได้ตั้งค่าเครื่องพิมพ์ จึงปิดกะโดยไม่พิมพ์สรุป");
    window.dispatchEvent(new CustomEvent("cpipos:shift-print-error", { detail: "PRINTER_NOT_CONFIGURED" }));
    return;
  }

  statusNode && (statusNode.textContent = "กำลังส่งงานพิมพ์ใบสรุปปิดกะ 80mm...");
  const completed = data.sales.filter(row => row.status === "completed");
  const cancelled = data.sales.filter(row => row.status === "cancelled");
  const total = moneyValue(completed.reduce((sum, row) => sum + row.total, 0));
  const cash = moneyValue(completed.filter(row => row.paymentMethod === "cash").reduce((sum, row) => sum + row.total, 0));
  const transfer = moneyValue(completed.filter(row => row.paymentMethod === "transfer").reduce((sum, row) => sum + row.total, 0));
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
  if (logo) { ctx.drawImage(logo, PRINT_WIDTH / 2 - 38, y - 36, 76, 76); y += 78; }
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
  drawPair(ctx, "เปิดกะ", thaiDateTime(data.shift?.openedAt), y); y += 32;
  drawPair(ctx, "ปิดกะ", thaiDateTime(data.closedAt), y); y += 32;
  drawPair(ctx, "เงินต้นกะ", money(data.shift?.openingCash || 0), y); y += 32;
  line(ctx, y); y += 42;
  drawPair(ctx, "จำนวนบิล", completed.length.toLocaleString("th-TH"), y, "bold 26px Tahoma, 'Segoe UI', sans-serif"); y += 38;
  drawPair(ctx, "ยอดขายรวม", money(total), y, "bold 30px Tahoma, 'Segoe UI', sans-serif"); y += 44;
  drawPair(ctx, "เงินสด", money(cash), y); y += 32;
  drawPair(ctx, "เงินโอน", money(transfer), y); y += 32;
  drawPair(ctx, "Void/ยกเลิก", `${cancelled.length.toLocaleString("th-TH")} บิล`, y); y += 36;
  line(ctx, y); y += 38;
  drawCentered(ctx, "สินค้าขายดี", y, "bold 24px Tahoma, 'Segoe UI', sans-serif"); y += 34;
  if (!products.length) { drawCentered(ctx, "ไม่มีรายละเอียดสินค้าในรอบกะนี้", y, "20px Tahoma, 'Segoe UI', sans-serif"); y += 34; }
  else {
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
    return settingRows(await db.select<Array<{ key: string; value: string }>>("SELECT key,value FROM app_settings"));
  } catch { return browserSettings(); }
};

const enhanceCloseShiftModal = async () => {
  const modal = document.querySelector<HTMLElement>(".modal");
  const title = textOf(modal?.querySelector("header h2") || null);
  if (!modal || !title.includes("สรุปก่อนปิดกะ")) return;
  modal.classList.add("shift-close-modern-modal");
  const firstBodyElement = modal.querySelector<HTMLElement>("header")?.nextElementSibling as HTMLElement | null;
  if (!firstBodyElement) return;
  let status = modal.querySelector<HTMLElement>("[data-shift-print-status]");
  if (!modal.querySelector(".shift-close-hero")) {
    const settings = await readSettingsPreview();
    const logo = settings.storeLogoPath || SYSTEM_LOGO;
    const hero = document.createElement("div");
    hero.className = "shift-close-hero";
    hero.innerHTML = `<div class="shift-close-logo-wrap"><img src="${logo}" alt="CpIPOS" /></div><div><span>Shift closing</span><strong>สรุปยอดก่อนปิดกะ</strong><small>ระบบจะพิมพ์ใบสรุป 80mm เมื่อกดปุ่มยืนยันปิดกะ หากไม่ได้ใส่โลโก้ร้านจะใช้โลโก้ระบบ CpIPOS อัตโนมัติ</small></div>`;
    hero.querySelector("img")?.addEventListener("error", event => { (event.currentTarget as HTMLImageElement).src = SYSTEM_LOGO; });
    modal.insertBefore(hero, firstBodyElement);
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

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startShiftCloseSummaryRuntime, { once: true });
else startShiftCloseSummaryRuntime();

export {};
