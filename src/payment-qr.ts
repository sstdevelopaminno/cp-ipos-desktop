import type { AppSettings } from "./domain/types";

const PROMPTPAY_ID_PATTERN = /^\d{9,15}$/;

export type PaymentQrMode = "promptpay_online" | "bank_image_offline" | "unavailable";

export type ResolvedPaymentQr = {
  ready: boolean;
  mode: PaymentQrMode;
  src: string;
  label: string;
  promptPayId: string;
};

export function normalizePromptPayId(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 15);
}

export function isValidPromptPayId(value: string | null | undefined) {
  return PROMPTPAY_ID_PATTERN.test(normalizePromptPayId(value));
}

export function buildPromptPayQrUrl(promptPayId: string | null | undefined, amount: number) {
  const id = normalizePromptPayId(promptPayId);
  const numericAmount = Number(amount);
  if (!PROMPTPAY_ID_PATTERN.test(id) || !Number.isFinite(numericAmount) || numericAmount <= 0) return "";
  return `https://promptpay.io/${id}/${numericAmount.toFixed(2)}`;
}

export function maskPromptPayId(value: string | null | undefined) {
  const id = normalizePromptPayId(value);
  if (id.length <= 4) return id;
  return `${id.slice(0, 3)}••••${id.slice(-3)}`;
}

export function resolvePaymentQr(settings: AppSettings, amount: number, online = navigator.onLine): ResolvedPaymentQr {
  if (settings.paymentQrEnabled === false) {
    return { ready: false, mode: "unavailable", src: "", label: "", promptPayId: "" };
  }

  const promptPayId = normalizePromptPayId(settings.paymentQrPromptPayId);
  if (online && PROMPTPAY_ID_PATTERN.test(promptPayId)) {
    const src = buildPromptPayQrUrl(promptPayId, amount);
    if (src) {
      return {
        ready: true,
        mode: "promptpay_online",
        src,
        label: settings.paymentQrAccountName || "PromptPay",
        promptPayId,
      };
    }
  }

  const bankImage = String(settings.paymentQrImage ?? "").trim();
  if (bankImage) {
    return {
      ready: true,
      mode: "bank_image_offline",
      src: bankImage,
      label: settings.paymentQrAccountName || "Bank QR",
      promptPayId,
    };
  }

  return { ready: false, mode: "unavailable", src: "", label: "", promptPayId };
}
