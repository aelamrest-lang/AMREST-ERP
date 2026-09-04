import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
import type { Item } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconSearch, IconDownload } from "../components/icons";
import { downloadCSV, fmtINR, fmt2 } from "../lib/utils";
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
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [historyRange, setHistoryRange] = useState<"month" | "lastMonth" | "3m" | "6m" | "1y" | "custom">("6m");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  const items = useMemo(() => {
    let arr = db.items;
    if (cat !== "all") arr = arr.filter(x => x.category === cat);
    if (search) {
      const s = search.toLowerCase();
      arr = arr.filter(x => x.name.toLowerCase().includes(s));
    }
    return arr;
  }, [db.items, cat, search]);

  const blank: Item = { id: "", name: "", category: "Raw Material", unit: "Nos", hsn: "", gstRate: 18, openingStock: 0, currentStock: 0, minStock: 0, reorderLevel: 0, purchaseRate: 0, saleRate: 0 };
  const [form, setForm] = useState<Item>(blank);

  const openNew = () => { setEdit(null); setForm(blank); setOpen(true); };
  const openEdit = (i: Item) => { setEdit(i); setForm(i); setOpen(true); };

  const save = () => {
    if (!form.name) return alert("Item Name is required");
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
      ["Name", "Category", "Unit", "HSN", "GST%", "Stock", "MinStock", "Reorder", "Purchase Rate", "Sale Rate"],
      ...items.map(i => [i.name, i.category, i.unit, i.hsn || "", i.gstRate, i.currentStock, i.minStock, i.reorderLevel, i.purchaseRate, i.saleRate])
    ]);
  };

  const downloadTemplate = () => {
    downloadCSV("item-master-bulk-upload-template.csv", [
      ["Name", "Category", "Unit", "HSN", "GST%", "Opening Stock", "Current Stock", "Minimum Stock", "Reorder Level", "Purchase Rate", "Sale Rate"],
      ["New Raw Material", "Raw Material", "Kg", "8504", 18, 0, 0, 0, 0, 0, 0],
      ["New Semi Finished Item", "Semi-Finished", "Nos", "8504", 18, 0, 0, 0, 0, 0, 0],
      ["New Finished Good", "Finished Goods", "Nos", "8504", 18, 0, 0, 0, 0, 0, 0],
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
          const name = String(rowValue(row, ["Name", "Item Name", "ItemName"]) || "").trim();
          if (!name) { skipped += 1; return; }
          const existingIndex = nextItems.findIndex(i => i.name.toLowerCase() === name.toLowerCase());
          const existing = existingIndex >= 0 ? nextItems[existingIndex] : undefined;
          const openingStock = num(rowValue(row, ["Opening Stock", "OpeningStock"]), existing?.openingStock || 0);
          const currentStock = num(rowValue(row, ["Current Stock", "Stock", "CurrentStock"]), existing?.currentStock ?? openingStock);
          const item: Item = {
            id: existing?.id || uid(),
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
            <Input className="pl-9" placeholder="Search item name..." value={search} onChange={(e: any) => setSearch(e.target.value)}/>
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
            <tr><Th>Name</Th><Th>Category</Th><Th>Unit</Th><Th>HSN</Th><Th>GST</Th><Th>Stock</Th><Th>Purchase</Th><Th>Sale</Th><Th></Th></tr>
          </thead>
          <tbody>
            {items.map(i => {
              const low = i.currentStock <= i.minStock;
              return (
                <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-medium">
                    <button
                      className="text-indigo-600 hover:underline text-left"
                      onClick={() => setHistoryItem(i)}
                      title="Click to view Purchase History"
                      data-testid={`item-name-${i.id}`}
                    >{i.name}</button>
                  </Td>
                  <Td><Badge color={i.category === "Raw Material" ? "blue" : i.category === "Finished Goods" ? "green" : "yellow"}>{i.category}</Badge></Td>
                  <Td>{i.unit}</Td>
                  <Td className="text-xs">{i.hsn}</Td>
                  <Td>{i.gstRate}%</Td>
                  <Td><span className={low ? "text-rose-600 font-semibold" : ""}>{fmt2(i.currentStock)} {i.unit}</span>{low && <Badge color="red">low</Badge>}</Td>
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
          <div className="sm:col-span-3"><Label>Item Name *</Label><Input value={form.name} onChange={(e: any) => setForm({...form, name: e.target.value})}/></div>
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

      {/* Purchase History Modal */}
      <Modal open={!!historyItem} onClose={() => setHistoryItem(null)} title={historyItem ? `Purchase History — ${historyItem.name}` : ""} size="xl">
        {historyItem && (() => {
          // Determine date range boundaries
          const now = new Date();
          const y = now.getFullYear(), m = now.getMonth();
          let from = new Date(0), to = new Date(9999, 0, 1);
          if (historyRange === "month") { from = new Date(y, m, 1); to = new Date(y, m + 1, 1); }
          else if (historyRange === "lastMonth") { from = new Date(y, m - 1, 1); to = new Date(y, m, 1); }
          else if (historyRange === "3m") { from = new Date(y, m - 3, 1); to = new Date(y, m + 1, 1); }
          else if (historyRange === "6m") { from = new Date(y, m - 6, 1); to = new Date(y, m + 1, 1); }
          else if (historyRange === "1y") { from = new Date(y - 1, m, 1); to = new Date(y, m + 1, 1); }
          else if (historyRange === "custom") {
            if (customFrom) from = new Date(customFrom);
            if (customTo) { const t = new Date(customTo); t.setDate(t.getDate() + 1); to = t; }
          }
          // Build rows: iterate GRNs where receivedItems includes this itemId
          const rows: Array<{ date: string; grn: string; po: string; vendor: string; qty: number; rate: number; amount: number }> = [];
          db.grns.forEach(g => {
            const rec = (g.receivedItems || []).find(r => r.itemId === historyItem.id);
            if (!rec || (Number(rec.qty) || 0) <= 0) return;
            const gDate = new Date(g.date);
            if (isNaN(gDate.getTime()) || gDate < from || gDate >= to) return;
            const po = db.purchaseOrders.find(p => p.id === g.poId);
            const poLine = po?.items.find(x => x.itemId === historyItem.id);
            const rate = Number(poLine?.rate) || 0;
            const vendor = db.parties.find(v => v.id === po?.vendorId)?.name || "—";
            rows.push({
              date: g.date,
              grn: g.number,
              po: po?.number || "—",
              vendor,
              qty: rec.qty,
              rate,
              amount: rec.qty * rate,
            });
          });
          rows.sort((a, b) => b.date.localeCompare(a.date));
          const totalQty = rows.reduce((s, r) => s + r.qty, 0);
          const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
          const avgRate = totalQty > 0 ? totalAmount / totalQty : 0;

          return (
            <div className="space-y-3" data-testid="item-history-modal">
              {/* Range picker */}
              <div className="flex flex-wrap items-end gap-2">
                {[
                  { k: "month", label: "This Month" },
                  { k: "lastMonth", label: "Last Month" },
                  { k: "3m", label: "Last 3 Months" },
                  { k: "6m", label: "Last 6 Months" },
                  { k: "1y", label: "Last 1 Year" },
                  { k: "custom", label: "Custom" },
                ].map(opt => (
                  <button
                    key={opt.k}
                    type="button"
                    onClick={() => setHistoryRange(opt.k as any)}
                    className={"text-xs px-3 py-1.5 rounded-md border " + (historyRange === opt.k ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 hover:border-indigo-400")}
                    data-testid={`hist-range-${opt.k}`}
                  >{opt.label}</button>
                ))}
                {historyRange === "custom" && (
                  <>
                    <div><Label className="text-[10px]">From</Label><Input type="date" value={customFrom} onChange={(e: any) => setCustomFrom(e.target.value)} data-testid="hist-from" /></div>
                    <div><Label className="text-[10px]">To</Label><Input type="date" value={customTo} onChange={(e: any) => setCustomTo(e.target.value)} data-testid="hist-to" /></div>
                  </>
                )}
              </div>

              {/* KPI */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Rows</div>
                  <div className="text-lg font-bold">{rows.length}</div>
                </div>
                <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-blue-700">Total Qty</div>
                  <div className="text-lg font-bold text-blue-700">{fmt2(totalQty)} {historyItem.unit}</div>
                </div>
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-700">Total Amount</div>
                  <div className="text-lg font-bold text-emerald-700">{fmtINR(totalAmount)}</div>
                </div>
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-amber-700">Avg Rate</div>
                  <div className="text-lg font-bold text-amber-700">{fmtINR(avgRate)}</div>
                </div>
              </div>

              <div className="max-h-[420px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <Table>
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr>
                      <Th>Date</Th>
                      <Th>PO No.</Th>
                      <Th>GRN No.</Th>
                      <Th>Vendor</Th>
                      <Th className="text-right">Qty</Th>
                      <Th className="text-right">Rate</Th>
                      <Th className="text-right">Total Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><Td colSpan={7}><Empty title="No purchases in this period" subtitle="Try a wider date range or check if any GRN records this item." /></Td></tr>
                    ) : rows.map((r, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <Td>{r.date}</Td>
                        <Td className="font-mono text-xs">{r.po}</Td>
                        <Td className="font-mono text-xs">{r.grn}</Td>
                        <Td>{r.vendor}</Td>
                        <Td className="text-right">{fmt2(r.qty)}</Td>
                        <Td className="text-right">{fmtINR(r.rate)}</Td>
                        <Td className="text-right font-semibold">{fmtINR(r.amount)}</Td>
                      </tr>
                    ))}
                    {rows.length > 0 && (
                      <tr className="bg-slate-50 dark:bg-slate-800/40 font-semibold">
                        <Td colSpan={4}>Total</Td>
                        <Td className="text-right">{fmt2(totalQty)} {historyItem.unit}</Td>
                        <Td className="text-right">—</Td>
                        <Td className="text-right text-indigo-700">{fmtINR(totalAmount)}</Td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </div>
              <div className="flex justify-end pt-1">
                <Button variant="ghost" onClick={() => setHistoryItem(null)} data-testid="item-history-close">Close</Button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
