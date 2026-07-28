import { useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
import type { DeliveryChallan, SalesOrder } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint } from "../components/icons";
import { calcDocTotals, fmtINR, nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

interface DispatchRow {
  name: string;
  ordered: number;
  alreadyDispatched: number;
  currentQty: number;
  balance: number;
  rate: number;
  gst: number;
}

// Sum of qty already dispatched for a given SO/item name across all existing challans,
// excluding the challan currently being edited (if any).
function sumDispatched(challans: DeliveryChallan[], salesOrderId: string, itemName: string, excludeChallanId?: string) {
  return challans
    .filter(c => c.salesOrderId === salesOrderId && c.id !== excludeChallanId)
    .flatMap(c => c.items || [])
    .filter(i => i.name === itemName)
    .reduce((s, i) => s + (Number(i.qty) || 0), 0);
}

function buildDispatchRows(so: SalesOrder | undefined, challans: DeliveryChallan[], excludeChallanId?: string, existingItems?: DeliveryChallan["items"]): DispatchRow[] {
  if (!so) return [];
  return so.items.map(soi => {
    const already = sumDispatched(challans, so.id, soi.name, excludeChallanId);
    const balance = Math.max(0, soi.qty - already);
    const existing = existingItems?.find(x => x.name === soi.name);
    return {
      name: soi.name,
      ordered: soi.qty,
      alreadyDispatched: already,
      currentQty: existing?.qty ?? Math.min(balance, soi.qty),
      balance,
      rate: existing?.rate ?? soi.rate,
      gst: existing?.gst ?? soi.gst,
    };
  });
}

export function Challans() {
  const { db, setDB, log, currentUser } = useStore();
  const canCreate = userCan(currentUser, "challans", "create");
  const canEdit = userCan(currentUser, "challans", "edit");
  const canDelete = userCan(currentUser, "challans", "delete");
  const canPrint = userCan(currentUser, "challans", "print");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<DeliveryChallan | null>(null);

  const blank = (): DeliveryChallan => ({
    id: "", number: nextNumber("DC", db.challans), date: todayISO(),
    salesOrderId: "", jobCardId: "", customerId: "",
    items: [], freight: 0,
    vehicle: "", driver: "", transport: "", acknowledged: false, createdAt: new Date().toISOString(),
  });
  const [form, setForm] = useState<DeliveryChallan>(blank());
  const [rows, setRows] = useState<DispatchRow[]>([]);

  const currentSO = db.salesOrders.find(s => s.id === form.salesOrderId);

  const totals = useMemo(() => {
    const items = rows.map(r => ({ qty: r.currentQty, rate: r.rate, gst: r.gst }));
    return calcDocTotals(items);
  }, [rows]);
  const freight = Number(form.freight) || 0;
  const grandTotal = totals.total + freight;

  const openNew = () => {
    setEdit(null);
    setForm(blank());
    setRows([]);
    setOpen(true);
  };
  const openEdit = (c: DeliveryChallan) => {
    setEdit(c);
    setForm({ ...c });
    const so = db.salesOrders.find(s => s.id === c.salesOrderId);
    setRows(buildDispatchRows(so, db.challans, c.id, c.items));
    setOpen(true);
  };

  const applyJobCard = (jobCardId: string) => {
    const jc = db.jobCards.find(j => j.id === jobCardId);
    if (!jc) { setForm(f => ({ ...f, jobCardId: "" })); return; }
    const so = db.salesOrders.find(s => s.id === jc.salesOrderId);
    if (!so) {
      setForm(f => ({ ...f, jobCardId }));
      alert("Selected Job Card is not linked to a Sales Order.");
      return;
    }
    setForm(f => ({
      ...f,
      jobCardId,
      salesOrderId: so.id,
      customerId: so.customerId,
      freight: so.freight ?? f.freight ?? 0,
    }));
    setRows(buildDispatchRows(so, db.challans, edit?.id));
  };

  const applySalesOrder = (soId: string) => {
    const so = db.salesOrders.find(s => s.id === soId);
    setForm(f => ({
      ...f,
      salesOrderId: soId,
      customerId: so?.customerId || f.customerId,
      jobCardId: "",
      freight: so?.freight ?? f.freight ?? 0,
    }));
    setRows(buildDispatchRows(so, db.challans, edit?.id));
  };

  const updateRow = (idx: number, patch: Partial<DispatchRow>) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const save = () => {
    if (!currentSO) return alert("Please select a Sales Order or Job Card first.");
    // Validate over-dispatch
    for (const r of rows) {
      if (r.currentQty < 0) return alert(`${r.name}: Dispatch qty cannot be negative.`);
      if (r.currentQty > r.balance) {
        return alert(`${r.name}: Current dispatch (${r.currentQty}) exceeds balance (${r.balance}). Reduce the qty.`);
      }
    }
    const dispatchItems = rows.filter(r => r.currentQty > 0).map(r => ({
      name: r.name, qty: r.currentQty, rate: r.rate, gst: r.gst,
    }));
    if (dispatchItems.length === 0) return alert("Enter a Current Dispatch quantity for at least one item.");

    const payload: DeliveryChallan = { ...form, items: dispatchItems };

    if (edit) setDB(d => ({ ...d, challans: d.challans.map(x => x.id === edit.id ? payload : x) }));
    else setDB(d => ({ ...d, challans: [{ ...payload, id: uid() }, ...d.challans] }));
    log(`${edit ? "Updated" : "Created"} DC ${form.number}`, "Delivery Challan");
    setOpen(false);
  };

  const remove = (c: DeliveryChallan) => {
    if (!confirm(`Delete ${c.number}?`)) return;
    setDB(d => ({ ...d, challans: d.challans.filter(x => x.id !== c.id) }));
    log(`Deleted DC ${c.number}`, "Delivery Challan");
  };

  const printDC = (c: DeliveryChallan) => {
    const so = db.salesOrders.find(s => s.id === c.salesOrderId);
    const cust = db.parties.find(p => p.id === c.customerId);
    const dItems = c.items || [];
    const t = calcDocTotals(dItems.map(i => ({ qty: i.qty, rate: i.rate, gst: i.gst })));
    const fr = Number(c.freight) || 0;
    const grand = t.total + fr;
    const rowsHtml = dItems.map((i, idx) => {
      const ordered = so?.items.find(x => x.name === i.name)?.qty ?? 0;
      const otherDispatched = sumDispatched(db.challans, c.salesOrderId, i.name, c.id);
      const balance = Math.max(0, ordered - otherDispatched - i.qty);
      return `<tr>
        <td>${idx + 1}</td>
        <td>${i.name}</td>
        <td class="right">${ordered}</td>
        <td class="right">${otherDispatched}</td>
        <td class="right"><b>${i.qty}</b></td>
        <td class="right">${balance}</td>
        <td class="right">${fmtINR(i.rate)}</td>
        <td class="right">${i.gst}%</td>
        <td class="right">${fmtINR(i.qty * i.rate)}</td>
      </tr>`;
    }).join("");
    const body = `
      <div class="box"><div class="section-title">Consignee</div><b>${cust?.name || ""}</b><br/>${cust?.address || ""}${cust?.city ? `, ${cust.city}` : ""}<br/>GST: ${cust?.gst || ""}<br/>Contact: ${cust?.mobile || ""}</div>
      <div class="box"><div class="section-title">Dispatch Details</div><b>Sales Order:</b> ${so?.number || "-"}<br/><b>Vehicle:</b> ${c.vehicle || "-"} | <b>Driver:</b> ${c.driver || "-"}<br/><b>Transport:</b> ${c.transport || "-"}<br/><b>Acknowledgement:</b> ${c.acknowledged ? "Received" : "Pending"}</div>
      <table>
        <thead><tr>
          <th>#</th><th>Item</th>
          <th class="right">Ordered</th>
          <th class="right">Prev Dispatched</th>
          <th class="right">This Dispatch</th>
          <th class="right">Balance</th>
          <th class="right">Rate</th>
          <th class="right">GST%</th>
          <th class="right">Amount</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <table style="margin-top:8px;max-width:340px;margin-left:auto">
        <tr><td>Sub Total</td><td class="right">${fmtINR(t.sub)}</td></tr>
        <tr><td>Freight</td><td class="right">${fmtINR(fr)}</td></tr>
        <tr><td>GST</td><td class="right">${fmtINR(t.gst)}</td></tr>
        <tr><td><b>Total</b></td><td class="right"><b>${fmtINR(grand)}</b></td></tr>
      </table>
      <div class="signs"><div class="sign-box">Receiver Signature</div><div class="sign-box">Dispatch</div><div class="sign-box">Authorized Signatory</div></div>
    `;
    const html = professionalDocument(db.settings, { title: "Delivery Challan", number: c.number, date: c.date, body, accent: "#0f766e" });
    printArea(html, c.number);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">Delivery Challan</h1><p className="text-sm text-slate-500">Dispatch tracking with partial dispatch and balance</p></div>
        {canCreate && <Button onClick={openNew} data-testid="new-challan-btn"><IconPlus size={14}/> New Challan</Button>}
      </div>
      <Card>
        <Table>
          <thead><tr><Th>#</Th><Th>Date</Th><Th>SO</Th><Th>Customer</Th><Th>Items</Th><Th>Total</Th><Th>Vehicle</Th><Th>Ack</Th><Th></Th></tr></thead>
          <tbody>
            {db.challans.map(c => {
              const totalsC = calcDocTotals((c.items || []).map(i => ({ qty: i.qty, rate: i.rate, gst: i.gst })));
              const grandC = totalsC.total + (Number(c.freight) || 0);
              const totalUnits = (c.items || []).reduce((s, i) => s + i.qty, 0);
              return (
                <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-mono text-xs">{c.number}</Td>
                  <Td>{c.date}</Td>
                  <Td>{db.salesOrders.find(s => s.id === c.salesOrderId)?.number || "—"}</Td>
                  <Td>{db.parties.find(p => p.id === c.customerId)?.name}</Td>
                  <Td className="text-xs">{(c.items || []).length ? `${(c.items || []).length} line · Qty ${totalUnits}` : "—"}</Td>
                  <Td className="font-semibold">{fmtINR(grandC)}</Td>
                  <Td>{c.vehicle}</Td>
                  <Td><Badge color={c.acknowledged ? "green" : "yellow"}>{c.acknowledged ? "Yes" : "Pending"}</Badge></Td>
                  <Td><div className="flex gap-1">
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(c)}><IconEdit size={14}/></Button>}
                    {canPrint && <Button size="sm" variant="ghost" onClick={() => printDC(c)}><IconPrint size={14}/></Button>}
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => remove(c)}><IconTrash size={14}/></Button>}
                  </div></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {db.challans.length === 0 && <Empty/>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit ${edit.number}` : "New Delivery Challan"} size="xl">
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label>Challan No.</Label><Input value={form.number} disabled/></div>
          <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e: any) => setForm({...form, date: e.target.value})}/></div>
          <div><Label>Job Card</Label>
            <Select value={form.jobCardId || ""} onChange={(e: any) => applyJobCard(e.target.value)} data-testid="dc-jobcard-select">
              <option value="">— Select Job Card —</option>
              {db.jobCards.map(j => {
                const so = db.salesOrders.find(s => s.id === j.salesOrderId);
                return <option key={j.id} value={j.id}>{j.number} · {j.product} · Qty {j.qty}{so ? ` · ${so.number}` : ""}</option>;
              })}
            </Select>
          </div>
          <div><Label>Sales Order</Label>
            <Select value={form.salesOrderId} onChange={(e: any) => applySalesOrder(e.target.value)} data-testid="dc-so-select">
              <option value="">— Select —</option>
              {db.salesOrders.map(s => <option key={s.id} value={s.id}>{s.number}</option>)}
            </Select>
          </div>
          <div className="sm:col-span-2"><Label>Customer</Label>
            <Select value={form.customerId} onChange={(e: any) => setForm({...form, customerId: e.target.value})}>
              <option value="">— Select —</option>
              {db.parties.filter(p => p.type === "customer").map(p => <option key={p.id} value={p.id}>{p.name}{p.city ? ` · ${p.city}` : ""}</option>)}
            </Select>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="mt-4 border border-slate-200 dark:border-slate-700 rounded-lg overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th className="text-right">Ordered</Th>
                  <Th className="text-right">Already Dispatched</Th>
                  <Th className="text-right">Current Dispatch</Th>
                  <Th className="text-right">Balance</Th>
                  <Th className="text-right">Rate</Th>
                  <Th className="text-right">GST%</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const remainingAfter = Math.max(0, r.balance - r.currentQty);
                  const over = r.currentQty > r.balance;
                  return (
                    <tr key={i} className={over ? "bg-rose-50 dark:bg-rose-900/20" : ""}>
                      <Td className="font-medium">{r.name}</Td>
                      <Td className="text-right">{r.ordered}</Td>
                      <Td className="text-right">{r.alreadyDispatched}</Td>
                      <Td className="text-right">
                        <Input
                          type="number"
                          value={r.currentQty}
                          min={0}
                          max={r.balance}
                          onChange={(e: any) => {
                            const v = Number(e.target.value) || 0;
                            updateRow(i, { currentQty: Math.max(0, v) });
                          }}
                          className={"w-24 text-right py-1 h-8 " + (over ? "border-rose-500" : "")}
                          data-testid={`dc-current-${i}`}
                        />
                      </Td>
                      <Td className={"text-right font-semibold " + (over ? "text-rose-600" : "text-emerald-600")}>{remainingAfter}</Td>
                      <Td className="text-right">
                        <Input
                          type="number"
                          value={r.rate}
                          onChange={(e: any) => updateRow(i, { rate: Number(e.target.value) || 0 })}
                          className="w-24 text-right py-1 h-8"
                        />
                      </Td>
                      <Td className="text-right">
                        <Input
                          type="number"
                          value={r.gst}
                          onChange={(e: any) => updateRow(i, { gst: Number(e.target.value) || 0 })}
                          className="w-16 text-right py-1 h-8"
                        />
                      </Td>
                      <Td className="text-right font-medium">{fmtINR(r.currentQty * r.rate)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div className="space-y-3">
            <div><Label>Vehicle Number</Label><Input value={form.vehicle || ""} onChange={(e: any) => setForm({...form, vehicle: e.target.value})}/></div>
            <div><Label>Driver Name</Label><Input value={form.driver || ""} onChange={(e: any) => setForm({...form, driver: e.target.value})}/></div>
            <div><Label>Transport / LR</Label><Input value={form.transport || ""} onChange={(e: any) => setForm({...form, transport: e.target.value})}/></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.acknowledged} onChange={e => setForm({...form, acknowledged: e.target.checked})}/> Customer acknowledgement received</label>
          </div>

          <div className="rounded-lg border p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700 text-sm space-y-1 max-w-sm ml-auto self-start">
            <div className="flex justify-between"><span>Sub Total</span><b>{fmtINR(totals.sub)}</b></div>
            <div className="flex justify-between items-center gap-2">
              <span>Freight</span>
              <Input
                type="number"
                value={form.freight ?? 0}
                onChange={(e: any) => setForm({...form, freight: Number(e.target.value) || 0})}
                className="w-32 text-right py-1 h-8"
                data-testid="dc-freight-input"
              />
            </div>
            <div className="flex justify-between"><span>GST</span><b>{fmtINR(totals.gst)}</b></div>
            <div className="flex justify-between text-base border-t pt-1 mt-1"><span>Total</span><b className="text-emerald-600">{fmtINR(grandTotal)}</b></div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} data-testid="dc-save-btn">{edit ? "Update" : "Create"}</Button>
        </div>
      </Modal>
    </div>
  );
}
