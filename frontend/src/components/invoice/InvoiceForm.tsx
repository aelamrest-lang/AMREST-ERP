import { useEffect, useMemo, useState } from "react";
import { useStore, uid } from "../../lib/store";
import { Button, Input, Select, Label, Modal, Table, Th, Td, Empty } from "../ui";
import type { DeliveryChallan } from "../../lib/types";
import { IconPlus, IconTrash } from "../icons";
import { calcDocTotalsWithFreight, fmtINR, fmt2, todayISO } from "../../lib/utils";
import { dispatchedOfLine, matchSoItem, nextSeqNumber } from "../../lib/invoice";

export interface InvoicePreset { salesOrderId: string; jobCardId: string; product: string; qty: number }
interface Line { itemId?: string; name: string; hsn: string; qty: number; rate: number; gst: number; ordered?: number; otherInvoiced?: number }

const DIRECT_CAT: Record<string, string> = { "Raw Material": "Raw Material", "Semi-Finished Goods": "Semi-Finished", "Finished Goods": "Finished Goods" };

export function InvoiceForm({ open, onClose, edit, preset }: { open: boolean; onClose: () => void; edit: DeliveryChallan | null; preset?: InvoicePreset | null }) {
  const { db, setDB, log } = useStore();
  const [mode, setMode] = useState<"so" | "direct">("so");
  const [form, setForm] = useState<DeliveryChallan>({} as DeliveryChallan);
  const [lines, setLines] = useState<Line[]>([]);
  const hasDispatch = !!edit && (edit.dispatches || []).some(d => d.lines.some(l => l.qty > 0));

  const fgSale = useMemo(() => {
    const mfg = ((db.settings as any).manufacturingCosts || {}) as Record<string, { salePrice?: number }>;
    const m = new Map<string, number>();
    Object.entries(mfg).forEach(([id, v]) => { const it = db.items.find(x => x.id === id); if (it && v.salePrice) m.set(it.name, Number(v.salePrice)); });
    return m;
  }, [db.items, db.settings]);

  const invoicedOnSO = (soId: string, name: string) => db.challans
    .filter(c => c.salesOrderId === soId && c.id !== edit?.id)
    .flatMap(c => c.items || []).filter(i => i.name === name).reduce((s, i) => s + (Number(i.qty) || 0), 0);

  const soLines = (soId: string, existing?: DeliveryChallan["items"], p?: InvoicePreset | null): Line[] => {
    const so = db.salesOrders.find(s => s.id === soId);
    if (!so) return [];
    const pName = p ? matchSoItem(so.items, p.product)?.name : undefined;
    const extra: Line[] = (existing || []).filter(x => !so.items.some(si => si.name === x.name)).map(x => ({ itemId: x.itemId, name: x.name, hsn: x.hsn || "", qty: x.qty, rate: x.rate, gst: x.gst }));
    return [...so.items.map(si => {
      const item = db.items.find(i => i.name === si.name);
      const other = invoicedOnSO(so.id, si.name);
      const bal = Math.max(0, si.qty - other);
      const ex = existing?.find(x => x.name === si.name);
      const qty = ex ? ex.qty : existing ? 0 : p ? (si.name === pName ? Math.min(p.qty, bal) : 0) : bal;
      return { itemId: ex?.itemId || item?.id, name: si.name, hsn: ex?.hsn ?? item?.hsn ?? "", qty, rate: ex?.rate ?? (si.rate || fgSale.get(si.name) || 0), gst: ex?.gst ?? si.gst, ordered: si.qty, otherInvoiced: other };
    }), ...extra];
  };

  useEffect(() => {
    if (!open) return;
    if (edit) {
      setForm({ ...edit });
      const direct = !!edit.dispatchType || !edit.salesOrderId;
      setMode(direct ? "direct" : "so");
      setLines(direct ? (edit.items || []).map(i => ({ itemId: i.itemId, name: i.name, hsn: i.hsn || db.items.find(x => x.id === i.itemId)?.hsn || "", qty: i.qty, rate: i.rate, gst: i.gst })) : soLines(edit.salesOrderId, edit.items));
      return;
    }
    const prefix = db.settings.invoicePrefix || "INV";
    const so = preset ? db.salesOrders.find(s => s.id === preset.salesOrderId) : undefined;
    setForm({
      id: "", number: nextSeqNumber(prefix, db.challans.map(c => c.number)), date: todayISO(),
      salesOrderId: so?.id || "", jobCardId: preset?.jobCardId || "", customerId: so?.customerId || "",
      items: [], freight: so?.freight || 0, acknowledged: false, dispatches: [], createdAt: new Date().toISOString(),
    });
    setMode("so");
    setLines(so ? soLines(so.id, undefined, preset) : []);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const applySO = (soId: string) => {
    const so = db.salesOrders.find(s => s.id === soId);
    setForm(f => ({ ...f, salesOrderId: soId, customerId: so?.customerId || "", freight: so?.freight || 0, jobCardId: "" }));
    setLines(soLines(soId));
  };

  const openSOs = db.salesOrders.filter(so => so.id === form.salesOrderId || so.items.some(si => si.qty - invoicedOnSO(so.id, si.name) > 0));
  const soJCs = db.jobCards.filter(j => mode === "direct" || j.salesOrderId === form.salesOrderId);
  const directItems = form.dispatchType ? db.items.filter(i => i.category === DIRECT_CAT[form.dispatchType!]) : [];
  const totals = calcDocTotalsWithFreight(lines.filter(l => l.qty > 0), Number(form.freight) || 0);
  const upd = (idx: number, patch: Partial<Line>) => setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l));

  const save = () => {
    if (!form.customerId) return alert(mode === "so" ? "Please select a Sales Order." : "Please select a Party.");
    if (mode === "direct" && !form.dispatchType) return alert("Please select a Supply Type.");
    const used = lines.filter(l => l.name && (l.qty > 0 || (edit && dispatchedOfLine(edit, l.name) > 0)));
    if (!used.some(l => l.qty > 0)) return alert("Enter an invoice quantity greater than 0 for at least one item.");
    for (const l of used) {
      const bal = l.ordered != null ? Math.max(0, l.ordered - (l.otherInvoiced || 0)) : Infinity;
      if (l.qty > bal) return alert(`"${l.name}": only ${bal} unit(s) remain to invoice on this Sales Order.`);
      const disp = edit ? dispatchedOfLine(edit, l.name) : 0;
      if (l.qty < disp) return alert(`"${l.name}": ${disp} unit(s) are already dispatched — invoice qty cannot be lower.`);
    }
    const items = used.map(l => ({ itemId: l.itemId, name: l.name, hsn: l.hsn, qty: l.qty, rate: l.rate, gst: l.gst }));
    const payload: DeliveryChallan = { ...form, items, salesOrderId: mode === "so" ? form.salesOrderId : "", dispatchType: mode === "direct" ? form.dispatchType : undefined, dispatches: edit?.dispatches || [] };
    setDB(d => ({ ...d, challans: edit ? d.challans.map(x => x.id === edit.id ? payload : x) : [{ ...payload, id: uid() }, ...d.challans] }));
    log(`${edit ? "Updated" : "Created"} Sales Invoice ${form.number} (no stock change — stock moves on dispatch)`, "Sales Invoice");
    onClose();
  };

  if (!open) return null;
  const tab = (k: "so" | "direct", lbl: string) => (
    <button type="button" disabled={!!edit} onClick={() => { setMode(k); setLines([]); setForm(f => ({ ...f, salesOrderId: "", customerId: "", jobCardId: "", dispatchType: undefined })); }}
      className={"px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed " + (mode === k ? "bg-indigo-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600")} data-testid={`inv-mode-${k}`}>{lbl}</button>
  );

  return (
    <Modal open={open} onClose={onClose} title={edit ? `Edit Sales Invoice ${edit.number}` : "New Sales Invoice"} size="xl">
      <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden w-fit mb-4">
        {tab("so", "Against Sales Order")}{tab("direct", "Direct (RM / SFG / FG Stock)")}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div><Label>Invoice No.</Label><Input value={form.number || ""} disabled data-testid="inv-number"/></div>
        <div><Label>Invoice Date</Label><Input type="date" value={form.date || ""} onChange={(e: any) => setForm({ ...form, date: e.target.value })} data-testid="inv-date"/></div>
        {mode === "so" ? (
          <div><Label>Sales Order *</Label>
            <Select value={form.salesOrderId || ""} disabled={hasDispatch} onChange={(e: any) => applySO(e.target.value)} data-testid="inv-so-select">
              <option value="">— Select Sales Order —</option>
              {openSOs.map(s => <option key={s.id} value={s.id}>{s.number} · {db.parties.find(p => p.id === s.customerId)?.name || ""}</option>)}
            </Select>
          </div>
        ) : (
          <div><Label>Supply Type *</Label>
            <Select value={form.dispatchType || ""} disabled={hasDispatch} onChange={(e: any) => { setForm({ ...form, dispatchType: e.target.value || undefined }); setLines([]); }} data-testid="inv-supply-type">
              <option value="">— Select Type —</option>
              <option value="Raw Material">Raw Material</option>
              <option value="Semi-Finished Goods">Semi-Finished Goods</option>
              <option value="Finished Goods">Finished Goods</option>
            </Select>
          </div>
        )}
        <div className="sm:col-span-2"><Label>{mode === "so" ? "Customer (auto from SO)" : "Party *"}</Label>
          <Select value={form.customerId || ""} disabled={mode === "so"} onChange={(e: any) => setForm({ ...form, customerId: e.target.value })} data-testid="inv-customer-select">
            <option value="">{mode === "so" ? "Auto-filled from Sales Order" : "— Select Party —"}</option>
            {db.parties.filter(p => mode === "direct" || p.id === form.customerId).map(p => <option key={p.id} value={p.id}>{p.name}{p.city ? ` · ${p.city}` : ""}</option>)}
          </Select>
        </div>
        <div><Label>Job Card (optional)</Label>
          <Select value={form.jobCardId || ""} onChange={(e: any) => setForm({ ...form, jobCardId: e.target.value })} data-testid="inv-jc-select">
            <option value="">— None —</option>
            {soJCs.map(j => <option key={j.id} value={j.id}>{j.number} · {j.product}</option>)}
          </Select>
        </div>
      </div>

      <div className="mt-4 border border-slate-200 dark:border-slate-700 rounded-lg overflow-x-auto" data-testid="inv-lines-panel">
        <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-xs">
          <div className="font-semibold">Invoice Items — partial invoicing allowed{mode === "so" ? " up to SO balance" : ""}</div>
          {mode === "direct" && form.dispatchType && <Button size="sm" variant="outline" onClick={() => setLines(ls => [...ls, { name: "", hsn: "", qty: 1, rate: 0, gst: 18 }])} data-testid="inv-add-item"><IconPlus size={12}/> Add Item</Button>}
        </div>
        <Table>
          <thead><tr>
            <Th>Item</Th><Th>HSN</Th>
            {mode === "so" ? <><Th className="text-right">SO Qty</Th><Th className="text-right">Invoiced</Th><Th className="text-right">Balance</Th></> : <Th className="text-right">Stock</Th>}
            <Th className="text-right">Invoice Qty</Th><Th className="text-right">Rate</Th><Th className="text-right">GST%</Th><Th className="text-right">Amount</Th>{mode === "direct" && <Th></Th>}
          </tr></thead>
          <tbody>
            {lines.map((l, idx) => {
              const bal = l.ordered != null ? Math.max(0, l.ordered - (l.otherInvoiced || 0)) : 0;
              const stock = db.items.find(i => i.id === l.itemId)?.currentStock || 0;
              const over = mode === "so" ? l.qty > bal : !!l.itemId && l.qty > stock;
              return (
                <tr key={idx} className={over ? "bg-rose-50 dark:bg-rose-900/20" : ""}>
                  <Td className="min-w-52 font-medium">
                    {mode === "so" ? l.name : (
                      <Select value={l.itemId || ""} onChange={(e: any) => { const it = db.items.find(i => i.id === e.target.value); upd(idx, { itemId: it?.id, name: it?.name || "", hsn: it?.hsn || "", rate: it ? (it.saleRate || it.purchaseRate || 0) : 0, gst: it?.gstRate ?? 18 }); }} data-testid={`inv-item-${idx}`}>
                        <option value="">— Select Item —</option>
                        {directItems.map(i => <option key={i.id} value={i.id}>{i.name} · stock {fmt2(i.currentStock)} {i.unit}</option>)}
                      </Select>
                    )}
                  </Td>
                  <Td><Input value={l.hsn} onChange={(e: any) => upd(idx, { hsn: e.target.value })} className="w-24 py-1 h-8" data-testid={`inv-hsn-${idx}`}/></Td>
                  {mode === "so" ? <><Td className="text-right">{l.ordered}</Td><Td className="text-right">{l.otherInvoiced}</Td><Td className="text-right font-medium" data-testid={`inv-balance-${idx}`}>{bal}</Td></>
                    : <Td className="text-right text-xs" data-testid={`inv-stock-${idx}`}>{l.itemId ? fmt2(stock) : "—"}</Td>}
                  <Td className="text-right"><Input type="number" min={0} value={l.qty} onChange={(e: any) => upd(idx, { qty: Math.max(0, Number(e.target.value) || 0) })} className={"w-24 text-right py-1 h-8 " + (over ? "border-rose-500" : "")} data-testid={`inv-qty-${idx}`}/></Td>
                  <Td className="text-right"><Input type="number" value={l.rate} onChange={(e: any) => upd(idx, { rate: Number(e.target.value) || 0 })} className="w-24 text-right py-1 h-8" data-testid={`inv-rate-${idx}`}/></Td>
                  <Td className="text-right"><Input type="number" value={l.gst} onChange={(e: any) => upd(idx, { gst: Number(e.target.value) || 0 })} className="w-16 text-right py-1 h-8"/></Td>
                  <Td className="text-right font-medium">{fmtINR(l.qty * l.rate)}</Td>
                  {mode === "direct" && <Td><Button size="sm" variant="ghost" onClick={() => setLines(ls => ls.filter((_, i) => i !== idx))}><IconTrash size={14}/></Button></Td>}
                </tr>
              );
            })}
            {lines.length === 0 && <tr><Td colSpan={9}><Empty title="No items" subtitle={mode === "so" ? "Select a Sales Order to auto-fetch items" : "Pick a Supply Type and add items"}/></Td></tr>}
          </tbody>
        </Table>
      </div>
      {mode === "direct" && <div className="text-[11px] text-slate-500 mt-1">Stock is checked and deducted only when goods are physically dispatched.</div>}

      <div className="rounded-lg border p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700 text-sm space-y-1 max-w-sm ml-auto mt-4">
        <div className="flex justify-between"><span>Taxable Value</span><b>{fmtINR(totals.sub)}</b></div>
        <div className="flex justify-between items-center gap-2"><span>Freight</span><Input type="number" value={form.freight ?? 0} onChange={(e: any) => setForm({ ...form, freight: Number(e.target.value) || 0 })} className="w-32 text-right py-1 h-8" data-testid="inv-freight"/></div>
        <div className="flex justify-between"><span>GST</span><b>{fmtINR(totals.gst)}</b></div>
        <div className="flex justify-between text-base border-t pt-1 mt-1"><span>Grand Total</span><b className="text-emerald-600" data-testid="inv-grand-total">{fmtINR(totals.total)}</b></div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} data-testid="inv-save-btn">{edit ? "Update Invoice" : "Create Invoice"}</Button>
      </div>
    </Modal>
  );
}
