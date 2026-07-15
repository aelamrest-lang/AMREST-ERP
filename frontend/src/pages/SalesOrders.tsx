import { useState, useMemo } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
import type { SalesOrder } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint } from "../components/icons";
import { calcDocTotals, fmtINR, nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

const SO_STATUSES: SalesOrder["status"][] = ["Pending", "Confirmed", "In Production", "Dispatched", "Delivered"];
const GST_OPTIONS = [0, 5, 12, 18, 28];

export function SalesOrders() {
  const { db, setDB, currentUser, log } = useStore();
  const isAdmin = currentUser?.role === "admin";
  const canCreate = userCan(currentUser, "salesorders", "create");
  const canEdit = userCan(currentUser, "salesorders", "edit");
  const canDelete = userCan(currentUser, "salesorders", "delete");
  const canPrint = userCan(currentUser, "salesorders", "print");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<SalesOrder | null>(null);

  const list = useMemo(() => {
    const arr = isAdmin ? db.salesOrders : db.salesOrders.filter(o => o.ownerId === currentUser?.id);
    return arr.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [db.salesOrders, isAdmin, currentUser]);

  const customers = db.parties.filter(p => p.type === "customer" && (isAdmin || p.ownerId === currentUser?.id));

  const blank = (): SalesOrder => ({
    id: "", number: nextNumber("SO", db.salesOrders), date: todayISO(), customerId: customers[0]?.id || "",
    items: [{ name: "Transformer", qty: 1, rate: 100000, gst: 18 }],
    deliveryDate: "", status: "Confirmed",
    ownerId: currentUser!.id, createdAt: new Date().toISOString(),
  });
  const [form, setForm] = useState<SalesOrder>(blank());

  const openNew = () => { setEdit(null); setForm(blank()); setOpen(true); };
  const openEdit = (o: SalesOrder) => { setEdit(o); setForm({...o, items: o.items.map(i => ({...i}))}); setOpen(true); };
  const save = () => {
    if (edit) setDB(d => ({...d, salesOrders: d.salesOrders.map(x => x.id === edit.id ? form : x)}));
    else setDB(d => ({...d, salesOrders: [{...form, id: uid()}, ...d.salesOrders]}));
    log(`${edit ? "Updated" : "Created"} sales order ${form.number}`, "Sales Order");
    setOpen(false);
  };
  const remove = (o: SalesOrder) => {
    if (!confirm(`Delete ${o.number}?`)) return;
    setDB(d => ({...d, salesOrders: d.salesOrders.filter(x => x.id !== o.id)}));
    log(`Deleted SO ${o.number}`, "Sales Order");
  };

  const updateItem = (i: number, key: string, val: any) => setForm(f => ({...f, items: f.items.map((it, idx) => idx === i ? {...it, [key]: key === "name" ? val : Number(val)} : it)}));
  const addItem = () => setForm(f => ({...f, items: [...f.items, { name: "", qty: 1, rate: 0, gst: 18 }]}));
  const delItem = (i: number) => setForm(f => ({...f, items: f.items.filter((_, idx) => idx !== i)}));
  const totals = calcDocTotals(form.items);

  const printSO = (o: SalesOrder) => {
    const cust = db.parties.find(x => x.id === o.customerId);
    const t = calcDocTotals(o.items);
    const body = `
      <div class="box"><div class="section-title">Customer Details</div><b>${cust?.name}</b><br/>${cust?.address}<br/>GST: ${cust?.gst || ""}<br/>Contact: ${cust?.mobile || ""} | ${cust?.email || ""}</div>
      <div class="box"><span class="badge">${o.status}</span> &nbsp; <b>Delivery Date:</b> ${o.deliveryDate || "TBD"}</div>
      <table><thead><tr><th>#</th><th>Item</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">GST%</th><th class="right">Amount</th></tr></thead>
      <tbody>${o.items.map((i, idx) => `<tr><td>${idx+1}</td><td>${i.name}</td><td class="right">${i.qty}</td><td class="right">${fmtINR(i.rate)}</td><td class="right">${i.gst}</td><td class="right">${fmtINR(i.qty*i.rate)}</td></tr>`).join("")}</tbody></table>
      <div class="totals"><div><span>Sub Total</span><b>${fmtINR(t.sub)}</b></div><div><span>GST</span><b>${fmtINR(t.gst)}</b></div><div class="grand"><span>Total</span><b>${fmtINR(t.total)}</b></div></div>
    `;
    const html = professionalDocument(db.settings, { title: "Sales Order", number: o.number, date: o.date, body, accent: "#059669" });
    printArea(html, o.number);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">Sales Orders</h1><p className="text-sm text-slate-500">Confirmed orders, delivery and dispatch tracking</p></div>
        {canCreate && <Button onClick={openNew}><IconPlus size={14}/> New Sales Order</Button>}
      </div>

      <Card>
        <Table>
          <thead><tr><Th>#</Th><Th>Date</Th><Th>Customer</Th><Th>Items</Th><Th>Delivery</Th><Th>Total</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {list.map(o => {
              const t = calcDocTotals(o.items);
              return (
                <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-mono text-xs">{o.number}</Td>
                  <Td>{o.date}</Td>
                  <Td>{db.parties.find(x => x.id === o.customerId)?.name}</Td>
                  <Td>{o.items.length}</Td>
                  <Td>{o.deliveryDate || "—"}</Td>
                  <Td className="font-semibold">{fmtINR(t.total)}</Td>
                  <Td>
                    <Select disabled={!canEdit} value={o.status} onChange={(e: any) => {
                      setDB(d => ({...d, salesOrders: d.salesOrders.map(x => x.id === o.id ? {...x, status: e.target.value} : x)}));
                      log(`SO ${o.number} → ${e.target.value}`, "Sales Order");
                    }} className="text-xs py-1">
                      {SO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </Td>
                  <Td><div className="flex gap-1">
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(o)}><IconEdit size={14}/></Button>}
                    {canPrint && <Button size="sm" variant="ghost" onClick={() => printSO(o)}><IconPrint size={14}/></Button>}
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => remove(o)}><IconTrash size={14}/></Button>}
                  </div></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {list.length === 0 && <Empty title="No sales orders yet"/>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit ${edit.number}` : "New Sales Order"} size="xl">
        <div className="grid sm:grid-cols-4 gap-3">
          <div><Label>SO No.</Label><Input value={form.number} disabled/></div>
          <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e: any) => setForm({...form, date: e.target.value})}/></div>
          <div className="sm:col-span-2"><Label>Customer</Label>
            <Select value={form.customerId} onChange={(e: any) => setForm({...form, customerId: e.target.value})}>
              <option value="">— Select —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div><Label>Delivery Date</Label><Input type="date" value={form.deliveryDate} onChange={(e: any) => setForm({...form, deliveryDate: e.target.value})}/></div>
          <div><Label>Status</Label>
            <Select value={form.status} onChange={(e: any) => setForm({...form, status: e.target.value})}>
              {SO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        </div>
        <div className="mt-3 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <Table>
            <thead><tr><Th>Item</Th><Th>Qty</Th><Th>Rate</Th><Th>GST%</Th><Th>Amount</Th><Th></Th></tr></thead>
            <tbody>{form.items.map((it, i) => (
              <tr key={i}>
                <Td><Input value={it.name} onChange={(e: any) => updateItem(i, "name", e.target.value)}/></Td>
                <Td><Input type="number" value={it.qty} onChange={(e: any) => updateItem(i, "qty", e.target.value)}/></Td>
                <Td><Input type="number" value={it.rate} onChange={(e: any) => updateItem(i, "rate", e.target.value)}/></Td>
                <Td><Select value={it.gst} onChange={(e: any) => updateItem(i, "gst", e.target.value)}>{GST_OPTIONS.map(rate => <option key={rate} value={rate}>{rate}%</option>)}</Select></Td>
                <Td>{fmtINR(it.qty * it.rate)}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => delItem(i)}><IconTrash size={14}/></Button></Td>
              </tr>
            ))}</tbody>
          </Table>
        </div>
        <div className="mt-2"><Button size="sm" variant="outline" onClick={addItem}><IconPlus size={14}/> Add Item</Button></div>
        <div className="rounded-lg border p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700 text-sm mt-3 max-w-sm ml-auto">
          <div className="flex justify-between"><span>Sub Total</span><b>{fmtINR(totals.sub)}</b></div>
          <div className="flex justify-between"><span>GST</span><b>{fmtINR(totals.gst)}</b></div>
          <div className="flex justify-between text-base border-t pt-1 mt-1"><span>Total</span><b className="text-emerald-600">{fmtINR(totals.total)}</b></div>
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>{edit ? "Update" : "Create"}</Button></div>
      </Modal>

      <Badge color="slate">Use the Sales Order to create a Job Card for production.</Badge>
    </div>
  );
}
