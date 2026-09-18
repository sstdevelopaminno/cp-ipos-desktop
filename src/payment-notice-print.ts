import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, CartLine, Staff } from "./domain/types";
import type { PaymentQrMode } from "./payment-qr";
import { enqueueNativePrintJob } from "./receipt-print";

const SYSTEM_LOGO = "/icon.png";
const CUTTER_SAFE_FEED_PX = 190;

export type PaymentNoticePrintInput = {
  settings: AppSettings;
  staff: Staff;
  tableCode?: string | null;
  billNo: string;
  items: CartLine[];
  total: number;
  qrSrc: string;
  fallbackQrSrc?: string;
  qrMode: PaymentQrMode;
};

const money = (value: number) =>
  `฿${Number(value || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const paperWidth = (settings: AppSettings) => settings.printerPaperWidthMm === "58" ? 384 : 576;

const loadImage = (src: string, anonymous = false) => new Promise<HTMLImageElement | null>(resolve => {
  if (!src) { resolve(null); return; }
  const image = new Image();
  if (anonymous) image.crossOrigin = "anonymous";
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = src;
});

async function loadRasterSafeImage(src: string) {
  if (!src) return null;
  const remote = /^https?:\/\//i.test(src);
  const image = await loadImage(src, remote);
  if (!image) return null;

  const probe = document.createElement("canvas");
  probe.width = 2;
  probe.height = 2;
  const ctx = probe.getContext("2d");
  if (!ctx) return null;

  try {
    ctx.drawImage(image, 0, 0, 2, 2);
    ctx.getImageData(0, 0, 1, 1);
    return image;
  } catch {
    return null;
  }
}

async function resolveQrImage(primary: string, fallback?: string) {
  const direct = await loadRasterSafeImage(primary);
  if (direct) return { image: direct, usedFallback: false };
  if (fallback && fallback !== primary) {
    const backup = await loadRasterSafeImage(fallback);
    if (backup) return { image: backup, usedFallback: true };
  }
  return { image: null, usedFallback: false };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const value = String(text || "").trim();
  if (!value) return [] as string[];
  const lines: string[] = [];
  let current = "";
  for (const char of value) {
    const next = current + char;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawCentered(ctx: CanvasRenderingContext2D, text: string, y: number, font: string, width: number) {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.fillText(text, width / 2, y);
}

function drawPair(ctx: CanvasRenderingContext2D, left: string, right: string, y: number, width: number, font = "22px Tahoma, 'Segoe UI', sans-serif") {
  ctx.font = font;
  ctx.textAlign = "left";
  ctx.fillText(left, 30, y);
  ctx.textAlign = "right";
  ctx.fillText(right, width - 30, y);
}

function dashedLine(ctx: CanvasRenderingContext2D, y: number, width: number) {
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(30, y);
  ctx.lineTo(width - 30, y);
  ctx.stroke();
  ctx.restore();
}

function solidLine(ctx: CanvasRenderingContext2D, y: number, width: number) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(30, y);
  ctx.lineTo(width - 30, y);
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
  const data: number[] = [
    0x1d, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ];

  for (let y = 0; y < height; y += 1) {
    for (let xb = 0; xb < widthBytes; xb += 1) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const x = xb * 8 + bit;
        if (x >= width) continue;
        const index = (y * width + x) * 4;
        const alpha = image[index + 3];
        const luminance = image[index] * 0.299 + image[index + 1] * 0.587 + image[index + 2] * 0.114;
        if (alpha > 80 && luminance < 245) byte |= 0x80 >> bit;
      }
      data.push(byte);
    }
  }

  return data;
}

async function printPaymentNoticeRasterNow(input: PaymentNoticePrintInput, printerName: string) {
  const width = paperWidth(input.settings);
  const qrSize = width === 384 ? 218 : 292;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = 1700 + input.items.length * 110;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_NOT_READY");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";

  let y = 54;
  const logo = await loadImage(input.settings.storeLogoPath || SYSTEM_LOGO);
  if (logo) {
    ctx.drawImage(logo, width / 2 - 34, y - 34, 68, 68);
    y += 72;
  }

  drawCentered(ctx, input.settings.storeName || "CpIPOS Store", y, "bold 30px Tahoma, 'Segoe UI', sans-serif", width);
  y += 33;
  drawCentered(ctx, input.settings.branchName || "Main Branch", y, "21px Tahoma, 'Segoe UI', sans-serif", width);
  y += 28;
  dashedLine(ctx, y, width);
  y += 35;

  drawCentered(ctx, "ใบแจ้งชำระเงิน", y, "bold 30px Tahoma, 'Segoe UI', sans-serif", width);
  y += 30;
  drawCentered(ctx, "PAYMENT NOTICE / รอชำระ", y, "18px Tahoma, 'Segoe UI', sans-serif", width);
  y += 35;

  drawPair(ctx, "ผู้ขาย", input.staff.displayName || input.staff.code, y, width, "18px Tahoma, 'Segoe UI', sans-serif");
  y += 25;
  if (input.tableCode) {
    drawPair(ctx, "โต๊ะ", input.tableCode, y, width, "18px Tahoma, 'Segoe UI', sans-serif");
    y += 25;
  }
  drawPair(ctx, "เลขที่บิล", input.billNo, y, width, "18px Tahoma, 'Segoe UI', sans-serif");
  y += 25;
  drawPair(ctx, "วันที่", new Date().toLocaleString("th-TH"), y, width, "18px Tahoma, 'Segoe UI', sans-serif");
  y += 28;
  dashedLine(ctx, y, width);
  y += 34;

  for (const item of input.items) {
    ctx.font = "bold 20px Tahoma, 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    const name = item.nameTh || item.name || item.productCode || "สินค้า";
    const nameLines = wrapText(ctx, name, width - 178);
    nameLines.slice(0, 2).forEach((line, index) => {
      ctx.fillText(line, 30, y + index * 24);
    });
    ctx.textAlign = "right";
    ctx.fillText(money(Number(item.price) * Number(item.quantity)), width - 30, y);
    y += Math.max(26, nameLines.slice(0, 2).length * 24);
    ctx.font = "17px Tahoma, 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${item.quantity} x ${money(item.price)}`, 30, y);
    y += 31;
  }

  dashedLine(ctx, y, width);
  y += 40;
  drawPair(ctx, "ยอดที่ต้องชำระ", money(input.total), y, width, "bold 30px Tahoma, 'Segoe UI', sans-serif");
  y += 24;
  solidLine(ctx, y, width);
  y += 34;

  const qr = await resolveQrImage(input.qrSrc, input.fallbackQrSrc);
  if (!qr.image) throw new Error("PAYMENT_QR_PRINT_UNAVAILABLE");

  const qrX = Math.round((width - qrSize) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#fff";
  ctx.fillRect(qrX - 8, y - 8, qrSize + 16, qrSize + 16);
  ctx.drawImage(qr.image, qrX, y, qrSize, qrSize);
  y += qrSize + 31;

  drawCentered(
    ctx,
    qr.usedFallback || input.qrMode === "bank_image_offline" ? "สแกน QR ธนาคารเพื่อชำระเงิน" : "สแกน PromptPay QR เพื่อชำระเงิน",
    y,
    "bold 20px Tahoma, 'Segoe UI', sans-serif",
    width,
  );
  y += 36;
  drawCentered(ctx, money(input.total), y, "bold 34px Tahoma, 'Segoe UI', sans-serif", width);
  y += 35;

  if (input.settings.paymentQrAccountName) {
    drawCentered(ctx, input.settings.paymentQrAccountName, y, "18px Tahoma, 'Segoe UI', sans-serif", width);
    y += 25;
  }
  if (input.settings.paymentQrNote) {
    const noteLines = wrapText(ctx, input.settings.paymentQrNote, width - 60).slice(0, 3);
    for (const line of noteLines) {
      drawCentered(ctx, line, y, "16px Tahoma, 'Segoe UI', sans-serif", width);
      y += 22;
    }
  }

  y += 4;
  dashedLine(ctx, y, width);
  y += 30;
  drawCentered(ctx, "ใบแจ้งนี้ใช้สำหรับชำระเงินเท่านั้น", y, "16px Tahoma, 'Segoe UI', sans-serif", width);
  y += 22;
  drawCentered(ctx, "ยังไม่ใช่ใบเสร็จรับเงิน", y, "16px Tahoma, 'Segoe UI', sans-serif", width);
  y += 30;

  await invoke("print_receipt_raster", {
    printerName,
    bytes: rasterBytes(canvas, y + CUTTER_SAFE_FEED_PX),
  });
}

export function printPaymentNoticeNative(input: PaymentNoticePrintInput) {
  const printerName = input.settings.printerName?.trim();
  if (!printerName) return Promise.reject(new Error("PRINTER_NOT_CONFIGURED"));
  if (!input.qrSrc) return Promise.reject(new Error("PAYMENT_QR_NOT_READY"));

  return enqueueNativePrintJob(() => printPaymentNoticeRasterNow(input, printerName)).catch(error => {
    console.warn("CpIPOS payment notice print failed", error);
    window.dispatchEvent(new CustomEvent("cpipos:payment-notice-print-error", {
      detail: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  });
}
