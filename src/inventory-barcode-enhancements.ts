const lastSearchKeyAt = new WeakMap<HTMLInputElement, number>();

const isTypingKey = (event: KeyboardEvent) =>
  event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey;

const looksLikeScanValue = (value: string) => {
  const compact = value.trim().replace(/\s+/g, "");
  return compact.length >= 4 && /^[0-9A-Za-z\-_.]+$/.test(compact);
};

const isInventorySearchInput = (target: EventTarget | null): target is HTMLInputElement => {
  if (!(target instanceof HTMLInputElement)) return false;
  const placeholder = target.placeholder || "";
  return !!target.closest(".inventory-filters") && /บาร์โค้ด|SKU|รหัสสินค้า/i.test(placeholder);
};

const setReactInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const focusInventorySearch = () => {
  window.setTimeout(() => {
    const input = document.querySelector<HTMLInputElement>(
      '.inventory-filters input[placeholder*="บาร์โค้ด"], .inventory-filters input[placeholder*="SKU"]'
    );
    input?.focus();
    input?.select();
  }, 40);
};

window.addEventListener("focusin", event => {
  if (!isInventorySearchInput(event.target)) return;
  window.setTimeout(() => event.target.select(), 20);
});

window.addEventListener("keydown", event => {
  if (!isInventorySearchInput(event.target)) return;
  const input = event.target;

  if (event.key === "Escape") {
    event.preventDefault();
    setReactInputValue(input, "");
    input.focus();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    input.select();
    return;
  }

  if (!isTypingKey(event)) return;

  const now = performance.now();
  const last = lastSearchKeyAt.get(input) || 0;
  const current = input.value || "";
  const selectionStart = input.selectionStart ?? 0;
  const selectionEnd = input.selectionEnd ?? 0;
  const allSelected = selectionStart === 0 && selectionEnd === current.length;
  const cursorAtEnd = selectionStart === current.length && selectionEnd === current.length;
  const looksLikePreviousScan = looksLikeScanValue(current);
  const firstKeyOfNextScan = now - last > 420;

  lastSearchKeyAt.set(input, now);

  if (current && looksLikePreviousScan && cursorAtEnd && !allSelected && firstKeyOfNextScan) {
    event.preventDefault();
    setReactInputValue(input, event.key);
    window.requestAnimationFrame(() => input.setSelectionRange(1, 1));
  }
}, true);

const removeExistingInspector = () => {
  document.querySelector(".inventory-barcode-inspector-backdrop")?.remove();
};

const openBarcodeInspector = (source: HTMLElement) => {
  const value = source.querySelector("small")?.textContent?.trim();
  const row = source.closest("tr");
  const productName = row?.querySelector(".inventory-product-name strong")?.textContent?.trim() || "สินค้า";
  const productCode = row?.querySelector("td:nth-child(2) strong")?.textContent?.trim() || "-";
  const originalSvg = source.querySelector("svg");

  if (!value || !originalSvg) return;
  removeExistingInspector();

  const svg = originalSvg.cloneNode(true) as SVGElement;
  svg.classList.add("inventory-barcode-inspector-svg");
  svg.setAttribute("height", "118");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("shape-rendering", "crispEdges");

  const backdrop = document.createElement("div");
  backdrop.className = "inventory-barcode-inspector-backdrop";
  backdrop.innerHTML = `
    <section class="inventory-barcode-inspector" role="dialog" aria-modal="true" aria-label="ดูบาร์โค้ดสินค้า">
      <header>
        <div>
          <span>มาตรฐาน CODE 128-B</span>
          <h2></h2>
          <p></p>
        </div>
        <button type="button" class="inventory-barcode-close" aria-label="ปิด">×</button>
      </header>
      <div class="inventory-barcode-viewer">
        <div class="inventory-barcode-large"></div>
        <strong></strong>
        <small>บาร์โค้ดความคมชัดสูง · เว้น Quiet Zone ซ้าย/ขวา · รองรับเครื่องสแกนแบบ Keyboard Wedge</small>
      </div>
      <footer>
        <button type="button" class="secondary inventory-barcode-close">ปิด</button>
        <button type="button" class="inventory-barcode-print">พิมพ์บาร์โค้ดรายการนี้</button>
      </footer>
    </section>
  `;

  backdrop.querySelector("h2")!.textContent = productName;
  backdrop.querySelector("p")!.textContent = `รหัสสินค้า ${productCode}`;
  backdrop.querySelector(".inventory-barcode-large")!.appendChild(svg);
  backdrop.querySelector(".inventory-barcode-viewer strong")!.textContent = value;

  const close = () => {
    backdrop.remove();
    window.removeEventListener("keydown", onKeyDown, true);
    focusInventorySearch();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" && event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  backdrop.querySelectorAll(".inventory-barcode-close").forEach(button => button.addEventListener("click", close));
  backdrop.querySelector(".inventory-barcode-print")?.addEventListener("click", () => {
    const printButton = row?.querySelector<HTMLButtonElement>(".inventory-action.barcode");
    close();
    window.setTimeout(() => printButton?.click(), 60);
  });
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) close();
  });
  window.addEventListener("keydown", onKeyDown, true);
  document.body.appendChild(backdrop);
};

window.addEventListener("click", event => {
  const target = event.target as HTMLElement | null;
  const barcode = target?.closest<HTMLElement>(".inventory-table .barcode-cell-preview");
  if (!barcode) return;
  event.preventDefault();
  event.stopPropagation();
  openBarcodeInspector(barcode);
}, true);

export {};
