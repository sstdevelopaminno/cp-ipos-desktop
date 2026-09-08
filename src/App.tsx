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
import { ReportsDashboardScreen } from "./ReportsDashboardScreen";
import "./inventory-ui.css";

type View = "sales" | "products" | "salesHistory" | "reports" | "employees" | "settings";
const money = (n: number) => `฿${Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const SYSTEM_LOGO = "/icon.png";
const completeStartupSplash = async () => { try { await invoke("complete_startup_splash"); } catch { /* Browser preview fallback. */ } };
const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
const INSTALL_ID_KEY = "cpipos.installation.id";
const getInstallationId = () => {
  if (typeof localStorage === "undefined") return "preview-installation";
  const saved = localStorage.getItem(INSTALL_ID_KEY);
  if (saved) return saved;
  const id = crypto.randomUUID();
  localStorage.setItem(INSTALL_ID_KEY, id);
  return id;
};
const shortHash = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
};
const licenseDeviceFingerprint = (settings: AppSettings) => "CP-" + shortHash(settings.deviceId + "|" + settings.deviceName + "|" + getInstallationId());
const licenseStatusText = (status: string) => status === "active" ? "เปิดใช้งานแล้ว" : status === "pending_activation" ? "รอเปิดใช้งานกับ CpIPOS-IT" : status === "revoked" ? "ถูกระงับ" : status === "expired" ? "หมดอายุ" : "ยังไม่ใส่ลายเส้น";
type ScreenProfile = { width: number; height: number; shortNav: boolean; compactNav: boolean };
const detectScreenProfile = (): ScreenProfile => {
  if (typeof window === "undefined") return { width: 1366, height: 768, shortNav: false, compactNav: false };
  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width || window.innerWidth || 1366);
  const height = Math.round(viewport?.height || window.innerHeight || 768);
  return { width, height, shortNav: height <= 820, compactNav: width < 1180 || height < 700 };
};

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
  const [screenProfile, setScreenProfile] = useState<ScreenProfile>(() => detectScreenProfile());
  const [closeShift, setCloseShift] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem("cpipos.nav.collapsed");
    return saved === null ? detectScreenProfile().compactNav : saved === "1";
  });
  const [clock, setClock] = useState(nowTime());
  const language: Language = settings?.language || "th";
  const splashTexts = [t(language, "loading"), t(language, "loadingDb"), t(language, "loadingShift")];
  const refreshProducts = async (r = repo) => { if (r) setProducts(await r.listProducts()); };
  const refreshSettings = async (r = repo) => { if (r) setSettings(await r.getSettings()); };
  const refreshShift = async (r = repo) => { if (r) setShift(await r.getActiveShift()); };

  useEffect(() => { const id = window.setInterval(() => setClock(nowTime()), 1000); return () => window.clearInterval(id); }, []);
  useEffect(() => {
    const applyProfile = () => {
      const next = detectScreenProfile();
      setScreenProfile(next);
      document.documentElement.style.setProperty("--app-vh", next.height + "px");
      localStorage.setItem("cpipos.screen.currentProfile", JSON.stringify({ ...next, capturedAt: new Date().toISOString() }));
      if (!localStorage.getItem("cpipos.screen.initialProfile")) {
        localStorage.setItem("cpipos.screen.initialProfile", JSON.stringify({ ...next, devicePixelRatio: window.devicePixelRatio || 1, capturedAt: new Date().toISOString() }));
      }
    };
    applyProfile();
    window.addEventListener("resize", applyProfile);
    window.visualViewport?.addEventListener("resize", applyProfile);
    return () => { window.removeEventListener("resize", applyProfile); window.visualViewport?.removeEventListener("resize", applyProfile); };
  }, []);
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

  const effectiveNavCollapsed = screenProfile.compactNav || navCollapsed;
  const shellClassName = "app-shell " + (effectiveNavCollapsed ? "nav-collapsed " : "") + (screenProfile.shortNav ? "nav-short " : "") + (screenProfile.compactNav ? "nav-auto-compact" : "");

  return <main className={shellClassName}>
    <AppSidebar collapsed={effectiveNavCollapsed} compactLocked={screenProfile.compactNav} active={view} items={nav} onToggle={() => { if (!screenProfile.compactNav) setNavCollapsed(v => !v); }} onSelect={id => setView(id as View)} onCloseShift={() => setCloseShift(true)} onLogout={() => setLogoutOpen(true)} />
    <section className="workspace">
      <header className="topbar">
        <div><strong>CpIPOS</strong><span>{settings.storeName} / {settings.branchName}</span></div>
        <div className="topbar-meta"><span>{t(language, "cashier")}: {staff.displayName}</span><span>{t(language, "role")}: {staff.role}</span><span>{t(language, "currentShift")}: {shift.id.slice(0, 8)}</span><span>วันที่/เวลา: {clock}</span><button onClick={() => setCloseShift(true)}>{t(language, "closeShift")}</button></div>
      </header>
      <div className={`view-body ${view === "sales" ? "sales-view" : ""} ${view === "reports" ? "reports-view" : ""}`}>
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
  return <ReportsDashboardScreen repo={repo} language={language} />;
}

function EmployeesScreen({ repo, staff, language }: { repo: PosRepository; staff: Staff; language: Language }) {
  const [rows, setRows] = useState<Staff[]>([]);
  const [formTarget, setFormTarget] = useState<Staff | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Staff | null>(null);
  const load = async () => setRows(await repo.listEmployees());
  useEffect(() => { void load(); }, []);
  return <section className="panel employees-page">
    <div className="employees-toolbar">
      <div><h1>{t(language, "employees")}</h1><p>{t(language, "demoPin")}</p></div>
      <button className="inventory-primary" onClick={() => setFormTarget("new")}>เพิ่มพนักงาน</button>
    </div>
    <div className="employees-table-shell">
      <div className="employees-table-summary"><strong>{rows.length.toLocaleString("th-TH")} รายการ</strong><span>จัดการรหัสพนักงาน สิทธิ์ และสถานะใช้งาน</span></div>
      <div className="employees-table-wrap">
        <table className="employees-table"><thead><tr><th>ชื่อพนักงาน</th><th>รหัส</th><th>สิทธิ์</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>{rows.map(row => {
          const isCurrent = row.id === staff.id;
          return <tr key={row.id}><td><strong>{row.displayName}</strong>{isCurrent && <small>ผู้ใช้งานปัจจุบัน</small>}</td><td>{row.code}</td><td>{row.role}</td><td><span className={row.active !== false ? "badge normal" : "badge cancelled"}>{row.active !== false ? t(language, "active") : t(language, "inactive")}</span></td><td><div className="inventory-actions"><button className="inventory-action edit" onClick={() => setFormTarget(row)}>แก้ไข</button><button className="inventory-action delete" disabled={isCurrent} onClick={() => setDeleteTarget(row)}>ลบ</button></div></td></tr>;
        })}</tbody></table>
      </div>
    </div>
    {formTarget && <EmployeeFormModal repo={repo} staff={staff} language={language} initial={formTarget === "new" ? undefined : formTarget} onClose={() => setFormTarget(null)} onSaved={async () => { setFormTarget(null); await load(); }} />}
    {deleteTarget && <DeleteEmployeeModal repo={repo} staff={staff} employee={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={async () => { setDeleteTarget(null); await load(); }} />}
  </section>;
}

function EmployeeFormModal({ repo, staff, language, initial, onClose, onSaved }: { repo: PosRepository; staff: Staff; language: Language; initial?: Staff; onClose: () => void; onSaved: () => Promise<void> }) {
  const [code, setCode] = useState(initial?.code || "");
  const [name, setName] = useState(initial?.displayName || "");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<Staff["role"]>(initial?.role || "staff");
  const [active, setActive] = useState(initial?.active !== false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (!code.trim() || !name.trim()) { setError("กรอกรหัสพนักงานและชื่อพนักงาน"); return; }
    setBusy(true);
    setError("");
    try {
      await repo.saveEmployee({ id: initial?.id, code, displayName: name, role, active, demoPin: pin || undefined }, staff);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error && err.message === "EMPLOYEE_CODE_EXISTS" ? "รหัสพนักงานนี้ถูกใช้แล้ว" : "บันทึกพนักงานไม่สำเร็จ");
      setBusy(false);
    }
  };
  return <Modal title={initial ? "แก้ไขพนักงาน" : "เพิ่มพนักงาน"} onClose={busy ? () => {} : onClose}>
    <div className="employee-form-grid"><label>{t(language, "employeeCode")}<input value={code} onChange={e => setCode(e.target.value)} autoFocus /></label><label>Name<input value={name} onChange={e => setName(e.target.value)} /></label><label>Demo PIN<input value={pin} onChange={e => setPin(e.target.value)} placeholder={initial ? "เว้นว่างเพื่อใช้ PIN เดิม" : "Demo PIN"} /></label><label>{t(language, "role")}<select value={role} onChange={e => setRole(e.target.value as Staff["role"])}><option value="staff">staff</option><option value="manager">manager</option><option value="owner">owner</option></select></label><label>{t(language, "status")}<select value={active ? "1" : "0"} onChange={e => setActive(e.target.value === "1")}><option value="1">{t(language, "active")}</option><option value="0">{t(language, "inactive")}</option></select></label></div>
    {error && <ErrorMessage text={error} />}
    <div className="actions modal-footer"><button disabled={busy} onClick={() => void submit()}>{busy ? t(language, "submitBusy") : t(language, "save")}</button><button className="secondary" disabled={busy} onClick={onClose}>{t(language, "back")}</button></div>
  </Modal>;
}

function DeleteEmployeeModal({ repo, staff, employee, onClose, onDeleted }: { repo: PosRepository; staff: Staff; employee: Staff; onClose: () => void; onDeleted: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await repo.deleteEmployee(employee.id, staff);
      await onDeleted();
    } catch {
      setError("ลบพนักงานไม่สำเร็จ");
      setBusy(false);
    }
  };
  return <Modal title="ลบพนักงาน" onClose={busy ? () => {} : onClose}>
    <div className="employee-delete-card"><strong>{employee.displayName}</strong><span>{employee.code} · {employee.role}</span><p>ระบบจะปิดใช้งานพนักงานนี้เพื่อรักษาประวัติรายการขายและ audit เดิม</p></div>
    {error && <ErrorMessage text={error} />}
    <div className="actions modal-footer"><button className="danger" disabled={busy} onClick={() => void confirm()}>{busy ? "กำลังลบ..." : "ยืนยันลบ"}</button><button className="secondary" disabled={busy} onClick={onClose}>กลับ</button></div>
  </Modal>;
}

type SettingsSection = "store" | "branch" | "license" | "language" | "owner" | "receipt" | "printer" | "scanner" | "storage" | "backup" | "remote" | "about";
type SettingsNavItem = { id: SettingsSection; label: string; description: string; meta: string; tone: string };

function SettingsScreen({ repo, staff, settings, language, refreshSettings }: { repo: PosRepository; staff: Staff; settings: AppSettings; language: Language; refreshSettings: () => Promise<void> }) {
  const [form, setForm] = useState(settings);
  const [openSection, setOpenSection] = useState<SettingsSection | null>(null);
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [logoError, setLogoError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(settings); void repo.getStorageHealth().then(setHealth); }, [settings]);
  const set = (key: keyof AppSettings, value: string | boolean) => setForm(f => ({ ...f, [key]: value }));
  const nav: SettingsNavItem[] = [
    { id: "store", label: t(language, "storeInfo"), description: "ชื่อร้าน โลโก้ ที่อยู่ และเลขผู้เสียภาษี", meta: form.storeName || "ยังไม่ระบุชื่อร้าน", tone: "blue" },
    { id: "branch", label: t(language, "branchDevice"), description: "ชื่อสาขา เครื่องขาย และรหัสอุปกรณ์", meta: form.deviceName || form.deviceId, tone: "cyan" },
    { id: "license", label: "ลายเส้นโปรแกรม", description: "License และการผูกเครื่องกับ CpIPOS-IT", meta: licenseStatusText(form.programLicenseStatus), tone: "rose" },
    { id: "language", label: t(language, "language"), description: "ภาษาแสดงผลของหน้าจอ POS", meta: form.language === "th" ? t(language, "thai") : t(language, "english"), tone: "green" },
    { id: "owner", label: t(language, "owner"), description: "ข้อมูลเจ้าของร้านและบันทึก PIN เดโม", meta: form.ownerName || "Owner", tone: "violet" },
    { id: "receipt", label: t(language, "receiptSettings"), description: "ข้อความหัวท้ายใบเสร็จและข้อมูลร้านบนใบเสร็จ", meta: form.receiptHeader || "CpIPOS", tone: "amber" },
    { id: "printer", label: t(language, "printer"), description: "เครื่องพิมพ์ใบเสร็จและขนาดกระดาษ", meta: form.printerName || "ยังไม่ได้เลือกเครื่องพิมพ์", tone: "slate" },
    { id: "scanner", label: t(language, "scanner"), description: "โหมดรับค่าจากเครื่องอ่านบาร์โค้ด", meta: form.scannerMode, tone: "teal" },
    { id: "storage", label: t(language, "storage"), description: "พื้นที่จัดเก็บ ฐานข้อมูล ยอดขาย และ audit", meta: health ? health.salesCount.toLocaleString("th-TH") + " sales" : "กำลังตรวจสอบ", tone: "indigo" },
    { id: "backup", label: t(language, "backupRestore"), description: "สำรองและกู้คืนข้อมูลเครื่องขาย", meta: t(language, "notReady"), tone: "orange" },
    { id: "remote", label: t(language, "remoteManagement"), description: "การจัดการระยะไกลและสถานะการเชื่อมต่อ", meta: t(language, "notReady"), tone: "pink" },
    { id: "about", label: t(language, "versionAbout"), description: "เวอร์ชันแอปและข้อมูลระบบ", meta: "CpIPOS Desktop 0.1.0", tone: "gray" },
  ];
  const selected = nav.find(item => item.id === openSection) || null;
  const open = (id: SettingsSection) => { setForm(settings); setLogoError(""); setSaveError(""); setOpenSection(id); if (id === "storage") void repo.getStorageHealth().then(setHealth); };
  const close = () => { if (busy) return; setForm(settings); setLogoError(""); setSaveError(""); setOpenSection(null); };
  const save = async () => {
    setBusy(true);
    setSaveError("");
    try {
      await repo.updateSettings(form, staff);
      await refreshSettings();
      setOpenSection(null);
    } catch {
      setSaveError("บันทึกการตั้งค่าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return <section className="panel settings-page">
    <div className="settings-page-head"><div><span className="settings-kicker">CpIPOS Settings</span><h1>{t(language, "settings")}</h1><p>เลือกหมวดที่ต้องการตั้งค่า ระบบจะแสดงฟอร์มเป็น POP UP เพื่อแก้ไขทีละส่วน</p></div></div>
    <div className="settings-menu-grid">{nav.map(item => <button key={item.id} className={"settings-menu-card " + item.tone} onClick={() => open(item.id)}>
      <span className="settings-menu-icon"><SettingsIcon section={item.id} /></span>
      <span className="settings-menu-copy"><strong>{item.label}</strong><small>{item.description}</small><em>{item.meta}</em></span>
      <span className="settings-menu-arrow">›</span>
    </button>)}</div>
    {selected && <SettingsModal item={selected} section={selected.id} form={form} health={health} language={language} logoError={logoError} saveError={saveError} busy={busy} set={set} setLogoError={setLogoError} onSave={save} onClose={close} />}
  </section>;
}

function SettingsModal({ item, section, form, health, language, logoError, saveError, busy, set, setLogoError, onSave, onClose }: { item: SettingsNavItem; section: SettingsSection; form: AppSettings; health: StorageHealth | null; language: Language; logoError: string; saveError: string; busy: boolean; set: (key: keyof AppSettings, value: string | boolean) => void; setLogoError: (value: string) => void; onSave: () => Promise<void>; onClose: () => void }) {
  const editable = !["storage", "backup", "remote", "about"].includes(section);
  return <Modal title={item.label} onClose={busy ? () => {} : onClose}>
    <div className={"settings-modal-body " + item.tone}>
      <div className="settings-modal-intro"><span className="settings-menu-icon"><SettingsIcon section={section} /></span><div><strong>{item.description}</strong><small>{item.meta}</small></div></div>
      {section === "language" && <label>{t(language, "language")}<select value={form.language} onChange={e => set("language", e.target.value as Language)}><option value="th">{t(language, "thai")}</option><option value="en">{t(language, "english")}</option></select></label>}
      {section === "store" && <div className="settings-form-grid"><label>ชื่อร้าน<input value={form.storeName} onChange={e => set("storeName", e.target.value)} /></label><label>สาขา<input value={form.branchName} onChange={e => set("branchName", e.target.value)} /></label><label>ที่อยู่<textarea value={form.address} onChange={e => set("address", e.target.value)} /></label><label>เบอร์โทรศัพท์<input value={form.phone} onChange={e => set("phone", e.target.value)} /></label><label>เลขผู้เสียภาษี<input value={form.taxId} onChange={e => set("taxId", e.target.value)} /></label><div className="settings-logo-preview"><img src={form.storeLogoPath || SYSTEM_LOGO} alt="โลโก้ใบเสร็จ" onError={e => { e.currentTarget.src = SYSTEM_LOGO; }} /><div><strong>โลโก้ใบเสร็จ</strong><small>{form.storeLogoPath ? "ใช้โลโก้ร้านจากการตั้งค่า" : "ยังไม่ใส่โลโก้ร้าน จะแสดงโลโก้ระบบ CpIPOS"}</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { setLogoError(""); set("storeLogoPath", await readFileAsDataUrl(file)); } catch { setLogoError("อ่านไฟล์โลโก้ไม่สำเร็จ"); } }} /><button type="button" className="secondary" onClick={() => set("storeLogoPath", "")}>ใช้โลโก้ระบบ</button></div>{logoError && <ErrorMessage text={logoError} />}</div></div>}
      {section === "branch" && <div className="settings-form-grid"><label>ชื่อสาขา<input value={form.branchName} onChange={e => set("branchName", e.target.value)} /></label><label>Device<input value={form.deviceName} onChange={e => set("deviceName", e.target.value)} /></label><label>Device ID<input value={form.deviceId} onChange={e => set("deviceId", e.target.value)} /></label></div>}
      {section === "license" && <LicenseSettingsPanel form={form} set={set} />}
      {section === "owner" && <div className="settings-form-grid"><label>ชื่อเจ้าของร้าน<input value={form.ownerName} onChange={e => set("ownerName", e.target.value)} /></label><label>บันทึก PIN เดโม<input value={form.ownerPinNote} onChange={e => set("ownerPinNote", e.target.value)} /></label><p className="warning settings-wide">{t(language, "demoPin")}</p></div>}
      {section === "receipt" && <div className="settings-form-grid"><label>ชื่อหัวใบเสร็จ<input value={form.receiptHeader} onChange={e => set("receiptHeader", e.target.value)} /></label><label>ข้อความท้ายใบเสร็จ<input value={form.receiptFooter} onChange={e => set("receiptFooter", e.target.value)} /></label><label>ที่อยู่บนใบเสร็จ<textarea value={form.address} onChange={e => set("address", e.target.value)} /></label><label>เบอร์โทรบนใบเสร็จ<input value={form.phone} onChange={e => set("phone", e.target.value)} /></label><label>เลขผู้เสียภาษี<input value={form.taxId} onChange={e => set("taxId", e.target.value)} /></label></div>}
      {section === "printer" && <div className="printer-setup-card"><strong>ตั้งค่าเครื่องพิมพ์ใบเสร็จ 80mm</strong><p className="warning">โหมดนี้ใช้ Windows Print Dialog เพื่อเลือกเครื่องพิมพ์จริงที่ติดตั้งใน Windows แล้ว เช่น thermal printer 80mm. ตั้งค่าครั้งแรกแล้ว Windows จะจำค่าเครื่องพิมพ์ตามระบบ</p><div className="settings-form-grid"><label>ชื่อเครื่องพิมพ์<input placeholder="เช่น XP-80C / POS-80 / Rongta 80mm" value={form.printerName} onChange={e => set("printerName", e.target.value)} /></label><label>ชนิดการพิมพ์<select value={form.printerType} onChange={e => set("printerType", e.target.value)}><option value="windows-print-dialog">Windows Print Dialog</option><option value="not-configured">ยังไม่ได้ตั้งค่า</option></select></label><label>ขนาดกระดาษ<select value={form.printerPaperWidthMm} onChange={e => set("printerPaperWidthMm", e.target.value)}><option value="80">80mm</option><option value="58">58mm</option></select></label><label>หมายเหตุการเชื่อมต่อ<input value={form.printerConnectionNote} onChange={e => set("printerConnectionNote", e.target.value)} /></label></div><p>เมื่อกดปุ่ม <strong>พิมพ์ใบเสร็จ 80mm</strong> ระบบจะเปิดหน้าต่างพิมพ์ของ Windows ให้เลือกเครื่องพิมพ์จริง</p></div>}
      {section === "scanner" && <div className="settings-form-grid"><label>โหมดเครื่องอ่านบาร์โค้ด<select value={form.scannerMode} onChange={e => set("scannerMode", e.target.value)}><option value="keyboard-wedge">Keyboard wedge / กด Enter หลังสแกน</option><option value="manual">Manual input / พิมพ์เอง</option></select></label><p className="warning settings-wide">เครื่องอ่านบาร์โค้ดทั่วไปควรใช้โหมด keyboard-wedge เพื่อส่งค่าเข้าช่องค้นหาเหมือนแป้นพิมพ์</p></div>}
      {section === "storage" && <StoragePanel health={health} />}
      {section === "backup" && <p className="warning">{t(language, "notReady")} - ฟังก์ชันสำรองและกู้คืนจะเปิดใช้เมื่อระบบ backup local storage เสร็จสมบูรณ์</p>}
      {section === "remote" && <div className="settings-form-grid"><label className="inline-check settings-wide"><input type="checkbox" checked={form.remoteManagementEnabled} disabled readOnly /> เปิด Remote Management</label><p className="warning settings-wide">{t(language, "notReady")} - ยังไม่เปิดการจัดการระยะไกลในรุ่นนี้</p></div>}
      {section === "about" && <div className="metric-grid"><Metric label="App" value="CpIPOS Desktop" /><Metric label="Version" value="0.1.0" /><Metric label="Mode" value="Offline POS" /></div>}
      {editable && <p className="warning">{t(language, "recordOnly")}</p>}
      {saveError && <ErrorMessage text={saveError} />}
      <div className="actions modal-footer">{editable && <button disabled={busy} onClick={() => void onSave()}>{busy ? t(language, "submitBusy") : t(language, "save")}</button>}<button className="secondary" disabled={busy} onClick={onClose}>{t(language, "back")}</button></div>
    </div>
  </Modal>;
}


function LicenseSettingsPanel({ form, set }: { form: AppSettings; set: (key: keyof AppSettings, value: string | boolean) => void }) {
  const fingerprint = form.programLicenseDeviceFingerprint || licenseDeviceFingerprint(form);
  const markPending = () => {
    set("programLicenseStatus", form.programLicenseKey.trim() ? "pending_activation" : "not_configured");
    set("programLicenseDeviceFingerprint", fingerprint);
    set("programLicenseLastCheckedAt", new Date().toISOString());
  };
  return <div className="license-settings">
    <div className="license-status-panel">
      <div><span>สถานะลายเส้น</span><strong>{licenseStatusText(form.programLicenseStatus)}</strong><small>ต้องตรวจจริงจาก CpIPOS-IT ก่อนปลดล็อกสิทธิ์การใช้งาน</small></div>
      <div><span>รหัสเครื่อง</span><strong className="license-device-code">{fingerprint}</strong><small>ใช้ผูก license กับ Windows เครื่องนี้</small></div>
    </div>
    <div className="settings-form-grid">
      <label className="settings-wide">License Key<input value={form.programLicenseKey} onChange={e => set("programLicenseKey", e.target.value.trim())} placeholder="เช่น CPIPOS-XXXX-XXXX-XXXX" /></label>
      <label>CpIPOS-IT API URL<input value={form.programLicenseBackendUrl} onChange={e => set("programLicenseBackendUrl", e.target.value.trim())} placeholder="https://cpipos-it.vercel.app" /></label>
      <label>จำนวนเครื่องที่อนุญาต<input value={form.programLicenseDeviceLimit} onChange={e => set("programLicenseDeviceLimit", e.target.value.replace(/[^0-9]/g, ""))} placeholder="1" /></label>
      <label>แพ็กเกจ / แผนใช้งาน<input value={form.programLicensePlan} onChange={e => set("programLicensePlan", e.target.value)} placeholder="เช่น Standard / Pro" /></label>
      <label>หมดอายุ<input value={form.programLicenseExpiresAt} onChange={e => set("programLicenseExpiresAt", e.target.value)} placeholder="YYYY-MM-DD" /></label>
      <label className="settings-wide">Signed License Token<textarea value={form.programLicenseToken} onChange={e => set("programLicenseToken", e.target.value.trim())} placeholder="token ที่ CpIPOS-IT เซ็นกลับมาในเฟสเชื่อมต่อจริง" /></label>
    </div>
    <div className="license-security-list">
      <strong>แนวทางป้องกันการปลอม license</strong>
      <span>Desktop ต้องตรวจ token ด้วย public key เท่านั้น และห้ามฝัง private key ในโปรแกรม</span>
      <span>Backend ต้องเป็นผู้คุมจำนวนเครื่อง เปิด/ปิด license และการ revoke</span>
      <span>ถ้า copy token ไปเครื่องอื่น ระบบต้องเทียบรหัสเครื่องแล้วไม่ผ่าน</span>
    </div>
    <button type="button" className="secondary license-prepare-button" onClick={markPending}>เตรียมเปิดใช้งานกับ CpIPOS-IT</button>
  </div>;
}

function SettingsIcon({ section }: { section: SettingsSection }) {
  switch (section) {
    case "store": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5"/><path d="M6 10v9h12v-9"/><path d="M9 19v-5h6v5"/></svg>;
    case "branch": return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M9 20h6"/><path d="M12 16v4"/></svg>;
    case "license": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-2.9 8.5-7 10-4.1-1.5-7-5.5-7-10V6z"/><path d="M9 12h6"/><path d="M12 9v6"/></svg>;
    case "language": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h10"/><path d="M9 5v14"/><path d="M5 19c3-3 5-7 6-14"/><path d="M12 12c-1.5-1-3-3-4-5"/><path d="m15 19 3-8 3 8"/><path d="M16 16h4"/></svg>;
    case "owner": return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 20c1.5-4 12.5-4 14 0"/></svg>;
    case "receipt": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2z"/><path d="M9 9h6"/><path d="M9 13h6"/></svg>;
    case "printer": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V4h10v4"/><rect x="5" y="8" width="14" height="8" rx="2"/><path d="M8 14h8v6H8z"/></svg>;
    case "scanner": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7V5h4"/><path d="M15 5h4v2"/><path d="M19 17v2h-4"/><path d="M9 19H5v-2"/><path d="M7 12h10"/><path d="M9 9v6"/><path d="M12 9v6"/><path d="M15 9v6"/></svg>;
    case "storage": return <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>;
    case "backup": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7a7 7 0 1 1-1 9"/><path d="M7 7H3V3"/><path d="M12 8v5l3 2"/></svg>;
    case "remote": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a12 12 0 0 1 16 0"/><path d="M7 12a7.5 7.5 0 0 1 10 0"/><path d="M10 15a3 3 0 0 1 4 0"/><circle cx="12" cy="18" r="1"/></svg>;
    case "about": return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>;
  }
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
