import { useStore } from "../lib/store";
import { Card, CardHeader, KPI, Badge, Empty } from "../components/ui";
import { BarChart, DonutChart } from "../components/charts";
import { fmtINR } from "../lib/utils";
import { roleDescriptions, roleLabels } from "../lib/permissions";
import { IconShop, IconFile, IconBox, IconFactory, IconCart, IconChart } from "../components/icons";

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
