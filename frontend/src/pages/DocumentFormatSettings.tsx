import { useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Badge, Button, Card, Empty, Input, Label, Select, Table, Td, Textarea, Th } from "../components/ui";
import type { DocumentFormat, DocumentTerm } from "../lib/types";
import { IconCheck, IconEdit, IconPlus, IconPrint, IconTrash } from "../components/icons";
import { printArea, professionalDocument, todayISO } from "../lib/utils";

const DOCUMENT_TYPES = ["Quotation", "Proforma Invoice", "Sales Order", "Purchase Order", "Job Card", "Delivery Challan", "Tax Invoice", "QC Test Report", "Inspection Certificate"];

export function DocumentFormatSettings() {
  const { db, setDB, currentUser, log } = useStore();
  const isAdmin = currentUser?.role === "admin";
  const formats = db.settings.documentFormats || [];
  const [selectedId, setSelectedId] = useState(formats[0]?.id || "");
  const selected = useMemo(() => formats.find(f => f.id === selectedId) || formats[0], [formats, selectedId]);
  const [saved, setSaved] = useState(false);

  const saveFormats = (nextFormats: DocumentFormat[]) => {
    setDB(d => ({ ...d, settings: { ...d.settings, documentFormats: nextFormats } }));
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const updateSelected = (patch: Partial<DocumentFormat>) => {
    if (!selected || !isAdmin) return;
    const next = formats.map(f => f.id === selected.id ? { ...f, ...patch, updatedAt: new Date().toISOString() } : f);
    saveFormats(next);
  };

  const upload = (field: "logoUrl" | "signatureUrl", file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return alert("Please select an image file.");
    const reader = new FileReader();
    reader.onload = () => updateSelected({ [field]: String(reader.result || "") } as any);
    reader.readAsDataURL(file);
  };

  const addFormat = () => {
    const type = DOCUMENT_TYPES[0];
    const now = new Date().toISOString();
    const fmt: DocumentFormat = {
      id: uid(), documentType: type, formatName: `${type} Custom Format`, active: true,
      companyName: db.settings.name, address: db.settings.address, gstNo: db.settings.gst,
      contactDetails: `${db.settings.email} | ${db.settings.phone}`, headerContent: "", footerContent: "",
      terms: [], bankDetails: "", declaration: "", signatureName: "Authorized Signatory",
      qrCode: true, watermark: "", fitToSinglePage: false, pageSize: "A4", orientation: "Portrait", createdAt: now, updatedAt: now,
    };
    saveFormats([fmt, ...formats]);
    setSelectedId(fmt.id);
    log("Created document format", "Document Format Settings");
  };

  const deleteFormat = (id: string) => {
    if (!confirm("Delete this document format?")) return;
    const next = formats.filter(f => f.id !== id);
    saveFormats(next);
    setSelectedId(next[0]?.id || "");
  };

  const addTerm = () => {
    if (!selected) return;
    const term: DocumentTerm = { id: uid(), text: "New term", active: true, order: (selected.terms?.length || 0) + 1 };
    updateSelected({ terms: [...(selected.terms || []), term] });
  };

  const updateTerm = (id: string, patch: Partial<DocumentTerm>) => {
    if (!selected) return;
    updateSelected({ terms: selected.terms.map(t => t.id === id ? { ...t, ...patch } : t) });
  };

  const moveTerm = (id: string, dir: -1 | 1) => {
    if (!selected) return;
    const arr = [...selected.terms].sort((a, b) => a.order - b.order);
    const idx = arr.findIndex(t => t.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= arr.length) return;
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    updateSelected({ terms: arr.map((t, i) => ({ ...t, order: i + 1 })) });
  };

  const preview = () => {
    if (!selected) return;
    const body = `<div class="box"><div class="section-title">Live Preview</div>This preview shows logo, header, footer, terms, bank details, declaration, QR code, signature and watermark for <b>${selected.documentType}</b>.</div><table><thead><tr><th>#</th><th>Description</th><th class="right">Qty</th><th class="right">Amount</th></tr></thead><tbody><tr><td>1</td><td>Sample Item</td><td class="right">1</td><td class="right">1000.00</td></tr></tbody></table>`;
    const settings = { ...db.settings, documentFormats: [selected] };
    printArea(professionalDocument(settings, { title: selected.documentType, number: `PREVIEW-${todayISO()}`, date: todayISO(), body }), selected.formatName);
  };

  if (!isAdmin) return <Card><Empty title="Admin access required" subtitle="Only Admin can edit document formats." /></Card>;

  return <div className="space-y-4">
    <div className="flex justify-between gap-3 flex-wrap"><div><h1 className="text-2xl font-bold">Document Format Settings</h1><p className="text-sm text-slate-500">Manage print/PDF formats, terms, bank details, signatures and layouts.</p></div><div className="flex gap-2">{saved && <span className="text-sm text-emerald-600 flex items-center gap-1"><IconCheck size={14}/> Auto-saved</span>}<Button onClick={addFormat}><IconPlus size={14}/> New Format</Button><Button variant="outline" onClick={preview}><IconPrint size={14}/> Preview Format</Button></div></div>
    <div className="grid xl:grid-cols-[360px_1fr] gap-4"><Card><div className="p-4 border-b border-slate-100 dark:border-slate-800 font-semibold">Available Formats</div><div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[680px] overflow-y-auto">{formats.map(f => <button key={f.id} onClick={() => setSelectedId(f.id)} className={`w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${selected?.id === f.id ? "bg-indigo-50 dark:bg-indigo-900/20" : ""}`}><div className="flex justify-between gap-2"><div className="font-semibold">{f.formatName}</div><Badge color={f.active ? "green" : "slate"}>{f.active ? "Active" : "Inactive"}</Badge></div><div className="text-xs text-slate-500 mt-1">{f.documentType}</div></button>)}</div></Card>
      {selected && <Card><div className="p-5 grid sm:grid-cols-2 gap-3"><div><Label>Document Type</Label><Select value={selected.documentType} onChange={(e:any)=>updateSelected({documentType:e.target.value})}>{DOCUMENT_TYPES.map(t => <option key={t}>{t}</option>)}</Select></div><div><Label>Format Name</Label><Input value={selected.formatName} onChange={(e:any)=>updateSelected({formatName:e.target.value})}/></div><div><Label>Company Name</Label><Input value={selected.companyName} onChange={(e:any)=>updateSelected({companyName:e.target.value})}/></div><div><Label>GST No</Label><Input value={selected.gstNo} onChange={(e:any)=>updateSelected({gstNo:e.target.value})}/></div><div className="sm:col-span-2"><Label>Address</Label><Textarea rows={2} value={selected.address} onChange={(e:any)=>updateSelected({address:e.target.value})}/></div><div className="sm:col-span-2"><Label>Contact Details</Label><Input value={selected.contactDetails} onChange={(e:any)=>updateSelected({contactDetails:e.target.value})}/></div><div><Label>Company Logo</Label><input type="file" accept="image/*" onChange={e=>upload("logoUrl", e.target.files?.[0])} className="block w-full text-sm" />{selected.logoUrl && <img src={selected.logoUrl} className="mt-2 h-14 object-contain"/>}</div><div><Label>Signature Upload</Label><input type="file" accept="image/*" onChange={e=>upload("signatureUrl", e.target.files?.[0])} className="block w-full text-sm" />{selected.signatureUrl && <img src={selected.signatureUrl} className="mt-2 h-14 object-contain"/>}</div><div><Label>Signature Name</Label><Input value={selected.signatureName} onChange={(e:any)=>updateSelected({signatureName:e.target.value})}/></div><div><Label>Watermark</Label><Input value={selected.watermark || ""} onChange={(e:any)=>updateSelected({watermark:e.target.value})}/></div><div><Label>Page Size</Label><Select value={selected.pageSize} onChange={(e:any)=>updateSelected({pageSize:e.target.value})}><option>A4</option><option>A5</option></Select></div><div><Label>Orientation</Label><Select value={selected.orientation} onChange={(e:any)=>updateSelected({orientation:e.target.value})}><option>Portrait</option><option>Landscape</option></Select></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.qrCode} onChange={e=>updateSelected({qrCode:e.target.checked})}/> QR Code Option</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.fitToSinglePage || false} onChange={e=>updateSelected({fitToSinglePage:e.target.checked})}/> Fit PDF to Single Page</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.active} onChange={e=>updateSelected({active:e.target.checked})}/> Active Format</label><div className="sm:col-span-2"><Label>Header Content</Label><Textarea rows={2} value={selected.headerContent} onChange={(e:any)=>updateSelected({headerContent:e.target.value})}/></div><div className="sm:col-span-2"><Label>Footer Content</Label><Textarea rows={2} value={selected.footerContent} onChange={(e:any)=>updateSelected({footerContent:e.target.value})}/></div><div className="sm:col-span-2"><Label>Bank Details</Label><Textarea rows={3} value={selected.bankDetails} onChange={(e:any)=>updateSelected({bankDetails:e.target.value})}/></div><div className="sm:col-span-2"><Label>Declaration</Label><Textarea rows={2} value={selected.declaration} onChange={(e:any)=>updateSelected({declaration:e.target.value})}/></div></div><div className="px-5 pb-5"><div className="flex justify-between items-center mb-2"><h3 className="font-semibold">Terms & Conditions</h3><Button size="sm" variant="outline" onClick={addTerm}><IconPlus size={14}/> Add Term</Button></div><Table><thead><tr><Th>#</Th><Th>Term</Th><Th>Active</Th><Th>Move</Th><Th></Th></tr></thead><tbody>{selected.terms.sort((a,b)=>a.order-b.order).map(term => <tr key={term.id}><Td>{term.order}</Td><Td><Input value={term.text} onChange={(e:any)=>updateTerm(term.id,{text:e.target.value})}/></Td><Td><input type="checkbox" checked={term.active} onChange={e=>updateTerm(term.id,{active:e.target.checked})}/></Td><Td><div className="flex gap-1"><Button size="sm" variant="outline" onClick={()=>moveTerm(term.id,-1)}>Up</Button><Button size="sm" variant="outline" onClick={()=>moveTerm(term.id,1)}>Down</Button></div></Td><Td><Button size="sm" variant="ghost" onClick={()=>updateSelected({terms:selected.terms.filter(t=>t.id!==term.id)})}><IconTrash size={14}/></Button></Td></tr>)}</tbody></Table><div className="mt-4 flex justify-end gap-2"><Button variant="danger" onClick={()=>deleteFormat(selected.id)}><IconTrash size={14}/> Delete Format</Button><Button onClick={preview}><IconEdit size={14}/> Preview Format</Button></div></div></Card>}
    </div>
  </div>;
}