import { useState, useMemo } from "react";
import { useStore } from "../lib/store";
import { Card, CardHeader, Button, Table, Th, Td, KPI, Empty } from "../components/ui";
import { BarChart, LineChart, DonutChart } from "../components/charts";
import { downloadCSV, fmtINR } from "../lib/utils";
import { IconDownload, IconChart, IconShop, IconCart, IconBox } from "../components/icons";
import { userCan } from "../lib/permissions";

export function Reports() {
  const { db, currentUser } = useStore();
  const isAdmin = currentUser?.role === "admin";
  const [tab, setTab] = useState<"sales" | "purchase" | "inventory" | "production" | "gst" | "outstanding" | "profit">("sales");

  const myFilter = <T extends { ownerId?: string }>(arr: T[]) => isAdmin ? arr : arr.filter(x => x.ownerId === currentUser?.id);
  const sos = myFilter(db.salesOrders);
  const qts = myFilter(db.quotations);

  const salesValue = sos.reduce((s, o) => s + o.items.reduce((a, b) => a + b.qty * b.rate, 0), 0);
  const salesGST = sos.reduce((s, o) => s + o.items.reduce((a, b) => a + b.qty * b.rate * b.gst / 100, 0), 0);
  const purchaseValue = db.purchaseOrders.reduce((s, p) => s + p.items.reduce((a, b) => a + b.qty * b.rate, 0), 0);
  const stockValue = db.items.reduce((s, i) => s + i.currentStock * i.purchaseRate, 0);
  const profit = salesValue - purchaseValue;

  const monthly = useMemo(() => {
    const arr: { label: string; value: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const total = sos
        .filter(o => { const od = new Date(o.date); return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth(); })
        .reduce((s, o) => s + o.items.reduce((a, b) => a + b.qty * b.rate, 0), 0);
      arr.push({ label: d.toLocaleString("en", { month: "short" }), value: Math.round(total / 1000) });
    }
    return arr;
  }, [sos]);

  const tabs = [
    { id: "sales", label: "Sales" },
    { id: "purchase", label: "Purchase" },
    { id: "inventory", label: "Inventory" },
    { id: "production", label: "Production" },
    { id: "gst", label: "GST" },
    { id: "outstanding", label: "Outstanding" },
    { id: "profit", label: "Profitability" },
  ];

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold">Reports & Analytics</h1><p className="text-sm text-slate-500">Business insights at a glance</p></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Sales Value" value={fmtINR(salesValue)} color="emerald" icon={<IconShop size={22}/>} />
        <KPI label="Purchase Value" value={fmtINR(purchaseValue)} color="indigo" icon={<IconCart size={22}/>} />
        <KPI label="Stock Value" value={fmtINR(stockValue)} color="amber" icon={<IconBox size={22}/>} />
        <KPI label="Estimated Profit" value={fmtINR(profit)} color="rose" icon={<IconChart size={22}/>} />
      </div>

      <Card>
        <div className="px-4 pt-3 flex flex-wrap gap-1 border-b border-slate-100 dark:border-slate-800">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)} className={`px-3 py-2 text-sm font-medium rounded-t-lg ${tab === t.id ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"}`}>{t.label}</button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {tab === "sales" && <SalesReport sos={sos} qts={qts} monthly={monthly} db={db} canExport={userCan(currentUser, "reports", "export")} />}
          {tab === "purchase" && <PurchaseReport db={db} />}
          {tab === "inventory" && <InventoryReport db={db} />}
          {tab === "production" && <ProductionReport db={db} />}
          {tab === "gst" && <GSTReport sos={sos} salesGST={salesGST} db={db} />}
          {tab === "outstanding" && <OutstandingReport sos={sos} db={db} />}
          {tab === "profit" && <ProfitReport sos={sos} db={db} />}
        </div>
      </Card>
    </div>
  );
}

function SalesReport({ sos, qts, monthly, db, canExport }: any) {
  const exportCSV = () => downloadCSV("sales-report.csv", [
    ["SO No.", "Date", "Customer", "Items", "Total"],
    ...sos.map((o: any) => [o.number, o.date, db.parties.find((p: any) => p.id === o.customerId)?.name, o.items.length, o.items.reduce((s: number, x: any) => s + x.qty * x.rate, 0)])
  ]);
  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        <Card><CardHeader title="Monthly Sales (₹K)"/><div className="p-4"><LineChart data={monthly} color="#10b981" /></div></Card>
        <Card><CardHeader title="Quotation Status"/><div className="p-4">
          <DonutChart data={["Inquiry", "Quotation Sent", "Negotiation", "Order Confirmed"].map((s, i) => ({
            label: s, value: qts.filter((q: any) => q.status === s).length, color: ["#94a3b8","#3b82f6","#f59e0b","#10b981"][i]
          }))} />
        </div></Card>
      </div>
      {canExport && <div className="flex justify-end"><Button variant="outline" onClick={exportCSV}><IconDownload size={14}/> Export</Button></div>}
      <Table>
        <thead><tr><Th>SO #</Th><Th>Date</Th><Th>Customer</Th><Th>Items</Th><Th>Total</Th></tr></thead>
        <tbody>
          {sos.map((o: any) => (
            <tr key={o.id}>
              <Td className="font-mono text-xs">{o.number}</Td>
              <Td>{o.date}</Td>
              <Td>{db.parties.find((p: any) => p.id === o.customerId)?.name}</Td>
              <Td>{o.items.length}</Td>
              <Td className="font-semibold">{fmtINR(o.items.reduce((s: number, i: any) => s + i.qty * i.rate, 0))}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {sos.length === 0 && <Empty/>}
    </div>
  );
}

function PurchaseReport({ db }: any) {
  return (
    <div className="space-y-3">
      <Table>
        <thead><tr><Th>PO #</Th><Th>Date</Th><Th>Vendor</Th><Th>Status</Th><Th>Total</Th></tr></thead>
        <tbody>
          {db.purchaseOrders.map((p: any) => (
            <tr key={p.id}>
              <Td className="font-mono text-xs">{p.number}</Td>
              <Td>{p.date}</Td>
              <Td>{db.parties.find((v: any) => v.id === p.vendorId)?.name}</Td>
              <Td>{p.status}</Td>
              <Td className="font-semibold">{fmtINR(p.items.reduce((s: number, i: any) => s + i.qty * i.rate, 0))}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function InventoryReport({ db }: any) {
  const data = ["Raw Material", "Semi-Finished", "Finished Goods"].map((c) => ({
    label: c, value: db.items.filter((it: any) => it.category === c).reduce((s: number, it: any) => s + it.currentStock * it.purchaseRate, 0),
  }));
  return (
    <div className="space-y-4">
      <BarChart data={data.map(d => ({ label: d.label, value: Math.round(d.value / 1000) }))} color="#6366f1"/>
      <Table>
        <thead><tr><Th>Item</Th><Th>Category</Th><Th>Stock</Th><Th>Value</Th></tr></thead>
        <tbody>{db.items.map((i: any) => (
          <tr key={i.id}><Td>{i.name}</Td><Td>{i.category}</Td><Td>{i.currentStock} {i.unit}</Td><Td className="font-semibold">{fmtINR(i.currentStock * i.purchaseRate)}</Td></tr>
        ))}</tbody>
      </Table>
    </div>
  );
}

function ProductionReport({ db }: any) {
  return (
    <Table>
      <thead><tr><Th>JC #</Th><Th>Date</Th><Th>Product</Th><Th>Qty</Th><Th>Status</Th><Th>Stages Done</Th></tr></thead>
      <tbody>{db.jobCards.map((j: any) => (
        <tr key={j.id}><Td className="font-mono text-xs">{j.number}</Td><Td>{j.date}</Td><Td>{j.product}</Td><Td>{j.qty}</Td><Td>{j.status}</Td><Td>{j.stages.filter((s: any) => s.status === "done").length}/{j.stages.length}</Td></tr>
      ))}</tbody>
    </Table>
  );
}

function GSTReport({ sos, salesGST, db }: any) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 p-4 text-sm">
        <div className="font-semibold text-emerald-700 dark:text-emerald-300">Total GST Collected (Sales): {fmtINR(salesGST)}</div>
      </div>
      <Table>
        <thead><tr><Th>Doc</Th><Th>Date</Th><Th>Customer GST</Th><Th>Taxable</Th><Th>GST Amount</Th></tr></thead>
        <tbody>{sos.map((o: any) => {
          const taxable = o.items.reduce((s: number, i: any) => s + i.qty * i.rate, 0);
          const gst = o.items.reduce((s: number, i: any) => s + i.qty * i.rate * i.gst / 100, 0);
          return <tr key={o.id}><Td className="font-mono text-xs">{o.number}</Td><Td>{o.date}</Td><Td className="text-xs">{db.parties.find((p: any) => p.id === o.customerId)?.gst}</Td><Td>{fmtINR(taxable)}</Td><Td className="font-semibold">{fmtINR(gst)}</Td></tr>;
        })}</tbody>
      </Table>
    </div>
  );
}

function OutstandingReport({ sos, db }: any) {
  return (
    <Table>
      <thead><tr><Th>Customer</Th><Th>Orders</Th><Th>Outstanding</Th></tr></thead>
      <tbody>
        {Array.from(new Set(sos.map((o: any) => o.customerId))).map((cid: any) => {
          const c = db.parties.find((p: any) => p.id === cid);
          const total = sos.filter((o: any) => o.customerId === cid).reduce((s: number, o: any) => s + o.items.reduce((a: number, i: any) => a + i.qty * i.rate * (1 + i.gst / 100), 0), 0);
          return <tr key={String(cid)}><Td className="font-medium">{c?.name}</Td><Td>{sos.filter((o: any) => o.customerId === cid).length}</Td><Td className="font-semibold text-rose-600">{fmtINR(total)}</Td></tr>;
        })}
      </tbody>
    </Table>
  );
}

function ProfitReport({ sos, db }: any) {
  const sales = sos.reduce((s: number, o: any) => s + o.items.reduce((a: number, i: any) => a + i.qty * i.rate, 0), 0);
  const cost = db.purchaseOrders.reduce((s: number, p: any) => s + p.items.reduce((a: number, i: any) => a + i.qty * i.rate, 0), 0);
  return (
    <div className="grid sm:grid-cols-3 gap-4">
      <div className="rounded-lg p-5 bg-emerald-50 dark:bg-emerald-900/30 text-center"><div className="text-xs uppercase text-emerald-600 font-semibold">Revenue</div><div className="text-2xl font-bold mt-1">{fmtINR(sales)}</div></div>
      <div className="rounded-lg p-5 bg-rose-50 dark:bg-rose-900/30 text-center"><div className="text-xs uppercase text-rose-600 font-semibold">Cost</div><div className="text-2xl font-bold mt-1">{fmtINR(cost)}</div></div>
      <div className="rounded-lg p-5 bg-indigo-50 dark:bg-indigo-900/30 text-center"><div className="text-xs uppercase text-indigo-600 font-semibold">Gross Profit</div><div className="text-2xl font-bold mt-1">{fmtINR(sales - cost)}</div></div>
    </div>
  );
}
