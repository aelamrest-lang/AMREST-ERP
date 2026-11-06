import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useStore } from "../lib/store";
import { Card, Button, Input, Select, Table, Th, Td, Badge, Empty, KPI } from "../components/ui";
import { IconBox, IconRefresh, IconDownload, IconSearch, IconClipboard } from "../components/icons";
import { downloadCSV, fmtINR, fmt2, todayISO } from "../lib/utils";
import { buildStockLedger, movementsBetween, rateAsOf, stockAsOf } from "../lib/stockHistory";

type DateMode = "today" | "yesterday" | "date" | "month" | "lastmonth" | "range";
const isoD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayBefore = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return isoD(new Date(y, m - 1, d - 1)); };
import { userCan } from "../lib/permissions";
const normSearch = (s: string) => s.toLowerCase().replace(/×/g, "x").replace(/(\d)\s*x\s*(?=\d)/g, "$1 x ").replace(/[^a-z0-9.]+/g, " ").replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2").trim();
const matchesKeywords = (name: string, q: string) => {
  const n = normSearch(name), nq = normSearch(q);
  if (n.replace(/ /g, "").includes(nq.replace(/ /g, ""))) return true;
  return nq.split(" ").every(t => n.includes(t));
};
import { MaterialHistoryModal } from "../components/MaterialHistoryModal";

export function Inventory() {
  const { db, setDB, log, currentUser } = useStore();
  const canExport = userCan(currentUser, "inventory", "export");
  const canUpload = currentUser?.role === "admin";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "raw" | "semi" | "fg">("all");
  const [view, setView] = useState<"all" | "value" | "low">("all");
  const [heldSearch, setHeldSearch] = useState("");
  const [heldType, setHeldType] = useState<"all" | "Raw Material" | "Semi-Finished" | "Finished Goods">("all");
  const [uploadMessage, setUploadMessage] = useState("");
  const [historyItem, setHistoryItem] = useState<(typeof db.items)[0] | null>(null);
  const [sortKey, setSortKey] = useState<"current" | "hold" | "available" | "cost" | "value" | "status" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [dateMode, setDateMode] = useState<DateMode>("today");
  const [pickDate, setPickDate] = useState(todayISO());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState(todayISO());
  const period = useMemo(() => {
    const t = todayISO(), now = new Date();
    switch (dateMode) {
      case "yesterday": return { to: dayBefore(t) };
      case "date": return { to: pickDate || t };
      case "month": return { from: isoD(new Date(now.getFullYear(), now.getMonth(), 1)), to: t };
      case "lastmonth": return { from: isoD(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: isoD(new Date(now.getFullYear(), now.getMonth(), 0)) };
      case "range": { const to = rangeTo || t; const from = rangeFrom || undefined; return from && from > to ? { from: to, to: from } : { from, to }; }
      default: return { to: t };
    }
  }, [dateMode, pickDate, rangeFrom, rangeTo]) as { from?: string; to: string };
  const asOf = period.to;
  const isLive = asOf >= todayISO() && !period.from;
  const ledger = useMemo(() => buildStockLedger(db), [db.grns, db.purchaseOrders, db.materialIssues, db.sfgBatches, db.sfgConsumptions, db.challans]); // eslint-disable-line react-hooks/exhaustive-deps
  const histStock = useMemo(() => isLive ? null : stockAsOf(db, ledger, asOf), [isLive, ledger, asOf, db.items]); // eslint-disable-line react-hooks/exhaustive-deps
  const openStock = useMemo(() => period.from ? stockAsOf(db, ledger, dayBefore(period.from)) : null, [period.from, ledger, db.items]); // eslint-disable-line react-hooks/exhaustive-deps
  const flows = useMemo(() => period.from ? movementsBetween(ledger, period.from, asOf) : null, [period.from, asOf, ledger]);
  const baseItems = useMemo(() => histStock ? db.items.map(i => ({ ...i, currentStock: histStock.get(i.id) || 0 })) : db.items, [histStock, db.items]);
  const toggleSort = (k: "current" | "hold" | "available" | "cost" | "value" | "status") => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  const arrow = (k: string) => sortKey === k ? (sortDir === "desc" ? " ▼" : " ▲") : " ↕";
  const statusRank: Record<string, number> = { "Healthy": 0, "Reorder Soon": 1, "Below Buffer": 2, "Over-Committed": 3 };

  const CAT: Record<string, string> = { raw: "Raw Material", semi: "Semi-Finished", fg: "Finished Goods" };
  const catItems = useMemo(() => filter === "all" ? baseItems : baseItems.filter(i => i.category === CAT[filter]), [baseItems, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => {
    let arr = catItems.slice();
    if (view === "low") arr = arr.filter(i => i.currentStock <= i.minStock);
    if (view === "value") arr = arr.filter(i => i.currentStock !== 0);
    if (search.trim()) arr = arr.filter(i => matchesKeywords(i.name, search));
    return arr;
  }, [catItems, view, search]);

  const lastPurchaseRates = useMemo(() => {
    const rows: Record<string, { date: string; rate: number }[]> = {};
    db.grns.forEach(g => {
      const po = db.purchaseOrders.find(p => p.id === g.poId);
      (g.receivedItems || []).forEach(r => {
        const rate = Number(po?.items.find(x => x.itemId === r.itemId)?.rate) || 0;
        if (rate > 0) (rows[r.itemId] = rows[r.itemId] || []).push({ date: g.date || "", rate });
      });
    });
    const out: Record<string, { avg: number; count: number }> = {};
    Object.entries(rows).forEach(([itemId, list]) => {
      const latest = list.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
      out[itemId] = { avg: latest.reduce((s, x) => s + x.rate, 0) / latest.length, count: latest.length };
    });
    return out;
  }, [db.grns, db.purchaseOrders]);

  const unitCost = (i: (typeof db.items)[0]) => {
    if (!isLive) return rateAsOf(i, ledger, asOf).rate;
    if (i.category === "Finished Goods") return i.saleRate || i.purchaseRate;
    return lastPurchaseRates[i.id]?.avg ?? i.purchaseRate;
  };

  const totalValue = catItems.reduce((s, i) => s + i.currentStock * unitCost(i), 0);
  const lowCount = catItems.filter(i => i.currentStock <= i.minStock).length;
  const catLabel = filter === "all" ? "All Items" : CAT[filter];
  const catBreakdown = ["Raw Material", "Semi-Finished", "Finished Goods"].filter(c => filter === "all" || c === CAT[filter]).map(c => {
    const list = baseItems.filter(i => i.category === c && i.currentStock !== 0);
    return { c, count: list.length, qty: list.reduce((s, i) => s + i.currentStock, 0), value: list.reduce((s, i) => s + i.currentStock * unitCost(i), 0) };
  });
  const allHeldRows = useMemo(() => {
    const rows = db.jobCards.filter(j => isLive || j.date <= asOf).flatMap(j => j.reservedItems.map(r => {
      const item = baseItems.find(i => i.id === r.itemId);
      const issuedQty = db.materialIssues
        .filter(issue => issue.jobCardId === j.id && (isLive || issue.date <= asOf))
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
  }, [db.jobCards, baseItems, db.materialIssues, isLive, asOf]);
  const heldByItem = useMemo(() => {
    const map = new Map<string, number>();
    allHeldRows.filter(r => r.jobStatus !== "Completed").forEach(r => {
      if (!r.item) return;
      map.set(r.item.id, (map.get(r.item.id) || 0) + r.qtyHeld);
    });
    return map;
  }, [allHeldRows]);
  const controlRows = useMemo(() => {
    const rows = items.map(item => {
      const hold = heldByItem.get(item.id) || 0;
      const required = hold > item.currentStock ? hold - item.currentStock : 0; // shortfall to procure
      const totalStock = item.currentStock; // single central stock value — identical to Item Master
      const status = item.currentStock <= item.minStock ? "Below Buffer" : item.currentStock <= item.reorderLevel ? "Reorder Soon" : "Healthy";
      return { item, hold, required, totalStock, status };
    });
    if (!sortKey) return view === "value" ? rows.slice().sort((a, b) => b.totalStock * unitCost(b.item) - a.totalStock * unitCost(a.item)) : rows;
    const val = (r: typeof rows[0]) => {
      switch (sortKey) {
        case "current": return r.totalStock;
        case "hold": return r.hold;
        case "available": return r.required;
        case "cost": return unitCost(r.item);
        case "value": return r.totalStock * unitCost(r.item);
        case "status": return statusRank[r.status] ?? -1;
      }
    };
    const sign = sortDir === "desc" ? -1 : 1;
    return rows.slice().sort((a, b) => sign * ((val(a) as number) - (val(b) as number)));
  }, [items, heldByItem, sortKey, sortDir, view]); // eslint-disable-line react-hooks/exhaustive-deps
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
    const dispatchRows = db.challans.flatMap(c => (c.dispatches || []).flatMap(d => d.lines.map(l => ({ date: d.date, ref: d.number, item: db.items.find(i => i.id === l.itemId) || db.items.find(i => i.name === l.name), fallbackName: l.name, type: "Dispatch", qty: l.qty, direction: "Out" }))));
    return [...grnRows, ...holdRows, ...dispatchRows]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20);
  }, [db.grns, db.jobCards, db.challans, db.salesOrders, db.items]);

  const exportCSV = () => {
    downloadCSV("inventory.csv", [
      ["Name", "Category", "Stock", "Unit", "Min", "Reorder", "Unit Cost (₹)", "Value (₹)"],
      ...items.map(i => [i.name, i.category, i.currentStock, i.unit, i.minStock, i.reorderLevel, unitCost(i).toFixed(2), (i.currentStock * unitCost(i)).toFixed(2)])
    ]);
  };

  const reconcileSfgStock = () => {
    let fixed = 0;
    setDB(d => {
      const net: Record<string, number> = {};
      (d.sfgBatches || []).forEach(b => { net[b.itemId] = (net[b.itemId] || 0) + (b.qtyProduced - b.qtyUsed); });
      const items = d.items.map(i => {
        if (i.category !== "Semi-Finished" || !(i.id in net)) return i;
        const expected = (i.openingStock || 0) + net[i.id];
        if (Math.abs((i.currentStock || 0) - expected) > 1e-9) { fixed++; return { ...i, currentStock: expected }; }
        return i;
      });
      return { ...d, items };
    });
    log("Reconciled SFG stock with SFG ledger", "Inventory");
    setUploadMessage(fixed ? `Fixed stock for ${fixed} SFG item(s) to match the SFG ledger.` : "All stock values already in sync.");
  };

  const downloadUploadTemplate = () => {    downloadCSV("inventory-upload-template.csv", [
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

      <div className="flex flex-wrap items-center gap-2" data-testid="inv-date-filter">
        {([["today", "Today"], ["yesterday", "Yesterday"], ["date", "Select Date"], ["month", "This Month"], ["lastmonth", "Last Month"], ["range", "Custom Date Range"]] as const).map(([k, lbl]) => (
          <button key={k} type="button" onClick={() => setDateMode(k)}
            className={"text-xs px-3 py-1.5 rounded-full border font-medium " + (dateMode === k ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 hover:border-indigo-400")}
            data-testid={`inv-date-${k}`}>{lbl}</button>
        ))}
        {dateMode === "date" && <Input type="date" className="!w-44" value={pickDate} max={todayISO()} onChange={(e: any) => setPickDate(e.target.value)} data-testid="inv-date-pick"/>}
        {dateMode === "range" && <>
          <Input type="date" className="!w-44" value={rangeFrom} max={rangeTo || todayISO()} onChange={(e: any) => setRangeFrom(e.target.value)} data-testid="inv-date-from"/>
          <span className="text-xs text-slate-400">to</span>
          <Input type="date" className="!w-44" value={rangeTo} max={todayISO()} onChange={(e: any) => setRangeTo(e.target.value)} data-testid="inv-date-to"/>
        </>}
        {dateMode === "range" && !rangeFrom && <span className="text-xs text-amber-600" data-testid="inv-range-hint">Pick a From date to see movements</span>}
        <span className="text-xs text-slate-500 ml-1" data-testid="inv-asof-label">{isLive ? "Live stock (today)" : period.from ? `Movements ${period.from} → ${asOf} · closing as of ${asOf}` : `Closing stock as of ${asOf}`}</span>
      </div>
      {!isLive && <div className="rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/30 px-3 py-2 text-xs text-indigo-800 dark:text-indigo-300" data-testid="inv-historical-banner">
        Historical view (read-only): Stock = today&apos;s stock reversed through every dated GRN, Raw Material Issue, SFG production/consumption and Dispatch after {asOf}. Valuation uses purchase rates up to that date. Same values feed Monthly P&amp;L Opening/Closing Stock.
      </div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          ["all", <KPI label={`Total Items · ${catLabel}`} value={String(catItems.length)} color="indigo" icon={<IconBox size={22}/>} hint="click to list all items" />],
          ["value", <KPI label={`Stock Value · ${catLabel}`} value={fmtINR(totalValue)} color="emerald" icon={<IconBox size={22}/>} hint={isLive ? "RM/SFG: avg last 3 purchases · FG: sale price" : `as of ${asOf} · rates up to that date`}/>],
          ["low", <KPI label={`Low Stock · ${catLabel}`} value={String(lowCount)} color="rose" icon={<IconRefresh size={22}/>} hint="stock ≤ minimum" />],
        ] as const).map(([k, el]) => (
          <button key={k} type="button" onClick={() => setView(k)} data-testid={`inv-kpi-${k}`}
            className={"text-left rounded-xl transition-shadow " + (view === k ? "ring-2 ring-indigo-500 shadow-md" : "hover:ring-2 hover:ring-indigo-200 dark:hover:ring-indigo-900")}>{el}</button>
        ))}
        <KPI label="Held Inventory" value={fmt2(activeHeldQty)} color="amber" icon={<IconClipboard size={22}/>} hint={isLive ? "active job holds" : `pending holds as of ${asOf}`} />
      </div>

      <Card>
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100 dark:border-slate-800">
          <div className="relative flex-1 min-w-48">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <Input className="pl-9" placeholder="Search by any keyword (e.g. Copper, DPC, 4.6x2.1)..." value={search} onChange={(e: any) => setSearch(e.target.value)} data-testid="inventory-search"/>
          </div>
          <Select value={filter} onChange={(e: any) => setFilter(e.target.value)} className="w-52" data-testid="inv-category-filter">
            <option value="all">All Items</option><option value="raw">Raw Material</option><option value="semi">Semi-Finished Goods (SFG)</option><option value="fg">Finished Goods (FG)</option>
          </Select>
          {canUpload && isLive && <Button variant="outline" onClick={downloadUploadTemplate}><IconDownload size={14}/> Template</Button>}
          {canUpload && isLive && (
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
          {canUpload && isLive && <Button variant="outline" onClick={reconcileSfgStock} title="Recompute SFG item stock from the SFG production/consumption ledger and fix any mismatch" data-testid="sync-stock-btn"><IconRefresh size={14}/> Sync Stock</Button>}
        </div>
        <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2 text-xs" data-testid="inv-view-strip">
          <span className="text-slate-500">Showing:</span>
          <Badge color={view === "low" ? "red" : view === "value" ? "green" : "blue"}>{view === "low" ? "Low Stock" : view === "value" ? "Stock Valuation" : "All Items"} · {catLabel} · {items.length}</Badge>
          {view !== "all" && <button type="button" className="text-indigo-600 hover:underline" onClick={() => setView("all")} data-testid="inv-view-clear">Show all</button>}
          {view === "value" && catBreakdown.map(b => (
            <span key={b.c} className="ml-2 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-0.5" data-testid={`inv-value-${b.c.replace(/\s+/g, "-").toLowerCase()}`}>{b.c}: {b.count} items · {fmt2(b.qty)} qty · <b className="text-emerald-600">{fmtINR(b.value)}</b></span>
          ))}
        </div>
        {canUpload && uploadMessage && <div className="px-4 py-2 text-xs border-b border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-300">{uploadMessage}</div>}
        <div className="px-4 py-3 border-b border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 flex items-center justify-between gap-3 flex-wrap text-sm">
          <div>
            <div className="font-semibold text-amber-800 dark:text-amber-300">Single Central Stock Active</div>
            <div className="text-xs text-amber-700 dark:text-amber-400">Required Quantity = Hold (Job Card) − Current Stock, only when Hold is greater — issues deduct Current Stock immediately</div>
          </div>
          <div className="font-mono text-xs text-amber-800 dark:text-amber-300">Item Master = Inventory = Current Stock</div>
        </div>
        <Table>
          <thead><tr>
            <Th>Material Details</Th>
            <Th>UOM</Th>
            {flows && <><Th>Opening ({dayBefore(period.from!)})</Th><Th>Stock In</Th><Th>Stock Out</Th></>}
            <Th className="cursor-pointer select-none hover:text-indigo-600" onClick={() => toggleSort("current")} data-testid="inv-sort-current">{isLive ? "Current Stock" : `Stock as of ${asOf}`}{arrow("current")}</Th>
            <Th className="cursor-pointer select-none hover:text-indigo-600" onClick={() => toggleSort("hold")} data-testid="inv-sort-hold">Hold (Job Card){arrow("hold")}</Th>
            <Th className="cursor-pointer select-none hover:text-indigo-600" onClick={() => toggleSort("available")} data-testid="inv-sort-available">Required Quantity{arrow("available")}</Th>
            <Th className="cursor-pointer select-none hover:text-indigo-600" onClick={() => toggleSort("cost")} data-testid="inv-sort-cost">Avg Unit Cost{arrow("cost")}</Th>
            <Th className="cursor-pointer select-none hover:text-indigo-600" onClick={() => toggleSort("value")} data-testid="inv-sort-value">Total Valuation (₹){arrow("value")}</Th>
            <Th className="cursor-pointer select-none hover:text-indigo-600" onClick={() => toggleSort("status")} data-testid="inv-sort-status">Safety Buffer Status{arrow("status")}</Th>
          </tr></thead>
          <tbody>
            {controlRows.map(({ item: i, hold, required, totalStock, status }) => {
              const low = i.currentStock <= i.minStock;
              const statusColor = status === "Healthy" ? "green" : status === "Reorder Soon" ? "yellow" : "red";
              return (
                <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td>
                    <button type="button" className="font-semibold text-left text-slate-800 dark:text-slate-100 hover:text-indigo-600 hover:underline" onClick={() => setHistoryItem(db.items.find(x => x.id === i.id) || null)} title="View stock in / out history" data-testid={`inv-item-name-${i.id}`}>{i.name}</button>
                    <div className="mt-1"><Badge color={i.category === "Raw Material" ? "blue" : i.category === "Finished Goods" ? "green" : "yellow"}>{i.category}</Badge></div>
                  </Td>
                  <Td className="font-medium">{i.unit}</Td>
                  {flows && <>
                    <Td data-testid={`inv-open-${i.id}`}>{fmt2(openStock?.get(i.id) || 0)}</Td>
                    <Td className="text-emerald-600" data-testid={`inv-in-${i.id}`}>{fmt2(flows.inQ.get(i.id) || 0)}</Td>
                    <Td className="text-rose-600" data-testid={`inv-out-${i.id}`}>{fmt2(flows.outQ.get(i.id) || 0)}</Td>
                  </>}
                  <Td className="font-semibold" data-testid={`inv-stock-${i.id}`}>{fmt2(totalStock)} {i.unit}</Td>
                  <Td className="font-semibold text-amber-600">{fmt2(hold)} {i.unit}</Td>
                  <Td><span className={required > 0 ? "text-rose-600 font-bold" : "font-bold text-emerald-600"}>{fmt2(required)} {i.unit}</span>{required > 0 && <div className="text-[9px] text-rose-500">shortfall to procure</div>}</Td>
                  <Td>{fmtINR(unitCost(i))}
                    {!isLive ? <div className="text-[9px] text-slate-400">{rateAsOf(i, ledger, asOf).basis} (to {asOf})</div> : i.category === "Finished Goods"
                      ? <div className="text-[9px] text-slate-400">latest sale price</div>
                      : lastPurchaseRates[i.id]
                        ? <div className="text-[9px] text-slate-400">avg of last {lastPurchaseRates[i.id].count} purchase{lastPurchaseRates[i.id].count > 1 ? "s" : ""}</div>
                        : <div className="text-[9px] text-slate-400">item master rate</div>}
                  </Td>
                  <Td className="font-semibold text-indigo-700 dark:text-indigo-300">{fmtINR(i.currentStock * unitCost(i))}</Td>
                  <Td><Badge color={statusColor}>{status}</Badge><div className="text-[10px] text-slate-500 mt-1">Min {fmt2(i.minStock)} / Reorder {fmt2(i.reorderLevel)}</div></Td>
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
                <Td className="font-semibold text-amber-600">{fmt2(r.qtyHeld)} {r.item?.unit}</Td>
                <Td>{fmt2(r.availableQty)} {r.item?.unit}</Td>
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
                <Td>{fmt2(m.qty)} {m.item?.unit || "Nos"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {movementRows.length === 0 && <Empty title="No stock movements yet" />}
      </Card>
      <MaterialHistoryModal item={historyItem} onClose={() => setHistoryItem(null)} />
    </div>
  );
}
