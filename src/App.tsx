import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createRepository } from "./data";
import type { PosRepository } from "./data/repository";
import type { AppSettings, Language, Product, SalesSummary, Shift, Staff, StockMovement, StorageHealth } from "./domain/types";
import { productName, t } from "./i18n";
import { RetailSalesScreen } from "./RetailSalesScreen";
import { AppSidebar } from "./AppSidebar";
import { SalesHistoryScreenV2 } from "./SalesHistoryScreen";
import { ProductsScreenV2 } from "./ProductsScreen";
import "./inventory-ui.css";

type View = "sales" | "products" | "salesHistory" | "reports" | "employees" | "settings";
const money = (n: number) => `฿${Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
const SYSTEM_LOGO = "/icon.png";
const completeStartupSplash = async () => { try { await invoke("complete_startup_splash"); } catch { /* Browser preview fallback. */ } };
const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
const lowStockBody = (products: Product[], language: Language) => {
  const names = products.slice(0, 4).map(p => `${productName(language, p)} เหลือ ${p.stockQuantity} ${p.unit}`).join(" · ");
  return products.length ? `มีสินค้าใกล้หมด/หมด ${products.length} รายการ${names ? `: ${names}` : ""}` : "";
};
const requestStockNotification = async (products: Product[], language: Language) => {
  if (!products.length || !("Notification" in window)) return;
  const body = lowStockBody(products, language);
  const title = "CpIPOS แจ้งเตือนสต็อกต่ำ";
  try {
    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: SYSTEM_LOGO });
      return;
    }
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission === "granted") new Notification(title, { body, icon: SYSTEM_LOGO });
    }
  } catch {
    // Browser/Tauri preview can still show the in-app notice inside the inventory page.
  }
};

export default function App() {
  const [repo, setRepo] = useState<PosRepository | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [view, setView] = useState<View>("sales");
  const [error, setError] = useState("");
  const [splashStep, setSplashStep] = useState(0);
  const [closeShift, setCloseShift] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem("cpipos.nav.collapsed") === "1");
  const [clock, setClock] = useState(nowTime());
  const language: Language = settings?.language || "th";
  const splashTexts = [t(language, "loading"), t(language, "loadingDb"), t(language, "loadingShift")];
  const refreshProducts = async (r = repo) => { if (r) setProducts(await r.listProducts()); };
  const refreshSettings = async (r = repo) => { if (r) setSettings(await r.getSettings()); };
  const refreshShift = async (r = repo) => { if (r) setShift(await r.getActiveShift()); };

  useEffect(() => { const id = window.setInterval(() => setClock(nowTime()), 30000); return () => window.clearInterval(id); }, []);
  useEffect(() => { const id = window.setInterval(() => setSplashStep(s => s >= 3 ? s : Math.min(2, s + 1)), 260); return () => window.clearInterval(id); }, []);
  useEffect(() => { localStorage.setItem("cpipos.nav.collapsed", navCollapsed ? "1" : "0"); }, [navCollapsed]);
  useEffect(() => {
    let alive = true;
    const finishStartup = () => window.setTimeout(() => {
      if (alive) {
        setSplashStep(3);
        void completeStartupSplash();
      }
    }, 900);
    (async () => {
      try {
        const r = await createRepository();
        await r.initialize();
        const [saved, activeShift, currentSettings, currentProducts] = await Promise.all([
          r.getSavedSession(),
          r.getActiveShift(),
          r.getSettings(),
          r.listProducts(),
        ]);
        if (!alive) return;
        setRepo(r);
        setStaff(saved);
        setShift(activeShift);
        setSettings(currentSettings);
        setProducts(currentProducts);
        finishStartup();
      } catch {
        setError(t(language, "dbError"));
        finishStartup();
      }
    })();
    return () => { alive = false; };
  }, []);

  if (splashStep < 3) return <main className="splash"><div className="splash-card"><img src="/icon.png" alt="CpIPOS" /><h1>CpIPOS Desktop</h1><p>{splashTexts[splashStep]}</p></div></main>;
  if (error || !repo || !settings) return <main className="center-screen"><section className="error-card"><h1>{t(language, "dbError")}</h1><p>{error || t(language, "dbError")}</p></section></main>;
  if (!staff) return <LoginScreen repo={repo} settings={settings} language={language} onLogin={async s => { await repo.saveSession(s); setStaff(s); await refreshShift(repo); }} />;
  if (!shift) return <ShiftScreen repo={repo} staff={staff} settings={settings} language={language} onOpen={async s => { setShift(s); setView("sales"); }} />;

  const nav = [
    { id: "sales", label: t(language, "sales"), icon: "sale" as const },
    { id: "products", label: t(language, "products"), icon: "stock" as const },
    { id: "salesHistory", label: t(language, "history"), icon: "history" as const },
    { id: "reports", label: t(language, "reports"), icon: "report" as const },
    { id: "employees", label: t(language, "employees"), icon: "staff" as const },
    { id: "settings", label: t(language, "settings"), icon: "settings" as const },
  ];

  return <main className={`app-shell ${navCollapsed ? "nav-collapsed" : ""}`}>
    <AppSidebar collapsed={navCollapsed} active={view} items={nav} onToggle={() => setNavCollapsed(v => !v)} onSelect={id => setView(id as View)} onCloseShift={() => setCloseShift(true)} onLogout={() => setLogoutOpen(true)} />
    <section className="workspace">
      <header className="topbar">
        <div><strong>CpIPOS</strong><span>{settings.storeName} / {settings.branchName}</span></div>
        <div className="topbar-meta"><span>{t(language, "cashier")}: {staff.displayName}</span><span>{t(language, "role")}: {staff.role}</span><span>{t(language, "currentShift")}: {shift.id.slice(0, 8)}</span><span>{clock}</span><button onClick={() => setCloseShift(true)}>{t(language, "closeShift")}</button></div>
      </header>
      <div className={`view-body ${view === "sales" ? "sales-view" : ""}`}>
        {view === "sales" && <RetailSalesScreen repo={repo} staff={staff} shift={shift} settings={settings} products={products} language={language} refreshProducts={() => refreshProducts(repo)} />}
        {view === "products" && <ProductsScreenV2 repo={repo} staff={staff} products={products} language={language} refreshProducts={() => refreshProducts(repo)} requestStockNotification={requestStockNotification} />}
        {view === "salesHistory" && <SalesHistoryScreenV2 repo={repo} staff={staff} shift={shift} settings={settings} language={language} />}
        {view === "reports" && <ReportsScreen repo={repo} language={language} />}
        {view === "employees" && <EmployeesScreen repo={repo} staff={staff} language={language} />}
        {view === "settings" && <SettingsScreen repo={repo} staff={staff} settings={settings} language={language} refreshSettings={() => refreshSettings(repo)} />}
      </div>
    </section>
    {closeShift && <CloseShiftModal repo={repo} staff={staff} shift={shift} settings={settings} language={language} onClose={() => setCloseShift(false)} onConfirm={async () => { await repo.closeShift(staff, settings.deviceId); await repo.clearSession(staff, shift, settings.deviceId); setCloseShift(false); setShift(null); setStaff(null); }} />}
    {logoutOpen && <LogoutModal repo={repo} staff={staff} shift={shift} settings={settings} onClose={() => setLogoutOpen(false)} onConfirm={async () => { await repo.clearSession(staff, shift, settings.deviceId); setLogoutOpen(false); setView("sales"); setStaff(null); }} />}
  </main>;
}

function LoginScreen({ repo, settings, language, onLogin }: { repo: PosRepository; settings: AppSettings; language: Language; onLogin: (staff: Staff) => void }) {
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const submit = async () => { const s = await repo.verifyPin(pin); if (s && (!code || s.code.toLowerCase() === code.toLowerCase())) onLogin(s); else { setError(t(language, "pinWrong")); setPin(""); } };
  const press = (v: string) => { if (v === "back") setPin(pin.slice(0, -1)); else if (v === "ok") void submit(); else if (pin.length < 8) setPin(pin + v); };
  return <main className="center-screen"><section className="login-card pos-card"><img className="brand-logo" src="/icon.png" alt="CpIPOS" /><h1>{settings.storeName}</h1><p>{settings.branchName}</p><label>{t(language, "employeeCode")}<input value={code} onChange={e => setCode(e.target.value)} autoFocus /></label><p>{t(language, "loginHint")}</p><div className="pin-dots">{[0, 1, 2, 3].map(i => <span key={i} className={pin.length > i ? "filled" : ""} />)}</div>{error && <ErrorMessage text={error} />}<div className="keypad">{"123456789".split("").map(n => <button key={n} onClick={() => press(n)}>{n}</button>)}<button onClick={() => press("0")}>0</button><button onClick={() => press("back")}>⌫</button><button className="primary" onClick={() => press("ok")}>OK</button></div><p className="warning">{t(language, "demoPin")}</p></section></main>;
}

function ShiftScreen({ repo, staff, settings, language, onOpen }: { repo: PosRepository; staff: Staff; settings: AppSettings; language: Language; onOpen: (shift: Shift) => void }) {
  const [cash, setCash] = useState("0");
  const [busy, setBusy] = useState(false);
  return <main className="center-screen"><section className="shift-card pos-card"><span className="status-pill">{t(language, "offlineReady")}</span><h1>{t(language, "openShift")}</h1><div className="info-grid"><Metric label={t(language, "cashier")} value={staff.displayName} /><Metric label="Branch" value={settings.branchName} /><Metric label="Device" value={settings.deviceName} /></div><label>{t(language, "openingCash")}<input type="number" value={cash} onChange={e => setCash(e.target.value)} /></label><button className="big-primary" disabled={busy} onClick={async () => { setBusy(true); onOpen(await repo.openShift(Number(cash || 0), staff, settings.deviceId)); }}>{busy ? t(language, "submitBusy") : t(language, "open")}</button></section></main>;
}

function ReportsScreen({ repo, language }: { repo: PosRepository; language: Language }) {
  const [date, setDate] = useState(today());
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [stock, setStock] = useState<StockMovement[]>([]);
  useEffect(() => { void repo.getSalesSummary(date).then(setSummary); void repo.listStockMovements(40).then(setStock); }, [date]);
  return <section className="split"><div className="panel"><div className="toolbar"><h1>{t(language, "reports")}</h1><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>{summary ? <><div className="metric-grid"><Metric label="ยอดขายรวม" value={money(summary.totalSales)} /><Metric label="จำนวนบิล" value={String(summary.billCount)} /><Metric label={t(language, "cash")} value={money(summary.cashTotal)} /><Metric label={t(language, "transfer")} value={money(summary.transferTotal)} /><Metric label="เฉลี่ยต่อบิล" value={money(summary.averageBill)} /><Metric label="บิลยกเลิก" value={`${summary.cancelledCount} / ${money(summary.cancelledValue)}`} /></div><h3>{t(language, "byProduct")}</h3>{summary.byProduct.length ? summary.byProduct.map(p => <p key={p.label}>{p.label}: {p.quantity} · {money(p.total)}</p>) : <EmptyState text={t(language, "empty")} />}<h3>{t(language, "byEmployee")}</h3>{summary.byEmployee.length ? summary.byEmployee.map(p => <p key={p.label}>{p.label}: {p.count} · {money(p.total)}</p>) : <EmptyState text={t(language, "empty")} />}</> : <LoadingState />}</div><div className="panel"><h2>Stock ledger</h2><div className="mini-list">{stock.length ? stock.map(s => <p key={s.id}><strong>{s.movementType}</strong> {s.name} {s.quantity} <small>{s.reason}</small></p>) : <EmptyState text={t(language, "empty")} />}</div></div></section>;
}

function EmployeesScreen({ repo, staff, language }: { repo: PosRepository; staff: Staff; language: Language }) {
  const [rows, setRows] = useState<Staff[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<Staff["role"]>("staff");
  const load = async () => setRows(await repo.listEmployees());
  useEffect(() => { void load(); }, []);
  return <section className="panel"><div className="toolbar"><h1>{t(language, "employees")}</h1></div><p className="warning">{t(language, "demoPin")}</p><div className="form-grid"><input placeholder={t(language, "employeeCode")} value={code} onChange={e => setCode(e.target.value)} /><input placeholder="Name" value={name} onChange={e => setName(e.target.value)} /><input placeholder="Demo PIN" value={pin} onChange={e => setPin(e.target.value)} /><select value={role} onChange={e => setRole(e.target.value as Staff["role"])}><option value="staff">staff</option><option value="manager">manager</option><option value="owner">owner</option></select></div><button onClick={async () => { await repo.saveEmployee({ code, displayName: name, role, active: true, demoPin: pin }, staff); setCode(""); setName(""); setPin(""); await load(); }}>{t(language, "save")}</button><table><tbody>{rows.map(r => <tr key={r.id}><td>{r.displayName}</td><td>{r.code}</td><td>{r.role}</td><td>{r.active !== false ? t(language, "active") : t(language, "inactive")}</td></tr>)}</tbody></table></section>;
}

function SettingsScreen({ repo, staff, settings, language, refreshSettings }: { repo: PosRepository; staff: Staff; settings: AppSettings; language: Language; refreshSettings: () => Promise<void> }) {
  const [form, setForm] = useState(settings);
  const [section, setSection] = useState("store");
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [logoError, setLogoError] = useState("");
  useEffect(() => { setForm(settings); void repo.getStorageHealth().then(setHealth); }, [settings]);
  const set = (key: keyof AppSettings, value: string | boolean) => setForm(f => ({ ...f, [key]: value }));
  const nav = [['store', t(language, 'storeInfo')], ['branch', t(language, 'branchDevice')], ['language', t(language, 'language')], ['owner', t(language, 'owner')], ['receipt', t(language, 'receiptSettings')], ['printer', t(language, 'printer')], ['scanner', t(language, 'scanner')], ['storage', t(language, 'storage')], ['backup', t(language, 'backupRestore')], ['remote', t(language, 'remoteManagement')], ['about', t(language, 'versionAbout')]];
  const save = async () => { await repo.updateSettings(form, staff); await refreshSettings(); };
  return <section className="split"><div className="panel settings-nav">{nav.map(([id, label]) => <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>{label}</button>)}</div><div className="panel"><h1>{nav.find(n => n[0] === section)?.[1]}</h1>
    {section === "language" && <label>{t(language, "language")}<select value={form.language} onChange={e => set("language", e.target.value as Language)}><option value="th">{t(language, "thai")}</option><option value="en">{t(language, "english")}</option></select></label>}
    {section === "store" && <div className="form-grid"><label>ชื่อร้าน<input value={form.storeName} onChange={e => set("storeName", e.target.value)} /></label><label>สาขา<input value={form.branchName} onChange={e => set("branchName", e.target.value)} /></label><label>ที่อยู่<textarea value={form.address} onChange={e => set("address", e.target.value)} /></label><label>เบอร์โทรศัพท์<input value={form.phone} onChange={e => set("phone", e.target.value)} /></label><label>เลขผู้เสียภาษี<input value={form.taxId} onChange={e => set("taxId", e.target.value)} /></label><div className="settings-logo-preview"><img src={form.storeLogoPath || SYSTEM_LOGO} alt="โลโก้ใบเสร็จ" onError={e => { e.currentTarget.src = SYSTEM_LOGO; }} /><div><strong>โลโก้ใบเสร็จ</strong><small>{form.storeLogoPath ? "ใช้โลโก้ร้านจากการตั้งค่า" : "ยังไม่ใส่โลโก้ร้าน จะแสดงโลโก้ระบบ CpIPOS"}</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { setLogoError(""); set("storeLogoPath", await readFileAsDataUrl(file)); } catch { setLogoError("อ่านไฟล์โลโก้ไม่สำเร็จ"); } }} /><button type="button" className="secondary" onClick={() => set("storeLogoPath", "")}>ใช้โลโก้ระบบ</button></div>{logoError && <ErrorMessage text={logoError} />}</div></div>}
    {section === "branch" && <div className="form-grid"><label>Device<input value={form.deviceName} onChange={e => set("deviceName", e.target.value)} /></label><label>Device ID<input value={form.deviceId} onChange={e => set("deviceId", e.target.value)} /></label></div>}
    {section === "receipt" && <div className="form-grid"><label>ชื่อหัวใบเสร็จ<input value={form.receiptHeader} onChange={e => set("receiptHeader", e.target.value)} /></label><label>ข้อความท้ายใบเสร็จ<input value={form.receiptFooter} onChange={e => set("receiptFooter", e.target.value)} /></label><label>ที่อยู่บนใบเสร็จ<textarea value={form.address} onChange={e => set("address", e.target.value)} /></label><label>เบอร์โทรบนใบเสร็จ<input value={form.phone} onChange={e => set("phone", e.target.value)} /></label><label>เลขผู้เสียภาษี<input value={form.taxId} onChange={e => set("taxId", e.target.value)} /></label></div>}
    {section === "printer" && <div className="printer-setup-card"><strong>ตั้งค่าเครื่องพิมพ์ใบเสร็จ 80mm</strong><p className="warning">โหมดนี้ใช้ Windows Print Dialog เพื่อเลือกเครื่องพิมพ์จริงที่ติดตั้งใน Windows แล้ว เช่น thermal printer 80mm. ตั้งค่าครั้งแรกแล้ว Windows จะจำค่าเครื่องพิมพ์ตามระบบ</p><div className="form-grid"><label>ชื่อเครื่องพิมพ์<input placeholder="เช่น XP-80C / POS-80 / Rongta 80mm" value={form.printerName} onChange={e => set("printerName", e.target.value)} /></label><label>ชนิดการพิมพ์<select value={form.printerType} onChange={e => set("printerType", e.target.value)}><option value="windows-print-dialog">Windows Print Dialog</option><option value="not-configured">ยังไม่ได้ตั้งค่า</option></select></label><label>ขนาดกระดาษ<select value={form.printerPaperWidthMm} onChange={e => set("printerPaperWidthMm", e.target.value)}><option value="80">80mm</option><option value="58">58mm</option></select></label><label>หมายเหตุการเชื่อมต่อ<input value={form.printerConnectionNote} onChange={e => set("printerConnectionNote", e.target.value)} /></label></div><p>เมื่อกดปุ่ม <strong>พิมพ์ใบเสร็จ 80mm</strong> ระบบจะเปิดหน้าต่างพิมพ์ของ Windows ให้เลือกเครื่องพิมพ์จริง</p></div>}
    {section === "scanner" && <p>{form.scannerMode}</p>}{section === "storage" && <StoragePanel health={health} />} {['backup', 'remote'].includes(section) && <p className="warning">{t(language, "notReady")}</p>} {section === "owner" && <p className="warning">{t(language, "demoPin")}</p>} {section === "about" && <p>CpIPOS Desktop 0.1.0</p>}<p className="warning">{t(language, "recordOnly")}</p><button onClick={() => void save()}>{t(language, "save")}</button></div></section>;
}

function LogoutModal({ repo, staff, shift, settings, onClose, onConfirm }: { repo: PosRepository; staff: Staff; shift: Shift; settings: AppSettings; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <Modal title="ล็อคเอาท์" onClose={busy ? () => {} : onClose}>
    <div className="logout-confirm-card"><div className="logout-confirm-icon">↪</div><div><strong>ออกจากผู้ใช้งานปัจจุบัน?</strong><p>ระบบจะกลับไปหน้าใส่รหัสพนักงาน แต่กะขายปัจจุบันยังเปิดอยู่ ถ้าต้องการปิดรอบขายให้ใช้เมนู “ปิดยอด”</p></div></div>
    <div className="info-grid"><Metric label="แคชเชียร์" value={staff.displayName} /><Metric label="สาขา" value={settings.branchName} /><Metric label="กะปัจจุบัน" value={shift.id.slice(0, 8)} /></div>
    <div className="actions"><button disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); }}>{busy ? "กำลังออกจากระบบ..." : "ยืนยันล็อคเอาท์"}</button><button className="secondary" disabled={busy} onClick={onClose}>กลับ</button></div>
  </Modal>;
}

function CloseShiftModal({ repo, staff, shift, settings, language, onClose, onConfirm }: { repo: PosRepository; staff: Staff; shift: Shift; settings: AppSettings; language: Language; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void repo.getSalesSummary(today()).then(setSummary); }, []);
  return <Modal title={t(language, "closeShiftTitle")} onClose={busy ? () => {} : onClose}><div className="info-grid"><Metric label={t(language, "cashier")} value={staff.displayName} /><Metric label="Branch" value={settings.branchName} /><Metric label={t(language, "currentShift")} value={shift.id.slice(0, 8)} /></div>{summary && <div className="metric-grid"><Metric label="จำนวนบิล" value={String(summary.billCount)} /><Metric label={t(language, "total")} value={money(summary.totalSales)} /><Metric label={t(language, "cash")} value={money(summary.cashTotal)} /><Metric label={t(language, "transfer")} value={money(summary.transferTotal)} /><Metric label="Void" value={String(summary.cancelledCount)} /></div>}<p className="warning">{t(language, "closedToLogin")}</p><div className="actions"><button disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); }}>{busy ? t(language, "submitBusy") : t(language, "confirmCloseShift")}</button><button className="secondary" disabled={busy} onClick={onClose}>{t(language, "back")}</button></div></Modal>;
}

function StoragePanel({ health }: { health: StorageHealth | null }) { if (!health) return <LoadingState />; return <div className="metric-grid"><Metric label="DB" value={`${Math.round(health.databaseSize / 1024)} KB`} /><Metric label="Media" value={`${Math.round(health.mediaSize / 1024)} KB`} /><Metric label="Sales" value={String(health.salesCount)} /><Metric label="Audit" value={String(health.auditCount)} /></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function EmptyState({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }
function LoadingState() { return <div className="empty-state">Loading...</div>; }
function ErrorMessage({ text }: { text: string }) { return <p className="error-message">{text}</p>; }
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) { useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onClose]); return <div className="modal-backdrop"><section className="modal"><header><h2>{title}</h2><button onClick={onClose}>×</button></header>{children}</section></div>; }
