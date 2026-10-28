type MaybeButton = HTMLButtonElement | null;

let lastScannerInputAt = 0;
let suppressPaymentEnterUntil = 0;
let lastCartRowCount = 0;

const SCANNER_ENTER_SUPPRESS_MS = 1200;

const markScannerActivity = (windowMs = SCANNER_ENTER_SUPPRESS_MS) => {
  const now = performance.now();
  lastScannerInputAt = now;
  suppressPaymentEnterUntil = Math.max(suppressPaymentEnterUntil, now + windowMs);
};

const isEditable = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
};

const isVisible = (element: HTMLElement) => {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
};

const salesRoot = () => document.querySelector<HTMLElement>(".grocery-pos-layout");

const topModal = () => {
  const modals = Array.from(document.querySelectorAll<HTMLElement>(".grocery-modal"));
  return modals.filter(isVisible).at(-1) || null;
};

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

const allButtons = (scope: ParentNode = document) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).filter(button => !button.disabled && isVisible(button));

const buttonText = (button: HTMLButtonElement) => normalizeText(button.textContent || button.getAttribute("aria-label") || "");

const findButton = (scope: ParentNode, tests: Array<string | RegExp>): MaybeButton => {
  return allButtons(scope).find(button => {
    const text = buttonText(button);
    return tests.some(test => typeof test === "string" ? text.includes(test) : test.test(text));
  }) || null;
};

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

const scanInput = () => {
  const row = document.querySelector<HTMLElement>(".grocery-scan-row");
  const inputs = Array.from(row?.querySelectorAll<HTMLInputElement>("input") || []);
  return inputs.find(input => !input.closest(".scan-qty-field")) || null;
};

const quantityInput = () => document.querySelector<HTMLInputElement>(".scan-qty-field input");

const focusScanner = () => window.setTimeout(() => scanInput()?.focus({ preventScroll: true }), 30);

const adjustScanQty = (delta: number) => {
  const input = quantityInput();
  if (!input) return false;
  const current = Math.max(1, Number(input.value || 1));
  const next = Math.max(1, current + delta);
  setNativeValue(input, String(next));
  input.focus({ preventScroll: true });
  input.select();
  return true;
};

const openPaymentIfReady = () => clickButton(document.querySelector<HTMLButtonElement>(".grocery-pay-button:not(:disabled)"));
const openDiscount = () => clickButton(findButton(document, ["ส่วนลด"]));
const parkBill = () => clickButton(findButton(document, ["พักบิล"]));
const openParkedBills = () => clickButton(findButton(document, ["บิลพัก"]));
const openDrawer = () => clickButton(findButton(document, ["เปิดลิ้นชัก"]));
const openCancelBill = () => clickButton(findButton(document, ["ยกเลิกบิล"]));
const openClearTable = () => clickButton(findButton(document, ["ล้างตาราง"]));

const closeModal = (modal: HTMLElement) => {
  const closeButton = modal.querySelector<HTMLButtonElement>('header button, button[aria-label="ปิด"], button[aria-label="Close"]');
  if (clickButton(closeButton)) return true;
  return clickButton(findButton(modal, ["ยกเลิก", "กลับ", "ปิด"]));
};

const activatePrimaryModalAction = (modal: HTMLElement) => {
  const focused = document.activeElement instanceof HTMLButtonElement && modal.contains(document.activeElement) ? document.activeElement : null;
  if (focused && !focused.disabled) return clickButton(focused);
  const actions = allButtons(modal.querySelector(".grocery-modal-actions") || modal)
    .filter(button => !button.classList.contains("secondary-action"));
  return clickButton(actions.at(-1) || null);
};

const setActiveChoice = (buttons: HTMLButtonElement[], index: number) => {
  if (!buttons.length) return -1;
  const safeIndex = ((index % buttons.length) + buttons.length) % buttons.length;
  buttons.forEach((button, i) => button.classList.toggle("pos-kb-active", i === safeIndex));
  buttons[safeIndex]?.focus({ preventScroll: true });
  return safeIndex;
};

const modalChoiceButtons = (modal: HTMLElement) => Array.from(modal.querySelectorAll<HTMLButtonElement>(".grocery-payment-choice button, .parked-bill-list button, .discount-type-switch button, .discount-quick button, .grocery-modal-actions button"))
  .filter(button => !button.disabled && isVisible(button));

const handleChoiceNavigation = (event: KeyboardEvent, modal: HTMLElement) => {
  const choiceScope = modal.querySelector(".grocery-payment-choice, .parked-bill-list, .discount-type-switch");
  if (!choiceScope) return false;
  const buttons = Array.from(choiceScope.querySelectorAll<HTMLButtonElement>("button")).filter(button => !button.disabled && isVisible(button));
  if (!buttons.length) return false;
  const active = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
  const current = buttons.includes(active as HTMLButtonElement) ? buttons.indexOf(active as HTMLButtonElement) : 0;
  if (["ArrowRight", "ArrowDown"].includes(event.key)) {
    setActiveChoice(buttons, current + 1);
    return true;
  }
  if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
    setActiveChoice(buttons, current - 1);
    return true;
  }
  if (event.key === "Enter") {
    const selected = buttons.includes(active as HTMLButtonElement) ? active as HTMLButtonElement : buttons[0];
    return clickButton(selected);
  }
  return false;
};

const handleCashKeypad = (event: KeyboardEvent, modal: HTMLElement) => {
  const keypad = modal.querySelector<HTMLElement>(".grocery-cash-keypad");
  if (!keypad) return false;
  const key = event.code === "NumpadDecimal" ? "." : event.key;
  if (/^[0-9.]$/.test(key)) {
    return clickButton(findButton(keypad, [new RegExp(`^${key.replace(".", "\\.")}$`)]));
  }
  if (event.code === "NumpadAdd" || event.key === "+") return clickButton(findButton(modal, ["ยอดพอดี"]));
  if (event.key === "Backspace") return clickButton(findButton(modal, ["ลบ"]));
  if (event.key === "Delete") return clickButton(findButton(modal, ["ล้าง"]));
  if (event.key === "Enter" || event.code === "NumpadEnter") return activatePrimaryModalAction(modal);
  return false;
};

const handleDiscountKeys = (event: KeyboardEvent, modal: HTMLElement) => {
  if (!modal.querySelector(".discount-type-switch")) return false;
  const controls = modalChoiceButtons(modal);
  if (["ArrowDown", "ArrowRight"].includes(event.key)) {
    const index = Math.max(0, controls.indexOf(document.activeElement as HTMLButtonElement));
    setActiveChoice(controls, index + 1);
    return true;
  }
  if (["ArrowUp", "ArrowLeft"].includes(event.key)) {
    const index = Math.max(0, controls.indexOf(document.activeElement as HTMLButtonElement));
    setActiveChoice(controls, index - 1);
    return true;
  }
  if (event.key === "Enter" || event.code === "NumpadEnter") return activatePrimaryModalAction(modal);
  return false;
};

const prepareCancelReason = (modal: HTMLElement) => {
  const title = modal.querySelector("h2")?.textContent || "";
  if (!title.includes("ยกเลิกบิล")) return;
  const inputs = Array.from(modal.querySelectorAll<HTMLInputElement>("input"));
  const reasonInput = inputs.find(input => input.type !== "password" && !input.value.trim());
  if (reasonInput) setNativeValue(reasonInput, "ยกเลิกโดยพนักงาน");
};

const focusSidebar = () => {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".retail-nav-list button, .nav-bottom-actions button"))
    .filter(button => !button.disabled && isVisible(button));
  if (!buttons.length) return false;
  const active = buttons.find(button => button.classList.contains("active")) || buttons[0];
  active.focus({ preventScroll: true });
  return true;
};

const handleSidebarKeys = (event: KeyboardEvent) => {
  const target = document.activeElement;
  if (!(target instanceof HTMLButtonElement) || !target.closest(".side-nav")) return false;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".retail-nav-list button, .nav-bottom-actions button"))
    .filter(button => !button.disabled && isVisible(button));
  const current = buttons.indexOf(target);
  if (current < 0) return false;
  if (["ArrowDown", "ArrowRight"].includes(event.key)) {
    buttons[(current + 1) % buttons.length]?.focus({ preventScroll: true });
    return true;
  }
  if (["ArrowUp", "ArrowLeft"].includes(event.key)) {
    buttons[(current - 1 + buttons.length) % buttons.length]?.focus({ preventScroll: true });
    return true;
  }
  if (event.key === "Enter" || event.code === "NumpadEnter") return clickButton(target);
  return false;
};

const scannerEnterIsFromBarcodeScan = (scanner: HTMLInputElement | null) => {
  if (!scanner) return false;
  const now = performance.now();
  const hasBarcodeText = scanner.value.trim().length > 0;
  const justReceivedScannerText = now - lastScannerInputAt < SCANNER_ENTER_SUPPRESS_MS;
  return hasBarcodeText || justReceivedScannerText || now < suppressPaymentEnterUntil;
};

const cartRowCount = () => document.querySelectorAll(".grocery-table-v2 tbody tr").length;

window.setInterval(() => {
  if (!salesRoot()) {
    lastCartRowCount = 0;
    return;
  }
  const count = cartRowCount();
  if (count > lastCartRowCount) markScannerActivity(1400);
  lastCartRowCount = count;
}, 120);

window.addEventListener("input", event => {
  if (event.target === scanInput()) markScannerActivity();
}, true);

window.addEventListener("keydown", event => {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  const scanner = scanInput();
  if (event.target !== scanner) return;
  if (event.key.length === 1 && event.key !== " ") markScannerActivity();
}, true);

window.addEventListener("keydown", event => {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (!salesRoot()) return;

  const modal = topModal();
  if (modal) {
    let handled = false;
    const isUnknownProductModal = Boolean(modal.querySelector(".grocery-unknown-code"));
    if (isUnknownProductModal && (event.key === "Enter" || event.code === "NumpadEnter" || event.key === "Escape")) {
      handled = closeModal(modal);
      window.setTimeout(focusScanner, 40);
    } else if (event.key === "Escape") {
      handled = closeModal(modal);
    } else {
      handled = handleCashKeypad(event, modal) || handleDiscountKeys(event, modal) || handleChoiceNavigation(event, modal);
    }
    if (!handled && (event.key === "Enter" || event.code === "NumpadEnter")) {
      prepareCancelReason(modal);
      handled = activatePrimaryModalAction(modal);
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }

  if (handleSidebarKeys(event)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  const target = event.target;
  const scanner = scanInput();
  const targetIsScanner = target === scanner;
  const targetIsQty = target === quantityInput();
  const targetIsEditable = isEditable(target);

  if ((event.key === "+" || event.code === "NumpadAdd") && !targetIsScanner) {
    if (adjustScanQty(1)) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
  if ((event.key === "-" || event.code === "NumpadSubtract") && !targetIsScanner) {
    if (adjustScanQty(-1)) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }

  if (targetIsEditable && !targetIsScanner && !targetIsQty) return;

  let handled = false;
  if (event.key === "F9") handled = openClearTable();
  else if (event.key === "F10") handled = parkBill();
  else if (event.key === "F11") handled = openParkedBills();
  else if (event.key === "F8") handled = openDiscount();
  else if ((event.key === "w" || event.key === "W") && (!targetIsScanner || !scanner?.value)) handled = openDrawer();
  else if ((event.key === "d" || event.key === "D") && (!targetIsScanner || !scanner?.value)) handled = openCancelBill();
  else if ((event.key === "q" || event.key === "Q") && (!targetIsScanner || !scanner?.value)) handled = focusSidebar();
  else if (event.key === "Enter" || event.code === "NumpadEnter") {
    if (scannerEnterIsFromBarcodeScan(scanner)) {
      suppressPaymentEnterUntil = performance.now() + SCANNER_ENTER_SUPPRESS_MS;
      if (targetIsScanner && !scanner?.value.trim()) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    handled = openPaymentIfReady();
  }

  if (handled) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

window.addEventListener("focusin", event => {
  const modal = topModal();
  if (!modal) return;
  if (!(event.target instanceof HTMLElement)) return;
  if (!modal.contains(event.target)) return;
  if (modal.querySelector(".grocery-payment-choice")) {
    const buttons = Array.from(modal.querySelectorAll<HTMLButtonElement>(".grocery-payment-choice button")).filter(button => !button.disabled && isVisible(button));
    if (buttons.length && !buttons.includes(document.activeElement as HTMLButtonElement)) setActiveChoice(buttons, 0);
  }
});

window.addEventListener("keydown", event => {
  if (event.key === "Escape") window.setTimeout(focusScanner, 40);
});

export {};
