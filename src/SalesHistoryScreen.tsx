import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PosRepository } from "./data/repository";
import type { AppSettings, Language, Receipt, Sale, SaleItem, Shift, Staff } from "./domain/types";
import { t } from "./i18n";
import { printReceiptNative } from "./receipt-print";
import "./sales-history-ui.css";
import "./sales-receipt-ui.css";

type Period = "day" | "month" | "year" | "all";
type StatusFilter = "all" | "completed" | "cancelled";

const SYSTEM_LOGO = "/icon.png";
const moneyNumber = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n: number) => `฿${moneyNumber(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);
const currentYear = () => String(new Date().getFullYear());
const localDate = (value: string) => new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "medium" });
const paymentLabel = (language: Language, value: Sale["paymentMethod"]) => t(language, value);
const statusLabel = (language: Language, value: Sale["status"]) => value === "completed" ? t(language, "completed") : t(language, "voided");
const periodMatches = (sale: Sale, period: Period, target: string) => {
  const date = sale.createdAt.slice(0, 10);
  if (period === "all") return true;
  if (period === "day") return date === target;
  if (period === "month") return date.startsWith(target);
  if (period === "year") return date.startsWith(target);
  return true;
};

const pageButtons = (pageCount: number, safePage: number) => Array.from({ length: pageCount }, (_, i) => i + 1)
  .filter(n => pageCount <= 7 || Math.abs(n - safePage) <= 2 || n === 1 || n === pageCount);

export function SalesHistoryScreenV2({ repo, staff, shift, settings, language }: { repo: PosRepository; staff: Staff; shift: Shift; settings: AppSettings; language: Language }) {
  const [rows, setRows] = useState<Sale[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [voiding, setVoiding] = useState<Sale | null>(null);
  const [period, setPeriod] = useState<Period>("day");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [date, setDate] = useState(today());
  const [month, setMonth] = useState(currentMonth());
  const [year, setYear] = useState(currentYear());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await repo.listSales(2000, { status: "all" }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const target = period === "day" ? date : period === "month" ? month : year;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(s => {
      const periodOk = periodMatches(s, period, target);
      const statusOk = status === "all" || s.status === status;
      const text = `${s.receiptNo} ${s.cashierName || ""} ${s.employeeCode || ""} ${s.paymentMethod} ${s.status}`.toLowerCase();
      return periodOk && statusOk && (!q || text.includes(q));
    });
  }, [rows, period, target, status, query]);

  const completed = filtered.filter(s => s.status === "completed");
  const cancelled = filtered.filter(s => s.status === "cancelled");
  const totalSales = completed.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const cancelledValue = cancelled.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);
  const pages = pageButtons(pageCount, safePage);

  useEffect(() => { setPage(1); }, [period, date, month, year, status, query, pageSize]);

  const Pager = () => <div className="sales-history-pages">
    <button disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>ก่อนหน้า</button>
    {pages.map((n, i) => <button key={`${n}-${i}`} className={n === safePage ? "active" : ""} onClick={() => setPage(n)}>{n}</button>)}
    <button disabled={safePage >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>ถัดไป</button>
  </div>;

  return <section className="panel sales-history-page">
    <div className="sales-history-toolbar">
      <div className="sales-history-title">
        <h1>{t(language, "history")}</h1>
        <p>ดูรายการขายรายวัน รายเดือน รายปี พร้อมใบเสร็จ ยกเลิกบิล และแบ่งหน้าเมื่อรายการเยอะ</p>
      </div>
      <div className="sales-history-summary-cards">
        <div className="sales-history-card"><span>ยอดขายสุทธิ</span><strong>{money(totalSales)}</strong></div>
        <div className="sales-history-card"><span>จำนวนบิล</span><strong>{completed.length}</strong></div>
        <div className="sales-history-card"><span>บิลยกเลิก</span><strong>{cancelled.length}</strong></div>
        <div className="sales-history-card"><span>มูลค่ายกเลิก</span><strong>{money(cancelledValue)}</strong></div>
      </div>
    </div>

    <div className="sales-history-periods">
      <button className={period === "day" ? "active" : ""} onClick={() => setPeriod("day")}>รายวัน</button>
      <button className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>รายเดือน</button>
      <button className={period === "year" ? "active" : ""} onClick={() => setPeriod("year")}>รายปี</button>
      <button className={period === "all" ? "active" : ""} onClick={() => setPeriod("all")}>ทั้งหมด</button>
    </div>

    <div className="sales-history-filters">
      <label>ค้นหาเลขบิล / แคชเชียร์ / วิธีชำระ<input value={query} onChange={e => setQuery(e.target.value)} placeholder="เช่น R03375664 หรือ เงินสด" /></label>
      {period === "day" && <label>วันที่<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>}
      {period === "month" && <label>เดือน<input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>}
      {period === "year" && <label>ปี<input inputMode="numeric" value={year} onChange={e => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>}
      {period === "all" && <label>ช่วงเวลา<input value="ทุกช่วงเวลา" disabled /></label>}
      <label>สถานะ<select value={status} onChange={e => setStatus(e.target.value as StatusFilter)}><option value="all">ทั้งหมด</option><option value="completed">บิลที่ชำระแล้ว</option><option value="cancelled">บิลยกเลิก</option></select></label>
      <label>จำนวนต่อหน้า<select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}><option value="6">6 รายการ</option><option value="8">8 รายการ</option><option value="10">10 รายการ</option><option value="20">20 รายการ</option></select></label>
    </div>

    <div className="sales-history-table-shell">
      <div className="sales-history-table-summary">
        <span>พบ <strong>{filtered.length}</strong> รายการ · แสดง <strong>{pageRows.length}</strong> รายการ</span>
        <div className="sales-history-top-pages"><span>หน้า {safePage} / {pageCount}</span><Pager /></div>
      </div>
      <div className="sales-history-table-wrap">
        <table className="sales-history-table">
          <thead><tr><th>เลขบิล</th><th>วันที่/เวลา</th><th>แคชเชียร์</th><th>วิธีชำระ</th><th>สถานะ</th><th className="sales-history-number">ยอดสุทธิ</th><th className="sales-history-number">รับเงิน</th><th className="sales-history-number">เงินทอน</th><th>จัดการ</th></tr></thead>
          <tbody>{pageRows.map(s => <tr key={s.id}>
            <td className="sales-history-receipt-cell"><strong>{s.receiptNo}</strong><small>{s.employeeCode || "-"}</small></td>
            <td>{localDate(s.createdAt)}</td>
            <td>{s.cashierName || "-"}</td>
            <td>{paymentLabel(language, s.paymentMethod)}</td>
            <td><span className={`badge ${s.status}`}>{statusLabel(language, s.status)}</span></td>
            <td className="sales-history-number"><strong>{money(s.total)}</strong></td>
            <td className="sales-history-number">{money(s.paid)}</td>
            <td className="sales-history-number">{money(s.changeAmount)}</td>
            <td><div className="sales-history-actions"><button className="sales-history-action receipt" onClick={async () => setReceipt(await repo.getReceipt(s.id))}>ใบเสร็จ</button>{s.status === "completed" ? <button className="sales-history-action void" onClick={() => setVoiding(s)}>ยกเลิกบิล</button> : <button className="sales-history-action voided" disabled>ยกเลิกแล้ว</button>}</div></td>
          </tr>)}</tbody>
        </table>
        {!pageRows.length && <EmptyState text={loading ? "กำลังโหลดรายการขาย..." : t(language, "empty")} />}
      </div>
    </div>

    <div className="sales-history-pagination">
      <span>แสดง {filtered.length ? start + 1 : 0}-{Math.min(start + pageSize, filtered.length)} จาก {filtered.length} รายการ</span>
      <Pager />
    </div>

    {receipt && <ReceiptDialog receipt={receipt} language={language} onClose={() => setReceipt(null)} />}
    {voiding && <VoidSaleDialog repo={repo} sale={voiding} staff={staff} shift={shift} settings={settings} language={language} onClose={() => setVoiding(null)} onDone={async () => { setVoiding(null); await load(); }} />}
  </section>;
}

function VoidSaleDialog({ repo, sale, staff, shift, settings, language, onClose, onDone }: { repo: PosRepository; sale: Sale; staff: Staff; shift: Shift; settings: AppSettings; language: Language; onClose: () => void; onDone: () => Promise<void> | void }) {
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    try {
      setBusy(true);
      setError("");
      await repo.voidSale({ saleId: sale.id, pin, reason, restock, staff, shift, deviceId: settings.deviceId });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ยกเลิกบิลไม่สำเร็จ");
      setBusy(false);
    }
  };
  return <Modal title={`ยกเลิกบิล ${sale.receiptNo}`} onClose={busy ? () => {} : onClose}>
    <div className="sales-void-box">
      <div className="sales-void-warning"><strong>ยืนยันการยกเลิกบิล</strong><p>ต้องใช้ PIN ผู้จัดการหรือเจ้าของร้าน ระบบจะบันทึกเหตุผลและสถานะ VOID ไว้ในประวัติย้อนหลัง</p></div>
      <div className="sales-void-meta"><div><span>เลขบิล</span><strong>{sale.receiptNo}</strong></div><div><span>ยอดสุทธิ</span><strong>{money(sale.total)}</strong></div><div><span>วิธีชำระ</span><strong>{paymentLabel(language, sale.paymentMethod)}</strong></div></div>
      <label>PIN ผู้อนุมัติ<input value={pin} onChange={e => setPin(e.target.value)} autoFocus /></label>
      <label>เหตุผล<input value={reason} onChange={e => setReason(e.target.value)} placeholder="เช่น ลูกค้าขอยกเลิก / ยิงสินค้าผิด" /></label>
      <label className="inline-check"><input type="checkbox" checked={restock} onChange={e => setRestock(e.target.checked)} />คืนสินค้าเข้าสต็อก</label>
      {error && <ErrorMessage text={error} />}
      <div className="actions modal-footer"><button className="secondary" disabled={busy} onClick={onClose}>{t(language, "back")}</button><button className="danger" disabled={busy || !pin || !reason} onClick={() => void submit()}>{busy ? t(language, "submitBusy") : "ยืนยันยกเลิกบิล"}</button></div>
    </div>
  </Modal>;
}

function ReceiptDialog({ receipt, language, onClose }: { receipt: Receipt; language: Language; onClose: () => void }) {
  const subtotal = receipt.subtotal ?? moneyNumber(receipt.items.reduce((sum, item) => sum + Math.max(0, Number(item.lineTotal || 0)), 0));
  const discountAmount = receipt.discountAmount ?? moneyNumber(Math.max(0, subtotal - Number(receipt.total || 0)));
  const logoSrc = receipt.settings.storeLogoPath || SYSTEM_LOGO;
  const printerWidth = receipt.settings.printerPaperWidthMm || "80";
  const print80 = () => { void printReceiptNative(receipt); };
  return <Modal title={`ใบเสร็จ ${receipt.receiptNo}`} onClose={onClose} className="sales-history-receipt-modal">
    <div className="history-receipt-preview-shell">
      <div className="history-receipt-paper" data-paper-mm={printerWidth}>
        <div className="history-receipt-logo"><img src={logoSrc} alt="โลโก้ใบเสร็จ" onError={e => { e.currentTarget.src = SYSTEM_LOGO; }} /></div>
        <h2>{receipt.settings.receiptHeader || receipt.settings.storeName}</h2>
        <p>{receipt.settings.branchName}</p>
        {receipt.settings.address && <p>{receipt.settings.address}</p>}
        {receipt.settings.phone && <p>โทร {receipt.settings.phone}</p>}
        {receipt.settings.taxId && <p>เลขประจำตัวผู้เสียภาษี {receipt.settings.taxId}</p>}
        <div className="history-receipt-meta"><span>เลขที่ {receipt.receiptNo}</span><span>{localDate(receipt.createdAt)}</span><span>พนักงาน {receipt.cashierName || "-"}</span></div>
        <div className="history-receipt-rule" />
        <div className="history-receipt-items">{receipt.items.map((item, index) => <ReceiptItemRow item={item} key={`${item.id || item.name}-${index}`} />)}</div>
        <div className="history-receipt-rule" />
        {discountAmount > 0 && <div className="history-receipt-line"><span>ยอดสินค้า</span><strong>{money(subtotal)}</strong></div>}
        {discountAmount > 0 && <div className="history-receipt-line discount"><span>ส่วนลด{receipt.discountType === "percent" && receipt.discountValue ? ` (${receipt.discountValue}%)` : ""}</span><strong>−{money(discountAmount)}</strong></div>}
        <div className="history-receipt-total"><span>ยอดสุทธิ</span><strong>{money(receipt.total)}</strong></div>
        <div className="history-receipt-payment"><div><span>ชำระโดย</span><strong>{paymentLabel(language, receipt.paymentMethod)}</strong></div><div><span>รับเงิน</span><strong>{money(receipt.paid)}</strong></div><div><span>เงินทอน</span><strong>{money(receipt.changeAmount)}</strong></div></div>
        {receipt.status === "cancelled" && <div className="history-receipt-void"><strong>VOID</strong><span>{receipt.cancelledReason || "บิลนี้ถูกยกเลิกแล้ว"}</span></div>}
        {receipt.settings.receiptFooter && <p className="history-receipt-footer">{receipt.settings.receiptFooter}</p>}
      </div>
    </div>
    <div className="history-receipt-actions"><button className="secondary" onClick={onClose}>ปิด</button><button onClick={print80}>พิมพ์ใบเสร็จ 80mm</button></div>
  </Modal>;
}

function ReceiptItemRow({ item }: { item: SaleItem }) {
  return <div className="history-receipt-item">
    <div><strong>{item.name}</strong><span>{item.quantity} × {money(item.unitPrice)}</span></div>
    <strong>{money(item.lineTotal)}</strong>
  </div>;
}

function EmptyState({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }
function ErrorMessage({ text }: { text: string }) { return <p className="error-message">{text}</p>; }
function Modal({ title, children, onClose, className = "" }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onClose]);
  return <div className="modal-backdrop"><section className={`modal ${className}`}><header><h2>{title}</h2><button onClick={onClose}>×</button></header>{children}</section></div>;
}
