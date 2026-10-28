const DRAFT_KEY_PREFIX = "cpipos.sales.draft.v1";
const DRAFT_INDEX_KEY = "cpipos.sales.draft.index.v1";
const CLEAR_UNTIL_KEY = "cpipos.sales.draft.clearUntil.v1";
const SUPPRESS_MS = 30_000;

const textOf = (node: Element | null) => (node?.textContent || "").replace(/\s+/g, " ").trim();
const isDraftKey = (key: string) => key === DRAFT_INDEX_KEY || key.startsWith(`${DRAFT_KEY_PREFIX}.`);

const writeRaw = (key: string, value: string) => {
  try { window.localStorage.setItem(key, value); } catch { /* keep guard non-blocking */ }
};

const readSuppressUntil = () => {
  try {
    const raw = window.sessionStorage.getItem(CLEAR_UNTIL_KEY) || window.localStorage.getItem(CLEAR_UNTIL_KEY);
    const parsed = raw ? JSON.parse(raw) as { until?: number } : null;
    return Number(parsed?.until || 0);
  } catch {
    return 0;
  }
};

const isSuppressed = () => Date.now() < readSuppressUntil();

const clearDraftStorage = () => {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (isDraftKey(key)) window.localStorage.removeItem(key);
    }
    window.localStorage.setItem(DRAFT_INDEX_KEY, "[]");
  } catch {
    // localStorage may be locked in a browser preview; never block POS flow.
  }
};

const suppressDraftRestore = (reason: string, ms = SUPPRESS_MS) => {
  const payload = JSON.stringify({ reason, until: Date.now() + ms, at: new Date().toISOString() });
  try { window.sessionStorage.setItem(CLEAR_UNTIL_KEY, payload); } catch { /* noop */ }
  writeRaw(CLEAR_UNTIL_KEY, payload);
  clearDraftStorage();
  window.setTimeout(clearDraftStorage, 250);
  window.setTimeout(clearDraftStorage, 900);
  window.setTimeout(clearDraftStorage, 2_500);
};

const patchDraftWrites = () => {
  try {
    const nativeSetItem = window.localStorage.setItem.bind(window.localStorage);
    Object.defineProperty(window.localStorage, "setItem", {
      configurable: true,
      value: (key: string, value: string) => {
        if (typeof key === "string" && isDraftKey(key) && isSuppressed()) return;
        nativeSetItem(key, value);
      },
    });
    return;
  } catch {
    // Some WebView builds do not allow overriding the localStorage instance.
  }

  try {
    const proto = Object.getPrototypeOf(window.localStorage) as Storage;
    const nativeSetItem = proto.setItem;
    Object.defineProperty(proto, "setItem", {
      configurable: true,
      value(this: Storage, key: string, value: string) {
        if (typeof key === "string" && isDraftKey(key) && isSuppressed()) return;
        return nativeSetItem.call(this, key, value);
      },
    });
  } catch {
    // Fallback interval below will keep stale finalized drafts removed.
  }
};

const finalizeButtonLabel = /ยืนยันรับเงิน|ยืนยันรับชำระ|ล้างรายการทั้งหมด|ยืนยันยกเลิกบิล|พักบิล|บันทึกบิล|ปิดบิล/;
const paymentModalTitle = /รับชำระเงินสด|ชำระด้วยเงินโอน|ล้างรายการทั้งหมด|ยกเลิกบิลปัจจุบัน|รายการพักบิล/;

const confirmButtonInActiveModal = () => {
  const backdrop = document.querySelector(".grocery-modal-backdrop, .modal-backdrop");
  if (!backdrop || !paymentModalTitle.test(textOf(backdrop))) return null;
  return Array.from(backdrop.querySelectorAll<HTMLButtonElement>("button"))
    .find(button => !button.disabled && finalizeButtonLabel.test(textOf(button))) || null;
};

const startSalesDraftFinalizeGuard = () => {
  patchDraftWrites();

  document.addEventListener("click", event => {
    const button = event.target instanceof HTMLElement ? event.target.closest("button") : null;
    if (!button || button.disabled) return;
    const label = textOf(button);
    if (finalizeButtonLabel.test(label)) suppressDraftRestore(`click:${label}`);
  }, true);

  document.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    const button = confirmButtonInActiveModal();
    if (button) suppressDraftRestore(`enter:${textOf(button)}`);
  }, true);

  window.addEventListener("cpipos:sales-draft-clear", event => {
    const detail = (event as CustomEvent).detail;
    suppressDraftRestore(typeof detail?.reason === "string" ? detail.reason : "custom-clear");
  });

  window.setInterval(() => {
    if (isSuppressed()) clearDraftStorage();
  }, 250);
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startSalesDraftFinalizeGuard, { once: true });
else startSalesDraftFinalizeGuard();

export {};
