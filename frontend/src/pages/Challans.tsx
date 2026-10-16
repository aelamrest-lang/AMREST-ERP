import { useMemo, useState, type ReactNode } from "react";
import { useStore } from "../lib/store";
import { Card, Button, Input, Table, Th, Td, Badge, Empty, Modal } from "../components/ui";
import type { DeliveryChallan, DispatchRecord } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint, IconTruck, IconSearch } from "../components/icons";
import { calcDocTotalsWithFreight, fmtINR, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";
import { dispatchedOfLine, dispatchedQty, invoicedQty, jcDispatched, jobCardReadyQty, lineValue } from "../lib/invoice";
import { printDispatchNote, printInvoice } from "../lib/invoicePrint";
import { InvoiceForm, type InvoicePreset } from "../components/invoice/InvoiceForm";
import { DispatchModal } from "../components/invoice/DispatchModal";

type Period = "all" | "month" | "lastmonth" | "3m" | "6m" | "custom";
type CardKey = "sales" | "ready" | "dispatched" | "pending";

function usePeriodRange(p: Period, from: string, to: string) {
  return useMemo(() => {
    const today = todayISO();
    if (p === "all") return { from: "0000-01-01", to: "9999-12-31" };
    if (p === "custom") return { from: from || "0000-01-01", to: to || "9999-12-31" };
    const now = new Date();
    if (p === "month") return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, to: today };
    if (p === "lastmonth") {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1), e = new Date(now.getFullYear(), now.getMonth(), 0);
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { from: iso(s), to: iso(e) };
    }
    const d = new Date(); d.setMonth(d.getMonth() - (p === "3m" ? 3 : 6));
    return { from: d.toISOString().slice(0, 10), to: today };
  }, [p, from, to]);
}

const invTotal = (c: DeliveryChallan) => calcDocTotalsWithFreight(c.items || [], Number(c.freight) || 0).total;

export function Challans() {
  const { db, setDB, log, currentUser } = useStore();
  const canCreate = userCan(currentUser, "challans", "create");
  const canEdit = userCan(currentUser, "challans", "edit");
  const canDelete = userCan(currentUser, "challans", "delete");
  const canPrint = userCan(currentUser, "challans", "print");
  const [period, setPeriod] = useState<Period>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [card, setCard] = useState<CardKey>("sales");
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [edit, setEdit] = useState<DeliveryChallan | null>(null);
  const [preset, setPreset] = useState<InvoicePreset | null>(null);
  const [dispatchInv, setDispatchInv] = useState<DeliveryChallan | null>(null);
  const [view, setView] = useState<DeliveryChallan | null>(null);
  const range = usePeriodRange(period, from, to);
  const inRange = (d: string) => !!d && d >= range.from && d <= range.to;
  const party = (id: string) => db.parties.find(p => p.id === id)?.name || "—";
  const ql = q.trim().toLowerCase();
  const match = (c: DeliveryChallan) => !ql || c.number.toLowerCase().includes(ql) || party(c.customerId).toLowerCase().includes(ql);

  const data = useMemo(() => {
    const invoices = db.challans.filter(c => inRange(c.date));
    const fgSale = (name: string) => {
      const it = db.items.find(i => i.name === name);
      return Number(((db.settings as any).manufacturingCosts || {})[it?.id || ""]?.salePrice) || it?.saleRate || 0;
    };
    const ready = db.jobCards.filter(j => inRange(j.date)).map(jc => {
      const so = db.salesOrders.find(s => s.id === jc.salesOrderId);
      const soi = so?.items.find(i => i.name === jc.product);
      const readyQty = jobCardReadyQty(jc, db.productionEntries);
      const disp = jcDispatched(db.challans, jc.id);
      const remaining = Math.max(0, readyQty - disp);
      const rate = soi?.rate || fgSale(jc.product);
      return { jc, so, readyQty, disp, remaining, rate, value: lineValue(remaining, rate, soi?.gst ?? 18) };
    }).filter(r => r.remaining > 0);
    const dispatches = db.challans.flatMap(c => (c.dispatches || []).filter(d => inRange(d.date)).map(d => {
      const qty = d.lines.reduce((s, l) => s + l.qty, 0);
      const amount = d.lines.reduce((s, l) => { const it = (c.items || []).find(i => i.name === l.name); return s + lineValue(l.qty, it?.rate || 0, it?.gst || 0); }, 0);
      return { c, d, qty, amount };
    })).sort((a, b) => b.d.date.localeCompare(a.d.date));
    const pending = invoices.map(c => {
      const bal = (c.items || []).map(i => ({ i, bal: Math.max(0, i.qty - dispatchedOfLine(c, i.name)) }));
      return { c, qty: bal.reduce((s, x) => s + x.bal, 0), amount: bal.reduce((s, x) => s + lineValue(x.bal, x.i.rate, x.i.gst), 0) };
    }).filter(r => r.qty > 0);
    return {
      invoices, ready, dispatches, pending,
      cards: {
        sales: { qty: invoices.reduce((s, c) => s + invoicedQty(c), 0), amount: invoices.reduce((s, c) => s + invTotal(c), 0), count: invoices.length },
        ready: { qty: ready.reduce((s, r) => s + r.remaining, 0), amount: ready.reduce((s, r) => s + r.value, 0), count: ready.length },
        dispatched: { qty: dispatches.reduce((s, r) => s + r.qty, 0), amount: dispatches.reduce((s, r) => s + r.amount, 0), count: dispatches.length },
        pending: { qty: pending.reduce((s, r) => s + r.qty, 0), amount: pending.reduce((s, r) => s + r.amount, 0), count: pending.length },
      },
    };
  }, [db.challans, db.jobCards, db.salesOrders, db.productionEntries, db.items, db.settings, range]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = (p?: InvoicePreset) => { setEdit(null); setPreset(p || null); setFormOpen(true); };
  const openEdit = (c: DeliveryChallan) => { setEdit(c); setPreset(null); setFormOpen(true); };

  const restoreStock = (items: DB_Items, lines: DispatchRecord["lines"]) => {
    const add = new Map<string, number>();
    lines.forEach(l => { if (l.itemId && l.deducted) add.set(l.itemId, (add.get(l.itemId) || 0) + l.deducted); });
    return items.map(it => add.has(it.id) ? { ...it, currentStock: (it.currentStock || 0) + (add.get(it.id) || 0) } : it);
  };

  const removeInvoice = (c: DeliveryChallan) => {
    const disp = dispatchedQty(c);
    if (!confirm(`Delete Sales Invoice ${c.number}?${disp ? ` ${disp} dispatched unit(s) will be reversed and stock restored.` : ""}`)) return;
    setDB(d => ({ ...d, challans: d.challans.filter(x => x.id !== c.id), items: restoreStock(d.items, (c.dispatches || []).flatMap(x => x.lines)) }));
    log(`Deleted Sales Invoice ${c.number}${disp ? " (dispatch reversed, stock restored)" : ""}`, "Sales Invoice");
  };

  const removeDispatch = (c: DeliveryChallan, rec: DispatchRecord) => {
    if (!confirm(`Delete dispatch ${rec.number}? Deducted stock will be restored; the invoice stays.`)) return;
    setDB(d => ({ ...d, challans: d.challans.map(x => x.id === c.id ? { ...x, dispatches: (x.dispatches || []).filter(r => r.id !== rec.id) } : x), items: restoreStock(d.items, rec.lines) }));
    log(`Deleted dispatch ${rec.number} of Sales Invoice ${c.number} (stock restored)`, "Sales Invoice");
  };

  const status = (c: DeliveryChallan) => {
    const inv = invoicedQty(c), disp = dispatchedQty(c);
    if (disp >= inv && inv > 0) return <Badge color="green">Dispatched</Badge>;
    if (disp > 0) return <Badge color="blue">Partial {disp}/{inv}</Badge>;
    return <Badge color="yellow">Not Dispatched</Badge>;
  };

  const actions = (c: DeliveryChallan) => (
    <div className="flex gap-1">
      {(canCreate || canEdit) && dispatchedQty(c) < invoicedQty(c) && <Button size="sm" variant="outline" onClick={() => setDispatchInv(c)} data-testid={`inv-dispatch-${c.number}`}><IconTruck size={14}/> Dispatch</Button>}
      {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(c)} data-testid={`inv-edit-${c.number}`}><IconEdit size={14}/></Button>}
      {canPrint && <Button size="sm" variant="ghost" onClick={() => printInvoice(db, c)} data-testid={`inv-print-${c.number}`}><IconPrint size={14}/></Button>}
      {canDelete && <Button size="sm" variant="ghost" onClick={() => removeInvoice(c)} data-testid={`inv-delete-${c.number}`}><IconTrash size={14}/></Button>}
    </div>
  );
  const invLink = (c: DeliveryChallan) => <button type="button" className="font-mono text-xs text-indigo-600 hover:underline" onClick={() => setView(c)} data-testid={`inv-view-${c.number}`}>{c.number}</button>;

  const CARDS: { key: CardKey; label: string; color: string }[] = [
    { key: "sales", label: "Total Sales", color: "text-indigo-600" },
    { key: "ready", label: "Ready for Dispatch", color: "text-teal-600" },
    { key: "dispatched", label: "Total Dispatched", color: "text-emerald-600" },
    { key: "pending", label: "Pending Dispatch", color: "text-amber-600" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold" data-testid="sales-invoice-title">Sales Invoice</h1><p className="text-sm text-slate-500">Invoice against Sales Orders or direct stock · physical dispatch tracked separately · stock moves only on dispatch</p></div>
        {canCreate && <Button onClick={() => openNew()} data-testid="new-invoice-btn"><IconPlus size={14}/> New Sales Invoice</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="inv-period-filter">
        {([["all", "All Time"], ["month", "This Month"], ["lastmonth", "Last Month"], ["3m", "Last 3 Months"], ["6m", "Last 6 Months"], ["custom", "Custom Date"]] as const).map(([k, lbl]) => (
          <button key={k} type="button" onClick={() => setPeriod(k)}
            className={"text-xs px-3 py-1.5 rounded-full border font-medium " + (period === k ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 hover:border-indigo-400")}
            data-testid={`inv-period-${k}`}>{lbl}</button>
        ))}
        {period === "custom" && <>
          <Input type="date" className="!w-40" value={from} onChange={(e: any) => setFrom(e.target.value)} data-testid="inv-period-from"/>
          <span className="text-xs text-slate-400">to</span>
          <Input type="date" className="!w-40" value={to} onChange={(e: any) => setTo(e.target.value)} data-testid="inv-period-to"/>
        </>}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {CARDS.map(c => {
          const d = data.cards[c.key];
          return (
            <button key={c.key} type="button" onClick={() => setCard(c.key)}
              className={"text-left rounded-xl border p-4 transition-colors " + (card === c.key ? "border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900 bg-indigo-50 dark:bg-indigo-900/20" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-indigo-300")}
              data-testid={`inv-card-${c.key}`}>
              <div className="text-[10px] uppercase font-semibold text-slate-500">{c.label}</div>
              <div className="text-2xl font-bold mt-1" data-testid={`inv-card-${c.key}-qty`}>{d.qty} <span className="text-xs font-medium text-slate-400">qty</span></div>
              <div className="text-xs mt-1"><span className="text-slate-400">Amount:</span> <b className={c.color} data-testid={`inv-card-${c.key}-amount`}>{fmtINR(d.amount)}</b></div>
              <div className="text-[10px] text-slate-400 mt-0.5">{d.count} {c.key === "ready" ? "job card(s)" : c.key === "dispatched" ? "dispatch(es)" : "invoice(s)"}</div>
            </button>
          );
        })}
      </div>
      <div className="text-[10px] text-slate-400 -mt-2">Amounts GST-inclusive · Ready for Dispatch = finished qty (Dispatch Ready) not yet dispatched, valued at SO / sale price · click a card for its list</div>

      <Card>
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
          <div className="font-semibold text-sm" data-testid="inv-list-title">{CARDS.find(c => c.key === card)!.label}</div>
          {card !== "ready" && <div className="relative max-w-sm w-full">
            <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
            <Input value={q} onChange={(e: any) => setQ(e.target.value)} placeholder="Search invoice no. or customer..." className="pl-9" data-testid="inv-search"/>
          </div>}
        </div>

        {card === "sales" && <Table>
          <thead><tr><Th>Invoice</Th><Th>Date</Th><Th>SO</Th><Th>Job Card</Th><Th>Customer</Th><Th className="text-right">Qty</Th><Th>Dispatch</Th><Th className="text-right">Total</Th><Th></Th></tr></thead>
          <tbody>{data.invoices.filter(match).map(c => (
            <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50" data-testid={`inv-row-${c.number}`}>
              <Td>{invLink(c)}{c.dispatchType && <div className="mt-0.5"><Badge color="blue">{c.dispatchType}</Badge></div>}</Td>
              <Td>{c.date}</Td>
              <Td>{db.salesOrders.find(s => s.id === c.salesOrderId)?.number || "—"}</Td>
              <Td>{db.jobCards.find(j => j.id === c.jobCardId)?.number || "—"}</Td>
              <Td>{party(c.customerId)}</Td>
              <Td className="text-right">{invoicedQty(c)}</Td>
              <Td>{status(c)}</Td>
              <Td className="text-right font-semibold">{fmtINR(invTotal(c))}</Td>
              <Td>{actions(c)}</Td>
            </tr>
          ))}</tbody>
        </Table>}

        {card === "ready" && <Table>
          <thead><tr><Th>Job Card</Th><Th>Product</Th><Th>SO</Th><Th>Customer</Th><Th className="text-right">JC Qty</Th><Th className="text-right">Ready</Th><Th className="text-right">Dispatched</Th><Th className="text-right">Ready Balance</Th><Th className="text-right">Est. Value</Th><Th></Th></tr></thead>
          <tbody>{data.ready.map(r => (
            <tr key={r.jc.id} data-testid={`inv-ready-${r.jc.number}`}>
              <Td className="font-mono text-xs">{r.jc.number}</Td>
              <Td>{r.jc.product}</Td>
              <Td>{r.so?.number || "—"}</Td>
              <Td>{party(r.so?.customerId || r.jc.customerId || "")}</Td>
              <Td className="text-right">{r.jc.qty}</Td>
              <Td className="text-right">{r.readyQty}</Td>
              <Td className="text-right">{r.disp}</Td>
              <Td className="text-right font-semibold text-teal-700">{r.remaining}</Td>
              <Td className="text-right">{fmtINR(r.value)}</Td>
              <Td>{canCreate && r.so && <Button size="sm" variant="outline" onClick={() => openNew({ salesOrderId: r.so!.id, jobCardId: r.jc.id, product: r.jc.product, qty: r.remaining })} data-testid={`inv-ready-create-${r.jc.number}`}><IconPlus size={12}/> Invoice</Button>}</Td>
            </tr>
          ))}</tbody>
        </Table>}

        {card === "dispatched" && <Table>
          <thead><tr><Th>Dispatch No.</Th><Th>Date</Th><Th>Invoice</Th><Th>Customer</Th><Th>Items</Th><Th className="text-right">Qty</Th><Th className="text-right">Amount</Th><Th>Vehicle</Th><Th>Ack</Th><Th></Th></tr></thead>
          <tbody>{data.dispatches.filter(r => match(r.c)).map(({ c, d, qty, amount }) => (
            <tr key={d.id} data-testid={`inv-dispatch-row-${d.number}`}>
              <Td className="font-mono text-xs">{d.number}{d.legacy && <div className="text-[10px] text-slate-400">legacy challan</div>}</Td>
              <Td>{d.date}</Td>
              <Td>{invLink(c)}</Td>
              <Td>{party(c.customerId)}</Td>
              <Td className="text-xs">{d.lines.map(l => l.name).join(", ")}</Td>
              <Td className="text-right">{qty}</Td>
              <Td className="text-right font-semibold">{fmtINR(amount)}</Td>
              <Td>{d.vehicle || "—"}</Td>
              <Td><Badge color={d.acknowledged ? "green" : "yellow"}>{d.acknowledged ? "Yes" : "Pending"}</Badge></Td>
              <Td><div className="flex gap-1">
                {canPrint && <Button size="sm" variant="ghost" onClick={() => printDispatchNote(db, c, d)} data-testid={`dsp-print-${d.number}`}><IconPrint size={14}/></Button>}
                {canDelete && <Button size="sm" variant="ghost" onClick={() => removeDispatch(c, d)} data-testid={`dsp-delete-${d.number}`}><IconTrash size={14}/></Button>}
              </div></Td>
            </tr>
          ))}</tbody>
        </Table>}

        {card === "pending" && <Table>
          <thead><tr><Th>Invoice</Th><Th>Date</Th><Th>Customer</Th><Th>Items</Th><Th className="text-right">Invoiced</Th><Th className="text-right">Dispatched</Th><Th className="text-right">Balance</Th><Th className="text-right">Balance Amt</Th><Th></Th></tr></thead>
          <tbody>{data.pending.filter(r => match(r.c)).map(({ c, qty, amount }) => (
            <tr key={c.id} data-testid={`inv-pending-${c.number}`}>
              <Td>{invLink(c)}</Td>
              <Td>{c.date}</Td>
              <Td>{party(c.customerId)}</Td>
              <Td className="text-xs">{(c.items || []).map(i => i.name).join(", ")}</Td>
              <Td className="text-right">{invoicedQty(c)}</Td>
              <Td className="text-right">{dispatchedQty(c)}</Td>
              <Td className="text-right font-semibold text-amber-600">{qty}</Td>
              <Td className="text-right">{fmtINR(amount)}</Td>
              <Td>{(canCreate || canEdit) && <Button size="sm" variant="outline" onClick={() => setDispatchInv(c)} data-testid={`inv-pending-dispatch-${c.number}`}><IconTruck size={14}/> Dispatch</Button>}</Td>
            </tr>
          ))}</tbody>
        </Table>}

        {((card === "sales" && !data.invoices.length) || (card === "ready" && !data.ready.length) || (card === "dispatched" && !data.dispatches.length) || (card === "pending" && !data.pending.length)) && <Empty/>}
      </Card>

      <InvoiceForm open={formOpen} onClose={() => setFormOpen(false)} edit={edit} preset={preset}/>
      <DispatchModal invoice={dispatchInv} onClose={() => setDispatchInv(null)}/>
      <InvoiceView c={view && db.challans.find(x => x.id === view.id) || null} onClose={() => setView(null)} actions={actions}/>
    </div>
  );
}

type DB_Items = ReturnType<typeof useStore>["db"]["items"];

function InvoiceView({ c, onClose, actions }: { c: DeliveryChallan | null; onClose: () => void; actions: (c: DeliveryChallan) => ReactNode }) {
  const { db } = useStore();
  if (!c) return null;
  const t = calcDocTotalsWithFreight(c.items || [], Number(c.freight) || 0);
  const cust = db.parties.find(p => p.id === c.customerId);
  return (
    <Modal open={!!c} onClose={onClose} title={`Sales Invoice · ${c.number}`} size="xl">
      <div className="space-y-4 text-sm" data-testid="inv-view-modal">
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3"><div className="text-[11px] uppercase text-slate-500">Invoice</div><b className="font-mono">{c.number}</b><div>{c.date}</div></div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 sm:col-span-2"><div className="text-[11px] uppercase text-slate-500">Customer</div><b>{cust?.name || "—"}</b><div className="text-xs text-slate-500">{cust?.address}{cust?.city ? `, ${cust.city}` : ""} · GSTIN {cust?.gst || "-"}</div></div>
        </div>
        <Table>
          <thead><tr><Th>Item</Th><Th>HSN</Th><Th className="text-right">Qty</Th><Th className="text-right">Dispatched</Th><Th className="text-right">Rate</Th><Th className="text-right">GST%</Th><Th className="text-right">Amount</Th></tr></thead>
          <tbody>{(c.items || []).map((i, idx) => (
            <tr key={idx}><Td className="font-medium">{i.name}</Td><Td>{i.hsn || db.items.find(x => x.name === i.name)?.hsn || "—"}</Td><Td className="text-right">{i.qty}</Td><Td className="text-right">{dispatchedOfLine(c, i.name)}</Td><Td className="text-right">{fmtINR(i.rate)}</Td><Td className="text-right">{i.gst}%</Td><Td className="text-right">{fmtINR(i.qty * i.rate)}</Td></tr>
          ))}</tbody>
        </Table>
        <div className="flex justify-end"><div className="w-72 space-y-1 rounded-lg border p-3 dark:border-slate-700">
          <div className="flex justify-between"><span>Taxable</span><b>{fmtINR(t.sub)}</b></div>
          <div className="flex justify-between"><span>Freight</span><b>{fmtINR(t.freight)}</b></div>
          <div className="flex justify-between"><span>GST</span><b>{fmtINR(t.gst)}</b></div>
          <div className="flex justify-between border-t pt-1"><span>Total</span><b className="text-emerald-600">{fmtINR(t.total)}</b></div>
        </div></div>
        <div>
          <div className="font-semibold mb-2">Dispatch History ({(c.dispatches || []).length})</div>
          {(c.dispatches || []).length ? <Table>
            <thead><tr><Th>Dispatch No.</Th><Th>Date</Th><Th>Items</Th><Th>Vehicle</Th><Th>Driver</Th><Th>LR</Th><Th></Th></tr></thead>
            <tbody>{(c.dispatches || []).map(d => (
              <tr key={d.id}><Td className="font-mono text-xs">{d.number}</Td><Td>{d.date}</Td><Td className="text-xs">{d.lines.map(l => `${l.name} × ${l.qty}`).join(", ")}</Td><Td>{d.vehicle || "—"}</Td><Td>{d.driver || "—"}</Td><Td>{d.transport || "—"}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => printDispatchNote(db, c, d)}><IconPrint size={14}/></Button></Td></tr>
            ))}</tbody>
          </Table> : <div className="text-xs text-slate-500">Not dispatched yet.</div>}
        </div>
        <div className="flex justify-end border-t pt-3 dark:border-slate-700">{actions(c)}</div>
      </div>
    </Modal>
  );
}
