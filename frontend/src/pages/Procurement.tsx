import { useMemo, useRef, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty, Textarea } from "../components/ui";
import type { PurchaseOrder, GRN, Party } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint, IconSearch } from "../components/icons";
import { fmtINR, nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

const DEFAULT_PO_TERMS = `1. Material should be as per specification.
2. Delivery within committed date.
3. Test certificate mandatory.
4. GST and transport terms as mutually agreed.
5. Material will be subject to quality inspection at our works.`;

function VendorCombobox({
  vendors, value, onChange, placeholder = "Search vendor by name, GST, contact...",
}: {
  vendors: Party[]; value: string; onChange: (id: string) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = vendors.find(v => v.id === value) || null;
  const displayText = open ? query : (selected?.name || "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(v =>
      v.name.toLowerCase().includes(q) ||
      (v.gst || "").toLowerCase().includes(q) ||
      (v.address || "").toLowerCase().includes(q) ||
      (v.mobile || "").toLowerCase().includes(q) ||
      (v.email || "").toLowerCase().includes(q) ||
      (v.contactPerson || "").toLowerCase().includes(q),
    );
  }, [vendors, query]);

  const pick = (v: Party) => {
    onChange(v.id);
    setOpen(false);
    setQuery("");
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(filtered.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlight]) pick(filtered[highlight]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };

  const onBlur = (e: React.FocusEvent) => {
    // Only close if focus leaves the wrapper entirely
    setTimeout(() => {
      if (wrapRef.current && !wrapRef.current.contains(document.activeElement)) {
        setOpen(false);
        setQuery("");
      }
    }, 0);
  };

  return (
    <div className="relative" ref={wrapRef} onBlur={onBlur}>
      <div className="relative">
        <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
        <Input
          className="pl-9"
          value={displayText}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setHighlight(0); }}
          onChange={(e: any) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onKeyDown={handleKey}
          data-testid="po-vendor-combobox"
        />
        {selected && !open && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-rose-500"
            onMouseDown={(e) => { e.preventDefault(); onChange(""); }}
            title="Clear vendor"
          >✕</button>
        )}
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
          {filtered.length === 0 && <div className="p-3 text-sm text-slate-500">No vendors match “{query}”.</div>}
          {filtered.map((v, idx) => (
            <button
              type="button"
              key={v.id}
              onMouseDown={(e) => { e.preventDefault(); pick(v); }}
              onMouseEnter={() => setHighlight(idx)}
              data-testid={`po-vendor-option-${v.id}`}
              className={"w-full text-left px-3 py-2 flex items-start justify-between gap-3 " + (idx === highlight ? "bg-indigo-50 dark:bg-indigo-900/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50")}
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-800 dark:text-slate-100 truncate">{v.name}</div>
                <div className="text-xs text-slate-500 truncate">
                  {[v.contactPerson, v.gst, v.mobile].filter(Boolean).join(" · ") || v.email || v.address || ""}
                </div>
              </div>
              {v.id === value && <span className="text-xs text-indigo-600 font-semibold">Selected</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
                      <option>Draft</option><option>Approved</option><option>Partially Received</option><option>Completed</option><option>Received</option><option>Cancelled</option>
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
            <VendorCombobox
              vendors={vendors}
              value={form.vendorId}
              onChange={(id) => setForm({...form, vendorId: id})}
            />
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

function POCombobox({
  purchaseOrders, parties, value, onChange, placeholder = "Search PO by number, vendor, status...",
}: {
  purchaseOrders: PurchaseOrder[]; parties: Party[]; value: string; onChange: (id: string) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = purchaseOrders.find(p => p.id === value) || null;
  const vendorName = (id: string) => parties.find(v => v.id === id)?.name || "";

  const labelFor = (p: PurchaseOrder) => `${p.number} — ${vendorName(p.vendorId)} (${p.status})`;
  const displayText = open ? query : (selected ? labelFor(selected) : "");

  const statusColor: Record<string, "green" | "amber" | "blue" | "slate" | "red"> = {
    "Completed": "green", "Received": "green", "Partially Received": "amber",
    "Approved": "blue", "Draft": "slate", "Cancelled": "red",
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...purchaseOrders].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    if (!q) return sorted;
    return sorted.filter(p =>
      p.number.toLowerCase().includes(q) ||
      vendorName(p.vendorId).toLowerCase().includes(q) ||
      p.status.toLowerCase().includes(q) ||
      (p.date || "").toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrders, query, parties]);

  const pick = (p: PurchaseOrder) => { onChange(p.id); setOpen(false); setQuery(""); };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(filtered.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlight]) pick(filtered[highlight]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };

  const onBlur = () => {
    setTimeout(() => {
      if (wrapRef.current && !wrapRef.current.contains(document.activeElement)) { setOpen(false); setQuery(""); }
    }, 0);
  };

  return (
    <div className="relative" ref={wrapRef} onBlur={onBlur}>
      <div className="relative">
        <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
        <Input
          className="pl-9"
          value={displayText}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setHighlight(0); }}
          onChange={(e: any) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onKeyDown={handleKey}
          data-testid="grn-po-combobox"
        />
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
          {filtered.length === 0 && <div className="p-3 text-sm text-slate-500">No POs match “{query}”.</div>}
          {filtered.map((p, idx) => (
            <button
              type="button"
              key={p.id}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setHighlight(idx)}
              data-testid={`grn-po-option-${p.number}`}
              className={"w-full text-left px-3 py-2 flex items-center justify-between gap-3 " + (idx === highlight ? "bg-indigo-50 dark:bg-indigo-900/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50")}
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-800 dark:text-slate-100 truncate">
                  <span className="font-mono text-xs mr-2 text-slate-500">{p.number}</span>
                  {vendorName(p.vendorId) || "Unknown Vendor"}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {p.date} · {p.items.length} item{p.items.length !== 1 ? "s" : ""}
                </div>
              </div>
              <Badge color={statusColor[p.status] || "slate"}>{p.status}</Badge>
            </button>
          ))}
        </div>
      )}
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
  const [hideCompleted, setHideCompleted] = useState(true);

  const isFullyReceived = (p: PurchaseOrder): boolean => {
    if (p.status === "Completed" || p.status === "Received" || p.status === "Cancelled") return true;
    const already: Record<string, number> = {};
    db.grns.filter(g => g.poId === p.id).forEach(g => {
      g.receivedItems.forEach(r => { already[r.itemId] = (already[r.itemId] || 0) + (r.qty || 0); });
    });
    return p.items.length > 0 && p.items.every(i => (already[i.itemId] || 0) >= i.qty);
  };

  const visiblePOs = useMemo(() => {
    if (!hideCompleted) return db.purchaseOrders;
    // Keep currently selected PO in list even if it becomes hidden after filtering,
    // so the user isn't confused about a "missing" selection.
    return db.purchaseOrders.filter(p => p.id === poId || !isFullyReceived(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.purchaseOrders, db.grns, hideCompleted, poId]);

  // Sum of already-received quantities per item across all prior GRNs for a given PO
  const alreadyReceivedByItem = (targetPoId: string): Record<string, number> => {
    const acc: Record<string, number> = {};
    db.grns.filter(g => g.poId === targetPoId).forEach(g => {
      g.receivedItems.forEach(r => { acc[r.itemId] = (acc[r.itemId] || 0) + (r.qty || 0); });
    });
    return acc;
  };

  const initReceivedFromPO = (targetPoId: string) => {
    const target = db.purchaseOrders.find(x => x.id === targetPoId);
    if (!target) { setReceived([]); return; }
    const already = alreadyReceivedByItem(targetPoId);
    setReceived(target.items.map(i => ({
      itemId: i.itemId,
      qty: Math.max(0, i.qty - (already[i.itemId] || 0)),
    })));
  };

  const openNew = () => {
    // Prefer a PO that is not yet fully received
    const openPOs = db.purchaseOrders.filter(p => p.status !== "Cancelled" && p.status !== "Draft" && p.status !== "Completed" && p.status !== "Received");
    const target = openPOs[0] || db.purchaseOrders[0];
    if (!target) return alert("No PO available");
    setPoId(target.id);
    initReceivedFromPO(target.id);
    setQcPassed(true);
    setOpen(true);
  };

  const itemStatus = (poQty: number, already: number, receiveNow: number): { label: "Pending" | "Partially Received" | "Completed"; color: "gray" | "amber" | "green" } => {
    const total = already + Math.max(0, receiveNow || 0);
    if (total <= 0) return { label: "Pending", color: "gray" };
    if (total >= poQty) return { label: "Completed", color: "green" };
    return { label: "Partially Received", color: "amber" };
  };

  const save = () => {
    if (!po) return;
    // Filter out zero-qty receipts; guard over-receipt against balance
    const already = alreadyReceivedByItem(po.id);
    const cleaned = received
      .map(r => {
        const line = po.items.find(i => i.itemId === r.itemId);
        if (!line) return null;
        const balance = Math.max(0, line.qty - (already[r.itemId] || 0));
        const q = Math.max(0, Math.min(balance, Number(r.qty) || 0));
        return q > 0 ? { itemId: r.itemId, qty: q } : null;
      })
      .filter(Boolean) as { itemId: string; qty: number }[];

    if (cleaned.length === 0) return alert("Enter at least one non-zero Receive Now quantity.");

    const grn: GRN = {
      id: uid(), number: nextNumber("GRN", db.grns), date: todayISO(),
      poId, receivedItems: cleaned, qcPassed, createdAt: new Date().toISOString(),
    };

    // Determine new PO status
    const cumulativeAfter: Record<string, number> = { ...already };
    cleaned.forEach(r => { cumulativeAfter[r.itemId] = (cumulativeAfter[r.itemId] || 0) + r.qty; });
    const fullyReceived = po.items.every(i => (cumulativeAfter[i.itemId] || 0) >= i.qty);
    const anyReceived = po.items.some(i => (cumulativeAfter[i.itemId] || 0) > 0);
    const nextStatus: PurchaseOrder["status"] = fullyReceived ? "Completed" : (anyReceived ? "Partially Received" : po.status);

    setDB(d => {
      const items = d.items.map(it => {
        const r = cleaned.find(x => x.itemId === it.id);
        return r ? {...it, currentStock: it.currentStock + r.qty} : it;
      });
      return {
        ...d, grns: [grn, ...d.grns], items,
        purchaseOrders: d.purchaseOrders.map(p => p.id === poId ? {...p, status: nextStatus} : p),
      };
    });
    log(`GRN ${grn.number} created (PO ${po?.number}) → PO ${nextStatus}`, "GRN");
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
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label>Select PO</Label>
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none" data-testid="grn-hide-completed-toggle">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={hideCompleted}
                  onChange={e => setHideCompleted(e.target.checked)}
                />
                Hide fully received
              </label>
            </div>
            <POCombobox
              purchaseOrders={visiblePOs}
              parties={db.parties}
              value={poId}
              onChange={(id) => { setPoId(id); initReceivedFromPO(id); }}
            />
            {visiblePOs.length === 0 && (
              <div className="mt-2 text-xs text-slate-500">
                No pending POs. Untick “Hide fully received” to see completed orders.
              </div>
            )}
          </div>
          {po && (() => {
            const already = alreadyReceivedByItem(po.id);
            return (
              <Table>
                <thead><tr><Th>Item</Th><Th>PO Qty</Th><Th>Already Received</Th><Th>Balance</Th><Th>Receive Now</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {po.items.map((oi, idx) => {
                    const it = db.items.find(x => x.id === oi.itemId);
                    const r = received.find(x => x.itemId === oi.itemId);
                    const alr = already[oi.itemId] || 0;
                    const balance = Math.max(0, oi.qty - alr);
                    const now = Math.max(0, Math.min(balance, Number(r?.qty) || 0));
                    const st = itemStatus(oi.qty, alr, now);
                    return (
                      <tr key={idx}>
                        <Td>{it?.name}</Td>
                        <Td>{oi.qty} {it?.unit}</Td>
                        <Td>{alr} {it?.unit}</Td>
                        <Td className="font-semibold">{balance} {it?.unit}</Td>
                        <Td>
                          <Input
                            type="number"
                            min={0}
                            max={balance}
                            disabled={balance === 0}
                            value={r?.qty ?? 0}
                            onChange={(e: any) => {
                              const raw = Number(e.target.value);
                              const q = isNaN(raw) ? 0 : Math.max(0, Math.min(balance, raw));
                              setReceived(prev => {
                                const exists = prev.some(x => x.itemId === oi.itemId);
                                return exists
                                  ? prev.map(x => x.itemId === oi.itemId ? { ...x, qty: q } : x)
                                  : [...prev, { itemId: oi.itemId, qty: q }];
                              });
                            }}
                          />
                        </Td>
                        <Td><Badge color={st.color as any}>{st.label}</Badge></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            );
          })()}
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
