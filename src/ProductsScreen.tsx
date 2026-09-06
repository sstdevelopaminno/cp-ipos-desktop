import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import type { PosRepository, ProductInput } from "./data/repository";
import type { Language, Product, Staff } from "./domain/types";
import { productName, t } from "./i18n";
import { BarcodeLabelPreview, BarcodePrintModal } from "./BarcodeLabels";
import "./inventory-bulk-ui.css";

type StockStatus = "all" | "normal" | "low" | "out";
type LowStockNotifier = (products: Product[], language: Language) => Promise<void>;
type BulkProductRow = ProductInput & { rowId: string; selected: boolean; error: string };

const money = (n: number) => `฿${Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const units = ["ชิ้น", "ขวด", "กระป๋อง", "ถุง", "กล่อง", "แพ็ค", "ลัง", "kg", "g", "liter", "ml"];
const emptyProduct = (barcode = ""): ProductInput => ({ productCode: "", barcode, nameTh: "", nameEn: "", categoryId: "retail", categoryName: "ค้าปลีก", price: 0, cost: 0, unit: "ชิ้น", stockQuantity: 0, minimumStock: 0, quantityScale: 1, imagePath: "", active: true });
const LOW_STOCK_NOTICE_KEY = "cpipos.inventory.lowStock.notice";

const lowStockProducts = (products: Product[]) => products.filter(p => p.active !== false && (p.stockQuantity <= 0 || (p.minimumStock > 0 && p.stockQuantity <= p.minimumStock)));
const lowStockBody = (products: Product[], language: Language) => {
  const names = products.slice(0, 4).map(p => `${productName(language, p)} เหลือ ${p.stockQuantity} ${p.unit}`).join(" · ");
  return products.length ? `มีสินค้าใกล้หมด/หมด ${products.length} รายการ${names ? `: ${names}` : ""}` : "";
};
const makeBulkRow = (index: number, patch: Partial<ProductInput> = {}): BulkProductRow => ({
  ...emptyProduct(),
  rowId: `bulk-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
  selected: true,
  error: "",
  ...patch,
});
const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[\s_\-/.]+/g, "");
const cell = (row: string[], index: number) => (row[index] || "").trim();
const numberCell = (value: string) => Number(value.replace(/,/g, "") || 0);

const splitDelimitedLine = (line: string, delimiter: string) => {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
};

const parseDelimitedProducts = (text: string): Partial<ProductInput>[] => {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines.some(line => line.includes("\t")) ? "\t" : ",";
  const rows = lines.map(line => splitDelimitedLine(line, delimiter));
  const first = rows[0].map(normalizeHeader);
  const hasHeader = first.some(h => ["productcode", "sku", "barcode", "บาร์โค้ด", "รหัสสินค้า", "name", "nameth", "ชื่อสินค้า", "ราคา", "price"].includes(h));
  const header = hasHeader ? first : [];
  const body = hasHeader ? rows.slice(1) : rows;
  const findIndex = (...names: string[]) => header.findIndex(h => names.map(normalizeHeader).includes(h));
  const indices = {
    productCode: hasHeader ? findIndex("productCode", "sku", "รหัสสินค้า") : 0,
    barcode: hasHeader ? findIndex("barcode", "บาร์โค้ด") : 1,
    nameTh: hasHeader ? findIndex("nameTh", "name", "ชื่อสินค้า", "สินค้า") : 2,
    categoryName: hasHeader ? findIndex("category", "categoryName", "หมวดหมู่") : 3,
    price: hasHeader ? findIndex("price", "ราคาขาย", "ราคา") : 4,
    cost: hasHeader ? findIndex("cost", "ต้นทุน") : 5,
    stockQuantity: hasHeader ? findIndex("stock", "stockQuantity", "คงเหลือ", "จำนวน") : 6,
    minimumStock: hasHeader ? findIndex("minimumStock", "minStock", "แจ้งเตือน") : 7,
    unit: hasHeader ? findIndex("unit", "หน่วย") : 8,
  };
  return body.map(row => {
    const productCode = indices.productCode >= 0 ? cell(row, indices.productCode) : "";
    const barcode = indices.barcode >= 0 ? cell(row, indices.barcode) : "";
    const nameTh = indices.nameTh >= 0 ? cell(row, indices.nameTh) : "";
    const categoryName = indices.categoryName >= 0 ? cell(row, indices.categoryName) : "ค้าปลีก";
    return {
      productCode,
      barcode,
      nameTh,
      categoryName: categoryName || "ค้าปลีก",
      categoryId: (categoryName || "ค้าปลีก").toLowerCase().replace(/\s+/g, "-") || "retail",
      price: indices.price >= 0 ? numberCell(cell(row, indices.price)) : 0,
      cost: indices.cost >= 0 ? numberCell(cell(row, indices.cost)) : 0,
      stockQuantity: indices.stockQuantity >= 0 ? numberCell(cell(row, indices.stockQuantity)) : 0,
      minimumStock: indices.minimumStock >= 0 ? numberCell(cell(row, indices.minimumStock)) : 0,
      unit: indices.unit >= 0 ? cell(row, indices.unit) || "ชิ้น" : "ชิ้น",
    };
  });
};

export function ProductsScreenV2({ repo, staff, products, language, refreshProducts, requestStockNotification }: { repo: PosRepository; staff: Staff; products: Product[]; language: Language; refreshProducts: () => Promise<void>; requestStockNotification?: LowStockNotifier }) {
  const [editing, setEditing] = useState<Product | ProductInput | null>(null);
  const [stockFor, setStockFor] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [barcodeFor, setBarcodeFor] = useState<Product | null>(null);
  const [barcodeBatchOpen, setBarcodeBatchOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StockStatus>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const liveProducts = products.filter(p => p.active !== false);
  const lowItems = useMemo(() => lowStockProducts(liveProducts), [liveProducts]);
  const printableProducts = liveProducts.filter(p => !!(p.barcode || p.productCode));
  const q = query.trim().toLowerCase();
  const filtered = liveProducts.filter(p => {
    const haystack = `${productName(language, p)} ${p.nameTh || ""} ${p.nameEn || ""} ${p.productCode} ${p.barcode || ""} ${p.categoryName}`.toLowerCase();
    const statusOk = status === "all" || stockClass(p) === status;
    return statusOk && (!q || haystack.includes(q));
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);
  const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1).filter(n => pageCount <= 7 || Math.abs(n - safePage) <= 2 || n === 1 || n === pageCount);
  const stockNotice = lowStockBody(lowItems, language);

  useEffect(() => { setPage(1); }, [query, status, products.length, pageSize]);
  useEffect(() => {
    if (!requestStockNotification || !lowItems.length) return;
    const signature = lowItems.map(p => `${p.id}:${p.stockQuantity}:${p.minimumStock}`).join("|");
    if (localStorage.getItem(LOW_STOCK_NOTICE_KEY) === signature) return;
    localStorage.setItem(LOW_STOCK_NOTICE_KEY, signature);
    void requestStockNotification(lowItems, language);
  }, [lowItems, language, requestStockNotification]);

  const Pager = () => <div className="inventory-pages"><button disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>ก่อนหน้า</button>{pageNumbers.map((n, i) => <button key={`${n}-${i}`} className={n === safePage ? "active" : ""} onClick={() => setPage(n)}>{n}</button>)}<button disabled={safePage >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>ถัดไป</button></div>;

  return <section className="panel inventory-page inventory-page-v2">
    <div className="inventory-toolbar">
      <div><h1>{t(language, "products")}</h1><p>จัดการสินค้าแบบตาราง แก้ไข ลบ ปรับยอด พิมพ์บาร์โค้ด เพิ่มหลายรายการ และแบ่งหน้าเมื่อรายการเยอะ</p></div>
      <div className="inventory-toolbar-actions"><button className="inventory-secondary" onClick={() => setBulkOpen(true)}>เพิ่มหลายรายการ</button><button className="inventory-secondary" disabled={!printableProducts.length} onClick={() => setBarcodeBatchOpen(true)}>พิมพ์บาร์โค้ด</button><button className="inventory-primary" onClick={() => setEditing(emptyProduct())}>{t(language, "addProduct")}</button></div>
    </div>
    <div className="inventory-filters">
      <label>ค้นหาสินค้า / SKU / บาร์โค้ด<input value={query} onChange={e => setQuery(e.target.value)} placeholder="พิมพ์ชื่อสินค้า รหัสสินค้า หรือบาร์โค้ด" /></label>
      <label>สถานะสต๊อก<select value={status} onChange={e => setStatus(e.target.value as StockStatus)}><option value="all">ทั้งหมด</option><option value="normal">ปกติ</option><option value="low">ใกล้หมด</option><option value="out">หมด</option></select></label>
      <label>จำนวนต่อหน้า<select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}><option value="6">6 รายการ</option><option value="8">8 รายการ</option><option value="10">10 รายการ</option><option value="20">20 รายการ</option></select></label>
    </div>
    {lowItems.length > 0 && <div className="inventory-low-stock-alert" role="status" aria-live="polite"><div><strong>แจ้งเตือนสต็อกต่ำ</strong><span>{stockNotice}</span></div><div><button onClick={() => setStatus("low")}>ดูใกล้หมด</button><button onClick={() => setStatus("out")}>ดูสินค้าหมด</button></div></div>}
    <div className="inventory-table-shell">
      <div className="inventory-table-summary"><span>ทั้งหมด <strong>{liveProducts.length}</strong> รายการ · พบ <strong>{filtered.length}</strong> รายการ · แสดง <strong>{pageRows.length}</strong> รายการ</span><div className="inventory-top-pages"><span>หน้า {safePage} / {pageCount}</span><Pager /></div></div>
      <div className="inventory-table-wrap inventory-scroll-fix">
        <table className="inventory-table barcode-inventory-table">
          <thead><tr><th>สินค้า</th><th>รหัสสินค้า</th><th>บาร์โค้ด</th><th>หมวดหมู่</th><th className="inventory-number">ราคาขาย</th><th className="inventory-number">ต้นทุน</th><th className="inventory-number">คงเหลือ</th><th className="inventory-number">แจ้งเตือน</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
          <tbody>{pageRows.map(p => <tr key={p.id}>
            <td><div className="inventory-product-cell"><div className="inventory-product-thumb">{p.imagePath ? <img src={p.imagePath} alt="" /> : productName(language, p).slice(0, 1)}</div><div className="inventory-product-name"><strong>{productName(language, p)}</strong><small>{p.nameEn || "-"}</small></div></div></td>
            <td><strong>{p.productCode}</strong><small className="inventory-muted">SKU: {p.sku || p.productCode}</small></td>
            <td><BarcodeLabelPreview product={p} /></td>
            <td>{p.categoryName}</td>
            <td className="inventory-number">{money(p.price)}</td>
            <td className="inventory-number">{money(p.cost)}</td>
            <td className="inventory-number"><strong>{p.stockQuantity}</strong> {p.unit}</td>
            <td className="inventory-number">{p.minimumStock} {p.unit}</td>
            <td><span className={`badge ${stockClass(p)}`}>{stockLabel(language, p)}</span></td>
            <td><div className="inventory-actions"><button className="inventory-action stock" onClick={() => setStockFor(p)}>{t(language, "adjustment")}</button><button className="inventory-action barcode" onClick={() => setBarcodeFor(p)}>พิมพ์บาร์โค้ด</button><button className="inventory-action edit" onClick={() => setEditing(p)}>{t(language, "edit")}</button><button className="inventory-action delete" onClick={() => setDeleting(p)}>ลบ</button></div></td>
          </tr>)}</tbody>
        </table>
        {!pageRows.length && <EmptyState text={t(language, "empty")} />}
      </div>
    </div>
    <div className="inventory-pagination">
      <span>แสดง {filtered.length ? start + 1 : 0}-{Math.min(start + pageSize, filtered.length)} จาก {filtered.length} รายการ</span>
      <Pager />
    </div>
    {bulkOpen && <BulkProductImportModal repo={repo} staff={staff} products={products} language={language} onClose={() => setBulkOpen(false)} onDone={async () => { setBulkOpen(false); await refreshProducts(); }} />}
    {barcodeBatchOpen && <BarcodePrintModal products={printableProducts} language={language} onClose={() => setBarcodeBatchOpen(false)} />}
    {barcodeFor && <BarcodePrintModal products={printableProducts} language={language} initialProduct={barcodeFor} onClose={() => setBarcodeFor(null)} />}
    {editing && <ProductModal repo={repo} staff={staff} language={language} product={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refreshProducts(); }} />}
    {stockFor && <StockModal repo={repo} staff={staff} product={stockFor} language={language} onClose={() => setStockFor(null)} onDone={async () => { setStockFor(null); await refreshProducts(); }} />}
    {deleting && <DeleteProductModal repo={repo} staff={staff} product={deleting} language={language} onClose={() => setDeleting(null)} onDone={async () => { setDeleting(null); await refreshProducts(); }} />}
  </section>;
}

function BulkProductImportModal({ repo, staff, products, language, onClose, onDone }: { repo: PosRepository; staff: Staff; products: Product[]; language: Language; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<BulkProductRow[]>(() => Array.from({ length: 5 }, (_, index) => makeBulkRow(index)));
  const [rowCount, setRowCount] = useState(5);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const existingCodes = useMemo(() => new Set(products.map(product => product.productCode.trim().toLowerCase()).filter(Boolean)), [products]);
  const existingBarcodes = useMemo(() => new Set(products.map(product => (product.barcode || "").trim().toLowerCase()).filter(Boolean)), [products]);
  const selectedRows = rows.filter(row => row.selected);

  const resizeRows = (nextCount: number) => {
    const safeCount = Math.max(1, Math.min(200, nextCount || 1));
    setRowCount(safeCount);
    setRows(current => {
      if (safeCount === current.length) return current;
      if (safeCount < current.length) return current.slice(0, safeCount);
      return [...current, ...Array.from({ length: safeCount - current.length }, (_, index) => makeBulkRow(current.length + index))];
    });
  };
  const updateRow = (rowId: string, patch: Partial<BulkProductRow>) => setRows(current => current.map(row => row.rowId === rowId ? { ...row, ...patch, error: "" } : row));
  const applyParsedRows = (items: Partial<ProductInput>[]) => {
    if (!items.length) return;
    const mapped = items.map((item, index) => makeBulkRow(index, item));
    setRows(mapped);
    setRowCount(mapped.length);
    setMessage(`นำเข้าข้อมูลจากไฟล์/ข้อความ ${mapped.length} รายการแล้ว กรุณาตรวจสอบก่อนบันทึก`);
  };
  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setAttachments(files);
    const parseable = files.find(file => /\.(csv|tsv|txt)$/i.test(file.name));
    if (!parseable) {
      setMessage("แนบไฟล์แล้ว: รองรับ CSV/TSV/TXT สำหรับอ่านเข้าตารางทันที ส่วน Excel/PDF แนบไว้เป็นเอกสารประกอบก่อน รอบถัดไปค่อยเพิ่มตัวแปลงไฟล์เต็มระบบ");
      return;
    }
    const text = await parseable.text();
    applyParsedRows(parseDelimitedProducts(text));
  };
  const pasteIntoRows = () => applyParsedRows(parseDelimitedProducts(pasteText));
  const validateRows = () => {
    const localCodes = new Set<string>();
    const localBarcodes = new Set<string>();
    let ok = true;
    const checked = rows.map(row => {
      if (!row.selected) return { ...row, error: "" };
      const productCode = row.productCode.trim().toLowerCase();
      const barcode = (row.barcode || "").trim().toLowerCase();
      let error = "";
      if (!row.productCode.trim()) error = "ต้องใส่รหัสสินค้า";
      else if (!row.nameTh.trim()) error = "ต้องใส่ชื่อสินค้า";
      else if (Number(row.price) < 0 || Number.isNaN(Number(row.price))) error = "ราคาขายไม่ถูกต้อง";
      else if (existingCodes.has(productCode)) error = "รหัสสินค้าซ้ำกับสินค้าที่มีอยู่";
      else if (localCodes.has(productCode)) error = "รหัสสินค้าซ้ำในตารางนี้";
      else if (barcode && existingBarcodes.has(barcode)) error = "บาร์โค้ดซ้ำกับสินค้าที่มีอยู่";
      else if (barcode && localBarcodes.has(barcode)) error = "บาร์โค้ดซ้ำในตารางนี้";
      if (productCode) localCodes.add(productCode);
      if (barcode) localBarcodes.add(barcode);
      if (error) ok = false;
      return { ...row, error };
    });
    setRows(checked);
    return ok;
  };
  const submit = async () => {
    if (!selectedRows.length) {
      setMessage("กรุณาติ๊กเลือกรายการที่ต้องการบันทึกก่อน");
      return;
    }
    if (!validateRows()) {
      setMessage("มีข้อมูลบางแถวไม่ถูกต้อง กรุณาตรวจสอบข้อความสีแดงในตาราง");
      return;
    }
    setBusy(true);
    try {
      for (const row of selectedRows) {
        await repo.createProduct({
          productCode: row.productCode.trim(),
          barcode: (row.barcode || "").trim(),
          nameTh: row.nameTh.trim(),
          nameEn: row.nameEn || "",
          categoryId: row.categoryId || row.categoryName.toLowerCase().replace(/\s+/g, "-") || "retail",
          categoryName: row.categoryName || "ค้าปลีก",
          price: Number(row.price || 0),
          cost: Number(row.cost || 0),
          unit: row.unit || "ชิ้น",
          stockQuantity: Number(row.stockQuantity || 0),
          minimumStock: Number(row.minimumStock || 0),
          quantityScale: Number(row.quantityScale || 1),
          imagePath: row.imagePath || "",
          active: row.active !== false,
        }, staff);
      }
      onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "บันทึกสินค้าหลายรายการไม่สำเร็จ");
      setBusy(false);
    }
  };

  return <Modal title="เพิ่มสินค้าหลายรายการ" onClose={busy ? () => {} : onClose}>
    <div className="bulk-product-modal">
      <div className="bulk-product-topline">
        <label>จำนวนรายการในตาราง<input type="number" min="1" max="200" value={rowCount} onChange={event => resizeRows(Number(event.target.value))} /></label>
        <label>แนบไฟล์ PDF / Excel / CSV / TXT<input type="file" multiple accept=".pdf,.xls,.xlsx,.csv,.tsv,.txt,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain" onChange={event => void handleFiles(event)} /></label>
      </div>
      {!!attachments.length && <div className="bulk-attachments"><strong>ไฟล์แนบ:</strong>{attachments.map(file => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}</div>}
      <details className="bulk-paste-box"><summary>วางข้อมูลจาก Excel/CSV</summary><textarea value={pasteText} onChange={event => setPasteText(event.target.value)} placeholder="วางข้อมูลตามลำดับ: รหัสสินค้า, บาร์โค้ด, ชื่อสินค้า, หมวดหมู่, ราคาขาย, ต้นทุน, จำนวน, แจ้งเตือน, หน่วย" /><button type="button" onClick={pasteIntoRows}>แปลงข้อความเป็นตาราง</button></details>
      <div className="bulk-product-table-wrap">
        <table className="bulk-product-table">
          <thead><tr><th><input type="checkbox" checked={rows.length > 0 && rows.every(row => row.selected)} onChange={event => setRows(current => current.map(row => ({ ...row, selected: event.target.checked })))} /></th><th>#</th><th>รหัสสินค้า</th><th>บาร์โค้ด</th><th>ชื่อสินค้า</th><th>หมวดหมู่</th><th>ราคา</th><th>ต้นทุน</th><th>จำนวน</th><th>แจ้งเตือน</th><th>หน่วย</th><th>สถานะ</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.rowId} className={row.error ? "has-error" : ""}>
            <td><input type="checkbox" checked={row.selected} onChange={event => updateRow(row.rowId, { selected: event.target.checked })} /></td>
            <td>{index + 1}</td>
            <td><input value={row.productCode} onChange={event => updateRow(row.rowId, { productCode: event.target.value })} /></td>
            <td><input value={row.barcode || ""} onChange={event => updateRow(row.rowId, { barcode: event.target.value })} /></td>
            <td><input value={row.nameTh} onChange={event => updateRow(row.rowId, { nameTh: event.target.value })} /></td>
            <td><input value={row.categoryName} onChange={event => updateRow(row.rowId, { categoryName: event.target.value, categoryId: event.target.value.toLowerCase().replace(/\s+/g, "-") || "retail" })} /></td>
            <td><input type="number" value={row.price} onChange={event => updateRow(row.rowId, { price: Number(event.target.value) })} /></td>
            <td><input type="number" value={row.cost} onChange={event => updateRow(row.rowId, { cost: Number(event.target.value) })} /></td>
            <td><input type="number" step="0.001" value={row.stockQuantity} onChange={event => updateRow(row.rowId, { stockQuantity: Number(event.target.value) })} /></td>
            <td><input type="number" step="0.001" value={row.minimumStock} onChange={event => updateRow(row.rowId, { minimumStock: Number(event.target.value) })} /></td>
            <td><select value={row.unit} onChange={event => updateRow(row.rowId, { unit: event.target.value })}>{units.map(unit => <option key={unit}>{unit}</option>)}</select></td>
            <td>{row.error ? <span className="bulk-error-text">{row.error}</span> : <span className="bulk-ok-text">พร้อม</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {message && <p className="bulk-message">{message}</p>}
      <div className="actions modal-footer"><button className="secondary" disabled={busy} onClick={onClose}>{t(language, "back")}</button><button disabled={busy || !selectedRows.length} onClick={() => void submit()}>{busy ? t(language, "submitBusy") : `บันทึก ${selectedRows.length} รายการ`}</button></div>
    </div>
  </Modal>;
}

function DeleteProductModal({ repo, staff, product, language, onClose, onDone }: { repo: PosRepository; staff: Staff; product: Product; language: Language; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    try {
      setBusy(true);
      setError("");
      await repo.updateProduct({ ...product, active: false }, staff);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ลบสินค้าไม่สำเร็จ");
      setBusy(false);
    }
  };
  return <Modal title="ยืนยันลบสินค้า" onClose={busy ? () => {} : onClose}>
    <div className="inventory-delete-box">
      <div className="inventory-delete-warning"><strong>ต้องการลบสินค้านี้ใช่หรือไม่?</strong><p>ระบบจะซ่อนสินค้าออกจากหน้าขายและตารางสินค้า แต่ประวัติการขายเดิมจะยังคงอยู่เพื่อความถูกต้องของรายงานย้อนหลัง</p></div>
      <div className="inventory-delete-product"><div className="inventory-product-thumb">{product.imagePath ? <img src={product.imagePath} alt="" /> : productName(language, product).slice(0, 1)}</div><div><strong>{productName(language, product)}</strong><small>{product.productCode} · {product.barcode || "-"}</small><small>{money(product.price)} · คงเหลือ {product.stockQuantity} {product.unit}</small></div></div>
      {error && <ErrorMessage text={error} />}
      <div className="actions modal-footer"><button className="secondary" disabled={busy} onClick={onClose}>{t(language, "back")}</button><button className="danger" disabled={busy} onClick={() => void submit()}>{busy ? t(language, "submitBusy") : "ยืนยันลบ"}</button></div>
    </div>
  </Modal>;
}

function ProductModal({ repo, staff, language, product, onClose, onSaved }: { repo: PosRepository; staff: Staff; language: Language; product: Product | ProductInput; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Product | ProductInput>({ ...product });
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof ProductInput, value: string | number | boolean) => setForm(f => ({ ...f, [key]: value }));
  const checkBarcode = async () => { const code = (form.barcode || "").trim(); if (!code) return; const found = await repo.findProductByBarcode(code); if (found && found.id !== ('id' in form ? form.id : undefined)) setDuplicate(found); else setDuplicate(null); };
  const save = async () => { try { setBusy(true); setError(""); if (duplicate) throw new Error(t(language, "duplicateBarcode")); if (!form.productCode) { setError(t(language, "duplicateCode")); setBusy(false); return; } if (!form.nameTh) { setError(t(language, "nameTh")); setBusy(false); return; } if ('id' in form && form.id) await repo.updateProduct(form as Product, staff); else await repo.createProduct(form as ProductInput, staff); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); } };
  return <Modal title={'id' in form && form.id ? t(language, "edit") : t(language, "addProduct")} onClose={busy ? () => {} : onClose}><fieldset><legend>{t(language, "productInfo")}</legend><div className="form-grid"><label>{t(language, "productCode")}<input value={form.productCode} onChange={e => set("productCode", e.target.value)} /></label><label>{t(language, "barcode")}<input value={form.barcode || ""} onBlur={() => void checkBarcode()} onKeyDown={e => { if (e.key === "Enter") void checkBarcode(); }} onChange={e => { set("barcode", e.target.value); setDuplicate(null); }} /></label><label>{t(language, "nameTh")}<input value={form.nameTh} onChange={e => set("nameTh", e.target.value)} /></label><label>{t(language, "nameEn")}<input value={form.nameEn || ""} onChange={e => set("nameEn", e.target.value)} /></label><label>{t(language, "category")}<input value={form.categoryName} onChange={e => { set("categoryName", e.target.value); set("categoryId", e.target.value.toLowerCase().replace(/\s+/g, "-") || "retail"); }} /></label><label>{t(language, "active")}<select value={form.active === false ? "0" : "1"} onChange={e => set("active", e.target.value === "1")}><option value="1">{t(language, "active")}</option><option value="0">{t(language, "inactive")}</option></select></label></div></fieldset><fieldset><legend>{t(language, "pricing")}</legend><div className="form-grid"><label>{t(language, "price")}<input type="number" value={form.price} onChange={e => set("price", Number(e.target.value))} /></label><label>{t(language, "cost")}<input type="number" value={form.cost} onChange={e => set("cost", Number(e.target.value))} /></label></div></fieldset><fieldset><legend>{t(language, "stockSection")}</legend><div className="form-grid"><label>{t(language, "stock")}<input type="number" step="0.001" value={form.stockQuantity} onChange={e => set("stockQuantity", Number(e.target.value))} /></label><label>{t(language, "unit")}<select value={form.unit} onChange={e => set("unit", e.target.value)}>{units.map(u => <option key={u}>{u}</option>)}</select></label><label>{t(language, "minStock")}<input type="number" step="0.001" value={form.minimumStock} onChange={e => set("minimumStock", Number(e.target.value))} /></label></div></fieldset>{duplicate && <p className="warning">{t(language, "duplicateBarcode")}: {duplicate.productCode} {productName(language, duplicate)} <button onClick={() => { setForm(duplicate); setDuplicate(null); }}>{t(language, "openExisting")}</button></p>}{error && <ErrorMessage text={error} />}<div className="actions modal-footer"><button className="secondary" disabled={busy} onClick={onClose}>{t(language, "back")}</button><button disabled={busy || !!duplicate} onClick={() => void save()}>{busy ? t(language, "submitBusy") : t(language, "save")}</button></div></Modal>;
}

function StockModal({ repo, staff, product, language, onClose, onDone }: { repo: PosRepository; staff: Staff; product: Product; language: Language; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<"STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT">("STOCK_IN");
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return <Modal title={`${t(language, "stockSection")} · ${productName(language, product)}`} onClose={busy ? () => {} : onClose}><div className="form-grid"><label>{t(language, "status")}<select value={type} onChange={e => setType(e.target.value as typeof type)}><option value="STOCK_IN">{t(language, "stockIn")}</option><option value="STOCK_OUT">{t(language, "stockOut")}</option><option value="ADJUSTMENT">{t(language, "adjustment")}</option></select></label><label>{t(language, "amount")}<input type="number" step="0.001" value={amount} onChange={e => setAmount(e.target.value)} /></label></div><label>{t(language, "reason")}<input value={reason} onChange={e => setReason(e.target.value)} /></label><div className="actions"><button disabled={busy || !reason} onClick={async () => { setBusy(true); await repo.applyStockMovement({ productId: product.id, movementType: type, quantity: Number(amount || 0), reason, staff }); onDone(); }}>{busy ? t(language, "submitBusy") : t(language, "save")}</button><button className="secondary" disabled={busy} onClick={onClose}>{t(language, "back")}</button></div></Modal>;
}

function stockClass(p: Product) { return p.stockQuantity <= 0 ? "out" : p.stockQuantity <= p.minimumStock ? "low" : "normal"; }
function stockLabel(language: Language, p: Product) { return p.stockQuantity <= 0 ? t(language, "outOfStock") : p.stockQuantity <= p.minimumStock ? t(language, "lowStock") : t(language, "normal"); }
function EmptyState({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }
function ErrorMessage({ text }: { text: string }) { return <p className="error-message">{text}</p>; }
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) { useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onClose]); return <div className="modal-backdrop"><section className="modal"><header><h2>{title}</h2><button onClick={onClose}>×</button></header>{children}</section></div>; }
