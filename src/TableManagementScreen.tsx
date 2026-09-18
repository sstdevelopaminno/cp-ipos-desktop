import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Language } from "./domain/types";
import { addSalesTable, addSalesTablesBulk, listSalesTables, removeSalesTable, updateSalesTable, type SalesTable } from "./sales-tables";
import "./table-management.css";

type Props = { language: Language };
type CreateMode = "single" | "bulk" | null;

const PAGE_SIZE = 12;

function sortTables(tables: SalesTable[]) {
  return [...tables].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return <div className="table-modal-backdrop" onMouseDown={onClose}>
    <section className="table-modal" onMouseDown={(event) => event.stopPropagation()}>
      <header className="table-modal-head">
        <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
        <button className="table-modal-close" onClick={onClose}>×</button>
      </header>
      {children}
    </section>
  </div>;
}

export function TableManagementScreen({ language }: Props) {
  const th = language === "th";
  const [tables, setTables] = useState<SalesTable[]>(() => sortTables(listSalesTables()));
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [editing, setEditing] = useState<SalesTable | null>(null);
  const [deleting, setDeleting] = useState<SalesTable | null>(null);
  const [singleCode, setSingleCode] = useState("");
  const [singleName, setSingleName] = useState("");
  const [prefix, setPrefix] = useState("T");
  const [start, setStart] = useState("1");
  const [count, setCount] = useState("10");
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeCount = useMemo(() => tables.filter((table) => table.active).length, [tables]);
  const inactiveCount = tables.length - activeCount;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tables.filter((table) => {
      const statusOk = statusFilter === "all" || (statusFilter === "active" ? table.active : !table.active);
      if (!statusOk) return false;
      if (!needle) return true;
      return table.code.toLowerCase().includes(needle) || table.name.toLowerCase().includes(needle);
    });
  }, [tables, query, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  const refresh = () => setTables(sortTables(listSalesTables()));
  const clearMessages = () => { setError(""); setNotice(""); };
  const success = (message: string) => {
    setError("");
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
    refresh();
  };

  const openCreate = (mode: Exclude<CreateMode, null>) => {
    clearMessages();
    setCreateMode(mode);
  };

  const closeCreate = () => {
    setCreateMode(null);
    setError("");
  };

  const addOne = () => {
    try {
      const table = addSalesTable({ code: singleCode, name: singleName });
      setSingleCode("");
      setSingleName("");
      setCreateMode(null);
      success(th ? `เพิ่ม ${table.code} แล้ว` : `Added ${table.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const addMany = () => {
    try {
      const created = addSalesTablesBulk({ prefix, start: Number(start), count: Number(count) });
      setCreateMode(null);
      success(th ? `เพิ่มโต๊ะใหม่ ${created.length} โต๊ะแล้ว` : `Added ${created.length} tables`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openEdit = (table: SalesTable) => {
    clearMessages();
    setEditCode(table.code);
    setEditName(table.name);
    setEditing(table);
  };

  const saveEdit = () => {
    if (!editing) return;
    try {
      updateSalesTable(editing.id, { code: editCode, name: editName });
      const oldCode = editing.code;
      setEditing(null);
      success(th ? `บันทึก ${oldCode} แล้ว` : `Saved ${oldCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggle = (table: SalesTable) => {
    try {
      updateSalesTable(table.id, { active: !table.active });
      success(table.active ? (th ? `ปิดใช้งาน ${table.code} แล้ว` : `Disabled ${table.code}`) : (th ? `เปิดใช้งาน ${table.code} แล้ว` : `Enabled ${table.code}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmDelete = () => {
    if (!deleting) return;
    try {
      removeSalesTable(deleting.id);
      const code = deleting.code;
      setDeleting(null);
      success(th ? `ลบ ${code} แล้ว` : `Deleted ${code}`);
    } catch (err) {
      setDeleting(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return <section className="table-management-screen">
    <header className="table-management-hero">
      <div>
        <span className="table-management-eyebrow">TABLE MANAGEMENT</span>
        <h1>{th ? "จัดการโต๊ะ" : "Table management"}</h1>
        <p>{th ? "โต๊ะชุดนี้เชื่อมกับโหมดนั่งโต๊ะ เปิดบิล และย้ายโต๊ะของเมนูขายโดยตรง" : "These tables are shared with dine-in bills and table moves."}</p>
      </div>
      <div className="table-management-hero-actions">
        <button className="table-action-secondary" onClick={() => openCreate("bulk")}><span>▦</span>{th ? "เพิ่มหลายโต๊ะ" : "Bulk add"}</button>
        <button className="table-action-primary" onClick={() => openCreate("single")}><span>＋</span>{th ? "เพิ่มโต๊ะ" : "Add table"}</button>
      </div>
    </header>

    <div className="table-management-summary">
      <div><small>{th ? "โต๊ะทั้งหมด" : "Total tables"}</small><strong>{tables.length}</strong></div>
      <div><small>{th ? "เปิดใช้งาน" : "Active"}</small><strong>{activeCount}</strong></div>
      <div><small>{th ? "ปิดใช้งาน" : "Inactive"}</small><strong>{inactiveCount}</strong></div>
    </div>

    {error ? <div className="table-management-message error">{error}</div> : null}
    {notice ? <div className="table-management-message ok">{notice}</div> : null}

    <article className="table-management-list-card">
      <header className="table-list-toolbar">
        <div>
          <h2>{th ? "รายการโต๊ะ" : "Tables"}</h2>
          <p>{th ? "ค้นหา แก้ไข เปิด/ปิด หรือลบโต๊ะที่ไม่มีบิลค้าง" : "Search, edit, enable/disable, or delete tables without open bills."}</p>
        </div>
        <div className="table-list-controls">
          <label className="table-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={th ? "ค้นหารหัสหรือชื่อโต๊ะ" : "Search code or name"} /></label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "inactive")}>
            <option value="all">{th ? "ทุกสถานะ" : "All status"}</option>
            <option value="active">{th ? "เปิดใช้งาน" : "Active"}</option>
            <option value="inactive">{th ? "ปิดใช้งาน" : "Inactive"}</option>
          </select>
        </div>
      </header>

      {filtered.length === 0 ? <div className="table-management-empty">{th ? "ไม่พบรายการโต๊ะ" : "No tables found."}</div> :
      <>
        <div className="table-data-wrap">
          <table className="table-data-table">
            <thead><tr>
              <th>#</th>
              <th>{th ? "รหัสโต๊ะ" : "Code"}</th>
              <th>{th ? "ชื่อโต๊ะ" : "Name"}</th>
              <th>{th ? "สถานะ" : "Status"}</th>
              <th>{th ? "จัดการ" : "Actions"}</th>
            </tr></thead>
            <tbody>
              {visible.map((table, index) => <tr key={table.id}>
                <td>{(page - 1) * PAGE_SIZE + index + 1}</td>
                <td><span className="table-code-pill">{table.code}</span></td>
                <td><strong>{table.name}</strong></td>
                <td><span className={`table-status-pill ${table.active ? "active" : "inactive"}`}>{table.active ? (th ? "เปิดใช้งาน" : "Active") : (th ? "ปิดใช้งาน" : "Inactive")}</span></td>
                <td>
                  <div className="table-row-actions">
                    <button onClick={() => openEdit(table)}>{th ? "แก้ไข" : "Edit"}</button>
                    <button className={table.active ? "warning" : "success"} onClick={() => toggle(table)}>{table.active ? (th ? "ปิดใช้" : "Disable") : (th ? "เปิดใช้" : "Enable")}</button>
                    <button className="danger" onClick={() => setDeleting(table)}>{th ? "ลบ" : "Delete"}</button>
                  </div>
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>

        <footer className="table-pagination">
          <span>{th ? `แสดง ${visible.length} จาก ${filtered.length} รายการ` : `Showing ${visible.length} of ${filtered.length}`}</span>
          <div>
            <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>
            <strong>{page} / {pageCount}</strong>
            <button disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button>
          </div>
        </footer>
      </>}
    </article>

    {createMode === "single" ? <Modal title={th ? "เพิ่มโต๊ะ" : "Add table"} subtitle={th ? "เพิ่มโต๊ะทีละรายการ แล้วบันทึกลงตาราง" : "Add one table to the list."} onClose={closeCreate}>
      <div className="table-modal-form two">
        <label>{th ? "รหัสโต๊ะ" : "Code"}<input autoFocus value={singleCode} onChange={(event) => setSingleCode(event.target.value.toUpperCase())} placeholder="T21" /></label>
        <label>{th ? "ชื่อโต๊ะ" : "Name"}<input value={singleName} onChange={(event) => setSingleName(event.target.value)} placeholder={th ? "เช่น โต๊ะริมหน้าต่าง" : "e.g. Window table"} /></label>
      </div>
      {error ? <div className="table-management-message error">{error}</div> : null}
      <div className="table-modal-actions"><button onClick={closeCreate}>{th ? "ยกเลิก" : "Cancel"}</button><button className="primary" onClick={addOne}>{th ? "บันทึกโต๊ะ" : "Save table"}</button></div>
    </Modal> : null}

    {createMode === "bulk" ? <Modal title={th ? "เพิ่มหลายโต๊ะ" : "Bulk add tables"} subtitle={th ? "สร้างรหัสโต๊ะต่อเนื่อง เช่น T21–T40" : "Create sequential table codes."} onClose={closeCreate}>
      <div className="table-modal-form three">
        <label>{th ? "คำนำหน้า" : "Prefix"}<input autoFocus value={prefix} onChange={(event) => setPrefix(event.target.value.toUpperCase())} placeholder="T" /></label>
        <label>{th ? "เริ่มเลขที่" : "Start"}<input type="number" min="1" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label>{th ? "จำนวนโต๊ะ" : "Count"}<input type="number" min="1" max="100" value={count} onChange={(event) => setCount(event.target.value)} /></label>
      </div>
      {error ? <div className="table-management-message error">{error}</div> : null}
      <div className="table-modal-actions"><button onClick={closeCreate}>{th ? "ยกเลิก" : "Cancel"}</button><button className="primary" onClick={addMany}>{th ? "สร้างและบันทึก" : "Create & save"}</button></div>
    </Modal> : null}

    {editing ? <Modal title={th ? `แก้ไขโต๊ะ ${editing.code}` : `Edit ${editing.code}`} subtitle={th ? "แก้ไขรหัสหรือชื่อโต๊ะ" : "Update table code or name."} onClose={() => { setEditing(null); setError(""); }}>
      <div className="table-modal-form two">
        <label>{th ? "รหัสโต๊ะ" : "Code"}<input autoFocus value={editCode} onChange={(event) => setEditCode(event.target.value.toUpperCase())} /></label>
        <label>{th ? "ชื่อโต๊ะ" : "Name"}<input value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
      </div>
      {error ? <div className="table-management-message error">{error}</div> : null}
      <div className="table-modal-actions"><button onClick={() => { setEditing(null); setError(""); }}>{th ? "ยกเลิก" : "Cancel"}</button><button className="primary" onClick={saveEdit}>{th ? "บันทึกการแก้ไข" : "Save changes"}</button></div>
    </Modal> : null}

    {deleting ? <Modal title={th ? "ยืนยันลบโต๊ะ" : "Delete table"} subtitle={th ? "โต๊ะที่มีบิลเปิดอยู่จะไม่สามารถลบได้" : "Tables with open bills cannot be deleted."} onClose={() => setDeleting(null)}>
      <div className="table-delete-confirm"><span>{deleting.code}</span><div><strong>{deleting.name}</strong><p>{th ? "ต้องการลบรายการนี้ออกจากระบบหรือไม่?" : "Remove this table from the system?"}</p></div></div>
      <div className="table-modal-actions"><button onClick={() => setDeleting(null)}>{th ? "ไม่ลบ" : "Cancel"}</button><button className="danger" onClick={confirmDelete}>{th ? "ยืนยันลบ" : "Delete"}</button></div>
    </Modal> : null}
  </section>;
}
