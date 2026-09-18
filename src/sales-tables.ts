export type SalesTable = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
};

export const SALES_TABLES_EVENT = "cpipos:sales-tables-updated";
const SALES_TABLES_KEY = "cpipos.desktop.sales.tables.v2";
const TABLE_BILLS_KEY = "cpipos.desktop.table-bills.v1";

function defaultTables(): SalesTable[] {
  const createdAt = new Date().toISOString();
  return Array.from({ length: 20 }, (_, index) => {
    const number = index + 1;
    const code = `T${String(number).padStart(2, "0")}`;
    return { id: code, code, name: `โต๊ะ ${number}`, active: true, sortOrder: number, createdAt };
  });
}

function normalizeCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9_-]/g, "").slice(0, 16);
}

function normalizeName(value: string, fallback: string) {
  const next = value.trim().replace(/\s+/g, " ").slice(0, 60);
  return next || fallback;
}

function readStored(): SalesTable[] | null {
  try {
    const raw = localStorage.getItem(SALES_TABLES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const tables = parsed
      .map((item, index) => {
        const code = normalizeCode(String(item?.code ?? ""));
        if (!code) return null;
        return {
          id: String(item?.id || code),
          code,
          name: normalizeName(String(item?.name ?? ""), code),
          active: item?.active !== false,
          sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : index + 1,
          createdAt: String(item?.createdAt || new Date().toISOString())
        } satisfies SalesTable;
      })
      .filter(Boolean) as SalesTable[];
    return tables.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  } catch {
    return null;
  }
}

function writeTables(tables: SalesTable[]) {
  const normalized = tables
    .map((table, index) => ({ ...table, sortOrder: index + 1 }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  localStorage.setItem(SALES_TABLES_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(SALES_TABLES_EVENT, { detail: normalized }));
}

export function listSalesTables(): SalesTable[] {
  const stored = readStored();
  if (stored) return stored;
  const defaults = defaultTables();
  try { writeTables(defaults); } catch { /* preview storage can be unavailable */ }
  return defaults;
}

export function addSalesTable(input: { code: string; name?: string }) {
  const code = normalizeCode(input.code);
  if (!code) throw new Error("กรอกรหัสโต๊ะ เช่น T01");
  const tables = listSalesTables();
  if (tables.some((table) => table.code === code)) throw new Error(`มีโต๊ะ ${code} อยู่แล้ว`);
  const next: SalesTable = {
    id: crypto.randomUUID(),
    code,
    name: normalizeName(input.name || "", code),
    active: true,
    sortOrder: tables.length + 1,
    createdAt: new Date().toISOString()
  };
  writeTables([...tables, next]);
  return next;
}

export function addSalesTablesBulk(input: { prefix: string; start: number; count: number }) {
  const rawPrefix = normalizeCode(input.prefix || "T").replace(/[0-9]+$/g, "") || "T";
  const start = Math.max(1, Math.floor(Number(input.start) || 1));
  const count = Math.max(1, Math.min(100, Math.floor(Number(input.count) || 1)));
  const tables = listSalesTables();
  const existing = new Set(tables.map((table) => table.code));
  const created: SalesTable[] = [];
  const width = Math.max(2, String(start + count - 1).length);
  for (let offset = 0; offset < count; offset += 1) {
    const number = start + offset;
    const code = normalizeCode(`${rawPrefix}${String(number).padStart(width, "0")}`);
    if (!code || existing.has(code)) continue;
    existing.add(code);
    created.push({
      id: crypto.randomUUID(),
      code,
      name: `โต๊ะ ${number}`,
      active: true,
      sortOrder: tables.length + created.length + 1,
      createdAt: new Date().toISOString()
    });
  }
  if (!created.length) throw new Error("ไม่มีโต๊ะใหม่ให้เพิ่ม รหัสอาจซ้ำกับรายการเดิม");
  writeTables([...tables, ...created]);
  return created;
}

export function updateSalesTable(id: string, patch: { code?: string; name?: string; active?: boolean }) {
  const tables = listSalesTables();
  const current = tables.find((table) => table.id === id);
  if (!current) throw new Error("ไม่พบโต๊ะ");
  const code = patch.code === undefined ? current.code : normalizeCode(patch.code);
  if (!code) throw new Error("รหัสโต๊ะไม่ถูกต้อง");
  if (tables.some((table) => table.id !== id && table.code === code)) throw new Error(`มีโต๊ะ ${code} อยู่แล้ว`);
  const next = tables.map((table) => table.id === id ? {
    ...table,
    code,
    name: patch.name === undefined ? table.name : normalizeName(patch.name, code),
    active: patch.active === undefined ? table.active : patch.active
  } : table);
  writeTables(next);
}

function hasOpenBill(code: string) {
  try {
    const raw = localStorage.getItem(TABLE_BILLS_KEY);
    if (!raw) return false;
    const bills = JSON.parse(raw) as Record<string, unknown>;
    return Boolean(bills && bills[code]);
  } catch {
    return false;
  }
}

export function removeSalesTable(id: string) {
  const tables = listSalesTables();
  const current = tables.find((table) => table.id === id);
  if (!current) return;
  if (hasOpenBill(current.code)) throw new Error(`โต๊ะ ${current.code} มีบิลเปิดอยู่ ต้องปิดหรือย้ายบิลก่อนลบโต๊ะ`);
  writeTables(tables.filter((table) => table.id !== id));
}
