import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { Card, Button, Input, Label, Table, Th, Td, Empty } from "../components/ui";
import { fmtINR } from "../lib/utils";
import { BarChart } from "../components/charts";

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
  const persistedRows: PnlRow[] = months.map(m => {
    const p = persisted[m.key] || {};
    return {
      key: m.key,
      // Treat missing/null as "auto" so it inherits from previous month's closing
      opening: (p.opening === undefined || p.opening === null) ? null : Number(p.opening),
      purchase: Number(p.purchase) || 0,
      closing: Number(p.closing) || 0,
      sales: Number(p.sales) || 0,
      indirect: Number(p.indirect) || 0,
      direct: Number(p.direct) || 0,
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

  const salesChart = months.map((m, i) => ({ label: m.label, value: Math.round((resolved[i].sales) / 1000) }));
  const expChart = months.map((m, i) => ({ label: m.label, value: Math.round(derive(resolved[i].resolvedOpening, resolved[i]).totalExp / 1000) }));
  const profitChart = months.map((m, i) => ({ label: m.label, value: Math.round(derive(resolved[i].resolvedOpening, resolved[i]).profit / 1000) }));

  const hasAnyData = resolved.some(r => r.sales > 0 || r.purchase > 0 || r.resolvedOpening > 0 || r.closing > 0 || r.indirect > 0 || r.direct > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Monthly Profit &amp; Loss</h1>
          <p className="text-sm text-slate-500">Manual month-wise entry · Closing Stock auto-flows to next month&apos;s Opening Stock (still editable)</p>
        </div>
        <div className="flex items-end gap-2">
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
                        <Input
                          type="number"
                          value={r.resolvedOpening}
                          onChange={(e: any) => updateCell(m.key, "opening", Number(e.target.value) || 0)}
                          className="text-right py-1 h-8 min-w-32 ml-auto"
                          data-testid={`pnl-open-${m.key}`}
                          title={r.isOpeningAuto && i > 0 ? "Auto: inherited from previous month's closing stock. Edit to override." : ""}
                        />
                        {r.isOpeningAuto && i > 0 && r.resolvedOpening > 0 && (
                          <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-1 rounded" title="Auto-carried from previous month's Closing Stock">AUTO</span>
                        )}
                        {!r.isOpeningAuto && (
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
                    <Td><Input type="number" value={r.purchase} onChange={(e: any) => updateCell(m.key, "purchase", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-purchase-${m.key}`} /></Td>
                    <Td><Input type="number" value={r.closing} onChange={(e: any) => updateCell(m.key, "closing", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-close-${m.key}`} /></Td>
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
                    <Td><Input type="number" value={r.sales} onChange={(e: any) => updateCell(m.key, "sales", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-sales-${m.key}`} /></Td>
                    <Td className="text-right">{fmtINR(d.consumed)}</Td>
                    <Td><Input type="number" value={r.indirect} onChange={(e: any) => updateCell(m.key, "indirect", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-indirect-${m.key}`} /></Td>
                    <Td><Input type="number" value={r.direct} onChange={(e: any) => updateCell(m.key, "direct", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-direct-${m.key}`} /></Td>
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
    </div>
  );
}
