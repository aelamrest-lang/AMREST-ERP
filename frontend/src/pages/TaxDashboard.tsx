import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useStore } from "../lib/store";
import { Card, Button, Input, Select, Label, Badge, Table, Th, Td } from "../components/ui";
import { BarChart, LineChart } from "../components/charts";
import { fmtINR, professionalDocument, printArea, todayISO } from "../lib/utils";
import { IconChart, IconPrint, IconDownload, IconCheck } from "../components/icons";
import { totalOrderQty } from "../lib/delivery";
import type { SalesOrder } from "../lib/types";

const DEFAULT_PURCHASE_GST = 18; // used only when an item has no gstRate set

type MonthlyRow = {
  key: string;      // YYYY-MM
  label: string;    // "Apr 2025"
  sales: number;
  purchases: number;
  outputGst: number;
  inputGst: number;
  netPayable: number;
};

function fyMonths(fyStartISO: string): { key: string; label: string; date: Date }[] {
  // fyStartISO is e.g. "2026-04-01". Build 12 months from that date.
  const start = new Date(fyStartISO);
  const now = new Date();
  // Pick the FY whose window contains today (works whether fyStart is in the past or future)
  const fyStart = new Date(start.getFullYear(), start.getMonth(), 1);
  while (fyStart > now) fyStart.setFullYear(fyStart.getFullYear() - 1);
  while (new Date(fyStart.getFullYear() + 1, fyStart.getMonth(), 1) <= now) fyStart.setFullYear(fyStart.getFullYear() + 1);
  const list: { key: string; label: string; date: Date }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(fyStart.getFullYear(), fyStart.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    list.push({ key, label: d.toLocaleString("en-IN", { month: "short", year: "2-digit" }), date: d });
  }
  return list;
}

function fyLabel(months: { date: Date }[]): string {
  if (!months.length) return "";
  const startY = months[0].date.getFullYear();
  const endY = months[months.length - 1].date.getFullYear();
  return `FY ${startY}-${String((endY + (months[months.length - 1].date.getMonth() > months[0].date.getMonth() ? 0 : 1)) % 100).padStart(2, "0")}`;
}

export function TaxDashboard() {
  const { db, setDB, log } = useStore();
  const settings = db.settings;
  const fyMonthList = useMemo(() => fyMonths(settings.fyStart || "2025-04-01"), [settings.fyStart]);
  const currentMonthKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const [monthKey, setMonthKey] = useState<string>(() => {
    // default to current month if inside the FY range, else last month of FY
    const found = fyMonthList.find(m => m.key === currentMonthKey);
    return found ? found.key : (fyMonthList[fyMonthList.length - 1]?.key || currentMonthKey);
  });

  // ------------------------------------------------------------------
  // Expected Sales — derived from Sales Order Delivery Schedules
  // Only *pending* qty (scheduled − delivered) of schedules falling in
  // the selected month contribute. Completed / cancelled / delivered
  // slots are excluded automatically because their pending qty is 0.
  //
  // AUTO-ROLL OVERDUE: when the selected month is the current month,
  // any pending slot dated before this month is *also* rolled into
  // this month's expected value so delayed orders never disappear.
  // ------------------------------------------------------------------
  const monthStart = (month: string) => new Date(month + "-01T00:00:00");
  const isCurrentMonth = (month: string) => month === currentMonthKey;

  const expectedFor = (month: string): { total: number; contributions: { so: SalesOrder; pendingQty: number; unitValue: number; value: number; scheduledDate: string; overdueRolled: boolean }[] } => {
    const contributions: { so: SalesOrder; pendingQty: number; unitValue: number; value: number; scheduledDate: string; overdueRolled: boolean }[] = [];
    let total = 0;
    const mStart = monthStart(month);
    const rollOverdue = isCurrentMonth(month);
    db.salesOrders.forEach(so => {
      if (!so.schedules || so.schedules.length === 0) return;
      const orderQty = totalOrderQty(so);
      if (!orderQty) return;
      const orderValue = so.items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
      const unitValue = orderValue / orderQty;
      so.schedules.forEach(s => {
        if (!s.date) return;
        const slotMonth = s.date.slice(0, 7);
        const slotDate = new Date(s.date + "T00:00:00");
        const inMonth = slotMonth === month;
        const isOverdueRollForward = rollOverdue && slotDate < mStart;
        if (!inMonth && !isOverdueRollForward) return;
        const pending = Math.max(0, (Number(s.qty) || 0) - (Number(s.deliveredQty) || 0));
        if (pending <= 0) return;
        const value = pending * unitValue;
        contributions.push({ so, pendingQty: pending, unitValue, value, scheduledDate: s.date, overdueRolled: isOverdueRollForward });
        total += value;
      });
    });
    return { total, contributions };
  };

  const expectedBreakdown = useMemo(() => expectedFor(monthKey), [db.salesOrders, monthKey, currentMonthKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const expectedSales = expectedBreakdown.total;

  // ------------------------------------------------------------------
  // Expected Purchases — derived from PO expectedDeliveryDate.
  // For each open PO (not Cancelled / not fully received), the remaining
  // balance qty (per item) is what's still expected. If PO's expected
  // delivery falls in the selected month → count in that month.
  // Same auto-roll rule applies for overdue POs on the current month.
  // ------------------------------------------------------------------
  const expectedPurchaseFor = (month: string): { taxable: number; gst: number; contributions: { po: typeof db.purchaseOrders[number]; balanceQty: number; taxable: number; gst: number; date: string; overdueRolled: boolean }[] } => {
    const contributions: { po: typeof db.purchaseOrders[number]; balanceQty: number; taxable: number; gst: number; date: string; overdueRolled: boolean }[] = [];
    let taxable = 0, gst = 0;
    const mStart = monthStart(month);
    const rollOverdue = isCurrentMonth(month);
    db.purchaseOrders.forEach(po => {
      if (po.status === "Cancelled") return;
      if (!po.expectedDeliveryDate) return;
      const slotMonth = po.expectedDeliveryDate.slice(0, 7);
      const slotDate = new Date(po.expectedDeliveryDate + "T00:00:00");
      const inMonth = slotMonth === month;
      const isOverdueRollForward = rollOverdue && slotDate < mStart;
      if (!inMonth && !isOverdueRollForward) return;
      // compute already received per item
      const already: Record<string, number> = {};
      db.grns.filter(g => g.poId === po.id).forEach(g => g.receivedItems.forEach(r => { already[r.itemId] = (already[r.itemId] || 0) + (r.qty || 0); }));
      let poTaxable = 0, poGst = 0, poBalanceQty = 0;
      po.items.forEach(line => {
        const balance = Math.max(0, (line.qty || 0) - (already[line.itemId] || 0));
        if (balance <= 0) return;
        poBalanceQty += balance;
        const item = db.items.find(x => x.id === line.itemId);
        const rate = item?.gstRate ?? 18;
        const lineTax = balance * (line.rate || 0);
        poTaxable += lineTax;
        poGst += lineTax * (rate / 100);
      });
      if (poTaxable <= 0) return;
      taxable += poTaxable;
      gst += poGst;
      contributions.push({ po, balanceQty: poBalanceQty, taxable: poTaxable, gst: poGst, date: po.expectedDeliveryDate, overdueRolled: isOverdueRollForward });
    });
    return { taxable, gst, contributions };
  };

  const expectedPurchaseBreakdown = useMemo(() => expectedPurchaseFor(monthKey), [db.purchaseOrders, db.grns, db.items, monthKey, currentMonthKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const expectedPurchases = expectedPurchaseBreakdown.taxable;
  const gstOnExpectedPurchases = expectedPurchaseBreakdown.gst;

  // ---- helpers to compute sales / purchases per proforma / PO ----
  const proformaTotals = (p: typeof db.proformas[number]) => {
    let taxable = 0, gst = 0;
    p.items.forEach(it => {
      const line = (it.qty || 0) * (it.rate || 0);
      taxable += line;
      gst += line * ((it.gst || 0) / 100);
    });
    return { taxable, gst, grand: taxable + gst };
  };

  const poTotals = (p: typeof db.purchaseOrders[number]) => {
    let taxable = 0, gst = 0;
    p.items.forEach(it => {
      const line = (it.qty || 0) * (it.rate || 0);
      const item = db.items.find(x => x.id === it.itemId);
      const rate = item?.gstRate ?? DEFAULT_PURCHASE_GST;
      taxable += line;
      gst += line * (rate / 100);
    });
    return { taxable, gst, grand: taxable + gst };
  };

  // ---- monthly aggregates for chart & table ----
  const monthly: MonthlyRow[] = useMemo(() => {
    return fyMonthList.map(m => {
      let sales = 0, outputGst = 0, purchases = 0, inputGst = 0;
      db.proformas.forEach(pf => {
        if (!pf.date) return;
        if (pf.date.slice(0, 7) !== m.key) return;
        const t = proformaTotals(pf);
        sales += t.taxable;
        outputGst += t.gst;
      });
      db.purchaseOrders.forEach(po => {
        if (!po.date || po.status === "Draft" || po.status === "Cancelled") return;
        if (po.date.slice(0, 7) !== m.key) return;
        const t = poTotals(po);
        purchases += t.taxable;
        inputGst += t.gst;
      });
      return {
        key: m.key,
        label: m.label,
        sales,
        purchases,
        outputGst,
        inputGst,
        netPayable: Math.max(0, outputGst - inputGst),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.proformas, db.purchaseOrders, db.items, fyMonthList]);

  const current = monthly.find(m => m.key === monthKey) || {
    key: monthKey, label: monthKey, sales: 0, purchases: 0, outputGst: 0, inputGst: 0, netPayable: 0,
  };

  // ---- computed KPI values ----
  const avgGstOnSalesPct = current.sales > 0 ? (current.outputGst / current.sales) * 100 : 18;
  const gstOnExpected = expectedSales * (avgGstOnSalesPct / 100);
  const estimatedNetGst = Math.max(0, (current.outputGst + gstOnExpected) - (current.inputGst + gstOnExpectedPurchases));
  const achievementPct = expectedSales > 0 ? Math.min(999, (current.sales / expectedSales) * 100) : 0;
  const remainingTarget = Math.max(0, expectedSales - current.sales);

  // FY-level totals
  const fyTotals = monthly.reduce((a, m) => ({
    sales: a.sales + m.sales, purchases: a.purchases + m.purchases,
    outputGst: a.outputGst + m.outputGst, inputGst: a.inputGst + m.inputGst,
    netPayable: a.netPayable + m.netPayable,
  }), { sales: 0, purchases: 0, outputGst: 0, inputGst: 0, netPayable: 0 });

  // ---- Exports ----
  const buildRows = () => [
    ["Month", "Sales", "Purchases", "Output GST", "Input GST", "Net GST Payable"],
    ...monthly.map(m => [m.label, m.sales, m.purchases, m.outputGst, m.inputGst, m.netPayable]),
    ["FY Total", fyTotals.sales, fyTotals.purchases, fyTotals.outputGst, fyTotals.inputGst, fyTotals.netPayable],
  ];

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const wsSummary = XLSX.utils.aoa_to_sheet([
      ["Tax Dashboard —", fyLabel(fyMonthList)],
      [],
      ["Selected Month", current.label],
      ["Expected Sales (This Month)", expectedSales],
      ["Sales Till Date", current.sales],
      ["Purchase Till Date", current.purchases],
      ["GST on Sales (Output GST)", current.outputGst],
      ["GST on Purchases (Input GST)", current.inputGst],
      ["GST on Expected Sales", gstOnExpected],
      ["Expected Purchases", expectedPurchases],
      ["GST on Expected Purchases", gstOnExpectedPurchases],
      ["Estimated Net GST Payable", estimatedNetGst],
      ["Sales Target Achievement (%)", Number(achievementPct.toFixed(2))],
      ["Remaining Sales Target", remainingTarget],
    ]);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");
    const wsMonthly = XLSX.utils.aoa_to_sheet(buildRows());
    XLSX.utils.book_append_sheet(wb, wsMonthly, "Monthly");
    XLSX.writeFile(wb, `Tax_Dashboard_${monthKey}.xlsx`);
    log(`Exported Tax Dashboard (${monthKey}) to Excel`, "Tax");
  };

  const exportPDF = () => {
    const rowsHtml = monthly.map(m => `
      <tr>
        <td>${m.label}</td>
        <td style="text-align:right">${fmtINR(m.sales)}</td>
        <td style="text-align:right">${fmtINR(m.purchases)}</td>
        <td style="text-align:right">${fmtINR(m.outputGst)}</td>
        <td style="text-align:right">${fmtINR(m.inputGst)}</td>
        <td style="text-align:right"><b>${fmtINR(m.netPayable)}</b></td>
      </tr>`).join("");
    const body = `
      <div class="box">
        <div class="section-title">Selected Month · ${current.label}</div>
        <table>
          <tr><td>Expected Sales (This Month)</td><td style="text-align:right">${fmtINR(expectedSales)}</td></tr>
          <tr><td>Sales Till Date</td><td style="text-align:right">${fmtINR(current.sales)}</td></tr>
          <tr><td>Purchase Till Date</td><td style="text-align:right">${fmtINR(current.purchases)}</td></tr>
          <tr><td>GST on Sales (Output GST)</td><td style="text-align:right">${fmtINR(current.outputGst)}</td></tr>
          <tr><td>GST on Purchases (Input GST)</td><td style="text-align:right">${fmtINR(current.inputGst)}</td></tr>
          <tr><td>GST on Expected Sales</td><td style="text-align:right">${fmtINR(gstOnExpected)}</td></tr>
          <tr><td>Expected Purchases</td><td style="text-align:right">${fmtINR(expectedPurchases)}</td></tr>
          <tr><td>GST on Expected Purchases</td><td style="text-align:right">${fmtINR(gstOnExpectedPurchases)}</td></tr>
          <tr><td><b>Estimated Net GST Payable</b></td><td style="text-align:right"><b>${fmtINR(estimatedNetGst)}</b></td></tr>
          <tr><td>Sales Target Achievement</td><td style="text-align:right">${achievementPct.toFixed(2)}%</td></tr>
          <tr><td>Remaining Sales Target</td><td style="text-align:right">${fmtINR(remainingTarget)}</td></tr>
        </table>
      </div>
      <div class="box">
        <div class="section-title">Monthly Breakdown · ${fyLabel(fyMonthList)}</div>
        <table>
          <thead>
            <tr><th>Month</th><th style="text-align:right">Sales</th><th style="text-align:right">Purchases</th><th style="text-align:right">Output GST</th><th style="text-align:right">Input GST</th><th style="text-align:right">Net GST</th></tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr style="border-top:2px solid #94a3b8;font-weight:700">
              <td>FY Total</td>
              <td style="text-align:right">${fmtINR(fyTotals.sales)}</td>
              <td style="text-align:right">${fmtINR(fyTotals.purchases)}</td>
              <td style="text-align:right">${fmtINR(fyTotals.outputGst)}</td>
              <td style="text-align:right">${fmtINR(fyTotals.inputGst)}</td>
              <td style="text-align:right">${fmtINR(fyTotals.netPayable)}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
    const html = professionalDocument(settings, {
      title: "Tax Dashboard",
      number: `TAX-${monthKey}`,
      date: todayISO(),
      body,
      accent: "#0f766e",
      skipFormatTerms: true,
    });
    printArea(html, `Tax Dashboard ${monthKey}`);
    log(`Printed Tax Dashboard (${monthKey}) PDF`, "Tax");
  };

  // ---- UI ----
  return (
    <div className="space-y-5" data-testid="tax-dashboard">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><IconChart size={22}/> Tax Dashboard</h1>
          <p className="text-sm text-slate-500">Monthly GST tracking, projection & compliance snapshot · {fyLabel(fyMonthList)}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label>Month</Label>
            <Select value={monthKey} onChange={(e: any) => setMonthKey(e.target.value)} data-testid="tax-month-select">
              {fyMonthList.map(m => (
                <option key={m.key} value={m.key}>{m.label}{m.key === currentMonthKey ? " · Current" : ""}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Financial Year Start</Label>
            <Input type="date" value={settings.fyStart || ""} onChange={(e: any) => setDB(d => ({...d, settings: {...d.settings, fyStart: e.target.value}}))}/>
          </div>
          <Button variant="outline" onClick={exportExcel} data-testid="tax-export-excel"><IconDownload size={14}/> Excel</Button>
          <Button variant="outline" onClick={exportPDF} data-testid="tax-export-pdf"><IconPrint size={14}/> PDF</Button>
        </div>
      </div>

      {/* Expected Sales — auto-derived from Sales Order Delivery Schedules */}
      <Card>
        <div className="p-5 grid md:grid-cols-[1fr_auto] gap-4 items-start">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Label className="!mb-0">Expected Sales — {current.label}</Label>
              <Badge color="indigo">Auto from Delivery Schedule</Badge>
            </div>
            <div className="text-3xl font-bold mt-2 text-slate-800 dark:text-slate-100" data-testid="tax-expected-auto">
              {fmtINR(expectedSales)}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Computed from every Sales Order's delivery schedule falling in {current.label}. Only the <b>pending</b> qty per slot
              (scheduled − delivered) contributes, so completed / cancelled deliveries are excluded automatically.
              {isCurrentMonth(monthKey) && <> Overdue pending slots from earlier months are <b>auto-rolled</b> into this month.</>}
            </p>
            {expectedBreakdown.contributions.length > 0 ? (
              <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <span>Slot breakdown ({expectedBreakdown.contributions.length})</span>
                  {expectedBreakdown.contributions.some(c => c.overdueRolled) && (
                    <Badge color="amber">{expectedBreakdown.contributions.filter(c => c.overdueRolled).length} overdue rolled</Badge>
                  )}
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {expectedBreakdown.contributions.map((c, i) => {
                    const cust = db.parties.find(p => p.id === c.so.customerId);
                    return (
                      <div key={c.so.id + "-" + i} className="flex items-center justify-between text-xs px-3 py-1.5 border-b last:border-b-0 border-slate-100 dark:border-slate-800">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-700 dark:text-slate-200 truncate flex items-center gap-1.5">
                            <span className="font-mono text-[10px] text-slate-500">{c.so.number}</span>
                            <span className="truncate">{cust?.name || "Unknown Customer"}</span>
                            {c.overdueRolled && <Badge color="amber">Overdue</Badge>}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {c.scheduledDate} · {c.pendingQty} Nos × {fmtINR(c.unitValue)}
                          </div>
                        </div>
                        <div className="font-semibold text-slate-800 dark:text-slate-100 ml-3 shrink-0">{fmtINR(c.value)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-3 text-xs text-slate-500 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-3 py-2">
                No pending delivery slots scheduled for {current.label}. Add or update the schedule on any Sales Order to see the number appear here in real time.
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs uppercase text-slate-500">Avg Output GST Rate</div>
            <div className="text-lg font-semibold">{avgGstOnSalesPct.toFixed(2)}%</div>
          </div>
        </div>
      </Card>

      {/* Expected Purchases — auto-derived from PO Expected Delivery Dates */}
      <Card>
        <div className="p-5">
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="!mb-0">Expected Purchases &amp; Input GST — {current.label}</Label>
            <Badge color="teal">Auto from PO Expected Delivery</Badge>
          </div>
          <div className="mt-2 grid sm:grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase text-slate-500">Expected Purchases</div>
              <div className="text-2xl font-bold text-slate-800 dark:text-slate-100" data-testid="tax-expected-purchases">{fmtINR(expectedPurchases)}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">GST on Expected Purchases (Input GST)</div>
              <div className="text-2xl font-bold text-slate-800 dark:text-slate-100" data-testid="tax-expected-input-gst">{fmtINR(gstOnExpectedPurchases)}</div>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Only the <b>balance qty</b> (ordered − already received) of open POs contributes; cancelled and fully-received POs are excluded.
            {isCurrentMonth(monthKey) && <> Overdue open POs from earlier months are <b>auto-rolled</b> into this month.</>}
          </p>
          {expectedPurchaseBreakdown.contributions.length > 0 ? (
            <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span>PO breakdown ({expectedPurchaseBreakdown.contributions.length})</span>
                {expectedPurchaseBreakdown.contributions.some(c => c.overdueRolled) && (
                  <Badge color="amber">{expectedPurchaseBreakdown.contributions.filter(c => c.overdueRolled).length} overdue rolled</Badge>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto">
                {expectedPurchaseBreakdown.contributions.map((c, i) => {
                  const vendor = db.parties.find(p => p.id === c.po.vendorId);
                  return (
                    <div key={c.po.id + "-" + i} className="flex items-center justify-between text-xs px-3 py-1.5 border-b last:border-b-0 border-slate-100 dark:border-slate-800">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-700 dark:text-slate-200 truncate flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-slate-500">{c.po.number}</span>
                          <span className="truncate">{vendor?.name || "Unknown Vendor"}</span>
                          {c.overdueRolled && <Badge color="amber">Overdue</Badge>}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {c.date} · balance {c.balanceQty} units · taxable {fmtINR(c.taxable)}
                        </div>
                      </div>
                      <div className="font-semibold text-slate-800 dark:text-slate-100 ml-3 shrink-0">GST {fmtINR(c.gst)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mt-3 text-xs text-slate-500 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-3 py-2">
              No open POs with an Expected Delivery Date in {current.label}. Set the Expected Delivery Date on Purchase Orders to include them here.
            </div>
          )}
        </div>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="tax-kpis">
        <KpiCard label="Sales Till Date" value={fmtINR(current.sales)} accent="from-indigo-500 to-violet-600" testid="kpi-sales-tilldate"/>
        <KpiCard label="Purchase Till Date" value={fmtINR(current.purchases)} accent="from-amber-500 to-orange-600" testid="kpi-purchase-tilldate"/>
        <KpiCard label="GST on Sales (Output)" value={fmtINR(current.outputGst)} accent="from-rose-500 to-pink-600" testid="kpi-output-gst"/>
        <KpiCard label="GST on Purchases (Input)" value={fmtINR(current.inputGst)} accent="from-emerald-500 to-teal-600" testid="kpi-input-gst"/>
        <KpiCard label="GST on Expected Sales" value={fmtINR(gstOnExpected)} accent="from-sky-500 to-blue-600" testid="kpi-expected-gst"/>
        <KpiCard label="Expected Purchases" value={fmtINR(expectedPurchases)} accent="from-orange-500 to-amber-600" testid="kpi-expected-purchases"/>
        <KpiCard label="GST on Expected Purchases" value={fmtINR(gstOnExpectedPurchases)} accent="from-teal-500 to-cyan-600" testid="kpi-expected-input-gst"/>
        <KpiCard label="Estimated Net GST Payable" value={fmtINR(estimatedNetGst)} accent="from-fuchsia-500 to-purple-600" testid="kpi-net-payable" highlight/>
        <KpiCard label="Sales Target Achievement" value={`${achievementPct.toFixed(1)}%`} accent="from-lime-500 to-emerald-600" testid="kpi-achievement"
          extra={
            <div className="mt-2 h-1.5 rounded-full bg-white/30 overflow-hidden">
              <div className="h-full bg-white" style={{ width: `${Math.min(100, achievementPct)}%` }} />
            </div>
          }
        />
        <KpiCard label="Remaining Sales Target" value={fmtINR(remainingTarget)} accent="from-slate-500 to-slate-700" testid="kpi-remaining-target"/>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Monthly Sales vs Purchases</h3>
                <p className="text-xs text-slate-500">{fyLabel(fyMonthList)}</p>
              </div>
            </div>
            <BarChart data={monthly.map(m => ({ label: m.label, value: Math.round(m.sales) }))} color="#6366f1" />
            <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
              <div className="flex items-center gap-2"><span className="h-2 w-3 rounded-sm bg-indigo-500"/> Sales · {fmtINR(fyTotals.sales)}</div>
              <div className="flex items-center gap-2"><span className="h-2 w-3 rounded-sm bg-amber-500"/> Purchases · {fmtINR(fyTotals.purchases)}</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Net GST Payable Trend</h3>
                <p className="text-xs text-slate-500">Output − Input, monthly</p>
              </div>
              <Badge color={current.netPayable > current.inputGst ? "amber" : "green"}>
                {current.netPayable > 0 ? "Payable" : "No liability"}
              </Badge>
            </div>
            <LineChart data={monthly.map(m => ({ label: m.label, value: Math.round(m.netPayable) }))} color="#ef4444" />
          </div>
        </Card>
      </div>

      {/* Monthly table */}
      <Card>
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Monthly GST Register</h3>
            <p className="text-xs text-slate-500">Auto-computed from Proforma Invoices (Sales) and Purchase Orders (Purchases). Draft / Cancelled POs are excluded.</p>
          </div>
        </div>
        <Table>
          <thead><tr><Th>Month</Th><Th className="text-right">Sales</Th><Th className="text-right">Purchases</Th><Th className="text-right">Output GST</Th><Th className="text-right">Input GST</Th><Th className="text-right">Net Payable</Th></tr></thead>
          <tbody>
            {monthly.map(m => (
              <tr key={m.key} className={"hover:bg-slate-50 dark:hover:bg-slate-800/50 " + (m.key === monthKey ? "bg-indigo-50/60 dark:bg-indigo-900/20" : "")}>
                <Td className="font-medium">
                  {m.label}
                  {m.key === currentMonthKey && <Badge color="blue" className="ml-2">Current</Badge>}
                </Td>
                <Td className="text-right">{fmtINR(m.sales)}</Td>
                <Td className="text-right">{fmtINR(m.purchases)}</Td>
                <Td className="text-right">{fmtINR(m.outputGst)}</Td>
                <Td className="text-right">{fmtINR(m.inputGst)}</Td>
                <Td className="text-right font-semibold">{fmtINR(m.netPayable)}</Td>
              </tr>
            ))}
            <tr className="bg-slate-100 dark:bg-slate-800/60 font-semibold">
              <Td>FY Total</Td>
              <Td className="text-right">{fmtINR(fyTotals.sales)}</Td>
              <Td className="text-right">{fmtINR(fyTotals.purchases)}</Td>
              <Td className="text-right">{fmtINR(fyTotals.outputGst)}</Td>
              <Td className="text-right">{fmtINR(fyTotals.inputGst)}</Td>
              <Td className="text-right">{fmtINR(fyTotals.netPayable)}</Td>
            </tr>
          </tbody>
        </Table>
      </Card>

      <div className="text-[11px] text-slate-500">
        <IconCheck size={12} className="inline mr-1 text-emerald-500"/>
        All calculations update instantly as invoices and purchases are added/edited. Purchase GST defaults to each item's GST rate ({DEFAULT_PURCHASE_GST}% fallback when unset).
      </div>
    </div>
  );
}

function KpiCard({ label, value, accent, extra, highlight, testid }: { label: string; value: string; accent: string; extra?: React.ReactNode; highlight?: boolean; testid?: string }) {
  return (
    <div
      className={"rounded-xl p-4 text-white shadow-sm bg-gradient-to-br " + accent + (highlight ? " ring-2 ring-white/40 dark:ring-white/20" : "")}
      data-testid={testid}
    >
      <div className="text-[11px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-xl font-bold mt-1 truncate">{value}</div>
      {extra}
    </div>
  );
}
