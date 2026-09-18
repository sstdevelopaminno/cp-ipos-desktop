import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PosRepository } from "../../data/repository";
import type { AppSettings, CartLine, Language, Product, Receipt, Shift, Staff } from "../../domain/types";
import { productName } from "../../i18n";
import { useDesktopLicense } from "../license/LicenseGate";
import "./desktop-sales-workspace.css";

type SalesMode = "grocery" | "takeaway" | "dine_in";
type TableBill = { tableCode: string; billNo: string; openedAt: string; items: CartLine[] };
type TableBills = Record<string, TableBill>;
type PaymentStep = "review" | "cash" | "transfer" | null;
type NoticeKind = "ok" | "warn" | "error";

const TABLE_CODES = Array.from({ length: 20 }, (_, index) => `T${String(index + 1).padStart(2, "0")}`);
const TABLE_BILLS_KEY = "cpipos.desktop.table-bills.v1";
const GROCERY_CART_KEY = "cpipos.desktop.grocery-cart.v1";
const TAKEAWAY_CART_KEY = "cpipos.desktop.takeaway-cart.v1";

function money(value: number) {
  return `฿${Number(value || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* persistence is best-effort */ }
}

function safeText(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function printDocument(html: string) {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();
  window.setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 1000);
  }, 180);
}

function thermalBaseCss() {
  return `@page{size:80mm auto;margin:0}html,body{margin:0;padding:0;width:80mm;background:#fff;color:#000;font-family:"Noto Sans Thai",Tahoma,"Segoe UI",sans-serif}*{box-sizing:border-box}.paper{width:70mm;margin:0 auto;padding:2mm 0 3mm;font-size:12px;line-height:1.35}.center{text-align:center}.logo{width:20mm;height:20mm;object-fit:contain}.store{font-size:17px;font-weight:900}.muted{font-size:11px}.hr{border-top:1px dashed #111;margin:2mm 0}.row{display:flex;justify-content:space-between;gap:2mm;margin:.7mm 0}.row strong{text-align:right}.items{width:100%;border-collapse:collapse}.items td{padding:.7mm 0;vertical-align:top}.items td:last-child{text-align:right;white-space:nowrap}.grand{font-size:18px;font-weight:900;border-top:1px solid #000;border-bottom:1px solid #000;padding:1.5mm 0;margin:1.5mm 0}.qr{width:42mm;height:42mm;object-fit:contain;image-rendering:pixelated}`;
}

function paymentNoticeHtml(args: { settings: AppSettings; staff: Staff; tableCode?: string | null; billNo: string; items: CartLine[]; total: number }) {
  const qr = args.settings.paymentQrImage || "";
  const itemRows = args.items.map((item) => `<tr><td><strong>${safeText(item.nameTh || item.name)}</strong><div class="muted">${item.quantity} x ${money(item.price)}</div></td><td>${money(item.price * item.quantity)}</td></tr>`).join("");
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>PAYMENT NOTICE ${safeText(args.billNo)}</title><style>${thermalBaseCss()}</style></head><body><main class="paper"><div class="center"><img class="logo" src="${safeText("/icon.png")}" alt="CpIPOS"><div class="store">${safeText(args.settings.storeName)}</div><div>${safeText(args.settings.branchName)}</div></div><div class="hr"></div><div class="center store">ใบแจ้งชำระเงิน</div><div class="center muted">PAYMENT NOTICE / รอชำระ</div><div class="row"><span>ผู้ขาย</span><strong>${safeText(args.staff.displayName)}</strong></div>${args.tableCode ? `<div class="row"><span>โต๊ะ</span><strong>${safeText(args.tableCode)}</strong></div>` : ""}<div class="row"><span>เลขที่บิล</span><strong>${safeText(args.billNo)}</strong></div><div class="row"><span>วันที่</span><strong>${safeText(new Date().toLocaleString("th-TH"))}</strong></div><div class="hr"></div><table class="items"><tbody>${itemRows}</tbody></table><div class="row grand"><span>ยอดที่ต้องชำระ</span><strong>${money(args.total)}</strong></div>${args.settings.paymentQrAccountName ? `<div class="center muted">${safeText(args.settings.paymentQrAccountName)}</div>` : ""}<div class="center"><img class="qr" src="${safeText(qr)}" alt="Payment QR"><div><strong>สแกน QR เพื่อชำระเงิน</strong></div><div class="store">${money(args.total)}</div></div>${args.settings.paymentQrNote ? `<div class="center muted">${safeText(args.settings.paymentQrNote)}</div>` : ""}<div class="hr"></div><div class="center muted">ใบแจ้งนี้ใช้สำหรับชำระเงินเท่านั้น</div><div class="center muted">ยังไม่ใช่ใบเสร็จรับเงิน</div></main></body></html>`;
}

function receiptHtml(receipt: Receipt) {
  const itemRows = receipt.items.map((item) => `<tr><td><strong>${safeText(item.name)}</strong><div class="muted">${item.quantity} x ${money(item.unitPrice)}</div></td><td>${money(item.lineTotal)}</td></tr>`).join("");
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${safeText(receipt.receiptNo)}</title><style>${thermalBaseCss()}</style></head><body><main class="paper"><div class="center"><img class="logo" src="/icon.png" alt="CpIPOS"><div class="store">${safeText(receipt.settings.storeName)}</div><div>${safeText(receipt.settings.branchName)}</div>${receipt.settings.address ? `<div class="muted">${safeText(receipt.settings.address)}</div>` : ""}</div><div class="hr"></div><div class="row"><span>เลขที่บิล</span><strong>${safeText(receipt.receiptNo)}</strong></div><div class="row"><span>วันที่</span><strong>${safeText(new Date(receipt.createdAt).toLocaleString("th-TH"))}</strong></div><div class="hr"></div><table class="items"><tbody>${itemRows}</tbody></table><div class="row grand"><span>ยอดรวม</span><strong>${money(receipt.total)}</strong></div><div class="row"><span>ชำระเงิน</span><strong>${receipt.paymentMethod === "cash" ? "เงินสด" : "โอน/QR"}</strong></div>${receipt.paymentMethod === "cash" ? `<div class="row"><span>รับเงิน</span><strong>${money(receipt.paid)}</strong></div><div class="row"><span>เงินทอน</span><strong>${money(receipt.changeAmount)}</strong></div>` : ""}<div class="hr"></div><div class="center">${safeText(receipt.settings.receiptFooter)}</div><div class="center muted">CpIPOS</div></main></body></html>`;
}

function Icon({ name }: { name: "bag" | "table" | "buffet" | "delivery" | "search" | "menu" }) {
  const common = { width: 27, height: 27, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "table") return <svg {...common}><path d="M4 9h16M6 9V6h12v3M7 9v10m10-10v10M5 19h4m6 0h4" /></svg>;
  if (name === "buffet") return <svg {...common}><path d="M4 13h16M6 13a6 6 0 0 1 12 0M12 7V5M7 18h10" /></svg>;
  if (name === "delivery") return <svg {...common}><path d="M3 15h11V7H8l-2 4H3v4Zm11-5h4l3 3v2h-7v-5Z"/><circle cx="7" cy="17" r="2"/><circle cx="18" cy="17" r="2"/></svg>;
  if (name === "search") return <svg {...common}><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg>;
  if (name === "menu") return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16"/></svg>;
  return <svg {...common}><path d="M6 9h12l1 11H5L6 9Zm3 0V7a3 3 0 0 1 6 0v2"/></svg>;
}

function Modal({ children, className = "", onClose }: { children: ReactNode; className?: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return <div className="desktop-pos-modal-backdrop" onMouseDown={onClose}><section className={`desktop-pos-modal ${className}`} onMouseDown={(event) => event.stopPropagation()}>{children}</section></div>;
}

export function DesktopSalesWorkspace({ repo, staff, shift, settings, products, language, refreshProducts }: {
  repo: PosRepository;
  staff: Staff;
  shift: Shift;
  settings: AppSettings;
  products: Product[];
  language: Language;
  refreshProducts: () => Promise<void>;
}) {
  const license = useDesktopLicense();
  const th = language === "th";
  const [mode, setMode] = useState<SalesMode | null>("grocery");
  const [modePicker, setModePicker] = useState(false);
  const [groceryCart, setGroceryCart] = useState<CartLine[]>(() => readJson<CartLine[]>(GROCERY_CART_KEY, []));
  const [takeawayCart, setTakeawayCart] = useState<CartLine[]>(() => readJson<CartLine[]>(TAKEAWAY_CART_KEY, []));
  const [tableBills, setTableBills] = useState<TableBills>(() => readJson<TableBills>(TABLE_BILLS_KEY, {}));
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableView, setTableView] = useState<"list" | "floor">("list");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [barcode, setBarcode] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const [paymentStep, setPaymentStep] = useState<PaymentStep>(null);
  const [cashInput, setCashInput] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [cancelBillOpen, setCancelBillOpen] = useState(false);
  const [cancelPin, setCancelPin] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const openPicker = () => setModePicker(true);
    window.addEventListener("cpipos:open-sales-mode-picker", openPicker);
    return () => window.removeEventListener("cpipos:open-sales-mode-picker", openPicker);
  }, []);
  useEffect(() => {
    const label = mode === "dine_in" ? (th ? "นั่งโต๊ะ" : "Dine-in") : mode === "takeaway" ? (th ? "กลับบ้าน" : "Takeaway") : (th ? "ร้านชำ / ค้าปลีก" : "Grocery / Retail");
    window.dispatchEvent(new CustomEvent("cpipos:sales-mode-changed", { detail: { mode: mode || "grocery", label } }));
  }, [mode, th]);
  useEffect(() => writeJson(GROCERY_CART_KEY, groceryCart), [groceryCart]);
  useEffect(() => writeJson(TAKEAWAY_CART_KEY, takeawayCart), [takeawayCart]);
  useEffect(() => writeJson(TABLE_BILLS_KEY, tableBills), [tableBills]);

  useEffect(() => {
    if (mode === "grocery" && !license.modes.grocery) { setMode(null); setModePicker(true); }
    if (mode === "takeaway" && !license.modes.takeaway) { setMode(null); setModePicker(true); }
    if (mode === "dine_in" && !license.modes.dineIn) { setMode(null); setSelectedTable(null); setModePicker(true); }
  }, [license.modes.grocery, license.modes.takeaway, license.modes.dineIn, mode]);

  const cart = mode === "dine_in" && selectedTable
    ? (tableBills[selectedTable]?.items ?? [])
    : mode === "grocery"
      ? groceryCart
      : takeawayCart;
  const total = cart.reduce((sum, line) => sum + Number(line.price) * Number(line.quantity), 0);
  const activeTableBill = selectedTable ? tableBills[selectedTable] : undefined;
  const billNo = activeTableBill?.billNo ?? `DIN-${String(Date.now()).slice(-9)}`;
  const qrReady = Boolean(settings.paymentQrEnabled && settings.paymentQrImage);
  const canSwitchMode = cart.length === 0 && !selectedTable;

  const categories = useMemo(() => [{ id: "all", name: th ? "ทั้งหมด" : "All" }, ...Array.from(new Map(products.map((product) => [product.categoryId, { id: product.categoryId, name: product.categoryName }])).values())], [products, th]);
  const visibleProducts = useMemo(() => products.filter((product) => product.active && (category === "all" || product.categoryId === category) && (!query.trim() || `${product.productCode} ${product.barcode ?? ""} ${productName(language, product)} ${product.categoryName}`.toLowerCase().includes(query.trim().toLowerCase()))), [products, category, query, language]);

  const showNotice = (kind: NoticeKind, text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 2200);
  };

  const setCart = (updater: (current: CartLine[]) => CartLine[]) => {
    if (mode === "dine_in" && selectedTable) {
      setTableBills((current) => {
        const bill = current[selectedTable];
        if (!bill) return current;
        return { ...current, [selectedTable]: { ...bill, items: updater(bill.items) } };
      });
    } else if (mode === "grocery") {
      setGroceryCart(updater);
    } else {
      setTakeawayCart(updater);
    }
  };

  const addProduct = (product: Product) => {
    if (product.stockQuantity <= 0) { showNotice("warn", th ? "สินค้าหมด" : "Out of stock"); return; }
    setCart((current) => current.some((line) => line.id === product.id)
      ? current.map((line) => line.id === product.id ? { ...line, quantity: Number((line.quantity + 1).toFixed(3)) } : line)
      : [...current, { ...product, quantity: 1 }]);
    showNotice("ok", productName(language, product));
    window.setTimeout(() => scanRef.current?.focus(), 40);
  };

  const scanBarcode = async () => {
    const code = barcode.trim().replace(/\s+/g, "");
    if (!code) return;
    const product = await repo.findProductByBarcode(code);
    setBarcode("");
    if (!product) { showNotice("warn", th ? `ไม่พบบาร์โค้ด ${code}` : `Unknown barcode ${code}`); return; }
    addProduct(product);
  };

  const selectMode = (next: SalesMode) => {
    if (next === "grocery" && !license.modes.grocery) return;
    if (next === "takeaway" && !license.modes.takeaway) return;
    if (next === "dine_in" && !license.modes.dineIn) return;
    if (!canSwitchMode && mode && mode !== next) { showNotice("warn", th ? "กรุณาจบบิลปัจจุบันก่อนเปลี่ยนโหมด" : "Finish the current bill before switching modes."); return; }
    setMode(next);
    setModePicker(false);
    if (next !== "dine_in") setSelectedTable(null);
  };

  const openTable = (tableCode: string) => {
    if (!license.modes.dineIn) return;
    setTableBills((current) => current[tableCode] ? current : {
      ...current,
      [tableCode]: { tableCode, billNo: `TB-${tableCode}-${Date.now().toString().slice(-10)}`, openedAt: new Date().toISOString(), items: [] }
    });
    setSelectedTable(tableCode);
  };

  const clearCurrentBill = () => {
    if (mode === "dine_in" && selectedTable) {
      const code = selectedTable;
      setTableBills((current) => { const next = { ...current }; delete next[code]; return next; });
      setSelectedTable(null);
    } else if (mode === "grocery") {
      setGroceryCart([]);
    } else {
      setTakeawayCart([]);
    }
  };

  const completePayment = async (method: "cash" | "transfer", paid: number) => {
    if (!cart.length || busy) return;
    setBusy(true);
    try {
      const sale = await repo.checkout({
        items: cart.map((line) => ({ productId: line.id, name: productName(language, line), quantity: line.quantity, unitPrice: line.price })),
        paymentMethod: method,
        paid,
        staff,
        shift,
        deviceId: settings.deviceId
      });
      const nextReceipt = await repo.getReceipt(sale.id);
      clearCurrentBill();
      setPaymentStep(null);
      setCashInput("");
      await refreshProducts();
      if (nextReceipt) setReceipt(nextReceipt);
      showNotice("ok", th ? "บันทึกการขายเรียบร้อย" : "Sale completed");
    } catch (error) {
      showNotice("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const cancelCurrentBill = async () => {
    if (!cancelPin || !cancelReason.trim()) return;
    setBusy(true); setCancelError("");
    try {
      const authorizer = await repo.verifyPin(cancelPin);
      if (!authorizer || !["owner", "manager"].includes(authorizer.role)) throw new Error(th ? "ต้องใช้ PIN ผู้จัดการหรือเจ้าของร้าน" : "Owner/manager PIN required");
      await repo.cancelBill({
        items: cart.map((line) => ({ productId: line.id, name: productName(language, line), quantity: line.quantity, unitPrice: line.price })),
        reason: cancelReason.trim(),
        staff: authorizer,
        shift,
        deviceId: settings.deviceId
      });
      clearCurrentBill();
      setCancelBillOpen(false); setPaymentStep(null); setCancelPin(""); setCancelReason("");
      showNotice("ok", th ? "ยกเลิกบิลแล้ว" : "Bill cancelled");
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };

  const moveTable = (nextTable: string) => {
    if (!selectedTable || tableBills[nextTable]) return;
    const currentBill = tableBills[selectedTable];
    if (!currentBill) return;
    setTableBills((current) => {
      const next = { ...current };
      delete next[selectedTable];
      next[nextTable] = { ...currentBill, tableCode: nextTable };
      return next;
    });
    setSelectedTable(nextTable);
    setMoveOpen(false);
  };

  const renderModePicker = () => modePicker ? <Modal className="mode-picker-modal" onClose={() => mode ? setModePicker(false) : undefined}>
    <header className="desktop-pos-modal__header"><div><small className="eyebrow">{th ? "เลือกโหมด" : "SELECT MODE"}</small><h2>{th ? "เลือกโหมดการขาย" : "Select sales mode"}</h2><p>{th ? "เลือกวิธีรับออเดอร์ที่ต้องการใช้งาน" : "Choose the order workflow for this bill."}</p></div>{mode ? <button className="icon-close" onClick={() => setModePicker(false)}>×</button> : null}</header>
    <div className="mode-card-grid">
      <button className={`mode-card ${mode === "grocery" ? "is-selected" : ""} ${!license.modes.grocery ? "is-locked" : ""}`} disabled={!license.modes.grocery} onClick={() => selectMode("grocery")}><span className="mode-icon"><Icon name="menu"/></span><strong>{th ? "ร้านชำ / ค้าปลีก" : "Grocery / Retail"}</strong><small>{th ? "ขายเร็วด้วยบาร์โค้ดและ SKU" : "Fast barcode and SKU checkout"}</small>{mode === "grocery" ? <b className="mode-check">✓</b> : null}{!license.modes.grocery ? <em>{th ? "ปิดโดย IT" : "Locked by IT"}</em> : null}</button>
      <button className={`mode-card ${mode === "takeaway" ? "is-selected" : ""} ${!license.modes.takeaway ? "is-locked" : ""}`} disabled={!license.modes.takeaway} onClick={() => selectMode("takeaway")}><span className="mode-icon"><Icon name="bag"/></span><strong>{th ? "กลับบ้าน" : "Takeaway"}</strong><small>{th ? "รับกลับ ไม่ใช้โต๊ะ" : "Quick sale without table"}</small>{mode === "takeaway" ? <b className="mode-check">✓</b> : null}{!license.modes.takeaway ? <em>{th ? "ปิดโดย IT" : "Locked by IT"}</em> : null}</button>
      <button className={`mode-card ${mode === "dine_in" ? "is-selected" : ""} ${!license.modes.dineIn ? "is-locked" : ""}`} disabled={!license.modes.dineIn} onClick={() => selectMode("dine_in")}><span className="mode-icon"><Icon name="table"/></span><strong>{th ? "นั่งโต๊ะ" : "Dine-in"}</strong><small>{th ? "เลือกโต๊ะและเปิดบิล" : "Open and manage table bills"}</small>{mode === "dine_in" ? <b className="mode-check">✓</b> : null}{!license.modes.dineIn ? <em>{th ? "ปิดโดย IT" : "Locked by IT"}</em> : null}</button>
    </div>
  </Modal> : null;

  if (!mode) {
    return <section className="desktop-pos-empty-shell"><div className="desktop-pos-empty-card"><img src="/icon.png" alt="CpIPOS"/><h2>{th ? "พร้อมขาย" : "Ready to sell"}</h2><p>{th ? "เลือกโหมดการขายเพื่อเริ่มรายการ" : "Select a licensed sales mode to begin."}</p><button onClick={() => setModePicker(true)}>{th ? "เลือกโหมด" : "Select mode"}</button></div>{renderModePicker()}</section>;
  }

  const renderTables = () => mode === "dine_in" && !selectedTable ? <section className="table-browser-panel">
    <div className="table-browser-toolbar"><div className="table-tabs"><button className={tableView === "list" ? "active" : ""} onClick={() => setTableView("list")}>{th ? "รายการโต๊ะ" : "Table list"}</button><button className={tableView === "floor" ? "active" : ""} onClick={() => setTableView("floor")}>{th ? "แผนผังร้าน" : "Floor plan"}</button><span>{th ? "ทั้งหมด" : "All"}</span></div></div>
    {tableView === "floor" ? <div className="floor-preview"><div><Icon name="table"/><strong>{th ? "แผนผังร้าน" : "Floor plan"}</strong><small>{th ? "รุ่น Desktop จะใช้ตำแหน่งโต๊ะจริงในขั้นถัดไป — เลือกโต๊ะจากรายการด้านล่างได้ทันที" : "Desktop floor coordinates are the next step. Use the live table list below."}</small></div></div> : null}
    <div className="table-grid">{TABLE_CODES.map((tableCode) => {
      const bill = tableBills[tableCode];
      const amount = bill?.items.reduce((sum, line) => sum + line.quantity * line.price, 0) ?? 0;
      return <button key={tableCode} className={bill ? "occupied" : "available"} onClick={() => openTable(tableCode)}><strong>{tableCode}</strong><span>{bill ? (th ? "มีบิล" : "Open") : (th ? "ว่าง" : "Available")}</span><small>{bill ? `${bill.items.length} ${th ? "รายการ" : "items"} · ${money(amount)}` : (th ? "เปิดบิล" : "Open bill")}</small></button>;
    })}</div>
  </section> : null;

  const renderCatalog = () => mode === "grocery" || mode === "takeaway" || selectedTable ? <section className="product-browser">
    <div className="catalog-tools"><button className="orange-chip">{th ? "เครื่องดื่ม" : "Products"}</button><label className="search-field"><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={th ? "ค้นหาสินค้า" : "Search products"}/></label><label className="scan-field"><input ref={scanRef} value={barcode} onChange={(event) => setBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void scanBarcode(); }} placeholder={th ? "สแกนบาร์โค้ด" : "Scan barcode"}/><button onClick={() => void scanBarcode()}>{th ? "เพิ่ม" : "Add"}</button></label></div>
    <div className="category-row">{categories.map((item) => <button key={item.id} className={category === item.id ? "active" : ""} onClick={() => setCategory(item.id)}>{item.name}</button>)}</div>
    <div className="desktop-product-grid">{visibleProducts.map((product) => <button key={product.id} className="desktop-product-card" disabled={product.stockQuantity <= 0} onClick={() => addProduct(product)}><span className="product-image">{product.imagePath ? <img src={product.imagePath} alt=""/> : productName(language, product).slice(0, 1)}</span><strong>{productName(language, product)}</strong><small>{product.barcode || product.productCode}</small><em>{th ? "คงเหลือ" : "Stock"}: {product.stockQuantity}</em><b>{money(product.price)}</b></button>)}</div>
  </section> : null;

  const renderCart = () => <aside className="desktop-cart-panel"><header><h2>{th ? `รายการสินค้า (${cart.length})` : `Cart (${cart.length})`}</h2><button disabled={!cart.length} onClick={() => setCart(() => [])}>{th ? "ล้างรายการ" : "Clear"}</button></header><div className="desktop-cart-list">{cart.length === 0 ? <div className="cart-empty"><img src="/icon.png" alt="CpIPOS"/></div> : cart.map((line) => <article key={line.id} className="desktop-cart-line"><div className="cart-product-mark">{productName(language, line).slice(0, 1)}</div><div className="cart-line-info"><strong>{productName(language, line)}</strong><small>{money(line.price)}</small><div className="cart-qty"><button onClick={() => setCart((current) => current.map((item) => item.id === line.id ? { ...item, quantity: Math.max(1, item.quantity - 1) } : item))}>−</button><span>{line.quantity}</span><button onClick={() => setCart((current) => current.map((item) => item.id === line.id ? { ...item, quantity: item.quantity + 1 } : item))}>+</button><button className="line-remove" onClick={() => setCart((current) => current.filter((item) => item.id !== line.id))}>×</button></div></div><strong>{money(line.price * line.quantity)}</strong></article>)}</div><footer>{selectedTable && activeTableBill ? <div className="bill-identity"><span>{th ? "เลขที่บิล" : "Bill"}</span><strong>{activeTableBill.billNo}</strong><span>{th ? "สถานะ" : "Status"}</span><strong>{th ? "นั่งโต๊ะ" : "Dine-in"}</strong></div> : null}<div className="cart-total"><span>{th ? "ยอดรวม" : "Total"}</span><strong>{money(total)}</strong></div><div className="cart-actions"><button disabled={!cart.length} className="muted-action">{th ? "สมาชิก" : "Member"}</button><button disabled={!cart.length} className="discount-action">{th ? "ส่วนลด" : "Discount"}</button></div><button className="checkout-button" disabled={!cart.length} onClick={() => setPaymentStep("review")}>{selectedTable || mode === "grocery" ? (th ? "ชำระเงิน" : "Pay") : (th ? "สร้างออเดอร์ POS" : "Create POS order")}</button></footer></aside>;

  return <section className="desktop-sales-workspace">
    <div className="sales-main-column">
      {selectedTable ? <div className="table-session-toolbar"><span>{th ? "โต๊ะ" : "Table"}: <strong>{selectedTable}</strong></span><button onClick={() => setMoveOpen(true)}>{th ? "ย้ายโต๊ะ" : "Move table"}</button><button onClick={() => setSelectedTable(null)}>{th ? "เลือกโต๊ะ" : "Choose table"}</button><button className="menu-button"><Icon name="menu"/>{th ? "จัดการเมนู" : "Menu"}</button></div> : null}
      {renderTables()}
      {renderCatalog()}
    </div>
    {renderCart()}
    {renderModePicker()}
    {notice ? <div className={`desktop-pos-toast ${notice.kind}`}>{notice.text}</div> : null}

    {paymentStep === "review" ? <Modal className="payment-review-modal" onClose={() => setPaymentStep(null)}><header className="desktop-pos-modal__header"><div><h2>{th ? "รายการก่อนชำระเงิน" : "Review before payment"}</h2><p>{th ? "ตรวจสอบรายการสินค้าและยอดรวมก่อนเลือกวิธีชำระเงิน" : "Review items and total before choosing payment method."}</p></div><button className="close-text" onClick={() => setPaymentStep(null)}>{th ? "ปิด" : "Close"}</button></header><div className="review-table"><div className="review-head"><span>{th ? "รายการสินค้า" : "Item"}</span><span>{th ? "จำนวน" : "Qty"}</span><span>{th ? "รวมต่อรายการ" : "Total"}</span></div>{cart.map((line) => <div className="review-row" key={line.id}><span><strong>{productName(language, line)}</strong><small>{line.quantity} x {money(line.price)}</small></span><b>{line.quantity}</b><strong>{money(line.quantity * line.price)}</strong></div>)}</div><div className="review-total"><span>{th ? "รวมยอด" : "Grand total"}</span><strong>{money(total)}</strong></div><div className="modal-actions"><button className="cancel-action" onClick={() => setCancelBillOpen(true)}>{th ? "ยกเลิกบิล" : "Cancel bill"}</button><button className="cash-action" onClick={() => { setCashInput(String(total)); setPaymentStep("cash"); }}>{th ? "ชำระเงินสด" : "Cash"}</button><button className="transfer-action" onClick={() => setPaymentStep("transfer")}>{th ? "ชำระเงินโอน" : "Transfer / QR"}</button></div></Modal> : null}

    {paymentStep === "cash" ? <Modal className="cash-payment-modal" onClose={() => !busy && setPaymentStep("review")}><header className="desktop-pos-modal__header"><div><h2>{th ? "รับชำระเงินสด" : "Cash payment"}</h2><p>{th ? "กรอกจำนวนเงินที่รับจากลูกค้า" : "Enter cash received."}</p></div><button className="close-text" onClick={() => setPaymentStep("review")}>{th ? "ปิด" : "Close"}</button></header><div className="cash-layout"><section className="cash-summary"><div className="cash-summary-row"><span>{th ? "ยอดที่ต้องชำระ" : "Amount due"}</span><strong className="green">{money(total)}</strong></div><div className="cash-summary-row"><span>{th ? "รับเงินจากลูกค้า" : "Received"}</span><strong className="blue">{money(Number(cashInput || 0))}</strong></div><div className="quick-cash"><span>{th ? "บล็อกรับเงินด่วน" : "Quick cash"}</span><div>{[500, 1000, 1500].map((amount) => <button key={amount} onClick={() => setCashInput(String(amount))}>{money(amount)}</button>)}</div></div><div className="cash-summary-row"><span>{th ? "เงินทอน" : "Change"}</span><strong className="blue">{money(Math.max(0, Number(cashInput || 0) - total))}</strong></div></section><section className="cash-keypad"><span>{th ? "แป้นตัวเลข" : "Keypad"}</span><div>{["1","2","3","4","5","6","7","8","9","0","00","."].map((key) => <button key={key} onClick={() => setCashInput((current) => `${current}${key}`)}>{key}</button>)}</div><div className="keypad-foot"><button onClick={() => setCashInput("")}>{th ? "ล้าง" : "Clear"}</button><button onClick={() => setCashInput((current) => current.slice(0, -1))}>{th ? "ลบ" : "Back"}</button></div></section></div><div className="modal-actions modal-actions--spread"><button className="cancel-action" onClick={() => setCancelBillOpen(true)}>{th ? "ยกเลิกบิล" : "Cancel bill"}</button><button className="cash-action" disabled={busy || Number(cashInput || 0) < total} onClick={() => void completePayment("cash", Number(cashInput || 0))}>{busy ? (th ? "กำลังบันทึก..." : "Saving...") : (th ? "ยืนยันชำระ" : "Confirm payment")}</button></div></Modal> : null}

    {paymentStep === "transfer" ? <Modal className="transfer-payment-modal" onClose={() => !busy && setPaymentStep("review")}><header className="desktop-pos-modal__header"><div><h2>{th ? "รับชำระเงินโอน" : "Transfer / QR payment"}</h2></div><button className="icon-close" onClick={() => setPaymentStep("review")}>×</button></header><div className="transfer-amount"><span>{th ? "ยอดชำระ" : "Amount due"}</span><strong>{money(total)}</strong></div><h3>{th ? "สแกน QR เพื่อชำระเงิน" : "Scan QR to pay"}</h3>{qrReady ? <div className="qr-payment-box"><img src={settings.paymentQrImage} alt="QR Payment"/><strong>{settings.paymentQrAccountName || (th ? "บัญชีรับชำระ" : "Payment account")}</strong>{settings.paymentQrNote ? <small>{settings.paymentQrNote}</small> : null}</div> : <div className="qr-required-box"><b>!</b><strong>{th ? "โปรดเปิดใช้งานชำระเงินก่อน" : "Payment QR is not configured"}</strong><p>{th ? "ไปที่เมนู ตั้งค่า > การชำระเงิน / QR แล้วใส่ภาพ QR ชำระเงิน จากนั้นเปิดใช้งานบัญชีรับเงิน" : "Open Settings > Payment / QR, add a QR image and enable the payment account."}</p></div>}<div className="transfer-actions"><button disabled={!qrReady} onClick={() => printDocument(paymentNoticeHtml({ settings, staff, tableCode: selectedTable, billNo, items: cart, total }))}>{th ? "พิมพ์ใบแจ้งชำระเงิน" : "Print payment notice"}</button><button className="transfer-confirm" disabled={!qrReady || busy} onClick={() => void completePayment("transfer", total)}>{busy ? (th ? "กำลังบันทึก..." : "Saving...") : (th ? "ยืนยันรับชำระแล้ว" : "Confirm paid")}</button></div></Modal> : null}

    {cancelBillOpen ? <Modal className="cancel-bill-modal" onClose={() => !busy && setCancelBillOpen(false)}><header className="desktop-pos-modal__header"><div><h2>{th ? "ยกเลิกบิล" : "Cancel bill"}</h2><p>{th ? "ต้องยืนยันด้วย PIN ผู้จัดการหรือเจ้าของร้าน" : "Owner or manager PIN is required."}</p></div><button className="icon-close" onClick={() => setCancelBillOpen(false)}>×</button></header><label>PIN<input type="password" value={cancelPin} onChange={(event) => setCancelPin(event.target.value)}/></label><label>{th ? "เหตุผล" : "Reason"}<input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)}/></label>{cancelError ? <p className="form-error">{cancelError}</p> : null}<div className="modal-actions"><button onClick={() => setCancelBillOpen(false)}>{th ? "กลับ" : "Back"}</button><button className="cancel-action" disabled={busy || !cancelPin || !cancelReason.trim()} onClick={() => void cancelCurrentBill()}>{th ? "ยืนยันยกเลิกบิล" : "Confirm cancellation"}</button></div></Modal> : null}

    {moveOpen && selectedTable ? <Modal className="move-table-modal" onClose={() => setMoveOpen(false)}><header className="desktop-pos-modal__header"><div><h2>{th ? `ย้ายโต๊ะ ${selectedTable}` : `Move ${selectedTable}`}</h2><p>{th ? "เลือกโต๊ะว่างปลายทาง" : "Choose an available destination table."}</p></div><button className="icon-close" onClick={() => setMoveOpen(false)}>×</button></header><div className="move-table-grid">{TABLE_CODES.filter((code) => code !== selectedTable).map((code) => <button key={code} disabled={Boolean(tableBills[code])} onClick={() => moveTable(code)}><strong>{code}</strong><span>{tableBills[code] ? (th ? "มีบิล" : "Occupied") : (th ? "ว่าง" : "Available")}</span></button>)}</div></Modal> : null}

    {receipt ? <Modal className="receipt-success-modal" onClose={() => setReceipt(null)}><header className="desktop-pos-modal__header"><div><h2>{th ? "สรุปชำระเงินสำเร็จ" : "Payment complete"}</h2><p>{th ? "บันทึกการขายเรียบร้อย" : "Sale saved successfully."}</p></div><button className="close-text" onClick={() => setReceipt(null)}>{th ? "ปิดหน้าต่าง" : "Close"}</button></header><article className="receipt-preview"><img src="/icon.png" alt="CpIPOS"/><h3>{receipt.settings.storeName}</h3><p>{receipt.settings.branchName}</p><div className="receipt-meta"><span>{th ? "ผู้ขาย" : "Seller"}</span><strong>{staff.displayName}</strong><span>{th ? "เลขที่บิล" : "Receipt"}</span><strong>{receipt.receiptNo}</strong><span>{th ? "วันที่" : "Date"}</span><strong>{new Date(receipt.createdAt).toLocaleString(th ? "th-TH" : "en-US")}</strong></div><div className="receipt-lines">{receipt.items.map((item) => <div key={item.id || item.name}><span>{item.name} × {item.quantity}</span><strong>{money(item.lineTotal)}</strong></div>)}</div><div className="receipt-grand"><span>{th ? "ยอดที่ต้องชำระ" : "Total"}</span><strong>{money(receipt.total)}</strong></div><div className="receipt-lines"><div><span>{th ? "ชำระเงิน" : "Payment"}</span><strong>{receipt.paymentMethod === "cash" ? (th ? "เงินสด" : "Cash") : (th ? "โอน / QR" : "Transfer / QR")}</strong></div>{receipt.paymentMethod === "cash" ? <><div><span>{th ? "รับเงินจากลูกค้า" : "Received"}</span><strong>{money(receipt.paid)}</strong></div><div><span>{th ? "เงินทอน" : "Change"}</span><strong>{money(receipt.changeAmount)}</strong></div></> : null}</div><p className="receipt-footer">{receipt.settings.receiptFooter}</p></article><div className="receipt-actions"><button onClick={() => printDocument(receiptHtml(receipt))}>{th ? "พิมพ์ใบเสร็จ" : "Print receipt"}</button><button className="checkout-button" onClick={() => setReceipt(null)}>{th ? "เริ่มบิลใหม่" : "New sale"}</button></div></Modal> : null}
  </section>;
}
