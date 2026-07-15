import { useState, useMemo } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Empty } from "../components/ui";
import type { Proforma } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint } from "../components/icons";
import { calcDocTotals, fmtINR, nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

const GST_OPTIONS = [0, 5, 12, 18, 28];

export function Proformas() {
  const { db, setDB, currentUser, log } = useStore();
  const isAdmin = currentUser?.role === "admin";
  const canCreate = userCan(currentUser, "proformas", "create");
  const canEdit = userCan(currentUser, "proformas", "edit");
  const canDelete = userCan(currentUser, "proformas", "delete");
  const canPrint = userCan(currentUser, "proformas", "print");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Proforma | null>(null);

  const list = useMemo(() => {
    const arr = isAdmin ? db.proformas : db.proformas.filter(p => p.ownerId === currentUser?.id);
    return arr.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [db.proformas, isAdmin, currentUser]);

  const customers = db.parties.filter(p => p.type === "customer" && (isAdmin || p.ownerId === currentUser?.id));

  const blank = (): Proforma => ({
    id: "", number: nextNumber("PI", db.proformas), date: todayISO(), customerId: customers[0]?.id || "",
    items: [{ name: "Transformer", qty: 1, rate: 100000, gst: 18 }],
    paymentTerms: "50% advance, 50% before dispatch", transport: "By Road",
    ownerId: currentUser!.id, createdAt: new Date().toISOString(),
  });
  const [form, setForm] = useState<Proforma>(blank());

  const openNew = () => { setEdit(null); setForm(blank()); setOpen(true); };
  const openEdit = (p: Proforma) => { setEdit(p); setForm({...p, items: p.items.map(i => ({...i}))}); setOpen(true); };
  const save = () => {
    if (edit) setDB(d => ({...d, proformas: d.proformas.map(x => x.id === edit.id ? form : x)}));
    else setDB(d => ({...d, proformas: [{...form, id: uid()}, ...d.proformas]}));
    log(`${edit ? "Updated" : "Created"} proforma ${form.number}`, "Proforma");
    setOpen(false);
  };
  const remove = (p: Proforma) => {
    if (!confirm(`Delete ${p.number}?`)) return;
    setDB(d => ({...d, proformas: d.proformas.filter(x => x.id !== p.id)}));
    log(`Deleted proforma ${p.number}`, "Proforma");
  };
  const convertSO = (p: Proforma) => {
    const so = {
      id: uid(), number: nextNumber("SO", db.salesOrders), date: todayISO(),
      customerId: p.customerId, proformaId: p.id, items: p.items.map(i => ({...i})),
      deliveryDate: "", status: "Confirmed" as const,
      ownerId: currentUser!.id, createdAt: new Date().toISOString(),
    };
    setDB(d => ({...d, salesOrders: [so, ...d.salesOrders]}));
    log(`Converted ${p.number} → SO ${so.number}`, "Proforma");
    alert(`Sales Order ${so.number} created.`);
  };

  const updateItem = (i: number, key: string, val: any) => setForm(f => ({...f, items: f.items.map((it, idx) => idx === i ? {...it, [key]: key === "name" ? val : Number(val)} : it)}));
  const addItem = () => setForm(f => ({...f, items: [...f.items, { name: "", qty: 1, rate: 0, gst: 18 }]}));
  const delItem = (i: number) => setForm(f => ({...f, items: f.items.filter((_, idx) => idx !== i)}));
  const totals = calcDocTotals(form.items);

  const printP = (p: Proforma) => {
    const cust = db.parties.find(x => x.id === p.customerId);
    const t = calcDocTotals(p.items);
    const body = `
      <div class="box"><div class="section-title">Customer Details</div><b>${cust?.name || ""}</b><br/>${cust?.address || ""}<br/>GST: ${cust?.gst || ""}<br/>Contact: ${cust?.mobile || ""} | ${cust?.email || ""}</div>
      <table><thead><tr><th>#</th><th>Item</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">GST%</th><th class="right">Amount</th></tr></thead>
      <tbody>${p.items.map((i, idx) => `<tr><td>${idx+1}</td><td>${i.name}</td><td class="right">${i.qty}</td><td class="right">${fmtINR(i.rate)}</td><td class="right">${i.gst}</td><td class="right">${fmtINR(i.qty*i.rate)}</td></tr>`).join("")}</tbody></table>
      <div class="totals"><div><span>Sub Total</span><b>${fmtINR(t.sub)}</b></div><div><span>GST</span><b>${fmtINR(t.gst)}</b></div><div class="grand"><span>Grand Total</span><b>${fmtINR(t.total)}</b></div></div>
      <div class="box"><div class="section-title">Payment & Transport</div><b>Payment Terms:</b> ${p.paymentTerms}<br/><b>Transport:</b> ${p.transport || "-"}</div>
    `;
    const html = professionalDocument(db.settings, { title: "Proforma Invoice", number: p.number, date: p.date, body, accent: "#7c3aed" });
    printArea(html, p.number);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">Proforma Invoices</h1><p className="text-sm text-slate-500">Pre-invoice with GST and payment terms</p></div>
        {canCreate && <Button onClick={openNew}><IconPlus size={14}/> New Proforma</Button>}
      </div>

      <Card>
        <Table>
          <thead><tr><Th>#</Th><Th>Date</Th><Th>Customer</Th><Th>Items</Th><Th>Total</Th><Th>Owner</Th><Th></Th></tr></thead>
          <tbody>
            {list.map(p => {
              const t = calcDocTotals(p.items);
              return (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-mono text-xs">{p.number}</Td>
                  <Td>{p.date}</Td>
                  <Td>{db.parties.find(x => x.id === p.customerId)?.name}</Td>
                  <Td>{p.items.length}</Td>
                  <Td className="font-semibold">{fmtINR(t.total)}</Td>
                  <Td className="text-xs">{db.users.find(u => u.id === p.ownerId)?.name}</Td>
                  <Td><div className="flex gap-1">
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(p)}><IconEdit size={14}/></Button>}
                    {canPrint && <Button size="sm" variant="ghost" onClick={() => printP(p)}><IconPrint size={14}/></Button>}
                    {userCan(currentUser, "salesorders", "create") && <Button size="sm" variant="outline" onClick={() => convertSO(p)}>→ SO</Button>}
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => remove(p)}><IconTrash size={14}/></Button>}
                  </div></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {list.length === 0 && <Empty/>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit ${edit.number}` : "New Proforma"} size="xl">
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label>No.</Label><Input value={form.number} disabled/></div>
          <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e: any) => setForm({...form, date: e.target.value})}/></div>
          <div><Label>Customer</Label>
            <Select value={form.customerId} onChange={(e: any) => setForm({...form, customerId: e.target.value})}>
              <option value="">— Select —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div className="space-y-3">
            <div><Label>Payment Terms</Label><Input value={form.paymentTerms} onChange={(e: any) => setForm({...form, paymentTerms: e.target.value})}/></div>
            <div><Label>Transport</Label><Input value={form.transport} onChange={(e: any) => setForm({...form, transport: e.target.value})}/></div>
          </div>
          <div className="rounded-lg border p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700 text-sm">
            <div className="flex justify-between"><span>Sub Total</span><b>{fmtINR(totals.sub)}</b></div>
            <div className="flex justify-between"><span>GST</span><b>{fmtINR(totals.gst)}</b></div>
            <div className="flex justify-between text-base border-t pt-1 mt-1"><span>Total</span><b className="text-emerald-600">{fmtINR(totals.total)}</b></div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>{edit ? "Update" : "Create"}</Button></div>
      </Modal>
    </div>
  );
}
