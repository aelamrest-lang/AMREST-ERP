import { useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Label, Textarea, Modal, Table, Th, Td, Badge } from "../components/ui";
import { IconCheck, IconPlus, IconEdit, IconTrash } from "../components/icons";
import { seedDB } from "../lib/seed";
import { uploadFile, fileDisplayUrl } from "../lib/upload";
import type { SellingCompany } from "../lib/types";

function SellingCompaniesCard() {
  const { db, setDB, log } = useStore();
  const companies = db.settings.companies || [];
  const blankCo = (): SellingCompany => ({ id: "", name: "", address: "", gst: "", email: "", phone: "", bankDetails: "", logo: "" });
  const [form, setForm] = useState<SellingCompany>(blankCo());
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const openNew = () => { setForm(blankCo()); setOpen(true); };
  const openEdit = (c: SellingCompany) => { setForm({ ...c }); setOpen(true); };
  const save = () => {
    if (!form.name.trim()) return alert("Company name is required");
    setDB(d => {
      const list = d.settings.companies || [];
      const exists = list.some(c => c.id === form.id);
      const companies = exists ? list.map(c => c.id === form.id ? form : c) : [...list, { ...form, id: uid() }];
      return { ...d, settings: { ...d.settings, companies } };
    });
    log(`${form.id ? "Updated" : "Added"} selling company ${form.name}`, "Settings");
    setOpen(false);
  };
  const remove = (c: SellingCompany) => {
    const used = db.quotations.filter(q => q.companyId === c.id).length;
    if (!confirm(`Delete selling company "${c.name}"?${used ? ` ${used} quotation(s) reference it and will fall back to the main company.` : ""}`)) return;
    setDB(d => ({ ...d, settings: { ...d.settings, companies: (d.settings.companies || []).filter(x => x.id !== c.id) } }));
    log(`Deleted selling company ${c.name}`, "Settings");
  };
  const uploadLogo = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return alert("Please upload an image file.");
    setUploading(true);
    try {
      const res = await uploadFile(file, "selling-company-logo");
      setForm(prev => ({ ...prev, logo: res.url }));
    } catch (e: any) {
      alert("Logo upload failed: " + (e?.message || "unknown error"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold">Selling Companies</h3>
          <p className="text-xs text-slate-500">Multiple companies you can quote/sell under — logo & details auto-appear on their quotations</p>
        </div>
        <Button onClick={openNew} data-testid="sc-add"><IconPlus size={14}/> Add Company</Button>
      </div>
      <Table>
        <thead><tr><Th>Logo</Th><Th>Company</Th><Th>GST/VAT</Th><Th>Contact</Th><Th>Quotations</Th><Th></Th></tr></thead>
        <tbody>
          {companies.map(c => (
            <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <Td>{c.logo ? <img src={fileDisplayUrl(c.logo)} alt={c.name} className="h-9 w-9 object-contain rounded bg-white border border-slate-200"/> : <div className="h-9 w-9 rounded bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">{c.name.slice(0, 2).toUpperCase()}</div>}</Td>
              <Td><div className="font-medium">{c.name}</div><div className="text-xs text-slate-500 max-w-56 truncate">{c.address}</div></Td>
              <Td className="text-xs font-mono">{c.gst || "—"}</Td>
              <Td className="text-xs">{c.email || "—"}{c.phone ? <div>{c.phone}</div> : null}</Td>
              <Td><Badge color="blue">{db.quotations.filter(q => q.companyId === c.id).length}</Badge></Td>
              <Td>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(c)} data-testid={`sc-edit-${c.id}`}><IconEdit size={14}/></Button>
                  <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(c)} data-testid={`sc-delete-${c.id}`}><IconTrash size={14}/></Button>
                </div>
              </Td>
            </tr>
          ))}
          {companies.length === 0 && <tr><Td {...{ colSpan: 6 }}><div className="text-center text-sm text-slate-500 py-4">No selling companies yet — quotations will use the main company profile above</div></Td></tr>}
        </tbody>
      </Table>

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? `Edit Company — ${form.name}` : "Add Selling Company"} size="lg">
        <div className="space-y-3" data-testid="sc-form">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center bg-white">
              {form.logo ? <img src={fileDisplayUrl(form.logo)} alt="logo" className="h-full w-full object-contain"/> : <span className="text-lg font-bold text-indigo-600">{(form.name || "CO").slice(0, 2).toUpperCase()}</span>}
            </div>
            <div>
              <Label>Company Logo</Label>
              <div className="flex gap-2">
                <label className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 cursor-pointer">
                  {uploading ? "Uploading…" : "Upload Logo"}
                  <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => uploadLogo(e.target.files?.[0])} data-testid="sc-logo-upload" />
                </label>
                {form.logo && <Button variant="outline" onClick={() => setForm({ ...form, logo: "" })}>Remove</Button>}
              </div>
            </div>
          </div>
          <div><Label>Company Name *</Label><Input value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} data-testid="sc-name" /></div>
          <div><Label>Address</Label><Textarea rows={2} value={form.address} onChange={(e: any) => setForm({ ...form, address: e.target.value })} data-testid="sc-address" /></div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div><Label>GST / VAT Number</Label><Input value={form.gst} onChange={(e: any) => setForm({ ...form, gst: e.target.value })} data-testid="sc-gst" /></div>
            <div><Label>Email</Label><Input value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} data-testid="sc-email" /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={(e: any) => setForm({ ...form, phone: e.target.value })} data-testid="sc-phone" /></div>
          </div>
          <div><Label>Bank Details</Label><Textarea rows={2} value={form.bankDetails} onChange={(e: any) => setForm({ ...form, bankDetails: e.target.value })} placeholder={"Bank: …\nA/c: …\nIFSC: …"} data-testid="sc-bank" /></div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} data-testid="sc-save">Save Company</Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

export function Settings() {  const { db, setDB, log } = useStore();
  const [s, setS] = useState(db.settings);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);

  const uploadLogo = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return alert("Please upload an image file.");
    setUploading(true);
    try {
      const res = await uploadFile(file, "company-logo");
      setS(prev => ({ ...prev, logoUrl: res.url }));
    } catch (err: any) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const save = () => {
    setDB(d => ({...d, settings: s}));
    log("Updated company settings", "Settings");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const resetData = () => {
    if (!confirm("This will WIPE all data and reset to defaults. Continue?")) return;
    setDB(() => seedDB());
    alert("Supabase ERP data has been reset to defaults.");
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div><h1 className="text-2xl font-bold">Company Settings</h1><p className="text-sm text-slate-500">Manage company profile, GST and invoice settings</p></div>
      <Card>
        <div className="p-5 grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2 flex items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-800/40">
            <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center overflow-hidden text-white font-bold">
              {s.logoUrl ? <img src={fileDisplayUrl(s.logoUrl)} alt="Company logo" className="h-full w-full object-contain bg-white" /> : s.logoText || "AE"}
            </div>
            <div className="flex-1">
              <div className="font-semibold text-slate-800 dark:text-slate-100">Company Logo</div>
              <p className="text-xs text-slate-500 mb-2">Upload PNG, JPG, SVG, or WebP logo. Stored in cloud object storage.</p>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 cursor-pointer bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800">
                  {uploading ? "Uploading..." : "Upload Logo"}
                  <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => uploadLogo(e.target.files?.[0])} data-testid="company-logo-upload" />
                </label>
                {s.logoUrl && <Button variant="outline" onClick={() => setS({...s, logoUrl: ""})}>Remove Logo</Button>}
              </div>
            </div>
          </div>
          <div className="sm:col-span-2"><Label>Company Name</Label><Input value={s.name} onChange={(e: any) => setS({...s, name: e.target.value})}/></div>
          <div className="sm:col-span-2"><Label>Address</Label><Textarea rows={2} value={s.address} onChange={(e: any) => setS({...s, address: e.target.value})}/></div>
          <div><Label>GST Number</Label><Input value={s.gst} onChange={(e: any) => setS({...s, gst: e.target.value})}/></div>
          <div><Label>Phone</Label><Input value={s.phone} onChange={(e: any) => setS({...s, phone: e.target.value})}/></div>
          <div><Label>Email</Label><Input value={s.email} onChange={(e: any) => setS({...s, email: e.target.value})}/></div>
          <div><Label>Logo Initials</Label><Input value={s.logoText} onChange={(e: any) => setS({...s, logoText: e.target.value})}/></div>
          <div><Label>Invoice Prefix</Label><Input value={s.invoicePrefix} onChange={(e: any) => setS({...s, invoicePrefix: e.target.value})}/></div>
          <div><Label>Financial Year Start</Label><Input type="date" value={s.fyStart} onChange={(e: any) => setS({...s, fyStart: e.target.value})}/></div>
        </div>
        <div className="px-5 pb-5 flex items-center justify-between">
          <div className="text-sm text-emerald-600 flex items-center gap-1">{saved && (<><IconCheck size={14}/> Saved successfully</>)}</div>
          <Button onClick={save}>Save Settings</Button>
        </div>
      </Card>

      <SellingCompaniesCard />

      <Card>
        <div className="p-5">
          <h3 className="font-semibold mb-1">Data & Backup</h3>
          <p className="text-sm text-slate-500 mb-3">ERP data is stored in Supabase. Export a backup as JSON, restore a backup, or reset the remote dataset.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => {
              const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `amrest-backup-${new Date().toISOString().slice(0,10)}.json`;
              a.click();
            }}>Download Backup (JSON)</Button>
            <label className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 cursor-pointer">
              Restore Backup
              <input type="file" accept="application/json" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                try {
                  const txt = await f.text();
                  const parsed = JSON.parse(txt);
                  if (!parsed.users) throw new Error("Invalid backup");
                  setDB(() => parsed);
                  alert("Restored successfully.");
                } catch (err: any) { alert("Failed: " + err.message); }
              }}/>
            </label>
            <Button variant="danger" onClick={resetData}>Reset All Data</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
