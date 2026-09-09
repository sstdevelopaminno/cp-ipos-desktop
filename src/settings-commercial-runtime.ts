import Database from "@tauri-apps/plugin-sql";

type GenericRecord = Record<string, unknown>;
type ArchiveMode = "sqlite" | "browser-preview";
type BackupSyncMode = "local" | "cloud" | "dual";
type CommercialConfig = {
  backup: {
    apiUrl: string;
    tenantId: string;
    storeId: string;
    apiKey: string;
    packageName: string;
    syncMode: BackupSyncMode;
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
    status: "free" | "trial" | "pending_activation" | "active" | "expired" | "revoked";
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
const FREE_MODE_KEY = "cpipos.license.freeForever.enabled";
const DATA_TABLES = ["sales", "sale_items", "receipts", "sale_cancellations", "audit_events", "stock_movement_ledger", "products", "staff", "shifts", "app_settings"];
const PURGE_TABLES = ["sale_items", "receipts", "sale_cancellations", "sales"];
const nowIso = () => new Date().toISOString();
const fileStamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const textOf = (element: Element | null) => (element?.textContent || "").trim();
const isFreeForeverMode = () => localStorage.getItem(FREE_MODE_KEY) !== "0";

const cell = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;");

const defaultConfig = (): CommercialConfig => {
  const trialStartedAt = localStorage.getItem(TRIAL_KEY) || nowIso();
  const fingerprint = getDeviceFingerprint();
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
      lastStatus: "พร้อมใช้งานแบบ Local / Offline",
    },
    remote: {
      enabled: false,
      mdmUrl: "",
      deviceToken: "",
      itBackendUrl: "",
      heartbeatSeconds: "60",
      autoConnect: false,
      lastSeenAt: "",
      lastStatus: "ปิดการเชื่อมต่อ MDM ไว้ก่อน",
    },
    license: {
      key: "CPIPOS-FREE-FOREVER",
      serverUrl: "",
      packageName: "Free Forever",
      duration: "lifetime",
      status: "free",
      token: "LOCAL-FREE-MODE",
      deviceFingerprint: fingerprint,
      activatedAt: nowIso(),
      expiresAt: "",
      trialStartedAt,
      lastCheckedAt: nowIso(),
    },
  };
};

function getDeviceFingerprint() {
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
}

const readConfig = (): CommercialConfig => {
  const base = defaultConfig();
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<CommercialConfig>;
    const merged: CommercialConfig = {
      backup: { ...base.backup, ...(saved.backup || {}) },
      remote: { ...base.remote, ...(saved.remote || {}) },
      license: { ...base.license, ...(saved.license || {}) },
    };
    if (isFreeForeverMode()) {
      merged.license = { ...merged.license, key: "CPIPOS-FREE-FOREVER", packageName: "Free Forever", duration: "lifetime", status: "free", token: "LOCAL-FREE-MODE", expiresAt: "", deviceFingerprint: getDeviceFingerprint(), lastCheckedAt: nowIso() };
      merged.remote = { ...merged.remote, enabled: false, autoConnect: false, lastStatus: "ปิดการเชื่อมต่อ MDM ไว้ก่อน" };
    }
    return merged;
  } catch {
    return base;
  }
};

const writeConfig = (config: CommercialConfig) => localStorage.setItem(CONFIG_KEY, JSON.stringify(config));

const applyFreeForeverLicense = async () => {
  localStorage.setItem(FREE_MODE_KEY, "1");
  const config = readConfig();
  config.license = { ...config.license, key: "CPIPOS-FREE-FOREVER", packageName: "Free Forever", duration: "lifetime", status: "free", token: "LOCAL-FREE-MODE", expiresAt: "", deviceFingerprint: getDeviceFingerprint(), activatedAt: config.license.activatedAt || nowIso(), lastCheckedAt: nowIso() };
  config.remote = { ...config.remote, enabled: false, autoConnect: false, lastStatus: "ปิดการเชื่อมต่อ MDM ไว้ก่อน" };
  writeConfig(config);

  try {
    const db = await Database.load("sqlite:cpipos.db");
    const rows: Array<[string, string]> = [
      ["programLicenseKey", "CPIPOS-FREE-FOREVER"],
      ["programLicenseToken", "LOCAL-FREE-MODE"],
      ["programLicenseStatus", "active"],
      ["programLicensePlan", "Free Forever"],
      ["programLicenseDeviceLimit", "unlimited"],
      ["programLicenseDeviceFingerprint", getDeviceFingerprint()],
      ["programLicenseActivatedAt", config.license.activatedAt || nowIso()],
      ["programLicenseExpiresAt", ""],
      ["programLicenseLastCheckedAt", nowIso()],
      ["remoteManagementEnabled", "false"],
    ];
    for (const [key, value] of rows) {
      await db.execute("INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP", [key, value]);
    }
  } catch {
    try {
      const key = "cpipos.desktop.demo.settings";
      const settings = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({ ...settings, programLicenseKey: "CPIPOS-FREE-FOREVER", programLicenseToken: "LOCAL-FREE-MODE", programLicenseStatus: "active", programLicensePlan: "Free Forever", programLicenseDeviceLimit: "unlimited", programLicenseDeviceFingerprint: getDeviceFingerprint(), programLicenseExpiresAt: "", remoteManagementEnabled: false }));
    } catch {
      // Ignore browser preview storage errors.
    }
  }
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
  const parseRows = (key: string) => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]") as unknown;
      return Array.isArray(parsed) ? parsed as GenericRecord[] : [parsed as GenericRecord];
    } catch {
      return [];
    }
  };
  return {
    app: "CpIPOS Desktop",
    version: "0.2.0",
    exportedAt: nowIso(),
    mode: "browser-preview",
    tables: {
      sales: parseRows("cpipos.desktop.demo.sales"),
      sale_items: [],
      receipts: [],
      sale_cancellations: [],
      audit_events: parseRows("cpipos.desktop.demo.audit"),
      stock_movement_ledger: parseRows("cpipos.desktop.demo.stock"),
      products: parseRows("cpipos.desktop.demo.products"),
      staff: parseRows("cpipos.desktop.demo.staff"),
      shifts: localStorage.getItem("cpipos.desktop.demo.shift") ? parseRows("cpipos.desktop.demo.shift") : [],
      app_settings: localStorage.getItem("cpipos.desktop.demo.settings") ? parseRows("cpipos.desktop.demo.settings") : [],
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

const tableToHtml = (tableName: string, rows: GenericRecord[]) => {
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
  if (!headers.length) return `<h2>${cell(tableName)}</h2><p>ไม่มีข้อมูล</p>`;
  return `<h2>${cell(tableName)}</h2><table><thead><tr>${headers.map(h => `<th>${cell(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map(h => `<td>${cell(row[h])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
};

const archiveToExcelHtml = (archive: DataArchive) => `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,'Noto Sans Thai',sans-serif}h1{font-size:22px}h2{margin-top:24px;color:#0f4c81}table{border-collapse:collapse;margin-bottom:24px;width:100%}th,td{border:1px solid #cbd5e1;padding:6px;font-size:12px;vertical-align:top}th{background:#e0f2fe}</style></head><body><h1>CpIPOS Data Archive</h1><p>Exported: ${cell(archive.exportedAt)} · Mode: ${cell(archive.mode)}</p>${Object.entries(archive.tables).map(([name, rows]) => tableToHtml(name, rows)).join("")}</body></html>`;

const archiveToReportHtml = (archive: DataArchive) => {
  const sales = archive.tables.sales || [];
  const saleCount = sales.length;
  const total = sales.reduce((sum, row) => sum + Number(row.total || 0), 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>CpIPOS Report</title><style>body{font-family:Arial,'Noto Sans Thai',sans-serif;margin:32px;color:#0f172a}.hero{border-bottom:3px solid #2563eb;margin-bottom:20px;padding-bottom:12px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metric{border:1px solid #dbeafe;border-radius:12px;padding:12px;background:#eff6ff}.metric span{font-size:12px;color:#64748b}.metric strong{display:block;font-size:22px}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #cbd5e1;padding:8px;font-size:12px}th{background:#dbeafe}@media print{button{display:none}}</style></head><body><div class="hero"><h1>CpIPOS รายงานก่อนล้างข้อมูล</h1><p>บันทึกเมื่อ ${cell(archive.exportedAt)} · โหมด ${cell(archive.mode)}</p></div><div class="grid"><div class="metric"><span>จำนวนบิล</span><strong>${saleCount.toLocaleString("th-TH")}</strong></div><div class="metric"><span>ยอดขายรวม</span><strong>${total.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</strong></div><div class="metric"><span>Audit</span><strong>${(archive.tables.audit_events || []).length.toLocaleString("th-TH")}</strong></div><div class="metric"><span>สินค้า</span><strong>${(archive.tables.products || []).length.toLocaleString("th-TH")}</strong></div></div>${tableToHtml("sales", sales.slice(0, 300))}</body></html>`;
};

const exportArchive = async (kind: "excel" | "pdf" | "json") => {
  const archive = await collectArchive();
  if (kind === "excel") downloadBlob(archiveToExcelHtml(archive), `cpipos-data-${fileStamp()}.xls`, "application/vnd.ms-excel;charset=utf-8");
  if (kind === "json") downloadBlob(JSON.stringify(archive, null, 2), `cpipos-data-${fileStamp()}.json`, "application/json;charset=utf-8");
  if (kind === "pdf") {
    const win = window.open("", "_blank", "width=1100,height=800");
    if (!win) {
      downloadBlob(archiveToReportHtml(archive), `cpipos-report-${fileStamp()}.html`, "text/html;charset=utf-8");
      return;
    }
    win.document.write(archiveToReportHtml(archive));
    win.document.close();
    window.setTimeout(() => { win.focus(); win.print(); }, 500);
  }
};

const purgeSqliteSales = async () => {
  const db = await Database.load("sqlite:cpipos.db");
  for (const table of PURGE_TABLES) {
    try { await db.execute(`DELETE FROM ${table}`); } catch { /* ignore old schemas */ }
  }
  try {
    await db.execute("INSERT INTO audit_events(id,timestamp,action,entity_type,entity_id,status,details_json) VALUES($1,$2,'DATA_ARCHIVED_AND_RESET','storage','local','completed',$3)", [crypto.randomUUID(), nowIso(), JSON.stringify({ resetAt: nowIso(), tables: PURGE_TABLES })]);
  } catch {
    // Older schemas may not have audit_events.
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

const showResetDialog = () => new Promise<boolean>(resolve => {
  const overlay = document.createElement("div");
  overlay.className = "commercial-reset-dialog";
  overlay.innerHTML = `<section><h2>ยืนยันบันทึกและล้างข้อมูล</h2><p>ระบบจะ Export Excel และ JSON ก่อน แล้วล้างเฉพาะรายการขาย/ใบเสร็จรอบเก่า สินค้า พนักงาน ตั้งค่า และ license จะยังอยู่</p><label>พิมพ์ RESET เพื่อยืนยัน<input autocomplete="off" data-reset-input /></label><div><button class="secondary" data-cancel>ยกเลิก</button><button class="danger" data-confirm disabled>ยืนยันล้างข้อมูล</button></div></section>`;
  const input = overlay.querySelector<HTMLInputElement>("[data-reset-input]");
  const confirm = overlay.querySelector<HTMLButtonElement>("[data-confirm]");
  const close = (ok: boolean) => { overlay.remove(); resolve(ok); };
  input?.addEventListener("input", () => { if (confirm) confirm.disabled = input.value !== "RESET"; });
  input?.addEventListener("keydown", event => { if (event.key === "Enter" && input.value === "RESET") close(true); if (event.key === "Escape") close(false); });
  overlay.querySelector("[data-cancel]")?.addEventListener("click", () => close(false));
  confirm?.addEventListener("click", () => close(true));
  overlay.addEventListener("click", event => { if (event.target === overlay) close(false); });
  document.body.appendChild(overlay);
  window.setTimeout(() => input?.focus(), 50);
});

const archiveAndReset = async (status: HTMLElement | null) => {
  const confirmed = await showResetDialog();
  if (!confirmed) return;
  status && (status.textContent = "กำลังบันทึกไฟล์ Excel และ JSON...");
  const archive = await collectArchive();
  downloadBlob(archiveToExcelHtml(archive), `cpipos-before-reset-${fileStamp()}.xls`, "application/vnd.ms-excel;charset=utf-8");
  downloadBlob(JSON.stringify(archive, null, 2), `cpipos-before-reset-${fileStamp()}.json`, "application/json;charset=utf-8");
  status && (status.textContent = "กำลังล้างรายการขายรอบเก่า...");
  try { await purgeSqliteSales(); }
  catch { purgeBrowserSales(); }
  status && (status.textContent = "บันทึกและล้างข้อมูลเรียบร้อย ระบบจะรีโหลดเพื่อเริ่มนับรายการขายใหม่");
  window.setTimeout(() => window.location.reload(), 1200);
};

const bind = (host: HTMLElement, selector: string, handler: (event: Event) => void) => host.querySelector(selector)?.addEventListener("click", handler);
const inputValue = (host: HTMLElement, name: string) => (host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-field="${name}"]`)?.value || "").trim();
const checkedValue = (host: HTMLElement, name: string) => Boolean(host.querySelector<HTMLInputElement>(`[data-field="${name}"]`)?.checked);
const setStatus = (host: HTMLElement, message: string) => { const node = host.querySelector<HTMLElement>("[data-status]"); if (node) node.textContent = message; };

const renderStorage = (host: HTMLElement) => {
  const config = readConfig();
  host.innerHTML = `<div class="commercial-card commercial-storage"><div><span class="commercial-kicker">Data lifecycle</span><h3>ข้อมูลและพื้นที่</h3><p>ระบบนี้ใช้งานกับฐานข้อมูลในเครื่องได้ทันที: Export รายการขาย/รายงาน/ข้อมูลสำรอง แล้วจึงล้างเฉพาะข้อมูลขายรอบเก่าเพื่อเริ่มนับรอบใหม่</p></div><div class="commercial-button-grid"><button data-action="excel">บันทึกเป็น Excel</button><button data-action="pdf">บันทึกเป็น PDF</button><button data-action="json">Backup JSON</button><button class="danger" data-action="reset">บันทึกแล้วล้างข้อมูล</button></div><div class="commercial-summary"><span>Cloud package: ${cell(config.backup.packageName)}</span><span>Sync mode: ${cell(config.backup.syncMode)}</span><span data-status>พร้อมทำงานกับ SQLite / Local data</span></div></div>`;
  const status = host.querySelector<HTMLElement>("[data-status]");
  bind(host, "[data-action='excel']", () => void exportArchive("excel"));
  bind(host, "[data-action='pdf']", () => void exportArchive("pdf"));
  bind(host, "[data-action='json']", () => void exportArchive("json"));
  bind(host, "[data-action='reset']", () => void archiveAndReset(status));
};

const renderBackup = (host: HTMLElement) => {
  const config = readConfig();
  host.innerHTML = `<div class="commercial-card"><span class="commercial-kicker">Backup / Restore</span><h3>เชื่อมต่อฐานข้อมูลภายนอกผ่าน Cloud API</h3><p>ตั้งค่าระบบหลังบ้านไว้ก่อน รุ่นนี้ยังใช้งานหลักแบบ Local/Offline และจะเปิด sync จริงเมื่อ backend IT พร้อม</p><div class="commercial-form-grid"><label>Cloud API URL<input data-field="apiUrl" value="${cell(config.backup.apiUrl)}" placeholder="https://api.company.com/cpipos" /></label><label>Tenant ID<input data-field="tenantId" value="${cell(config.backup.tenantId)}" placeholder="cutting-point" /></label><label>Store / Branch ID<input data-field="storeId" value="${cell(config.backup.storeId)}" placeholder="store-main-01" /></label><label>API Key<input data-field="apiKey" value="${cell(config.backup.apiKey)}" type="password" placeholder="เก็บจริงใน backend/secret store" /></label><label>แพ็กเกจ<select data-field="packageName"><option${config.backup.packageName === "Offline" ? " selected" : ""}>Offline</option><option${config.backup.packageName === "Cloud Basic" ? " selected" : ""}>Cloud Basic</option><option${config.backup.packageName === "Cloud Pro" ? " selected" : ""}>Cloud Pro</option><option${config.backup.packageName === "Enterprise" ? " selected" : ""}>Enterprise</option></select></label><label>โหมด Sync<select data-field="syncMode"><option value="local"${config.backup.syncMode === "local" ? " selected" : ""}>Local only</option><option value="dual"${config.backup.syncMode === "dual" ? " selected" : ""}>Local + Cloud queue</option><option value="cloud"${config.backup.syncMode === "cloud" ? " selected" : ""}>Cloud primary เมื่อออนไลน์</option></select></label><label>เริ่มสัญญา<input data-field="contractStart" value="${cell(config.backup.contractStart)}" type="date" /></label><label>หมดสัญญา<input data-field="contractEnd" value="${cell(config.backup.contractEnd)}" type="date" /></label><label class="inline-check commercial-wide"><input data-field="onlineContract" type="checkbox"${config.backup.onlineContract ? " checked" : ""}/> มีสัญญาเน็ตและอนุญาต sync ขึ้น cloud</label></div><div class="commercial-button-row"><button data-action="save">บันทึกค่าเชื่อมต่อ</button><button class="secondary" data-action="test">ทดสอบ API</button><button class="secondary" data-action="queue">เตรียมคิว sync</button></div><p class="commercial-status" data-status>${cell(config.backup.lastStatus)}</p></div>`;
  bind(host, "[data-action='save']", () => { const next = readConfig(); next.backup = { ...next.backup, apiUrl: inputValue(host, "apiUrl"), tenantId: inputValue(host, "tenantId"), storeId: inputValue(host, "storeId"), apiKey: inputValue(host, "apiKey"), packageName: inputValue(host, "packageName"), syncMode: inputValue(host, "syncMode") as BackupSyncMode, onlineContract: checkedValue(host, "onlineContract"), contractStart: inputValue(host, "contractStart"), contractEnd: inputValue(host, "contractEnd"), lastStatus: "บันทึกค่า Backup / Restore แล้ว", lastTestAt: nowIso() }; writeConfig(next); setStatus(host, next.backup.lastStatus); });
  bind(host, "[data-action='test']", () => void testCloudApi(host));
  bind(host, "[data-action='queue']", () => setStatus(host, "เตรียมคิว Sync แล้ว เมื่อ backend IT พร้อมจะเริ่มส่งข้อมูลตามโหมดที่เลือก"));
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
  host.innerHTML = `<div class="commercial-card"><span class="commercial-kicker">Remote Management / MDM</span><h3>ปิดการเชื่อมต่อ MDM ไว้ก่อน</h3><p>รุ่นปล่อยทดสอบนี้ยังไม่เชื่อมต่อระบบหลังบ้าน IT อัตโนมัติ แต่เก็บฟอร์มตั้งค่าไว้สำหรับเฟสถัดไป</p><div class="commercial-form-grid"><label class="inline-check commercial-wide"><input data-field="enabled" type="checkbox" disabled /> ปิด Remote Management ในเวอร์ชันนี้</label><label>MDM Server URL<input data-field="mdmUrl" value="${cell(config.remote.mdmUrl)}" placeholder="https://mdm.company.com" /></label><label>IT Backend URL<input data-field="itBackendUrl" value="${cell(config.remote.itBackendUrl)}" placeholder="https://it.company.com" /></label><label>Device Token<input data-field="deviceToken" value="${cell(config.remote.deviceToken)}" type="password" /></label><label>Heartbeat seconds<input data-field="heartbeatSeconds" value="${cell(config.remote.heartbeatSeconds)}" inputmode="numeric" /></label><label class="inline-check"><input data-field="autoConnect" type="checkbox" disabled /> Auto connect ปิดไว้ก่อน</label></div><div class="commercial-button-row"><button data-action="save">บันทึกค่าไว้ก่อน</button><button class="secondary" data-action="ping" disabled>ปิดการทดสอบ Heartbeat</button></div><div class="commercial-summary"><span>Fingerprint: ${cell(getDeviceFingerprint())}</span><span>Last seen: ${cell(config.remote.lastSeenAt || "-")}</span><span data-status>ปิดการเชื่อมต่อ MDM ไว้ก่อน</span></div></div>`;
  bind(host, "[data-action='save']", () => { const next = readConfig(); const heartbeat = Math.max(30, Number(inputValue(host, "heartbeatSeconds") || 60)); next.remote = { ...next.remote, enabled: false, autoConnect: false, mdmUrl: inputValue(host, "mdmUrl"), itBackendUrl: inputValue(host, "itBackendUrl"), deviceToken: inputValue(host, "deviceToken"), heartbeatSeconds: String(heartbeat), lastStatus: "บันทึกค่า MDM ไว้แล้ว แต่ยังปิดการเชื่อมต่อในเวอร์ชันนี้" }; writeConfig(next); setStatus(host, next.remote.lastStatus); });
};

const renderLicense = (host: HTMLElement) => {
  const config = readConfig();
  const fingerprint = config.license.deviceFingerprint || getDeviceFingerprint();
  host.innerHTML = `<div class="commercial-card commercial-license free-mode"><span class="commercial-kicker">Free release</span><h3>ลายเส้นโปรแกรมปิดไว้ก่อน / ใช้ฟรีตลอด</h3><p>เวอร์ชันนี้ปล่อยให้ใช้งานฟรีตลอดก่อน ระบบไม่ล็อคโปรแกรม ไม่บังคับ Trial 30 วัน และไม่เชื่อมต่อ License Server</p><div class="commercial-license-grid"><div><span>สถานะ</span><strong>Free Forever</strong></div><div><span>อายุการใช้งาน</span><strong>ตลอดชีพ</strong></div><div><span>Device Fingerprint</span><strong>${cell(fingerprint)}</strong></div></div><div class="commercial-button-row"><button data-action="copy">คัดลอกรหัสเครื่อง</button><button class="secondary" data-action="save">บันทึก Free Mode</button><button class="secondary" disabled>ปิดการเชื่อมต่อ License</button></div><p class="commercial-status" data-status>พร้อมใช้งานฟรีตลอด รุ่นนี้ไม่เชื่อมต่อระบบลายเส้น</p></div>`;
  bind(host, "[data-action='copy']", () => { void navigator.clipboard?.writeText(fingerprint); setStatus(host, "คัดลอกรหัสเครื่องแล้ว"); });
  bind(host, "[data-action='save']", () => void applyFreeForeverLicense().then(() => setStatus(host, "บันทึก Free Forever Mode แล้ว")));
};

const renderRelease = (host: HTMLElement) => {
  host.innerHTML = `<div class="commercial-card"><span class="commercial-kicker">Installer Release</span><h3>เวอร์ชันสำหรับอัปเดตขึ้นหน้า Download</h3><p>รุ่นนี้ใช้โหมด Free Forever ก่อน สามารถ build เป็น .exe/.msi แล้วทดสอบในเครื่องก่อนอัปขึ้นเว็บดาวน์โหลด</p><div class="commercial-summary"><span>App version: 0.2.0</span><span>Installer: NSIS + MSI</span><span>License mode: Free Forever</span></div></div>`;
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
  body.dataset.commercialSection = section;
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

const removeLicenseLocks = () => document.querySelectorAll(".commercial-license-lock").forEach(node => node.remove());

const startCommercialSettingsRuntime = () => {
  void applyFreeForeverLicense();
  removeLicenseLocks();
  enhanceModal();
  const observer = new MutationObserver(() => window.requestAnimationFrame(() => { removeLicenseLocks(); enhanceModal(); }));
  observer.observe(document.body, { childList: true, subtree: true });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startCommercialSettingsRuntime, { once: true });
} else {
  startCommercialSettingsRuntime();
}

export {};
