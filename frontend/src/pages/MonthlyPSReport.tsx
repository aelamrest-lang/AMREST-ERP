import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Label, Table, Th, Td, Empty, Select, KPI, Modal } from "../components/ui";
import { fmtINR, downloadCSV } from "../lib/utils";
import { BarChart } from "../components/charts";

interface PSRow {
  id: string;
  month: string;    // "YYYY-MM"
  product: string;
  qty: number;
  price: number;
  amount: number;
}

// ---- helpers ----
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleString("en", { month: "short" }) + " " + String(y).slice(2);
};

const fyOf = (key: string): number => {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return 0;
  return m >= 4 ? y : y - 1;
};

const fyLabel = (fy: number) => `FY ${fy}-${String(fy + 1).slice(-2)}`;

/**
 * Normalize a spreadsheet month cell into a "YYYY-MM" key.
 * Accepts formats like: "2026-08", "08/2026", "August 2026", "Aug-26",
 * "Aug 2026", plain numeric Excel date, JS Date etc.
 */
function normalizeMonth(raw: any): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}`;
  }
  if (typeof raw === "number" && raw > 20000 && raw < 80000) {
    // Excel serial date
    const jsDate = new Date(Math.round((raw - 25569) * 86400 * 1000));
    if (!isNaN(jsDate.getTime())) {
      return `${jsDate.getUTCFullYear()}-${String(jsDate.getUTCMonth() + 1).padStart(2, "0")}`;
    }
  }
  const s = String(raw).trim();
  // YYYY-MM or YYYY/MM
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}`;
  // MM/YYYY or MM-YYYY
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, "0")}`;
  // Month name + year: "August 2026", "Aug 2026", "Aug-26", "Aug 26"
  const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const shortNames = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const cleaned = s.toLowerCase().replace(/[.,]/g, "").replace(/[-/]/g, " ").replace(/\s+/g, " ");
  const parts = cleaned.split(" ");
  if (parts.length >= 2) {
    const monIdx1 = monthNames.findIndex(mn => parts[0].startsWith(mn.slice(0, 3)));
    const monIdx2 = shortNames.findIndex(mn => parts[0].startsWith(mn));
    const monIdx = monIdx1 >= 0 ? monIdx1 : monIdx2;
    if (monIdx >= 0) {
      let year = Number(parts[1]);
      if (!isFinite(year)) return null;
      if (year < 100) year = 2000 + year; // "Aug 26" -> 2026
      return `${year}-${String(monIdx + 1).padStart(2, "0")}`;
    }
  }
  // Try JS parse
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  }
  return null;
}

function rowValue(row: Record<string, any>, names: string[]) {
  const normalized = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase().replace(/[^a-z0-9]/g, ""), v]));
  for (const name of names) {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (key in normalized) return normalized[key];
  }
  return undefined;
}

const num = (v: any): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/,/g, "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * P&L-style bar chart that supports negatives (though for P&S values are typically positive).
 * Used to keep visual language consistent with the P&L page.
 */
function SignedBarChart({ data, height = 220, color = "#10b981" }: { data: { label: string; value: number }[]; height?: number; color?: string }) {
  const maxAbs = Math.max(1, ...data.map(d => Math.abs(d.value)));
  const w = 100 / Math.max(1, data.length);
  const H = height / 2;
  const usable = H - 12;
  const zeroY = H / 2 + 2;
  return (
    <div className="w-full">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="#94a3b8" strokeWidth="0.15" strokeDasharray="0.6 0.6" />
        {data.map((d, i) => {
          const h = (Math.abs(d.value) / maxAbs) * (usable / 2);
          const isNeg = d.value < 0;
          const y = isNeg ? zeroY : zeroY - h;
          return (
            <rect key={i}
              x={i * w + w * 0.15}
              y={y}
              width={w * 0.7}
              height={Math.max(0.2, h)}
              fill={isNeg ? "#ef4444" : color}
              rx={0.6}
            >
              <title>{`${d.label}: ${d.value.toLocaleString("en-IN")}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex w-full mt-1">
        {data.map((d, i) => (
          <div key={i} className="text-[10px] text-center truncate leading-tight" style={{ width: `${w}%` }}>
            <div className="text-slate-500 dark:text-slate-400">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MonthlyPSReport() {
  const { db, setDB, log } = useStore();
  const persisted: PSRow[] = ((db.settings as any).monthlyPSRows || []) as PSRow[];
  const overrides: Record<string, { qty?: number; amount?: number }> = ((db.settings as any).monthlyPSOverrides || {});

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadMsg, setUploadMsg] = useState<string>("");

  // Filters
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");

  // Comparison
  const [compareMode, setCompareMode] = useState<"month" | "year">("month");
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);

  // Modals
  const [editRow, setEditRow] = useState<PSRow | null>(null);
  const [editForm, setEditForm] = useState<{ month: string; product: string; qty: string; price: string }>({ month: "", product: "", qty: "", price: "" });
  const [viewProduct, setViewProduct] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState<string | null>(null); // drill-down: items sold in this month
  const [editingQtyMonth, setEditingQtyMonth] = useState<string | null>(null);

  // Derived lookups
  const allMonths = useMemo(() =>
    Array.from(new Set(persisted.map(r => r.month))).sort(), [persisted]);
  const allProducts = useMemo(() =>
    Array.from(new Set(persisted.map(r => r.product))).sort((a, b) => a.localeCompare(b)), [persisted]);
  const allYears = useMemo(() => {
    const s = new Set<number>();
    persisted.forEach(r => s.add(fyOf(r.month)));
    return Array.from(s).sort((a, b) => a - b);
  }, [persisted]);

  // Filtered
  const filtered = useMemo(() => persisted.filter(r =>
    (monthFilter === "all" || r.month === monthFilter) &&
    (productFilter === "all" || r.product === productFilter)
  ), [persisted, monthFilter, productFilter]);

  // Monthly aggregates from filtered — layered with manual overrides (if any)
  const monthlyAgg = useMemo(() => {
    const map = new Map<string, { qty: number; amount: number; isOverridden: boolean; autoQty: number; autoAmount: number }>();
    filtered.forEach(r => {
      const cur = map.get(r.month) || { qty: 0, amount: 0, isOverridden: false, autoQty: 0, autoAmount: 0 };
      cur.autoQty += r.qty;
      cur.autoAmount += r.amount;
      map.set(r.month, cur);
    });
    // Layer overrides (only when no product filter is active, since overrides are month-level)
    map.forEach((v, k) => {
      const o = overrides[k];
      const overrideAllowed = productFilter === "all";
      if (overrideAllowed && o && (o.qty !== undefined || o.amount !== undefined)) {
        v.qty = o.qty !== undefined ? o.qty : v.autoQty;
        v.amount = o.amount !== undefined ? o.amount : v.autoAmount;
        v.isOverridden = true;
      } else {
        v.qty = v.autoQty;
        v.amount = v.autoAmount;
        v.isOverridden = false;
      }
    });
    return Array.from(map.entries())
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [filtered, overrides, productFilter]);

  // Product aggregates from filtered
  const productAgg = useMemo(() => {
    const map = new Map<string, { qty: number; amount: number }>();
    filtered.forEach(r => {
      const cur = map.get(r.product) || { qty: 0, amount: 0 };
      cur.qty += r.qty;
      cur.amount += r.amount;
      map.set(r.product, cur);
    });
    return Array.from(map.entries())
      .map(([product, v]) => ({ product, ...v }))
      .sort((a, b) => b.amount - a.amount);
  }, [filtered]);

  // Grand totals reflect any overrides shown in the Monthly Summary
  const totalQty = monthlyAgg.reduce((s, m) => s + m.qty, 0);
  const totalAmount = monthlyAgg.reduce((s, m) => s + m.amount, 0);

  // ---- Excel upload ----
  const handleUpload = async (file?: File) => {
    if (!file) return;
    setUploadMsg("Reading Excel file...");
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      if (!rows.length) throw new Error("No rows found in file.");

      const parsed: PSRow[] = [];
      let skipped = 0;
      rows.forEach(r => {
        const monthRaw = rowValue(r, ["Month", "Sale Month", "Period"]);
        const product = String(rowValue(r, ["Product Name", "Product", "Item", "Item Name"]) || "").trim();
        const qty = num(rowValue(r, ["Quantity Sold", "Qty Sold", "Quantity", "Qty"]));
        const price = num(rowValue(r, ["Item Sale Price", "Sale Price", "Price", "Rate"]));
        const givenAmount = num(rowValue(r, ["Total Sale Amount", "Total", "Amount"]));
        const month = normalizeMonth(monthRaw);
        if (!month || !product) { skipped++; return; }
        const amount = qty * price > 0 ? qty * price : givenAmount; // prefer qty*price, fall back to given
        parsed.push({ id: uid(), month, product, qty, price, amount: amount || (qty * price) });
      });

      if (!parsed.length) {
        setUploadMsg(`Upload failed: no valid rows. Ensure Month and Product Name columns are filled.`);
        return;
      }

      setDB(d => ({
        ...d,
        settings: {
          ...d.settings,
          monthlyPSRows: [...((d.settings as any).monthlyPSRows || []), ...parsed],
        } as any,
      }));
      log(`P&S Report: uploaded ${parsed.length} rows${skipped ? ` (${skipped} skipped)` : ""}`, "P&S Report");
      setUploadMsg(`Uploaded ${parsed.length} rows${skipped ? `, ${skipped} skipped (missing Month or Product).` : "."}`);
    } catch (e: any) {
      setUploadMsg(`Error: ${e?.message || "Failed to read the file."}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const downloadTemplate = () => {
    downloadCSV("monthly-ps-report-template.csv", [
      ["Month", "Product Name", "Quantity Sold", "Item Sale Price", "Total Sale Amount"],
      ["2026-04", "11 KV Distribution Transformer 100 KVA", 5, 150000, 750000],
      ["2026-04", "11 KV Distribution Transformer 250 KVA", 3, 320000, 960000],
      ["Aug 2026", "Isolator 33KV", 12, 45000, 540000],
      ["May-26", "11 KV Distribution Transformer 100 KVA", 4, 150000, 600000],
    ]);
  };

  const clearAll = () => {
    if (!persisted.length) return;
    if (!confirm(`Delete all ${persisted.length} uploaded P&S rows? This cannot be undone.`)) return;
    setDB(d => ({ ...d, settings: { ...d.settings, monthlyPSRows: [] } as any }));
    log(`P&S Report: cleared all rows`, "P&S Report");
    setUploadMsg("All rows cleared.");
    setSelectedMonths([]); setSelectedYears([]); setMonthFilter("all"); setProductFilter("all");
  };

  const removeRow = (id: string) => {
    setDB(d => ({ ...d, settings: { ...d.settings, monthlyPSRows: ((d.settings as any).monthlyPSRows || []).filter((r: PSRow) => r.id !== id) } as any }));
  };

  // ---- Comparison computations (applies month-level overrides when no product filter) ----
  const applyOverride = (m: string, autoQty: number, autoAmount: number) => {
    if (productFilter !== "all") return { qty: autoQty, amount: autoAmount };
    const o = overrides[m];
    if (!o) return { qty: autoQty, amount: autoAmount };
    return {
      qty: o.qty !== undefined ? o.qty : autoQty,
      amount: o.amount !== undefined ? o.amount : autoAmount,
    };
  };
  const computeForMonth = (m: string) => {
    const rows = persisted.filter(r => r.month === m && (productFilter === "all" || r.product === productFilter));
    const autoQty = rows.reduce((s, r) => s + r.qty, 0);
    const autoAmount = rows.reduce((s, r) => s + r.amount, 0);
    const { qty, amount } = applyOverride(m, autoQty, autoAmount);
    return { qty, amount, lines: rows.length };
  };
  const computeForYear = (fy: number) => {
    const monthsInFy = Array.from(new Set(persisted.filter(r => fyOf(r.month) === fy).map(r => r.month)));
    let qty = 0, amount = 0, lines = 0;
    monthsInFy.forEach(m => {
      const rows = persisted.filter(r => r.month === m && (productFilter === "all" || r.product === productFilter));
      const autoQty = rows.reduce((s, r) => s + r.qty, 0);
      const autoAmount = rows.reduce((s, r) => s + r.amount, 0);
      const applied = applyOverride(m, autoQty, autoAmount);
      qty += applied.qty; amount += applied.amount; lines += rows.length;
    });
    return { qty, amount, lines };
  };
  const cmpCols = compareMode === "month"
    ? selectedMonths.map(k => ({ key: k, label: monthLabel(k), data: computeForMonth(k) }))
    : selectedYears.map(y => ({ key: String(y), label: fyLabel(y), data: computeForYear(y) }));
  const toggleMonth = (k: string) => setSelectedMonths(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k].sort());
  const toggleYear = (y: number) => setSelectedYears(prev => prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y].sort((a, b) => a - b));

  // ---- Monthly Summary override handlers ----
  const saveOverride = (month: string, field: "qty" | "amount", raw: string) => {
    const parsed = raw.trim() === "" ? undefined : Math.max(0, Number(raw) || 0);
    setDB(d => {
      const cur = { ...((d.settings as any).monthlyPSOverrides || {}) };
      const existing = { ...(cur[month] || {}) };
      if (parsed === undefined) delete existing[field]; else existing[field] = parsed;
      if (existing.qty === undefined && existing.amount === undefined) delete cur[month];
      else cur[month] = existing;
      return { ...d, settings: { ...d.settings, monthlyPSOverrides: cur } as any };
    });
  };
  const resetMonth = (month: string) => {
    setDB(d => {
      const cur = { ...((d.settings as any).monthlyPSOverrides || {}) };
      delete cur[month];
      return { ...d, settings: { ...d.settings, monthlyPSOverrides: cur } as any };
    });
    log(`P&S: reset override for ${monthLabel(month)}`, "P&S Report");
  };

  // ---- Row edit ----
  const openEdit = (r: PSRow) => {
    setEditRow(r);
    setEditForm({ month: r.month, product: r.product, qty: String(r.qty), price: String(r.price) });
  };
  const saveEdit = () => {
    if (!editRow) return;
    const monthKey = normalizeMonth(editForm.month) || editRow.month;
    const product = editForm.product.trim() || editRow.product;
    const qty = Math.max(0, Number(editForm.qty) || 0);
    const price = Math.max(0, Number(editForm.price) || 0);
    const amount = qty * price;
    setDB(d => ({
      ...d,
      settings: {
        ...d.settings,
        monthlyPSRows: ((d.settings as any).monthlyPSRows || []).map((r: PSRow) => r.id === editRow.id ? { ...r, month: monthKey, product, qty, price, amount } : r),
      } as any,
    }));
    log(`P&S: edited row ${product} — ${monthLabel(monthKey)}`, "P&S Report");
    setEditRow(null);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Monthly P&amp;S Report</h1>
          <p className="text-sm text-slate-500">Upload monthly product-wise sales from Excel · month/product filters, comparison and trend charts</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => handleUpload(e.target.files?.[0])} data-testid="ps-upload-input" />
          <Button variant="outline" onClick={() => fileRef.current?.click()} data-testid="ps-upload-btn">Upload Excel</Button>
          <Button variant="ghost" onClick={downloadTemplate} data-testid="ps-template-btn">Download Template</Button>
          {persisted.length > 0 && (
            <Button variant="danger" onClick={clearAll} data-testid="ps-clear-btn">Clear All</Button>
          )}
        </div>
      </div>
      {uploadMsg && (
        <div className={"text-xs px-3 py-2 rounded-md " + (uploadMsg.startsWith("Error") ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")} data-testid="ps-upload-msg">{uploadMsg}</div>
      )}

      {persisted.length === 0 ? (
        <Card>
          <div className="p-8">
            <Empty
              title="No P&S data yet"
              subtitle='Click "Upload Excel" above to import your monthly sales sheet. Required columns: Month, Product Name, Quantity Sold, Item Sale Price. Total is auto-calculated. Use "Download Template" for a sample.'
            />
          </div>
        </Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <KPI label="Total Rows" value={String(filtered.length)} color="indigo" hint={filtered.length !== persisted.length ? `of ${persisted.length} total` : undefined} />
            <KPI label="Total Qty Sold" value={totalQty.toLocaleString("en-IN")} color="blue" />
            <KPI label="Total Sales Amount" value={fmtINR(totalAmount)} color="emerald" />
            <KPI label="Months / Products" value={`${monthlyAgg.length} / ${productAgg.length}`} color="amber" />
          </div>

          {/* Filters */}
          <Card>
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 font-semibold">Filters</div>
            <div className="p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Month</Label>
                <Select value={monthFilter} onChange={(e: any) => setMonthFilter(e.target.value)} data-testid="ps-filter-month">
                  <option value="all">All Months</option>
                  {allMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </Select>
              </div>
              <div>
                <Label>Product</Label>
                <Select value={productFilter} onChange={(e: any) => setProductFilter(e.target.value)} data-testid="ps-filter-product">
                  <option value="all">All Products</option>
                  {allProducts.map(p => <option key={p} value={p}>{p}</option>)}
                </Select>
              </div>
              <div className="flex items-end">
                {(monthFilter !== "all" || productFilter !== "all") && (
                  <Button variant="ghost" onClick={() => { setMonthFilter("all"); setProductFilter("all"); }} data-testid="ps-filter-clear">Clear Filters</Button>
                )}
              </div>
            </div>
          </Card>

          {/* Charts */}
          <Card>
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
              <div className="font-semibold">Monthly Trend</div>
              <div className="text-xs text-slate-500">
                <span className="inline-block w-3 h-3 rounded-sm bg-indigo-500 mr-1 align-middle"/> Total Sales
                <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500 ml-3 mr-1 align-middle"/> Total Qty
              </div>
            </div>
            {monthlyAgg.length === 0 ? (
              <div className="p-6"><Empty title="No data matches filters" /></div>
            ) : (
              <div className="p-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="text-xs font-medium mb-1 text-indigo-700">Total Sales (₹ thousands)</div>
                  <BarChart data={monthlyAgg.map(m => ({ label: monthLabel(m.month), value: Math.round(m.amount / 1000) }))} color="#6366f1" />
                </div>
                <div>
                  <div className="text-xs font-medium mb-1 text-emerald-700">Total Quantity Sold</div>
                  <BarChart data={monthlyAgg.map(m => ({ label: monthLabel(m.month), value: m.qty }))} color="#10b981" />
                </div>
              </div>
            )}
          </Card>

          {/* Monthly Summary Table (editable) */}
          <Card>
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="font-semibold">Monthly Summary</div>
                <div className="text-xs text-slate-500">
                  Click <strong>Total Qty Sold</strong> to see items sold that month · click the ✎ pencil to override qty · Total Sales Amount is inline-editable. Overrides only apply when no product filter is active.
                  {productFilter !== "all" && <span className="ml-1 text-amber-600">Editing disabled — clear product filter to edit.</span>}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Month</Th>
                    <Th className="text-right">Total Qty Sold</Th>
                    <Th className="text-right">Total Sales Amount</Th>
                    <Th className="text-right">Avg Price / Unit</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyAgg.length === 0 ? (
                    <tr><Td colSpan={5}><Empty title="No data" /></Td></tr>
                  ) : monthlyAgg.map(m => {
                    const editable = productFilter === "all";
                    return (
                      <tr key={m.month} className={"hover:bg-slate-50 dark:hover:bg-slate-800/50 " + (m.isOverridden ? "bg-amber-50/50 dark:bg-amber-900/10" : "")}>
                        <Td className="font-medium">
                          {monthLabel(m.month)}
                          {m.isOverridden && <span className="ml-2 text-[9px] font-semibold text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5 rounded" title="Values manually overridden">OVERRIDE</span>}
                        </Td>
                        <Td className="text-right">
                          {editingQtyMonth === m.month && editable ? (
                            <Input
                              type="number"
                              autoFocus
                              defaultValue={m.qty}
                              onBlur={(e: any) => {
                                const v = e.target.value;
                                if (Number(v) === m.autoQty) saveOverride(m.month, "qty", "");
                                else if (String(v) !== String(m.qty)) saveOverride(m.month, "qty", v);
                                setEditingQtyMonth(null);
                              }}
                              onKeyDown={(e: any) => {
                                if (e.key === "Enter") { e.currentTarget.blur(); }
                                else if (e.key === "Escape") { setEditingQtyMonth(null); }
                              }}
                              className="text-right py-1 h-8 min-w-32 ml-auto"
                              data-testid={`ps-summary-qty-input-${m.month}`}
                            />
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setViewMonth(m.month)}
                                className="text-indigo-700 font-semibold hover:underline"
                                title="View items sold in this month"
                                data-testid={`ps-summary-qty-${m.month}`}
                              >{m.qty.toLocaleString("en-IN")}</button>
                              {editable && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setEditingQtyMonth(m.month); }}
                                  className="text-slate-400 hover:text-indigo-600 text-xs"
                                  title="Edit total qty (override)"
                                  data-testid={`ps-summary-qty-edit-${m.month}`}
                                  aria-label="Edit qty"
                                >✎</button>
                              )}
                            </div>
                          )}
                        </Td>
                        <Td className="text-right">
                          <Input
                            type="number"
                            defaultValue={m.amount}
                            key={`amt-${m.month}-${m.amount}-${m.isOverridden}`}
                            disabled={!editable}
                            onBlur={(e: any) => {
                              const v = e.target.value;
                              if (Number(v) === m.autoAmount) {
                                saveOverride(m.month, "amount", "");
                              } else if (String(v) !== String(m.amount)) {
                                saveOverride(m.month, "amount", v);
                              }
                            }}
                            className="text-right py-1 h-8 min-w-36 ml-auto"
                            data-testid={`ps-summary-amt-${m.month}`}
                          />
                        </Td>
                        <Td className="text-right text-slate-500">{m.qty > 0 ? fmtINR(m.amount / m.qty) : "-"}</Td>
                        <Td className="text-right">
                          {m.isOverridden && editable && (
                            <button
                              type="button"
                              onClick={() => resetMonth(m.month)}
                              className="text-[10px] text-slate-500 hover:text-indigo-600 underline"
                              data-testid={`ps-summary-reset-${m.month}`}
                            >reset</button>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                  {monthlyAgg.length > 0 && (
                    <tr className="bg-slate-50 dark:bg-slate-800/40 font-semibold">
                      <Td>Total</Td>
                      <Td className="text-right">{totalQty.toLocaleString("en-IN")}</Td>
                      <Td className="text-right text-indigo-700">{fmtINR(totalAmount)}</Td>
                      <Td className="text-right text-slate-500">{totalQty > 0 ? fmtINR(totalAmount / totalQty) : "-"}</Td>
                      <Td></Td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </Card>

          {/* Product-wise Sales card hidden — access via clicking Total Qty Sold in Monthly Summary above */}

          {/* Raw Rows */}
          <Card>
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="font-semibold">Uploaded Rows</div>
                <div className="text-xs text-slate-500">Click any row to edit its values</div>
              </div>
              <div className="text-xs text-slate-500">{filtered.length} shown</div>
            </div>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <Table>
                <thead className="sticky top-0">
                  <tr>
                    <Th>Month</Th>
                    <Th>Product</Th>
                    <Th className="text-right">Qty Sold</Th>
                    <Th className="text-right">Sale Price</Th>
                    <Th className="text-right">Total Amount</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><Td colSpan={6}><Empty title="No rows" /></Td></tr>
                  ) : filtered.map(r => (
                    <tr
                      key={r.id}
                      className="hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 cursor-pointer transition-colors"
                      onClick={() => openEdit(r)}
                      data-testid={`ps-row-${r.id}`}
                    >
                      <Td className="font-medium">{monthLabel(r.month)}</Td>
                      <Td className="text-indigo-700 hover:underline">{r.product}</Td>
                      <Td className="text-right">{r.qty.toLocaleString("en-IN")}</Td>
                      <Td className="text-right">{fmtINR(r.price)}</Td>
                      <Td className="text-right font-semibold">{fmtINR(r.amount)}</Td>
                      <Td>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeRow(r.id); }}
                          className="text-xs text-rose-600 hover:underline"
                          title="Delete this row"
                          data-testid={`ps-row-del-${r.id}`}
                        >Delete</button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>

          {/* Comparison Sheet */}
          <div data-testid="ps-comparison-card">
            <Card>
              <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold">Comparison Sheet</div>
                  <div className="text-xs text-slate-500">
                    Compare 2+ months or 2+ financial years side-by-side.
                    {productFilter !== "all" && <span className="ml-1 text-indigo-600">Filtered by product: {productFilter}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setCompareMode("month")}
                    className={"px-3 py-1 text-xs rounded-md " + (compareMode === "month" ? "bg-white dark:bg-slate-700 shadow font-semibold text-indigo-700" : "text-slate-600 dark:text-slate-300")}
                    data-testid="ps-cmp-mode-month"
                  >Compare by Month</button>
                  <button
                    type="button"
                    onClick={() => setCompareMode("year")}
                    className={"px-3 py-1 text-xs rounded-md " + (compareMode === "year" ? "bg-white dark:bg-slate-700 shadow font-semibold text-indigo-700" : "text-slate-600 dark:text-slate-300")}
                    data-testid="ps-cmp-mode-year"
                  >Compare by Year</button>
                </div>
              </div>

              <div className="p-3 border-b border-slate-200 dark:border-slate-800">
                {compareMode === "month" ? (
                  <div className="flex flex-wrap gap-1.5" data-testid="ps-cmp-month-picker">
                    {allMonths.length === 0
                      ? <div className="text-xs text-slate-500">No months available.</div>
                      : allMonths.map(k => {
                        const active = selectedMonths.includes(k);
                        return (
                          <button key={k} type="button" onClick={() => toggleMonth(k)}
                            className={"text-xs px-2.5 py-1 rounded-full border transition-colors " + (active
                              ? "bg-indigo-600 border-indigo-600 text-white"
                              : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400")}
                            data-testid={`ps-cmp-month-${k}`}
                          >{monthLabel(k)}</button>
                        );
                      })}
                    {selectedMonths.length > 0 && (
                      <button type="button" onClick={() => setSelectedMonths([])} className="text-xs px-2 py-1 text-slate-500 hover:text-rose-600 underline">Clear</button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5" data-testid="ps-cmp-year-picker">
                    {allYears.length === 0
                      ? <div className="text-xs text-slate-500">No years available.</div>
                      : allYears.map(y => {
                        const active = selectedYears.includes(y);
                        return (
                          <button key={y} type="button" onClick={() => toggleYear(y)}
                            className={"text-xs px-3 py-1 rounded-full border transition-colors " + (active
                              ? "bg-indigo-600 border-indigo-600 text-white"
                              : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400")}
                            data-testid={`ps-cmp-year-${y}`}
                          >{fyLabel(y)}</button>
                        );
                      })}
                    {selectedYears.length > 0 && (
                      <button type="button" onClick={() => setSelectedYears([])} className="text-xs px-2 py-1 text-slate-500 hover:text-rose-600 underline">Clear</button>
                    )}
                  </div>
                )}
                <div className="text-[11px] text-slate-500 mt-2">
                  {cmpCols.length < 2
                    ? `Select at least 2 ${compareMode === "month" ? "months" : "years"} to see comparison.`
                    : `${cmpCols.length} ${compareMode === "month" ? "months" : "years"} selected.`}
                </div>
              </div>

              {cmpCols.length >= 2 && (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <thead>
                        <tr>
                          <Th>Metric</Th>
                          {cmpCols.map(c => <Th key={c.key} className="text-right">{c.label}</Th>)}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <Td className="font-medium">Total Qty Sold</Td>
                          {cmpCols.map(c => <Td key={c.key} className="text-right">{c.data.qty.toLocaleString("en-IN")}</Td>)}
                        </tr>
                        <tr>
                          <Td className="font-medium">Total Sales Amount</Td>
                          {cmpCols.map(c => <Td key={c.key} className="text-right font-semibold text-emerald-600">{fmtINR(c.data.amount)}</Td>)}
                        </tr>
                        <tr>
                          <Td className="font-medium">Avg Price / Unit</Td>
                          {cmpCols.map(c => <Td key={c.key} className="text-right text-slate-500">{c.data.qty > 0 ? fmtINR(c.data.amount / c.data.qty) : "-"}</Td>)}
                        </tr>
                        <tr>
                          <Td className="font-medium">Line Items</Td>
                          {cmpCols.map(c => <Td key={c.key} className="text-right text-slate-500">{c.data.lines}</Td>)}
                        </tr>
                      </tbody>
                    </Table>
                  </div>
                  <div className="p-4 grid gap-4 lg:grid-cols-2 border-t border-slate-200 dark:border-slate-800">
                    <div>
                      <div className="text-xs font-medium mb-1 text-indigo-700">Total Sales (₹ thousands)</div>
                      <SignedBarChart data={cmpCols.map(c => ({ label: c.label, value: Math.round(c.data.amount / 1000) }))} color="#6366f1" />
                    </div>
                    <div>
                      <div className="text-xs font-medium mb-1 text-emerald-700">Total Qty Sold</div>
                      <SignedBarChart data={cmpCols.map(c => ({ label: c.label, value: c.data.qty }))} color="#10b981" />
                    </div>
                  </div>
                </>
              )}
            </Card>
          </div>
        </>
      )}

      {/* Row Edit Modal */}
      <Modal open={!!editRow} onClose={() => setEditRow(null)} title="Edit Sale Row" size="md">
        {editRow && (
          <div className="space-y-3" data-testid="ps-edit-modal">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Month (YYYY-MM or "Aug 2026")</Label>
                <Input value={editForm.month} onChange={(e: any) => setEditForm(f => ({ ...f, month: e.target.value }))} data-testid="ps-edit-month" />
                {normalizeMonth(editForm.month) === null && editForm.month.trim() !== "" && (
                  <div className="text-[10px] text-rose-600 mt-1">Could not parse — will keep original month.</div>
                )}
              </div>
              <div>
                <Label>Product Name</Label>
                <Input value={editForm.product} onChange={(e: any) => setEditForm(f => ({ ...f, product: e.target.value }))} data-testid="ps-edit-product" />
              </div>
              <div>
                <Label>Quantity Sold</Label>
                <Input type="number" value={editForm.qty} onChange={(e: any) => setEditForm(f => ({ ...f, qty: e.target.value }))} data-testid="ps-edit-qty" />
              </div>
              <div>
                <Label>Item Sale Price</Label>
                <Input type="number" value={editForm.price} onChange={(e: any) => setEditForm(f => ({ ...f, price: e.target.value }))} data-testid="ps-edit-price" />
              </div>
            </div>
            <div className="text-sm bg-slate-50 dark:bg-slate-800 rounded-md p-2.5">
              <span className="text-slate-500">Total = Qty × Price = </span>
              <span className="font-semibold text-indigo-700">{fmtINR((Number(editForm.qty) || 0) * (Number(editForm.price) || 0))}</span>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setEditRow(null)} data-testid="ps-edit-cancel">Cancel</Button>
              <Button onClick={saveEdit} data-testid="ps-edit-save">Save changes</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Product Drill-down Modal */}
      <Modal open={!!viewProduct} onClose={() => setViewProduct(null)} title={viewProduct ? `Sales — ${viewProduct}` : ""} size="lg">
        {viewProduct && (() => {
          const rows = persisted.filter(r =>
            r.product === viewProduct &&
            (monthFilter === "all" || r.month === monthFilter)
          ).sort((a, b) => a.month.localeCompare(b.month));
          const qtySum = rows.reduce((s, r) => s + r.qty, 0);
          const amtSum = rows.reduce((s, r) => s + r.amount, 0);
          return (
            <div className="space-y-3" data-testid="ps-product-view">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Line Items</div>
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
              <div className="max-h-[400px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <Table>
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr>
                      <Th>Month</Th>
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
                        <Td className="font-medium">{monthLabel(r.month)}</Td>
                        <Td className="text-right">{r.qty.toLocaleString("en-IN")}</Td>
                        <Td className="text-right">{fmtINR(r.price)}</Td>
                        <Td className="text-right font-semibold">{fmtINR(r.amount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="flex items-center justify-end pt-1">
                <Button variant="ghost" onClick={() => setViewProduct(null)} data-testid="ps-product-view-close">Close</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Month Drill-down Modal — items sold in a specific month */}
      <Modal open={!!viewMonth} onClose={() => setViewMonth(null)} title={viewMonth ? `Items Sold — ${monthLabel(viewMonth)}` : ""} size="lg">
        {viewMonth && (() => {
          const rows = persisted.filter(r => r.month === viewMonth).sort((a, b) => b.amount - a.amount);
          const qtySum = rows.reduce((s, r) => s + r.qty, 0);
          const amtSum = rows.reduce((s, r) => s + r.amount, 0);
          const productBreakdown = new Map<string, { qty: number; amount: number; lines: number }>();
          rows.forEach(r => {
            const cur = productBreakdown.get(r.product) || { qty: 0, amount: 0, lines: 0 };
            cur.qty += r.qty; cur.amount += r.amount; cur.lines += 1;
            productBreakdown.set(r.product, cur);
          });
          const products = Array.from(productBreakdown.entries())
            .map(([product, v]) => ({ product, ...v }))
            .sort((a, b) => b.amount - a.amount);
          const override = overrides[viewMonth];
          const hasOverride = override && (override.qty !== undefined || override.amount !== undefined);
          return (
            <div className="space-y-3" data-testid="ps-month-view">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Distinct Products</div>
                  <div className="text-lg font-bold">{products.length}</div>
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
              {hasOverride && (
                <div className="text-[11px] px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40">
                  Note: this month has manual overrides on the summary
                  ({override.qty !== undefined && `Qty=${override.qty.toLocaleString("en-IN")}`}
                  {override.qty !== undefined && override.amount !== undefined && ", "}
                  {override.amount !== undefined && `Amount=${fmtINR(override.amount)}`}).
                  The values below are the raw uploaded rows.
                </div>
              )}
              <div className="max-h-[420px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <Table>
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr>
                      <Th>Product</Th>
                      <Th className="text-right">Qty</Th>
                      <Th className="text-right">Total Amount</Th>
                      <Th className="text-right">Share</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.length === 0 ? (
                      <tr><Td colSpan={4}><Empty title="No items in this month" /></Td></tr>
                    ) : products.map(p => (
                      <tr
                        key={p.product}
                        className="hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 cursor-pointer"
                        onClick={() => { setViewMonth(null); setViewProduct(p.product); }}
                        data-testid={`ps-month-product-${p.product.replace(/\W+/g, "-").toLowerCase()}`}
                        title="Click to open product drill-down"
                      >
                        <Td className="font-medium text-indigo-700 hover:underline">{p.product}</Td>
                        <Td className="text-right">{p.qty.toLocaleString("en-IN")}</Td>
                        <Td className="text-right font-semibold">{fmtINR(p.amount)}</Td>
                        <Td className="text-right text-slate-500">{amtSum > 0 ? ((p.amount / amtSum) * 100).toFixed(1) + "%" : "-"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="flex items-center justify-end pt-1">
                <Button variant="ghost" onClick={() => setViewMonth(null)} data-testid="ps-month-view-close">Close</Button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
