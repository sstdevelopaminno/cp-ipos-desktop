import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppSettings, CartLine, Language, Product, Receipt, Shift, Staff } from "./domain/types";
import type { PosRepository, ProductInput } from "./data/repository";
import { productName } from "./i18n";
import "./grocery-sales.css";

type Props = {
  repo: PosRepository;
  staff: Staff;
  shift: Shift;
  settings: AppSettings;
  products: Product[];
  language: Language;
  refreshProducts: () => Promise<void>;
};

type ToastState = { kind: "ok" | "warn" | "error"; text: string } | null;
type Discount = { type: "amount" | "percent"; value: number } | null;
type PricedReceipt = Receipt & {
  subtotal?: number;
  discountAmount?: number;
  discountType?: "amount" | "percent";
  discountValue?: number;
};

type CheckoutLine = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  originalUnitPrice: number;
  discountType: "none" | "amount" | "percent";
  discountValue: number;
};

const moneyNumber = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n: number) => `฿${moneyNumber(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const roundQty = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
const cleanCode = (value: string) => value.trim().replace(/\s+/g, "");
const normalizeCode = (value: string) => cleanCode(value).toLowerCase();

function priceCart(cart: CartLine[], discount: Discount, language: Language) {
  const subtotal = moneyNumber(cart.reduce((sum, line) => sum + line.quantity * line.price, 0));
  const requestedDiscount = discount
    ? discount.type === "percent"
      ? moneyNumber(subtotal * Math.min(100, Math.max(0, discount.value)) / 100)
      : moneyNumber(Math.min(subtotal, Math.max(0, discount.value)))
    : 0;
  const rate = subtotal > 0 ? requestedDiscount / subtotal : 0;
  const checkoutItems: CheckoutLine[] = cart.map(line => ({
    productId: line.id,
    name: productName(language, line),
    quantity: roundQty(line.quantity),
    unitPrice: moneyNumber(line.price * (1 - rate)),
    originalUnitPrice: moneyNumber(line.price),
    discountType: discount?.type || "none",
    discountValue: moneyNumber(discount?.value || 0),
  }));
  const total = moneyNumber(checkoutItems.reduce((sum, line) => sum + line.quantity * moneyNumber(line.unitPrice), 0));
  const discountAmount = moneyNumber(Math.max(0, subtotal - total));
  return { subtotal, total, discountAmount, checkoutItems };
}

export function RetailSalesScreen({ repo, staff, shift, settings, products, language, refreshProducts }: Props) {
  const scanRef = useRef<HTMLInputElement>(null);
  const unknownTimerRef = useRef<number | null>(null);
  const cartRef = useRef<CartLine[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scanValue, setScanValue] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [paymentChoice, setPaymentChoice] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discount, setDiscount] = useState<Discount>(null);
  const [receipt, setReceipt] = useState<PricedReceipt | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [unknownBarcode, setUnknownBarcode] = useState("");
  const [quickAddBarcode, setQuickAddBarcode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totalQty = cart.reduce((sum, line) => sum + line.quantity, 0);
  const pricing = useMemo(() => priceCart(cart, discount, language), [cart, discount, language]);

  const productIndex = useMemo(() => {
    const index = new Map<string, Product>();
    for (const product of products) {
      if (!product.active) continue;
      const barcode = normalizeCode(product.barcode || "");
      const code = normalizeCode(product.productCode || "");
      if (barcode) index.set(barcode, product);
      if (code) index.set(code, product);
    }
    return index;
  }, [products]);

  const replaceCart = (rows: CartLine[]) => {
    cartRef.current = rows;
    setCart(rows);
    if (!rows.length) setDiscount(null);
  };

  const focusScanner = () => window.setTimeout(() => scanRef.current?.focus(), 20);
  const notify = (kind: NonNullable<ToastState>["kind"], text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 1500);
  };

  const addProduct = (product: Product, quantity = 1) => {
    const rows = cartRef.current;
    const existing = rows.find(x => x.id === product.id);
    const current = existing?.quantity || 0;
    const nextQuantity = roundQty(current + quantity);
    if (product.stockQuantity >= 0 && nextQuantity > product.stockQuantity) {
      notify("warn", `สต๊อกไม่พอ · คงเหลือ ${product.stockQuantity} ${product.unit}`);
      focusScanner();
      return;
    }
    const nextRows = existing
      ? rows.map(x => x.id === product.id ? { ...x, quantity: nextQuantity } : x)
      : [...rows, { ...product, quantity: roundQty(quantity) }];
    replaceCart(nextRows);
    focusScanner();
  };

  const setQuantity = (line: CartLine, quantity: number) => {
    const nextQuantity = Math.max(0.001, roundQty(quantity));
    if (nextQuantity > line.stockQuantity) {
      notify("warn", `สต๊อกไม่พอ · คงเหลือ ${line.stockQuantity} ${line.unit}`);
      return;
    }
    replaceCart(cartRef.current.map(x => x.id === line.id ? { ...x, quantity: nextQuantity } : x));
    focusScanner();
  };

  const removeLine = async (line: CartLine) => {
    replaceCart(cartRef.current.filter(x => x.id !== line.id));
    focusScanner();
    try {
      await repo.recordCartItemRemoved(line, line.quantity, staff, shift, settings.deviceId);
    } catch {
      // Keep the checkout UI responsive even if a non-financial audit write fails.
    }
  };

  const resolveScan = async (raw: string, showUnknown = true) => {
    const rawCode = cleanCode(raw);
    const key = normalizeCode(rawCode);
    if (!key) return;

    const memoryProduct = productIndex.get(key);
    if (memoryProduct) {
      setScanValue("");
      addProduct(memoryProduct);
      return;
    }

    try {
      const found = await repo.findProductByBarcode(rawCode) || await repo.findProductByCode(rawCode);
      if (found && found.active) {
        setScanValue("");
        addProduct(found);
        return;
      }
    } catch {
      notify("error", "ค้นหาสินค้าไม่สำเร็จ");
      focusScanner();
      return;
    }

    if (showUnknown) {
      setScanValue("");
      setUnknownBarcode(rawCode);
    }
    focusScanner();
  };

  const onScanChange = (value: string) => {
    setScanValue(value);
    const key = normalizeCode(value);
    if (!key) return;
    const found = productIndex.get(key);
    if (found) {
      setScanValue("");
      addProduct(found);
    }
  };

  useEffect(() => {
    if (unknownTimerRef.current !== null) window.clearTimeout(unknownTimerRef.current);
    const key = normalizeCode(scanValue);
    if (!key || key.length < 5 || productIndex.has(key)) return;
    unknownTimerRef.current = window.setTimeout(() => {
      void resolveScan(scanValue, true);
    }, 160);
    return () => {
      if (unknownTimerRef.current !== null) window.clearTimeout(unknownTimerRef.current);
    };
  }, [scanValue, productIndex]);

  useEffect(() => {
    focusScanner();
    return () => {
      if (unknownTimerRef.current !== null) window.clearTimeout(unknownTimerRef.current);
    };
  }, []);

  const completeSale = async (method: "cash" | "transfer", paid: number) => {
    if (busy || !cartRef.current.length) return;
    const cartSnapshot = [...cartRef.current];
    const priced = priceCart(cartSnapshot, discount, language);
    setBusy(true);
    try {
      const sale = await repo.checkout({
        items: priced.checkoutItems,
        paymentMethod: method,
        paid,
        staff,
        shift,
        deviceId: settings.deviceId,
      });
      const savedReceipt = await repo.getReceipt(sale.id);
      const grossItems = cartSnapshot.map(line => ({
        productId: line.id,
        name: productName(language, line),
        quantity: line.quantity,
        unitPrice: line.price,
        lineTotal: moneyNumber(line.price * line.quantity),
      }));
      const preview: PricedReceipt = savedReceipt
        ? {
            ...savedReceipt,
            total: sale.total,
            paid: sale.paid,
            changeAmount: sale.changeAmount,
            items: priced.discountAmount > 0 ? grossItems : savedReceipt.items,
            subtotal: priced.subtotal,
            discountAmount: priced.discountAmount,
            discountType: discount?.type,
            discountValue: discount?.value,
          }
        : {
            ...sale,
            items: grossItems,
            settings,
            subtotal: priced.subtotal,
            discountAmount: priced.discountAmount,
            discountType: discount?.type,
            discountValue: discount?.value,
          };
      replaceCart([]);
      setDiscount(null);
      setPaymentChoice(false);
      setCashOpen(false);
      setTransferOpen(false);
      setReceipt(preview);
      await refreshProducts();
      notify("ok", `บันทึกบิล ${sale.receiptNo} แล้ว`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "บันทึกการขายไม่สำเร็จ");
    } finally {
      setBusy(false);
      focusScanner();
    }
  };

  const clearAll = async () => {
    const rows = cartRef.current;
    if (!rows.length) {
      setClearOpen(false);
      return;
    }
    try {
      await repo.cancelBill({
        items: rows.map(line => ({ productId: line.id, name: productName(language, line), quantity: line.quantity, unitPrice: line.price })),
        reason: "ล้างรายการทั้งหมดก่อนชำระเงิน",
        staff,
        shift,
        deviceId: settings.deviceId,
      });
    } catch {
      // Clearing an unpaid cart remains available even when a non-financial audit write fails.
    }
    replaceCart([]);
    setDiscount(null);
    setClearOpen(false);
    notify("ok", "ล้างรายการทั้งหมดแล้ว");
    focusScanner();
  };

  return <section className="grocery-pos-layout">
    <div className="grocery-pos-main">
      <section className="grocery-scan-zone">
        <div className="grocery-scan-title">
          <strong>SD · ขายทั่วไป · สแกน SKU</strong>
          <small>ยิงบาร์โค้ดหรือกรอก SKU — สินค้าที่พบจะลงตะกร้าอัตโนมัติทันที</small>
        </div>
        <div className="grocery-scan-row">
          <input
            ref={scanRef}
            value={scanValue}
            onChange={e => onScanChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                void resolveScan(scanValue, true);
              }
            }}
            placeholder="ยิงบาร์โค้ด / กรอก SKU"
            autoComplete="off"
            autoFocus
          />
          <div className="scanner-ready"><span className="scanner-ready-dot"/><span>พร้อมสแกน</span></div>
          <button className="scan-clear-all" disabled={!cart.length || busy} onClick={() => setClearOpen(true)}>ล้างรายการทั้งหมด</button>
        </div>
        <div className="grocery-scan-status">{cart.length ? `ตะกร้า: ${cart.length} รายการ / ${roundQty(totalQty)} ชิ้น` : "พร้อมรับการสแกนสินค้า"}</div>
      </section>

      <section className="grocery-table-panel">
        <header>
          <div><strong>ตารางขายสินค้า · {cart.length} รายการ · {roundQty(totalQty)} ชิ้น</strong>{pricing.discountAmount > 0 && <small>ส่วนลด {money(pricing.discountAmount)}</small>}</div>
          <div className="grocery-table-header-actions"><button disabled={!cart.length || busy} onClick={() => setClearOpen(true)}>ล้างตาราง</button><b>{money(pricing.total)}</b></div>
        </header>
        <div className="grocery-table-scroll-v2">
          <table className="grocery-table-v2">
            <thead><tr><th>#</th><th>SKU / บาร์โค้ด</th><th>หมวดหมู่</th><th>สินค้า</th><th>จำนวน</th><th>ราคา/หน่วย</th><th>ราคารวม</th><th>ลบ</th></tr></thead>
            <tbody>{cart.map((line, index) => <tr key={line.id}>
              <td>{index + 1}</td>
              <td><strong>{line.productCode}</strong><small>{line.barcode || "-"}</small></td>
              <td>{line.categoryName}</td>
              <td><strong>{productName(language, line)}</strong><small>คงเหลือ {line.stockQuantity} {line.unit}</small></td>
              <td><div className="grocery-qty-control"><button onClick={() => setQuantity(line, line.quantity - 1)}>−</button><input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e => setQuantity(line, Number(e.target.value || 1))}/><button onClick={() => setQuantity(line, line.quantity + 1)}>+</button></div></td>
              <td>{money(line.price)}</td>
              <td><strong>{money(line.price * line.quantity)}</strong></td>
              <td><button className="grocery-remove-line" onClick={() => void removeLine(line)}>×</button></td>
            </tr>)}</tbody>
          </table>
          {!cart.length && <div className="grocery-empty-table"><strong>ยังไม่มีสินค้าในตะกร้า</strong><span>ยิงบาร์โค้ดหรือกรอก SKU เพื่อเริ่มขาย</span></div>}
        </div>
      </section>
    </div>

    <aside className="grocery-checkout-panel">
      <div className="grocery-checkout-mode"><span>โหมดขาย</span><strong>ร้านของชำ</strong></div>
      <div className="grocery-checkout-summary">
        <div><span>ยอดสินค้า</span><strong>{money(pricing.subtotal)}</strong></div>
        {pricing.discountAmount > 0 && <div className="discount-row"><span>ส่วนลด</span><strong>−{money(pricing.discountAmount)}</strong></div>}
        <div className="grand-total"><span>ยอดชำระ</span><strong>{money(pricing.total)}</strong></div>
      </div>
      <div className="grocery-shortcuts">
        <button disabled title="พักบิลจะพัฒนาในรอบถัดไป"><span>▣</span><strong>พักบิล</strong></button>
        <button disabled title="ระบบสมาชิกจะพัฒนาในรอบถัดไป"><span>♙</span><strong>สมาชิก</strong></button>
        <button className={discount ? "active" : ""} disabled={!cart.length || busy} onClick={() => setDiscountOpen(true)}><span>%</span><strong>ส่วนลด</strong>{pricing.discountAmount > 0 && <small>{money(pricing.discountAmount)}</small>}</button>
      </div>
      <button className="grocery-pay-button" disabled={!cart.length || busy} onClick={() => setPaymentChoice(true)}>{busy ? "กำลังบันทึก..." : "ชำระเงิน"}</button>
      <button className="grocery-cancel-button" disabled={!cart.length || busy} onClick={() => setCancelOpen(true)}>ยกเลิกบิล</button>
    </aside>

    {toast && <div className={`grocery-toast ${toast.kind}`}>{toast.text}</div>}
    {paymentChoice && <PaymentChoice total={pricing.total} onClose={() => setPaymentChoice(false)} onCash={() => { setPaymentChoice(false); setCashOpen(true); }} onTransfer={() => { setPaymentChoice(false); setTransferOpen(true); }} />}
    {cashOpen && <CashPayment total={pricing.total} busy={busy} onClose={() => setCashOpen(false)} onConfirm={paid => completeSale("cash", paid)} />}
    {transferOpen && <TransferPayment total={pricing.total} busy={busy} onClose={() => setTransferOpen(false)} onConfirm={() => completeSale("transfer", pricing.total)} />}
    {discountOpen && <DiscountModal subtotal={pricing.subtotal} current={discount} onClose={() => setDiscountOpen(false)} onApply={next => { setDiscount(next); setDiscountOpen(false); focusScanner(); }} />}
    {receipt && <ReceiptView receipt={receipt} onClose={() => { setReceipt(null); focusScanner(); }} />}
    {clearOpen && <ClearCartModal count={cart.length} onClose={() => setClearOpen(false)} onConfirm={() => void clearAll()} />}
    {cancelOpen && <CancelCart repo={repo} cart={cart} staff={staff} shift={shift} settings={settings} onClose={() => setCancelOpen(false)} onDone={() => { replaceCart([]); setDiscount(null); setCancelOpen(false); focusScanner(); }} />}
    {unknownBarcode && <SimpleModal title="ไม่พบสินค้า" onClose={() => { setUnknownBarcode(""); focusScanner(); }}><div className="grocery-unknown-code">{unknownBarcode}</div><p>ยังไม่มีบาร์โค้ด/SKU นี้ในฐานข้อมูลเครื่อง</p><div className="grocery-modal-actions"><button className="secondary-action" onClick={() => { setUnknownBarcode(""); focusScanner(); }}>ปิด</button><button onClick={() => { setQuickAddBarcode(unknownBarcode); setUnknownBarcode(""); }}>เพิ่มสินค้าใหม่</button></div></SimpleModal>}
    {quickAddBarcode !== null && <QuickAddProduct repo={repo} staff={staff} barcode={quickAddBarcode} onClose={() => { setQuickAddBarcode(null); focusScanner(); }} onSaved={async product => { setQuickAddBarcode(null); await refreshProducts(); addProduct(product); }} />}
  </section>;
}

function PaymentChoice({ total, onClose, onCash, onTransfer }: { total: number; onClose: () => void; onCash: () => void; onTransfer: () => void }) {
  return <SimpleModal title="เลือกวิธีชำระเงิน" onClose={onClose}><div className="grocery-payment-total">ยอดชำระ <strong>{money(total)}</strong></div><div className="grocery-payment-choice"><button onClick={onCash}><span>฿</span><strong>เงินสด</strong><small>เปิดหน้ารับเงินและคำนวณเงินทอน</small></button><button onClick={onTransfer}><span>⇄</span><strong>เงินโอน</strong><small>พนักงานตรวจสอบยอดเข้าจริงก่อนยืนยัน</small></button></div></SimpleModal>;
}

function CashPayment({ total, busy, onClose, onConfirm }: { total: number; busy: boolean; onClose: () => void; onConfirm: (paid: number) => Promise<void> }) {
  const [value, setValue] = useState("");
  const paid = Number(value || 0);
  const press = (key: string) => setValue(v => key === "clear" ? "" : key === "back" ? v.slice(0, -1) : key === "." && v.includes(".") ? v : key === "." && !v ? "0." : `${v}${key}`);
  return <SimpleModal title="รับชำระเงินสด" onClose={busy ? () => {} : onClose}><div className="grocery-cash-summary"><div><span>ยอดชำระ</span><strong>{money(total)}</strong></div><div><span>รับเงิน</span><strong>{money(paid)}</strong></div><div className="change"><span>เงินทอน</span><strong>{money(Math.max(0, paid - total))}</strong></div></div><div className="grocery-cash-quick"><button onClick={() => setValue(String(total))}>ยอดพอดี</button>{[100,200,500,1000].filter(v => v >= total).map(v => <button key={v} onClick={() => setValue(String(v))}>{v}</button>)}</div><div className="grocery-cash-keypad">{["1","2","3","4","5","6","7","8","9","00","0","."].map(key => <button key={key} onClick={() => press(key)}>{key}</button>)}</div><div className="grocery-keypad-actions"><button onClick={() => press("clear")}>ล้าง</button><button onClick={() => press("back")}>ลบ</button></div><div className="grocery-modal-actions"><button className="secondary-action" disabled={busy} onClick={onClose}>ยกเลิก</button><button disabled={busy || paid < total} onClick={() => void onConfirm(paid)}>{busy ? "กำลังบันทึก..." : `ยืนยันรับเงิน ${money(paid)}`}</button></div></SimpleModal>;
}

function TransferPayment({ total, busy, onClose, onConfirm }: { total: number; busy: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  return <SimpleModal title="ชำระด้วยเงินโอน" onClose={busy ? () => {} : onClose}><div className="grocery-payment-total">ยอดชำระ <strong>{money(total)}</strong></div><div className="grocery-transfer-warning"><strong>ตรวจสอบยอดเงินจริงก่อนยืนยัน</strong><p>ระบบ Offline บันทึกวิธีชำระเงินเท่านั้น และไม่ได้เชื่อมต่อธนาคารหรือ PromptPay เพื่อตรวจสอบยอดอัตโนมัติ</p></div><div className="grocery-modal-actions"><button className="secondary-action" disabled={busy} onClick={onClose}>ยกเลิก</button><button disabled={busy} onClick={() => void onConfirm()}>{busy ? "กำลังบันทึก..." : "ยืนยันรับชำระ"}</button></div></SimpleModal>;
}

function DiscountModal({ subtotal, current, onClose, onApply }: { subtotal: number; current: Discount; onClose: () => void; onApply: (discount: Discount) => void }) {
  const [type, setType] = useState<"amount" | "percent">(current?.type || "percent");
  const [value, setValue] = useState(String(current?.value || ""));
  const numeric = Math.max(0, Number(value || 0));
  const capped = type === "percent" ? Math.min(100, numeric) : Math.min(subtotal, numeric);
  const preview = type === "percent" ? moneyNumber(subtotal * capped / 100) : moneyNumber(capped);
  return <SimpleModal title="ส่วนลดทั้งบิล" onClose={onClose}>
    <div className="discount-type-switch"><button className={type === "percent" ? "active" : ""} onClick={() => setType("percent")}>เปอร์เซ็นต์ (%)</button><button className={type === "amount" ? "active" : ""} onClick={() => setType("amount")}>จำนวนเงิน (บาท)</button></div>
    <label className="discount-input">{type === "percent" ? "ส่วนลดเปอร์เซ็นต์" : "ส่วนลดเป็นบาท"}<div><input type="number" min="0" max={type === "percent" ? 100 : subtotal} value={value} onChange={e => setValue(e.target.value)} autoFocus/><span>{type === "percent" ? "%" : "บาท"}</span></div></label>
    {type === "percent" && <div className="discount-quick">{[5,10,15,20].map(v => <button key={v} onClick={() => setValue(String(v))}>{v}%</button>)}</div>}
    <div className="discount-preview"><span>ยอดสินค้า</span><strong>{money(subtotal)}</strong><span>ส่วนลดประมาณ</span><strong>−{money(preview)}</strong><span>ยอดหลังส่วนลด</span><strong>{money(Math.max(0, subtotal - preview))}</strong></div>
    <div className="grocery-modal-actions"><button className="secondary-action" onClick={() => onApply(null)}>ล้างส่วนลด</button><button className="secondary-action" onClick={onClose}>ยกเลิก</button><button disabled={capped <= 0} onClick={() => onApply({ type, value: capped })}>ใช้ส่วนลด</button></div>
  </SimpleModal>;
}

function ReceiptView({ receipt, onClose }: { receipt: PricedReceipt; onClose: () => void }) {
  const subtotal = receipt.subtotal ?? moneyNumber(receipt.items.reduce((sum, item) => sum + Math.max(0, item.lineTotal), 0));
  const discountAmount = receipt.discountAmount ?? moneyNumber(Math.max(0, subtotal - receipt.total));
  const print80 = () => window.print();
  return <SimpleModal title={`ใบเสร็จ ${receipt.receiptNo}`} onClose={onClose} wide={false}>
    <div className="receipt-preview-shell"><div className="receipt-paper-80">
      <h2>{receipt.settings.receiptHeader || receipt.settings.storeName}</h2>
      <p>{receipt.settings.branchName}</p>
      {receipt.settings.address && <p>{receipt.settings.address}</p>}
      {receipt.settings.phone && <p>โทร {receipt.settings.phone}</p>}
      {receipt.settings.taxId && <p>เลขประจำตัวผู้เสียภาษี {receipt.settings.taxId}</p>}
      <div className="receipt-meta"><span>เลขที่ {receipt.receiptNo}</span><span>{new Date(receipt.createdAt).toLocaleString("th-TH")}</span><span>พนักงาน {receipt.cashierName || receipt.employeeCode || "-"}</span></div>
      <div className="receipt-divider"/>
      {receipt.items.filter(item => item.lineTotal >= 0).map(item => <div className="grocery-receipt-row" key={item.id || `${item.name}-${item.quantity}`}><span><b>{item.name}</b><small>{item.quantity} × {money(item.unitPrice)}</small></span><strong>{money(item.lineTotal)}</strong></div>)}
      <div className="receipt-divider"/>
      <div className="grocery-receipt-row"><span>ยอดสินค้า</span><strong>{money(subtotal)}</strong></div>
      {discountAmount > 0 && <div className="grocery-receipt-row discount"><span>ส่วนลด{receipt.discountType === "percent" && receipt.discountValue ? ` (${receipt.discountValue}%)` : ""}</span><strong>−{money(discountAmount)}</strong></div>}
      <div className="grocery-receipt-row total"><span>ยอดสุทธิ</span><strong>{money(receipt.total)}</strong></div>
      <div className="grocery-receipt-row"><span>ชำระโดย</span><strong>{receipt.paymentMethod === "cash" ? "เงินสด" : "เงินโอน"}</strong></div>
      {receipt.paymentMethod === "cash" && <><div className="grocery-receipt-row"><span>รับเงิน</span><strong>{money(receipt.paid)}</strong></div><div className="grocery-receipt-row"><span>เงินทอน</span><strong>{money(receipt.changeAmount)}</strong></div></>}
      <div className="receipt-divider"/>
      <p className="receipt-footer">{receipt.settings.receiptFooter}</p>
      <small className="receipt-paper-label">รูปแบบกระดาษ 80 mm</small>
    </div></div>
    <div className="grocery-modal-actions receipt-actions"><button className="secondary-action" onClick={onClose}>ปิด</button><button onClick={print80}>พิมพ์ใบเสร็จ 80mm</button></div>
  </SimpleModal>;
}

function ClearCartModal({ count, onClose, onConfirm }: { count: number; onClose: () => void; onConfirm: () => void }) {
  return <SimpleModal title="ล้างรายการทั้งหมด" onClose={onClose}><div className="clear-cart-warning"><strong>ต้องการล้างสินค้า {count} รายการออกจากตะกร้าหรือไม่?</strong><p>รายการยังไม่ชำระเงิน จึงยังไม่มีการตัดสต๊อก</p></div><div className="grocery-modal-actions"><button className="secondary-action" onClick={onClose}>กลับ</button><button className="danger-action" onClick={onConfirm}>ล้างรายการทั้งหมด</button></div></SimpleModal>;
}

function CancelCart({ repo, cart, staff, shift, settings, onClose, onDone }: { repo: PosRepository; cart: CartLine[]; staff: Staff; shift: Shift; settings: AppSettings; onClose: () => void; onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError("");
    const auth = await repo.verifyPin(pin);
    if (!auth) { setError("PIN ไม่ถูกต้อง"); setBusy(false); return; }
    try {
      await repo.cancelBill({ items: cart.map(line => ({ productId: line.id, name: line.nameTh || line.name, quantity: line.quantity, unitPrice: line.price })), reason, staff: auth, shift, deviceId: settings.deviceId });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "ยกเลิกบิลไม่สำเร็จ"); setBusy(false); }
  };
  return <SimpleModal title="ยกเลิกบิลปัจจุบัน" onClose={busy ? () => {} : onClose}><div className="grocery-transfer-warning"><strong>ยกเลิกก่อนชำระเงิน</strong><p>ระบบจะไม่ตัดสต๊อกและจะบันทึกผู้ทำรายการกับเหตุผลไว้ใน Audit</p></div><label className="grocery-field">PIN พนักงาน<input type="password" value={pin} onChange={e => setPin(e.target.value)} /></label><label className="grocery-field">เหตุผล<input value={reason} onChange={e => setReason(e.target.value)} placeholder="ระบุเหตุผลการยกเลิก" /></label>{error && <p className="grocery-error">{error}</p>}<div className="grocery-modal-actions"><button className="secondary-action" disabled={busy} onClick={onClose}>กลับ</button><button className="danger-action" disabled={busy || !pin || !reason} onClick={() => void submit()}>{busy ? "กำลังบันทึก..." : "ยืนยันยกเลิกบิล"}</button></div></SimpleModal>;
}

function QuickAddProduct({ repo, staff, barcode, onClose, onSaved }: { repo: PosRepository; staff: Staff; barcode: string; onClose: () => void; onSaved: (product: Product) => void }) {
  const [form, setForm] = useState<ProductInput>({ productCode: "", barcode, nameTh: "", nameEn: "", categoryId: "grocery", categoryName: "ของชำ", price: 0, cost: 0, unit: "ชิ้น", stockQuantity: 0, minimumStock: 0, quantityScale: 1, imagePath: "", active: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof ProductInput, value: string | number | boolean) => setForm(old => ({ ...old, [key]: value }));
  const save = async () => {
    if (!form.productCode.trim() || !form.nameTh.trim()) { setError("กรุณากรอกรหัสสินค้าและชื่อสินค้า"); return; }
    setBusy(true); setError("");
    try {
      const existingCode = await repo.findProductByCode(form.productCode);
      if (existingCode) throw new Error("รหัสสินค้านี้ถูกใช้แล้ว");
      if (form.barcode) {
        const existingBarcode = await repo.findProductByBarcode(form.barcode);
        if (existingBarcode) throw new Error("บาร์โค้ดนี้ถูกใช้แล้ว");
      }
      const product = await repo.createProduct(form, staff);
      onSaved(product);
    } catch (e) { setError(e instanceof Error ? e.message : "เพิ่มสินค้าไม่สำเร็จ"); setBusy(false); }
  };
  return <SimpleModal title="เพิ่มสินค้าใหม่" onClose={busy ? () => {} : onClose}><div className="grocery-product-grid"><label>รหัสสินค้า *<input value={form.productCode} onChange={e => set("productCode", e.target.value)} autoFocus /></label><label>บาร์โค้ด<input value={form.barcode || ""} onChange={e => set("barcode", e.target.value)} /></label><label>ชื่อสินค้า (ไทย) *<input value={form.nameTh} onChange={e => set("nameTh", e.target.value)} /></label><label>ชื่ออังกฤษ<input value={form.nameEn || ""} onChange={e => set("nameEn", e.target.value)} /></label><label>หมวดหมู่<input value={form.categoryName} onChange={e => { set("categoryName", e.target.value); set("categoryId", e.target.value.trim().toLowerCase().replace(/\s+/g, "-") || "grocery"); }} /></label><label>หน่วย<select value={form.unit} onChange={e => set("unit", e.target.value)}><option>ชิ้น</option><option>ขวด</option><option>กระป๋อง</option><option>ถุง</option><option>กล่อง</option><option>แพ็ค</option><option>ลัง</option><option>kg</option><option>g</option></select></label><label>ราคาขาย<input type="number" value={form.price} onChange={e => set("price", Number(e.target.value))} /></label><label>ต้นทุน<input type="number" value={form.cost} onChange={e => set("cost", Number(e.target.value))} /></label><label>สต๊อกเริ่มต้น<input type="number" step="0.001" value={form.stockQuantity} onChange={e => set("stockQuantity", Number(e.target.value))} /></label><label>แจ้งเตือนสต๊อก<input type="number" step="0.001" value={form.minimumStock} onChange={e => set("minimumStock", Number(e.target.value))} /></label></div>{error && <p className="grocery-error">{error}</p>}<div className="grocery-modal-actions"><button className="secondary-action" disabled={busy} onClick={onClose}>ยกเลิก</button><button disabled={busy} onClick={() => void save()}>{busy ? "กำลังบันทึก..." : "บันทึกสินค้า"}</button></div></SimpleModal>;
}

function SimpleModal({ title, children, onClose, wide = true }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="grocery-modal-backdrop"><section className={`grocery-modal ${wide ? "" : "receipt-modal"}`}><header><h2>{title}</h2><button onClick={onClose} aria-label="ปิด">×</button></header>{children}</section></div>;
}
