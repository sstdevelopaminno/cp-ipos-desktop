import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PosRepository } from "../../data/repository";
import type { AppSettings, CartLine, Language, Product, Shift, Staff } from "../../domain/types";
import { productName } from "../../i18n";
import { listSalesTables, SALES_TABLES_EVENT, type SalesTable } from "../../sales-tables";
import { resolvePaymentQr } from "../../payment-qr";
import { productImageSrc } from "../../product-image";
import { printPaymentNoticeNative } from "../../payment-notice-print";
import { printReceiptNative, type PrintableReceipt } from "../../receipt-print";
import { useDesktopLicense } from "../license/LicenseGate";
import "./desktop-sales-workspace.css";

type SalesMode = "grocery" | "takeaway" | "dine_in";
type TableBill = { tableCode: string; billNo: string; openedAt: string; items: CartLine[] };
type TableBills = Record<string, TableBill>;
type PaymentStep = "review" | "cash" | "transfer" | null;
type NoticeKind = "ok" | "warn" | "error";

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

export function DesktopSalesWorkspace({ repo, staff, shift, settings, products, language, refreshProducts, fixedMode }: {
  repo: PosRepository;
  staff: Staff;
  shift: Shift;
  settings: AppSettings;
  products: Product[];
  language: Language;
  refreshProducts: () => Promise<void>;
  fixedMode?: "takeaway" | "dine_in";
}) {
  const license = useDesktopLicense();
  const th = language === "th";
  const [mode, setMode] = useState<SalesMode | null>(fixedMode ?? "takeaway");
  const [modePicker, setModePicker] = useState(false);
  const [groceryCart, setGroceryCart] = useState<CartLine[]>(() => readJson<CartLine[]>(GROCERY_CART_KEY, []));
  const [takeawayCart, setTakeawayCart] = useState<CartLine[]>(() => readJson<CartLine[]>(TAKEAWAY_CART_KEY, []));
  const [tableBills, setTableBills] = useState<TableBills>(() => readJson<TableBills>(TABLE_BILLS_KEY, {}));
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [salesTables, setSalesTables] = useState<SalesTable[]>(() => listSalesTables().filter((table) => table.active));
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [barcode, setBarcode] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const [paymentStep, setPaymentStep] = useState<PaymentStep>(null);
  const [cashInput, setCashInput] = useState("");
  const [receipt, setReceipt] = useState<PrintableReceipt | null>(null);
  const [cancelBillOpen, setCancelBillOpen] = useState(false);
  const [cancelPin, setCancelPin] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [online, setOnline] = useState(() => navigator.onLine);
  const [qrRenderSrc, setQrRenderSrc] = useState("");
  const [qrLoaded, setQrLoaded] = useState(false);

  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const refreshOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", refreshOnline);
    window.addEventListener("offline", refreshOnline);
    return () => {
      window.removeEventListener("online", refreshOnline);
      window.removeEventListener("offline", refreshOnline);
    };
  }, []);
  useEffect(() => {
    const refreshTables = () => setSalesTables(listSalesTables().filter((table) => table.active));
    window.addEventListener(SALES_TABLES_EVENT, refreshTables);
    return () => window.removeEventListener(SALES_TABLES_EVENT, refreshTables);
  }, []);
  useEffect(() => {
    if (!fixedMode) return;
    setMode(fixedMode);
    setModePicker(false);
    if (fixedMode !== "dine_in") setSelectedTable(null);
  }, [fixedMode]);
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
  const cashReceived = Number(cashInput || 0);
  const cashDifference = cashReceived - total;
  const activeTableBill = selectedTable ? tableBills[selectedTable] : undefined;
  const billNo = activeTableBill?.billNo ?? `DIN-${String(Date.now()).slice(-9)}`;
  const paymentQr = resolvePaymentQr(settings, total, online);
  const qrReady = paymentQr.ready && Boolean(qrRenderSrc) && qrLoaded;
  const canSwitchMode = cart.length === 0 && !selectedTable;

  useEffect(() => {
    setQrRenderSrc(paymentQr.src);
    setQrLoaded(false);
  }, [paymentQr.src]);

  const categories = useMemo(() => [{ id: "all", name: th ? "ทั้งหมด" : "All" }, ...Array.from(new Map(products.map((product) => [product.categoryId, { id: product.categoryId, name: product.categoryName }])).values())], [products, th]);
  const visibleProducts = useMemo(() => products.filter((product) => product.active && (category === "all" || product.categoryId === category) && (!query.trim() || `${product.productCode} ${product.barcode ?? ""} ${productName(language, product)} ${product.categoryName}`.toLowerCase().includes(query.trim().toLowerCase()))), [products, category, query, language]);

  const showNotice = (kind: NoticeKind, text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 2200);
  };

  const appendCashKey = (key: string) => {
    setCashInput((current) => {
      if (key === "." && current.includes(".")) return current;
      if (!current && key === ".") return "0.";
      if (!current && key === "00") return "0";
      if (current === "0" && /^\d+$/.test(key)) return key === "00" ? "0" : key;
      const next = `${current}${key}`;
      const decimal = next.split(".")[1];
      if (decimal && decimal.length > 2) return current;
      return next.length <= 12 ? next : current;
    });
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
    const tableCodeAtPayment = mode === "dine_in" ? selectedTable : null;
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
      const printableReceipt: PrintableReceipt | null = nextReceipt
        ? { ...nextReceipt, tableCode: tableCodeAtPayment }
        : null;

      clearCurrentBill();
      setPaymentStep(null);
      setCashInput("");

      if (printableReceipt) {
        setReceipt(printableReceipt);
        if (settings.printerAutoPrintReceipt !== false) {
          void printReceiptNative(printableReceipt).catch(() => {
            showNotice("warn", th ? "บันทึกบิลแล้ว แต่พิมพ์ใบเสร็จอัตโนมัติไม่สำเร็จ" : "Sale saved, but automatic receipt printing failed");
          });
        }
      }

      await refreshProducts();
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
    <div className="table-browser-toolbar"><div className="table-tabs"><button className="active">{th ? "รายการโต๊ะ" : "Table list"}</button><span>{th ? "ทั้งหมด" : "All"}</span></div></div>
    <div className="table-grid">{salesTables.map((table) => {
      const bill = tableBills[table.code];
      const amount = bill?.items.reduce((sum, line) => sum + line.quantity * line.price, 0) ?? 0;
      return <button key={table.id} className={bill ? "occupied" : "available"} onClick={() => openTable(table.code)}><strong>{table.code}</strong><span>{table.name}</span><small>{bill ? `${th ? "มีบิล" : "Open"} · ${bill.items.length} ${th ? "รายการ" : "items"} · ${money(amount)}` : (th ? "ว่าง · เปิดบิล" : "Available · Open bill")}</small></button>;
    })}</div>
  </section> : null;

  const renderCatalog = () => mode === "grocery" || mode === "takeaway" || selectedTable ? <section className={`product-browser ${mode !== "grocery" ? "product-browser--restaurant" : ""}`}>
    {mode === "grocery" ? <div className="catalog-tools"><button className="orange-chip">{th ? "เครื่องดื่ม" : "Products"}</button><label className="search-field"><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={th ? "ค้นหาสินค้า" : "Search products"}/></label><label className="scan-field"><input ref={scanRef} value={barcode} onChange={(event) => setBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void scanBarcode(); }} placeholder={th ? "สแกนบาร์โค้ด" : "Scan barcode"}/><button onClick={() => void scanBarcode()}>{th ? "เพิ่ม" : "Add"}</button></label></div> : null}
    <div className={`category-row ${mode !== "grocery" ? "category-row--restaurant-top" : ""}`}>{categories.map((item) => <button key={item.id} className={category === item.id ? "active" : ""} onClick={() => setCategory(item.id)}>{item.name}</button>)}</div>
    <div className="desktop-product-grid">{visibleProducts.map((product) => <button key={product.id} className="desktop-product-card" disabled={product.stockQuantity <= 0} onClick={() => addProduct(product)}><span className="product-image">{product.imagePath ? <img src={productImageSrc(product.imagePath)} alt=""/> : productName(language, product).slice(0, 1)}</span><strong>{productName(language, product)}</strong><small>{product.barcode || product.productCode}</small><em>{th ? "คงเหลือ" : "Stock"}: {product.stockQuantity}</em><b>{money(product.price)}</b></button>)}</div>
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

    {paymentStep === "review" ? <Modal className="payment-review-modal" onClose={() => setPaymentStep(null)}><header className="desktop-pos-modal__header"><div><h2>{th ? "รายการก่อนชำระเงิน" : "Review before payment"}</h2><p>{th ? "ตรวจสอบรายการสินค้าและยอดรวมก่อนเลือกวิธีชำระเงิน" : "Review items and total before choosing payment method."}</p></div><button className="close-text" onClick={() => setPaymentStep(null)}>{th ? "ปิด" : "Close"}</button></header><div className="review-table"><div className="review-head"><span>{th ? "รายการสินค้า" : "Item"}</span><span>{th ? "จำนวน" : "Qty"}</span><span>{th ? "รวมต่อรายการ" : "Total"}</span></div>{cart.map((line) => <div className="review-row" key={line.id}><span><strong>{productName(language, line)}</strong><small>{line.quantity} x {money(line.price)}</small></span><b>{line.quantity}</b><strong>{money(line.quantity * line.price)}</strong></div>)}</div><div className="review-total"><span>{th ? "รวมยอด" : "Grand total"}</span><strong>{money(total)}</strong></div><div className="modal-actions"><button className="cancel-action" onClick={() => setCancelBillOpen(true)}>{th ? "ยกเลิกบิล" : "Cancel bill"}</button><button className="cash-action" onClick={() => { setCashInput(""); setPaymentStep("cash"); }}>{th ? "ชำระเงินสด" : "Cash"}</button><button className="transfer-action" onClick={() => setPaymentStep("transfer")}>{th ? "ชำระเงินโอน" : "Transfer / QR"}</button></div></Modal> : null}

    {paymentStep === "cash" ? <Modal className="desktop-cash-payment-modal" onClose={() => !busy && setPaymentStep("review")}><header className="desktop-pos-modal__header"><div><h2>{th ? "รับชำระเงินสด" : "Cash payment"}</h2><p>{th ? "กรอกจำนวนเงินที่รับจากลูกค้า" : "Enter cash received."}</p></div><button className="close-text" onClick={() => setPaymentStep("review")}>{th ? "ปิด" : "Close"}</button></header><div className="desktop-cash-layout"><section className="desktop-cash-panel"><div className="desktop-cash-summary-row desktop-cash-summary-row--due"><span>{th ? "ยอดที่ต้องชำระ" : "Amount due"}</span><strong>{money(total)}</strong></div><div className="desktop-cash-summary-row desktop-cash-summary-row--received"><span>{th ? "รับเงินจากลูกค้า" : "Received"}</span><strong className={!cashInput ? "is-placeholder" : ""}>{money(cashReceived)}</strong></div><div className="desktop-cash-quick"><span>{th ? "บล็อกรับเงินด่วน" : "Quick cash"}</span><div>{[500, 1000, 1500].map((amount) => <button key={amount} onClick={() => setCashInput(String(amount))}>{money(amount)}</button>)}</div></div><div className={`desktop-cash-summary-row desktop-cash-summary-row--difference ${cashDifference >= 0 ? "is-change" : "is-remaining"}`}><span>{cashDifference >= 0 ? (th ? "เงินทอน" : "Change") : (th ? "ยังขาด" : "Remaining")}</span><strong>{money(Math.abs(cashDifference))}</strong></div></section><section className="desktop-cash-keypad"><span className="desktop-cash-keypad__label">{th ? "แป้นตัวเลข" : "Keypad"}</span><div className="desktop-cash-keypad__grid">{["1","2","3","4","5","6","7","8","9","0","00","."].map((key) => <button key={key} onClick={() => appendCashKey(key)}>{key}</button>)}</div><div className="desktop-cash-keypad__foot"><button onClick={() => setCashInput("")}>{th ? "ล้าง" : "Clear"}</button><button onClick={() => setCashInput((current) => current.slice(0, -1))}>{th ? "ลบ" : "Back"}</button></div></section></div><div className="modal-actions modal-actions--spread desktop-cash-actions"><button className="cancel-action" onClick={() => setCancelBillOpen(true)}>{th ? "ยกเลิกบิล" : "Cancel bill"}</button><button className="cash-action" disabled={busy || cashReceived < total} onClick={() => void completePayment("cash", cashReceived)}>{busy ? (th ? "กำลังบันทึก..." : "Saving...") : (th ? "ยืนยันชำระ" : "Confirm payment")}</button></div></Modal> : null}

    {paymentStep === "transfer" ? <Modal className="desktop-transfer-payment-modal" onClose={() => !busy && setPaymentStep("review")}><header className="desktop-pos-modal__header"><div><h2>{th ? "รับชำระเงินโอน" : "Transfer / QR payment"}</h2><p>{paymentQr.mode === "promptpay_online" ? (th ? "PromptPay Online · QR ล็อกยอดตามบิล" : "PromptPay Online · amount-locked QR") : paymentQr.mode === "bank_image_offline" ? (th ? "QR ธนาคารสำรอง" : "Bank QR fallback") : (th ? "ยังไม่มี QR พร้อมใช้งาน" : "QR not configured")}</p></div><button className="icon-close" onClick={() => setPaymentStep("review")}>×</button></header><div className="desktop-transfer-amount"><span>{th ? "ยอดชำระ" : "Amount due"}</span><strong>{money(total)}</strong></div><h3>{th ? "สแกน QR เพื่อชำระเงิน" : "Scan QR to pay"}</h3>{paymentQr.ready && qrRenderSrc ? <div className="desktop-qr-payment-box"><img src={qrRenderSrc} alt="QR Payment" onLoad={() => setQrLoaded(true)} onError={() => { if (settings.paymentQrImage && qrRenderSrc !== settings.paymentQrImage) { setQrRenderSrc(settings.paymentQrImage); setQrLoaded(false); } else { setQrRenderSrc(""); setQrLoaded(false); } }}/><strong>{paymentQr.label || (th ? "บัญชีรับชำระ" : "Payment account")}</strong><small>{paymentQr.mode === "promptpay_online" ? (th ? `ยอดถูกกำหนดไว้ที่ ${money(total)}` : `Amount locked to ${money(total)}`) : (th ? "QR คงที่จากธนาคาร · ตรวจสอบยอดก่อนยืนยัน" : "Static bank QR · verify amount before confirming")}</small>{settings.paymentQrNote ? <small>{settings.paymentQrNote}</small> : null}</div> : <div className="desktop-qr-required-box"><b>!</b><strong>{th ? "ยังไม่มี QR พร้อมใช้งาน" : "Payment QR is not available"}</strong><p>{online ? (th ? "ไปที่ ตั้งค่า > ตั้งค่า QR ชำระเงิน แล้วกรอกหมายเลข PromptPay หรืออัปโหลดภาพ QR สำรอง" : "Configure PromptPay or a fallback bank QR in Settings.") : (th ? "เครื่องออฟไลน์ กรุณาอัปโหลดภาพ QR ธนาคารสำรองในเมนูตั้งค่า" : "Offline: configure a fallback bank QR image.")}</p></div>}<div className="desktop-transfer-actions">{mode === "dine_in" ? <button disabled={!qrReady || !settings.printerName} onClick={() => void printPaymentNoticeNative({ settings, staff, tableCode: selectedTable, billNo, items: cart, total, qrSrc: qrRenderSrc, fallbackQrSrc: settings.paymentQrImage, qrMode: paymentQr.mode }).then(() => showNotice("ok", th ? "ส่งใบแจ้งชำระเงินไปเครื่องพิมพ์แล้ว" : "Payment notice sent to printer")).catch(() => showNotice("error", th ? "พิมพ์ใบแจ้งชำระเงินไม่สำเร็จ ตรวจสอบเครื่องพิมพ์และ QR" : "Payment notice print failed"))}>{settings.printerName ? (th ? "พิมพ์ใบแจ้งชำระเงิน" : "Print payment notice") : (th ? "ตั้งค่าเครื่องพิมพ์ก่อน" : "Configure printer")}</button> : null}<button className="desktop-transfer-confirm" disabled={!qrReady || busy} onClick={() => void completePayment("transfer", total)}>{busy ? (th ? "กำลังบันทึก..." : "Saving...") : (th ? "ยืนยันรับชำระแล้ว" : "Confirm paid")}</button></div></Modal> : null}

    {cancelBillOpen ? <Modal className="cancel-bill-modal" onClose={() => !busy && setCancelBillOpen(false)}><header className="desktop-pos-modal__header"><div><h2>{th ? "ยกเลิกบิล" : "Cancel bill"}</h2><p>{th ? "ต้องยืนยันด้วย PIN ผู้จัดการหรือเจ้าของร้าน" : "Owner or manager PIN is required."}</p></div><button className="icon-close" onClick={() => setCancelBillOpen(false)}>×</button></header><label>PIN<input type="password" value={cancelPin} onChange={(event) => setCancelPin(event.target.value)}/></label><label>{th ? "เหตุผล" : "Reason"}<input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)}/></label>{cancelError ? <p className="form-error">{cancelError}</p> : null}<div className="modal-actions"><button onClick={() => setCancelBillOpen(false)}>{th ? "กลับ" : "Back"}</button><button className="cancel-action" disabled={busy || !cancelPin || !cancelReason.trim()} onClick={() => void cancelCurrentBill()}>{th ? "ยืนยันยกเลิกบิล" : "Confirm cancellation"}</button></div></Modal> : null}

    {moveOpen && selectedTable ? <Modal className="move-table-modal" onClose={() => setMoveOpen(false)}><header className="desktop-pos-modal__header"><div><h2>{th ? `ย้ายโต๊ะ ${selectedTable}` : `Move ${selectedTable}`}</h2><p>{th ? "เลือกโต๊ะว่างปลายทางจากรายการโต๊ะที่เปิดใช้งาน" : "Choose an available active table."}</p></div><button className="icon-close" onClick={() => setMoveOpen(false)}>×</button></header><div className="move-table-grid">{salesTables.filter((table) => table.code !== selectedTable).map((table) => <button key={table.id} disabled={Boolean(tableBills[table.code])} onClick={() => moveTable(table.code)}><strong>{table.code}</strong><span>{tableBills[table.code] ? (th ? "มีบิล" : "Occupied") : table.name}</span></button>)}</div></Modal> : null}

    {receipt ? <Modal className="receipt-success-modal" onClose={() => setReceipt(null)}><header className="desktop-pos-modal__header"><div><h2>{th ? "สรุปชำระเงินสำเร็จ" : "Payment complete"}</h2><p>{th ? "บันทึกการขายเรียบร้อย" : "Sale saved successfully."}</p></div><button className="close-text" onClick={() => setReceipt(null)}>{th ? "ปิดหน้าต่าง" : "Close"}</button></header><article className="receipt-preview"><img src="/icon.png" alt="CpIPOS"/><h3>{receipt.settings.storeName}</h3><p>{receipt.settings.branchName}</p><div className="receipt-meta"><span>{th ? "ผู้ขาย" : "Seller"}</span><strong>{staff.displayName}</strong>{receipt.tableCode ? <><span>{th ? "โต๊ะ" : "Table"}</span><strong>{receipt.tableCode}</strong></> : null}<span>{th ? "เลขที่บิล" : "Receipt"}</span><strong>{receipt.receiptNo}</strong><span>{th ? "วันที่" : "Date"}</span><strong>{new Date(receipt.createdAt).toLocaleString(th ? "th-TH" : "en-US")}</strong></div><div className="receipt-lines">{receipt.items.map((item) => <div key={item.id || item.name}><span>{item.name} × {item.quantity}</span><strong>{money(item.lineTotal)}</strong></div>)}</div><div className="receipt-grand"><span>{th ? "ยอดที่ต้องชำระ" : "Total"}</span><strong>{money(receipt.total)}</strong></div><div className="receipt-lines"><div><span>{th ? "ชำระเงิน" : "Payment"}</span><strong>{receipt.paymentMethod === "cash" ? (th ? "เงินสด" : "Cash") : (th ? "โอน / QR" : "Transfer / QR")}</strong></div>{receipt.paymentMethod === "cash" ? <><div><span>{th ? "รับเงินจากลูกค้า" : "Received"}</span><strong>{money(receipt.paid)}</strong></div><div><span>{th ? "เงินทอน" : "Change"}</span><strong>{money(receipt.changeAmount)}</strong></div></> : null}</div><p className="receipt-footer">{receipt.settings.receiptFooter}</p></article><div className="receipt-actions"><button disabled={!settings.printerName} onClick={() => void printReceiptNative(receipt).then(() => showNotice("ok", th ? "ส่งใบเสร็จไปเครื่องพิมพ์แล้ว" : "Receipt sent to printer")).catch(() => showNotice("error", th ? "พิมพ์ใบเสร็จไม่สำเร็จ" : "Receipt print failed"))}>{settings.printerName ? (th ? "พิมพ์ใบเสร็จ" : "Print receipt") : (th ? "ตั้งค่าเครื่องพิมพ์ก่อน" : "Configure printer")}</button><button className="checkout-button" onClick={() => setReceipt(null)}>{th ? "เริ่มบิลใหม่" : "New sale"}</button></div></Modal> : null}
  </section>;
}
