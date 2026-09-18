import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { RetailSalesScreen as GrocerySalesScreen } from "./GrocerySalesScreen";
import { DesktopSalesWorkspace } from "./components/sales/DesktopSalesWorkspace";
import { licensedSalesModes, type CpiposSalesMode } from "./license-entitlements";
import "./components/sales/desktop-sales-workspace.css";

type Props = ComponentProps<typeof GrocerySalesScreen>;
type UiMode = "grocery" | "takeaway" | "dine-in";

const SALES_MODE_KEY = "cpipos.desktop.sales.selected-mode.v1";

const MODE_LABELS: Record<UiMode, { th: string; en: string; noteTh: string; noteEn: string }> = {
  grocery: {
    th: "ร้านชำ / ค้าปลีก",
    en: "Grocery / Retail",
    noteTh: "หน้าขายเดิมสำหรับสแกนบาร์โค้ด SKU และขายหน้าร้าน",
    noteEn: "Original barcode and SKU retail checkout"
  },
  takeaway: {
    th: "กลับบ้าน",
    en: "Takeaway",
    noteTh: "เลือกรายการอาหารและสร้างออเดอร์รับกลับ",
    noteEn: "Create takeaway food orders"
  },
  "dine-in": {
    th: "นั่งโต๊ะ",
    en: "Dine-in",
    noteTh: "เลือกโต๊ะ เปิดบิลโต๊ะ และชำระเงินภายหลัง",
    noteEn: "Open table bills and settle later"
  }
};

function readMode(): UiMode {
  try {
    const value = localStorage.getItem(SALES_MODE_KEY);
    if (value === "grocery" || value === "takeaway" || value === "dine-in") return value;
  } catch {
    // Browser storage is best effort.
  }
  return "grocery";
}

function saveMode(mode: UiMode) {
  try { localStorage.setItem(SALES_MODE_KEY, mode); } catch { /* best effort */ }
}

function ModeIcon({ mode }: { mode: UiMode }) {
  const common = { width: 28, height: 28, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (mode === "dine-in") return <svg {...common}><path d="M4 9h16M6 9V6h12v3M7 9v10m10-10v10M5 19h4m6 0h4" /></svg>;
  if (mode === "takeaway") return <svg {...common}><path d="M6 9h12l1 11H5L6 9Zm3 0V7a3 3 0 0 1 6 0v2" /></svg>;
  return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  return <div className="desktop-pos-modal-backdrop" onMouseDown={onClose}>
    <section className="desktop-pos-modal mode-picker-modal" onMouseDown={(event) => event.stopPropagation()}>
      {children}
    </section>
  </div>;
}

export function RetailSalesScreen(props: Props) {
  const th = props.language === "th";
  const [mode, setMode] = useState<UiMode>(() => readMode());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allowedModes, setAllowedModes] = useState<CpiposSalesMode[]>(() => licensedSalesModes());

  const allowed = useMemo(() => new Set<UiMode>(allowedModes), [allowedModes]);

  useEffect(() => {
    const refresh = () => setAllowedModes(licensedSalesModes());
    const open = () => setPickerOpen(true);
    const first = window.setTimeout(refresh, 0);
    const second = window.setTimeout(refresh, 500);
    window.addEventListener("cpipos:license-online-status", refresh);
    window.addEventListener("cpipos:license-entitlements", refresh);
    window.addEventListener("cpipos:open-sales-mode-picker", open);
    window.addEventListener("online", refresh);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
      window.removeEventListener("cpipos:license-online-status", refresh);
      window.removeEventListener("cpipos:license-entitlements", refresh);
      window.removeEventListener("cpipos:open-sales-mode-picker", open);
      window.removeEventListener("online", refresh);
    };
  }, []);

  useEffect(() => {
    if (allowed.has(mode)) return;
    const fallback = (["grocery", "takeaway", "dine-in"] as UiMode[]).find((candidate) => allowed.has(candidate));
    if (fallback) {
      setMode(fallback);
      saveMode(fallback);
    }
    setPickerOpen(true);
  }, [allowed, mode]);

  useEffect(() => {
    const labels = MODE_LABELS[mode];
    window.dispatchEvent(new CustomEvent("cpipos:sales-mode-changed", {
      detail: { mode, label: th ? labels.th : labels.en }
    }));
  }, [mode, th]);

  const selectMode = (next: UiMode) => {
    if (!allowed.has(next)) return;
    setMode(next);
    saveMode(next);
    setPickerOpen(false);
  };

  const picker = pickerOpen ? <Modal onClose={() => setPickerOpen(false)}>
    <header className="desktop-pos-modal__header">
      <div>
        <small className="eyebrow">{th ? "เลือกโหมด" : "SELECT MODE"}</small>
        <h2>{th ? "เลือกโหมดการขาย" : "Select sales mode"}</h2>
        <p>{th ? "โหมดทดลอง 7 วันเปิดได้ทุกโหมด ส่วน License จริงจะยึดสิทธิ์ที่ฝ่าย IT กำหนด" : "Trial enables all modes. Licensed devices follow IT entitlements."}</p>
      </div>
      <button className="icon-close" onClick={() => setPickerOpen(false)}>×</button>
    </header>
    <div className="mode-card-grid">
      {(["grocery", "takeaway", "dine-in"] as UiMode[]).map((item) => {
        const enabled = allowed.has(item);
        const text = MODE_LABELS[item];
        return <button
          key={item}
          className={`mode-card ${mode === item ? "is-selected" : ""} ${!enabled ? "is-locked" : ""}`}
          disabled={!enabled}
          onClick={() => selectMode(item)}
        >
          <span className="mode-icon"><ModeIcon mode={item}/></span>
          <strong>{th ? text.th : text.en}</strong>
          <small>{th ? text.noteTh : text.noteEn}</small>
          {mode === item ? <b className="mode-check">✓</b> : null}
          {!enabled ? <em>{th ? "ปิดโดย IT" : "Locked by IT"}</em> : null}
        </button>;
      })}
    </div>
  </Modal> : null;

  if (mode === "grocery") {
    return <>{<GrocerySalesScreen {...props} />}{picker}</>;
  }

  return <>
    <DesktopSalesWorkspace {...props} fixedMode={mode === "dine-in" ? "dine_in" : "takeaway"} />
    {picker}
  </>;
}
