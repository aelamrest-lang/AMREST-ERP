import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
import type { Item } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconSearch, IconDownload } from "../components/icons";
import { downloadCSV, fmtINR } from "../lib/utils";
import { userCan } from "../lib/permissions";

const GST_OPTIONS = [0, 5, 12, 18, 28];

export function Items() {
  const { db, setDB, log, currentUser } = useStore();
  const canCreate = userCan(currentUser, "items", "create");
  const canEdit = userCan(currentUser, "items", "edit");
  const canDelete = userCan(currentUser, "items", "delete");
  const canExport = userCan(currentUser, "items", "export");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<"all" | Item["category"]>("all");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Item | null>(null);
  const [uploadMessage, setUploadMessage] = useState("");

  const items = useMemo(() => {
    let arr = db.items;
    if (cat !== "all") arr = arr.filter(x => x.category === cat);
    if (search) {
      const s = search.toLowerCase();
      arr = arr.filter(x => x.name.toLowerCase().includes(s) || x.code.toLowerCase().includes(s));
    }
    return arr;
  }, [db.items, cat, search]);

  const blank: Item = { id: "", code: "", name: "", category: "Raw Material", unit: "Nos", hsn: "", gstRate: 18, openingStock: 0, currentStock: 0, minStock: 0, reorderLevel: 0, purchaseRate: 0, saleRate: 0 };
  const [form, setForm] = useState<Item>(blank);

  const openNew = () => { setEdit(null); setForm(blank); setOpen(true); };
  const openEdit = (i: Item) => { setEdit(i); setForm(i); setOpen(true); };

  const save = () => {
    if (!form.name || !form.code) return alert("Code and Name required");
    if (edit) {
      setDB(d => ({ ...d, items: d.items.map(i => i.id === edit.id ? form : i) }));
      log(`Updated item: ${form.name}`, "Item Master");
    } else {
      setDB(d => ({ ...d, items: [{ ...form, id: uid() }, ...d.items] }));
      log(`Created item: ${form.name}`, "Item Master");
    }
    setOpen(false);
  };
  const remove = (i: Item) => {
    if (!confirm(`Delete item ${i.name}?`)) return;
    setDB(d => ({ ...d, items: d.items.filter(x => x.id !== i.id) }));
    log(`Deleted item: ${i.name}`, "Item Master");
  };
  const exportCSV = () => {
    downloadCSV("items.csv", [
      ["Code", "Name", "Category", "Unit", "HSN", "GST%", "Stock", "MinStock", "Reorder", "Purchase Rate", "Sale Rate"],
      ...items.map(i => [i.code, i.name, i.category, i.unit, i.hsn || "", i.gstRate, i.currentStock, i.minStock, i.reorderLevel, i.purchaseRate, i.saleRate])
    ]);
  };

  const downloadTemplate = () => {
    downloadCSV("item-master-bulk-upload-template.csv", [
      ["Code", "Name", "Category", "Unit", "HSN", "GST%", "Opening Stock", "Current Stock", "Minimum Stock", "Reorder Level", "Purchase Rate", "Sale Rate"],
      ["RM-NEW-001", "New Raw Material", "Raw Material", "Kg", "8504", 18, 0, 0, 0, 0, 0, 0],
      ["SF-NEW-001", "New Semi Finished Item", "Semi-Finished", "Nos", "8504", 18, 0, 0, 0, 0, 0, 0],
      ["FG-NEW-001", "New Finished Good", "Finished Goods", "Nos", "8504", 18, 0, 0, 0, 0, 0, 0],
    ]);
  };

  const rowValue = (row: Record<string, any>, names: string[]) => {
    const normalized = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase().replace(/[^a-z0-9]/g, ""), v]));
    for (const name of names) {
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (key in normalized) return normalized[key];
    }
    return undefined;
  };

  const cleanCategory = (value: any): Item["category"] => {
    const text = String(value || "").toLowerCase().replace(/[^a-z]/g, "");
    if (text.includes("finishedgoods") || text === "finished") return "Finished Goods";
    if (text.includes("semifinished") || text.includes("semi")) return "Semi-Finished";
    return "Raw Material";
  };

  const num = (value: any, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const handleBulkUpload = async (file?: File) => {
    if (!file) return;
    setUploadMessage("Reading Excel file...");
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      if (!rows.length) throw new Error("No rows found in file.");

      let created = 0;
      let updated = 0;
      let skipped = 0;
      setDB(d => {
        const nextItems = [...d.items];
        rows.forEach(row => {
          const code = String(rowValue(row, ["Code", "Item Code", "ItemCode"]) || "").trim();
          const name = String(rowValue(row, ["Name", "Item Name", "ItemName"]) || "").trim();
          if (!code || !name) { skipped += 1; return; }
          const existingIndex = nextItems.findIndex(i => i.code.toLowerCase() === code.toLowerCase());
          const existing = existingIndex >= 0 ? nextItems[existingIndex] : undefined;
          const openingStock = num(rowValue(row, ["Opening Stock", "OpeningStock"]), existing?.openingStock || 0);
          const currentStock = num(rowValue(row, ["Current Stock", "Stock", "CurrentStock"]), existing?.currentStock ?? openingStock);
          const item: Item = {
            id: existing?.id || uid(),
            code,
            name,
            category: cleanCategory(rowValue(row, ["Category", "Item Category"])),
            unit: String(rowValue(row, ["Unit", "UOM"]) || existing?.unit || "Nos"),
            hsn: String(rowValue(row, ["HSN", "HSN Code", "HSNCode"]) || existing?.hsn || ""),
            gstRate: num(rowValue(row, ["GST%", "GST", "GST Rate", "GSTRate"]), existing?.gstRate || 18),
            openingStock,
            currentStock,
            minStock: num(rowValue(row, ["Minimum Stock", "MinStock", "MinimumStock"]), existing?.minStock || 0),
            reorderLevel: num(rowValue(row, ["Reorder Level", "Reorder", "ReorderLevel"]), existing?.reorderLevel || 0),
            purchaseRate: num(rowValue(row, ["Purchase Rate", "Purchase", "PurchaseRate"]), existing?.purchaseRate || 0),
            saleRate: num(rowValue(row, ["Sale Rate", "Sale", "SaleRate"]), existing?.saleRate || 0),
          };
          if (existingIndex >= 0) { nextItems[existingIndex] = item; updated += 1; }
          else { nextItems.unshift(item); created += 1; }
        });
        return { ...d, items: nextItems };
      });
      log(`Bulk Item Master upload: ${created} created, ${updated} updated, ${skipped} skipped`, "Item Master");
      setUploadMessage(`${created} created, ${updated} updated${skipped ? `, ${skipped} skipped` : ""}.`);
    } catch (err: any) {
      setUploadMessage(`Upload failed: ${err.message || "Invalid file"}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">Item Master</h1><p className="text-sm text-slate-500">Raw materials, semi-finished and finished goods</p></div>
        <div className="flex gap-2 flex-wrap justify-end">
          {(canCreate || canEdit) && <Button variant="outline" onClick={downloadTemplate}><IconDownload size={14}/> Template</Button>}
          {(canCreate || canEdit) && (
            <label className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200">
              Bulk Upload
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { handleBulkUpload(e.target.files?.[0]); e.currentTarget.value = ""; }} />
            </label>
          )}
          {canExport && <Button variant="outline" onClick={exportCSV}><IconDownload size={14}/> Export</Button>}
          {canCreate && <Button onClick={openNew}><IconPlus size={14}/> New Item</Button>}
        </div>
      </div>
      {uploadMessage && <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm text-slate-600 dark:text-slate-300">{uploadMessage}</div>}

      <Card>
        <div className="p-4 flex flex-wrap gap-3 items-center border-b border-slate-100 dark:border-slate-800">
          <div className="relative flex-1 min-w-48">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <Input className="pl-9" placeholder="Search code or name..." value={search} onChange={(e: any) => setSearch(e.target.value)}/>
          </div>
          <Select value={cat} onChange={(e: any) => setCat(e.target.value)} className="w-44">
            <option value="all">All Categories</option>
            <option value="Raw Material">Raw Material</option>
            <option value="Semi-Finished">Semi-Finished</option>
            <option value="Finished Goods">Finished Goods</option>
          </Select>
        </div>
        <Table>
          <thead>
            <tr><Th>Code</Th><Th>Name</Th><Th>Category</Th><Th>Unit</Th><Th>HSN</Th><Th>GST</Th><Th>Stock</Th><Th>Purchase</Th><Th>Sale</Th><Th></Th></tr>
          </thead>
          <tbody>
            {items.map(i => {
              const low = i.currentStock <= i.minStock;
              return (
                <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-mono text-xs">{i.code}</Td>
                  <Td className="font-medium">{i.name}</Td>
                  <Td><Badge color={i.category === "Raw Material" ? "blue" : i.category === "Finished Goods" ? "green" : "yellow"}>{i.category}</Badge></Td>
                  <Td>{i.unit}</Td>
                  <Td className="text-xs">{i.hsn}</Td>
                  <Td>{i.gstRate}%</Td>
                  <Td><span className={low ? "text-rose-600 font-semibold" : ""}>{i.currentStock} {i.unit}</span>{low && <Badge color="red">low</Badge>}</Td>
                  <Td>{fmtINR(i.purchaseRate)}</Td>
                  <Td>{fmtINR(i.saleRate)}</Td>
                  <Td><div className="flex gap-1">
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(i)}><IconEdit size={14}/></Button>}
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => remove(i)}><IconTrash size={14}/></Button>}
                  </div></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {items.length === 0 && <Empty />}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? "Edit Item" : "New Item"} size="lg">
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label>Item Code *</Label><Input value={form.code} onChange={(e: any) => setForm({...form, code: e.target.value})}/></div>
          <div className="sm:col-span-2"><Label>Item Name *</Label><Input value={form.name} onChange={(e: any) => setForm({...form, name: e.target.value})}/></div>
          <div><Label>Category</Label>
            <Select value={form.category} onChange={(e: any) => setForm({...form, category: e.target.value})}>
              <option>Raw Material</option><option>Semi-Finished</option><option>Finished Goods</option>
            </Select>
          </div>
          <div><Label>Unit</Label><Input value={form.unit} onChange={(e: any) => setForm({...form, unit: e.target.value})}/></div>
          <div><Label>HSN Code</Label><Input value={form.hsn} onChange={(e: any) => setForm({...form, hsn: e.target.value})}/></div>
          <div><Label>GST Option</Label><Select value={form.gstRate} onChange={(e: any) => setForm({...form, gstRate: Number(e.target.value)})}>{GST_OPTIONS.map(rate => <option key={rate} value={rate}>{rate}%</option>)}</Select></div>
          <div><Label>Opening Stock</Label><Input type="number" value={form.openingStock} onChange={(e: any) => setForm({...form, openingStock: Number(e.target.value), currentStock: edit ? form.currentStock : Number(e.target.value)})}/></div>
          <div><Label>Current Stock</Label><Input type="number" value={form.currentStock} onChange={(e: any) => setForm({...form, currentStock: Number(e.target.value)})}/></div>
          <div><Label>Minimum Stock</Label><Input type="number" value={form.minStock} onChange={(e: any) => setForm({...form, minStock: Number(e.target.value)})}/></div>
          <div><Label>Reorder Level</Label><Input type="number" value={form.reorderLevel} onChange={(e: any) => setForm({...form, reorderLevel: Number(e.target.value)})}/></div>
          <div><Label>Purchase Rate (₹)</Label><Input type="number" value={form.purchaseRate} onChange={(e: any) => setForm({...form, purchaseRate: Number(e.target.value)})}/></div>
          <div><Label>Sale Rate (₹)</Label><Input type="number" value={form.saleRate} onChange={(e: any) => setForm({...form, saleRate: Number(e.target.value)})}/></div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save}>{edit ? "Update" : "Create"}</Button>
        </div>
      </Modal>
    </div>
  );
}
