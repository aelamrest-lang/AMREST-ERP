import { useState } from "react";
import { useStore } from "../lib/store";
import { Card, CardHeader, KPI, Badge, Empty, Modal, Table, Th, Td, Button } from "../components/ui";
import { BarChart, DonutChart } from "../components/charts";
import { fmtINR } from "../lib/utils";
import { roleDescriptions, roleLabels } from "../lib/permissions";
import { IconShop, IconFile, IconBox, IconFactory, IconCart, IconChart } from "../components/icons";
import { orderDelayInfo, totalDeliveredQty, totalScheduledQty, totalOrderQty } from "../lib/delivery";
import { overdueSummary } from "./Procurement";

export function Dashboard() {
  const { db, currentUser } = useStore();
  const isAdmin = currentUser?.role === "admin";
  const myFilter = <T extends { ownerId?: string }>(arr: T[]) => isAdmin ? arr : arr.filter(x => x.ownerId === currentUser?.id);

  const quotations = myFilter(db.quotations);
  const salesOrders = myFilter(db.salesOrders);

  const orderTotal = salesOrders.reduce((s, o) => s + o.items.reduce((a, b) => a + b.qty * b.rate * (1 + b.gst / 100), 0), 0);
  const pendingQuotations = quotations.filter(q => q.status === "Quotation Sent" || q.status === "Negotiation").length;
  const lowStock = db.items.filter(i => i.currentStock <= i.minStock);
  const productionInProg = db.jobCards.filter(j => j.status === "In Progress").length;

  const [drill, setDrill] = useState<{ type: "sales" | "production" | "customer"; monthKey?: string; monthLabel?: string; customerId?: string } | null>(null);
  const [rangeMonths, setRangeMonths] = useState<3 | 6 | 12>(6);

  // Monthly buckets (last N months, incl. current)
  const monthBuckets: { key: string; label: string; date: Date }[] = [];
  const now = new Date();
  for (let i = rangeMonths - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthBuckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "short" }) + (rangeMonths === 12 ? ` ${String(d.getFullYear()).slice(2)}` : ""),
      date: d,
    });
  }

  // ---- Monthly Sales from Delivery Challans ----
  const soValue = (soId: string): { qty: number; value: number } => {
    const so = db.salesOrders.find(o => o.id === soId);
    if (!so) return { qty: 0, value: 0 };
    let qty = 0, value = 0;
    so.items.forEach(it => {
      qty += Number(it.qty) || 0;
      value += (Number(it.qty) || 0) * (Number(it.rate) || 0);
    });
    return { qty, value };
  };

  const months = monthBuckets.map(m => {
    const total = db.challans
      .filter(c => c.date && c.date.slice(0, 7) === m.key)
      .reduce((s, c) => s + soValue(c.salesOrderId).value, 0);
    return { label: m.label, value: Math.round(total / 1000) }; // in ₹K
  });

  // ---- Monthly Production from Completed Job Cards only ----
  const monthlyProduction = monthBuckets.map(m => {
    const completedUnits = db.jobCards
      .filter(j => j.status === "Completed")
      .filter(j => (j.date || "").slice(0, 7) === m.key)
      .reduce((sum, j) => sum + (Number(j.qty) || 0), 0);
    return { label: m.label, value: completedUnits };
  });

  const inventoryByCategory = ["Raw Material", "Semi-Finished", "Finished Goods"].map((c, i) => ({
    label: c,
    value: db.items.filter(it => it.category === c).reduce((s, it) => s + it.currentStock, 0),
    color: ["#6366f1", "#f59e0b", "#10b981"][i],
  }));

  // ---- Top Customers from Sales Order Total Value ----
  interface CustomerAgg { customerId: string; name: string; totalQty: number; totalValue: number; orders: number }
  const customerAggMap = new Map<string, CustomerAgg>();
  salesOrders.forEach(o => {
    const totQty = o.items.reduce((a, b) => a + (Number(b.qty) || 0), 0);
    const totVal = o.items.reduce((a, b) => a + (Number(b.qty) || 0) * (Number(b.rate) || 0), 0);
    const existing = customerAggMap.get(o.customerId);
    if (existing) {
      existing.totalQty += totQty; existing.totalValue += totVal; existing.orders += 1;
    } else {
      customerAggMap.set(o.customerId, {
        customerId: o.customerId,
        name: db.parties.find(p => p.id === o.customerId)?.name || "—",
        totalQty: totQty, totalValue: totVal, orders: 1,
      });
    }
  });
  const [customerMetric, setCustomerMetric] = useState<"value" | "qty">("value");
  const topCustomersList = Array.from(customerAggMap.values())
    .sort((a, b) => customerMetric === "value" ? b.totalValue - a.totalValue : b.totalQty - a.totalQty)
    .slice(0, 5);
  const topCustomers = topCustomersList.map(c => ({
    label: c.name.length > 10 ? c.name.slice(0, 10) + "…" : c.name,
    value: customerMetric === "value" ? Math.round(c.totalValue / 1000) : c.totalQty,
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Live overview of operations, sales, production and inventory.</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1" data-testid="dashboard-range-toggle">
          {[3, 6, 12].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setRangeMonths(n as 3 | 6 | 12)}
              className={"px-3 py-1 text-xs rounded-md transition " + (rangeMonths === n ? "bg-white dark:bg-slate-900 text-indigo-600 shadow font-semibold" : "text-slate-600 dark:text-slate-300 hover:text-slate-900")}
              data-testid={`dashboard-range-${n}m`}
            >{n}M</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Total Sales Value" value={fmtINR(orderTotal)} color="emerald" icon={<IconShop size={22}/>} />
        <KPI label="Pending Quotations" value={String(pendingQuotations)} color="amber" icon={<IconFile size={22}/>} hint={`${quotations.length} total`} />
        <KPI label="Production In Progress" value={String(productionInProg)} color="indigo" icon={<IconFactory size={22}/>} hint={`${db.jobCards.length} job cards`} />
        <KPI label="Low Stock Items" value={String(lowStock.length)} color="rose" icon={<IconBox size={22}/>} hint={`${db.items.length} items`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader title="Monthly Sales (₹ thousands)" subtitle={`Value of Delivery Challans · last ${rangeMonths} months · click a month for the DC list`} />
          <div className="p-4">
            <BarChart
              data={months}
              color="#6366f1"
              onBarClick={(i) => setDrill({ type: "sales", monthKey: monthBuckets[i].key, monthLabel: `${monthBuckets[i].label} ${monthBuckets[i].date.getFullYear()}` })}
            />
          </div>
        </Card>
        <Card>
          <div className="p-5">
            <h3 className="text-lg font-bold uppercase tracking-wide text-slate-900 dark:text-slate-100">Monthly Production</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Total Completed Job Cards · last {rangeMonths} months · click a month to view completed job cards</p>
            <div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-5">
              <ProductionBarChart
                data={monthlyProduction}
                onBarClick={(i) => setDrill({ type: "production", monthKey: monthBuckets[i].key, monthLabel: `${monthBuckets[i].label} ${monthBuckets[i].date.getFullYear()}` })}
              />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Card>
          <CardHeader title="Inventory by Category" />
          <div className="p-5"><DonutChart data={inventoryByCategory} /></div>
        </Card>
        <Card>
          <CardHeader
            title={customerMetric === "value" ? "Top Customers (₹K)" : "Top Customers (Nos)"}
            right={
              <div className="flex items-center gap-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => setCustomerMetric("value")}
                  className={"px-2 py-0.5 rounded " + (customerMetric === "value" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
                  data-testid="top-customers-metric-value"
                >Value</button>
                <button
                  type="button"
                  onClick={() => setCustomerMetric("qty")}
                  className={"px-2 py-0.5 rounded " + (customerMetric === "qty" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
                  data-testid="top-customers-metric-qty"
                >Qty</button>
              </div>
            }
          />
          <div className="p-4">
            {topCustomers.length ? (
              <BarChart
                data={topCustomers}
                color="#f59e0b"
                onBarClick={(i) => setDrill({ type: "customer", customerId: topCustomersList[i].customerId })}
              />
            ) : <Empty title="No Sales Orders yet" />}
            <div className="mt-2 text-[11px] text-slate-500">Click any bar to see all Sales Orders from that customer.</div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Low Stock Alerts" right={<Badge color={lowStock.length ? "red" : "green"}>{lowStock.length}</Badge>} />
          <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
            {lowStock.length === 0 && <Empty title="All items in healthy stock" />}
            {lowStock.map(it => (
              <div key={it.id} className="flex items-center justify-between text-sm border-b border-slate-100 dark:border-slate-800 pb-1.5">
                <div>
                  <div className="font-medium text-slate-700 dark:text-slate-200">{it.name}</div>
                  <div className="text-xs text-slate-500">{it.code}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-rose-600">{it.currentStock} {it.unit}</div>
                  <div className="text-xs text-slate-500">min {it.minStock}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <SalesForecast salesOrders={salesOrders} db={db} />

      <DelayedDeliveries salesOrders={salesOrders} db={db} />
      <OverduePOs db={db} />

      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader title="Recent Quotations" right={<Badge color="indigo">{quotations.length}</Badge>} />
          <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
            {quotations.length === 0 && <Empty />}
            {quotations.slice(0, 8).map(q => (
              <div key={q.id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                <div>
                  <div className="font-medium text-sm text-slate-700 dark:text-slate-200">{q.number}</div>
                  <div className="text-xs text-slate-500">{db.parties.find(p => p.id === q.customerId)?.name}</div>
                </div>
                <Badge color={q.status === "Order Confirmed" ? "green" : q.status === "Negotiation" ? "yellow" : "blue"}>{q.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent Activity" right={<IconChart />} />
          <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
            {db.logs.slice(0, 10).map(l => {
              const u = db.users.find(x => x.id === l.userId);
              return (
                <div key={l.id} className="text-sm flex items-start gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                  <div className="h-7 w-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-bold flex-shrink-0">{u?.name.charAt(0) || "?"}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-700 dark:text-slate-200"><span className="font-medium">{u?.name || "Unknown"}</span> — {l.action}</div>
                    <div className="text-xs text-slate-500">{l.module} • {new Date(l.timestamp).toLocaleString()}</div>
                  </div>
                </div>
              );
            })}
            {db.logs.length === 0 && <Empty title="No activity yet" />}
          </div>
        </Card>
      </div>

      {!isAdmin && (
        <Card className="bg-gradient-to-r from-indigo-600 to-violet-700 text-white border-0">
          <div className="p-5 flex items-center gap-4">
            <IconCart size={28}/>
            <div>
              <div className="font-semibold">You are signed in as {currentUser ? roleLabels[currentUser.role] : "User"}</div>
              <div className="text-sm text-indigo-100">{currentUser ? roleDescriptions[currentUser.role] : "Your navigation is limited by assigned permissions."}</div>
            </div>
          </div>
        </Card>
      )}

      <DashboardDrillDown drill={drill} onClose={() => setDrill(null)} db={db} monthBuckets={monthBuckets} />
    </div>
  );
}

function ProductionBarChart({ data, onBarClick }: { data: { label: string; value: number }[]; onBarClick?: (index: number) => void }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div className="relative h-52">
      <div className="absolute inset-x-8 top-7 border-t border-dashed border-slate-200 dark:border-slate-700" />
      <div className="absolute inset-x-8 top-20 border-t border-dashed border-slate-200 dark:border-slate-700" />
      <div className="absolute inset-x-8 bottom-11 border-t border-dashed border-slate-200 dark:border-slate-700" />
      <div className="relative z-10 grid h-full items-end gap-5 px-8 pb-8 pt-4" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
        {data.map((d, i) => {
          const height = Math.max(18, (d.value / max) * 125);
          const disabled = !onBarClick || d.value === 0;
          return (
            <button
              key={d.label}
              type="button"
              disabled={disabled}
              onClick={() => onBarClick && onBarClick(i)}
              className={"flex h-full flex-col items-center justify-end gap-2 focus:outline-none " + (disabled ? "cursor-default" : "cursor-pointer")}
            >
              <div className={"text-sm font-bold " + (disabled ? "text-transparent" : "text-indigo-700 dark:text-indigo-300")}>{d.value}</div>
              <div
                className={"w-full max-w-14 rounded-t-md bg-gradient-to-t shadow-sm shadow-indigo-500/30 transition-all " + (disabled ? "from-indigo-200 to-indigo-400 opacity-60" : "from-indigo-300 to-indigo-600 hover:from-indigo-400 hover:to-indigo-700")}
                style={{ height }}
                title={`${d.label}: ${d.value} units${!disabled ? " · click for job cards" : ""}`}
              />
              <div className={"text-xs font-semibold " + (!disabled ? "text-indigo-600 dark:text-indigo-300" : "text-slate-500 dark:text-slate-400")}>{d.label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}


function DelayedDeliveries({ salesOrders, db }: { salesOrders: any[]; db: any }) {
  const rows = salesOrders
    .map((so: any) => ({ so, info: orderDelayInfo(so) }))
    .filter((r: any) => r.info.hasDelay)
    .sort((a: any, b: any) => b.info.maxDelayDays - a.info.maxDelayDays);

  return (
    <Card data-testid="dashboard-delayed-deliveries">
      <CardHeader
        title="Delayed Deliveries"
        right={<Badge color={rows.length ? "red" : "green"}>{rows.length}</Badge>}
      />
      {rows.length === 0 ? (
        <div className="p-4"><Empty title="All scheduled deliveries are on time" /></div>
      ) : (
        <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
          {rows.map(({ so, info }: any) => {
            const cust = db.parties.find((p: any) => p.id === so.customerId);
            const oq = totalOrderQty(so);
            const dq = totalDeliveredQty(so);
            const sq = totalScheduledQty(so);
            return (
              <div key={so.id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                <div className="min-w-0">
                  <div className="font-medium text-slate-700 dark:text-slate-200 truncate">
                    <span className="font-mono text-xs mr-2 text-slate-500">{so.number}</span>
                    {cust?.name || "Unknown Customer"}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Delivered {dq} of {sq} scheduled · {oq} ordered
                    {info.earliestOverdueDate ? ` · Earliest overdue ${info.earliestOverdueDate}` : ""}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <Badge color="red">{info.maxDelayDays} {info.maxDelayDays === 1 ? "Day" : "Days"} Delayed</Badge>
                  <div className="text-[11px] text-slate-500 mt-1">Pending: <b>{info.pendingQty}</b></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function OverduePOs({ db }: { db: any }) {
  const rows = db.purchaseOrders
    .map((po: any) => ({ po, summary: overdueSummary(po, db.grns) }))
    .filter((r: any) => r.summary.delayDays > 0 && !r.summary.fullyReceived && r.po.status !== "Cancelled")
    .sort((a: any, b: any) => b.summary.delayDays - a.summary.delayDays);

  return (
    <Card data-testid="dashboard-overdue-pos">
      <CardHeader
        title="Overdue Purchase Orders"
        right={<Badge color={rows.length ? "red" : "green"}>{rows.length}</Badge>}
      />
      {rows.length === 0 ? (
        <div className="p-4"><Empty title="No overdue Purchase Orders" /></div>
      ) : (
        <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
          {rows.map(({ po, summary }: any) => {
            const vendor = db.parties.find((p: any) => p.id === po.vendorId);
            return (
              <div key={po.id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                <div className="min-w-0">
                  <div className="font-medium text-slate-700 dark:text-slate-200 truncate flex items-center gap-1.5">
                    <span aria-hidden>🔴</span>
                    <span className="font-mono text-xs mr-1 text-slate-500">{po.number}</span>
                    <span className="truncate">{vendor?.name || "Unknown Vendor"}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Received {summary.received} / Pending {summary.pending} of {summary.ordered}
                    {po.expectedDeliveryDate ? ` · Expected ${po.expectedDeliveryDate}` : ""}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <Badge color="red">{summary.delayDays} {summary.delayDays === 1 ? "Day" : "Days"} Delayed</Badge>
                  <div className="text-[11px] text-slate-500 mt-1">Status: <b>{po.status}</b></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}


function SalesForecast({ salesOrders, db }: { salesOrders: any[]; db: any }) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  // Build next 6 months keys starting from current month
  const now = new Date();
  const months: { key: string; label: string; short: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({
      key,
      label: d.toLocaleString("en-IN", { month: "long", year: "numeric" }),
      short: d.toLocaleString("en-IN", { month: "short", year: "2-digit" }),
    });
  }

  // Aggregate qty + value per month from every SO's schedules
  interface Row { key: string; label: string; short: string; qty: number; value: number; delivered: number; pending: number; slots: number; }
  const rows: Row[] = months.map(m => ({ ...m, qty: 0, value: 0, delivered: 0, pending: 0, slots: 0 }));
  const contributions: Record<string, { so: any; date: string; qty: number; delivered: number; pending: number; unitValue: number; value: number }[]> = {};
  months.forEach(m => contributions[m.key] = []);

  salesOrders.forEach((so: any) => {
    if (!so.schedules || so.schedules.length === 0) return;
    const orderQty = totalOrderQty(so);
    if (!orderQty) return;
    const orderValue = so.items.reduce((a: number, it: any) => a + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
    const unitValue = orderValue / orderQty;
    so.schedules.forEach((s: any) => {
      if (!s.date) return;
      const m = s.date.slice(0, 7);
      const row = rows.find(r => r.key === m);
      if (!row) return;
      const qty = Number(s.qty) || 0;
      const delivered = Math.max(0, Number(s.deliveredQty) || 0);
      const pending = Math.max(0, qty - delivered);
      row.qty += qty;
      row.value += qty * unitValue;
      row.delivered += delivered;
      row.pending += pending;
      row.slots += 1;
      contributions[m].push({ so, date: s.date, qty, delivered, pending, unitValue, value: qty * unitValue });
    });
  });

  const totalQty = rows.reduce((a, r) => a + r.qty, 0);
  const totalValue = rows.reduce((a, r) => a + r.value, 0);
  const totalPending = rows.reduce((a, r) => a + r.pending, 0);
  const selected = selectedMonth ? rows.find(r => r.key === selectedMonth) : null;

  return (
    <Card data-testid="dashboard-sales-forecast">
      <CardHeader
        title="Next 6 Months Sales Forecast"
        right={
          <div className="flex items-center gap-2">
            <Badge color="indigo">{totalQty} Nos</Badge>
            <Badge color="green">{fmtINR(totalValue)}</Badge>
            {totalPending > 0 && <Badge color="amber">{totalPending} pending</Badge>}
          </div>
        }
      />
      <div className="p-4 grid lg:grid-cols-[1fr_1.1fr] gap-4">
        <div>
          <div className="text-xs text-slate-500 mb-2">Scheduled delivery quantity per month · click a bar to drill down</div>
          {totalQty === 0 ? (
            <Empty title="No delivery schedules found in the next 6 months" />
          ) : (
            <div className="grid grid-cols-6 items-end gap-2 h-56 px-1">
              {rows.map(r => {
                const max = Math.max(...rows.map(x => x.qty), 1);
                const h = r.qty > 0 ? Math.max(6, (r.qty / max) * 180) : 4;
                const active = selectedMonth === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => r.qty > 0 && setSelectedMonth(r.key)}
                    data-testid={`forecast-bar-${r.key}`}
                    className="flex flex-col items-center gap-1 group focus:outline-none"
                    disabled={r.qty === 0}
                  >
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 h-4">{r.qty || ""}</div>
                    <div
                      style={{ height: h }}
                      className={
                        "w-full rounded-t-md transition-all cursor-pointer " +
                        (r.qty === 0
                          ? "bg-slate-200 dark:bg-slate-700 opacity-60 cursor-not-allowed"
                          : active
                            ? "bg-gradient-to-t from-indigo-600 to-violet-500 shadow-lg"
                            : "bg-gradient-to-t from-indigo-500 to-indigo-400 hover:from-indigo-600 hover:to-violet-500")
                      }
                      title={`${r.label}: ${r.qty} Nos · ${fmtINR(r.value)}`}
                    />
                    <div className="text-[10px] text-slate-500 mt-1">{r.short}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <Table>
              <thead>
                <tr><Th>Month</Th><Th className="text-right">Qty (Nos)</Th><Th className="text-right">Sales Amount</Th><Th className="text-right">Pending</Th><Th></Th></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr
                    key={r.key}
                    onClick={() => r.qty > 0 && setSelectedMonth(r.key)}
                    className={"cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 " + (r.qty === 0 ? "opacity-60 cursor-not-allowed" : "")}
                    data-testid={`forecast-row-${r.key}`}
                  >
                    <Td className="font-medium">{r.short}<div className="text-[10px] text-slate-500">{r.slots} slot{r.slots === 1 ? "" : "s"}</div></Td>
                    <Td className="text-right font-semibold">{r.qty}</Td>
                    <Td className="text-right">{fmtINR(r.value)}</Td>
                    <Td className="text-right">
                      {r.pending > 0 ? <Badge color="amber">{r.pending}</Badge> : <span className="text-slate-400">—</span>}
                    </Td>
                    <Td className="text-right">
                      {r.qty > 0 && <button type="button" className="text-xs text-indigo-600 hover:underline">View</button>}
                    </Td>
                  </tr>
                ))}
                <tr className="bg-slate-100 dark:bg-slate-800/60 font-semibold">
                  <Td>6-Month Total</Td>
                  <Td className="text-right">{totalQty}</Td>
                  <Td className="text-right">{fmtINR(totalValue)}</Td>
                  <Td className="text-right">{totalPending}</Td>
                  <Td></Td>
                </tr>
              </tbody>
            </Table>
          </div>
          <div className="text-[11px] text-slate-500 mt-2">
            Auto-computed from every Sales Order's Delivery Schedule. Updates instantly when a schedule is added, edited or a delivery is recorded.
          </div>
        </div>
      </div>

      <Modal open={!!selected} onClose={() => setSelectedMonth(null)} title={selected ? `Forecast · ${selected.label}` : "Forecast"} size="xl">
        {selected && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-xs text-slate-500">Scheduled Qty</div>
                <div className="text-xl font-bold">{selected.qty} Nos</div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-xs text-slate-500">Sales Amount</div>
                <div className="text-xl font-bold">{fmtINR(selected.value)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-xs text-slate-500">Delivered / Pending</div>
                <div className="text-xl font-bold">
                  <span className="text-emerald-600">{selected.delivered}</span>
                  <span className="text-slate-400"> / </span>
                  <span className="text-amber-600">{selected.pending}</span>
                </div>
              </div>
            </div>
            <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
              <Table>
                <thead>
                  <tr><Th>SO #</Th><Th>Customer</Th><Th>Delivery Date</Th><Th className="text-right">Qty</Th><Th className="text-right">Delivered</Th><Th className="text-right">Pending</Th><Th className="text-right">Value</Th></tr>
                </thead>
                <tbody>
                  {contributions[selected.key]
                    .slice()
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((c, i) => {
                      const cust = db.parties.find((p: any) => p.id === c.so.customerId);
                      return (
                        <tr key={c.so.id + "-" + i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <Td className="font-mono text-xs">{c.so.number}</Td>
                          <Td>{cust?.name || "Unknown"}</Td>
                          <Td>{c.date}</Td>
                          <Td className="text-right font-semibold">{c.qty}</Td>
                          <Td className="text-right text-emerald-600">{c.delivered}</Td>
                          <Td className="text-right">{c.pending > 0 ? <span className="text-amber-600 font-semibold">{c.pending}</span> : "—"}</Td>
                          <Td className="text-right">{fmtINR(c.value)}</Td>
                        </tr>
                      );
                    })}
                </tbody>
              </Table>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setSelectedMonth(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}


function DashboardDrillDown({
  drill, onClose, db, monthBuckets,
}: {
  drill: { type: "sales" | "production" | "customer"; monthKey?: string; monthLabel?: string; customerId?: string } | null;
  onClose: () => void;
  db: any;
  monthBuckets: { key: string; label: string; date: Date }[];
}) {
  if (!drill) return null;

  const soValue = (soId: string): { qty: number; value: number } => {
    const so = db.salesOrders.find((o: any) => o.id === soId);
    if (!so) return { qty: 0, value: 0 };
    return {
      qty: so.items.reduce((a: number, b: any) => a + (Number(b.qty) || 0), 0),
      value: so.items.reduce((a: number, b: any) => a + (Number(b.qty) || 0) * (Number(b.rate) || 0), 0),
    };
  };

  if (drill.type === "sales") {
    const rows = db.challans
      .filter((c: any) => c.date && c.date.slice(0, 7) === drill.monthKey)
      .map((c: any) => {
        const so = db.salesOrders.find((o: any) => o.id === c.salesOrderId);
        const cust = db.parties.find((p: any) => p.id === c.customerId);
        const val = soValue(c.salesOrderId);
        return { c, so, cust, ...val };
      })
      .sort((a: any, b: any) => (b.c.date || "").localeCompare(a.c.date || ""));
    const totalQty = rows.reduce((a: number, r: any) => a + r.qty, 0);
    const totalValue = rows.reduce((a: number, r: any) => a + r.value, 0);
    return (
      <Modal open={true} onClose={onClose} title={`Delivery Challans · ${drill.monthLabel}`} size="xl">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <div className="text-xs text-slate-500">Total Challans</div>
              <div className="text-xl font-bold">{rows.length}</div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <div className="text-xs text-slate-500">Total Qty</div>
              <div className="text-xl font-bold">{totalQty} Nos</div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <div className="text-xs text-slate-500">Total Amount</div>
              <div className="text-xl font-bold">{fmtINR(totalValue)}</div>
            </div>
          </div>
          <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
            <Table>
              <thead><tr><Th>DC #</Th><Th>Date</Th><Th>Customer</Th><Th>SO #</Th><Th className="text-right">Qty</Th><Th className="text-right">Amount</Th></tr></thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><Td colSpan={6}><Empty title="No delivery challans in this month" /></Td></tr>
                ) : rows.map((r: any) => (
                  <tr key={r.c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Td className="font-mono text-xs">{r.c.number}</Td>
                    <Td>{r.c.date}</Td>
                    <Td>{r.cust?.name || "—"}</Td>
                    <Td className="font-mono text-xs text-slate-500">{r.so?.number || "—"}</Td>
                    <Td className="text-right font-semibold">{r.qty}</Td>
                    <Td className="text-right">{fmtINR(r.value)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      </Modal>
    );
  }

  if (drill.type === "production") {
    const rows = db.jobCards
      .filter((j: any) => j.status === "Completed" && (j.date || "").slice(0, 7) === drill.monthKey)
      .sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));
    const totalQty = rows.reduce((a: number, j: any) => a + (Number(j.qty) || 0), 0);
    return (
      <Modal open={true} onClose={onClose} title={`Completed Job Cards · ${drill.monthLabel}`} size="xl">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <div className="text-xs text-slate-500">Completed Job Cards</div>
              <div className="text-xl font-bold">{rows.length}</div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <div className="text-xs text-slate-500">Total Units Produced</div>
              <div className="text-xl font-bold">{totalQty}</div>
            </div>
          </div>
          <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
            <Table>
              <thead><tr><Th>JC #</Th><Th>Date</Th><Th>Product</Th><Th className="text-right">Qty</Th><Th>Linked SO</Th></tr></thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><Td colSpan={5}><Empty title="No completed Job Cards in this month" /></Td></tr>
                ) : rows.map((j: any) => {
                  const so = db.salesOrders.find((o: any) => o.id === j.salesOrderId);
                  return (
                    <tr key={j.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <Td className="font-mono text-xs">{j.number}</Td>
                      <Td>{j.date}</Td>
                      <Td>{j.product}</Td>
                      <Td className="text-right font-semibold">{j.qty}</Td>
                      <Td className="font-mono text-xs text-slate-500">{so?.number || "—"}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </div>
      </Modal>
    );
  }

  // Customer drill-down
  const cust = db.parties.find((p: any) => p.id === drill.customerId);
  const custSOs = db.salesOrders
    .filter((o: any) => o.customerId === drill.customerId)
    .sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));
  const totQty = custSOs.reduce((a: number, o: any) => a + o.items.reduce((s: number, it: any) => s + (Number(it.qty) || 0), 0), 0);
  const totVal = custSOs.reduce((a: number, o: any) => a + o.items.reduce((s: number, it: any) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0), 0);
  void monthBuckets;
  return (
    <Modal open={true} onClose={onClose} title={`Sales Orders · ${cust?.name || "Customer"}`} size="xl">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <div className="text-xs text-slate-500">Total Sales Orders</div>
            <div className="text-xl font-bold">{custSOs.length}</div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <div className="text-xs text-slate-500">Total Qty</div>
            <div className="text-xl font-bold">{totQty} Nos</div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <div className="text-xs text-slate-500">Total Value</div>
            <div className="text-xl font-bold">{fmtINR(totVal)}</div>
          </div>
        </div>
        <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
          <Table>
            <thead><tr><Th>SO #</Th><Th>Date</Th><Th className="text-right">Qty</Th><Th className="text-right">Value</Th><Th>Status</Th></tr></thead>
            <tbody>
              {custSOs.length === 0 ? (
                <tr><Td colSpan={5}><Empty title="No sales orders for this customer" /></Td></tr>
              ) : custSOs.map((o: any) => {
                const q = o.items.reduce((s: number, it: any) => s + (Number(it.qty) || 0), 0);
                const v = o.items.reduce((s: number, it: any) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
                return (
                  <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Td className="font-mono text-xs">{o.number}</Td>
                    <Td>{o.date}</Td>
                    <Td className="text-right font-semibold">{q}</Td>
                    <Td className="text-right">{fmtINR(v)}</Td>
                    <Td><Badge color={o.status === "Delivered" ? "green" : o.status === "In Production" ? "blue" : "amber"}>{o.status}</Badge></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </div>
    </Modal>
  );
}

