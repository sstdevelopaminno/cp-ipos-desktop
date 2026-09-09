type MaybeButton = HTMLButtonElement | null;

let lastScannerInputAt = 0;
let suppressPaymentEnterUntil = 0;
let lastCartRowCount = -1;

const SCANNER_ENTER_SUPPRESS_MS = 1600;

const isVisible = (element: HTMLElement) => {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
};

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();
const salesRoot = () => document.querySelector<HTMLElement>(".grocery-pos-layout");
const scanInput = () => {
  const row = document.querySelector<HTMLElement>(".grocery-scan-row");
  const inputs = Array.from(row?.querySelectorAll<HTMLInputElement>("input") || []);
  return inputs.find(input => !input.closest(".scan-qty-field")) || null;
};
const quantityInput = () => document.querySelector<HTMLInputElement>(".scan-qty-field input");
const cashModal = () => {
  const modals = Array.from(document.querySelectorAll<HTMLElement>(".grocery-modal"));
  return modals.filter(isVisible).reverse().find(modal => normalizeText(modal.textContent || "").includes("รับชำระเงินสด")) || null;
};
const topModal = () => {
  const modals = Array.from(document.querySelectorAll<HTMLElement>(".grocery-modal"));
  return modals.filter(isVisible).at(-1) || null;
};

const allButtons = (scope: ParentNode = document) => Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).filter(button => !button.disabled && isVisible(button));
const buttonText = (button: HTMLButtonElement) => normalizeText(button.textContent || button.getAttribute("aria-label") || "");
const findButton = (scope: ParentNode, tests: Array<string | RegExp>): MaybeButton => allButtons(scope).find(button => {
  const text = buttonText(button);
  return tests.some(test => typeof test === "string" ? text.includes(test) : test.test(text));
}) || null;

const clickButton = (button: MaybeButton) => {
  if (!button || button.disabled || !isVisible(button)) return false;
  button.focus({ preventScroll: true });
  button.click();
  return true;
};

const setNativeValue = (input: HTMLInputElement, value: string) => {
  const prototype = Object.getPrototypeOf(input);
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

const toWholeQty = (value: string | number) => {
  const parsed = Number(String(value).replace(/[^0-9]/g, ""));
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.max(1, Math.trunc(parsed));
};

const normalizeQtyInput = () => {
  const input = quantityInput();
  if (!input) return false;
  input.setAttribute("inputmode", "numeric");
  input.setAttribute("step", "1");
  input.setAttribute("min", "1");
  const next = String(toWholeQty(input.value));
  if (input.value !== next) setNativeValue(input, next);
  return true;
};

const adjustScanQty = (delta: number) => {
  const input = quantityInput();
  if (!input) return false;
  const next = Math.max(1, toWholeQty(input.value) + delta);
  setNativeValue(input, String(next));
  input.focus({ preventScroll: true });
  input.select();
  return true;
};

const markRecentScannerActivity = () => {
  const now = performance.now();
  lastScannerInputAt = now;
  suppressPaymentEnterUntil = now + SCANNER_ENTER_SUPPRESS_MS;
};

const syncCartMutationSuppress = () => {
  const tbody = document.querySelector<HTMLTableSectionElement>(".grocery-table-v2 tbody");
  const count = tbody?.querySelectorAll("tr").length ?? 0;
  if (lastCartRowCount >= 0 && count !== lastCartRowCount) {
    suppressPaymentEnterUntil = performance.now() + SCANNER_ENTER_SUPPRESS_MS;
  }
  lastCartRowCount = count;
};

const shouldBlockScannerEnterPayment = (scanner: HTMLInputElement | null) => {
  if (!scanner || document.activeElement !== scanner) return false;
  const now = performance.now();
  const scannerText = scanner.value.trim();
  if (scannerText.length > 0) return false;
  return now - lastScannerInputAt < SCANNER_ENTER_SUPPRESS_MS || now < suppressPaymentEnterUntil;
};

const stopHard = (event: KeyboardEvent) => {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
};

const sanitizeMoneyText = (value: string) => {
  const raw = value.replace(/[^0-9.]/g, "");
  const [head, ...tail] = raw.split(".");
  const integer = head.replace(/^0+(?=\d)/, "") || "0";
  const decimals = tail.join("").slice(0, 2);
  return raw.includes(".") ? `${integer}.${decimals}` : integer === "0" && raw !== "0" ? "" : integer;
};

const clickCashKey = (modal: HTMLElement, key: string) => {
  const keypad = modal.querySelector<HTMLElement>(".grocery-cash-keypad");
  if (!keypad) return false;
  return clickButton(findButton(keypad, [new RegExp(`^${key.replace(".", "\\.")}$`)]));
};

const applyCashAmount = (modal: HTMLElement, value: string) => {
  const clean = sanitizeMoneyText(value);
  const input = modal.querySelector<HTMLInputElement>(".cash-paid-entry-input");
  if (input) input.dataset.cashEntryTouched = clean ? "1" : "";
  clickButton(findButton(modal, ["ล้าง"]));
  for (const char of clean) clickCashKey(modal, char);
  window.setTimeout(() => syncCashPaidEntry(modal), 30);
};

const paidTextFromModal = (modal: HTMLElement) => {
  const cards = Array.from(modal.querySelectorAll<HTMLElement>(".grocery-cash-summary > div"));
  const paidCard = cards.find(card => normalizeText(card.textContent || "").includes("รับเงิน"));
  return normalizeText(paidCard?.querySelector("strong")?.textContent || "฿0.00").replace(/[฿,\s]/g, "");
};

function syncCashPaidEntry(modal: HTMLElement) {
  const summary = modal.querySelector<HTMLElement>(".grocery-cash-summary");
  if (!summary) return;
  modal.classList.add("cash-payment-modernized");
  let holder = modal.querySelector<HTMLDivElement>(".cash-paid-entry-field");
  if (!holder) {
    holder = document.createElement("div");
    holder.className = "cash-paid-entry-field";
    holder.innerHTML = `<label>กรอกจำนวนเงินที่รับ<input class="cash-paid-entry-input" inputmode="decimal" autocomplete="off" placeholder="0.00" /></label><small>ใช้แป้นพิมพ์ตัวเลข / Numpad ได้ · Enter เพื่อยืนยัน · C เพื่อล้าง · Backspace เพื่อลบ</small>`;
    summary.insertAdjacentElement("afterend", holder);
    const input = holder.querySelector<HTMLInputElement>("input");
    input?.addEventListener("focus", () => {
      if (input.value) input.select();
    });
    input?.addEventListener("input", () => applyCashAmount(modal, input.value));
  }
  const input = holder.querySelector<HTMLInputElement>("input");
  if (input && document.activeElement !== input) {
    const paidText = paidTextFromModal(modal);
    const nextValue = Number(paidText) > 0 ? paidText : "";
    input.value = nextValue;
    input.dataset.cashEntryTouched = nextValue ? "1" : "";
  }
}

const focusCashAction = (modal: HTMLElement, direction: number) => {
  const buttons = allButtons(modal.querySelector(".grocery-modal-actions") || modal);
  const actions = buttons.filter(button => buttonText(button).includes("ยกเลิก") || buttonText(button).includes("ยืนยัน"));
  if (!actions.length) return false;
  const current = actions.indexOf(document.activeElement as HTMLButtonElement);
  const next = current < 0 ? (direction < 0 ? 0 : actions.length - 1) : (current + direction + actions.length) % actions.length;
  actions[next].focus({ preventScroll: true });
  actions.forEach((button, index) => button.classList.toggle("pos-kb-active", index === next));
  return true;
};

const updateCashEntryByKey = (modal: HTMLElement, event: KeyboardEvent) => {
  const input = modal.querySelector<HTMLInputElement>(".cash-paid-entry-input");
  if (!input) return false;
  let next = input.value || "";
  const key = event.code === "NumpadDecimal" ? "." : event.key;
  if (/^[0-9.]$/.test(key)) {
    next = sanitizeMoneyText(`${next}${key}`);
  } else if (event.key === "Backspace") {
    next = next.slice(0, -1);
  } else if (event.key === "Delete" || event.key === "c" || event.key === "C") {
    next = "";
  } else {
    return false;
  }
  input.dataset.cashEntryTouched = next ? "1" : "";
  input.value = next;
  applyCashAmount(modal, next);
  input.focus({ preventScroll: true });
  return true;
};

const handleCashModalKey = (event: KeyboardEvent, modal: HTMLElement) => {
  syncCashPaidEntry(modal);
  if (["ArrowLeft", "ArrowRight"].includes(event.key)) return focusCashAction(modal, event.key === "ArrowRight" ? 1 : -1);
  if (event.key === "Escape") return clickButton(findButton(modal, ["ยกเลิก", "ปิด", "กลับ"]));
  if (event.key === "Enter" || event.code === "NumpadEnter") {
    const focused = document.activeElement instanceof HTMLButtonElement && modal.contains(document.activeElement) ? document.activeElement : null;
    return clickButton(focused) || clickButton(findButton(modal, [/ยืนยันรับเงิน/]));
  }
  return updateCashEntryByKey(modal, event);
};

window.addEventListener("input", event => {
  if (!salesRoot()) return;
  if (event.target === scanInput()) markRecentScannerActivity();
  if (event.target === quantityInput()) window.setTimeout(normalizeQtyInput, 0);
}, true);

window.addEventListener("keydown", event => {
  if (!salesRoot() || event.ctrlKey || event.altKey || event.metaKey) return;
  const modal = topModal();
  const cash = cashModal();
  if (modal && cash && modal === cash) {
    if (handleCashModalKey(event, cash)) stopHard(event);
    return;
  }

  const scanner = scanInput();
  if (event.target === scanner && event.key.length === 1) markRecentScannerActivity();

  const qty = quantityInput();
  if (event.target === qty) {
    if (["e", "E", ".", ","].includes(event.key)) {
      stopHard(event);
      return;
    }
    if (event.key === "+" || event.code === "NumpadAdd") {
      if (adjustScanQty(1)) stopHard(event);
      return;
    }
    if (event.key === "-" || event.code === "NumpadSubtract") {
      if (adjustScanQty(-1)) stopHard(event);
      return;
    }
  }

  if ((event.key === "+" || event.code === "NumpadAdd") && event.target !== scanner) {
    if (adjustScanQty(1)) stopHard(event);
    return;
  }
  if ((event.key === "-" || event.code === "NumpadSubtract") && event.target !== scanner) {
    if (adjustScanQty(-1)) stopHard(event);
    return;
  }

  if ((event.key === "Enter" || event.code === "NumpadEnter") && shouldBlockScannerEnterPayment(scanner)) {
    stopHard(event);
    window.setTimeout(() => scanner?.focus({ preventScroll: true }), 30);
  }
}, true);

window.setInterval(() => {
  if (!salesRoot()) return;
  normalizeQtyInput();
  syncCartMutationSuppress();
  const modal = cashModal();
  if (modal) syncCashPaidEntry(modal);
}, 250);

export {};
