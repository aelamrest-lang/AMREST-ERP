import { useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty, Textarea } from "../components/ui";
import type { PurchaseOrder, GRN } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint } from "../components/icons";
import { fmtINR, nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

const DEFAULT_PO_TERMS = `1. Material should be as per specification.
2. Delivery within committed date.
3. Test certificate mandatory.
4. GST and transport terms as mutually agreed.
5. Material will be subject to quality inspection at our works.`;

function getDefaultPurchaseTerms(settings: any) {
  const format = (settings.documentFormats || []).find((f: any) => f.active && f.documentType === "Purchase Order");
  const terms = (format?.terms || []).filter((t: any) => t.active).sort((a: any, b: any) => a.order - b.order);
  return terms.length ? terms.map((t: any, i: number) => `${i + 1}. ${t.text}`).join("\n") : DEFAULT_PO_TERMS;
}

export function PurchaseOrders() {
  const { db, setDB, log, currentUser } = useStore();
  const canCreate = userCan(currentUser, "purchase", "create");
  const canEdit = userCan(currentUser, "purchase", "edit");
  const canDelete = userCan(currentUser, "purchase", "delete");
  const canApprove = userCan(currentUser, "purchase", "approve");
  const canPrint = userCan(currentUser, "purchase", "print");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<PurchaseOrder | null>(null);
  const [itemSearch, setItemSearch] = useState<Record<number, string>>({});

  const vendors = db.parties.filter(p => p.type === "vendor" || p.type === "supplier");

  const blank = (): PurchaseOrder => ({
    id: "", number: nextNumber("PO", db.purchaseOrders), date: todayISO(), vendorId: vendors[0]?.id || "",
    items: [], terms: getDefaultPurchaseTerms(db.settings), status: "Draft", createdAt: new Date().toISOString(),
  });
  const [form, setForm] = useState<PurchaseOrder>(blank());

  const openNew = () => { setEdit(null); setForm(blank()); setItemSearch({}); setOpen(true); };
  const openEdit = (p: PurchaseOrder) => { setEdit(p); setForm({...p, terms: p.terms || getDefaultPurchaseTerms(db.settings), items: p.items.map(i => ({...i}))}); setItemSearch({}); setOpen(true); };
  const save = () => {
    if (edit) setDB(d => ({...d, purchaseOrders: d.purchaseOrders.map(x => x.id === edit.id ? form : x)}));
    else setDB(d => ({...d, purchaseOrders: [{...form, id: uid()}, ...d.purchaseOrders]}));
    log(`${edit ? "Updated" : "Created"} PO ${form.number}`, "Purchase");
    setOpen(false);
  };
  const remove = (p: PurchaseOrder) => {
    if (!confirm(`Delete ${p.number}?`)) return;
    setDB(d => ({...d, purchaseOrders: d.purchaseOrders.filter(x => x.id !== p.id)}));
    log(`Deleted PO ${p.number}`, "Purchase");
  };
  const addItem = () => setForm(f => ({...f, items: [...f.items, { itemId: db.items[0]?.id || "", qty: 1, rate: 0, description: "" }]}));
  const updateItem = (i: number, key: string, val: any) => setForm(f => ({...f, items: f.items.map((it, idx) => idx === i ? {...it, [key]: key === "itemId" || key === "description" ? val : Number(val)} : it)}));
  const delItem = (i: number) => setForm(f => ({...f, items: f.items.filter((_, idx) => idx !== i)}));
  const total = form.items.reduce((s, i) => s + i.qty * i.rate, 0);

  const matchesItemSearch = (item: any, query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const haystack = `${item.name} ${item.code} ${item.category} ${item.unit}`.toLowerCase();
    return q.split(/\s+/).every(term => haystack.includes(term));
  };

  const handleItemType = (rowIndex: number, value: string) => {
    setItemSearch(prev => ({ ...prev, [rowIndex]: value }));
    const match = db.items.find(item =>
      item.name.toLowerCase() === value.toLowerCase() || item.code.toLowerCase() === value.toLowerCase()
    );
    if (match) {
      updateItem(rowIndex, "itemId", match.id);
      updateItem(rowIndex, "rate", match.purchaseRate);
    }
  };

  const saveAsDefaultTerms = () => {
    const lines = (form.terms || "").split("\n").map(x => x.replace(/^\s*\d+[.)-]?\s*/, "").trim()).filter(Boolean);
    if (!lines.length) return alert("Enter at least one term to save as default.");
    const now = new Date().toISOString();
    setDB(d => {
      const existing = d.settings.documentFormats || [];
      const poFormat = existing.find((f: any) => f.documentType === "Purchase Order");
      const updatedFormat = {
        ...(poFormat || {
          id: uid(), documentType: "Purchase Order", formatName: "Purchase Order Standard Format", active: true,
          companyName: d.settings.name, address: d.settings.address, gstNo: d.settings.gst,
          contactDetails: `${d.settings.email} | ${d.settings.phone}`, headerContent: "", footerContent: "",
          bankDetails: "", declaration: "", signatureName: "Authorized Signatory", qrCode: true,
          pageSize: "A4", orientation: "Portrait", createdAt: now,
        }),
        active: true,
        terms: lines.map((text, index) => ({ id: `purchase-term-${index + 1}`, text, active: true, order: index + 1 })),
        updatedAt: now,
      };
      return {
        ...d,
        settings: {
          ...d.settings,
          documentFormats: poFormat
            ? existing.map((f: any) => f.id === poFormat.id ? updatedFormat : f)
            : [updatedFormat as any, ...existing],
        },
      };
    });
    log("Updated default purchase order terms", "Purchase");
    alert("Default purchase order terms saved.");
  };

  const printPO = (p: PurchaseOrder) => {
    const v = db.parties.find(x => x.id === p.vendorId);
    const t = p.items.reduce((s, i) => s + i.qty * i.rate, 0);
    const body = `
      <div class="box"><div class="section-title">Vendor Details</div><b>${v?.name}</b><br/>${v?.address}<br/>GST: ${v?.gst || ""}<br/>Contact: ${v?.mobile || ""} | ${v?.email || ""}</div>
      <div class="box"><span class="badge">${p.status}</span></div>
      <table><thead><tr><th>#</th><th>Item</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead>
      <tbody>${p.items.map((i, idx) => { const it = db.items.find(x => x.id === i.itemId); return `<tr><td>${idx+1}</td><td><b>${it?.name || "-"} (${it?.code || ""})</b>${i.description ? `<br/><span class="muted">${i.description}</span>` : ""}</td><td class="right">${i.qty}</td><td class="right">${fmtINR(i.rate)}</td><td class="right">${fmtINR(i.qty*i.rate)}</td></tr>`; }).join("")}</tbody></table>
      <div class="totals"><div class="grand"><span>Total</span><b>${fmtINR(t)}</b></div></div>
      <div class="box"><div class="section-title">Terms & Conditions</div><pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;margin:6px 0">${p.terms || getDefaultPurchaseTerms(db.settings)}</pre></div>
    `;
    const html = professionalDocument(db.settings, { title: "Purchase Order", number: p.number, date: p.date, body, accent: "#ea580c", skipFormatTerms: true });
    printArea(html, p.number);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">Purchase Orders</h1><p className="text-sm text-slate-500">Procurement from vendors and suppliers</p></div>
        {canCreate && <Button onClick={openNew}><IconPlus size={14}/> New PO</Button>}
      </div>
      <Card>
        <Table>
          <thead><tr><Th>#</Th><Th>Date</Th><Th>Vendor</Th><Th>Items</Th><Th>Total</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {db.purchaseOrders.map(p => {
              const t = p.items.reduce((s, i) => s + i.qty * i.rate, 0);
              return (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-mono text-xs">{p.number}</Td>
                  <Td>{p.date}</Td>
                  <Td>{db.parties.find(v => v.id === p.vendorId)?.name}</Td>
                  <Td>{p.items.length}</Td>
                  <Td className="font-semibold">{fmtINR(t)}</Td>
                  <Td>
                    <Select disabled={!canEdit && !canApprove} value={p.status} onChange={(e: any) => {
                      setDB(d => ({...d, purchaseOrders: d.purchaseOrders.map(x => x.id === p.id ? {...x, status: e.target.value} : x)}));
                      log(`PO ${p.number} → ${e.target.value}`, "Purchase");
                    }} className="text-xs py-1">
                      <option>Draft</option><option>Approved</option><option>Received</option><option>Cancelled</option>
                    </Select>
                  </Td>
                  <Td><div className="flex gap-1">
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(p)}><IconEdit size={14}/></Button>}
                    {canPrint && <Button size="sm" variant="ghost" onClick={() => printPO(p)}><IconPrint size={14}/></Button>}
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => remove(p)}><IconTrash size={14}/></Button>}
                  </div></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {db.purchaseOrders.length === 0 && <Empty/>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit ${edit.number}` : "New Purchase Order"} size="xl">
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label>PO No.</Label><Input value={form.number} disabled/></div>
          <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e: any) => setForm({...form, date: e.target.value})}/></div>
          <div><Label>Vendor</Label>
            <Select value={form.vendorId} onChange={(e: any) => setForm({...form, vendorId: e.target.value})}>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </div>
        </div>
        <div className="mt-3 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <Table>
            <thead><tr><Th>Item</Th><Th>Qty</Th><Th>Rate</Th><Th>Amount</Th><Th></Th></tr></thead>
            <tbody>{form.items.map((it, i) => (
              <tr key={i}>
                <Td>
                  <Input
                    className="mb-1"
                    value={itemSearch[i] ?? ""}
                    list={`po-item-suggestions-${i}`}
                    placeholder="Type item name/code e.g. COPPER, 100 KVA, 11KV, CT COIL"
                    onChange={(e: any) => handleItemType(i, e.target.value)}
                  />
                  <datalist id={`po-item-suggestions-${i}`}>
                    {db.items.filter(x => matchesItemSearch(x, itemSearch[i] || "")).slice(0, 25).map(x => <option key={`${x.id}-name`} value={x.name}>{x.code} - {x.category} - {x.unit}</option>)}
                    {db.items.filter(x => matchesItemSearch(x, itemSearch[i] || "")).slice(0, 25).map(x => <option key={`${x.id}-code`} value={x.code}>{x.name} - {x.category} - {x.unit}</option>)}
                  </datalist>
                  <Select value={it.itemId} onChange={(e: any) => {
                    const selected = db.items.find(x => x.id === e.target.value);
                    updateItem(i, "itemId", e.target.value);
                    if (selected) {
                      updateItem(i, "rate", selected.purchaseRate);
                      setItemSearch(prev => ({ ...prev, [i]: selected.name }));
                    }
                  }}>
                    {db.items.filter(x => matchesItemSearch(x, itemSearch[i] || "")).map(x => <option key={x.id} value={x.id}>{x.name} ({x.code}) - {x.unit}</option>)}
                  </Select>
                  <Input
                    className="mt-2"
                    value={it.description || ""}
                    placeholder="Item Description"
                    onChange={(e: any) => updateItem(i, "description", e.target.value)}
                  />
                </Td>
                <Td><Input type="number" value={it.qty} onChange={(e: any) => updateItem(i, "qty", e.target.value)}/></Td>
                <Td><Input type="number" value={it.rate} onChange={(e: any) => updateItem(i, "rate", e.target.value)}/></Td>
                <Td>{fmtINR(it.qty * it.rate)}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => delItem(i)}><IconTrash size={14}/></Button></Td>
              </tr>
            ))}</tbody>
          </Table>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <Button size="sm" variant="outline" onClick={addItem}><IconPlus size={14}/> Add Item</Button>
          <div className="text-base font-semibold">Total: <span className="text-emerald-600">{fmtINR(total)}</span></div>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <Label className="mb-0">Editable Default Terms & Conditions</Label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setForm({...form, terms: getDefaultPurchaseTerms(db.settings)})}>Load Default Terms</Button>
              {currentUser?.role === "admin" && <Button type="button" size="sm" variant="outline" onClick={saveAsDefaultTerms}>Save as Default</Button>}
            </div>
          </div>
          <Textarea rows={7} value={form.terms || ""} onChange={(e: any) => setForm({...form, terms: e.target.value})}/>
          <p className="mt-1 text-xs text-slate-500">These terms print on the Purchase Order PDF and can be changed for this PO. Admin can save them as default PO terms.</p>
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>{edit ? "Update" : "Create"}</Button></div>
      </Modal>
    </div>
  );
}

export function GRNPage() {
  const { db, setDB, log, currentUser } = useStore();
  const canCreate = userCan(currentUser, "grn", "create");
  const [open, setOpen] = useState(false);
  const [poId, setPoId] = useState<string>(db.purchaseOrders[0]?.id || "");
  const po = db.purchaseOrders.find(p => p.id === poId);
  const [received, setReceived] = useState<{ itemId: string; qty: number }[]>([]);
  const [qcPassed, setQcPassed] = useState(true);

  const openNew = () => {
    if (!po) return alert("No PO available");
    setPoId(po.id);
    setReceived(po.items.map(i => ({ itemId: i.itemId, qty: i.qty })));
    setQcPassed(true);
    setOpen(true);
  };

  const save = () => {
    const grn: GRN = {
      id: uid(), number: nextNumber("GRN", db.grns), date: todayISO(),
      poId, receivedItems: received, qcPassed, createdAt: new Date().toISOString(),
    };
    setDB(d => {
      const items = d.items.map(it => {
        const r = received.find(x => x.itemId === it.id);
        return r ? {...it, currentStock: it.currentStock + r.qty} : it;
      });
      return {
        ...d, grns: [grn, ...d.grns], items,
        purchaseOrders: d.purchaseOrders.map(p => p.id === poId ? {...p, status: "Received"} : p),
      };
    });
    log(`GRN ${grn.number} created (PO ${po?.number})`, "GRN");
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">Goods Receipt Notes (GRN)</h1><p className="text-sm text-slate-500">Receive against PO and auto-update inventory</p></div>
        {canCreate && <Button onClick={openNew}><IconPlus size={14}/> New GRN</Button>}
      </div>
      <Card>
        <Table>
          <thead><tr><Th>#</Th><Th>Date</Th><Th>PO</Th><Th>Items</Th><Th>QC</Th></tr></thead>
          <tbody>
            {db.grns.map(g => {
              const p = db.purchaseOrders.find(x => x.id === g.poId);
              return (
                <tr key={g.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-mono text-xs">{g.number}</Td>
                  <Td>{g.date}</Td>
                  <Td>{p?.number} — {db.parties.find(v => v.id === p?.vendorId)?.name}</Td>
                  <Td>{g.receivedItems.length} items</Td>
                  <Td><Badge color={g.qcPassed ? "green" : "red"}>{g.qcPassed ? "Passed" : "Failed"}</Badge></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {db.grns.length === 0 && <Empty title="No GRN yet" subtitle="Create a GRN against an Approved PO"/>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New Goods Receipt Note" size="lg">
        <div className="space-y-3">
          <div><Label>Select PO</Label>
            <Select value={poId} onChange={(e: any) => {
              setPoId(e.target.value);
              const newPo = db.purchaseOrders.find(x => x.id === e.target.value);
              if (newPo) setReceived(newPo.items.map(i => ({ itemId: i.itemId, qty: i.qty })));
            }}>
              {db.purchaseOrders.map(p => <option key={p.id} value={p.id}>{p.number} — {db.parties.find(v => v.id === p.vendorId)?.name}</option>)}
            </Select>
          </div>
          <Table>
            <thead><tr><Th>Item</Th><Th>Ordered</Th><Th>Received Now</Th></tr></thead>
            <tbody>
              {po?.items.map((oi, idx) => {
                const it = db.items.find(x => x.id === oi.itemId);
                const r = received.find(x => x.itemId === oi.itemId);
                return (
                  <tr key={idx}>
                    <Td>{it?.name}</Td>
                    <Td>{oi.qty} {it?.unit}</Td>
                    <Td>
                      <Input type="number" value={r?.qty || 0} onChange={(e: any) => {
                        const q = Number(e.target.value);
                        setReceived(prev => prev.map(x => x.itemId === oi.itemId ? {...x, qty: q} : x));
                      }}/>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={qcPassed} onChange={e => setQcPassed(e.target.checked)} className="rounded"/>
            Quality Check Passed
          </label>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Receive & Update Stock</Button></div>
        </div>
      </Modal>
    </div>
  );
}
