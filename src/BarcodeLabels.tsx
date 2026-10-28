import React, { useMemo, useState } from "react";
import type { Language, Product } from "./domain/types";
import { productName } from "./i18n";
import "./barcode-label-ui.css";

type LabelSizeKey = "small" | "medium" | "large" | "custom";
type BarcodeLabelSize = {
  key: LabelSizeKey;
  label: string;
  widthMm: number;
  heightMm: number;
  description: string;
};

type SelectedItem = Record<string, boolean>;
type CopiesByProduct = Record<string, number>;

const money = (n: number) => `฿${Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const LABEL_SIZES: BarcodeLabelSize[] = [
  { key: "small", label: "เล็ก", widthMm: 32, heightMm: 15, description: "32×15 มม. สำหรับฉลากสั้น" },
  { key: "medium", label: "กลาง", widthMm: 32, heightMm: 25, description: "32×25 มม. / 3.2×2.5 ซม. แกน 1.5 นิ้ว" },
  { key: "large", label: "ใหญ่", widthMm: 50, heightMm: 30, description: "50×30 มม. สำหรับป้ายราคาที่อ่านง่าย" },
  { key: "custom", label: "กำหนดเอง", widthMm: 32, heightMm: 25, description: "กำหนดขนาดเองตามม้วนสติ๊กเกอร์" },
];

const CODE128_PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
];

const cleanBarcodeValue = (value: string) => value.trim().replace(/\s+/g, "");
const safeCode128Value = (value: string) => cleanBarcodeValue(value).replace(/[^\x20-\x7f]/g, "?");

const code128Sequence = (value: string) => {
  const text = safeCode128Value(value);
  const startCodeB = 104;
  const codes = [startCodeB];
  for (const char of text) codes.push(Math.max(0, Math.min(95, char.charCodeAt(0) - 32)));
  const checksum = codes.reduce((sum, code, index) => index === 0 ? code : sum + code * index, 0) % 103;
  return [...codes, checksum, 106];
};

export function BarcodeSvg({ value, height = 46, className = "" }: { value: string; height?: number; className?: string }) {
  const bars = useMemo(() => {
    let x = 10;
    const rects: { x: number; width: number }[] = [];
    for (const code of code128Sequence(value)) {
      const pattern = CODE128_PATTERNS[code] || CODE128_PATTERNS[0];
      pattern.split("").forEach((digit, index) => {
        const width = Number(digit);
        if (index % 2 === 0) rects.push({ x, width });
        x += width;
      });
    }
    return { rects, width: x + 10 };
  }, [value]);

  return <svg className={`barcode-svg ${className}`} viewBox={`0 0 ${bars.width} ${height}`} role="img" aria-label={`บาร์โค้ด ${value}`} preserveAspectRatio="none">
    <rect x="0" y="0" width={bars.width} height={height} fill="#fff" />
    {bars.rects.map((bar, index) => <rect key={`${bar.x}-${index}`} x={bar.x} y="0" width={bar.width} height={height} fill="#111827" />)}
  </svg>;
}

export function BarcodeLabelPreview({ product, compact = false }: { product: Product; compact?: boolean }) {
  const value = product.barcode || product.productCode;
  if (!value) return <span className="barcode-empty">ไม่มีบาร์โค้ด</span>;
  return <div className={compact ? "barcode-mini" : "barcode-cell-preview"}>
    <BarcodeSvg value={value} height={compact ? 34 : 38} />
    <small>{value}</small>
  </div>;
}

function StickerLabel({ product, language, size, showPrice }: { product: Product; language: Language; size: BarcodeLabelSize; showPrice: boolean }) {
  const value = product.barcode || product.productCode;
  return <div className="barcode-sticker-label" style={{ "--label-width-mm": String(size.widthMm), "--label-height-mm": String(size.heightMm) } as React.CSSProperties}>
    <strong>{productName(language, product)}</strong>
    <BarcodeSvg value={value} height={44} className="barcode-sticker-svg" />
    <span>{value}</span>
    {showPrice && <b>{money(product.price)}</b>}
  </div>;
}

export function BarcodePrintModal({ products, language, initialProduct, onClose }: { products: Product[]; language: Language; initialProduct?: Product | null; onClose: () => void }) {
  const printableProducts = useMemo(() => products.filter(product => product.active !== false && !!(product.barcode || product.productCode)), [products]);
  const [step, setStep] = useState<1 | 2 | 3>(initialProduct ? 2 : 1);
  const [selected, setSelected] = useState<SelectedItem>(() => {
    if (initialProduct) return { [initialProduct.id]: true };
    return Object.fromEntries(printableProducts.map(product => [product.id, false]));
  });
  const [copies, setCopies] = useState<CopiesByProduct>(() => Object.fromEntries(printableProducts.map(product => [product.id, initialProduct?.id === product.id ? 1 : 1])));
  const [sizeKey, setSizeKey] = useState<LabelSizeKey>("medium");
  const [customWidth, setCustomWidth] = useState("32");
  const [customHeight, setCustomHeight] = useState("25");
  const [showPrice, setShowPrice] = useState(true);
  const [query, setQuery] = useState("");

  const baseSize = LABEL_SIZES.find(size => size.key === sizeKey) || LABEL_SIZES[1];
  const size: BarcodeLabelSize = sizeKey === "custom" ? { ...baseSize, widthMm: Number(customWidth || 32), heightMm: Number(customHeight || 25), description: `${customWidth || 32}×${customHeight || 25} มม.` } : baseSize;
  const selectedProducts = printableProducts.filter(product => selected[product.id]);
  const q = query.trim().toLowerCase();
  const visibleProducts = printableProducts.filter(product => {
    const text = `${productName(language, product)} ${product.nameTh || ""} ${product.nameEn || ""} ${product.productCode} ${product.sku || ""} ${product.barcode || ""}`.toLowerCase();
    return !q || text.includes(q);
  });
  const allVisibleSelected = visibleProducts.length > 0 && visibleProducts.every(product => selected[product.id]);
  const totalLabels = selectedProducts.reduce((sum, product) => sum + Math.max(1, Number(copies[product.id] || 1)), 0);
  const previewProducts = selectedProducts.flatMap(product => Array.from({ length: Math.min(3, Math.max(1, Number(copies[product.id] || 1))) }, () => product)).slice(0, 24);
  const printProducts = selectedProducts.flatMap(product => Array.from({ length: Math.max(1, Number(copies[product.id] || 1)) }, () => product));

  const toggleVisible = () => {
    const nextValue = !allVisibleSelected;
    setSelected(current => ({ ...current, ...Object.fromEntries(visibleProducts.map(product => [product.id, nextValue])) }));
  };

  const printLabels = () => {
    window.setTimeout(() => window.print(), 30);
  };

  return <div className="barcode-modal-backdrop">
    <section className="barcode-modal" role="dialog" aria-modal="true">
      <header className="barcode-modal-header">
        <div>
          <h2>{initialProduct ? `พิมพ์บาร์โค้ด · ${productName(language, initialProduct)}` : "พิมพ์บาร์โค้ดสินค้า"}</h2>
          <p>เลือกสินค้า กำหนดขนาดสติ๊กเกอร์ และตรวจตัวอย่างก่อนสั่งพิมพ์</p>
        </div>
        <button onClick={onClose}>×</button>
      </header>

      <div className="barcode-steps"><button className={step === 1 ? "active" : ""} onClick={() => setStep(1)}>1 เลือกสินค้า</button><button className={step === 2 ? "active" : ""} onClick={() => setStep(2)}>2 ขนาดสติ๊กเกอร์</button><button className={step === 3 ? "active" : ""} onClick={() => setStep(3)}>3 ตรวจและพิมพ์</button></div>

      {step === 1 && <div className="barcode-step-panel">
        <div className="barcode-select-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ค้นหาชื่อสินค้า / SKU / บาร์โค้ด" /><button onClick={toggleVisible}>{allVisibleSelected ? "ยกเลิกที่เห็น" : "ติ๊กเลือกที่เห็นทั้งหมด"}</button></div>
        <div className="barcode-product-list">
          {visibleProducts.map(product => <label key={product.id} className="barcode-product-row">
            <input type="checkbox" checked={!!selected[product.id]} onChange={event => setSelected(current => ({ ...current, [product.id]: event.target.checked }))} />
            <BarcodeLabelPreview product={product} compact />
            <div><strong>{productName(language, product)}</strong><small>{product.productCode} · {product.barcode || "ไม่มีบาร์โค้ด"}</small></div>
            <span>จำนวนพิมพ์</span>
            <input type="number" min="1" max="999" value={copies[product.id] || 1} onChange={event => setCopies(current => ({ ...current, [product.id]: Math.max(1, Number(event.target.value || 1)) }))} />
          </label>)}
        </div>
      </div>}

      {step === 2 && <div className="barcode-step-panel">
        <div className="barcode-size-grid">
          {LABEL_SIZES.map(option => <button key={option.key} className={sizeKey === option.key ? "active" : ""} onClick={() => setSizeKey(option.key)}><strong>{option.label}</strong><span>{option.description}</span></button>)}
        </div>
        {sizeKey === "custom" && <div className="barcode-custom-size"><label>กว้าง (มม.)<input type="number" min="20" max="100" value={customWidth} onChange={event => setCustomWidth(event.target.value)} /></label><label>สูง (มม.)<input type="number" min="10" max="80" value={customHeight} onChange={event => setCustomHeight(event.target.value)} /></label></div>}
        <label className="barcode-inline-check"><input type="checkbox" checked={showPrice} onChange={event => setShowPrice(event.target.checked)} />แสดงราคาบนสติ๊กเกอร์</label>
        <div className="barcode-size-note"><strong>คำแนะนำ</strong><span>ขนาดกลาง 32×25 มม. เหมาะกับสติ๊กเกอร์บาร์โค้ดร้านของชำทั่วไป แกน 1.5 นิ้ว ส่วนขนาดเล็ก 32×15 มม. ใช้เมื่อพื้นที่ติดสินค้าน้อย</span></div>
      </div>}

      {step === 3 && <div className="barcode-step-panel">
        <div className="barcode-print-summary"><span>เลือกสินค้า <strong>{selectedProducts.length}</strong> รายการ</span><span>จำนวนสติ๊กเกอร์ <strong>{totalLabels}</strong> ดวง</span><span>ขนาด <strong>{size.widthMm}×{size.heightMm} มม.</strong></span></div>
        <div className="barcode-preview-grid">
          {previewProducts.map((product, index) => <StickerLabel key={`${product.id}-${index}`} product={product} language={language} size={size} showPrice={showPrice} />)}
          {!previewProducts.length && <div className="barcode-empty-preview">ยังไม่ได้เลือกสินค้า</div>}
        </div>
      </div>}

      <div className="barcode-print-sheet" aria-hidden="true">
        {printProducts.map((product, index) => <StickerLabel key={`${product.id}-print-${index}`} product={product} language={language} size={size} showPrice={showPrice} />)}
      </div>

      <footer className="barcode-modal-footer">
        <button className="secondary" onClick={onClose}>ปิด</button>
        {step > 1 && <button className="secondary" onClick={() => setStep((step - 1) as 1 | 2 | 3)}>ย้อนกลับ</button>}
        {step < 3 && <button disabled={step === 1 && !selectedProducts.length} onClick={() => setStep((step + 1) as 1 | 2 | 3)}>ถัดไป</button>}
        {step === 3 && <button disabled={!selectedProducts.length} onClick={printLabels}>สั่งพิมพ์บาร์โค้ด</button>}
      </footer>
    </section>
  </div>;
}
