import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createRepository } from "./data";
import type { PosRepository, ProductInput } from "./data/repository";
import type { AppSettings, Language, Product, Receipt, Sale, SalesSummary, Shift, Staff } from "./domain/types";
import { productName } from "./i18n";
import { LicenseGate } from "./components/license/LicenseGate";
import { DesktopSalesWorkspace } from "./components/sales/DesktopSalesWorkspace";
import { DesktopSettingsWorkspace } from "./components/settings/DesktopSettingsWorkspace";
import "./app-next.css";

type View = "sales" | "history" | "products" | "reports" | "employees" | "settings";

const money = (value: number) => `฿${Number(value || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const completeStartupSplash = async () => { try { await invoke("complete_startup_splash"); } catch { /* browser preview */ } };

export default function AppNext() {
  const [repo, setRepo] = useState<PosRepository | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [view, setView] = useState<View>("sales");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const nextRepo = await createRepository();
        await nextRepo.initialize();
        const [nextSettings, nextProducts, savedStaff, activeShift] = await Promise.all([
          nextRepo.getSettings(), nextRepo.listProducts(), nextRepo.getSavedSession(), nextRepo.getActiveShift()
        ]);
        if (!alive) return;
        setRepo(nextRepo);
        setSettings(nextSettings);
        setProducts(nextProducts);
        setStaff(savedStaff);
        setShift(activeShift);
      } catch (nextError) {
        if (alive) setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        if (alive) {
          setLoading(false);
          window.setTimeout(() => void completeStartupSplash(), 350);
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <main className="next-splash"><section><img src="/icon.png" alt="CpIPOS"/><h1>CpIPOS Desktop</h1><p>กำลังเตรียมระบบขายหน้าร้าน...</p></section></main>;
  if (error || !repo || !settings) return <main className="next-splash"><section><h1>ไม่สามารถเปิด CpIPOS Desktop</h1><p>{error || "LOCAL_DATABASE_NOT_READY"}</p></section></main>;

  const language: Language = settings.language || "th";
  const th = language === "th";
  const refreshProducts = async () => setProducts(await repo.listProducts());

  return <LicenseGate language={language}>
    {!staff ? <PinLogin repo={repo} settings={settings} language={language} onLogin={async (nextStaff) => { await repo.saveSession(nextStaff); setStaff(nextStaff); setShift(await repo.getActiveShift()); }} /> : !shift ? <OpenShift repo={repo} staff={staff} settings={settings} language={language} onOpen={(nextShift) => { setShift(nextShift); setView("sales"); }} /> : <main className="next-app-shell">
      <aside className="next-side-nav">
        <div className="next-brand"><img src="/icon.png" alt="CpIPOS"/><span><strong>CpIPOS</strong><small>Desktop POS</small></span></div>
        <p className="next-nav-kicker">{th ? "เมนูใช้งานหลัก" : "MAIN MENU"}</p>
        <NavButton active={view === "sales"} icon="▣" label={th ? "หน้าขาย" : "Sales"} onClick={() => setView("sales")}/>
        <NavButton active={view === "history"} icon="☷" label={th ? "รายการขาย" : "Sales history"} onClick={() => setView("history")}/>
        <NavButton active={view === "products"} icon="◇" label={th ? "สินค้า / สต็อก" : "Products"} onClick={() => setView("products")}/>
        <NavButton active={view === "reports"} icon="◫" label={th ? "รายงาน" : "Reports"} onClick={() => setView("reports")}/>
        <NavButton active={view === "employees"} icon="♙" label={th ? "พนักงาน" : "Employees"} onClick={() => setView("employees")}/>
        <NavButton active={view === "settings"} icon="⚙" label={th ? "ตั้งค่า" : "Settings"} onClick={() => setView("settings")}/>
        <div className="next-side-spacer"/>
        <button className="next-close-shift" onClick={() => setCloseShiftOpen(true)}>↪ {th ? "ปิดกะ / ล็อกเอาต์" : "Close shift / Logout"}</button>
      </aside>
      <section className="next-workspace">
        {view === "sales" ? <DesktopSalesWorkspace repo={repo} staff={staff} shift={shift} settings={settings} products={products} language={language} refreshProducts={refreshProducts}/> : null}
        {view === "history" ? <HistoryWorkspace repo={repo} language={language}/> : null}
        {view === "products" ? <ProductsWorkspace repo={repo} staff={staff} products={products} language={language} refreshProducts={refreshProducts}/> : null}
        {view === "reports" ? <ReportsWorkspace repo={repo} language={language}/> : null}
        {view === "employees" ? <EmployeesWorkspace repo={repo} staff={staff} language={language}/> : null}
        {view === "settings" ? <DesktopSettingsWorkspace repo={repo} staff={staff} settings={settings} language={language} onSaved={setSettings}/> : null}
      </section>
      {closeShiftOpen ? <CloseShiftDialog repo={repo} staff={staff} shift={shift} settings={settings} language={language} onClose={() => setCloseShiftOpen(false)} onDone={() => { setCloseShiftOpen(false); setShift(null); setStaff(null); setView("sales"); }}/> : null}
    </main>}
  </LicenseGate>;
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return <button className={`next-nav-button ${active ? "active" : ""}`} onClick={onClick}><span>{icon}</span><strong>{label}</strong></button>;
}

function PinLogin({ repo, settings, language, onLogin }: { repo: PosRepository; settings: AppSettings; language: Language; onLogin: (staff: Staff) => void }) {
  const th = language === "th";
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    const staff = await repo.verifyPin(pin);
    if (staff) onLogin(staff);
    else { setError(th ? "PIN ไม่ถูกต้อง" : "Incorrect PIN"); setPin(""); }
  };
  const press = (value: string) => {
    setError("");
    if (value === "back") setPin((current) => current.slice(0, -1));
    else if (pin.length < 8) setPin((current) => current + value);
  };
  return <main className="next-auth-screen"><section className="next-auth-card"><img src="/icon.png" alt="CpIPOS"/><h1>{settings.storeName}</h1><p>{settings.branchName} · {th ? "เข้าสู่ระบบพนักงาน" : "Staff sign in"}</p><div className="next-pin-dots">{Array.from({ length: 6 }, (_, index) => <span key={index} className={pin.length > index ? "filled" : ""}/>)}</div><div className="next-keypad">{"123456789".split("").map((number) => <button key={number} onClick={() => press(number)}>{number}</button>)}<button onClick={() => setPin("")}>{th ? "ล้าง" : "Clear"}</button><button onClick={() => press("0")}>0</button><button className="confirm" onClick={() => void submit()}>{th ? "เข้า" : "Enter"}</button></div>{error ? <p className="next-auth-error">{error}</p> : null}</section></main>;
}

function OpenShift({ repo, staff, settings, language, onOpen }: { repo: PosRepository; staff: Staff; settings: AppSettings; language: Language; onOpen: (shift: Shift) => void }) {
  const th = language === "th";
  const [cash, setCash] = useState("0");
  const [busy, setBusy] = useState(false);
  return <main className="next-auth-screen"><section className="next-auth-card shift"><span className="next-ready-pill">● OFFLINE READY</span><img src="/icon.png" alt="CpIPOS"/><h1>{th ? "เปิดกะขาย" : "Open shift"}</h1><div className="shift-summary"><div><span>{th ? "พนักงาน" : "Cashier"}</span><strong>{staff.displayName}</strong></div><div><span>{th ? "สาขา" : "Branch"}</span><strong>{settings.branchName}</strong></div><div><span>{th ? "เครื่อง" : "Device"}</span><strong>{settings.deviceName}</strong></div></div><label>{th ? "เงินสดตั้งต้น" : "Opening cash"}<input type="number" value={cash} onChange={(event) => setCash(event.target.value)}/></label><button className="shift-open-button" disabled={busy} onClick={async () => { setBusy(true); const next = await repo.openShift(Number(cash || 0), staff, settings.deviceId); onOpen(next); }}>{busy ? (th ? "กำลังเปิดกะ..." : "Opening...") : (th ? "เปิดกะและเริ่มขาย" : "Open shift & start selling")}</button></section></main>;
}

function ProductsWorkspace({ repo, staff, products, language, refreshProducts }: { repo: PosRepository; staff: Staff; products: Product[]; language: Language; refreshProducts: () => Promise<void> }) {
  const th = language === "th";
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  return <section className="next-panel"><header className="next-panel-head"><div><h1>{th ? "สินค้า / สต็อก" : "Products / Stock"}</h1><p>{products.length} {th ? "รายการ" : "items"}</p></div><button onClick={() => setCreating(true)}>+ {th ? "เพิ่มสินค้า" : "Add product"}</button></header><div className="next-product-list">{products.map((product) => <article key={product.id}><div className="next-product-thumb">{product.imagePath ? <img src={product.imagePath} alt=""/> : productName(language, product).slice(0, 1)}</div><div><strong>{productName(language, product)}</strong><small>{product.productCode} · {product.barcode || "-"}</small></div><span>{money(product.price)}</span><span className={product.stockQuantity <= 0 ? "bad" : product.stockQuantity <= product.minimumStock ? "warn" : "ok"}>{product.stockQuantity} {product.unit}</span><button onClick={() => setEditing(product)}>{th ? "แก้ไข" : "Edit"}</button></article>)}</div>{creating ? <ProductDialog repo={repo} staff={staff} language={language} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await refreshProducts(); }}/> : null}{editing ? <ProductDialog repo={repo} staff={staff} language={language} product={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refreshProducts(); }}/> : null}</section>;
}

function ProductDialog({ repo, staff, language, product, onClose, onSaved }: { repo: PosRepository; staff: Staff; language: Language; product?: Product; onClose: () => void; onSaved: () => void }) {
  const th = language === "th";
  const initial: ProductInput = product ? { ...product } : { productCode: "", barcode: "", nameTh: "", nameEn: "", categoryId: "general", categoryName: th ? "ทั่วไป" : "General", price: 0, cost: 0, unit: th ? "ชิ้น" : "pc", stockQuantity: 0, minimumStock: 0, quantityScale: 1, imagePath: "", active: true };
  const [form, setForm] = useState<ProductInput>(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof ProductInput, value: string | number | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!form.productCode.trim() || !form.nameTh.trim()) { setError(th ? "กรอกรหัสสินค้าและชื่อสินค้า" : "Product code and name are required."); return; }
    setBusy(true); setError("");
    try {
      if (product) await repo.updateProduct({ ...product, ...form, id: product.id, productCode: form.productCode, sku: form.productCode, name: form.nameTh, active: form.active ?? true } as Product, staff);
      else await repo.createProduct(form, staff);
      onSaved();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); setBusy(false); }
  };
  return <SimpleModal onClose={onClose}><header><h2>{product ? (th ? "แก้ไขสินค้า" : "Edit product") : (th ? "เพิ่มสินค้า" : "Add product")}</h2><button onClick={onClose}>×</button></header><div className="product-form-grid"><label>{th ? "รหัสสินค้า" : "Product code"}<input value={form.productCode} onChange={(event) => set("productCode", event.target.value)}/></label><label>Barcode<input value={form.barcode || ""} onChange={(event) => set("barcode", event.target.value)}/></label><label>{th ? "ชื่อสินค้า" : "Product name"}<input value={form.nameTh} onChange={(event) => set("nameTh", event.target.value)}/></label><label>{th ? "หมวดหมู่" : "Category"}<input value={form.categoryName} onChange={(event) => { set("categoryName", event.target.value); set("categoryId", event.target.value.toLowerCase().replace(/\s+/g, "-") || "general"); }}/></label><label>{th ? "ราคาขาย" : "Price"}<input type="number" value={form.price} onChange={(event) => set("price", Number(event.target.value))}/></label><label>{th ? "ต้นทุน" : "Cost"}<input type="number" value={form.cost} onChange={(event) => set("cost", Number(event.target.value))}/></label><label>{th ? "สต็อก" : "Stock"}<input type="number" value={form.stockQuantity} onChange={(event) => set("stockQuantity", Number(event.target.value))}/></label><label>{th ? "สต็อกขั้นต่ำ" : "Minimum stock"}<input type="number" value={form.minimumStock} onChange={(event) => set("minimumStock", Number(event.target.value))}/></label></div>{error ? <p className="next-auth-error">{error}</p> : null}<div className="dialog-actions"><button onClick={onClose}>{th ? "ยกเลิก" : "Cancel"}</button><button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "..." : (th ? "บันทึก" : "Save")}</button></div></SimpleModal>;
}

function HistoryWorkspace({ repo, language }: { repo: PosRepository; language: Language }) {
  const th = language === "th";
  const [rows, setRows] = useState<Sale[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  useEffect(() => { void repo.listSales(200, { status: "all" }).then(setRows); }, [repo]);
  return <section className="next-panel"><header className="next-panel-head"><div><h1>{th ? "รายการขาย" : "Sales history"}</h1><p>{th ? "บิลล่าสุดในเครื่อง" : "Recent local receipts"}</p></div></header><div className="next-table-wrap"><table><thead><tr><th>{th ? "เลขที่บิล" : "Receipt"}</th><th>{th ? "วันที่" : "Date"}</th><th>{th ? "พนักงาน" : "Cashier"}</th><th>{th ? "ชำระ" : "Payment"}</th><th>{th ? "สถานะ" : "Status"}</th><th>{th ? "ยอดรวม" : "Total"}</th><th/></tr></thead><tbody>{rows.map((sale) => <tr key={sale.id}><td><strong>{sale.receiptNo}</strong></td><td>{new Date(sale.createdAt).toLocaleString(th ? "th-TH" : "en-US")}</td><td>{sale.cashierName || "-"}</td><td>{sale.paymentMethod}</td><td><span className={`sale-status ${sale.status}`}>{sale.status}</span></td><td>{money(sale.total)}</td><td><button onClick={async () => setReceipt(await repo.getReceipt(sale.id))}>{th ? "ดูใบเสร็จ" : "Receipt"}</button></td></tr>)}</tbody></table></div>{receipt ? <SimpleModal onClose={() => setReceipt(null)}><header><h2>{receipt.receiptNo}</h2><button onClick={() => setReceipt(null)}>×</button></header><div className="simple-receipt"><h3>{receipt.settings.storeName}</h3>{receipt.items.map((item) => <div key={item.id || item.name}><span>{item.name} × {item.quantity}</span><strong>{money(item.lineTotal)}</strong></div>)}<hr/><div><strong>{th ? "ยอดรวม" : "Total"}</strong><strong>{money(receipt.total)}</strong></div></div></SimpleModal> : null}</section>;
}

function ReportsWorkspace({ repo, language }: { repo: PosRepository; language: Language }) {
  const th = language === "th";
  const [date, setDate] = useState(today());
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  useEffect(() => { void repo.getSalesSummary(date).then(setSummary); }, [repo, date]);
  return <section className="next-panel"><header className="next-panel-head"><div><h1>{th ? "รายงานยอดขาย" : "Sales report"}</h1><p>{th ? "สรุปจากฐานข้อมูลในเครื่อง" : "Local database summary"}</p></div><input type="date" value={date} onChange={(event) => setDate(event.target.value)}/></header>{summary ? <><div className="report-metrics"><Metric label={th ? "ยอดขายรวม" : "Total sales"} value={money(summary.totalSales)}/><Metric label={th ? "จำนวนบิล" : "Bills"} value={String(summary.billCount)}/><Metric label={th ? "เงินสด" : "Cash"} value={money(summary.cashTotal)}/><Metric label={th ? "โอน" : "Transfer"} value={money(summary.transferTotal)}/><Metric label={th ? "เฉลี่ยต่อบิล" : "Average"} value={money(summary.averageBill)}/><Metric label={th ? "บิลยกเลิก" : "Cancelled"} value={`${summary.cancelledCount} / ${money(summary.cancelledValue)}`}/></div><div className="report-columns"><section><h3>{th ? "ขายตามสินค้า" : "By product"}</h3>{summary.byProduct.length ? summary.byProduct.map((row) => <div className="report-line" key={row.label}><span>{row.label} × {row.quantity}</span><strong>{money(row.total)}</strong></div>) : <p>-</p>}</section><section><h3>{th ? "ขายตามพนักงาน" : "By employee"}</h3>{summary.byEmployee.length ? summary.byEmployee.map((row) => <div className="report-line" key={row.label}><span>{row.label} · {row.count}</span><strong>{money(row.total)}</strong></div>) : <p>-</p>}</section></div></> : <p>{th ? "กำลังโหลด..." : "Loading..."}</p>}</section>;
}

function EmployeesWorkspace({ repo, staff, language }: { repo: PosRepository; staff: Staff; language: Language }) {
  const th = language === "th";
  const [rows, setRows] = useState<Staff[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<Staff["role"]>("staff");
  const load = async () => setRows(await repo.listEmployees());
  useEffect(() => { void load(); }, [repo]);
  return <section className="next-panel"><header className="next-panel-head"><div><h1>{th ? "พนักงาน / PIN" : "Employees / PIN"}</h1><p>{th ? "เจ้าของและผู้จัดการใช้ PIN อนุมัติการยกเลิกบิล" : "Owner/manager PIN authorizes bill cancellation."}</p></div></header><div className="employee-create"><input placeholder={th ? "รหัสพนักงาน" : "Code"} value={code} onChange={(event) => setCode(event.target.value)}/><input placeholder={th ? "ชื่อ" : "Name"} value={name} onChange={(event) => setName(event.target.value)}/><input placeholder="PIN" value={pin} onChange={(event) => setPin(event.target.value)}/><select value={role} onChange={(event) => setRole(event.target.value as Staff["role"])}><option value="staff">staff</option><option value="manager">manager</option><option value="owner">owner</option></select><button disabled={!code || !name || !pin} onClick={async () => { await repo.saveEmployee({ code, displayName: name, role, active: true, demoPin: pin }, staff); setCode(""); setName(""); setPin(""); await load(); }}>+ {th ? "เพิ่ม" : "Add"}</button></div><div className="employee-list">{rows.map((row) => <article key={row.id}><strong>{row.displayName}</strong><span>{row.code}</span><span>{row.role}</span><span>{row.active === false ? "inactive" : "active"}</span></article>)}</div></section>;
}

function CloseShiftDialog({ repo, staff, shift, settings, language, onClose, onDone }: { repo: PosRepository; staff: Staff; shift: Shift; settings: AppSettings; language: Language; onClose: () => void; onDone: () => void }) {
  const th = language === "th";
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void repo.getSalesSummary(today()).then(setSummary); }, [repo]);
  return <SimpleModal onClose={onClose}><header><h2>{th ? "ปิดกะขาย" : "Close shift"}</h2><button onClick={onClose}>×</button></header><div className="report-metrics"><Metric label={th ? "พนักงาน" : "Cashier"} value={staff.displayName}/><Metric label={th ? "กะ" : "Shift"} value={shift.id.slice(0, 8)}/><Metric label={th ? "ยอดขาย" : "Sales"} value={summary ? money(summary.totalSales) : "-"}/><Metric label={th ? "จำนวนบิล" : "Bills"} value={String(summary?.billCount ?? 0)}/></div><p>{th ? `สาขา ${settings.branchName} — หลังปิดกะระบบจะกลับไปหน้า PIN` : `After closing ${settings.branchName}, the app returns to PIN login.`}</p><div className="dialog-actions"><button onClick={onClose}>{th ? "กลับ" : "Back"}</button><button className="primary" disabled={busy} onClick={async () => { setBusy(true); await repo.closeShift(staff, settings.deviceId); await repo.clearSession(staff, shift, settings.deviceId); onDone(); }}>{busy ? "..." : (th ? "ยืนยันปิดกะ" : "Confirm close shift")}</button></div></SimpleModal>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="report-metric"><span>{label}</span><strong>{value}</strong></div>; }

function SimpleModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [onClose]);
  return <div className="next-dialog-backdrop" onMouseDown={onClose}><section className="next-dialog" onMouseDown={(event) => event.stopPropagation()}>{children}</section></div>;
}
