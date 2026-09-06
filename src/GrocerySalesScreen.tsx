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

const money = (n: number) => `฿${Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const roundQty = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
const cleanCode = (value: string) => value.trim().replace(/\s+/g, "");
const normalizeCode = (value: string) => cleanCode(value).toLowerCase();

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
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [unknownBarcode, setUnknownBarcode] = useState("");
  const [quickAddBarcode, setQuickAddBarcode] = useState<string | null>(null);
  const [quickTender, setQuickTender] = useState("");
  const [busy, setBusy] = useState(false);

  const total = cart.reduce((sum, line) => sum + line.quantity * line.price, 0);
  const totalQty = cart.reduce((sum, line) => sum + line.quantity, 0);

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
      // Cart UI must remain responsive even if audit persistence fails temporarily.
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

    // Normal registered scans are handled from the in-memory index on the same
    // input event, so repeated scanner reads do not wait for SQLite queries.
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

    // Most keyboard-wedge scanners send Enter. This short idle fallback also
    // supports scanners configured without an Enter suffix.
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
    setBusy(true);
    try {
      const items = cartRef.current.map(line => ({ productId: line.id, name: productName(language, line), quantity: line.quantity, unitPrice: line.price }));
      const sale = await repo.checkout({ items, paymentMethod: method, paid, staff, shift, deviceId: settings.deviceId });
      const savedReceipt = await repo.getReceipt(sale.id);
      replaceCart([]);
      setQuickTender("");
      setPaymentChoice(false);
      setCashOpen(false);
      setTransferOpen(false);
      setReceipt(savedReceipt);
      await refreshProducts();
      notify("ok", `บันทึกบิล ${sale.receiptNo} แล้ว`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "บันทึกการขายไม่สำเร็จ");
    } finally {
      setBusy(false);
      focusScanner();
    }
  };

  const keypad = (key: string) => {
    setQuickTender(value => {
      if (key === "clear") return "";
      if (key === "back") return value.slice(0, -1);
      if (key === "." && value.includes(".")) return value;
      if (key === "." && !value) return "0.";
      return `${value}${key}`;
    });
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
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <span className="scanner-ready-dot" aria-hidden="true" />
          <strong className="scanner-ready-text">พร้อมสแกน</strong>
        </div>
        <div className="grocery-scan-status">
          {cart.length ? `ตะกร้า: ${cart.length} รายการ / ${roundQty(totalQty)} ชิ้น` : "รอรับบาร์โค้ดจากเครื่องสแกน"}
        </div>
      </section>

      <section className="grocery-table-panel">
        <header>
          <strong>ตารางขายสินค้า · {cart.length} รายการ · {roundQty(totalQty)} ชิ้น</strong>
          <b>{money(total)}</b>
        </header>
        <div className="grocery-table-scroll-v2">
          <table className="grocery-table-v2">
            <thead><tr><th>#</th><th>SKU / บาร์โค้ด</th><th>หมวดหมู่</th><th>สินค้า</th><th>จำนวน</th><th>ราคา/หน่วย</th><th>ราคารวม</th><th>ลบ</th></tr></thead>
            <tbody>
              {cart.map((line, index) => <tr key={line.id}>
                <td>{index + 1}</td>
                <td><strong>{line.productCode}</strong><small>{line.barcode || "-"}</small></td>
                <td>{line.categoryName}</td>
                <td><strong>{productName(language, line)}</strong><small>คงเหลือ {line.stockQuantity} {line.unit}</small></td>
                <td><div className="grocery-qty-control"><button onClick={() => setQuantity(line, line.quantity - 1)}>−</button><input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e => setQuantity(line, Number(e.target.value || 1))} /><button onClick={() => setQuantity(line, line.quantity + 1)}>+</button></div></td>
                <td>{money(line.price)}</td>
                <td><strong>{money(line.price * line.quantity)}</strong></td>
                <td><button className="grocery-remove-line" onClick={() => void removeLine(line)}>×</button></td>
              </tr>)}
            </tbody>
          </table>
          {!cart.length && <div className="grocery-empty-table"><strong>พร้อมขาย</strong><span>ยิงบาร์โค้ดสินค้า รายการจะปรากฏในตารางนี้ทันที</span></div>}
        </div>
      </section>
    </div>

    <aside className="grocery-checkout-panel">
      <div className="grocery-checkout-mode"><span>โหมด</span><strong>ร้านของชำ</strong></div>
      <div className="grocery-checkout-total"><span>ยอดรวม</span><strong>{money(total)}</strong></div>
      <div className="grocery-checkout-tender"><span>รับเงินด่วน</span><strong>{money(Number(quickTender || 0))}</strong></div>

      <div className="grocery-checkout-keypad">
        {["1","2","3","4","5","6","7","8","9","0","00","."].map(key => <button key={key} onClick={() => keypad(key)}>{key}</button>)}
      </div>
      <div className="grocery-key-actions"><button onClick={() => keypad("clear")}>ล้าง</button><button onClick={() => keypad("back")}>ลบ</button></div>
      <div className="grocery-shortcuts">
        <button disabled title="เตรียมไว้สำหรับ Phase ถัดไป">พักบิล</button>
        <button disabled title="เตรียมไว้สำหรับ Phase ถัดไป">สมาชิก</button>
        <button disabled title="เตรียมไว้สำหรับ Phase ถัดไป">ส่วนลด</button>
      </div>
      <button className="grocery-pay-button" disabled={!cart.length || busy} onClick={() => setPaymentChoice(true)}>{busy ? "กำลังบันทึก..." : "ชำระเงิน"}</button>
      <button className="grocery-cancel-button" disabled={!cart.length || busy} onClick={() => setCancelOpen(true)}>ยกเลิกบิล</button>
    </aside>

    {toast && <div className={`grocery-toast ${toast.kind}`}>{toast.text}</div>}
    {paymentChoice && <PaymentChoice total={total} onClose={() => setPaymentChoice(false)} onCash={() => { setPaymentChoice(false); setCashOpen(true); }} onTransfer={() => { setPaymentChoice(false); setTransferOpen(true); }} />}
    {cashOpen && <CashPayment total={total} initialPaid={Number(quickTender || 0)} busy={busy} onClose={() => setCashOpen(false)} onConfirm={paid => completeSale("cash", paid)} />}
    {transferOpen && <TransferPayment total={total} busy={busy} onClose={() => setTransferOpen(false)} onConfirm={() => completeSale("transfer", total)} />}
    {receipt && <ReceiptView receipt={receipt} onClose={() => setReceipt(null)} />}
    {cancelOpen && <CancelCart repo={repo} cart={cart} staff={staff} shift={shift} settings={settings} onClose={() => setCancelOpen(false)} onDone={() => { replaceCart([]); setCancelOpen(false); focusScanner(); }} />}
    {unknownBarcode && <SimpleModal title="ไม่พบสินค้า" onClose={() => { setUnknownBarcode(""); focusScanner(); }}><div className="grocery-unknown-code">{unknownBarcode}</div><p>ยังไม่มีบาร์โค้ด/SKU นี้ในฐานข้อมูลเครื่อง</p><div className="grocery-modal-actions"><button className="secondary-action" onClick={() => { setUnknownBarcode(""); focusScanner(); }}>ปิด</button><button onClick={() => { setQuickAddBarcode(unknownBarcode); setUnknownBarcode(""); }}>เพิ่มสินค้าใหม่</button></div></SimpleModal>}
    {quickAddBarcode !== null && <QuickAddProduct repo={repo} staff={staff} barcode={quickAddBarcode} onClose={() => { setQuickAddBarcode(null); focusScanner(); }} onSaved={async product => { setQuickAddBarcode(null); await refreshProducts(); addProduct(product); }} />}
  </section>;
}

function PaymentChoice({ total, onClose, onCash, onTransfer }: { total: number; onClose: () => void; onCash: () => void; onTransfer: () => void }) {
  return <SimpleModal title="เลือกวิธีชำระเงิน" onClose={onClose}><div className="grocery-payment-total">ยอดชำระ <strong>{money(total)}</strong></div><div className="grocery-payment-choice"><button onClick={onCash}><span>฿</span><strong>เงินสด</strong><small>กรอกเงินรับและคำนวณเงินทอน</small></button><button onClick={onTransfer}><span>⇄</span><strong>เงินโอน</strong><small>ตรวจสอบยอดเงินจริงก่อนยืนยัน</small></button></div></SimpleModal>;
}

function CashPayment({ total, initialPaid, busy, onClose, onConfirm }: { total: number; initialPaid: number; busy: boolean; onClose: () => void; onConfirm: (paid: number) => Promise<void> }) {
  const [value, setValue] = useState(initialPaid > 0 ? String(initialPaid) : "");
  const paid = Number(value || 0);
  const press = (key: string) => setValue(v => key === "clear" ? "" : key === "back" ? v.slice(0, -1) : key === "." && v.includes(".") ? v : `${v}${key}`);
  return <SimpleModal title="รับชำระเงินสด" onClose={busy ? () => {} : onClose}><div className="grocery-cash-summary"><div><span>ยอดชำระ</span><strong>{money(total)}</strong></div><div><span>รับเงิน</span><strong>{money(paid)}</strong></div><div className="change"><span>เงินทอน</span><strong>{money(Math.max(0, paid - total))}</strong></div></div><div className="grocery-cash-quick"><button onClick={() => setValue(String(total))}>ยอดพอดี</button>{[100,200,500,1000].filter(v => v >= total).map(v => <button key={v} onClick={() => setValue(String(v))}>{v}</button>)}</div><div className="grocery-cash-keypad">{["1","2","3","4","5","6","7","8","9","00","0","."].map(key => <button key={key} onClick={() => press(key)}>{key}</button>)}</div><div className="grocery-modal-actions"><button className="secondary-action" disabled={busy} onClick={onClose}>ยกเลิก</button><button disabled={busy || paid < total} onClick={() => void onConfirm(paid)}>{busy ? "กำลังบันทึก..." : `ยืนยันรับเงิน ${money(paid)}`}</button></div></SimpleModal>;
}

function TransferPayment({ total, busy, onClose, onConfirm }: { total: number; busy: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  return <SimpleModal title="ชำระด้วยเงินโอน" onClose={busy ? () => {} : onClose}><div className="grocery-payment-total">ยอดชำระ <strong>{money(total)}</strong></div><div className="grocery-transfer-warning"><strong>ตรวจสอบยอดเงินจริงก่อนยืนยัน</strong><p>ระบบ Offline บันทึกวิธีชำระเงินเท่านั้น และไม่ได้เชื่อมต่อธนาคารเพื่อตรวจสอบยอดอัตโนมัติ</p></div><div className="grocery-modal-actions"><button className="secondary-action" disabled={busy} onClick={onClose}>ยกเลิก</button><button disabled={busy} onClick={() => void onConfirm()}>{busy ? "กำลังบันทึก..." : "ยืนยันรับชำระ"}</button></div></SimpleModal>;
}

function ReceiptView({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  return <SimpleModal title={`ใบเสร็จ ${receipt.receiptNo}`} onClose={onClose}><div className="grocery-receipt"><h2>{receipt.settings.receiptHeader || receipt.settings.storeName}</h2><p>{receipt.settings.branchName}</p><small>{new Date(receipt.createdAt).toLocaleString("th-TH")}</small>{receipt.items.map(item => <div className="grocery-receipt-row" key={item.id || `${item.name}-${item.quantity}`}><span>{item.name} × {item.quantity}</span><strong>{money(item.lineTotal)}</strong></div>)}<div className="grocery-receipt-row total"><span>รวม</span><strong>{money(receipt.total)}</strong></div><p>วิธีชำระ: {receipt.paymentMethod === "cash" ? "เงินสด" : "เงินโอน"}</p>{receipt.paymentMethod === "cash" && <><p>รับเงิน: {money(receipt.paid)}</p><p>เงินทอน: {money(receipt.changeAmount)}</p></>}<p>{receipt.settings.receiptFooter}</p></div><div className="grocery-modal-actions"><button className="secondary-action" onClick={onClose}>ปิด</button><button disabled title="เชื่อมเครื่องพิมพ์ใน Phase ถัดไป">พิมพ์ใบเสร็จ</button></div></SimpleModal>;
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
  return <SimpleModal title="ยกเลิกบิลปัจจุบัน" onClose={busy ? () => {} : onClose}><p className="grocery-transfer-warning">รายการยังไม่ชำระ จึงยังไม่มีการตัดสต๊อก ระบบจะเก็บประวัติการยกเลิกไว้ใน Audit</p><label className="grocery-field">PIN พนักงาน<input type="password" value={pin} onChange={e => setPin(e.target.value)} /></label><label className="grocery-field">เหตุผล<input value={reason} onChange={e => setReason(e.target.value)} placeholder="ระบุเหตุผลการยกเลิก" /></label>{error && <p className="grocery-error">{error}</p>}<div className="grocery-modal-actions"><button className="secondary-action" disabled={busy} onClick={onClose}>กลับ</button><button className="danger-action" disabled={busy || !pin || !reason} onClick={() => void submit()}>{busy ? "กำลังบันทึก..." : "ยืนยันยกเลิกบิล"}</button></div></SimpleModal>;
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

function SimpleModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="grocery-modal-backdrop"><section className="grocery-modal"><header><h2>{title}</h2><button onClick={onClose} aria-label="ปิด">×</button></header>{children}</section></div>;
}
