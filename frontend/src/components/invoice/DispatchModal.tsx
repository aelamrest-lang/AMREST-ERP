import { useEffect, useState } from "react";
import { useStore, uid } from "../../lib/store";
import { Button, Input, Label, Modal, Table, Th, Td } from "../ui";
import type { DeliveryChallan, DispatchRecord } from "../../lib/types";
import { fmt2, nextNumber, todayISO } from "../../lib/utils";
import { dispatchedOfLine, dispatchedQty } from "../../lib/invoice";

export function DispatchModal({ invoice, onClose }: { invoice: DeliveryChallan | null; onClose: () => void }) {
  const { db, setDB, log } = useStore();
  const [qty, setQty] = useState<number[]>([]);
  const [info, setInfo] = useState({ date: todayISO(), vehicle: "", driver: "", transport: "", acknowledged: false });

  useEffect(() => {
    if (!invoice) return;
    setQty((invoice.items || []).map(i => Math.max(0, i.qty - dispatchedOfLine(invoice, i.name))));
    setInfo({ date: todayISO(), vehicle: "", driver: "", transport: "", acknowledged: false });
  }, [invoice]);

  if (!invoice) return null;
  const items = invoice.items || [];
  const strict = !!invoice.dispatchType;
  const stockItem = (i: { itemId?: string; name: string }) => db.items.find(x => x.id === i.itemId) || db.items.find(x => x.name === i.name);

  const save = () => {
    const lines = items.map((i, idx) => ({ i, q: qty[idx] || 0, bal: Math.max(0, i.qty - dispatchedOfLine(invoice, i.name)) })).filter(x => x.q > 0);
    if (!lines.length) return alert("Enter a dispatch quantity greater than 0.");
    for (const { i, q, bal } of lines) {
      if (q > bal) return alert(`"${i.name}": only ${bal} unit(s) remain to dispatch on this invoice.`);
      const st = stockItem(i);
      if (strict && q > (st?.currentStock || 0)) return alert(`"${i.name}": only ${fmt2(st?.currentStock || 0)} ${st?.unit || ""} in stock.`);
    }
    const all = db.challans.flatMap(c => c.dispatches || []).filter(d => d.number.startsWith("DSP"));
    setDB(d => {
      const stock = new Map(d.items.map(it => [it.id, it.currentStock || 0]));
      const rec: DispatchRecord = {
        id: uid(), number: nextNumber("DSP", all), ...info, createdAt: new Date().toISOString(),
        lines: lines.map(({ i, q }) => {
          const st = stockItem(i);
          const avail = st ? stock.get(st.id) || 0 : 0;
          const deducted = st ? Math.min(q, avail) : 0;
          if (st) stock.set(st.id, avail - deducted);
          return { itemId: st?.id || i.itemId, name: i.name, qty: q, deducted };
        }),
      };
      const challans = d.challans.map(c => c.id === invoice.id ? { ...c, dispatches: [...(c.dispatches || []), rec] } : c);
      const so = d.salesOrders.find(s => s.id === invoice.salesOrderId);
      const soDone = so && so.items.every(si => challans.filter(c => c.salesOrderId === so.id).reduce((s, c) => s + dispatchedOfLine(c, si.name), 0) >= si.qty);
      const jc = d.jobCards.find(j => j.id === invoice.jobCardId);
      const jcDone = jc && challans.filter(c => c.jobCardId === jc.id).reduce((s, c) => s + dispatchedQty(c), 0) >= jc.qty;
      return {
        ...d, challans,
        items: d.items.map(it => stock.get(it.id) !== (it.currentStock || 0) ? { ...it, currentStock: stock.get(it.id) || 0 } : it),
        salesOrders: soDone ? d.salesOrders.map(s => s.id === so!.id ? { ...s, status: "Delivered" as const } : s) : d.salesOrders,
        jobCards: jcDone ? d.jobCards.map(j => j.id === jc!.id ? { ...j, status: "Completed" as const } : j) : d.jobCards,
      };
    });
    log(`Dispatched goods against Sales Invoice ${invoice.number} · stock deducted`, "Sales Invoice");
    onClose();
  };

  return (
    <Modal open={!!invoice} onClose={onClose} title={`Dispatch Goods · ${invoice.number}`} size="xl">
      <div className="text-xs text-slate-500 mb-3">Physical dispatch is recorded separately from the invoice. Inventory is deducted only here — partial dispatch allowed.</div>
      <Table>
        <thead><tr><Th>Item</Th><Th className="text-right">Invoiced</Th><Th className="text-right">Dispatched</Th><Th className="text-right">Balance</Th><Th className="text-right">Stock</Th><Th className="text-right">Dispatch Now</Th></tr></thead>
        <tbody>
          {items.map((i, idx) => {
            const done = dispatchedOfLine(invoice, i.name);
            const bal = Math.max(0, i.qty - done);
            const st = stockItem(i);
            const over = (qty[idx] || 0) > bal || (strict && (qty[idx] || 0) > (st?.currentStock || 0));
            return (
              <tr key={idx} className={over ? "bg-rose-50 dark:bg-rose-900/20" : ""}>
                <Td className="font-medium">{i.name}</Td>
                <Td className="text-right">{i.qty}</Td>
                <Td className="text-right">{done}</Td>
                <Td className="text-right font-semibold">{bal}</Td>
                <Td className="text-right text-xs" data-testid={`dsp-stock-${idx}`}>{st ? `${fmt2(st.currentStock)} ${st.unit}` : "not in Item Master"}</Td>
                <Td className="text-right"><Input type="number" min={0} max={bal} value={qty[idx] ?? 0} disabled={bal === 0}
                  onChange={(e: any) => setQty(q => q.map((x, k) => k === idx ? Math.max(0, Number(e.target.value) || 0) : x))}
                  className={"w-24 text-right py-1 h-8 " + (over ? "border-rose-500" : "")} data-testid={`dsp-qty-${idx}`}/></Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {!strict && <div className="text-[11px] text-slate-500 mt-1">Finished-goods stock is deducted up to the quantity available in Item Master.</div>}
      <div className="grid sm:grid-cols-4 gap-3 mt-4">
        <div><Label>Dispatch Date</Label><Input type="date" value={info.date} onChange={(e: any) => setInfo({ ...info, date: e.target.value })} data-testid="dsp-date"/></div>
        <div><Label>Vehicle Number</Label><Input value={info.vehicle} onChange={(e: any) => setInfo({ ...info, vehicle: e.target.value })} data-testid="dsp-vehicle"/></div>
        <div><Label>Driver Name</Label><Input value={info.driver} onChange={(e: any) => setInfo({ ...info, driver: e.target.value })} data-testid="dsp-driver"/></div>
        <div><Label>Transport / LR</Label><Input value={info.transport} onChange={(e: any) => setInfo({ ...info, transport: e.target.value })} data-testid="dsp-transport"/></div>
      </div>
      <label className="flex items-center gap-2 text-sm mt-3"><input type="checkbox" checked={info.acknowledged} onChange={e => setInfo({ ...info, acknowledged: e.target.checked })} data-testid="dsp-ack"/> Customer acknowledgement received</label>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} data-testid="dsp-save-btn">Confirm Dispatch</Button>
      </div>
    </Modal>
  );
}
