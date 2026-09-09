import { invoke } from "@tauri-apps/api/core";
import type { Receipt } from "./domain/types";

type PrintableReceipt = Receipt & {
  subtotal?: number;
  discountAmount?: number;
  discountType?: "amount" | "percent";
  discountValue?: number;
};

const SYSTEM_LOGO = "/icon.png";
const moneyNumber = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n: number) => `฿${moneyNumber(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const paperWidth = (receipt: PrintableReceipt) => receipt.settings.printerPaperWidthMm === "58" ? 384 : 576;
const CUTTER_SAFE_FEED_PX = 180;
const paymentLabel = (method: Receipt["paymentMethod"]) => method === "cash" ? "เงินสด" : method === "transfer" ? "เงินโอน" : method === "promptpay" ? "พร้อมเพย์" : "บัตร";

const loadImage = (src: string) => new Promise<HTMLImageElement | null>(resolve => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = src;
});

function drawCentered(ctx: CanvasRenderingContext2D, text: string, y: number, font: string, width: number) {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.fillText(text, width / 2, y);
}

function drawPair(ctx: CanvasRenderingContext2D, left: string, right: string, y: number, width: number, font = "24px Tahoma, 'Segoe UI', sans-serif") {
  ctx.font = font;
  ctx.textAlign = "left";
  ctx.fillText(left, 32, y);
  ctx.textAlign = "right";
  ctx.fillText(right, width - 32, y);
}

function dashedLine(ctx: CanvasRenderingContext2D, y: number, width: number) {
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(32, y);
  ctx.lineTo(width - 32, y);
  ctx.stroke();
  ctx.restore();
}

function solidLine(ctx: CanvasRenderingContext2D, y: number, width: number) {
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(32, y);
  ctx.lineTo(width - 32, y);
  ctx.stroke();
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

async function printReceiptRasterNow(receipt: PrintableReceipt, printerName: string) {
  const width = paperWidth(receipt);
  const itemHeight = Math.max(1, receipt.items.length) * 74;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = 740 + itemHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_NOT_READY");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";

  let y = 54;
  const logo = await loadImage(receipt.settings.storeLogoPath || SYSTEM_LOGO);
  if (logo) {
    ctx.drawImage(logo, width / 2 - 35, y - 34, 70, 70);
    y += 72;
  }

  drawCentered(ctx, receipt.settings.receiptHeader || receipt.settings.storeName || "CpIPOS", y, "bold 32px Tahoma, 'Segoe UI', sans-serif", width);
  y += 34;
  drawCentered(ctx, receipt.settings.branchName || "Main Branch", y, "22px Tahoma, 'Segoe UI', sans-serif", width);
  y += 42;

  ctx.font = "18px Tahoma, 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`เลขที่ ${receipt.receiptNo}`, 32, y); y += 24;
  ctx.fillText(new Date(receipt.createdAt).toLocaleString("th-TH"), 32, y); y += 24;
  ctx.fillText(`พนักงาน ${receipt.cashierName || receipt.employeeCode || "-"}`, 32, y); y += 24;
  dashedLine(ctx, y, width); y += 36;

  for (const item of receipt.items) {
    ctx.font = "bold 22px Tahoma, 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(item.name, 32, y);
    ctx.textAlign = "right";
    ctx.fillText(money(item.lineTotal), width - 32, y);
    y += 28;
    ctx.font = "18px Tahoma, 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${item.quantity} x ${money(item.unitPrice)}`, 32, y);
    y += 34;
  }

  dashedLine(ctx, y, width); y += 38;
  const subtotal = receipt.subtotal ?? moneyNumber(receipt.items.reduce((sum, item) => sum + Math.max(0, Number(item.lineTotal || 0)), 0));
  const discountAmount = receipt.discountAmount ?? moneyNumber(Math.max(0, subtotal - Number(receipt.total || 0)));
  drawPair(ctx, "ยอดสินค้า", money(subtotal), y, width); y += 34;
  if (discountAmount > 0) { drawPair(ctx, "ส่วนลด", `-${money(discountAmount)}`, y, width); y += 34; }
  solidLine(ctx, y, width); y += 54;
  drawPair(ctx, "ยอดสุทธิ", money(receipt.total), y, width, "bold 34px Tahoma, 'Segoe UI', sans-serif"); y += 50;
  drawPair(ctx, "ชำระโดย", paymentLabel(receipt.paymentMethod), y, width); y += 32;
  drawPair(ctx, "รับเงิน", money(receipt.paid), y, width); y += 32;
  drawPair(ctx, "เงินทอน", money(receipt.changeAmount), y, width); y += 28;
  dashedLine(ctx, y, width); y += 36;
  drawCentered(ctx, receipt.settings.receiptFooter || "ขอบคุณที่ใช้บริการ", y, "20px Tahoma, 'Segoe UI', sans-serif", width);
  y += 44;

  await invoke("print_receipt_raster", { printerName, bytes: rasterBytes(canvas, y + CUTTER_SAFE_FEED_PX) });
}

export async function printReceiptNative(receipt: PrintableReceipt) {
  const printerName = receipt.settings.printerName?.trim();
  if (!printerName) throw new Error("PRINTER_NOT_CONFIGURED");

  window.setTimeout(() => {
    void printReceiptRasterNow(receipt, printerName).catch(error => {
      console.warn("CpIPOS receipt print failed", error);
      window.dispatchEvent(new CustomEvent("cpipos:receipt-print-error", { detail: error instanceof Error ? error.message : String(error) }));
    });
  }, 0);
}
