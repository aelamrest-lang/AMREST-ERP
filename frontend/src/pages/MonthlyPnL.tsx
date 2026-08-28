import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Label, Table, Th, Td, Empty, Modal } from "../components/ui";
import { fmtINR, downloadCSV } from "../lib/utils";
import { BarChart } from "../components/charts";

type StockType = "opening" | "purchase" | "closing";
type ExpType = "indirect" | "direct";
interface PLine { id: string; product: string; qty: number; amount: number }
interface ELine { id: string; description: string; amount: number }

interface PnlRow {
  key: string; // "YYYY-MM"
  opening: number | null; // null = auto (inherit from previous month's closing)
  purchase: number;
  closing: number;
  sales: number;
  indirect: number;
  direct: number;
}

function fyKeys(fyStartYear: number): { key: string; label: string }[] {
  const arr: { key: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const y = fyStartYear + (i < 9 ? 0 : 1);
    const m = ((3 + i) % 12) + 1; // Apr..Mar
    const dt = new Date(y, m - 1, 1);
    arr.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      label: dt.toLocaleString("en", { month: "short" }) + " " + String(y).slice(2),
    });
  }
  return arr;
}

/**
 * Profit / Loss bar chart with a zero baseline.
 * Positive bars grow up (green), negatives grow down (red) and are labelled "Loss".
 * Values are expected in ₹ thousands for compact display.
 */
function PnlBarChart({ data, height = 220 }: { data: { label: string; value: number }[]; height?: number }) {
  const maxAbs = Math.max(1, ...data.map(d => Math.abs(d.value)));
  const w = 100 / Math.max(1, data.length);
  const H = height / 2;
  const usable = H - 12;
  const zeroY = H / 2 + 2; // baseline near visual center
  return (
    <div className="w-full">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {/* zero baseline */}
        <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="#94a3b8" strokeWidth="0.15" strokeDasharray="0.6 0.6" />
        {data.map((d, i) => {
          const h = (Math.abs(d.value) / maxAbs) * (usable / 2);
          const isLoss = d.value < 0;
          const y = isLoss ? zeroY : zeroY - h;
          return (
            <g key={i}>
              <rect
                x={i * w + w * 0.15}
                y={y}
                width={w * 0.7}
                height={Math.max(0.2, h)}
                fill={isLoss ? "#ef4444" : "#10b981"}
                rx={0.6}
              >
                <title>{`${d.label}: ${isLoss ? "Loss " : ""}₹${Math.abs(d.value).toLocaleString("en-IN")}k`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="flex w-full mt-1">
        {data.map((d, i) => (
          <div key={i} className="text-[10px] text-center truncate leading-tight" style={{ width: `${w}%` }}>
            <div className="text-slate-500 dark:text-slate-400">{d.label}</div>
            {d.value !== 0 && (
              <div className={d.value < 0 ? "text-rose-600 font-medium" : "text-emerald-600 font-medium"}>
                {d.value < 0 ? `Loss ${Math.abs(d.value)}k` : `${d.value}k`}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MonthlyPnL() {
  const { db, setDB, log } = useStore();
  const now = new Date();
  const fyDefault = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [fy, setFy] = useState<number>(fyDefault);

  const months = useMemo(() => fyKeys(fy), [fy]);

  const persisted = (db.settings as any).monthlyPnl || {};
  const linesStore: Record<string, { opening?: PLine[]; purchase?: PLine[]; closing?: PLine[] }> =
    ((db.settings as any).monthlyPnlLines || {});
  const expStore: Record<string, { indirect?: ELine[]; direct?: ELine[] }> =
    ((db.settings as any).monthlyPnlExpenses || {});
  // Monthly P&S Report rows are the source-of-truth for Sales when data exists
  const psRows: Array<{ id: string; month: string; product: string; qty: number; price: number; amount: number }> =
    ((db.settings as any).monthlyPSRows || []);

  const getLines = (month: string, type: StockType): PLine[] => (linesStore[month]?.[type]) || [];
  const sumLines = (month: string, type: StockType): number => getLines(month, type).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const hasLines = (month: string, type: StockType): boolean => getLines(month, type).length > 0;

  const getExpLines = (month: string, type: ExpType): ELine[] => (expStore[month]?.[type]) || [];
  const sumExpLines = (month: string, type: ExpType): number => getExpLines(month, type).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const hasExpLines = (month: string, type: ExpType): boolean => getExpLines(month, type).length > 0;

  const psRowsFor = (month: string) => psRows.filter(r => r.month === month);
  const psTotalFor = (month: string) => psRowsFor(month).reduce((s, r) => s + (r.amount || 0), 0);
  const hasPS = (month: string) => psRowsFor(month).length > 0;

  // Excel upload state / modal state
  const fileRef = useRef<HTMLInputElement>(null);
  const expFileRef = useRef<HTMLInputElement>(null);
  const [uploadMsg, setUploadMsg] = useState<string>("");
  const [viewLines, setViewLines] = useState<{ month: string; type: StockType } | null>(null);
  const [viewExpLines, setViewExpLines] = useState<{ month: string; type: ExpType } | null>(null);
  const [viewPSMonth, setViewPSMonth] = useState<string | null>(null);

  const persistedRows: PnlRow[] = months.map(m => {
    const p = persisted[m.key] || {};
    const openingLines = hasLines(m.key, "opening");
    const purchaseLines = hasLines(m.key, "purchase");
    const closingLines = hasLines(m.key, "closing");
    const indirectExp = hasExpLines(m.key, "indirect");
    const directExp = hasExpLines(m.key, "direct");
    const hasPSForMonth = hasPS(m.key);
    return {
      key: m.key,
      opening: openingLines
        ? sumLines(m.key, "opening")
        : ((p.opening === undefined || p.opening === null) ? null : Number(p.opening)),
      purchase: purchaseLines ? sumLines(m.key, "purchase") : (Number(p.purchase) || 0),
      closing: closingLines ? sumLines(m.key, "closing") : (Number(p.closing) || 0),
      // Sales auto-pulls from Monthly P&S Report when rows exist for the month
      sales: hasPSForMonth ? psTotalFor(m.key) : (Number(p.sales) || 0),
      indirect: indirectExp ? sumExpLines(m.key, "indirect") : (Number(p.indirect) || 0),
      direct: directExp ? sumExpLines(m.key, "direct") : (Number(p.direct) || 0),
    };
  });

  const [draft, setDraft] = useState<Record<string, PnlRow>>({});
  const rawRow = (key: string): PnlRow => draft[key] || persistedRows.find(r => r.key === key)!;

  // Resolve opening: if null (auto), inherit from previous month's closing.
  const resolved = useMemo(() => {
    const list: (PnlRow & { resolvedOpening: number; isOpeningAuto: boolean })[] = [];
    let prevClosing = 0;
    for (const m of months) {
      const r = rawRow(m.key);
      const isAuto = r.opening === null;
      const resolvedOpening = isAuto ? prevClosing : (r.opening as number);
      list.push({ ...r, resolvedOpening, isOpeningAuto: isAuto });
      prevClosing = r.closing;
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, draft, persistedRows]);

  const updateCell = (key: string, field: keyof PnlRow, value: number | null) => {
    setDraft(prev => {
      const base = prev[key] || persistedRows.find(r => r.key === key)!;
      const nextVal = field === "opening"
        ? (value === null ? null : Math.max(0, Number(value) || 0))
        : Math.max(0, Number(value) || 0);
      return { ...prev, [key]: { ...base, [field]: nextVal } };
    });
  };

  const derive = (openingVal: number, r: PnlRow) => {
    const consumed = openingVal + r.purchase - r.closing;
    const totalExp = consumed + r.indirect + r.direct;
    const profit = r.sales - totalExp;
    const profitPct = r.sales > 0 ? (profit / r.sales) * 100 : 0;
    return { consumed, totalExp, profit, profitPct };
  };

  const saveAll = () => {
    setDB(d => {
      const next = { ...((d.settings as any).monthlyPnl || {}) };
      Object.entries(draft).forEach(([k, v]) => { next[k] = v; });
      return { ...d, settings: { ...d.settings, monthlyPnl: next } as any };
    });
    log(`Saved Monthly P&L (${Object.keys(draft).length} months)`, "P&L");
    setDraft({});
  };

  // ---- Excel upload for stock line items (Opening / Purchase / Closing) ----
  const parseMonth = (raw: any): string | null => {
    if (raw === null || raw === undefined || raw === "") return null;
    if (raw instanceof Date && !isNaN(raw.getTime())) {
      return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}`;
    }
    if (typeof raw === "number" && raw > 20000 && raw < 80000) {
      const jsDate = new Date(Math.round((raw - 25569) * 86400 * 1000));
      if (!isNaN(jsDate.getTime())) return `${jsDate.getUTCFullYear()}-${String(jsDate.getUTCMonth() + 1).padStart(2, "0")}`;
    }
    const s = String(raw).trim();
    let m = s.match(/^(\d{4})[-/](\d{1,2})$/);
    if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}`;
    m = s.match(/^(\d{1,2})[-/](\d{4})$/);
    if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, "0")}`;
    const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    const shortNames = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const cleaned = s.toLowerCase().replace(/[.,]/g, "").replace(/[-/]/g, " ").replace(/\s+/g, " ");
    const parts = cleaned.split(" ");
    if (parts.length >= 2) {
      const idx1 = monthNames.findIndex(mn => parts[0].startsWith(mn.slice(0, 3)));
      const idx2 = shortNames.findIndex(mn => parts[0].startsWith(mn));
      const idx = idx1 >= 0 ? idx1 : idx2;
      if (idx >= 0) {
        let year = Number(parts[1]);
        if (!isFinite(year)) return null;
        if (year < 100) year = 2000 + year;
        return `${year}-${String(idx + 1).padStart(2, "0")}`;
      }
    }
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    return null;
  };
  const parseType = (raw: any): StockType | null => {
    const s = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
    if (!s) return null;
    if (s.startsWith("open")) return "opening";
    if (s.startsWith("purch")) return "purchase";
    if (s.startsWith("clos")) return "closing";
    return null;
  };
  const rowVal = (row: Record<string, any>, names: string[]) => {
    const norm = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase().replace(/[^a-z0-9]/g, ""), v]));
    for (const n of names) {
      const k = n.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (k in norm) return norm[k];
    }
    return undefined;
  };
  const numVal = (v: any) => {
    if (v === null || v === undefined || v === "") return 0;
    const n = Number(String(v).replace(/,/g, "").replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : 0;
  };

  const handleUpload = async (file?: File) => {
    if (!file) return;
    setUploadMsg("Reading Excel file...");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      if (!rows.length) throw new Error("No rows found");

      const groups: Record<string, { opening: PLine[]; purchase: PLine[]; closing: PLine[] }> = {};
      let skipped = 0;
      rows.forEach(r => {
        const monthKey = parseMonth(rowVal(r, ["Month", "Period"]));
        const type = parseType(rowVal(r, ["Type", "Stock Type", "Category"]));
        const product = String(rowVal(r, ["Product Name", "Product", "Item", "Item Name"]) || "").trim();
        const qty = numVal(rowVal(r, ["Quantity", "Qty"]));
        const amount = numVal(rowVal(r, ["Amount", "Value", "Total Amount"]));
        if (!monthKey || !type || !product) { skipped++; return; }
        if (!groups[monthKey]) groups[monthKey] = { opening: [], purchase: [], closing: [] };
        groups[monthKey][type].push({ id: uid(), product, qty, amount });
      });

      const grouped = Object.entries(groups);
      if (grouped.length === 0) {
        setUploadMsg("Upload failed: no valid rows. Required columns — Month, Type (Opening/Purchase/Closing), Product Name, Quantity, Amount.");
        return;
      }

      setDB(d => {
        const cur = { ...((d.settings as any).monthlyPnlLines || {}) };
        grouped.forEach(([mo, buckets]) => {
          const existing = cur[mo] || {};
          cur[mo] = {
            opening: [...(existing.opening || []), ...buckets.opening],
            purchase: [...(existing.purchase || []), ...buckets.purchase],
            closing: [...(existing.closing || []), ...buckets.closing],
          };
        });
        return { ...d, settings: { ...d.settings, monthlyPnlLines: cur } as any };
      });
      // Clear any local draft edits for these month keys so line sums take effect immediately
      setDraft(prev => {
        const next = { ...prev };
        grouped.forEach(([mo]) => { delete next[mo]; });
        return next;
      });
      const totalRows = grouped.reduce((s, [, b]) => s + b.opening.length + b.purchase.length + b.closing.length, 0);
      log(`P&L: uploaded ${totalRows} stock line items across ${grouped.length} months`, "P&L");
      setUploadMsg(`Uploaded ${totalRows} rows across ${grouped.length} months${skipped ? `, ${skipped} skipped.` : "."}`);
    } catch (e: any) {
      setUploadMsg(`Error: ${e?.message || "Failed to read file."}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const downloadStockTemplate = () => {
    downloadCSV("monthly-pnl-stock-template.csv", [
      ["Month", "Type", "Product Name", "Quantity", "Amount"],
      ["2026-04", "Opening", "CRGO Steel 0.23mm", 500, 250000],
      ["2026-04", "Opening", "Copper Wire 1.6mm", 300, 180000],
      ["2026-04", "Purchase", "CRGO Steel 0.23mm", 400, 210000],
      ["2026-04", "Closing", "CRGO Steel 0.23mm", 300, 160000],
      ["Apr 2026", "Purchase", "Copper Wire 1.6mm", 200, 125000],
    ]);
  };

  const removeLine = (month: string, type: StockType, id: string) => {
    setDB(d => {
      const cur = { ...((d.settings as any).monthlyPnlLines || {}) };
      const existing = cur[month] || {};
      const filtered = (existing[type] || []).filter((l: PLine) => l.id !== id);
      cur[month] = { ...existing, [type]: filtered };
      // Clean up empty months
      if ((!cur[month].opening?.length) && (!cur[month].purchase?.length) && (!cur[month].closing?.length)) {
        delete cur[month];
      }
      return { ...d, settings: { ...d.settings, monthlyPnlLines: cur } as any };
    });
  };

  const clearLines = (month: string, type: StockType) => {
    if (!confirm(`Delete all ${type} line items for ${months.find(m => m.key === month)?.label || month}?`)) return;
    setDB(d => {
      const cur = { ...((d.settings as any).monthlyPnlLines || {}) };
      const existing = cur[month] || {};
      cur[month] = { ...existing, [type]: [] };
      if ((!cur[month].opening?.length) && (!cur[month].purchase?.length) && (!cur[month].closing?.length)) {
        delete cur[month];
      }
      return { ...d, settings: { ...d.settings, monthlyPnlLines: cur } as any };
    });
  };

  // ---- Excel upload for Indirect / Direct expense line items ----
  const parseExpType = (raw: any): ExpType | null => {
    const s = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
    if (!s) return null;
    if (s.startsWith("indirect")) return "indirect";
    if (s.startsWith("direct")) return "direct";
    return null;
  };

  const handleExpUpload = async (file?: File) => {
    if (!file) return;
    setUploadMsg("Reading Excel file...");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      if (!rows.length) throw new Error("No rows found");

      const groups: Record<string, { indirect: ELine[]; direct: ELine[] }> = {};
      let skipped = 0;
      rows.forEach(r => {
        const monthKey = parseMonth(rowVal(r, ["Month", "Period"]));
        const type = parseExpType(rowVal(r, ["Type", "Expense Type", "Category"]));
        const description = String(rowVal(r, ["Description", "Particulars", "Head", "Expense", "Item"]) || "").trim();
        const amount = numVal(rowVal(r, ["Amount", "Value"]));
        if (!monthKey || !type || !description) { skipped++; return; }
        if (!groups[monthKey]) groups[monthKey] = { indirect: [], direct: [] };
        groups[monthKey][type].push({ id: uid(), description, amount });
      });

      const grouped = Object.entries(groups);
      if (grouped.length === 0) {
        setUploadMsg("Upload failed: no valid rows. Required columns — Month, Type (Indirect/Direct), Description, Amount.");
        return;
      }

      setDB(d => {
        const cur = { ...((d.settings as any).monthlyPnlExpenses || {}) };
        grouped.forEach(([mo, buckets]) => {
          const existing = cur[mo] || {};
          cur[mo] = {
            indirect: [...(existing.indirect || []), ...buckets.indirect],
            direct: [...(existing.direct || []), ...buckets.direct],
          };
        });
        return { ...d, settings: { ...d.settings, monthlyPnlExpenses: cur } as any };
      });
      setDraft(prev => {
        const next = { ...prev };
        grouped.forEach(([mo]) => { delete next[mo]; });
        return next;
      });
      const total = grouped.reduce((s, [, b]) => s + b.indirect.length + b.direct.length, 0);
      log(`P&L: uploaded ${total} expense line items across ${grouped.length} months`, "P&L");
      setUploadMsg(`Uploaded ${total} expense rows across ${grouped.length} months${skipped ? `, ${skipped} skipped.` : "."}`);
    } catch (e: any) {
      setUploadMsg(`Error: ${e?.message || "Failed to read file."}`);
    } finally {
      if (expFileRef.current) expFileRef.current.value = "";
    }
  };

  const downloadExpTemplate = () => {
    downloadCSV("monthly-pnl-expenses-template.csv", [
      ["Month", "Type", "Description", "Amount"],
      ["2026-04", "Indirect", "Office Rent", 60000],
      ["2026-04", "Indirect", "Electricity", 25000],
      ["2026-04", "Indirect", "Staff Salaries (Admin)", 180000],
      ["2026-04", "Direct", "Factory Labour", 220000],
      ["2026-04", "Direct", "Transportation", 45000],
      ["Apr 2026", "Direct", "Consumables", 18000],
    ]);
  };

  const removeExpLine = (month: string, type: ExpType, id: string) => {
    setDB(d => {
      const cur = { ...((d.settings as any).monthlyPnlExpenses || {}) };
      const existing = cur[month] || {};
      cur[month] = { ...existing, [type]: (existing[type] || []).filter((l: ELine) => l.id !== id) };
      if ((!cur[month].indirect?.length) && (!cur[month].direct?.length)) delete cur[month];
      return { ...d, settings: { ...d.settings, monthlyPnlExpenses: cur } as any };
    });
  };

  const clearExpLines = (month: string, type: ExpType) => {
    if (!confirm(`Delete all ${type} expense line items for ${months.find(m => m.key === month)?.label || month}?`)) return;
    setDB(d => {
      const cur = { ...((d.settings as any).monthlyPnlExpenses || {}) };
      const existing = cur[month] || {};
      cur[month] = { ...existing, [type]: [] };
      if ((!cur[month].indirect?.length) && (!cur[month].direct?.length)) delete cur[month];
      return { ...d, settings: { ...d.settings, monthlyPnlExpenses: cur } as any };
    });
  };

  // Totals
  const totals = resolved.reduce((t, r) => {
    const d = derive(r.resolvedOpening, r);
    return {
      opening: t.opening + r.resolvedOpening,
      purchase: t.purchase + r.purchase,
      closing: t.closing + r.closing,
      consumed: t.consumed + d.consumed,
      sales: t.sales + r.sales,
      indirect: t.indirect + r.indirect,
      direct: t.direct + r.direct,
      totalExp: t.totalExp + d.totalExp,
      profit: t.profit + d.profit,
    };
  }, { opening: 0, purchase: 0, closing: 0, consumed: 0, sales: 0, indirect: 0, direct: 0, totalExp: 0, profit: 0 });
  const totalProfitPct = totals.sales > 0 ? (totals.profit / totals.sales) * 100 : 0;

  // ----- Comparison Sheet: helpers -----
  const rawFor = (key: string): PnlRow => {
    if (draft[key]) return draft[key];
    const p = persisted[key];
    const openL = hasLines(key, "opening");
    const purL = hasLines(key, "purchase");
    const cloL = hasLines(key, "closing");
    const indE = hasExpLines(key, "indirect");
    const dirE = hasExpLines(key, "direct");
    return {
      key,
      opening: openL ? sumLines(key, "opening") : ((!p || p.opening === undefined || p.opening === null) ? null : Number(p.opening)),
      purchase: purL ? sumLines(key, "purchase") : (p ? Number(p.purchase) || 0 : 0),
      closing: cloL ? sumLines(key, "closing") : (p ? Number(p.closing) || 0 : 0),
      sales: hasPS(key) ? psTotalFor(key) : (p ? Number(p.sales) || 0 : 0),
      indirect: indE ? sumExpLines(key, "indirect") : (p ? Number(p.indirect) || 0 : 0),
      direct: dirE ? sumExpLines(key, "direct") : (p ? Number(p.direct) || 0 : 0),
    };
  };

  const fyOf = (monthKey: string): number => {
    const [y, m] = monthKey.split("-").map(Number);
    return m >= 4 ? y : y - 1;
  };

  const monthLabelFor = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en", { month: "short" }) + " " + String(y).slice(2);
  };

  const fyLabel = (fyStart: number) => `FY ${fyStart}-${String(fyStart + 1).slice(-2)}`;

  const computeMonth = (key: string) => {
    const fyStart = fyOf(key);
    const monthList = fyKeys(fyStart);
    let prevClosing = 0;
    for (const mk of monthList) {
      const r = rawFor(mk.key);
      const opening = r.opening === null ? prevClosing : (r.opening as number);
      if (mk.key === key) {
        const d = derive(opening, r);
        return { opening, purchase: r.purchase, closing: r.closing, sales: r.sales, indirect: r.indirect, direct: r.direct, ...d };
      }
      prevClosing = r.closing;
    }
    return { opening: 0, purchase: 0, closing: 0, sales: 0, indirect: 0, direct: 0, consumed: 0, totalExp: 0, profit: 0, profitPct: 0 };
  };

  const computeYear = (fyStart: number) => {
    const monthList = fyKeys(fyStart);
    let prevClosing = 0;
    const agg = { opening: 0, purchase: 0, closing: 0, consumed: 0, sales: 0, indirect: 0, direct: 0, totalExp: 0, profit: 0, profitPct: 0 };
    for (const mk of monthList) {
      const r = rawFor(mk.key);
      const opening = r.opening === null ? prevClosing : (r.opening as number);
      const d = derive(opening, r);
      agg.opening += opening;
      agg.purchase += r.purchase;
      agg.closing += r.closing;
      agg.consumed += d.consumed;
      agg.sales += r.sales;
      agg.indirect += r.indirect;
      agg.direct += r.direct;
      agg.totalExp += d.totalExp;
      agg.profit += d.profit;
      prevClosing = r.closing;
    }
    agg.profitPct = agg.sales > 0 ? (agg.profit / agg.sales) * 100 : 0;
    return agg;
  };

  const allKeys = useMemo(() => Array.from(new Set([...Object.keys(persisted), ...Object.keys(draft)])), [persisted, draft]);
  const availableMonths = useMemo(() => allKeys.filter(k => {
    const r = rawFor(k);
    return r.purchase || r.closing || r.sales || r.indirect || r.direct || (r.opening !== null && (r.opening as number) > 0);
  }).sort(), [allKeys, draft, persisted]);
  const availableYears = useMemo(() => {
    const s = new Set<number>();
    allKeys.forEach(k => s.add(fyOf(k)));
    return Array.from(s).sort((a, b) => a - b);
  }, [allKeys]);

  const [compareMode, setCompareMode] = useState<"month" | "year">("month");
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);

  const toggleMonth = (k: string) => setSelectedMonths(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k].sort());
  const toggleYear = (y: number) => setSelectedYears(prev => prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y].sort((a, b) => a - b));

  type CompareCol = { key: string; label: string; data: ReturnType<typeof computeYear> };
  const compareCols: CompareCol[] = compareMode === "month"
    ? selectedMonths.map(k => ({ key: k, label: monthLabelFor(k), data: computeMonth(k) as any }))
    : selectedYears.map(y => ({ key: String(y), label: fyLabel(y), data: computeYear(y) }));

  const cmpMetrics: { label: string; get: (d: CompareCol["data"]) => number; kind?: "profit" | "pct" | "money" }[] = [
    { label: "Opening Stock", get: d => d.opening, kind: "money" },
    { label: "Purchase", get: d => d.purchase, kind: "money" },
    { label: "Closing Stock", get: d => d.closing, kind: "money" },
    { label: "Consumed Stock", get: d => d.consumed, kind: "money" },
    { label: "Sales", get: d => d.sales, kind: "money" },
    { label: "Indirect Expenses", get: d => d.indirect, kind: "money" },
    { label: "Direct Expenses", get: d => d.direct, kind: "money" },
    { label: "Total Expenses", get: d => d.totalExp, kind: "money" },
    { label: "Profit / Loss", get: d => d.profit, kind: "profit" },
    { label: "Profit %", get: d => d.profitPct, kind: "pct" },
  ];

  const formatMetric = (val: number, kind?: string) => {
    if (kind === "pct") return `${val.toFixed(2)}%`;
    if (kind === "profit") return val < 0 ? `Loss ${fmtINR(Math.abs(val))}` : fmtINR(val);
    return fmtINR(val);
  };
  const metricClass = (val: number, kind?: string) => {
    if (kind === "profit" || kind === "pct") return val < 0 ? "text-rose-600 font-semibold" : "text-emerald-600 font-semibold";
    return "";
  };


  const salesChart = months.map((m, i) => ({ label: m.label, value: Math.round((resolved[i].sales) / 1000) }));
  const expChart = months.map((m, i) => ({ label: m.label, value: Math.round(derive(resolved[i].resolvedOpening, resolved[i]).totalExp / 1000) }));
  const profitChart = months.map((m, i) => ({ label: m.label, value: Math.round(derive(resolved[i].resolvedOpening, resolved[i]).profit / 1000) }));

  const hasAnyData = resolved.some(r => r.sales > 0 || r.purchase > 0 || r.resolvedOpening > 0 || r.closing > 0 || r.indirect > 0 || r.direct > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Monthly Profit &amp; Loss</h1>
          <p className="text-sm text-slate-500">Manual month-wise entry · Closing Stock auto-flows to next month&apos;s Opening Stock · <strong>Sales</strong> auto-pulls from Monthly P&amp;S Report when uploaded · Upload Excel for stock &amp; expense line items</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => handleUpload(e.target.files?.[0])} data-testid="pnl-upload-input" />
          <Button variant="outline" onClick={() => fileRef.current?.click()} data-testid="pnl-upload-btn">Upload Stock Excel</Button>
          <Button variant="ghost" onClick={downloadStockTemplate} data-testid="pnl-template-btn">Stock Template</Button>
          <input ref={expFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => handleExpUpload(e.target.files?.[0])} data-testid="pnl-exp-upload-input" />
          <Button variant="outline" onClick={() => expFileRef.current?.click()} data-testid="pnl-exp-upload-btn">Upload Expenses Excel</Button>
          <Button variant="ghost" onClick={downloadExpTemplate} data-testid="pnl-exp-template-btn">Expenses Template</Button>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Financial Year</Label>
            <Input type="number" value={fy} onChange={(e: any) => setFy(Number(e.target.value) || fyDefault)} className="w-28 h-8 py-1" data-testid="pnl-fy" />
          </div>
          <Button
            onClick={saveAll}
            disabled={Object.keys(draft).length === 0}
            data-testid="pnl-save"
          >{Object.keys(draft).length > 0 ? `Save (${Object.keys(draft).length})` : "Saved"}</Button>
        </div>
      </div>
      {uploadMsg && (
        <div className={"text-xs px-3 py-2 rounded-md " + (uploadMsg.startsWith("Error") ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")} data-testid="pnl-upload-msg">{uploadMsg}</div>
      )}

      {/* Monthly Trend — moved to top */}
      <Card data-testid="pnl-trend-card">
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <div className="font-semibold">Monthly Trend (₹ thousands)</div>
          <div className="text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-sm bg-indigo-500 mr-1 align-middle"/> Sales
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-500 ml-3 mr-1 align-middle"/> Total Expenses
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500 ml-3 mr-1 align-middle"/> Profit
            <span className="inline-block w-3 h-3 rounded-sm bg-rose-500 ml-3 mr-1 align-middle"/> Loss
          </div>
        </div>
        {!hasAnyData ? (
          <div className="p-6"><Empty title="No data yet" subtitle="Enter values in the tables below to see the monthly trend." /></div>
        ) : (
          <div className="p-4 grid gap-4 lg:grid-cols-3">
            <div>
              <div className="text-xs font-medium mb-1 text-indigo-700">Sales</div>
              <BarChart data={salesChart} color="#6366f1" />
            </div>
            <div>
              <div className="text-xs font-medium mb-1 text-amber-700">Total Expenses</div>
              <BarChart data={expChart} color="#f59e0b" />
            </div>
            <div>
              <div className="text-xs font-medium mb-1 text-emerald-700">Profit / Loss</div>
              <PnlBarChart data={profitChart} />
            </div>
          </div>
        )}
      </Card>

      {/* Stock Consumption */}
      <Card>
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 font-semibold">1. Stock Consumption</div>
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Month</Th>
                <Th className="text-right">Opening Stock</Th>
                <Th className="text-right">Purchase</Th>
                <Th className="text-right">Closing Stock</Th>
                <Th className="text-right">Consumed Stock</Th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                const r = resolved[i];
                const d = derive(r.resolvedOpening, r);
                return (
                  <tr key={m.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Td className="font-medium">{m.label}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        {hasLines(m.key, "opening") ? (
                          <button
                            type="button"
                            onClick={() => setViewLines({ month: m.key, type: "opening" })}
                            className="text-indigo-700 font-semibold hover:underline text-right min-w-32"
                            title={`${getLines(m.key, "opening").length} products — click to view details`}
                            data-testid={`pnl-open-view-${m.key}`}
                          >{fmtINR(r.resolvedOpening)}
                            <span className="ml-1 text-[9px] font-semibold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-1 rounded align-middle">{getLines(m.key, "opening").length} items</span>
                          </button>
                        ) : (
                          <Input
                            type="number"
                            value={r.resolvedOpening}
                            onChange={(e: any) => updateCell(m.key, "opening", Number(e.target.value) || 0)}
                            className="text-right py-1 h-8 min-w-32 ml-auto"
                            data-testid={`pnl-open-${m.key}`}
                            title={r.isOpeningAuto && i > 0 ? "Auto: inherited from previous month's closing stock. Edit to override." : ""}
                          />
                        )}
                        {!hasLines(m.key, "opening") && r.isOpeningAuto && i > 0 && r.resolvedOpening > 0 && (
                          <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-1 rounded" title="Auto-carried from previous month's Closing Stock">AUTO</span>
                        )}
                        {!hasLines(m.key, "opening") && !r.isOpeningAuto && (
                          <button
                            type="button"
                            onClick={() => updateCell(m.key, "opening", null)}
                            className="text-[9px] text-slate-500 hover:text-indigo-600 underline"
                            title="Reset to auto (previous month's closing)"
                            data-testid={`pnl-open-reset-${m.key}`}
                          >reset</button>
                        )}
                      </div>
                    </Td>
                    <Td>
                      {hasLines(m.key, "purchase") ? (
                        <button
                          type="button"
                          onClick={() => setViewLines({ month: m.key, type: "purchase" })}
                          className="text-indigo-700 font-semibold hover:underline text-right min-w-32 ml-auto flex items-center justify-end gap-1"
                          title={`${getLines(m.key, "purchase").length} products — click to view details`}
                          data-testid={`pnl-purchase-view-${m.key}`}
                        >{fmtINR(r.purchase)}
                          <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-1 rounded">{getLines(m.key, "purchase").length} items</span>
                        </button>
                      ) : (
                        <Input type="number" value={r.purchase} onChange={(e: any) => updateCell(m.key, "purchase", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-purchase-${m.key}`} />
                      )}
                    </Td>
                    <Td>
                      {hasLines(m.key, "closing") ? (
                        <button
                          type="button"
                          onClick={() => setViewLines({ month: m.key, type: "closing" })}
                          className="text-indigo-700 font-semibold hover:underline text-right min-w-32 ml-auto flex items-center justify-end gap-1"
                          title={`${getLines(m.key, "closing").length} products — click to view details`}
                          data-testid={`pnl-close-view-${m.key}`}
                        >{fmtINR(r.closing)}
                          <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-1 rounded">{getLines(m.key, "closing").length} items</span>
                        </button>
                      ) : (
                        <Input type="number" value={r.closing} onChange={(e: any) => updateCell(m.key, "closing", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-close-${m.key}`} />
                      )}
                    </Td>
                    <Td className="text-right font-semibold text-indigo-600">{fmtINR(d.consumed)}</Td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50 dark:bg-slate-800/40 font-semibold">
                <Td>Totals</Td>
                <Td className="text-right">{fmtINR(totals.opening)}</Td>
                <Td className="text-right">{fmtINR(totals.purchase)}</Td>
                <Td className="text-right">{fmtINR(totals.closing)}</Td>
                <Td className="text-right text-indigo-700">{fmtINR(totals.consumed)}</Td>
              </tr>
            </tbody>
          </Table>
        </div>
      </Card>

      {/* Profit & Loss */}
      <Card>
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 font-semibold">2. Profit &amp; Loss</div>
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Month</Th>
                <Th className="text-right">Sales</Th>
                <Th className="text-right">Consumed Stock</Th>
                <Th className="text-right">Indirect Expenses</Th>
                <Th className="text-right">Direct Expenses</Th>
                <Th className="text-right">Total Expenses</Th>
                <Th className="text-right">Profit / Loss</Th>
                <Th className="text-right">Profit %</Th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                const r = resolved[i];
                const d = derive(r.resolvedOpening, r);
                return (
                  <tr key={m.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Td className="font-medium">{m.label}</Td>
                    <Td>
                      {hasPS(m.key) ? (
                        <button
                          type="button"
                          onClick={() => setViewPSMonth(m.key)}
                          className="text-indigo-700 font-semibold hover:underline text-right min-w-32 ml-auto flex items-center justify-end gap-1"
                          title={`${psRowsFor(m.key).length} rows from Monthly P&S Report — click to view`}
                          data-testid={`pnl-sales-view-${m.key}`}
                        >{fmtINR(r.sales)}
                          <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-1 rounded">P&amp;S</span>
                        </button>
                      ) : (
                        <Input type="number" value={r.sales} onChange={(e: any) => updateCell(m.key, "sales", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-sales-${m.key}`} />
                      )}
                    </Td>
                    <Td className="text-right">{fmtINR(d.consumed)}</Td>
                    <Td>
                      {hasExpLines(m.key, "indirect") ? (
                        <button
                          type="button"
                          onClick={() => setViewExpLines({ month: m.key, type: "indirect" })}
                          className="text-indigo-700 font-semibold hover:underline text-right min-w-32 ml-auto flex items-center justify-end gap-1"
                          title={`${getExpLines(m.key, "indirect").length} items — click to view details`}
                          data-testid={`pnl-indirect-view-${m.key}`}
                        >{fmtINR(r.indirect)}
                          <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-1 rounded">{getExpLines(m.key, "indirect").length} items</span>
                        </button>
                      ) : (
                        <Input type="number" value={r.indirect} onChange={(e: any) => updateCell(m.key, "indirect", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-indirect-${m.key}`} />
                      )}
                    </Td>
                    <Td>
                      {hasExpLines(m.key, "direct") ? (
                        <button
                          type="button"
                          onClick={() => setViewExpLines({ month: m.key, type: "direct" })}
                          className="text-indigo-700 font-semibold hover:underline text-right min-w-32 ml-auto flex items-center justify-end gap-1"
                          title={`${getExpLines(m.key, "direct").length} items — click to view details`}
                          data-testid={`pnl-direct-view-${m.key}`}
                        >{fmtINR(r.direct)}
                          <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-1 rounded">{getExpLines(m.key, "direct").length} items</span>
                        </button>
                      ) : (
                        <Input type="number" value={r.direct} onChange={(e: any) => updateCell(m.key, "direct", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-direct-${m.key}`} />
                      )}
                    </Td>
                    <Td className="text-right font-semibold">{fmtINR(d.totalExp)}</Td>
                    <Td className={"text-right font-semibold " + (d.profit >= 0 ? "text-emerald-600" : "text-rose-600")}>
                      {d.profit < 0 ? `Loss ${fmtINR(Math.abs(d.profit))}` : fmtINR(d.profit)}
                    </Td>
                    <Td className={"text-right " + (d.profitPct >= 0 ? "text-emerald-600" : "text-rose-600")}>{d.profitPct.toFixed(2)}%</Td>
                  </tr>
                );
              })}
              <tr className="bg-emerald-50/60 dark:bg-emerald-900/20 font-semibold">
                <Td>FY Total</Td>
                <Td className="text-right">{fmtINR(totals.sales)}</Td>
                <Td className="text-right">{fmtINR(totals.consumed)}</Td>
                <Td className="text-right">{fmtINR(totals.indirect)}</Td>
                <Td className="text-right">{fmtINR(totals.direct)}</Td>
                <Td className="text-right">{fmtINR(totals.totalExp)}</Td>
                <Td className={"text-right " + (totals.profit >= 0 ? "text-emerald-700" : "text-rose-600")}>
                  {totals.profit < 0 ? `Loss ${fmtINR(Math.abs(totals.profit))}` : fmtINR(totals.profit)}
                </Td>
                <Td className={"text-right " + (totalProfitPct >= 0 ? "text-emerald-700" : "text-rose-600")}>{totalProfitPct.toFixed(2)}%</Td>
              </tr>
            </tbody>
          </Table>
        </div>
      </Card>

      {/* Comparison Sheet */}
      <div data-testid="pnl-comparison-card">
      <Card>
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="font-semibold">Comparison Sheet</div>
            <div className="text-xs text-slate-500">Compare 2+ months or 2+ financial years side-by-side. Uses the same auto-cascaded opening stock logic.</div>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg" role="tablist">
            <button
              type="button"
              onClick={() => setCompareMode("month")}
              className={"px-3 py-1 text-xs rounded-md " + (compareMode === "month" ? "bg-white dark:bg-slate-700 shadow font-semibold text-indigo-700" : "text-slate-600 dark:text-slate-300")}
              data-testid="pnl-cmp-mode-month"
            >Compare by Month</button>
            <button
              type="button"
              onClick={() => setCompareMode("year")}
              className={"px-3 py-1 text-xs rounded-md " + (compareMode === "year" ? "bg-white dark:bg-slate-700 shadow font-semibold text-indigo-700" : "text-slate-600 dark:text-slate-300")}
              data-testid="pnl-cmp-mode-year"
            >Compare by Year</button>
          </div>
        </div>

        {/* Selector */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800">
          {compareMode === "month" ? (
            availableMonths.length === 0 ? (
              <Empty title="No months with data yet" subtitle="Enter and save some monthly data first, then come back to compare." />
            ) : (
              <div className="flex flex-wrap gap-1.5" data-testid="pnl-cmp-month-picker">
                {availableMonths.map(k => {
                  const active = selectedMonths.includes(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => toggleMonth(k)}
                      className={"text-xs px-2.5 py-1 rounded-full border transition-colors " + (active
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400")}
                      data-testid={`pnl-cmp-month-${k}`}
                    >{monthLabelFor(k)}</button>
                  );
                })}
                {selectedMonths.length > 0 && (
                  <button type="button" onClick={() => setSelectedMonths([])} className="text-xs px-2 py-1 text-slate-500 hover:text-rose-600 underline" data-testid="pnl-cmp-clear-months">Clear</button>
                )}
              </div>
            )
          ) : (
            availableYears.length === 0 ? (
              <Empty title="No years with data yet" subtitle="Enter and save at least one month of data first, then come back to compare." />
            ) : (
              <div className="flex flex-wrap gap-1.5" data-testid="pnl-cmp-year-picker">
                {availableYears.map(y => {
                  const active = selectedYears.includes(y);
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => toggleYear(y)}
                      className={"text-xs px-3 py-1 rounded-full border transition-colors " + (active
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400")}
                      data-testid={`pnl-cmp-year-${y}`}
                    >{fyLabel(y)}</button>
                  );
                })}
                {selectedYears.length > 0 && (
                  <button type="button" onClick={() => setSelectedYears([])} className="text-xs px-2 py-1 text-slate-500 hover:text-rose-600 underline" data-testid="pnl-cmp-clear-years">Clear</button>
                )}
              </div>
            )
          )}
          <div className="text-[11px] text-slate-500 mt-2">
            {compareCols.length < 2
              ? `Select at least 2 ${compareMode === "month" ? "months" : "years"} to see comparison.`
              : `${compareCols.length} ${compareMode === "month" ? "months" : "years"} selected.`}
          </div>
        </div>

        {/* Comparison table + chart */}
        {compareCols.length >= 2 && (
          <>
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Metric</Th>
                    {compareCols.map(c => (
                      <Th key={c.key} className="text-right">{c.label}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cmpMetrics.map(m => (
                    <tr key={m.label} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <Td className="font-medium">{m.label}</Td>
                      {compareCols.map(c => {
                        const val = m.get(c.data);
                        return (
                          <Td key={c.key} className={"text-right " + metricClass(val, m.kind)} data-testid={`pnl-cmp-cell-${m.label.replace(/\W+/g, "-").toLowerCase()}-${c.key}`}>
                            {formatMetric(val, m.kind)}
                          </Td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            {/* Mini bar charts */}
            <div className="p-4 grid gap-4 lg:grid-cols-3 border-t border-slate-200 dark:border-slate-800">
              <div>
                <div className="text-xs font-medium mb-1 text-indigo-700">Sales (₹ thousands)</div>
                <BarChart data={compareCols.map(c => ({ label: c.label, value: Math.round(c.data.sales / 1000) }))} color="#6366f1" />
              </div>
              <div>
                <div className="text-xs font-medium mb-1 text-amber-700">Total Expenses (₹ thousands)</div>
                <BarChart data={compareCols.map(c => ({ label: c.label, value: Math.round(c.data.totalExp / 1000) }))} color="#f59e0b" />
              </div>
              <div>
                <div className="text-xs font-medium mb-1 text-emerald-700">Profit / Loss (₹ thousands)</div>
                <PnlBarChart data={compareCols.map(c => ({ label: c.label, value: Math.round(c.data.profit / 1000) }))} />
              </div>
            </div>
          </>
        )}
      </Card>
      </div>

      {/* Stock Line Items Drill-down Modal */}
      <Modal
        open={!!viewLines}
        onClose={() => setViewLines(null)}
        title={viewLines
          ? `${viewLines.type === "opening" ? "Opening Stock" : viewLines.type === "purchase" ? "Purchase" : "Closing Stock"} — ${months.find(m => m.key === viewLines.month)?.label || viewLines.month}`
          : ""}
        size="lg"
      >
        {viewLines && (() => {
          const lines = getLines(viewLines.month, viewLines.type);
          const qtySum = lines.reduce((s, l) => s + (l.qty || 0), 0);
          const amtSum = lines.reduce((s, l) => s + (l.amount || 0), 0);
          return (
            <div className="space-y-3" data-testid="pnl-lines-modal">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Line Items</div>
                  <div className="text-lg font-bold">{lines.length}</div>
                </div>
                <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-blue-700">Total Qty</div>
                  <div className="text-lg font-bold text-blue-700">{qtySum.toLocaleString("en-IN")}</div>
                </div>
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-700">Total Amount</div>
                  <div className="text-lg font-bold text-emerald-700">{fmtINR(amtSum)}</div>
                </div>
              </div>
              <div className="max-h-[420px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <Table>
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr>
                      <Th>Product</Th>
                      <Th className="text-right">Quantity</Th>
                      <Th className="text-right">Amount</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr><Td colSpan={4}><Empty title="No line items" /></Td></tr>
                    ) : lines.map(l => (
                      <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <Td className="font-medium">{l.product}</Td>
                        <Td className="text-right">{l.qty.toLocaleString("en-IN")}</Td>
                        <Td className="text-right font-semibold">{fmtINR(l.amount)}</Td>
                        <Td className="text-right">
                          <button
                            type="button"
                            onClick={() => removeLine(viewLines.month, viewLines.type, l.id)}
                            className="text-xs text-rose-600 hover:underline"
                            title="Delete this line item"
                            data-testid={`pnl-line-del-${l.id}`}
                          >Delete</button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="flex items-center justify-between pt-1">
                {lines.length > 0 && (
                  <Button
                    variant="danger"
                    onClick={() => { clearLines(viewLines.month, viewLines.type); setViewLines(null); }}
                    data-testid="pnl-lines-clear"
                  >Delete all line items</Button>
                )}
                <div className="flex-1" />
                <Button variant="ghost" onClick={() => setViewLines(null)} data-testid="pnl-lines-close">Close</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Expense Line Items Drill-down Modal */}
      <Modal
        open={!!viewExpLines}
        onClose={() => setViewExpLines(null)}
        title={viewExpLines
          ? `${viewExpLines.type === "indirect" ? "Indirect Expenses" : "Direct Expenses"} — ${months.find(m => m.key === viewExpLines.month)?.label || viewExpLines.month}`
          : ""}
        size="lg"
      >
        {viewExpLines && (() => {
          const lines = getExpLines(viewExpLines.month, viewExpLines.type);
          const amtSum = lines.reduce((s, l) => s + (l.amount || 0), 0);
          return (
            <div className="space-y-3" data-testid="pnl-exp-lines-modal">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Line Items</div>
                  <div className="text-lg font-bold">{lines.length}</div>
                </div>
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-700">Total Amount</div>
                  <div className="text-lg font-bold text-emerald-700">{fmtINR(amtSum)}</div>
                </div>
              </div>
              <div className="max-h-[420px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <Table>
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr>
                      <Th>Description</Th>
                      <Th className="text-right">Amount</Th>
                      <Th className="text-right">Share</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr><Td colSpan={4}><Empty title="No line items" /></Td></tr>
                    ) : lines.map(l => (
                      <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <Td className="font-medium">{l.description}</Td>
                        <Td className="text-right font-semibold">{fmtINR(l.amount)}</Td>
                        <Td className="text-right text-slate-500">{amtSum > 0 ? ((l.amount / amtSum) * 100).toFixed(1) + "%" : "-"}</Td>
                        <Td className="text-right">
                          <button
                            type="button"
                            onClick={() => removeExpLine(viewExpLines.month, viewExpLines.type, l.id)}
                            className="text-xs text-rose-600 hover:underline"
                            title="Delete this line item"
                            data-testid={`pnl-exp-line-del-${l.id}`}
                          >Delete</button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="flex items-center justify-between pt-1">
                {lines.length > 0 && (
                  <Button
                    variant="danger"
                    onClick={() => { clearExpLines(viewExpLines.month, viewExpLines.type); setViewExpLines(null); }}
                    data-testid="pnl-exp-lines-clear"
                  >Delete all line items</Button>
                )}
                <div className="flex-1" />
                <Button variant="ghost" onClick={() => setViewExpLines(null)} data-testid="pnl-exp-lines-close">Close</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* P&S Report Drill-down Modal (Sales source) */}
      <Modal
        open={!!viewPSMonth}
        onClose={() => setViewPSMonth(null)}
        title={viewPSMonth ? `Sales from P&S Report — ${months.find(m => m.key === viewPSMonth)?.label || viewPSMonth}` : ""}
        size="lg"
      >
        {viewPSMonth && (() => {
          const rows = psRowsFor(viewPSMonth).sort((a, b) => b.amount - a.amount);
          const qtySum = rows.reduce((s, r) => s + r.qty, 0);
          const amtSum = rows.reduce((s, r) => s + r.amount, 0);
          return (
            <div className="space-y-3" data-testid="pnl-ps-modal">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Rows</div>
                  <div className="text-lg font-bold">{rows.length}</div>
                </div>
                <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-blue-700">Total Qty</div>
                  <div className="text-lg font-bold text-blue-700">{qtySum.toLocaleString("en-IN")}</div>
                </div>
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-700">Total Sales</div>
                  <div className="text-lg font-bold text-emerald-700">{fmtINR(amtSum)}</div>
                </div>
              </div>
              <div className="text-[11px] px-3 py-2 rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/40">
                Source: Monthly P&amp;S Report. Add or edit these rows there to change the P&amp;L Sales for this month.
              </div>
              <div className="max-h-[420px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <Table>
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr>
                      <Th>Product</Th>
                      <Th className="text-right">Qty</Th>
                      <Th className="text-right">Sale Price</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><Td colSpan={4}><Empty title="No rows" /></Td></tr>
                    ) : rows.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <Td className="font-medium">{r.product}</Td>
                        <Td className="text-right">{r.qty.toLocaleString("en-IN")}</Td>
                        <Td className="text-right">{fmtINR(r.price)}</Td>
                        <Td className="text-right font-semibold">{fmtINR(r.amount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="flex items-center justify-end pt-1">
                <Button variant="ghost" onClick={() => setViewPSMonth(null)} data-testid="pnl-ps-close">Close</Button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
