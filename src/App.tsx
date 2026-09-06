import { useEffect, useMemo, useState } from "react";
import { createRepository } from "./data";
import type { CancelBillInput, PosRepository, ProductInput } from "./data/repository";
import type { AppSettings, CartLine, Language, PaymentMethod, Product, Receipt, Sale, SalesSummary, Shift, Staff, StockMovement, StorageHealth } from "./domain/types";
import { productName, t } from "./i18n";

type View = "sales" | "products" | "salesHistory" | "reports" | "employees" | "settings";

type ModalProps = { title: string; children: React.ReactNode; onClose: () => void };
const money = (n: number) => `฿${Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const units = ["ชิ้น", "ขวด", "กระป๋อง", "ถุง", "กล่อง", "แพ็ค", "ลัง", "kg", "g", "liter", "ml"];
const emptyProduct = (): ProductInput => ({ productCode:"", barcode:"", nameTh:"", nameEn:"", categoryId:"retail", categoryName:"ค้าปลีก", price:0, cost:0, unit:"ชิ้น", stockQuantity:0, minimumStock:0, quantityScale:1, imagePath:"", active:true });

function modalRoot(title: string, children: React.ReactNode, onClose: () => void) {
  return <Modal title={title} onClose={onClose}>{children}</Modal>;
}

export default function App() {
  const [repo, setRepo] = useState<PosRepository | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [view, setView] = useState<View>("sales");
  const [error, setError] = useState("");
  const [splash, setSplash] = useState(true);
  const [closeShift, setCloseShift] = useState(false);

  const language: Language = settings?.language || "th";

  const refreshProducts = async (r = repo) => { if (r) setProducts(await r.listProducts()); };
  const refreshSettings = async (r = repo) => { if (r) setSettings(await r.getSettings()); };
  const refreshShift = async (r = repo) => { if (r) setShift(await r.getActiveShift()); };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await createRepository();
        await r.initialize();
        const [saved, activeShift, currentSettings, currentProducts] = await Promise.all([r.getSavedSession(), r.getActiveShift(), r.getSettings(), r.listProducts()]);
        if (!alive) return;
        setRepo(r); setStaff(saved); setShift(activeShift); setSettings(currentSettings); setProducts(currentProducts);
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      finally { window.setTimeout(() => alive && setSplash(false), 450); }
    })();
    return () => { alive = false; };
  }, []);

  if (splash) return <main className="splash"><img src="/icon.png" alt="CpIPOS" /><h1>CpIPOS Desktop</h1><p>{t(language, "loading")}</p></main>;
  if (error || !repo || !settings) return <main className="center-screen"><section className="error-card"><h1>{t(language, "dbError")}</h1><pre>{error}</pre></section></main>;
  if (!staff) return <LoginScreen repo={repo} language={language} onLogin={async s => { await repo.saveSession(s); setStaff(s); await refreshShift(repo); }} />;
  if (!shift) return <ShiftScreen repo={repo} staff={staff} settings={settings} language={language} onOpen={async s => { setShift(s); setView("sales"); }} />;

  const nav: { id: View; label: string }[] = [
    { id:"sales", label:t(language,"sales") }, { id:"products", label:t(language,"products") }, { id:"salesHistory", label:t(language,"history") },
    { id:"reports", label:t(language,"reports") }, { id:"employees", label:t(language,"employees") }, { id:"settings", label:t(language,"settings") },
  ];

  return <main className="app-shell">
    <aside className="side-nav">
      <div className="side-brand"><img src="/icon.png" alt="" /><div><strong>CpIPOS</strong><small>{settings.deviceName}</small></div></div>
      {nav.map(n => <button key={n.id} className={view===n.id?"active":""} onClick={() => setView(n.id)}>{n.label}</button>)}
    </aside>
    <section className="workspace">
      <header className="topbar"><div><strong>{settings.storeName}</strong><span>{settings.branchName}</span></div><div className="topbar-meta"><span>กะ {shift.id.slice(0,8)}</span><span>{staff.displayName}</span><button onClick={() => setCloseShift(true)}>{t(language,"closeShift")}</button></div></header>
      <div className="view-body">
        {view === "sales" && <SalesScreen repo={repo} staff={staff} shift={shift} settings={settings} products={products} language={language} refreshProducts={() => refreshProducts(repo)} />}
        {view === "products" && <ProductsScreen repo={repo} staff={staff} products={products} language={language} refreshProducts={() => refreshProducts(repo)} />}
        {view === "salesHistory" && <SalesHistoryScreen repo={repo} staff={staff} shift={shift} settings={settings} language={language} />}
        {view === "reports" && <ReportsScreen repo={repo} language={language} />}
        {view === "employees" && <EmployeesScreen repo={repo} staff={staff} language={language} />}
        {view === "settings" && <SettingsScreen repo={repo} staff={staff} settings={settings} language={language} refreshSettings={() => refreshSettings(repo)} />}
      </div>
    </section>
    {closeShift && <CloseShiftModal repo={repo} staff={staff} shift={shift} settings={settings} language={language} onClose={() => setCloseShift(false)} onConfirm={async () => { await repo.closeShift(staff, settings.deviceId); await repo.clearSession(staff, shift, settings.deviceId); setCloseShift(false); setShift(null); setStaff(null); }} />}
  </main>;
}

function LoginScreen({ repo, language, onLogin }: { repo: PosRepository; language: Language; onLogin: (staff: Staff) => void }) {
  const [pin, setPin] = useState(""); const [error, setError] = useState("");
  const submit = async () => { const s = await repo.verifyPin(pin); if (s) onLogin(s); else { setError(t(language,"pinWrong")); setPin(""); } };
  const press = (v: string) => { if (v === "back") setPin(pin.slice(0,-1)); else if (v === "ok") submit(); else if (pin.length < 8) setPin(pin+v); };
  return <main className="center-screen"><section className="login-card"><img className="brand-logo" src="/icon.png" alt="CpIPOS" /><h1>CpIPOS Desktop</h1><p>{t(language,"loginTitle")}</p><p className="warning">{t(language,"demoPin")}</p><div className="pin-dots">{[0,1,2,3].map(i=><span key={i} className={pin.length>i?"filled":""} />)}</div>{error && <p className="error">{error}</p>}<div className="keypad">{"123456789".split("").map(n=><button key={n} onClick={()=>press(n)}>{n}</button>)}<button onClick={()=>press("back")}>⌫</button><button onClick={()=>press("0")}>0</button><button className="primary" onClick={()=>press("ok")}>OK</button></div></section></main>;
}

function ShiftScreen({ repo, staff, settings, language, onOpen }: { repo: PosRepository; staff: Staff; settings: AppSettings; language: Language; onOpen: (shift: Shift) => void }) {
  const [cash, setCash] = useState("0");
  return <main className="center-screen"><section className="shift-card"><span className="status-pill">{t(language,"offlineReady")}</span><h1>{t(language,"openShift")}</h1><p>{settings.storeName} · {settings.deviceName}</p><label>{t(language,"openingCash")}<input type="number" value={cash} onChange={e=>setCash(e.target.value)} /></label><button className="big-primary" onClick={async()=>onOpen(await repo.openShift(Number(cash || 0), staff, settings.deviceId))}>{t(language,"open")}</button></section></main>;
}

function SalesScreen({ repo, staff, shift, settings, products, language, refreshProducts }: { repo: PosRepository; staff: Staff; shift: Shift; settings: AppSettings; products: Product[]; language: Language; refreshProducts: () => Promise<void> }) {
  const [cart, setCart] = useState<CartLine[]>([]); const [barcode, setBarcode] = useState(""); const [cat, setCat] = useState("all"); const [notice, setNotice] = useState(""); const [pay, setPay] = useState<PaymentMethod | null>(null); const [receipt, setReceipt] = useState<Receipt | null>(null); const [cancelOpen, setCancelOpen] = useState(false);
  const categories = useMemo(() => [{ id:"all", label:t(language,"all") }, ...Array.from(new Map(products.map(p => [p.categoryId, { id:p.categoryId, label:p.categoryName }])).values())], [products, language]);
  const visible = products.filter(p => p.active && (cat === "all" || p.categoryId === cat));
  const total = cart.reduce((s, l) => s + l.quantity * l.price, 0);
  const add = (p: Product, q = 1) => setCart(rows => rows.some(x=>x.id===p.id) ? rows.map(x=>x.id===p.id ? {...x, quantity:Number((x.quantity+q).toFixed(3))} : x) : [...rows, {...p, quantity:q}]);
  const updateQty = (id: string, q: number) => setCart(rows => rows.map(x=>x.id===id ? {...x, quantity:Math.max(0.001, Number(q.toFixed(3)))} : x));
  const remove = async (line: CartLine) => { await repo.recordCartItemRemoved(line, line.quantity, staff, shift, settings.deviceId); setCart(rows => rows.filter(x=>x.id!==line.id)); };
  const scan = async () => { const code=barcode.trim(); if(!code) return; const p=await repo.findProductByBarcode(code); if(p){ add(p); setNotice(`${t(language,"scan")}: ${productName(language,p)}`); } else setNotice(`${t(language,"barcode")} ${code} ไม่พบสินค้า`); setBarcode(""); };
  const complete = async (method: PaymentMethod, paid: number) => { const sale=await repo.checkout({items:cart.map(l=>({productId:l.id,name:productName(language,l),quantity:l.quantity,unitPrice:l.price})),paymentMethod:method,paid,staff,shift,deviceId:settings.deviceId}); setCart([]); setPay(null); await refreshProducts(); setReceipt(await repo.getReceipt(sale.id)); setNotice(`${t(language,"saleStored")} · ${t(language,"noInternet")}`); };
  return <section className="sales-grid"><div className="catalog"><div className="scan-row"><input aria-label={t(language,"scan")} placeholder={t(language,"scan")} value={barcode} onChange={e=>setBarcode(e.target.value)} onKeyDown={e=>{if(e.key==="Enter") scan();}} autoFocus /><button onClick={scan}>{t(language,"scan")}</button></div><div className="chips">{categories.map(c=><button key={c.id} className={cat===c.id?"active":""} onClick={()=>setCat(c.id)}>{c.label}</button>)}</div><div className="products">{visible.map(p=><button key={p.id} className="product-card" onClick={()=>add(p)}><span>{productName(language,p).slice(0,1)}</span><strong>{productName(language,p)}</strong><small>{p.productCode} {p.barcode ? `· ${p.barcode}` : ""}</small><b>{money(p.price)}</b><em className={p.stockQuantity<=p.minimumStock?"low":""}>{t(language,"stock")}: {p.stockQuantity} {p.unit}</em></button>)}</div></div><aside className="cart"><header><h2>{t(language,"cart")}</h2><span>{cart.length}</span></header><div className="cart-list">{!cart.length && <p>{t(language,"emptyCart")}</p>}{cart.map(line=><div className="cart-line" key={line.id}><div><strong>{productName(language,line)}</strong><small>{money(line.price)} / {line.unit}</small></div><input className="qty-input" type="number" step="0.001" min="0.001" value={line.quantity} onChange={e=>updateQty(line.id, Number(e.target.value || 1))} /><strong>{money(line.price*line.quantity)}</strong><button className="danger" onClick={()=>remove(line)}>×</button></div>)}</div>{notice && <p className="notice">{notice}</p>}<footer><div className="total"><span>{t(language,"total")}</span><strong>{money(total)}</strong></div><button disabled={!cart.length} onClick={()=>setPay("cash")}>{t(language,"pay")}</button><button className="secondary" disabled={!cart.length} onClick={()=>setPay("transfer")}>{t(language,"transfer")}</button><button className="secondary" disabled={!cart.length} onClick={()=>setPay("promptpay")}>{t(language,"promptpay")}</button><button className="secondary" disabled={!cart.length} onClick={()=>setPay("card")}>{t(language,"card")}</button><button className="danger" disabled={!cart.length} onClick={()=>setCancelOpen(true)}>{t(language,"cancelBill")}</button></footer></aside>{pay && <PaymentModal language={language} method={pay} total={total} onClose={()=>setPay(null)} onConfirm={paid=>complete(pay, paid)} />}{receipt && <ReceiptModal receipt={receipt} language={language} onClose={()=>setReceipt(null)} />}{cancelOpen && <CancelBillModal repo={repo} cart={cart} staff={staff} shift={shift} settings={settings} language={language} onClose={()=>setCancelOpen(false)} onDone={()=>{setCart([]);setCancelOpen(false);}} />}</section>;
}

function PaymentModal({ language, method, total, onClose, onConfirm }: { language: Language; method: PaymentMethod; total: number; onClose: () => void; onConfirm: (paid: number) => Promise<void> }) {
  const [paid, setPaid] = useState(method === "cash" ? String(total) : String(total)); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const label = t(language, method);
  return <Modal title={`${t(language,"pay")} · ${label}`} onClose={onClose}><div className="pay-total"><span>{t(language,"total")}</span><strong>{money(total)}</strong></div>{method !== "cash" && <p className="warning">{t(language,"recordOnly")}</p>}<label>{t(language,"received")}<input type="number" value={paid} disabled={method!=="cash"} onChange={e=>setPaid(e.target.value)} /></label>{method==="cash" && <p>{t(language,"change")}: {money(Math.max(0, Number(paid||0)-total))}</p>}{error && <p className="error">{error}</p>}<div className="actions"><button disabled={busy} onClick={async()=>{try{setBusy(true); const amount=Number(paid||0); if(method==="cash" && amount<total) throw new Error("INSUFFICIENT_CASH"); await onConfirm(amount);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}}>{t(language,"confirm")}</button><button className="secondary" onClick={onClose}>{t(language,"close")}</button></div></Modal>;
}

function CancelBillModal({ repo, cart, staff, shift, settings, language, onClose, onDone }: { repo: PosRepository; cart: CartLine[]; staff: Staff; shift: Shift; settings: AppSettings; language: Language; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(""); const [pin, setPin] = useState(""); const [error, setError] = useState("");
  return <Modal title={t(language,"cancelBill")} onClose={onClose}><p className="warning">ยกเลิกก่อนชำระเงินจะไม่ตัดสต็อก</p><label>PIN<input value={pin} onChange={e=>setPin(e.target.value)} /></label><label>{t(language,"reason")}<input value={reason} onChange={e=>setReason(e.target.value)} /></label>{error&&<p className="error">{error}</p>}<div className="actions"><button onClick={async()=>{const ok=await repo.verifyPin(pin); if(!ok){setError("AUTHORIZED_PIN_REQUIRED");return;} const input:CancelBillInput={items:cart.map(l=>({productId:l.id,name:productName(language,l),quantity:l.quantity,unitPrice:l.price})),reason,staff:ok,shift,deviceId:settings.deviceId}; await repo.cancelBill(input); onDone();}}>{t(language,"confirm")}</button><button className="secondary" onClick={onClose}>{t(language,"close")}</button></div></Modal>;
}

function ProductsScreen({ repo, staff, products, language, refreshProducts }: { repo: PosRepository; staff: Staff; products: Product[]; language: Language; refreshProducts: () => Promise<void> }) {
  const [editing, setEditing] = useState<Product | ProductInput | null>(null);
  return <section className="panel"><div className="toolbar"><h1>{t(language,"products")}</h1><button onClick={()=>setEditing(emptyProduct())}>{t(language,"addProduct")}</button></div><table><tbody>{products.map(p=><tr key={p.id} onClick={()=>setEditing(p)}><td><strong>{productName(language,p)}</strong><small>{t(language,"productCode")}: {p.productCode}</small></td><td>{p.barcode || "-"}</td><td>{money(p.price)}</td><td className={p.stockQuantity<=p.minimumStock?"low":""}>{p.stockQuantity} {p.unit}</td><td>{p.active ? "เปิดขาย" : "ปิด"}</td></tr>)}</tbody></table>{editing && <ProductModal repo={repo} staff={staff} language={language} product={editing} onClose={()=>setEditing(null)} onSaved={async()=>{setEditing(null); await refreshProducts();}} />}</section>;
}

function ProductModal({ repo, staff, language, product, onClose, onSaved }: { repo: PosRepository; staff: Staff; language: Language; product: Product | ProductInput; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Product | ProductInput>({...product}); const [error, setError] = useState(""); const [duplicate, setDuplicate] = useState<Product | null>(null);
  const set = (key: keyof ProductInput, value: string | number | boolean) => setForm(f=>({...f,[key]:value}));
  const checkBarcode = async () => { const code=(form.barcode || "").trim(); if(!code) return; const found=await repo.findProductByBarcode(code); if(found && found.id !== ("id" in form ? form.id : undefined)) setDuplicate(found); else setDuplicate(null); };
  const save = async () => { try { setError(""); if(duplicate) throw new Error("BARCODE_EXISTS"); if(!form.productCode || !form.nameTh) throw new Error("PRODUCT_REQUIRED"); if("id" in form && form.id) await repo.updateProduct(form as Product, staff); else await repo.createProduct(form as ProductInput, staff); onSaved(); } catch(e) { setError(e instanceof Error ? e.message : String(e)); } };
  return <Modal title={"id" in form && form.id ? t(language,"edit") : t(language,"addProduct")} onClose={onClose}><div className="form-grid"><label>{t(language,"productCode")}<input value={form.productCode} onChange={e=>set("productCode", e.target.value)} /></label><label>{t(language,"barcode")}<input value={form.barcode || ""} onBlur={checkBarcode} onKeyDown={e=>{if(e.key==="Enter") checkBarcode();}} onChange={e=>{set("barcode", e.target.value); setDuplicate(null);}} /></label><label>{t(language,"nameTh")}<input value={form.nameTh} onChange={e=>set("nameTh", e.target.value)} /></label><label>{t(language,"nameEn")}<input value={form.nameEn || ""} onChange={e=>set("nameEn", e.target.value)} /></label><label>{t(language,"category")}<input value={form.categoryName} onChange={e=>{set("categoryName", e.target.value); set("categoryId", e.target.value.toLowerCase().replace(/\s+/g,"-") || "retail");}} /></label><label>{t(language,"unit")}<select value={form.unit} onChange={e=>set("unit", e.target.value)}>{units.map(u=><option key={u}>{u}</option>)}</select></label><label>{t(language,"price")}<input type="number" value={form.price} onChange={e=>set("price", Number(e.target.value))} /></label><label>{t(language,"cost")}<input type="number" value={form.cost} onChange={e=>set("cost", Number(e.target.value))} /></label><label>{t(language,"stock")}<input type="number" step="0.001" value={form.stockQuantity} onChange={e=>set("stockQuantity", Number(e.target.value))} /></label><label>{t(language,"minStock")}<input type="number" step="0.001" value={form.minimumStock} onChange={e=>set("minimumStock", Number(e.target.value))} /></label><label>Scale<input type="number" step="0.001" value={form.quantityScale} onChange={e=>set("quantityScale", Number(e.target.value)||1)} /></label><label>{t(language,"active")}<select value={form.active === false ? "0" : "1"} onChange={e=>set("active", e.target.value==="1")}><option value="1">เปิดขาย</option><option value="0">ปิดขาย</option></select></label></div>{duplicate && <p className="warning">{t(language,"duplicateBarcode")}: {duplicate.productCode} {productName(language,duplicate)} <button onClick={()=>{setForm(duplicate); setDuplicate(null);}}>{t(language,"openExisting")}</button></p>}{error&&<p className="error">{error}</p>}<div className="actions"><button onClick={save}>{t(language,"save")}</button><button className="secondary" onClick={onClose}>{t(language,"close")}</button></div></Modal>;
}

function SalesHistoryScreen({ repo, staff, shift, settings, language }: { repo: PosRepository; staff: Staff; shift: Shift; settings: AppSettings; language: Language }) {
  const [sales, setSales] = useState<Sale[]>([]); const [receipt, setReceipt] = useState<Receipt | null>(null); const [voiding, setVoiding] = useState<Sale | null>(null); const [date, setDate] = useState(today());
  const load = async () => setSales(await repo.listSales(100,{date,status:"all"})); useEffect(()=>{load();},[date]);
  return <section className="panel"><div className="toolbar"><h1>{t(language,"history")}</h1><input type="date" value={date} onChange={e=>setDate(e.target.value)} /></div><table><tbody>{sales.map(s=><tr key={s.id}><td><strong>{s.receiptNo}</strong><small>{s.createdAt}</small></td><td>{t(language,s.paymentMethod)}</td><td>{money(s.total)}</td><td>{s.status}</td><td><button onClick={async()=>setReceipt(await repo.getReceipt(s.id))}>{t(language,"receipt")}</button>{s.status==="completed" && <button className="danger" onClick={()=>setVoiding(s)}>{t(language,"voidSale")}</button>}</td></tr>)}</tbody></table>{receipt && <ReceiptModal receipt={receipt} language={language} onClose={()=>setReceipt(null)} reprint />}{voiding && <VoidSaleModal repo={repo} sale={voiding} staff={staff} shift={shift} settings={settings} language={language} onClose={()=>setVoiding(null)} onDone={async()=>{setVoiding(null); await load();}} />}</section>;
}

function VoidSaleModal({ repo, sale, staff, shift, settings, language, onClose, onDone }: { repo: PosRepository; sale: Sale; staff: Staff; shift: Shift; settings: AppSettings; language: Language; onClose: () => void; onDone: () => void }) {
  const [pin,setPin]=useState(""); const [reason,setReason]=useState(""); const [restock,setRestock]=useState(true); const [error,setError]=useState("");
  return <Modal title={`${t(language,"voidSale")} ${sale.receiptNo}`} onClose={onClose}><label>PIN<input value={pin} onChange={e=>setPin(e.target.value)} /></label><label>{t(language,"reason")}<input value={reason} onChange={e=>setReason(e.target.value)} /></label><label className="inline-check"><input type="checkbox" checked={restock} onChange={e=>setRestock(e.target.checked)} />{t(language,"restockReturned")}</label>{error&&<p className="error">{error}</p>}<div className="actions"><button onClick={async()=>{try{await repo.voidSale({saleId:sale.id,pin,reason,restock,staff,shift,deviceId:settings.deviceId}); onDone();}catch(e){setError(e instanceof Error?e.message:String(e));}}}>{t(language,"confirm")}</button><button className="secondary" onClick={onClose}>{t(language,"close")}</button></div></Modal>;
}

function ReportsScreen({ repo, language }: { repo: PosRepository; language: Language }) {
  const [date,setDate]=useState(today()); const [summary,setSummary]=useState<SalesSummary | null>(null); const [stock,setStock]=useState<StockMovement[]>([]);
  useEffect(()=>{repo.getSalesSummary(date).then(setSummary); repo.listStockMovements(40).then(setStock);},[date]);
  return <section className="split"><div className="panel"><div className="toolbar"><h1>{t(language,"reports")}</h1><input type="date" value={date} onChange={e=>setDate(e.target.value)} /></div>{summary && <div className="metric-grid"><Metric label={t(language,"total")} value={money(summary.totalSales)} /><Metric label="Bills" value={String(summary.billCount)} /><Metric label={t(language,"cash")} value={money(summary.cashTotal)} /><Metric label={t(language,"transfer")} value={money(summary.transferTotal)} /><Metric label="Void" value={`${summary.cancelledCount} / ${money(summary.cancelledValue)}`} /></div>}<h3>Top products</h3>{summary?.byProduct.map(p=><p key={p.label}>{p.label}: {p.quantity} · {money(p.total)}</p>)}</div><div className="panel"><h2>Stock ledger</h2><div className="mini-list">{stock.map(s=><p key={s.id}><strong>{s.movementType}</strong> {s.name} {s.quantity} <small>{s.reason}</small></p>)}</div></div></section>;
}

function EmployeesScreen({ repo, staff, language }: { repo: PosRepository; staff: Staff; language: Language }) {
  const [rows,setRows]=useState<Staff[]>([]); const [code,setCode]=useState(""); const [name,setName]=useState(""); const [pin,setPin]=useState(""); const [role,setRole]=useState<Staff["role"]>("staff");
  const load=async()=>setRows(await repo.listEmployees()); useEffect(()=>{load();},[]);
  return <section className="panel"><h1>{t(language,"employees")}</h1><p className="warning">{t(language,"demoPin")}</p><div className="form-grid"><input placeholder="Code" value={code} onChange={e=>setCode(e.target.value)} /><input placeholder="Name" value={name} onChange={e=>setName(e.target.value)} /><input placeholder="Demo PIN" value={pin} onChange={e=>setPin(e.target.value)} /><select value={role} onChange={e=>setRole(e.target.value as Staff["role"])}><option value="staff">staff</option><option value="manager">manager</option><option value="owner">owner</option></select></div><button onClick={async()=>{await repo.saveEmployee({code,displayName:name,role,active:true,demoPin:pin},staff); setCode(""); setName(""); setPin(""); await load();}}>{t(language,"save")}</button><table><tbody>{rows.map(r=><tr key={r.id}><td>{r.code}</td><td>{r.displayName}</td><td>{r.role}</td><td>{r.active!==false?"active":"inactive"}</td></tr>)}</tbody></table></section>;
}

function SettingsScreen({ repo, staff, settings, language, refreshSettings }: { repo: PosRepository; staff: Staff; settings: AppSettings; language: Language; refreshSettings: () => Promise<void> }) {
  const [form,setForm]=useState(settings); const [health,setHealth]=useState<StorageHealth | null>(null); useEffect(()=>{setForm(settings); repo.getStorageHealth().then(setHealth);},[settings]);
  const set = (key: keyof AppSettings, value: string | boolean) => setForm(f=>({...f,[key]:value}));
  return <section className="split"><div className="panel"><h1>{t(language,"settings")}</h1><div className="form-grid"><label>{t(language,"language")}<select value={form.language} onChange={e=>set("language", e.target.value as Language)}><option value="th">{t(language,"thai")}</option><option value="en">{t(language,"english")}</option></select></label><label>Store<input value={form.storeName} onChange={e=>set("storeName",e.target.value)} /></label><label>Branch<input value={form.branchName} onChange={e=>set("branchName",e.target.value)} /></label><label>Device<input value={form.deviceName} onChange={e=>set("deviceName",e.target.value)} /></label><label>Receipt footer<input value={form.receiptFooter} onChange={e=>set("receiptFooter",e.target.value)} /></label><label>Printer<input value={form.printerType} onChange={e=>set("printerType",e.target.value)} /></label></div><p className="warning">{t(language,"recordOnly")}</p><p className="warning">{t(language,"demoPin")}</p><button onClick={async()=>{await repo.updateSettings(form, staff); await refreshSettings();}}>{t(language,"save")}</button></div><div className="panel"><h2>{t(language,"storage")}</h2><StoragePanel health={health} /></div></section>;
}

function CloseShiftModal({ repo, staff, shift, settings, language, onClose, onConfirm }: { repo: PosRepository; staff: Staff; shift: Shift; settings: AppSettings; language: Language; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [summary,setSummary]=useState<SalesSummary | null>(null); useEffect(()=>{repo.getSalesSummary(today()).then(setSummary);},[]);
  return <Modal title={t(language,"closeShiftTitle")} onClose={onClose}><p>{settings.storeName} · {staff.displayName} · {shift.id.slice(0,8)}</p>{summary && <div className="metric-grid"><Metric label={t(language,"total")} value={money(summary.totalSales)} /><Metric label="Bills" value={String(summary.billCount)} /><Metric label={t(language,"cash")} value={money(summary.cashTotal)} /><Metric label={t(language,"transfer")} value={money(summary.transferTotal)} /></div>}<p className="warning">{t(language,"closedToLogin")}</p><div className="actions"><button onClick={onConfirm}>{t(language,"confirmCloseShift")}</button><button className="secondary" onClick={onClose}>{t(language,"close")}</button></div></Modal>;
}

function ReceiptModal({ receipt, language, onClose, reprint=false }: { receipt: Receipt; language: Language; onClose: () => void; reprint?: boolean }) {
  return <Modal title={reprint?t(language,"reprint"):t(language,"receipt")} onClose={onClose}><div className="receipt"><h2>{receipt.settings.receiptHeader}</h2><p>{receipt.settings.storeName}</p><p>{receipt.receiptNo}</p><p>{receipt.createdAt}</p>{receipt.items.map(i=><div className="receipt-line" key={i.id || i.name}><span>{i.name} × {i.quantity}</span><span>{money(i.lineTotal)}</span></div>)}<hr/><div className="receipt-line"><strong>{t(language,"total")}</strong><strong>{money(receipt.total)}</strong></div><p>{t(language,receipt.paymentMethod)} · {receipt.status}</p>{receipt.paymentMethod!=="cash" && <p className="warning">{t(language,"recordOnly")}</p>}<p>{receipt.settings.receiptFooter}</p></div></Modal>;
}

function StoragePanel({ health }: { health: StorageHealth | null }) { if(!health) return <p>Loading...</p>; return <div className="metric-grid"><Metric label="DB" value={`${Math.round(health.databaseSize/1024)} KB`} /><Metric label="Media" value={`${Math.round(health.mediaSize/1024)} KB`} /><Metric label="Sales" value={String(health.salesCount)} /><Metric label="Audit" value={String(health.auditCount)} /></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function Modal({ title, children, onClose }: ModalProps) { return <div className="modal-backdrop"><section className="modal"><header><h2>{title}</h2><button onClick={onClose}>×</button></header>{children}</section></div>; }
