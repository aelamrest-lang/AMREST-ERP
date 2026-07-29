import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useStore } from "../lib/store";
import { Card, Button, Input, Select, Table, Th, Td, Badge, Empty, KPI } from "../components/ui";
import { IconBox, IconRefresh, IconDownload, IconSearch, IconClipboard } from "../components/icons";
import { downloadCSV, fmtINR } from "../lib/utils";
import { userCan } from "../lib/permissions";

export function Inventory() {
  const { db, setDB, log, currentUser } = useStore();
  const canExport = userCan(currentUser, "inventory", "export");
  const canUpload = currentUser?.role === "admin";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "raw" | "semi" | "fg">("all");
  const [heldSearch, setHeldSearch] = useState("");
  const [heldType, setHeldType] = useState<"all" | "Raw Material" | "Semi-Finished" | "Finished Goods">("all");
  const [uploadMessage, setUploadMessage] = useState("");

  const items = useMemo(() => {
    let arr = db.items.slice();
    if (filter === "low") arr = arr.filter(i => i.currentStock <= i.minStock);
    if (filter === "raw") arr = arr.filter(i => i.category === "Raw Material");
    if (filter === "semi") arr = arr.filter(i => i.category === "Semi-Finished");
    if (filter === "fg") arr = arr.filter(i => i.category === "Finished Goods");
    if (search) arr = arr.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
    return arr;
  }, [db.items, filter, search]);

  const totalValue = db.items.reduce((s, i) => s + i.currentStock * i.purchaseRate, 0);
  const lowCount = db.items.filter(i => i.currentStock <= i.minStock).length;
  const allHeldRows = useMemo(() => {
    const rows = db.jobCards.flatMap(j => j.reservedItems.map(r => {
      const item = db.items.find(i => i.id === r.itemId);
      const issuedQty = db.materialIssues
        .filter(issue => issue.jobCardId === j.id)
        .flatMap(issue => issue.lines)
        .filter(line => line.itemId === r.itemId)
        .reduce((sum, line) => sum + line.issueQty, 0);
      const pendingHold = Math.max(0, r.qty - issuedQty);
      return {
        jobCardNumber: j.number,
        jobStatus: j.status,
        item,
        qtyHeld: pendingHold,
        availableQty: item?.currentStock || 0,
        status: j.status === "Completed" || pendingHold <= 0 ? "Consumed / Completed" : "Held for Job Card",
      };
    })).filter(r => r.item);
    return rows;
  }, [db.jobCards, db.items, db.materialIssues]);
  const heldByItem = useMemo(() => {
    const map = new Map<string, number>();
    allHeldRows.filter(r => r.jobStatus !== "Completed").forEach(r => {
      if (!r.item) return;
      map.set(r.item.id, (map.get(r.item.id) || 0) + r.qtyHeld);
    });
    return map;
  }, [allHeldRows]);
  const controlRows = useMemo(() => items.map(item => {
    const hold = heldByItem.get(item.id) || 0;
    const available = item.currentStock;
    const totalStock = item.currentStock + hold;
    const status = available < 0 ? "Over-Committed" : available <= item.minStock ? "Below Buffer" : available <= item.reorderLevel ? "Reorder Soon" : "Healthy";
    return { item, hold, available, totalStock, status };
  }), [items, heldByItem]);
  const heldRows = useMemo(() => {
    return allHeldRows.filter(r => {
      const text = `${r.jobCardNumber} ${r.item?.name || ""}`.toLowerCase();
      const matchesSearch = !heldSearch || text.includes(heldSearch.toLowerCase());
      const matchesType = heldType === "all" || r.item?.category === heldType;
      return matchesSearch && matchesType;
    });
  }, [allHeldRows, heldSearch, heldType]);
  const activeHeldQty = allHeldRows.filter(r => r.jobStatus !== "Completed").reduce((s, r) => s + r.qtyHeld, 0);

  const movementRows = useMemo(() => {
    const grnRows = db.grns.flatMap(g => g.receivedItems.map(r => {
      const item = db.items.find(i => i.id === r.itemId);
      return { date: g.date, ref: g.number, item, type: "Purchase Entry / GRN", qty: r.qty, direction: "In" };
    }));
    const holdRows = db.jobCards.flatMap(j => j.reservedItems.map(r => {
      const item = db.items.find(i => i.id === r.itemId);
      return { date: j.date, ref: j.number, item, type: "Job Card Hold", qty: r.qty, direction: "Hold" };
    }));
    const dispatchRows = db.challans.flatMap(c => {
      const so = db.salesOrders.find(s => s.id === c.salesOrderId);
      return (so?.items || []).map(si => ({ date: c.date, ref: c.number, item: db.items.find(i => i.name === si.name), fallbackName: si.name, type: "Dispatch / Delivery", qty: si.qty, direction: "Out" }));
    });
    return [...grnRows, ...holdRows, ...dispatchRows]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20);
  }, [db.grns, db.jobCards, db.challans, db.salesOrders, db.items]);

  const exportCSV = () => {
    downloadCSV("inventory.csv", [
      ["Name", "Category", "Stock", "Unit", "Min", "Reorder", "Value (₹)"],
      ...items.map(i => [i.name, i.category, i.currentStock, i.unit, i.minStock, i.reorderLevel, (i.currentStock * i.purchaseRate).toFixed(2)])
    ]);
  };

  const downloadUploadTemplate = () => {
    downloadCSV("inventory-upload-template.csv", [
      ["Item Name", "Current Stock", "Purchase Rate", "Minimum Stock", "Reorder Level"],
      ...db.items.map(i => [i.name, i.currentStock, i.purchaseRate, i.minStock, i.reorderLevel]),
    ]);
  };

  const keyOf = (row: Record<string, any>, names: string[]) => {
    const normalized = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase().replace(/[^a-z0-9]/g, ""), v]));
    for (const name of names) {
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (key in normalized) return normalized[key];
    }
    return undefined;
  };

  const handleInventoryUpload = async (file?: File) => {
    if (!file) return;
    setUploadMessage("Reading upload file...");
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      if (!rows.length) throw new Error("No rows found in the uploaded file.");

      let updated = 0;
      let skipped = 0;
      setDB(d => ({
        ...d,
        items: d.items.map(item => {
          const row = rows.find(r => {
            const name = String(keyOf(r, ["Item Name", "Name", "item_name", "ItemName"])).trim().toLowerCase();
            return !!name && name === item.name.toLowerCase();
          });
          if (!row) return item;

          const stockRaw = keyOf(row, ["Current Stock", "Stock", "Qty", "Quantity", "current_stock"]);
          const rateRaw = keyOf(row, ["Purchase Rate", "Avg Unit Cost", "Average Unit Cost", "Rate", "purchase_rate"]);
          const minRaw = keyOf(row, ["Minimum Stock", "Min Stock", "minimum_stock"]);
          const reorderRaw = keyOf(row, ["Reorder Level", "Reorder", "reorder_level"]);

          const currentStock = Number(stockRaw);
          if (stockRaw === "" || Number.isNaN(currentStock)) {
            skipped += 1;
            return item;
          }
          updated += 1;
          return {
            ...item,
            currentStock,
            purchaseRate: rateRaw === "" || Number.isNaN(Number(rateRaw)) ? item.purchaseRate : Number(rateRaw),
            minStock: minRaw === "" || Number.isNaN(Number(minRaw)) ? item.minStock : Number(minRaw),
            reorderLevel: reorderRaw === "" || Number.isNaN(Number(reorderRaw)) ? item.reorderLevel : Number(reorderRaw),
          };
        }),
      }));
      log(`Bulk inventory Excel upload: ${updated} updated, ${skipped} skipped`, "Inventory");
      setUploadMessage(`${updated} item(s) updated from Excel upload${skipped ? `, ${skipped} skipped` : ""}.`);
    } catch (err: any) {
      setUploadMessage(`Upload failed: ${err.message || "Invalid file"}`);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Inventory Management</h1>
        <p className="text-sm text-slate-500">Real-time stock, valuation and movement</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Total Items" value={String(db.items.length)} color="indigo" icon={<IconBox size={22}/>} />
        <KPI label="Stock Value" value={fmtINR(totalValue)} color="emerald" icon={<IconBox size={22}/>} hint="at purchase rate"/>
        <KPI label="Low Stock" value={String(lowCount)} color="rose" icon={<IconRefresh size={22}/>} />
        <KPI label="Held Inventory" value={String(activeHeldQty)} color="amber" icon={<IconClipboard size={22}/>} hint="active job holds" />
      </div>

      <Card>
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100 dark:border-slate-800">
          <div className="relative flex-1 min-w-48">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <Input className="pl-9" placeholder="Search items..." value={search} onChange={(e: any) => setSearch(e.target.value)}/>
          </div>
          <Select value={filter} onChange={(e: any) => setFilter(e.target.value)} className="w-44">
            <option value="all">All Items</option><option value="low">Low Stock</option><option value="raw">Raw Material</option><option value="semi">Semi-Finished</option><option value="fg">Finished Goods</option>
          </Select>
          {canUpload && <Button variant="outline" onClick={downloadUploadTemplate}><IconDownload size={14}/> Template</Button>}
          {canUpload && (
            <label className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200">
              Excel Upload
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  handleInventoryUpload(e.target.files?.[0]);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          )}
          {canExport && <Button variant="outline" onClick={exportCSV}><IconDownload size={14}/> Export</Button>}
        </div>
        {canUpload && uploadMessage && <div className="px-4 py-2 text-xs border-b border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-300">{uploadMessage}</div>}
        <div className="px-4 py-3 border-b border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 flex items-center justify-between gap-3 flex-wrap text-sm">
          <div>
            <div className="font-semibold text-amber-800 dark:text-amber-300">Stock Reservation Engine Active</div>
            <div className="text-xs text-amber-700 dark:text-amber-400">Available Stock = Current Stock - Hold (Job Card)</div>
          </div>
          <div className="font-mono text-xs text-amber-800 dark:text-amber-300">Current Stock - Hold (Job Card) = Available</div>
        </div>
        <Table>
          <thead><tr><Th>Material Details</Th><Th>UOM</Th><Th>Current Stock</Th><Th>Hold (Job Card)</Th><Th>Available Stock</Th><Th>Avg Unit Cost</Th><Th>Total Valuation (₹)</Th><Th>Safety Buffer Status</Th></tr></thead>
          <tbody>
            {controlRows.map(({ item: i, hold, available, totalStock, status }) => {
              const low = available <= i.minStock;
              const statusColor = status === "Healthy" ? "green" : status === "Reorder Soon" ? "yellow" : "red";
              return (
                <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td>
                    <div className="font-semibold text-slate-800 dark:text-slate-100">{i.name}</div>
                    <div className="mt-1"><Badge color={i.category === "Raw Material" ? "blue" : i.category === "Finished Goods" ? "green" : "yellow"}>{i.category}</Badge></div>
                  </Td>
                  <Td className="font-medium">{i.unit}</Td>
                  <Td className="font-semibold">{totalStock} {i.unit}</Td>
                  <Td className="font-semibold text-amber-600">{hold} {i.unit}</Td>
                  <Td><span className={low ? "text-rose-600 font-bold" : "font-bold text-emerald-600"}>{available} {i.unit}</span></Td>
                  <Td>{fmtINR(i.purchaseRate)}</Td>
                  <Td className="font-semibold text-indigo-700 dark:text-indigo-300">{fmtINR(available * i.purchaseRate)}</Td>
                  <Td><Badge color={statusColor}>{status}</Badge><div className="text-[10px] text-slate-500 mt-1">Min {i.minStock} / Reorder {i.reorderLevel}</div></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {items.length === 0 && <Empty/>}
      </Card>

      <Card>
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex-1 min-w-48 relative">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <Input className="pl-9" placeholder="Search held inventory by job card or item name..." value={heldSearch} onChange={(e: any) => setHeldSearch(e.target.value)} />
          </div>
          <Select value={heldType} onChange={(e: any) => setHeldType(e.target.value)} className="w-52">
            <option value="all">All Item Types</option>
            <option value="Raw Material">Raw Materials</option>
            <option value="Semi-Finished">Semi-Finished Products</option>
            <option value="Finished Goods">Finished Goods</option>
          </Select>
        </div>
        <Table>
          <thead><tr><Th>Job Card Number</Th><Th>Item Name</Th><Th>Quantity Held</Th><Th>Available Quantity</Th><Th>Status</Th></tr></thead>
          <tbody>
            {heldRows.map((r, idx) => (
              <tr key={`${r.jobCardNumber}-${r.item?.id}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Td className="font-mono text-xs">{r.jobCardNumber}</Td>
                <Td className="font-medium">{r.item?.name}</Td>
                <Td className="font-semibold text-amber-600">{r.qtyHeld} {r.item?.unit}</Td>
                <Td>{r.availableQty} {r.item?.unit}</Td>
                <Td><Badge color={r.jobStatus === "Completed" ? "green" : "yellow"}>{r.status}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {heldRows.length === 0 && <Empty title="No held inventory found" subtitle="Job Card holds will appear here automatically" />}
      </Card>

      <Card>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-semibold">Stock Movement History</h3>
          <p className="text-xs text-slate-500">Movements are generated from GRN, Job Card holds, production and dispatch workflows. Manual stock adjustment is disabled.</p>
        </div>
        <Table>
          <thead><tr><Th>Date</Th><Th>Reference</Th><Th>Movement</Th><Th>Item</Th><Th>Type</Th><Th>Qty</Th></tr></thead>
          <tbody>
            {movementRows.map((m, idx) => (
              <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Td>{m.date}</Td>
                <Td className="font-mono text-xs">{m.ref}</Td>
                <Td><Badge color={m.direction === "In" ? "green" : m.direction === "Out" ? "red" : "yellow"}>{m.direction}</Badge></Td>
                <Td className="font-medium">{m.item?.name || (m as any).fallbackName || "-"}</Td>
                <Td>{m.type}</Td>
                <Td>{m.qty} {m.item?.unit || "Nos"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {movementRows.length === 0 && <Empty title="No stock movements yet" />}
      </Card>
    </div>
  );
}
