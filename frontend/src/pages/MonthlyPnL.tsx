import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { Card, Button, Input, Label, Table, Th, Td, Empty } from "../components/ui";
import { fmtINR } from "../lib/utils";
import { BarChart } from "../components/charts";

interface PnlRow {
  key: string; // "YYYY-MM"
  opening: number;
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

export function MonthlyPnL() {
  const { db, setDB, log } = useStore();
  const now = new Date();
  const fyDefault = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [fy, setFy] = useState<number>(fyDefault);

  const months = useMemo(() => fyKeys(fy), [fy]);

  const persisted = (db.settings as any).monthlyPnl || {};
  const rows: PnlRow[] = months.map(m => {
    const p = persisted[m.key] || {};
    return {
      key: m.key,
      opening: Number(p.opening) || 0,
      purchase: Number(p.purchase) || 0,
      closing: Number(p.closing) || 0,
      sales: Number(p.sales) || 0,
      indirect: Number(p.indirect) || 0,
      direct: Number(p.direct) || 0,
    };
  });

  const [draft, setDraft] = useState<Record<string, PnlRow>>({});
  const currentRow = (key: string): PnlRow => draft[key] || rows.find(r => r.key === key)!;

  const updateCell = (key: string, field: keyof PnlRow, value: number) => {
    setDraft(prev => ({ ...prev, [key]: { ...currentRow(key), [field]: Math.max(0, value) } }));
  };

  const derive = (r: PnlRow) => {
    const consumed = r.opening + r.purchase - r.closing;
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
  const totals = rows.reduce((t, key) => {
    const r = currentRow(key.key);
    const d = derive(r);
    return {
      opening: t.opening + r.opening,
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

  const salesChart = months.map(m => ({ label: m.label, value: Math.round((currentRow(m.key).sales) / 1000) }));
  const expChart = months.map(m => ({ label: m.label, value: Math.round(derive(currentRow(m.key)).totalExp / 1000) }));
  const profitChart = months.map(m => ({ label: m.label, value: Math.round(derive(currentRow(m.key)).profit / 1000) }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Monthly Profit &amp; Loss</h1>
          <p className="text-sm text-slate-500">Stock consumption → P&amp;L calculation with auto totals and monthly trend</p>
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
              {months.map(m => {
                const r = currentRow(m.key);
                const d = derive(r);
                return (
                  <tr key={m.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Td className="font-medium">{m.label}</Td>
                    <Td><Input type="number" value={r.opening} onChange={(e: any) => updateCell(m.key, "opening", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-open-${m.key}`} /></Td>
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
              {months.map(m => {
                const r = currentRow(m.key);
                const d = derive(r);
                return (
                  <tr key={m.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Td className="font-medium">{m.label}</Td>
                    <Td><Input type="number" value={r.sales} onChange={(e: any) => updateCell(m.key, "sales", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-sales-${m.key}`} /></Td>
                    <Td className="text-right">{fmtINR(d.consumed)}</Td>
                    <Td><Input type="number" value={r.indirect} onChange={(e: any) => updateCell(m.key, "indirect", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-indirect-${m.key}`} /></Td>
                    <Td><Input type="number" value={r.direct} onChange={(e: any) => updateCell(m.key, "direct", Number(e.target.value) || 0)} className="text-right py-1 h-8 min-w-32 ml-auto" data-testid={`pnl-direct-${m.key}`} /></Td>
                    <Td className="text-right font-semibold">{fmtINR(d.totalExp)}</Td>
                    <Td className={"text-right font-semibold " + (d.profit >= 0 ? "text-emerald-600" : "text-rose-600")}>{fmtINR(d.profit)}</Td>
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
                <Td className={"text-right " + (totals.profit >= 0 ? "text-emerald-700" : "text-rose-600")}>{fmtINR(totals.profit)}</Td>
                <Td className={"text-right " + (totalProfitPct >= 0 ? "text-emerald-700" : "text-rose-600")}>{totalProfitPct.toFixed(2)}%</Td>
              </tr>
            </tbody>
          </Table>
        </div>
      </Card>

      {/* Chart */}
      <Card>
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="font-semibold">Monthly Trend (₹ thousands)</div>
          <div className="text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-sm bg-indigo-500 mr-1 align-middle"/> Sales
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-500 ml-3 mr-1 align-middle"/> Total Expenses
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500 ml-3 mr-1 align-middle"/> Profit
          </div>
        </div>
        <div className="p-4 grid gap-4 lg:grid-cols-3">
          <div>
            <div className="text-xs font-medium mb-1 text-indigo-700">Sales</div>
            {rows.some(r => r.sales > 0) ? <BarChart data={salesChart} color="#6366f1" /> : <Empty title="No Sales entered yet" />}
          </div>
          <div>
            <div className="text-xs font-medium mb-1 text-amber-700">Total Expenses</div>
            {rows.some(r => (r.opening + r.purchase - r.closing) + r.indirect + r.direct > 0)
              ? <BarChart data={expChart} color="#f59e0b" />
              : <Empty title="No Expenses entered yet" />}
          </div>
          <div>
            <div className="text-xs font-medium mb-1 text-emerald-700">Profit / Loss</div>
            {rows.some(r => r.sales > 0)
              ? <BarChart data={profitChart} color="#10b981" />
              : <Empty title="No Profit data yet" />}
          </div>
        </div>
      </Card>
    </div>
  );
}
