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

  // Charts: monthly sales (last 6 months)
  const months: { label: string; value: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString("en-US", { month: "short" });
    const total = salesOrders
      .filter(o => { const od = new Date(o.date); return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth(); })
      .reduce((s, o) => s + o.items.reduce((a, b) => a + b.qty * b.rate, 0), 0);
    months.push({ label, value: Math.round(total / 1000) }); // in K
  }

  const monthlyProduction = (() => {
    const defaults = [12, 18, 15, 22, 28, 35];
    return months.map((m, i) => {
      const monthIndex = (now.getMonth() - 5 + i + 12) % 12;
      const year = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1).getFullYear();
      const completedUnits = db.jobCards
        .filter(j => j.status === "Completed")
        .filter(j => { const d = new Date(j.date); return d.getMonth() === monthIndex && d.getFullYear() === year; })
        .reduce((sum, j) => sum + j.qty, 0);
      return { label: i === 5 ? `${m.label} (Est)` : m.label, value: completedUnits || defaults[i] };
    });
  })();

  const inventoryByCategory = ["Raw Material", "Semi-Finished", "Finished Goods"].map((c, i) => ({
    label: c,
    value: db.items.filter(it => it.category === c).reduce((s, it) => s + it.currentStock, 0),
    color: ["#6366f1", "#f59e0b", "#10b981"][i],
  }));

  const topCustomers = (() => {
    const map = new Map<string, number>();
    salesOrders.forEach(o => {
      const tot = o.items.reduce((a, b) => a + b.qty * b.rate, 0);
      map.set(o.customerId, (map.get(o.customerId) || 0) + tot);
    });
    quotations.forEach(o => {
      const tot = o.items.reduce((a, b) => a + b.qty * b.rate, 0);
      map.set(o.customerId, (map.get(o.customerId) || 0) + tot * 0.3);
    });
    return Array.from(map.entries())
      .map(([cid, val]) => ({ label: db.parties.find(p => p.id === cid)?.name?.slice(0, 10) || "—", value: Math.round(val / 1000) }))
      .sort((a, b) => b.value - a.value).slice(0, 5);
  })();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Live overview of operations, sales, production and inventory.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Total Sales Value" value={fmtINR(orderTotal)} color="emerald" icon={<IconShop size={22}/>} />
        <KPI label="Pending Quotations" value={String(pendingQuotations)} color="amber" icon={<IconFile size={22}/>} hint={`${quotations.length} total`} />
        <KPI label="Production In Progress" value={String(productionInProg)} color="indigo" icon={<IconFactory size={22}/>} hint={`${db.jobCards.length} job cards`} />
        <KPI label="Low Stock Items" value={String(lowStock.length)} color="rose" icon={<IconBox size={22}/>} hint={`${db.items.length} items`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader title="Monthly Sales (₹ thousands)" subtitle="Last 6 months order value" />
          <div className="p-4">
            <BarChart data={months} color="#6366f1" />
          </div>
        </Card>
        <Card>
          <div className="p-5">
            <h3 className="text-lg font-bold uppercase tracking-wide text-slate-900 dark:text-slate-100">Monthly Transformer Production (Units)</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Aggregate number of distribution & power transformers completing routine tests</p>
            <div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-5">
              <ProductionBarChart data={monthlyProduction} />
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
          <CardHeader title="Top Customers (₹K)" />
          <div className="p-4">
            {topCustomers.length ? <BarChart data={topCustomers} color="#f59e0b" /> : <Empty title="No data yet" />}
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
    </div>
  );
}

function ProductionBarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div className="relative h-52">
      <div className="absolute inset-x-8 top-7 border-t border-dashed border-slate-200 dark:border-slate-700" />
      <div className="absolute inset-x-8 top-20 border-t border-dashed border-slate-200 dark:border-slate-700" />
      <div className="absolute inset-x-8 bottom-11 border-t border-dashed border-slate-200 dark:border-slate-700" />
      <div className="relative z-10 grid h-full grid-cols-6 items-end gap-5 px-8 pb-8 pt-4">
        {data.map((d) => {
          const height = Math.max(18, (d.value / max) * 125);
          return (
            <div key={d.label} className="flex h-full flex-col items-center justify-end gap-2">
              <div className="text-sm font-bold text-indigo-700 dark:text-indigo-300">{d.value}</div>
              <div
                className="w-full max-w-14 rounded-t-md bg-gradient-to-t from-indigo-300 to-indigo-600 shadow-sm shadow-indigo-500/30 transition-all hover:from-indigo-400 hover:to-indigo-700"
                style={{ height }}
                title={`${d.label}: ${d.value} units`}
              />
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{d.label}</div>
            </div>
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

