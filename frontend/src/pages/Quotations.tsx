import { useState, useMemo } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Empty, Textarea } from "../components/ui";
import { FinishedGoodCombobox } from "../components/FinishedGoodCombobox";
import type { Quotation, DocStatus } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint, IconFile } from "../components/icons";
import { calcCostingTotals, calcDocTotals, fmtINR, nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

const STATUSES: DocStatus[] = ["Inquiry", "Quotation Sent", "Negotiation", "Order Confirmed", "Production", "Delivered"];
const GST_OPTIONS = [0, 5, 12, 18, 28];
const DEFAULT_QUOTATION_TERMS = `1. GST: Extra as applicable.
2. Payment Terms: 30% advance along with Purchase Order, 70% against inspection before dispatch.
3. Freight: Extra as actual.
4. Delivery: 30-45 days from the date of confirmed Purchase Order and advance payment.
5. Validity: 10 days from the date of offer.`;
const DEFAULT_ITEM_DESCRIPTION = "11/0.433 kV, Copper Wound, Outdoor Type, Oil Immersed, ONAN Cooling, BIS Compliant, Complete with Standard Accessories.";

function getDefaultQuotationTerms(settings: any) {
  const format = (settings.documentFormats || []).find((f: any) => f.active && f.documentType === "Quotation");
  const terms = (format?.terms || []).filter((t: any) => t.active).sort((a: any, b: any) => a.order - b.order);
  return terms.length ? terms.map((t: any, i: number) => `${i + 1}. ${t.text}`).join("\n") : DEFAULT_QUOTATION_TERMS;
}

export function Quotations() {
  const { db, setDB, currentUser, log } = useStore();
  const isAdmin = currentUser?.role === "admin";
  const canCreate = userCan(currentUser, "quotations", "create");
  const canEdit = userCan(currentUser, "quotations", "edit");
  const canDelete = userCan(currentUser, "quotations", "delete");
  const canPrint = userCan(currentUser, "quotations", "print");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Quotation | null>(null);

  const list = useMemo(() => {
    const arr = isAdmin ? db.quotations : db.quotations.filter(q => q.ownerId === currentUser?.id);
    return arr.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [db.quotations, isAdmin, currentUser]);

  const customers = db.parties.filter(p => p.type === "customer" && (isAdmin || p.ownerId === currentUser?.id));
  const myCostings = db.costings.filter(c => isAdmin || c.ownerId === currentUser?.id);

  const blank = (): Quotation => ({
    id: "", number: nextNumber("QTN", db.quotations), date: todayISO(), customerId: customers[0]?.id || "", costingId: "",
    items: [{ name: "100 kVA Distribution Transformer", description: DEFAULT_ITEM_DESCRIPTION, qty: 1, rate: 185000, gst: 18 }],
    terms: getDefaultQuotationTerms(db.settings),
    status: "Quotation Sent", ownerId: currentUser!.id, createdAt: new Date().toISOString(),
  });
  const [form, setForm] = useState<Quotation>(blank());

  const openNew = (presetCostingId?: string) => {
    const f = blank();
    if (presetCostingId) {
      const c = db.costings.find(x => x.id === presetCostingId);
      if (c) {
        const t = calcCostingTotals(c.materials, c.gstRate, c.marginPct);
        f.costingId = c.id;
        f.customerId = c.customerId || f.customerId;
        f.items = [{ name: `${c.kva || ""} KVA Transformer — ${c.title}`, qty: 1, rate: Math.round(t.subTotal), gst: c.gstRate }];
      }
    }
    setEdit(null); setForm(f); setOpen(true);
  };
  const openEdit = (q: Quotation) => { setEdit(q); setForm({...q, items: q.items.map(i => ({...i}))}); setOpen(true); };

  const save = () => {
    if (!form.customerId) return alert("Select a customer");
    if (edit) {
      setDB(d => ({ ...d, quotations: d.quotations.map(q => q.id === edit.id ? form : q) }));
      log(`Updated quotation ${form.number}`, "Quotations");
    } else {
      setDB(d => ({ ...d, quotations: [{...form, id: uid()}, ...d.quotations] }));
      log(`Created quotation ${form.number}`, "Quotations");
    }
    setOpen(false);
  };
  const remove = (q: Quotation) => {
    if (!confirm(`Delete ${q.number}?`)) return;
    setDB(d => ({ ...d, quotations: d.quotations.filter(x => x.id !== q.id) }));
    log(`Deleted quotation ${q.number}`, "Quotations");
  };

  const updateItem = (i: number, key: string, val: any) => {
    setForm(f => ({...f, items: f.items.map((it, idx) => idx === i ? {...it, [key]: key === "name" || key === "description" ? val : Number(val)} : it)}));
  };
  const pickFinishedGood = (i: number, fg: { name: string; saleRate: number; gstRate: number }) => {
    setForm(f => ({
      ...f,
      items: f.items.map((it, idx) => idx === i ? {
        ...it,
        name: fg.name,
        rate: fg.saleRate || it.rate || 0,
        gst: fg.gstRate ?? it.gst,
      } : it),
    }));
  };
  const addItem = () => setForm(f => ({...f, items: [...f.items, { name: "", description: "", qty: 1, rate: 0, gst: 18 }]}));
  const delItem = (i: number) => setForm(f => ({...f, items: f.items.filter((_, idx) => idx !== i)}));
  const totals = calcDocTotals(form.items);

  const saveAsDefaultTerms = () => {
    const lines = form.terms.split("\n").map(x => x.replace(/^\s*\d+[.)-]?\s*/, "").trim()).filter(Boolean);
    if (!lines.length) return alert("Enter at least one term to save as default.");
    const now = new Date().toISOString();
    setDB(d => {
      const existing = d.settings.documentFormats || [];
      const quotationFormat = existing.find((f: any) => f.documentType === "Quotation");
      const updatedFormat = {
        ...(quotationFormat || {
          id: uid(), documentType: "Quotation", formatName: "Quotation Standard Format", active: true,
          companyName: d.settings.name, address: d.settings.address, gstNo: d.settings.gst,
          contactDetails: `${d.settings.email} | ${d.settings.phone}`, headerContent: "", footerContent: "",
          bankDetails: "", declaration: "", signatureName: "Authorized Signatory", qrCode: true,
          pageSize: "A4", orientation: "Portrait", createdAt: now,
        }),
        active: true,
        terms: lines.map((text, index) => ({ id: `quotation-term-${index + 1}`, text, active: true, order: index + 1 })),
        updatedAt: now,
      };
      return {
        ...d,
        settings: {
          ...d.settings,
          documentFormats: quotationFormat
            ? existing.map((f: any) => f.id === quotationFormat.id ? updatedFormat : f)
            : [updatedFormat as any, ...existing],
        },
      };
    });
    log("Updated default quotation terms", "Quotations");
    alert("Default quotation terms saved.");
  };

  const convert = (q: Quotation, to: "proforma" | "salesorder") => {
    if (to === "proforma") {
      const np = {
        id: uid(), number: nextNumber("PI", db.proformas), date: todayISO(),
        quotationId: q.id, customerId: q.customerId, items: q.items.map(i => ({...i})),
        paymentTerms: "50% advance, 50% before dispatch", transport: "By Road",
        ownerId: currentUser!.id, createdAt: new Date().toISOString(),
      };
      setDB(d => ({ ...d, proformas: [np, ...d.proformas], quotations: d.quotations.map(x => x.id === q.id ? {...x, status: "Negotiation"} : x) }));
      log(`Converted ${q.number} → Proforma ${np.number}`, "Quotations");
      alert(`Proforma Invoice ${np.number} created.`);
    } else {
      const so = {
        id: uid(), number: nextNumber("SO", db.salesOrders), date: todayISO(),
        customerId: q.customerId, items: q.items.map(i => ({...i})),
        deliveryDate: "", status: "Confirmed" as const,
        ownerId: currentUser!.id, createdAt: new Date().toISOString(),
      };
      setDB(d => ({ ...d, salesOrders: [so, ...d.salesOrders], quotations: d.quotations.map(x => x.id === q.id ? {...x, status: "Order Confirmed"} : x) }));
      log(`Converted ${q.number} → SO ${so.number}`, "Quotations");
      alert(`Sales Order ${so.number} created.`);
    }
  };

  const printQ = (q: Quotation) => {
    const cust = db.parties.find(p => p.id === q.customerId);
    const t = calcDocTotals(q.items);
    const body = `
      <div class="box"><div class="section-title">Bill To</div><b>${cust?.name || ""}</b><br/>${cust?.address || ""}<br/>GST: ${cust?.gst || ""}<br/>Contact: ${cust?.mobile || ""} | ${cust?.email || ""}</div>
      <table><thead><tr><th>#</th><th>Description</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">GST%</th><th class="right">Amount</th></tr></thead>
      <tbody>${q.items.map((i, idx) => `<tr><td>${idx+1}</td><td><b>${i.name}</b>${i.description ? `<br/><span class="muted">${i.description}</span>` : ""}</td><td class="right">${i.qty}</td><td class="right">${fmtINR(i.rate)}</td><td class="right">${i.gst}</td><td class="right">${fmtINR(i.qty*i.rate)}</td></tr>`).join("")}</tbody></table>
      <div class="totals">
        <div><span>Sub Total</span><b>${fmtINR(t.sub)}</b></div>
        <div><span>GST</span><b>${fmtINR(t.gst)}</b></div>
        <div class="grand"><span>Grand Total</span><b>${fmtINR(t.total)}</b></div>
      </div>
      <div class="box"><div class="section-title">Terms & Conditions</div><pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;margin:6px 0">${q.terms}</pre></div>
    `;
    const html = professionalDocument(db.settings, { title: "Quotation", number: q.number, date: q.date, body, accent: "#2563eb", skipFormatTerms: true });
    printArea(html, q.number);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">Quotations</h1><p className="text-sm text-slate-500">Create, convert and track quotations</p></div>
        <div className="flex gap-2">
          {canCreate && myCostings.length > 0 && (
            <Select className="w-56" onChange={(e: any) => e.target.value && openNew(e.target.value)}>
              <option value="">From costing sheet…</option>
              {myCostings.filter(c => c.status === "approved").map(c => <option key={c.id} value={c.id}>{c.number} — {c.title}</option>)}
            </Select>
          )}
          {canCreate && <Button onClick={() => openNew()}><IconPlus size={14}/> New Quotation</Button>}
        </div>
      </div>

      <Card>
        <Table>
          <thead><tr><Th>#</Th><Th>Date</Th><Th>Customer</Th><Th>Items</Th><Th>Total</Th><Th>Status</Th><Th>Owner</Th><Th></Th></tr></thead>
          <tbody>
            {list.map(q => {
              const t = calcDocTotals(q.items);
              return (
                <tr key={q.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-mono text-xs">{q.number}</Td>
                  <Td>{q.date}</Td>
                  <Td>{db.parties.find(p => p.id === q.customerId)?.name}</Td>
                  <Td>{q.items.length}</Td>
                  <Td className="font-semibold">{fmtINR(t.total)}</Td>
                  <Td>
                    <Select disabled={!canEdit} value={q.status} onChange={(e: any) => {
                      setDB(d => ({ ...d, quotations: d.quotations.map(x => x.id === q.id ? {...x, status: e.target.value} : x) }));
                      log(`Status of ${q.number} → ${e.target.value}`, "Quotations");
                    }} className="text-xs py-1">
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </Td>
                  <Td className="text-xs">{db.users.find(u => u.id === q.ownerId)?.name}</Td>
                  <Td>
                    <div className="flex gap-1 flex-wrap">
                      {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(q)}><IconEdit size={14}/></Button>}
                      {canPrint && <Button size="sm" variant="ghost" onClick={() => printQ(q)}><IconPrint size={14}/></Button>}
                      {userCan(currentUser, "proformas", "create") && <Button size="sm" variant="outline" onClick={() => convert(q, "proforma")} title="Convert to Proforma"><IconFile size={12}/> PI</Button>}
                      {userCan(currentUser, "salesorders", "create") && <Button size="sm" variant="outline" onClick={() => convert(q, "salesorder")} title="Convert to Sales Order">SO</Button>}
                      {canDelete && <Button size="sm" variant="ghost" onClick={() => remove(q)}><IconTrash size={14}/></Button>}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {list.length === 0 && <Empty title="No quotations yet"/>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit ${edit.number}` : "New Quotation"} size="xl">
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label>Quotation No.</Label><Input value={form.number} disabled/></div>
          <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e: any) => setForm({...form, date: e.target.value})}/></div>
          <div><Label>Customer *</Label>
            <Select value={form.customerId} onChange={(e: any) => setForm({...form, customerId: e.target.value})}>
              <option value="">— Select —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
        </div>

        <div className="mt-3 border border-slate-200 dark:border-slate-700 rounded-lg overflow-visible">
          <Table>
            <thead><tr><Th>Item Name / Description</Th><Th>Qty</Th><Th>Rate</Th><Th>GST%</Th><Th>Amount</Th><Th></Th></tr></thead>
            <tbody>
              {form.items.map((it, i) => {
                const finishedGoods = db.items.filter(x => x.category === "Finished Goods");
                return (
                <tr key={i}>
                  <Td className="min-w-[280px]">
                    <Label>Item Name</Label>
                    <FinishedGoodCombobox
                      items={finishedGoods}
                      value={it.name}
                      onPick={(fg) => pickFinishedGood(i, fg)}
                      testId={`quot-item-combo-${i}`}
                    />
                    <Label className="mt-2">Description</Label>
                    <Textarea rows={2} value={it.description || ""} placeholder="11/0.433 kV, Copper Wound, Outdoor Type, Oil Immersed, ONAN Cooling, BIS Compliant, Complete with Standard Accessories." onChange={(e: any) => updateItem(i, "description", e.target.value)}/>
                  </Td>
                  <Td><Input type="number" value={it.qty} onChange={(e: any) => updateItem(i, "qty", e.target.value)}/></Td>
                  <Td><Input type="number" value={it.rate} onChange={(e: any) => updateItem(i, "rate", e.target.value)}/></Td>
                  <Td><Select value={it.gst} onChange={(e: any) => updateItem(i, "gst", e.target.value)}>{GST_OPTIONS.map(rate => <option key={rate} value={rate}>{rate}%</option>)}</Select></Td>
                  <Td className="font-medium">{fmtINR(it.qty * it.rate)}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => delItem(i)}><IconTrash size={14}/></Button></Td>
                </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
        <div className="mt-2"><Button size="sm" variant="outline" onClick={addItem}><IconPlus size={14}/> Add Item</Button></div>

        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="mb-0">Editable Default Terms & Conditions</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setForm({...form, terms: getDefaultQuotationTerms(db.settings)})}>Load Default Terms</Button>
                {currentUser?.role === "admin" && <Button type="button" size="sm" variant="outline" onClick={saveAsDefaultTerms}>Save as Default</Button>}
              </div>
            </div>
            <Textarea key={form.number} rows={8} value={form.terms} onChange={(e: any) => setForm({...form, terms: e.target.value})}/>
            <p className="mt-1 text-xs text-slate-500">These terms print on the quotation PDF and can be changed for this quotation. Admin can save them as the default quotation terms.</p>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40 text-sm space-y-1 self-start">
            <div className="flex justify-between"><span>Sub Total</span><b>{fmtINR(totals.sub)}</b></div>
            <div className="flex justify-between"><span>GST</span><b>{fmtINR(totals.gst)}</b></div>
            <div className="flex justify-between text-base border-t pt-1 mt-1"><span>Grand Total</span><b className="text-emerald-600">{fmtINR(totals.total)}</b></div>
            <div className="mt-2"><Label>Status</Label>
              <Select value={form.status} onChange={(e: any) => setForm({...form, status: e.target.value})}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save}>{edit ? "Update" : "Create"}</Button>
        </div>
      </Modal>
    </div>
  );
}
