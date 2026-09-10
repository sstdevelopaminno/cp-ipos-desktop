type DraftLine = {
  code: string;
  quantity: number;
  savedAt: string;
};

type DraftCart = {
  version: 1;
  key: string;
  updatedAt: string;
  lines: DraftLine[];
};

const DRAFT_KEY_PREFIX = "cpipos.sales.draft.v1";
const DRAFT_INDEX_KEY = "cpipos.sales.draft.index.v1";
const MAX_DRAFT_AGE_MS = 1000 * 60 * 60 * 18;
const RESTORE_DELAY_MS = 120;

const textOf = (node: Element | null) => (node?.textContent || "").replace(/\s+/g, " ").trim();
const isSalesView = () => Boolean(document.querySelector(".grocery-pos-layout"));
const hasBlockingPopup = () => Boolean(document.querySelector(".grocery-modal-backdrop, .modal-backdrop"));
const pause = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* localStorage can be unavailable in strict preview modes. */ }
};

const salesDraftKey = () => {
  const meta = textOf(document.querySelector(".topbar-meta"));
  const shiftMatch = meta.match(/กะปัจจุบัน:\s*([^\s]+)/) || meta.match(/currentShift:\s*([^\s]+)/i);
  const shiftCode = shiftMatch?.[1]?.replace(/[^a-zA-Z0-9_-]/g, "") || "active-shift";
  return `${DRAFT_KEY_PREFIX}.${shiftCode}`;
};

const rememberDraftKey = (key: string) => {
  const list = readJson<string[]>(DRAFT_INDEX_KEY, []).filter(item => item !== key);
  writeJson(DRAFT_INDEX_KEY, [key, ...list].slice(0, 12));
};

const readDraft = (key = salesDraftKey()): DraftCart | null => {
  const draft = readJson<DraftCart | null>(key, null);
  if (!draft || !Array.isArray(draft.lines) || !draft.lines.length) return null;
  const age = Date.now() - Date.parse(draft.updatedAt || "");
  if (!Number.isFinite(age) || age > MAX_DRAFT_AGE_MS) {
    localStorage.removeItem(key);
    return null;
  }
  return draft;
};

const clearDraft = (key = salesDraftKey()) => {
  try { localStorage.removeItem(key); } catch { /* noop */ }
};

const readCartRowsFromDom = (): DraftLine[] => {
  const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>(".grocery-table-v2 tbody tr"));
  return rows.map(row => {
    const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>("td"));
    const sku = textOf(cells[1]?.querySelector("strong") || null);
    const barcode = textOf(cells[1]?.querySelector("small") || null);
    const quantityInput = cells[4]?.querySelector<HTMLInputElement>("input");
    const quantity = Math.max(0.001, Number(quantityInput?.value || textOf(cells[4] || null) || 1));
    const code = (barcode && barcode !== "-" ? barcode : sku).trim();
    return code ? { code, quantity, savedAt: new Date().toISOString() } : null;
  }).filter((line): line is DraftLine => Boolean(line?.code));
};

const writeCurrentCartDraft = () => {
  if (!isSalesView()) return;
  const lines = readCartRowsFromDom();
  if (!lines.length) return;
  const key = salesDraftKey();
  writeJson(key, { version: 1, key, updatedAt: new Date().toISOString(), lines } satisfies DraftCart);
  rememberDraftKey(key);
};

const setNativeValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

const scannerInput = () => document.querySelector<HTMLInputElement>(".grocery-scan-row input:not(.scan-qty-field input)");
const qtyInput = () => document.querySelector<HTMLInputElement>(".scan-qty-field input");

let restoreInProgress = false;
let restoreSignature = "";
let persistTimer = 0;
let restoreTimer = 0;

const schedulePersist = () => {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(writeCurrentCartDraft, 120);
};

const restoreDraftCart = async () => {
  if (restoreInProgress || !isSalesView() || hasBlockingPopup() || readCartRowsFromDom().length) return;
  const key = salesDraftKey();
  const draft = readDraft(key);
  if (!draft?.lines.length) return;
  const signature = `${key}:${draft.updatedAt}:${draft.lines.length}`;
  if (restoreSignature === signature) return;

  restoreInProgress = true;
  restoreSignature = signature;
  try {
    for (const line of draft.lines) {
      const scanner = scannerInput();
      const qty = qtyInput();
      if (!scanner || !isSalesView()) break;
      if (qty) {
        setNativeValue(qty, String(line.quantity || 1));
        await pause(35);
      }
      scanner.focus({ preventScroll: true });
      setNativeValue(scanner, line.code);
      scanner.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      await pause(RESTORE_DELAY_MS);
    }
    const qty = qtyInput();
    if (qty) setNativeValue(qty, "1");
    window.setTimeout(writeCurrentCartDraft, 250);
  } finally {
    restoreInProgress = false;
  }
};

const scheduleRestore = () => {
  window.clearTimeout(restoreTimer);
  restoreTimer = window.setTimeout(() => { void restoreDraftCart(); }, 180);
};

const shouldClearDraftFromButton = (target: EventTarget | null) => {
  const button = target instanceof HTMLElement ? target.closest("button") : null;
  const label = textOf(button);
  return /ล้างรายการทั้งหมด|ยืนยันรับเงิน|ยืนยันรับชำระ|ยืนยันยกเลิกบิล|พักบิล/.test(label);
};

const pruneOldDrafts = () => {
  const indexed = readJson<string[]>(DRAFT_INDEX_KEY, []);
  const keep: string[] = [];
  for (const key of indexed) {
    const draft = readDraft(key);
    if (draft) keep.push(key);
  }
  writeJson(DRAFT_INDEX_KEY, keep.slice(0, 12));
};

const startDraftCartRuntime = () => {
  pruneOldDrafts();
  document.addEventListener("click", event => {
    if (!isSalesView()) return;
    writeCurrentCartDraft();
    if (shouldClearDraftFromButton(event.target)) {
      const key = salesDraftKey();
      window.setTimeout(() => {
        if (!readCartRowsFromDom().length) clearDraft(key);
        else writeCurrentCartDraft();
      }, 500);
    }
  }, true);
  window.addEventListener("beforeunload", writeCurrentCartDraft);

  const observer = new MutationObserver(() => {
    if (!isSalesView()) return;
    schedulePersist();
    scheduleRestore();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleRestore();
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startDraftCartRuntime, { once: true });
else startDraftCartRuntime();

export {};
