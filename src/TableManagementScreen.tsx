import { useMemo, useState } from "react";
import type { Language } from "./domain/types";
import { addSalesTable, addSalesTablesBulk, listSalesTables, removeSalesTable, updateSalesTable, type SalesTable } from "./sales-tables";
import "./table-management.css";

type Props = { language: Language };

function sortTables(tables: SalesTable[]) {
  return [...tables].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

export function TableManagementScreen({ language }: Props) {
  const th = language === "th";
  const [tables, setTables] = useState<SalesTable[]>(() => sortTables(listSalesTables()));
  const [singleCode, setSingleCode] = useState("");
  const [singleName, setSingleName] = useState("");
  const [prefix, setPrefix] = useState("T");
  const [start, setStart] = useState("1");
  const [count, setCount] = useState("10");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeCount = useMemo(() => tables.filter((table) => table.active).length, [tables]);

  const refresh = () => setTables(sortTables(listSalesTables()));
  const success = (message: string) => {
    setError("");
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
    refresh();
  };

  const addOne = () => {
    try {
      const table = addSalesTable({ code: singleCode, name: singleName });
      setSingleCode("");
      setSingleName("");
      success(th ? `เพิ่ม ${table.code} แล้ว` : `Added ${table.code}`);
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const addMany = () => {
    try {
      const created = addSalesTablesBulk({ prefix, start: Number(start), count: Number(count) });
      success(th ? `เพิ่มโต๊ะใหม่ ${created.length} โต๊ะแล้ว` : `Added ${created.length} tables`);
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return <section className="table-management-screen">
    <header className="table-management-hero">
      <div>
        <span className="table-management-eyebrow">TABLE MANAGEMENT</span>
        <h1>{th ? "จัดการโต๊ะ" : "Table management"}</h1>
        <p>{th ? "รายการโต๊ะชุดนี้เชื่อมกับโหมดนั่งโต๊ะและหน้าต่างย้ายโต๊ะของเมนูขายโดยตรง" : "These tables are shared with dine-in sales and move-table workflows."}</p>
      </div>
      <div className="table-management-stats">
        <div><small>{th ? "โต๊ะทั้งหมด" : "Total"}</small><strong>{tables.length}</strong></div>
        <div><small>{th ? "เปิดใช้งาน" : "Active"}</small><strong>{activeCount}</strong></div>
      </div>
    </header>

    <div className="table-management-create-grid">
      <article className="table-management-card">
        <div className="table-management-card-head">
          <span className="table-management-icon">＋</span>
          <div><h2>{th ? "เพิ่มโต๊ะทีละรายการ" : "Add one table"}</h2><p>{th ? "กำหนดรหัสและชื่อโต๊ะเอง" : "Set a table code and name."}</p></div>
        </div>
        <div className="table-management-form two">
          <label>{th ? "รหัสโต๊ะ" : "Code"}<input value={singleCode} onChange={(event) => setSingleCode(event.target.value.toUpperCase())} placeholder="T21" /></label>
          <label>{th ? "ชื่อโต๊ะ" : "Name"}<input value={singleName} onChange={(event) => setSingleName(event.target.value)} placeholder={th ? "เช่น โต๊ะริมหน้าต่าง" : "e.g. Window table"} /></label>
        </div>
        <button className="table-management-primary" onClick={addOne}>{th ? "เพิ่มโต๊ะ" : "Add table"}</button>
      </article>

      <article className="table-management-card">
        <div className="table-management-card-head">
          <span className="table-management-icon">▦</span>
          <div><h2>{th ? "เพิ่มหลายโต๊ะ" : "Bulk add tables"}</h2><p>{th ? "สร้างรหัสต่อเนื่องอัตโนมัติ เช่น T21–T40" : "Generate sequential table codes."}</p></div>
        </div>
        <div className="table-management-form three">
          <label>{th ? "คำนำหน้า" : "Prefix"}<input value={prefix} onChange={(event) => setPrefix(event.target.value.toUpperCase())} placeholder="T" /></label>
          <label>{th ? "เริ่มเลขที่" : "Start"}<input type="number" min="1" value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label>{th ? "จำนวนโต๊ะ" : "Count"}<input type="number" min="1" max="100" value={count} onChange={(event) => setCount(event.target.value)} /></label>
        </div>
        <button className="table-management-primary" onClick={addMany}>{th ? "สร้างหลายโต๊ะ" : "Create tables"}</button>
      </article>
    </div>

    {error ? <div className="table-management-message error">{error}</div> : null}
    {notice ? <div className="table-management-message ok">{notice}</div> : null}

    <article className="table-management-list-card">
      <header><div><h2>{th ? "รายการโต๊ะ" : "Tables"}</h2><p>{th ? "แก้ไขชื่อ/รหัส ปิดใช้งาน หรือลบโต๊ะที่ไม่มีบิลค้างได้" : "Edit, disable, or remove tables without open bills."}</p></div></header>
      {tables.length === 0 ? <div className="table-management-empty">{th ? "ยังไม่มีโต๊ะ กดเพิ่มโต๊ะด้านบนเพื่อเริ่มใช้งาน" : "No tables yet."}</div> :
      <div className="table-management-grid">{tables.map((table) => <TableRow key={table.id} table={table} language={language} onChanged={refresh} onError={setError} />)}</div>}
    </article>
  </section>;
}

function TableRow({ table, language, onChanged, onError }: { table: SalesTable; language: Language; onChanged: () => void; onError: (value: string) => void }) {
  const th = language === "th";
  const [code, setCode] = useState(table.code);
  const [name, setName] = useState(table.name);

  const save = () => {
    try {
      updateSalesTable(table.id, { code, name });
      onError("");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggle = () => {
    try {
      updateSalesTable(table.id, { active: !table.active });
      onError("");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = () => {
    if (!window.confirm(th ? `ลบโต๊ะ ${table.code} ?` : `Delete ${table.code}?`)) return;
    try {
      removeSalesTable(table.id);
      onError("");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return <div className={`table-management-row ${table.active ? "" : "is-inactive"}`}>
    <div className="table-management-table-badge">{table.code}</div>
    <label><small>{th ? "รหัส" : "Code"}</small><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} onBlur={save} /></label>
    <label><small>{th ? "ชื่อโต๊ะ" : "Name"}</small><input value={name} onChange={(event) => setName(event.target.value)} onBlur={save} /></label>
    <div className="table-management-row-actions">
      <button className={table.active ? "active" : ""} onClick={toggle}>{table.active ? (th ? "เปิดใช้" : "Active") : (th ? "ปิดใช้" : "Disabled")}</button>
      <button className="danger" onClick={remove}>{th ? "ลบ" : "Delete"}</button>
    </div>
  </div>;
}
