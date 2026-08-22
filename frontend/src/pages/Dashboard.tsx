import { useState } from "react";
import { useStore } from "../lib/store";
import { Card, CardHeader, KPI, Badge, Empty, Modal, Table, Th, Td, Button } from "../components/ui";
import { BarChart, DonutChart } from "../components/charts";
import { fmtINR, fmt2 } from "../lib/utils";
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

  // Total Sales Value = value of actual Delivery Challans (dispatched), not open Sales Orders.
  const orderTotal = db.challans.reduce((s, c) => {
    const items = (c.items || []) as Array<{ qty: number; rate: number; gst: number }>;
    return s + items.reduce((a, b) => a + (Number(b.qty) || 0) * (Number(b.rate) || 0) * (1 + (Number(b.gst) || 0) / 100), 0) + (Number(c.freight) || 0);
  }, 0);
  const pendingQuotations = quotations.filter(q => q.status === "Quotation Sent" || q.status === "Negotiation").length;
  const lowStock = db.items.filter(i => i.currentStock <= i.minStock);

  const [drill, setDrill] = useState<{ type: "sales" | "production" | "customer"; monthKey?: string; monthLabel?: string; customerId?: string } | null>(null);

  // Financial Year selector (April → March) — declared FIRST so every filter below can use isInFy.
  const now = new Date();
  const currentFyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [fyStartYear, setFyStartYear] = useState<number>(currentFyStartYear);
  const fyOptions = [currentFyStartYear + 1, currentFyStartYear, currentFyStartYear - 1, currentFyStartYear - 2].sort((a, b) => b - a);
  const fyLabel = (y: number) => `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;

  // 12 FY month buckets in Financial-Year order (Apr → Mar)
  const monthBuckets: { key: string; label: string; date: Date }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(fyStartYear, 3 + i, 1);
    monthBuckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "short" }) + " " + String(d.getFullYear()).slice(2),
      date: d,
    });
  }
  const fyMonthKeys = monthBuckets.map(m => m.key);
  const isInFy = (dateStr: string | undefined) => !!dateStr && fyMonthKeys.includes(dateStr.slice(0, 7));

  // Shortage analysis from pending Job Cards (Open / In Progress).
  // Each JC's `reservedItems` is already the BOM × qty snapshot at JC creation.
  interface ShortageJC { jc: any; qty: number }
  interface Shortage {
    itemId: string;
    itemName: string;
    unit: string;
    required: number;
    available: number;
    currentStock: number;
    heldQty: number;
    shortage: number;
    jobCards: ShortageJC[];
  }
  const pendingJobCards = db.jobCards.filter((j: any) => j.status !== "Completed" && isInFy(j.date));
  const requiredByItem = new Map<string, ShortageJC[]>();
  pendingJobCards.forEach((jc: any) => {
    (jc.reservedItems || []).forEach((r: { itemId: string; qty: number }) => {
      if (!r.itemId || !r.qty) return;
      const list = requiredByItem.get(r.itemId) || [];
      list.push({ jc, qty: Number(r.qty) || 0 });
      requiredByItem.set(r.itemId, list);
    });
  });
  const shortages: Shortage[] = [];
  requiredByItem.forEach((jcs, itemId) => {
    const item = db.items.find((it: any) => it.id === itemId);
    if (!item) return;
    const required = jcs.reduce((a, j) => a + j.qty, 0);
    const available = Number(item.currentStock) || 0;
    if (required <= available) return;
    shortages.push({
      itemId, itemName: item.name, unit: item.unit || "Nos",
      required,
      available,
      currentStock: Number(item.currentStock) || 0,
      heldQty: required,
      shortage: required - available,
      jobCards: jcs,
    });
  });
  shortages.sort((a, b) => b.shortage - a.shortage);
  const [shortageDrill, setShortageDrill] = useState<Shortage | null>(null);
  const [shortageListOpen, setShortageListOpen] = useState(false);
  const productionInProg = db.jobCards.filter(j => j.status === "In Progress").length;

  // ---- Monthly Sales from Delivery Challans (actual dispatched qty × rate, not full SO) ----
  const dcValue = (c: any): number => {
    const items = (c.items || []) as Array<{ qty: number; rate: number; gst: number }>;
    const sub = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
    const gst = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0) * ((Number(i.gst) || 0) / 100), 0);
    return sub + gst + (Number(c.freight) || 0);
  };

  const months = monthBuckets.map(m => {
    const total = db.challans
      .filter(c => c.date && c.date.slice(0, 7) === m.key)
      .reduce((s, c) => s + dcValue(c), 0);
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

  // ---- Top Customers from Delivery Challans (actual dispatched, within FY) ----
  interface CustomerAgg { customerId: string; name: string; totalQty: number; totalValue: number; orders: number }
  const customerAggMap = new Map<string, CustomerAgg>();
  db.challans.filter((c: any) => isInFy(c.date)).forEach((c: any) => {
    const items = (c.items || []) as Array<{ qty: number; rate: number; gst: number }>;
    const dcQty = items.reduce((a, b) => a + (Number(b.qty) || 0), 0);
    const dcVal = items.reduce((a, b) => a + (Number(b.qty) || 0) * (Number(b.rate) || 0), 0) + (Number(c.freight) || 0);
    const existing = customerAggMap.get(c.customerId);
    if (existing) {
      existing.totalQty += dcQty; existing.totalValue += dcVal; existing.orders += 1;
    } else {
      customerAggMap.set(c.customerId, {
        customerId: c.customerId,
        name: db.parties.find(p => p.id === c.customerId)?.name || "—",
        totalQty: dcQty, totalValue: dcVal, orders: 1,
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
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg p-1" data-testid="dashboard-fy-selector">
          <span className="text-[11px] uppercase tracking-wide text-slate-500 pl-2">Financial Year</span>
          <select
            value={fyStartYear}
            onChange={e => setFyStartYear(Number(e.target.value))}
            className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-md px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="dashboard-fy-select"
          >
            {fyOptions.map(y => (
              <option key={y} value={y}>{fyLabel(y)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-2 gap-4">
        <KPI label="Production In Progress" value={String(productionInProg)} color="indigo" icon={<IconFactory size={22}/>} hint={`${db.jobCards.length} job cards`} />
        <KPI label="Material Shortages" value={String(shortages.length)} color="rose" icon={<IconBox size={22}/>} hint={`from ${pendingJobCards.length} pending JC`} />
      </div>

      <div className="grid lg:grid-cols-1 gap-5">
        <Card>
          <div className="p-5">
            <h3 className="text-lg font-bold uppercase tracking-wide text-slate-900 dark:text-slate-100">Monthly Production</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Total Completed Job Cards · {fyLabel(fyStartYear)} · click a month to view completed job cards</p>
            <div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-5">
              <ProductionBarChart
                data={monthlyProduction}
                onBarClick={(i) => setDrill({ type: "production", monthKey: monthBuckets[i].key, monthLabel: `${monthBuckets[i].label} ${monthBuckets[i].date.getFullYear()}` })}
              />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader title="Inventory by Category" />
          <div className="p-5"><DonutChart data={inventoryByCategory} /></div>
        </Card>
        <Card>
          <button
            type="button"
            onClick={() => setShortageListOpen(true)}
            className="w-full text-left focus:outline-none"
            data-testid="dashboard-low-stock-header"
          >
            <CardHeader
              title={<span className="hover:text-indigo-600 transition inline-flex items-center gap-1">Low Stock Alerts <span className="text-[10px] text-slate-500 font-normal">(click to view all)</span></span>}
              subtitle="Shortages from Pending Job Cards vs current inventory"
              right={<Badge color={shortages.length ? "red" : "green"}>{shortages.length}</Badge>}
            />
          </button>
          <div className="p-4 space-y-2 max-h-72 overflow-y-auto" data-testid="dashboard-low-stock">
            {shortages.length === 0 && <Empty title="No shortages against pending job cards" />}
            {shortages.slice(0, 5).map(s => (
              <button
                key={s.itemId}
                type="button"
                onClick={() => setShortageDrill(s)}
                className="w-full text-left flex items-start justify-between gap-3 text-sm border-b border-slate-100 dark:border-slate-800 pb-2 pt-1 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded px-2 -mx-2 transition"
                data-testid={`shortage-row-${s.itemId}`}
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-700 dark:text-slate-200 truncate">{s.itemName}</div>
                  <div className="text-[11px] text-slate-500 truncate">{s.jobCards.length} JC{s.jobCards.length === 1 ? "" : "s"} affected</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Req <b className="text-slate-700 dark:text-slate-200">{fmt2(s.required)}</b> · Avail <b className="text-slate-700 dark:text-slate-200">{fmt2(s.available)}</b>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-base font-bold text-rose-600">-{fmt2(s.shortage)}</div>
                  <div className="text-[10px] text-rose-500 uppercase tracking-wide">Shortage</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{s.unit}</div>
                </div>
              </button>
            ))}
            {shortages.length > 5 && (
              <button
                type="button"
                onClick={() => setShortageListOpen(true)}
                className="w-full text-center text-xs text-indigo-600 dark:text-indigo-400 hover:underline pt-2"
                data-testid="dashboard-low-stock-view-all"
              >
                View all {shortages.length} shortages →
              </button>
            )}
          </div>
        </Card>
      </div>

      <SalesForecast salesOrders={salesOrders} db={db} fyStartYear={fyStartYear} fyLabel={fyLabel} />

      <DelayedDeliveries salesOrders={salesOrders} db={db} />
      <OverduePOs db={db} />
      <ReadyNotDispatched db={db} />

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

      <Modal open={shortageListOpen} onClose={() => setShortageListOpen(false)} title={`Low Stock Alerts — ${shortages.length} Shortage${shortages.length === 1 ? "" : "s"}`} size="xl">
        <div className="text-xs text-slate-500 mb-3">Items where pending Job Card requirement exceeds available inventory. Click any row to see the affected Job Cards and material breakdown.</div>
        {shortages.length === 0 ? (
          <Empty title="No shortages" />
        ) : (
          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <Table>
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/60 backdrop-blur z-10">
                <tr>
                  <Th>Item Name</Th>
                  <Th>UOM</Th>
                  <Th className="text-right">Required Qty</Th>
                  <Th className="text-right">Current Stock</Th>
                  <Th className="text-right">Held Qty</Th>
                  <Th className="text-right">Available Qty</Th>
                  <Th className="text-right">Shortage Qty</Th>
                  <Th className="text-right">Affected JCs</Th>
                </tr>
              </thead>
              <tbody>
                {shortages.map(s => {
                  const availableNet = s.currentStock - s.heldQty;
                  return (
                    <tr
                      key={s.itemId}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                      onClick={() => { setShortageDrill(s); setShortageListOpen(false); }}
                      data-testid={`shortage-list-row-${s.itemId}`}
                    >
                      <Td className="font-medium">{s.itemName}</Td>
                      <Td>{s.unit}</Td>
                      <Td className="text-right">{fmt2(s.required)}</Td>
                      <Td className="text-right">{fmt2(s.currentStock)}</Td>
                      <Td className="text-right text-amber-600">{fmt2(s.heldQty)}</Td>
                      <Td className={"text-right " + (availableNet < 0 ? "text-rose-600 font-semibold" : "")}>{fmt2(availableNet)}</Td>
                      <Td className="text-right">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-bold">
                          -{fmt2(s.shortage)}
                        </span>
                      </Td>
                      <Td className="text-right">
                        <Badge color="blue">{s.jobCards.length}</Badge>
                      </Td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-50 dark:bg-slate-800/40 font-semibold border-t-2 border-slate-300 dark:border-slate-600">
                  <Td colSpan={6} className="text-right">Total Shortage across {shortages.length} item{shortages.length === 1 ? "" : "s"}</Td>
                  <Td className="text-right text-rose-600">-{fmt2(shortages.reduce((s, x) => s + x.shortage, 0))}</Td>
                  <Td className="text-right">
                    <Badge color="blue">{new Set(shortages.flatMap(x => x.jobCards.map(j => j.jc.id))).size}</Badge>
                  </Td>
                </tr>
              </tbody>
            </Table>
          </div>
        )}
      </Modal>

      <Modal open={!!shortageDrill} onClose={() => setShortageDrill(null)} title={shortageDrill ? `Shortage · ${shortageDrill.itemName}` : "Shortage"} size="xl">
        {shortageDrill && (
          <div className="space-y-3" data-testid="shortage-drill-modal">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-xs text-slate-500">Required</div>
                <div className="text-xl font-bold">{fmt2(shortageDrill.required)} <span className="text-xs text-slate-500">{shortageDrill.unit}</span></div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-xs text-slate-500">Available Stock</div>
                <div className="text-xl font-bold">{fmt2(shortageDrill.available)} <span className="text-xs text-slate-500">{shortageDrill.unit}</span></div>
              </div>
              <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-900/20 p-3">
                <div className="text-xs text-rose-600">Shortage</div>
                <div className="text-xl font-bold text-rose-600">{fmt2(shortageDrill.shortage)} <span className="text-xs">{shortageDrill.unit}</span></div>
              </div>
              <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/20 p-3">
                <div className="text-xs text-indigo-600">To Purchase</div>
                <div className="text-xl font-bold text-indigo-700 dark:text-indigo-300">{fmt2(shortageDrill.shortage)} <span className="text-xs">{shortageDrill.unit}</span></div>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              Affected Job Cards: {shortageDrill.jobCards.length}
            </div>
            <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
              <Table>
                <thead>
                  <tr>
                    <Th>JC #</Th><Th>Date</Th><Th>Product</Th><Th>Status</Th>
                    <Th className="text-right">Required Qty</Th>
                    <Th className="text-right">Available</Th>
                    <Th className="text-right">Shortage</Th>
                  </tr>
                </thead>
                <tbody>
                  {shortageDrill.jobCards
                    .slice()
                    .sort((a, b) => b.qty - a.qty)
                    .map(({ jc, qty }, idx) => (
                    <tr key={jc.id + "-" + idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <Td className="font-mono text-xs">{jc.number}</Td>
                      <Td>{jc.date}</Td>
                      <Td>{jc.product}</Td>
                      <Td><Badge color={jc.status === "In Progress" ? "blue" : "amber"}>{jc.status}</Badge></Td>
                      <Td className="text-right font-semibold">{fmt2(qty)} <span className="text-slate-400 text-[10px]">{shortageDrill.unit}</span></Td>
                      <Td className="text-right text-slate-500">{fmt2(shortageDrill.available)}</Td>
                      <Td className="text-right"><span className="font-bold text-rose-600">{fmt2(Math.max(0, qty))}</span></Td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 dark:bg-slate-800/60 font-semibold">
                    <Td colSpan={4}>Total Required · Total Shortage</Td>
                    <Td className="text-right">{fmt2(shortageDrill.required)}</Td>
                    <Td className="text-right">{fmt2(shortageDrill.available)}</Td>
                    <Td className="text-right text-rose-600">{fmt2(shortageDrill.shortage)}</Td>
                  </tr>
                </tbody>
              </Table>
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-slate-500">
              <div>Total quantity to be purchased to clear this shortage: <b className="text-rose-600">{fmt2(shortageDrill.shortage)} {shortageDrill.unit}</b></div>
              <Button variant="outline" onClick={() => setShortageDrill(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
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

function ReadyNotDispatched({ db }: { db: any }) {
  const [threshold, setThreshold] = useState<number>(7);

  const rows = db.jobCards
    .map((jc: any) => {
      let ready = 0;
      if (jc.status === "Completed") ready = jc.qty;
      else {
        const drEntries = db.productionEntries.filter((e: any) => e.jobCardId === jc.id && e.stage === "Dispatch Ready");
        ready = Math.min(jc.qty, drEntries.reduce((s: number, e: any) => s + (Number(e.todayQty) || 0), 0));
      }
      const dispatched = db.challans
        .filter((c: any) => c.jobCardId === jc.id)
        .flatMap((c: any) => c.items || [])
        .reduce((s: number, i: any) => s + (Number(i.qty) || 0), 0);
      const remaining = Math.max(0, ready - dispatched);
      if (remaining <= 0) return null;
      const readyDates = db.productionEntries
        .filter((e: any) => e.jobCardId === jc.id && e.stage === "Dispatch Ready")
        .map((e: any) => e.date)
        .filter(Boolean);
      const earliestReady = readyDates.length ? readyDates.sort()[0] : jc.date;
      const daysSinceReady = Math.max(0, Math.floor((Date.now() - new Date(earliestReady).getTime()) / (1000 * 60 * 60 * 24)));
      const so = jc.salesOrderId ? db.salesOrders.find((s: any) => s.id === jc.salesOrderId) : null;
      const cust = so ? db.parties.find((p: any) => p.id === so.customerId) : null;
      return { jc, ready, dispatched, remaining, earliestReady, daysSinceReady, so, cust };
    })
    .filter((r: any) => r && r.daysSinceReady > threshold)
    .sort((a: any, b: any) => b.daysSinceReady - a.daysSinceReady);

  return (
    <Card data-testid="dashboard-ready-not-dispatched">
      <CardHeader
        title={<span className="inline-flex items-center gap-2">Ready but Not Dispatched <span className="text-[10px] text-slate-500 font-normal">(sitting more than {threshold} day{threshold === 1 ? "" : "s"})</span></span>}
        right={
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-slate-500">Threshold</label>
            <input
              type="number"
              min={0}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(0, Number(e.target.value) || 0))}
              className="w-16 text-right px-2 py-1 h-7 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs"
              data-testid="ready-not-dispatched-threshold"
            />
            <span className="text-[11px] text-slate-500">days</span>
            <Badge color={rows.length ? "red" : "green"}>{rows.length}</Badge>
          </div>
        }
      />
      {rows.length === 0 ? (
        <div className="p-4"><Empty title={`No Job Cards sitting Ready for more than ${threshold} day${threshold === 1 ? "" : "s"}`} /></div>
      ) : (
        <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
          {rows.map(({ jc, ready, dispatched, remaining, earliestReady, daysSinceReady, so, cust }: any) => (
            <div key={jc.id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2" data-testid={`ready-not-dispatched-row-${jc.id}`}>
              <div className="min-w-0">
                <div className="font-medium text-slate-700 dark:text-slate-200 truncate flex items-center gap-1.5">
                  <span aria-hidden>📦</span>
                  <span className="font-mono text-xs mr-1 text-slate-500">{jc.number}</span>
                  <span className="truncate">{jc.product}</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Ready <b className="text-emerald-600">{ready}</b> · Dispatched <b>{dispatched}</b> · Pending <b className="text-rose-600">{remaining}</b>
                  {so ? <> · SO <span className="font-mono">{so.number}</span></> : null}
                  {cust ? <> · {cust.name}</> : null}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Ready since <b>{earliestReady}</b></div>
              </div>
              <div className="text-right shrink-0 ml-3">
                <Badge color={daysSinceReady > threshold * 2 ? "red" : "yellow"}>{daysSinceReady} {daysSinceReady === 1 ? "Day" : "Days"}</Badge>
                <div className="text-[10px] text-slate-500 mt-1 uppercase tracking-wide">Sitting Idle</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}


function SalesForecast({ salesOrders, db, fyStartYear: defaultFyStartYear, fyLabel }: { salesOrders: any[]; db: any; fyStartYear: number; fyLabel: (y: number) => string }) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState<Set<string>>(new Set());
  const [fyStartYear, setFyStartYear] = useState<number>(defaultFyStartYear);
  const [periodMonths, setPeriodMonths] = useState<3 | 6 | 9 | 12>(6);
  const fyOptions = [defaultFyStartYear + 1, defaultFyStartYear, defaultFyStartYear - 1, defaultFyStartYear - 2].sort((a, b) => b - a);

  // Selected FY window (Apr 1 → Mar 31 of next year)
  const now = new Date();
  const fyStart = new Date(fyStartYear, 3, 1);
  const fyEnd = new Date(fyStartYear + 1, 2, 31);

  // Period buckets: start at current month if inside FY, else at Apr; then N months forward,
  // clamped to the FY end so slots never leak into a different FY.
  const startMonth = now >= fyStart && now <= fyEnd
    ? new Date(now.getFullYear(), now.getMonth(), 1)
    : fyStart;
  const months: { key: string; label: string; short: string }[] = [];
  const cursor = new Date(startMonth);
  while (cursor <= fyEnd && months.length < periodMonths) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    months.push({
      key,
      label: cursor.toLocaleString("en-IN", { month: "long", year: "numeric" }),
      short: cursor.toLocaleString("en-IN", { month: "short", year: "2-digit" }),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // Palette for products (max 10 distinct + Other)
  const PALETTE = ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#0ea5e9", "#f97316", "#8b5cf6", "#14b8a6", "#ef4444", "#84cc16"];
  const OTHER_COLOR = "#94a3b8";

  // Per-slot contributions, but expanded per PRODUCT (item) within each SO
  interface ProductContribution {
    so: any;
    productName: string;
    date: string;
    qty: number;           // pro-rated slot qty for this product
    delivered: number;
    pending: number;
    unitRate: number;
    value: number;
  }
  const contributions: Record<string, ProductContribution[]> = {};
  months.forEach(m => contributions[m.key] = []);

  // Row totals + per-product per-month tallies
  interface Row { key: string; label: string; short: string; qty: number; value: number; delivered: number; pending: number; slots: number }
  const rows: Row[] = months.map(m => ({ ...m, qty: 0, value: 0, delivered: 0, pending: 0, slots: 0 }));
  const productTotals = new Map<string, { name: string; totalQty: number; totalValue: number; monthQty: Record<string, number> }>();

  salesOrders.forEach((so: any) => {
    if (!so.schedules || so.schedules.length === 0) return;
    const orderQty = totalOrderQty(so);
    if (!orderQty) return;
    so.schedules.forEach((s: any) => {
      if (!s.date) return;
      const m = s.date.slice(0, 7);
      const row = rows.find(r => r.key === m);
      if (!row) return;
      const slotQty = Number(s.qty) || 0;
      const slotDelivered = Math.max(0, Number(s.deliveredQty) || 0);
      const slotPending = Math.max(0, slotQty - slotDelivered);
      if (slotQty <= 0) return;
      row.slots += 1;

      // Determine which items receive this slot's qty.
      // If the slot has an itemName (item-wise schedule), attribute 100% to that item.
      // Otherwise (legacy schedule), split proportionally across all items by qty.
      const targetItems = s.itemName
        ? so.items.filter((it: any) => it.name === s.itemName)
        : so.items;

      const targetQtyTotal = targetItems.reduce((a: number, it: any) => a + (Number(it.qty) || 0), 0);
      if (targetQtyTotal <= 0) return;

      targetItems.forEach((it: any) => {
        const itQty = Number(it.qty) || 0;
        if (itQty <= 0) return;
        const share = s.itemName ? 1 : (itQty / targetQtyTotal);
        const pQty = slotQty * share;
        const pDelivered = slotDelivered * share;
        const pPending = slotPending * share;
        const pValue = pQty * (Number(it.rate) || 0);
        row.qty += pQty;
        row.value += pValue;
        row.delivered += pDelivered;
        row.pending += pPending;
        const key = String(it.name || "Product").trim() || "Product";
        const p = productTotals.get(key) || { name: key, totalQty: 0, totalValue: 0, monthQty: {} };
        p.totalQty += pQty;
        p.totalValue += pValue;
        p.monthQty[m] = (p.monthQty[m] || 0) + pQty;
        productTotals.set(key, p);
        contributions[m].push({
          so,
          productName: key,
          date: s.date,
          qty: pQty,
          delivered: pDelivered,
          pending: pPending,
          unitRate: Number(it.rate) || 0,
          value: pValue,
        });
      });
    });
  });

  // Top products by total qty, others grouped
  const sortedProducts = Array.from(productTotals.values()).sort((a, b) => b.totalQty - a.totalQty);
  const topProducts = sortedProducts.slice(0, PALETTE.length);
  const otherProducts = sortedProducts.slice(PALETTE.length);
  const productColor: Record<string, string> = {};
  topProducts.forEach((p, idx) => { productColor[p.name] = PALETTE[idx]; });
  otherProducts.forEach(p => { productColor[p.name] = OTHER_COLOR; });

  // Precompute stacks per month
  interface Stack { name: string; qty: number; color: string }
  const monthStacks: Record<string, Stack[]> = {};
  rows.forEach(r => {
    const stacks: Stack[] = [];
    topProducts.forEach(p => {
      const q = p.monthQty[r.key] || 0;
      if (q > 0.001) stacks.push({ name: p.name, qty: q, color: productColor[p.name] });
    });
    const otherQty = otherProducts.reduce((a, p) => a + (p.monthQty[r.key] || 0), 0);
    if (otherQty > 0.001) stacks.push({ name: "Other", qty: otherQty, color: OTHER_COLOR });
    monthStacks[r.key] = stacks;
  });

  const totalQty = rows.reduce((a, r) => a + r.qty, 0);
  const totalValue = rows.reduce((a, r) => a + r.value, 0);
  const totalPending = rows.reduce((a, r) => a + r.pending, 0);
  const selected = selectedMonth ? rows.find(r => r.key === selectedMonth) : null;
  const maxMonthQty = Math.max(...rows.map(r => r.qty), 1);

  return (
    <Card data-testid="dashboard-sales-forecast">
      <CardHeader
        title="Sales Forecast"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={fyStartYear}
              onChange={e => setFyStartYear(Number(e.target.value))}
              className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-md px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              data-testid="forecast-fy-select"
              title="Select Financial Year"
            >
              {fyOptions.map(y => (
                <option key={y} value={y}>{fyLabel(y)}</option>
              ))}
            </select>
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-md p-0.5" data-testid="forecast-period-toggle">
              {[3, 6, 9, 12].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPeriodMonths(n as 3 | 6 | 9 | 12)}
                  className={"px-2.5 py-0.5 text-[11px] rounded transition " + (periodMonths === n ? "bg-white dark:bg-slate-900 text-indigo-600 shadow font-semibold" : "text-slate-600 dark:text-slate-300 hover:text-slate-900")}
                  data-testid={`forecast-period-${n}m`}
                  title={n === 12 ? "Full Financial Year" : `${n} months`}
                >{n}M</button>
              ))}
            </div>
            <Badge color="indigo">{fmt2(totalQty)} Nos</Badge>
            <Badge color="green">{fmtINR(totalValue)}</Badge>
            {totalPending > 0.5 && <Badge color="amber">{fmt2(totalPending)} pending</Badge>}
          </div>
        }
      />
      <div className="p-4 grid lg:grid-cols-[1fr_1.1fr] gap-4">
        <div>
          <div className="text-xs text-slate-500 mb-2">Scheduled qty per month · {fyLabel(fyStartYear)} · {periodMonths}-month view · click a bar to see the product-wise breakdown</div>
          {totalQty === 0 ? (
            <Empty title={`No delivery schedules found in the selected ${periodMonths}-month window`} />
          ) : (
            <div className="grid items-end gap-3 h-56 px-1" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
              {rows.map(r => {
                const active = selectedMonth === r.key;
                const barPct = r.qty > 0 ? Math.max(4, (r.qty / maxMonthQty) * 100) : 3;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => r.qty > 0 && setSelectedMonth(r.key)}
                    data-testid={`forecast-bar-${r.key}`}
                    className="flex flex-col items-center gap-1 group focus:outline-none h-full justify-end"
                    disabled={r.qty === 0}
                    title={r.qty > 0 ? `${r.label}: ${fmt2(r.qty)} Nos · click for product breakdown` : ""}
                  >
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 h-4">{r.qty > 0 ? fmt2(r.qty) : ""}</div>
                    <div
                      className={
                        "w-full rounded-t-md transition-all " +
                        (r.qty === 0
                          ? "bg-slate-200 dark:bg-slate-700 opacity-60"
                          : active
                            ? "bg-indigo-600 shadow-lg ring-2 ring-indigo-500"
                            : "bg-indigo-500 hover:bg-indigo-600 cursor-pointer")
                      }
                      style={{ height: `${barPct}%` }}
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
                    <Td className="text-right font-semibold">{fmt2(r.qty)}</Td>
                    <Td className="text-right">{fmtINR(r.value)}</Td>
                    <Td className="text-right">
                      {r.pending > 0.5 ? <Badge color="amber">{fmt2(r.pending)}</Badge> : <span className="text-slate-400">—</span>}
                    </Td>
                    <Td className="text-right">
                      {r.qty > 0 && <button type="button" className="text-xs text-indigo-600 hover:underline">View</button>}
                    </Td>
                  </tr>
                ))}
                <tr className="bg-slate-100 dark:bg-slate-800/60 font-semibold">
                  <Td>{periodMonths}-Month Total</Td>
                  <Td className="text-right">{fmt2(totalQty)}</Td>
                  <Td className="text-right">{fmtINR(totalValue)}</Td>
                  <Td className="text-right">{fmt2(totalPending)}</Td>
                  <Td></Td>
                </tr>
              </tbody>
            </Table>
          </div>
          <div className="text-[11px] text-slate-500 mt-2">
            Auto-computed from every Sales Order's Delivery Schedule. Click a month in the chart or a row here for the product-wise breakdown.
          </div>
        </div>
      </div>

      <Modal open={!!selected} onClose={() => { setSelectedMonth(null); setProductFilter(new Set()); }} title={selected ? `Forecast · ${selected.label}` : "Forecast"} size="xl">
        {selected && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-xs text-slate-500">Scheduled Qty</div>
                <div className="text-xl font-bold">{fmt2(selected.qty)} Nos</div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-xs text-slate-500">Sales Amount</div>
                <div className="text-xl font-bold">{fmtINR(selected.value)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-xs text-slate-500">Delivered / Pending</div>
                <div className="text-xl font-bold">
                  <span className="text-emerald-600">{fmt2(selected.delivered)}</span>
                  <span className="text-slate-400"> / </span>
                  <span className="text-amber-600">{fmt2(selected.pending)}</span>
                </div>
              </div>
            </div>

            {/* Product Mix — donut chart + filterable legend */}
            {(() => {
              const monthProducts = Object.entries(
                contributions[selected.key].reduce<Record<string, { qty: number; value: number }>>((acc, c) => {
                  const cur = acc[c.productName] || { qty: 0, value: 0 };
                  cur.qty += c.qty; cur.value += c.value;
                  acc[c.productName] = cur;
                  return acc;
                }, {})
              ).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty);

              const total = monthProducts.reduce((a, p) => a + p.qty, 0);
              if (total === 0) return null;

              const R = 62, r = 34, C = 80;
              let cursor = 0;
              const arcs = monthProducts.map(p => {
                const frac = p.qty / total;
                const startAngle = cursor * 2 * Math.PI - Math.PI / 2;
                cursor += frac;
                const endAngle = cursor * 2 * Math.PI - Math.PI / 2;
                const largeArc = frac > 0.5 ? 1 : 0;
                const x1 = C + R * Math.cos(startAngle), y1 = C + R * Math.sin(startAngle);
                const x2 = C + R * Math.cos(endAngle), y2 = C + R * Math.sin(endAngle);
                const x3 = C + r * Math.cos(endAngle), y3 = C + r * Math.sin(endAngle);
                const x4 = C + r * Math.cos(startAngle), y4 = C + r * Math.sin(startAngle);
                const d = `M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${r} ${r} 0 ${largeArc} 0 ${x4} ${y4} Z`;
                return { name: p.name, qty: p.qty, value: p.value, pct: frac * 100, d, color: productColor[p.name] || OTHER_COLOR };
              });

              return (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4" data-testid="forecast-product-mix">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-3">Products This Month · Product Mix</div>
                  <div className="grid md:grid-cols-[160px_1fr] gap-4 items-center">
                    <div className="relative">
                      <svg viewBox="0 0 160 160" width="100%" style={{ maxWidth: 160 }}>
                        {arcs.map((a, i) => {
                          const active = productFilter.has(a.name);
                          const dim = productFilter.size > 0 && !active;
                          return (
                            <path
                              key={a.name + i}
                              d={a.d}
                              fill={a.color}
                              opacity={dim ? 0.25 : 1}
                              style={{ cursor: "pointer", transition: "opacity 120ms, transform 120ms", transformOrigin: "80px 80px" }}
                              transform={active ? "scale(1.04)" : undefined}
                              onClick={(e) => {
                                setProductFilter(prev => {
                                  const next = new Set(prev);
                                  const isMulti = e.ctrlKey || e.metaKey || e.shiftKey;
                                  if (isMulti) {
                                    if (next.has(a.name)) next.delete(a.name); else next.add(a.name);
                                    return next;
                                  }
                                  if (next.size === 1 && next.has(a.name)) return new Set();
                                  return new Set([a.name]);
                                });
                              }}
                              data-testid={`mix-slice-${i}`}
                            >
                              <title>{`${a.name} · ${fmt2(a.qty)} Nos · ${a.pct.toFixed(1)}% · ${fmtINR(a.value)} (Ctrl-click to multi-select)`}</title>
                            </path>
                          );
                        })}
                        <text x="80" y="76" textAnchor="middle" fontSize="10" fill="currentColor" className="fill-slate-500">Total</text>
                        <text x="80" y="94" textAnchor="middle" fontSize="18" fontWeight="700" fill="currentColor" className="fill-slate-800 dark:fill-slate-100">{fmt2(total)}</text>
                      </svg>
                    </div>
                    <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                      {arcs.map((a, i) => {
                        const active = productFilter.has(a.name);
                        return (
                          <button
                            type="button"
                            key={a.name + "-legend-" + i}
                            onClick={(e) => {
                              setProductFilter(prev => {
                                const next = new Set(prev);
                                const isMulti = e.ctrlKey || e.metaKey || e.shiftKey;
                                if (isMulti) {
                                  if (next.has(a.name)) next.delete(a.name); else next.add(a.name);
                                  return next;
                                }
                                if (next.size === 1 && next.has(a.name)) return new Set();
                                return new Set([a.name]);
                              });
                            }}
                            className={"w-full flex items-center gap-2 text-left rounded px-2 py-1 text-xs transition " + (active ? "bg-indigo-50 dark:bg-indigo-900/30 ring-1 ring-indigo-200 dark:ring-indigo-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/50")}
                            data-testid={`mix-legend-${i}`}
                            title="Click to filter · Ctrl-click for multi-select"
                          >
                            <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: a.color }} />
                            <span className="font-medium text-slate-700 dark:text-slate-200 truncate flex-1" title={a.name}>{a.name}</span>
                            <span className="text-slate-500 shrink-0">{fmt2(a.qty)} Nos</span>
                            <span className="text-slate-400 shrink-0 w-12 text-right">{a.pct.toFixed(1)}%</span>
                            <span className="text-slate-500 shrink-0 w-24 text-right">{fmtINR(a.value)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {productFilter.size > 0 && (
                    <div className="mt-3 flex items-center justify-between text-xs bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded px-3 py-1.5">
                      <span>
                        Filtered by <b>{Array.from(productFilter).join(", ")}</b>
                        {productFilter.size > 1 ? ` — ${productFilter.size} products selected` : " — showing only that product's sales orders"}
                        <span className="text-slate-400 ml-2">· Ctrl-click to add / remove</span>
                      </span>
                      <button type="button" onClick={() => setProductFilter(new Set())} className="text-indigo-600 hover:underline" data-testid="mix-clear-filter">Clear filter</button>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 max-h-[52vh] overflow-y-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>SO #</Th><Th>Customer</Th><Th>Product</Th><Th>Delivery Date</Th>
                    <Th className="text-right">Sched. Qty</Th><Th className="text-right">Delivered</Th><Th className="text-right">Pending</Th><Th className="text-right">Sales Value</Th>
                  </tr>
                </thead>
                <tbody>
                  {contributions[selected.key]
                    .slice()
                    .filter(c => productFilter.size === 0 || productFilter.has(c.productName))
                    .sort((a, b) => a.date.localeCompare(b.date) || a.so.number.localeCompare(b.so.number))
                    .map((c, i) => {
                      const cust = db.parties.find((p: any) => p.id === c.so.customerId);
                      const color = productColor[c.productName] || OTHER_COLOR;
                      return (
                        <tr key={c.so.id + "-" + c.productName + "-" + i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <Td className="font-mono text-xs">{c.so.number}</Td>
                          <Td>{cust?.name || "Unknown"}</Td>
                          <Td>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
                              <span className="truncate max-w-[220px]" title={c.productName}>{c.productName}</span>
                            </span>
                          </Td>
                          <Td>{c.date}</Td>
                          <Td className="text-right font-semibold">{fmt2(c.qty)}</Td>
                          <Td className="text-right text-emerald-600">{fmt2(c.delivered)}</Td>
                          <Td className="text-right">{c.pending > 0.5 ? <span className="text-amber-600 font-semibold">{fmt2(c.pending)}</span> : "—"}</Td>
                          <Td className="text-right">{fmtINR(c.value)}</Td>
                        </tr>
                      );
                    })}
                </tbody>
              </Table>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => { setSelectedMonth(null); setProductFilter(new Set()); }}>Close</Button>
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

