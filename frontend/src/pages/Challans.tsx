import { useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
import type { DeliveryChallan } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint } from "../components/icons";
import { nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

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
    salesOrderId: db.salesOrders[0]?.id || "", customerId: db.salesOrders[0]?.customerId || "",
    vehicle: "", driver: "", transport: "", acknowledged: false, createdAt: new Date().toISOString(),
  });
  const [form, setForm] = useState<DeliveryChallan>(blank());
  const openNew = () => { setEdit(null); setForm(blank()); setOpen(true); };
  const openEdit = (c: DeliveryChallan) => { setEdit(c); setForm({...c}); setOpen(true); };
  const save = () => {
    const job = db.jobCards.find(j => j.salesOrderId === form.salesOrderId);
    const tests = db.qcTests.filter(t => t.jobCardId === job?.id);
    const qcReady = !!job && tests.length >= job.qty && tests.every(t => t.result === "Pass" && t.workflowStatus === "Ready For Dispatch");
    if (!qcReady) return alert("Dispatch blocked: QC approval and Ready For Dispatch status are required before Delivery Challan.");
    if (edit) setDB(d => ({...d, challans: d.challans.map(x => x.id === edit.id ? form : x)}));
    else setDB(d => ({...d, challans: [{...form, id: uid()}, ...d.challans], serials: d.serials.map(s => s.jobCardId === job?.id ? {...s, dispatchStatus: "Dispatched"} : s)}));
    log(`${edit ? "Updated" : "Created"} DC ${form.number}`, "Delivery Challan");
    setOpen(false);
  };
  const remove = (c: DeliveryChallan) => { if (confirm(`Delete ${c.number}?`)) { setDB(d => ({...d, challans: d.challans.filter(x => x.id !== c.id)})); log(`Deleted DC ${c.number}`, "Delivery Challan"); } };

  const printDC = (c: DeliveryChallan) => {
    const so = db.salesOrders.find(s => s.id === c.salesOrderId);
    const cust = db.parties.find(p => p.id === c.customerId);
    const body = `
      <div class="box"><div class="section-title">Consignee</div><b>${cust?.name}</b><br/>${cust?.address}<br/>GST: ${cust?.gst || ""}<br/>Contact: ${cust?.mobile || ""}</div>
      <div class="box"><div class="section-title">Dispatch Details</div><b>Sales Order:</b> ${so?.number || "-"}<br/><b>Vehicle:</b> ${c.vehicle || "-"} | <b>Driver:</b> ${c.driver || "-"}<br/><b>Transport:</b> ${c.transport || "-"}<br/><b>Acknowledgement:</b> ${c.acknowledged ? "Received" : "Pending"}</div>
      <table><thead><tr><th>#</th><th>Item</th><th class="right">Qty</th></tr></thead>
      <tbody>${(so?.items || []).map((i, idx) => `<tr><td>${idx+1}</td><td>${i.name}</td><td class="right">${i.qty}</td></tr>`).join("")}</tbody></table>
      <div class="signs"><div class="sign-box">Receiver Signature</div><div class="sign-box">Dispatch</div><div class="sign-box">Authorized Signatory</div></div>
    `;
    const html = professionalDocument(db.settings, { title: "Delivery Challan", number: c.number, date: c.date, body, accent: "#0f766e" });
    printArea(html, c.number);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">Delivery Challan</h1><p className="text-sm text-slate-500">Dispatch and transport tracking</p></div>
        {canCreate && <Button onClick={openNew}><IconPlus size={14}/> New Challan</Button>}
      </div>
      <Card>
        <Table>
          <thead><tr><Th>#</Th><Th>Date</Th><Th>SO</Th><Th>Customer</Th><Th>Vehicle</Th><Th>Driver</Th><Th>Ack</Th><Th></Th></tr></thead>
          <tbody>
            {db.challans.map(c => (
              <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Td className="font-mono text-xs">{c.number}</Td>
                <Td>{c.date}</Td>
                <Td>{db.salesOrders.find(s => s.id === c.salesOrderId)?.number || "—"}</Td>
                <Td>{db.parties.find(p => p.id === c.customerId)?.name}</Td>
                <Td>{c.vehicle}</Td>
                <Td>{c.driver}</Td>
                <Td><Badge color={c.acknowledged ? "green" : "yellow"}>{c.acknowledged ? "Yes" : "Pending"}</Badge></Td>
                <Td><div className="flex gap-1">
                  {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(c)}><IconEdit size={14}/></Button>}
                  {canPrint && <Button size="sm" variant="ghost" onClick={() => printDC(c)}><IconPrint size={14}/></Button>}
                  {canDelete && <Button size="sm" variant="ghost" onClick={() => remove(c)}><IconTrash size={14}/></Button>}
                </div></Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {db.challans.length === 0 && <Empty/>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit ${edit.number}` : "New Delivery Challan"} size="lg">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Challan No.</Label><Input value={form.number} disabled/></div>
          <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e: any) => setForm({...form, date: e.target.value})}/></div>
          <div><Label>Sales Order</Label>
            <Select value={form.salesOrderId} onChange={(e: any) => {
              const so = db.salesOrders.find(s => s.id === e.target.value);
              setForm({...form, salesOrderId: e.target.value, customerId: so?.customerId || form.customerId});
            }}>
              <option value="">— Select —</option>
              {db.salesOrders.map(s => <option key={s.id} value={s.id}>{s.number}</option>)}
            </Select>
          </div>
          <div><Label>Customer</Label>
            <Select value={form.customerId} onChange={(e: any) => setForm({...form, customerId: e.target.value})}>
              {db.parties.filter(p => p.type === "customer").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
          <div><Label>Vehicle Number</Label><Input value={form.vehicle} onChange={(e: any) => setForm({...form, vehicle: e.target.value})}/></div>
          <div><Label>Driver Name</Label><Input value={form.driver} onChange={(e: any) => setForm({...form, driver: e.target.value})}/></div>
          <div className="sm:col-span-2"><Label>Transport / LR</Label><Input value={form.transport} onChange={(e: any) => setForm({...form, transport: e.target.value})}/></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.acknowledged} onChange={e => setForm({...form, acknowledged: e.target.checked})}/> Customer acknowledgement received</label>
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>{edit ? "Update" : "Create"}</Button></div>
      </Modal>
    </div>
  );
}
