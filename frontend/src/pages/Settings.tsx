import { useState } from "react";
import { useStore } from "../lib/store";
import { Card, Button, Input, Label, Textarea } from "../components/ui";
import { IconCheck } from "../components/icons";
import { seedDB } from "../lib/seed";

export function Settings() {
  const { db, setDB, log } = useStore();
  const [s, setS] = useState(db.settings);
  const [saved, setSaved] = useState(false);

  const uploadLogo = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return alert("Please upload an image file.");
    const reader = new FileReader();
    reader.onload = () => setS(prev => ({ ...prev, logoUrl: String(reader.result || "") }));
    reader.readAsDataURL(file);
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
              {s.logoUrl ? <img src={s.logoUrl} alt="Company logo" className="h-full w-full object-contain bg-white" /> : s.logoText || "AE"}
            </div>
            <div className="flex-1">
              <div className="font-semibold text-slate-800 dark:text-slate-100">Company Logo</div>
              <p className="text-xs text-slate-500 mb-2">Upload PNG, JPG, SVG, or WebP logo. It will sync with company settings.</p>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 cursor-pointer bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800">
                  Upload Logo
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
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
