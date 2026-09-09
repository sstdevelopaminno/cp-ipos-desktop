import Database from "@tauri-apps/plugin-sql";

type GenericRecord = Record<string, unknown>;
type ArchiveMode = "sqlite" | "browser-preview";
type CommercialConfig = {
  backup: {
    apiUrl: string;
    tenantId: string;
    storeId: string;
    apiKey: string;
    packageName: string;
    syncMode: "local" | "cloud" | "dual";
    onlineContract: boolean;
    contractStart: string;
    contractEnd: string;
    lastTestAt: string;
    lastStatus: string;
  };
  remote: {
    enabled: boolean;
    mdmUrl: string;
    deviceToken: string;
    itBackendUrl: string;
    heartbeatSeconds: string;
    autoConnect: boolean;
    lastSeenAt: string;
    lastStatus: string;
  };
  license: {
    key: string;
    serverUrl: string;
    packageName: string;
    duration: "monthly" | "yearly" | "lifetime";
    status: "trial" | "pending_activation" | "active" | "expired" | "revoked";
    token: string;
    deviceFingerprint: string;
    activatedAt: string;
    expiresAt: string;
    trialStartedAt: string;
    lastCheckedAt: string;
  };
};

type DataArchive = {
  app: "CpIPOS Desktop";
  version: "0.2.0";
  exportedAt: string;
  mode: ArchiveMode;
  tables: Record<string, GenericRecord[]>;
  localStorage?: Record<string, string>;
  commercialConfig: CommercialConfig;
};

const CONFIG_KEY = "cpipos.commercial.settings.v1";
const TRIAL_KEY = "cpipos.license.trial.startedAt";
const DAY_MS = 24 * 60 * 60 * 1000;
const DATA_TABLES = ["sales", "sale_items", "receipts", "sale_cancellations", "audit_events", "stock_movement_ledger", "products", "staff", "shifts", "app_settings"];
const PURGE_TABLES = ["sale_items", "receipts", "sale_cancellations", "sales"];

const nowIso = () => new Date().toISOString();
const fileStamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const textOf = (element: Element | null) => (element?.textContent || "").trim();

const defaultConfig = (): CommercialConfig => {
  const trialStartedAt = localStorage.getItem(TRIAL_KEY) || nowIso();
  return {
    backup: {
      apiUrl: "",
      tenantId: "",
      storeId: "",
      apiKey: "",
      packageName: "Offline",
      syncMode: "local",
      onlineContract: false,
      contractStart: "",
      contractEnd: "",
      lastTestAt: "",
      lastStatus: "ยังไม่ทดสอบ",
    },
    remote: {
      enabled: false,
      mdmUrl: "",
      deviceToken: "",
      itBackendUrl: "",
      heartbeatSeconds: "60",
      autoConnect: true,
      lastSeenAt: "",
      lastStatus: "ยังไม่เชื่อมต่อ",
    },
    license: {
      key: "",
      serverUrl: "",
      packageName: "Trial",
      duration: "monthly",
      status: "trial",
      token: "",
      deviceFingerprint: "",
      activatedAt: "",
      expiresAt: "",
      trialStartedAt,
      lastCheckedAt: "",
    },
  };
};

const readConfig = (): CommercialConfig => {
  const base = defaultConfig();
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<CommercialConfig>;
    return {
      backup: { ...base.backup, ...(saved.backup || {}) },
      remote: { ...base.remote, ...(saved.remote || {}) },
      license: { ...base.license, ...(saved.license || {}) },
    };
  } catch {
    return base;
  }
};

const writeConfig = (config: CommercialConfig) => localStorage.setItem(CONFIG_KEY, JSON.stringify(config));

const ensureTrial = () => {
  if (!localStorage.getItem(TRIAL_KEY)) localStorage.setItem(TRIAL_KEY, nowIso());
  const config = readConfig();
  if (!config.license.trialStartedAt) {
    config.license.trialStartedAt = localStorage.getItem(TRIAL_KEY) || nowIso();
    writeConfig(config);
  }
};

const trialDaysLeft = (config = readConfig()) => {
  const started = Date.parse(config.license.trialStartedAt || localStorage.getItem(TRIAL_KEY) || nowIso());
  if (!Number.isFinite(started)) return 30;
  const used = Math.floor((Date.now() - started) / DAY_MS);
  return Math.max(0, 30 - used);
};

const isLicenseActive = (config = readConfig()) => {
  if (config.license.status !== "active") return false;
  if (config.license.duration === "lifetime") return true;
  if (!config.license.expiresAt) return false;
  return Date.parse(config.license.expiresAt) >= Date.now();
};

const getDeviceFingerprint = () => {
  const key = "cpipos.commercial.deviceFingerprint";
  const saved = localStorage.getItem(key);
  if (saved) return saved;
  const base = `${navigator.userAgent}|${screen.width}x${screen.height}|${crypto.randomUUID()}`;
  let hash = 2166136261;
  for (let i = 0; i < base.length; i += 1) {
    hash ^= base.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const code = `CP-${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  localStorage.setItem(key, code);
  return code;
};

const safeTableSelect = async (db: Database, table: string) => {
  try {
    return await db.select<GenericRecord[]>(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT 5000`);
  } catch {
    return [];
  }
};

const collectSqliteArchive = async (): Promise<DataArchive> => {
  const db = await Database.load("sqlite:cpipos.db");
  const tables: Record<string, GenericRecord[]> = {};
  for (const table of DATA_TABLES) tables[table] = await safeTableSelect(db, table);
  return { app: "CpIPOS Desktop", version: "0.2.0", exportedAt: nowIso(), mode: "sqlite", tables, commercialConfig: readConfig() };
};

const collectBrowserArchive = (): DataArchive => {
  const keys = Object.keys(localStorage).filter(key => key.startsWith("cpipos."));
  const localStorageDump = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key) || ""]));
  const parse = (key: string) => {
    try { return JSON.parse(localStorage.getItem(key) || "[]") as GenericRecord[]; } catch { return []; }
  };
  return {
    app: "CpIPOS Desktop",
    version: "0.2.0",
    exportedAt: nowIso(),
    mode: "browser-preview",
    tables: {
      sales: parse("cpipos.desktop.demo.sales"),
      sale_items: [],
      receipts: [],
      sale_cancellations: [],
      audit_events: parse("cpipos.desktop.demo.audit"),
      stock_movement_ledger: parse("cpipos.desktop.demo.stock"),
      products: parse("cpipos.desktop.demo.products"),
      staff: parse("cpipos.desktop.demo.staff"),
      shifts: localStorage.getItem("cpipos.desktop.demo.shift") ? [JSON.parse(localStorage.getItem("cpipos.desktop.demo.shift") || "{}") as GenericRecord] : [],
      app_settings: localStorage.getItem("cpipos.desktop.demo.settings") ? [JSON.parse(localStorage.getItem("cpipos.desktop.demo.settings") || "{}") as GenericRecord] : [],
    },
    localStorage: localStorageDump,
    commercialConfig: readConfig(),
  };
};

const collectArchive = async (): Promise<DataArchive> => {
  try {
    return await collectSqliteArchive();
  } catch {
    return collectBrowserArchive();
  }
};

const downloadBlob = (body: string, fileName: string, type: string) => {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const cell = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;");

const tableToHtml = (tableName: string, rows: GenericRecord[]) => {
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
  if (!headers.length) return `<h2>${cell(tableName)}</h2><p>ไม่มีข้อมูล</p>`;
  return `<h2>${cell(tableName)}</h2><table><thead><tr>${headers.map(h => `<th>${cell(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map(h => `<td>${cell(row[h])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
};

const archiveToExcelHtml = (archive: DataArchive) => `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif}h1{font-size:22px}h2{margin-top:24px;color:#0f4c81}table{border-collapse:collapse;margin-bottom:24px;width:100%}th,td{border:1px solid #cbd5e1;padding:6px;font-size:12px;vertical-align:top}th{background:#e0f2fe}</style></head><body><h1>CpIPOS Data Archive</h1><p>Exported: ${cell(archive.exportedAt)} · Mode: ${cell(archive.mode)}</p>${Object.entries(archive.tables).map(([name, rows]) => tableToHtml(name, rows)).join("")}</body></html>`;

const archiveToReportHtml = (archive: DataArchive) => {
  const sales = archive.tables.sales || [];
  const saleCount = sales.length;
  const total = sales.reduce((sum, row) => sum + Number(row.total || 0), 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>CpIPOS Report</title><style>body{font-family:Arial,'Noto Sans Thai',sans-serif;margin:32px;color:#0f172a}.hero{border-bottom:3px solid #2563eb;margin-bottom:20px;padding-bottom:12px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metric{border:1px solid #dbeafe;border-radius:12px;padding:12px;background:#eff6ff}.metric span{font-size:12px;color:#64748b}.metric strong{display:block;font-size:22px}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #cbd5e1;padding:8px;font-size:12px}th{background:#dbeafe}</style></head><body><div class="hero"><h1>CpIPOS รายงานก่อนล้างข้อมูล</h1><p>บันทึกเมื่อ ${cell(archive.exportedAt)} · โหมด ${cell(archive.mode)}</p></div><div class="grid"><div class="metric"><span>จำนวนบิล</span><strong>${saleCount.toLocaleString("th-TH")}</strong></div><div class="metric"><span>ยอดขายรวม</span><strong>${total.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</strong></div><div class="metric"><span>Audit</span><strong>${(archive.tables.audit_events || []).length.toLocaleString("th-TH")}</strong></div><div class="metric"><span>สินค้า</span><strong>${(archive.tables.products || []).length.toLocaleString("th-TH")}</strong></div></div>${tableToHtml("sales", sales.slice(0, 300))}</body></html>`;
};

const exportArchive = async (kind: "excel" | "pdf" | "json") => {
  const archive = await collectArchive();
  if (kind === "excel") downloadBlob(archiveToExcelHtml(archive), `cpipos-data-${fileStamp()}.xls`, "application/vnd.ms-excel;charset=utf-8");
  if (kind === "json") downloadBlob(JSON.stringify(archive, null, 2), `cpipos-data-${fileStamp()}.json`, "application/json;charset=utf-8");
  if (kind === "pdf") {
    const win = window.open("", "_blank", "width=1100,height=800");
    if (!win) return;
    win.document.write(archiveToReportHtml(archive));
    win.document.close();
    window.setTimeout(() => { win.focus(); win.print(); }, 500);
  }
};

const purgeSqliteSales = async () => {
  const db = await Database.load("sqlite:cpipos.db");
  for (const table of PURGE_TABLES) {
    try { await db.execute(`DELETE FROM ${table}`); } catch { /* ignore missing tables from older migrations */ }
  }
  try {
    await db.execute("INSERT INTO audit_events(id,timestamp,action,entity_type,entity_id,status,details_json) VALUES($1,$2,'DATA_ARCHIVED_AND_RESET','storage','local','completed',$3)", [crypto.randomUUID(), nowIso(), JSON.stringify({ resetAt: nowIso(), tables: PURGE_TABLES })]);
  } catch {
    // Older preview schemas may not have audit_events yet.
  }
};

const purgeBrowserSales = () => {
  localStorage.removeItem("cpipos.desktop.demo.sales");
  localStorage.removeItem("cpipos.desktop.demo.items");
  const auditKey = "cpipos.desktop.demo.audit";
  let rows: GenericRecord[] = [];
  try { rows = JSON.parse(localStorage.getItem(auditKey) || "[]") as GenericRecord[]; } catch { rows = []; }
  rows.unshift({ id: crypto.randomUUID(), timestamp: nowIso(), action: "DATA_ARCHIVED_AND_RESET", entityType: "storage", status: "completed" });
  localStorage.setItem(auditKey, JSON.stringify(rows));
};

const archiveAndReset = async (status: HTMLElement | null) => {
  const confirm = window.prompt("พิมพ์ RESET เพื่อยืนยันการบันทึกและล้างรายการขายรอบเก่า");
  if (confirm !== "RESET") return;
  status && (status.textContent = "กำลังบันทึกไฟล์สำรอง...");
  const archive = await collectArchive();
  downloadBlob(archiveToExcelHtml(archive), `cpipos-before-reset-${fileStamp()}.xls`, "application/vnd.ms-excel;charset=utf-8");
  downloadBlob(JSON.stringify(archive, null, 2), `cpipos-before-reset-${fileStamp()}.json`, "application/json;charset=utf-8");
  status && (status.textContent = "กำลังล้างรายการขายรอบเก่า...");
  try { await purgeSqliteSales(); }
  catch { purgeBrowserSales(); }
  status && (status.textContent = "บันทึกและล้างข้อมูลเรียบร้อย เริ่มนับรายการขายใหม่แล้ว");
};

const bind = (host: HTMLElement, selector: string, handler: (event: Event) => void) => host.querySelector(selector)?.addEventListener("click", handler);
const inputValue = (host: HTMLElement, name: string) => (host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-field="${name}"]`)?.value || "").trim();
const checkedValue = (host: HTMLElement, name: string) => Boolean(host.querySelector<HTMLInputElement>(`[data-field="${name}"]`)?.checked);
const setStatus = (host: HTMLElement, message: string) => { const node = host.querySelector<HTMLElement>("[data-status]"); if (node) node.textContent = message; };

const renderStorage = (host: HTMLElement) => {
  const config = readConfig();
  host.innerHTML = `<div class="commercial-card commercial-storage"><div><span class="commercial-kicker">Data lifecycle</span><h3>ข้อมูลและพื้นที่</h3><p>ใช้สำหรับบันทึกรายการขาย รายงาน และไฟล์สำรองก่อนเริ่มรอบข้อมูลใหม่ เมื่อกดยืนยัน RESET ระบบจะเก็บไฟล์ก่อนแล้วล้างเฉพาะรายการขายรอบเก่า</p></div><div class="commercial-button-grid"><button data-action="excel">บันทึกเป็น Excel</button><button data-action="pdf">บันทึกเป็น PDF</button><button data-action="json">Backup JSON</button><button class="danger" data-action="reset">บันทึกแล้วล้างข้อมูล</button></div><div class="commercial-summary"><span>Cloud package: ${cell(config.backup.packageName)}</span><span>Sync mode: ${cell(config.backup.syncMode)}</span><span data-status>พร้อมทำงาน</span></div></div>`;
  const status = host.querySelector<HTMLElement>("[data-status]");
  bind(host, "[data-action='excel']", () => void exportArchive("excel"));
  bind(host, "[data-action='pdf']", () => void exportArchive("pdf"));
  bind(host, "[data-action='json']", () => void exportArchive("json"));
  bind(host, "[data-action='reset']", () => void archiveAndReset(status));
};

const renderBackup = (host: HTMLElement) => {
  const config = readConfig();
  host.innerHTML = `<div class="commercial-card"><span class="commercial-kicker">Backup / Restore</span><h3>เชื่อมต่อฐานข้อมูลภายนอกผ่าน Cloud API</h3><p>กำหนด API ของตารางข้อมูลบนคลาวด์ เพื่อเปลี่ยนจากโหมดออฟไลน์เป็นโหมดซิงก์หรือบันทึกสลับไปฐานข้อมูลภายนอกเมื่อมีสัญญาเน็ต</p><div class="commercial-form-grid"><label>Cloud API URL<input data-field="apiUrl" value="${cell(config.backup.apiUrl)}" placeholder="https://api.company.com/cpipos" /></label><label>Tenant ID<input data-field="tenantId" value="${cell(config.backup.tenantId)}" placeholder="cutting-point" /></label><label>Store / Branch ID<input data-field="storeId" value="${cell(config.backup.storeId)}" placeholder="store-main-01" /></label><label>API Key<input data-field="apiKey" value="${cell(config.backup.apiKey)}" type="password" placeholder="เก็บจริงใน backend/secret store" /></label><label>แพ็กเกจ<select data-field="packageName"><option${config.backup.packageName === "Offline" ? " selected" : ""}>Offline</option><option${config.backup.packageName === "Cloud Basic" ? " selected" : ""}>Cloud Basic</option><option${config.backup.packageName === "Cloud Pro" ? " selected" : ""}>Cloud Pro</option><option${config.backup.packageName === "Enterprise" ? " selected" : ""}>Enterprise</option></select></label><label>โหมด Sync<select data-field="syncMode"><option value="local"${config.backup.syncMode === "local" ? " selected" : ""}>Local only</option><option value="dual"${config.backup.syncMode === "dual" ? " selected" : ""}>Local + Cloud queue</option><option value="cloud"${config.backup.syncMode === "cloud" ? " selected" : ""}>Cloud primary เมื่อออนไลน์</option></select></label><label>เริ่มสัญญา<input data-field="contractStart" value="${cell(config.backup.contractStart)}" type="date" /></label><label>หมดสัญญา<input data-field="contractEnd" value="${cell(config.backup.contractEnd)}" type="date" /></label><label class="inline-check commercial-wide"><input data-field="onlineContract" type="checkbox"${config.backup.onlineContract ? " checked" : ""}/> มีสัญญาเน็ตและอนุญาต sync ขึ้น cloud</label></div><div class="commercial-button-row"><button data-action="save">บันทึกค่าเชื่อมต่อ</button><button class="secondary" data-action="test">ทดสอบ API</button><button class="secondary" data-action="queue">เตรียมคิว sync</button></div><p class="commercial-status" data-status>${cell(config.backup.lastStatus)}</p></div>`;
  bind(host, "[data-action='save']", () => { const next = readConfig(); next.backup = { ...next.backup, apiUrl: inputValue(host, "apiUrl"), tenantId: inputValue(host, "tenantId"), storeId: inputValue(host, "storeId"), apiKey: inputValue(host, "apiKey"), packageName: inputValue(host, "packageName"), syncMode: inputValue(host, "syncMode") as CommercialConfig["backup"]["syncMode"], onlineContract: checkedValue(host, "onlineContract"), contractStart: inputValue(host, "contractStart"), contractEnd: inputValue(host, "contractEnd"), lastStatus: "บันทึกค่า Backup / Restore แล้ว", lastTestAt: nowIso() }; writeConfig(next); setStatus(host, next.backup.lastStatus); });
  bind(host, "[data-action='test']", () => void testCloudApi(host));
  bind(host, "[data-action='queue']", () => { setStatus(host, "เตรียมคิว Sync แล้ว เมื่อระบบออนไลน์และมีสัญญาเน็ตจะส่งข้อมูลตามโหมดที่เลือก"); });
};

const testCloudApi = async (host: HTMLElement) => {
  const url = inputValue(host, "apiUrl");
  const apiKey = inputValue(host, "apiKey");
  if (!url) { setStatus(host, "กรอก Cloud API URL ก่อน"); return; }
  setStatus(host, "กำลังทดสอบ Cloud API...");
  try {
    const res = await fetch(url, { method: "GET", headers: apiKey ? { "x-api-key": apiKey } : undefined });
    const next = readConfig();
    next.backup.lastTestAt = nowIso();
    next.backup.lastStatus = res.ok ? `เชื่อมต่อสำเร็จ HTTP ${res.status}` : `เชื่อมต่อได้แต่ API ตอบ HTTP ${res.status}`;
    writeConfig(next);
    setStatus(host, next.backup.lastStatus);
  } catch {
    const next = readConfig();
    next.backup.lastTestAt = nowIso();
    next.backup.lastStatus = "ยังเชื่อมต่อไม่ได้ ตรวจ URL, CORS, API key หรืออินเทอร์เน็ต";
    writeConfig(next);
    setStatus(host, next.backup.lastStatus);
  }
};

const renderRemote = (host: HTMLElement) => {
  const config = readConfig();
  host.innerHTML = `<div class="commercial-card"><span class="commercial-kicker">Remote Management / MDM</span><h3>เชื่อมต่อระบบหลังบ้าน IT เมื่อมีสัญญาเน็ต</h3><p>ตั้งค่า MDM Server, Device Token และ Heartbeat เพื่อให้เครื่อง POS กลับไปหา backend IT อัตโนมัติเมื่อออนไลน์</p><div class="commercial-form-grid"><label class="inline-check commercial-wide"><input data-field="enabled" type="checkbox"${config.remote.enabled ? " checked" : ""}/> เปิด Remote Management</label><label>MDM Server URL<input data-field="mdmUrl" value="${cell(config.remote.mdmUrl)}" placeholder="https://mdm.company.com" /></label><label>IT Backend URL<input data-field="itBackendUrl" value="${cell(config.remote.itBackendUrl)}" placeholder="https://it.company.com" /></label><label>Device Token<input data-field="deviceToken" value="${cell(config.remote.deviceToken)}" type="password" /></label><label>Heartbeat seconds<input data-field="heartbeatSeconds" value="${cell(config.remote.heartbeatSeconds)}" inputmode="numeric" /></label><label class="inline-check"><input data-field="autoConnect" type="checkbox"${config.remote.autoConnect ? " checked" : ""}/> เชื่อมต่ออัตโนมัติเมื่อออนไลน์</label></div><div class="commercial-button-row"><button data-action="save">บันทึก MDM</button><button class="secondary" data-action="ping">ทดสอบ Heartbeat</button></div><div class="commercial-summary"><span>Fingerprint: ${cell(getDeviceFingerprint())}</span><span>Last seen: ${cell(config.remote.lastSeenAt || "-")}</span><span data-status>${cell(config.remote.lastStatus)}</span></div></div>`;
  bind(host, "[data-action='save']", () => { const next = readConfig(); const heartbeat = Math.max(30, Number(inputValue(host, "heartbeatSeconds") || 60)); next.remote = { ...next.remote, enabled: checkedValue(host, "enabled"), mdmUrl: inputValue(host, "mdmUrl"), itBackendUrl: inputValue(host, "itBackendUrl"), deviceToken: inputValue(host, "deviceToken"), heartbeatSeconds: String(heartbeat), autoConnect: checkedValue(host, "autoConnect"), lastStatus: "บันทึกค่า Remote Management แล้ว" }; writeConfig(next); setStatus(host, next.remote.lastStatus); });
  bind(host, "[data-action='ping']", () => void pingMdm(host));
};

const pingMdm = async (host: HTMLElement) => {
  const mdmUrl = inputValue(host, "mdmUrl");
  const token = inputValue(host, "deviceToken");
  if (!mdmUrl) { setStatus(host, "กรอก MDM Server URL ก่อน"); return; }
  setStatus(host, "กำลังทดสอบ Heartbeat...");
  try {
    const response = await fetch(`${mdmUrl.replace(/\/$/, "")}/heartbeat`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ deviceFingerprint: getDeviceFingerprint(), app: "CpIPOS Desktop", version: "0.2.0", at: nowIso() }) });
    const next = readConfig();
    next.remote.lastSeenAt = nowIso();
    next.remote.lastStatus = response.ok ? `MDM heartbeat สำเร็จ HTTP ${response.status}` : `MDM ตอบกลับ HTTP ${response.status}`;
    writeConfig(next);
    setStatus(host, next.remote.lastStatus);
  } catch {
    const next = readConfig();
    next.remote.lastStatus = "ยังเชื่อมต่อ MDM ไม่ได้ ตรวจ URL, token, CORS หรืออินเทอร์เน็ต";
    writeConfig(next);
    setStatus(host, next.remote.lastStatus);
  }
};

const renderLicense = (host: HTMLElement) => {
  const config = readConfig();
  const days = trialDaysLeft(config);
  const fingerprint = config.license.deviceFingerprint || getDeviceFingerprint();
  host.innerHTML = `<div class="commercial-card commercial-license"><span class="commercial-kicker">Program License</span><h3>ลายเส้นโปรแกรมและสิทธิ์ติดตั้งต่อเครื่อง</h3><p>รอบแรกหากไม่มีลายเส้น ระบบใช้งานได้ 30 วัน หลังจากนั้นต้องเปิดอินเทอร์เน็ตเพื่อลงทะเบียน license กับระบบหลังบ้าน IT ก่อนใช้งานต่อ</p><div class="commercial-license-grid"><div><span>สถานะ</span><strong>${cell(isLicenseActive(config) ? "Active" : config.license.status)}</strong></div><div><span>Trial คงเหลือ</span><strong>${days} วัน</strong></div><div><span>Device Fingerprint</span><strong>${cell(fingerprint)}</strong></div></div><div class="commercial-form-grid"><label class="commercial-wide">License Key<input data-field="key" value="${cell(config.license.key)}" placeholder="CPIPOS-XXXX-XXXX-XXXX" /></label><label>License Server URL<input data-field="serverUrl" value="${cell(config.license.serverUrl)}" placeholder="https://it.company.com" /></label><label>แพ็กเกจ<input data-field="packageName" value="${cell(config.license.packageName)}" placeholder="Standard / Pro / Enterprise" /></label><label>อายุการใช้งาน<select data-field="duration"><option value="monthly"${config.license.duration === "monthly" ? " selected" : ""}>รายเดือน</option><option value="yearly"${config.license.duration === "yearly" ? " selected" : ""}>รายปี</option><option value="lifetime"${config.license.duration === "lifetime" ? " selected" : ""}>ตลอดชีพ</option></select></label><label>หมดอายุ<input data-field="expiresAt" value="${cell(config.license.expiresAt)}" type="date" /></label><label class="commercial-wide">Signed License Token<textarea data-field="token" placeholder="token ที่ backend เซ็นกลับมา">${cell(config.license.token)}</textarea></label></div><div class="commercial-button-row"><button data-action="save">บันทึกลายเส้น</button><button class="secondary" data-action="activate">เชื่อมต่อ/ตรวจสอบลายเส้น</button><button class="secondary" data-action="copy">คัดลอกรหัสเครื่อง</button></div><p class="commercial-status" data-status>สถานะล่าสุด: ${cell(config.license.lastCheckedAt || "ยังไม่ตรวจ")}</p></div>`;
  bind(host, "[data-action='save']", () => { const next = readConfig(); next.license = { ...next.license, key: inputValue(host, "key"), serverUrl: inputValue(host, "serverUrl"), packageName: inputValue(host, "packageName"), duration: inputValue(host, "duration") as CommercialConfig["license"]["duration"], expiresAt: inputValue(host, "expiresAt"), token: inputValue(host, "token"), deviceFingerprint: fingerprint, status: inputValue(host, "key") ? "pending_activation" : "trial", lastCheckedAt: nowIso() }; writeConfig(next); setStatus(host, "บันทึกลายเส้นแล้ว รอตรวจสอบกับระบบหลังบ้าน IT"); applyLicenseGuard(); });
  bind(host, "[data-action='activate']", () => void activateLicense(host));
  bind(host, "[data-action='copy']", () => { void navigator.clipboard?.writeText(fingerprint); setStatus(host, "คัดลอกรหัสเครื่องแล้ว"); });
};

const activateLicense = async (host: HTMLElement) => {
  const key = inputValue(host, "key");
  const serverUrl = inputValue(host, "serverUrl");
  if (!key || !serverUrl) { setStatus(host, "กรอก License Key และ License Server URL ก่อน"); return; }
  setStatus(host, "กำลังตรวจสอบลายเส้นกับ backend IT...");
  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/licenses/activate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ licenseKey: key, deviceFingerprint: getDeviceFingerprint(), app: "CpIPOS Desktop", version: "0.2.0", packageName: inputValue(host, "packageName"), duration: inputValue(host, "duration") }) });
    const data = await response.json().catch(() => ({} as GenericRecord));
    const next = readConfig();
    next.license.key = key;
    next.license.serverUrl = serverUrl;
    next.license.packageName = inputValue(host, "packageName") || next.license.packageName;
    next.license.duration = inputValue(host, "duration") as CommercialConfig["license"]["duration"];
    next.license.deviceFingerprint = getDeviceFingerprint();
    next.license.token = String(data.token || data.licenseToken || inputValue(host, "token") || "");
    next.license.expiresAt = String(data.expiresAt || inputValue(host, "expiresAt") || "");
    next.license.activatedAt = nowIso();
    next.license.lastCheckedAt = nowIso();
    next.license.status = response.ok ? "active" : "pending_activation";
    writeConfig(next);
    setStatus(host, response.ok ? "เปิดใช้งานลายเส้นสำเร็จ" : `backend ตอบ HTTP ${response.status} จึงบันทึกเป็นรอตรวจสอบ`);
    applyLicenseGuard();
  } catch {
    const next = readConfig();
    next.license.status = "pending_activation";
    next.license.lastCheckedAt = nowIso();
    next.license.deviceFingerprint = getDeviceFingerprint();
    writeConfig(next);
    setStatus(host, "ยังติดต่อ backend ไม่ได้ บันทึกเป็นรอเปิดใช้งาน ต้องเปิดเน็ตตรวจอีกครั้ง");
  }
};

const renderRelease = (host: HTMLElement) => {
  host.innerHTML = `<div class="commercial-card"><span class="commercial-kicker">Installer Release</span><h3>เวอร์ชันสำหรับอัปเดตขึ้นหน้า Download</h3><p>รุ่นนี้เตรียม pipeline สำหรับสร้างไฟล์ติดตั้ง Windows แบบ .exe และ .msi ผ่าน GitHub Actions แล้ว ใช้ tag/release ตาม version และควบคุมสิทธิ์การติดตั้งด้วย license ต่อเครื่อง</p><div class="commercial-summary"><span>App version: 0.2.0</span><span>Installer: NSIS + MSI</span><span>Channel: stable/manual release</span></div></div>`;
};

const sectionFromModal = () => {
  const title = textOf(document.querySelector(".modal header h2"));
  const bodyText = textOf(document.querySelector(".modal .settings-modal-body"));
  if (title.includes("ข้อมูลและพื้นที่") || title.includes("Data & storage")) return "storage";
  if (title.includes("Backup") || bodyText.includes("Backup / Restore")) return "backup";
  if (title.includes("Remote Management")) return "remote";
  if (title.includes("ลายเส้นโปรแกรม") || title.includes("Program License")) return "license";
  if (title.includes("เวอร์ชัน") || title.includes("Version")) return "release";
  return "";
};

const enhanceModal = () => {
  const body = document.querySelector<HTMLElement>(".modal .settings-modal-body");
  if (!body) return;
  const section = sectionFromModal();
  if (!section) return;
  if (body.dataset.commercialEnhanced === section) return;
  body.dataset.commercialEnhanced = section;
  body.querySelector(".commercial-settings-extension")?.remove();
  const host = document.createElement("div");
  host.className = "commercial-settings-extension";
  const footer = body.querySelector(".actions.modal-footer");
  body.insertBefore(host, footer || null);
  if (section === "storage") renderStorage(host);
  if (section === "backup") renderBackup(host);
  if (section === "remote") renderRemote(host);
  if (section === "license") renderLicense(host);
  if (section === "release") renderRelease(host);
};

const applyLicenseGuard = () => {
  const config = readConfig();
  const locked = !isLicenseActive(config) && trialDaysLeft(config) <= 0;
  const existing = document.querySelector(".commercial-license-lock");
  if (!locked) { existing?.remove(); return; }
  if (existing) return;
  const overlay = document.createElement("div");
  overlay.className = "commercial-license-lock";
  overlay.innerHTML = `<section><img src="/icon.png" alt="CpIPOS"/><h1>หมดระยะทดลองใช้งาน 30 วัน</h1><p>โปรแกรมถูกล็อคเพื่อรอเปิดใช้งานตัวเต็ม กรุณาเปิดอินเทอร์เน็ต ใส่ลายเส้นโปรแกรม และเชื่อมต่อระบบหลังบ้าน IT เพื่อปลดล็อกตามแพ็กเกจรายเดือน รายปี หรือตลอดชีพ</p><strong>Device Fingerprint: ${cell(getDeviceFingerprint())}</strong><button data-open-license>ไปที่เมนูลายเส้นโปรแกรม</button></section>`;
  overlay.querySelector("[data-open-license]")?.addEventListener("click", () => {
    overlay.remove();
    const settingsButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => textOf(button).includes("ตั้งค่า") || textOf(button).includes("Settings"));
    settingsButton?.click();
  });
  document.body.appendChild(overlay);
};

const startCommercialSettingsRuntime = () => {
  ensureTrial();
  applyLicenseGuard();
  enhanceModal();
  const observer = new MutationObserver(() => window.requestAnimationFrame(() => { enhanceModal(); applyLicenseGuard(); }));
  observer.observe(document.body, { childList: true, subtree: true });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startCommercialSettingsRuntime, { once: true });
} else {
  startCommercialSettingsRuntime();
}

export {};
