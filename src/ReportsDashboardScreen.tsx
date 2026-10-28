import { useEffect, useMemo, useState } from "react";
import type { PosRepository } from "./data/repository";
import type { Language, Receipt, Sale, SaleItem } from "./domain/types";
import { t } from "./i18n";
import "./reports-dashboard-ui.css";

type ReportPeriod = "day" | "month" | "year";
type TopProduct = { label: string; quantity: number; total: number };
type ChartBucket = { key: string; label: string; total: number; count: number };

type DashboardData = {
  sales: Sale[];
  receipts: Receipt[];
  totalSales: number;
  billCount: number;
  cashTotal: number;
  transferTotal: number;
  averageBill: number;
  cancelledCount: number;
  cancelledValue: number;
  topProducts: TopProduct[];
  buckets: ChartBucket[];
};

const moneyNumber = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
const money = (value: number) => `฿${moneyNumber(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);
const currentYear = () => String(new Date().getFullYear());
const monthName = (monthIndex: number) => ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."][monthIndex] || "";

const saleDateKey = (sale: Sale) => sale.createdAt.slice(0, 10);
const saleHour = (sale: Sale) => {
  const direct = sale.createdAt.slice(11, 13);
  if (/^\d{2}$/.test(direct)) return direct;
  return new Date(sale.createdAt).getHours().toString().padStart(2, "0");
};
const paymentIsTransfer = (sale: Sale) => ["transfer", "promptpay", "card"].includes(sale.paymentMethod);
const clampPercent = (value: number) => Math.max(3, Math.min(100, value));

const periodTarget = (period: ReportPeriod, date: string, month: string, year: string) => period === "day" ? date : period === "month" ? month : year;
const periodTitle = (period: ReportPeriod, date: string, month: string, year: string) => {
  if (period === "day") return date;
  if (period === "month") return month;
  return year;
};
const saleMatchesPeriod = (sale: Sale, period: ReportPeriod, target: string) => {
  const date = saleDateKey(sale);
  if (period === "day") return date === target;
  if (period === "month") return date.startsWith(target);
  return date.startsWith(target);
};

const makeBuckets = (sales: Sale[], period: ReportPeriod, target: string): ChartBucket[] => {
  if (period === "day") {
    return Array.from({ length: 24 }, (_, hour) => {
      const key = hour.toString().padStart(2, "0");
      const group = sales.filter(sale => saleHour(sale) === key);
      return { key, label: `${key}:00`, total: moneyNumber(group.reduce((sum, sale) => sum + sale.total, 0)), count: group.length };
    });
  }

  if (period === "month") {
    const [year, month] = target.split("-").map(Number);
    const days = new Date(year, month, 0).getDate();
    return Array.from({ length: days }, (_, index) => {
      const day = (index + 1).toString().padStart(2, "0");
      const key = `${target}-${day}`;
      const group = sales.filter(sale => saleDateKey(sale) === key);
      return { key, label: String(index + 1), total: moneyNumber(group.reduce((sum, sale) => sum + sale.total, 0)), count: group.length };
    });
  }

  return Array.from({ length: 12 }, (_, index) => {
    const key = `${target}-${(index + 1).toString().padStart(2, "0")}`;
    const group = sales.filter(sale => saleDateKey(sale).startsWith(key));
    return { key, label: monthName(index), total: moneyNumber(group.reduce((sum, sale) => sum + sale.total, 0)), count: group.length };
  });
};

const summarizeProducts = (receipts: Receipt[]): TopProduct[] => {
  const map = new Map<string, TopProduct>();
  for (const receipt of receipts) {
    for (const item of receipt.items || []) {
      const key = item.name || item.productId || "สินค้า";
      const current = map.get(key) || { label: key, quantity: 0, total: 0 };
      current.quantity = moneyNumber(current.quantity + Number(item.quantity || 0));
      current.total = moneyNumber(current.total + Number(item.lineTotal || item.quantity * item.unitPrice || 0));
      map.set(key, current);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity || b.total - a.total).slice(0, 3);
};

const buildDashboard = (periodSales: Sale[], receipts: Receipt[], period: ReportPeriod, target: string): DashboardData => {
  const completed = periodSales.filter(sale => sale.status === "completed");
  const cancelled = periodSales.filter(sale => sale.status === "cancelled");
  const totalSales = moneyNumber(completed.reduce((sum, sale) => sum + sale.total, 0));
  const billCount = completed.length;
  const cashTotal = moneyNumber(completed.filter(sale => sale.paymentMethod === "cash").reduce((sum, sale) => sum + sale.total, 0));
  const transferTotal = moneyNumber(completed.filter(paymentIsTransfer).reduce((sum, sale) => sum + sale.total, 0));
  const cancelledValue = moneyNumber(cancelled.reduce((sum, sale) => sum + sale.total, 0));
  return {
    sales: periodSales,
    receipts,
    totalSales,
    billCount,
    cashTotal,
    transferTotal,
    averageBill: billCount ? moneyNumber(totalSales / billCount) : 0,
    cancelledCount: cancelled.length,
    cancelledValue,
    topProducts: summarizeProducts(receipts),
    buckets: makeBuckets(completed, period, target),
  };
};

export function ReportsDashboardScreen({ repo, language }: { repo: PosRepository; language: Language }) {
  const [period, setPeriod] = useState<ReportPeriod>("day");
  const [date, setDate] = useState(today());
  const [month, setMonth] = useState(currentMonth());
  const [year, setYear] = useState(currentYear());
  const [sales, setSales] = useState<Sale[]>([]);
  const [receiptMap, setReceiptMap] = useState<Record<string, Receipt>>({});
  const [loading, setLoading] = useState(false);
  const [trendOpen, setTrendOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const rows = await repo.listSales(3000, { status: "all" });
        if (alive) setSales(rows);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [repo]);

  const target = periodTarget(period, date, month, year);
  const periodSales = useMemo(() => sales.filter(sale => saleMatchesPeriod(sale, period, target)), [sales, period, target]);
  const completedSales = useMemo(() => periodSales.filter(sale => sale.status === "completed"), [periodSales]);

  useEffect(() => {
    let alive = true;
    const missing = completedSales.filter(sale => !receiptMap[sale.id]).slice(0, 120);
    if (!missing.length) return;
    (async () => {
      const pairs = await Promise.all(missing.map(async sale => [sale.id, await repo.getReceipt(sale.id)] as const));
      if (!alive) return;
      setReceiptMap(current => {
        const next = { ...current };
        for (const [id, receipt] of pairs) if (receipt) next[id] = receipt;
        return next;
      });
    })();
    return () => { alive = false; };
  }, [completedSales, receiptMap, repo]);

  const receipts = useMemo(() => completedSales.map(sale => receiptMap[sale.id]).filter(Boolean), [completedSales, receiptMap]);
  const data = useMemo(() => buildDashboard(periodSales, receipts, period, target), [periodSales, receipts, period, target]);
  const maxBucket = Math.max(1, ...data.buckets.map(bucket => bucket.total));
  const periodText = period === "day" ? "รายวัน" : period === "month" ? "รายเดือน" : "รายปี";

  return <section className="panel reports-dashboard-page">
    <div className="reports-hero">
      <div>
        <span className="reports-eyebrow">ภาพรวม / สรุปรวม</span>
        <h1>{t(language, "reports")}</h1>
        <p>สรุปยอดขาย จำนวนบิล วิธีชำระ บิลยกเลิก สินค้าขายดี และแนวโน้มยอดขายแบบออฟไลน์</p>
      </div>
      <div className="reports-hero-actions">
        <button type="button" className="reports-trend-button" onClick={() => setTrendOpen(true)}><span aria-hidden="true">↗</span>แนวโน้มยอดขาย</button>
      <div className="reports-period-card">
        <div className="reports-period-tabs" role="tablist" aria-label="ช่วงรายงาน">
          <button className={period === "day" ? "active" : ""} onClick={() => setPeriod("day")}>รายวัน</button>
          <button className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>รายเดือน</button>
          <button className={period === "year" ? "active" : ""} onClick={() => setPeriod("year")}>รายปี</button>
        </div>
        {period === "day" && <input type="date" value={date} onChange={event => setDate(event.target.value)} />}
        {period === "month" && <input type="month" value={month} onChange={event => setMonth(event.target.value)} />}
        {period === "year" && <input inputMode="numeric" value={year} onChange={event => setYear(event.target.value.replace(/\D/g, "").slice(0, 4) || currentYear())} />}
      </div>
      </div>
    </div>

    <div className="reports-kpi-grid">
      <ReportKpi icon="฿" label="ยอดขายรวม" value={money(data.totalSales)} tone="primary" />
      <ReportKpi icon="#" label="จำนวนบิล" value={String(data.billCount)} />
      <ReportKpi icon="💵" label="เงินสด" value={money(data.cashTotal)} />
      <ReportKpi icon="⇄" label="เงินโอน" value={money(data.transferTotal)} />
      <ReportKpi icon="Ø" label="เฉลี่ยต่อบิล" value={money(data.averageBill)} />
      <ReportKpi icon="!" label="บิลยกเลิก" value={`${data.cancelledCount} / ${money(data.cancelledValue)}`} tone="danger" />
    </div>

    <div className="reports-content-grid">
      <section className="reports-card reports-top-products-card">
        <div className="reports-card-head">
          <div><h2>สินค้าขายดี</h2><p>จัดอันดับ 3 ระดับตามจำนวนขายในช่วง {periodText}</p></div>
          <span>{periodTitle(period, date, month, year)}</span>
        </div>
        <div className="reports-top-products">
          {data.topProducts.length ? data.topProducts.map((item, index) => <TopProductRow key={item.label} item={item} index={index} />) : <ReportEmpty text={loading ? "กำลังโหลดข้อมูล..." : "ยังไม่มีข้อมูลสินค้าขายในช่วงนี้"} />}
        </div>
      </section>

      <section className="reports-card reports-chart-card">
        <div className="reports-card-head"><div><h2>ยอดขายตามช่วงเวลา</h2><p>กราฟแท่งแสดงยอดขายรวมในแต่ละช่วง</p></div></div>
        <BarChart buckets={data.buckets} max={maxBucket} />
      </section>
    </div>

    {trendOpen && <TrendModal buckets={data.buckets} max={maxBucket} periodText={periodText} total={money(data.totalSales)} title="แนวโน้มยอดขาย" caption="กราฟเส้นสำหรับดูทิศทางยอดขาย" onClose={() => setTrendOpen(false)} />}
  </section>;
}

function TrendModal({ buckets, max, periodText, total, title, caption, onClose }: { buckets: ChartBucket[]; max: number; periodText: string; total: string; title: string; caption: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div className="reports-modal-backdrop" onClick={onClose}>
    <section className="reports-trend-modal" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
      <header className="reports-trend-modal-head">
        <div><h2>{title}</h2><p>{caption} {periodText}</p></div>
        <strong>{total}</strong>
        <button type="button" onClick={onClose} aria-label="Close">x</button>
      </header>
      <div className="reports-trend-modal-body">
        <LineChart buckets={buckets} max={max} />
      </div>
    </section>
  </div>;
}

function ReportKpi({ icon, label, value, tone = "normal" }: { icon: string; label: string; value: string; tone?: "normal" | "primary" | "danger" }) {
  return <div className={`report-kpi-card ${tone}`}><span className="report-kpi-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function TopProductRow({ item, index }: { item: TopProduct; index: number }) {
  const medals = ["🥇", "🥈", "🥉"];
  const level = ["อันดับ 1", "อันดับ 2", "อันดับ 3"][index] || `อันดับ ${index + 1}`;
  return <div className={`reports-top-row rank-${index + 1}`}>
    <span className="reports-rank-badge">{medals[index]} {level}</span>
    <div><strong>{item.label}</strong><small>ขาย {item.quantity.toLocaleString("th-TH")} ชิ้น</small></div>
    <b>{money(item.total)}</b>
  </div>;
}

function BarChart({ buckets, max }: { buckets: ChartBucket[]; max: number }) {
  const active = buckets.some(bucket => bucket.total > 0);
  if (!active) return <ReportEmpty text="ยังไม่มีข้อมูลในช่วงเวลานี้" />;
  const visibleBuckets = buckets.filter((bucket, index) => buckets.length <= 16 || bucket.total > 0 || index % Math.ceil(buckets.length / 14) === 0);
  return <div className="reports-bar-chart">
    {visibleBuckets.map(bucket => <div key={bucket.key} className="reports-bar-item" title={`${bucket.label}: ${money(bucket.total)}`}>
      <span style={{ height: `${clampPercent((bucket.total / max) * 100)}%` }} />
      <small>{bucket.label}</small>
    </div>)}
  </div>;
}

function LineChart({ buckets, max }: { buckets: ChartBucket[]; max: number }) {
  const active = buckets.some(bucket => bucket.total > 0);
  if (!active) return <ReportEmpty text="ยังไม่มีข้อมูลสำหรับกราฟเส้น" />;
  const width = 720;
  const height = 190;
  const padding = 18;
  const denom = Math.max(1, buckets.length - 1);
  const points = buckets.map((bucket, index) => {
    const x = padding + (index / denom) * (width - padding * 2);
    const y = height - padding - (bucket.total / max) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");
  const last = buckets.filter(bucket => bucket.total > 0).at(-1);
  return <div className="reports-line-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="กราฟเส้นแนวโน้มยอดขาย">
      <defs><linearGradient id="reportsLineFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="rgba(9,105,218,.22)" /><stop offset="100%" stopColor="rgba(9,105,218,0)" /></linearGradient></defs>
      {[0, 1, 2, 3].map(row => <line key={row} x1={padding} x2={width - padding} y1={padding + row * ((height - padding * 2) / 3)} y2={padding + row * ((height - padding * 2) / 3)} />)}
      <polyline className="line-fill" points={`${padding},${height - padding} ${points} ${width - padding},${height - padding}`} />
      <polyline className="line-stroke" points={points} />
      {buckets.map((bucket, index) => {
        if (!bucket.total) return null;
        const x = padding + (index / denom) * (width - padding * 2);
        const y = height - padding - (bucket.total / max) * (height - padding * 2);
        return <circle key={bucket.key} cx={x} cy={y} r="4" />;
      })}
    </svg>
    <div className="reports-line-foot"><span>เริ่มต้น {buckets[0]?.label}</span><strong>{last ? `${last.label} · ${money(last.total)}` : "-"}</strong><span>สิ้นสุด {buckets.at(-1)?.label}</span></div>
  </div>;
}

function ReportEmpty({ text }: { text: string }) {
  return <div className="reports-empty"><span>∅</span><strong>{text}</strong></div>;
}
