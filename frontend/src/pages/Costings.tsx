import { useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import type { CostingSheet, CostingMaterial, Item } from "../lib/types";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
import { IconPlus, IconEdit, IconTrash, IconSearch, IconPrint, IconRefresh, IconChart } from "../components/icons";
import { fmt2, fmtINR, nextNumber, todayISO, professionalDocument, printArea } from "../lib/utils";
import { userCan } from "../lib/permissions";

const UNIT_OPTIONS = ["Kg", "Nos", "Ltr", "Mtr", "Pcs", "Sets", "Sheets", "Roll", "Bag", "Box"];

// The Item.unit is the source of truth; keep this list for freshly-created inline items only.

function computeTotals(materials: CostingMaterial[], marginPct: number, labourPct: number = 0, officePct: number = 0) {
  const materialCost = materials.reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.rate) || 0), 0);
  const labourAmt = materialCost * ((Number(labourPct) || 0) / 100);
  const officeAmt = materialCost * ((Number(officePct) || 0) / 100);
  const totalCost = materialCost + labourAmt + officeAmt;
  const salePrice = totalCost * (1 + (Number(marginPct) || 0) / 100);
  const profit = salePrice - totalCost;
  return { materialCost, labourAmt, officeAmt, totalCost, salePrice, profit };
}

export function Costings() {
  const { db, setDB, currentUser, log } = useStore();
  const canView = userCan(currentUser, "costing", "view");
  const canCreate = userCan(currentUser, "costing", "create");
  const canEdit = userCan(currentUser, "costing", "edit");
  const canDelete = userCan(currentUser, "costing", "delete");
  const canPrint = userCan(currentUser, "costing", "print");
  const isAdmin = currentUser?.role === "admin";

  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [versionFilter, setVersionFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [edit, setEditing] = useState<CostingSheet | null>(null);
  const [historyFor, setHistoryFor] = useState<CostingSheet | null>(null);
  const [trendFor, setTrendFor] = useState<CostingSheet | null>(null);
  const [showNewItemInline, setShowNewItemInline] = useState(false);
  const [newItem, setNewItem] = useState<Partial<Item>>({ name: "", category: "Finished Goods", unit: "Nos", gstRate: 18, purchaseRate: 0, saleRate: 0 });

  const finishedGoods = db.items.filter(i => i.category === "Finished Goods");
  const rawMaterials = db.items.filter(i => i.category === "Raw Material" || i.category === "Semi-Finished");

  const blank = (): CostingSheet => ({
    id: "",
    number: nextNumber("CST", db.costings),
    title: "",
    productItemId: "",
    productName: "",
    materials: [],
    gstRate: 18,
    marginPct: 15,
    labourPct: 0,
    officePct: 0,
    status: "draft",
    locked: false,
    ownerId: currentUser?.id || "",
    createdAt: new Date().toISOString(),
    version: 1,
    history: [],
  });

  const [form, setForm] = useState<CostingSheet>(blank());

  const list = useMemo(() => {
    let arr = db.costings.filter(c => isAdmin || c.ownerId === currentUser?.id);
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter(c =>
        (c.number || "").toLowerCase().includes(q) ||
        (c.title || "").toLowerCase().includes(q) ||
        (c.productName || "").toLowerCase().includes(q)
      );
    }
    if (productFilter) arr = arr.filter(c => (c.productName || c.title || "") === productFilter);
    if (statusFilter) arr = arr.filter(c => (c.locked ? "locked" : c.status) === statusFilter);
    if (versionFilter) arr = arr.filter(c => `v${c.version || 1}` === versionFilter);
    if (fromDate) arr = arr.filter(c => c.createdAt.slice(0, 10) >= fromDate);
    if (toDate) arr = arr.filter(c => c.createdAt.slice(0, 10) <= toDate);
    // Sort by manual sequence first, then newest
    return [...arr].sort((a, b) => {
      const sa = a.sequence ?? 9999;
      const sb = b.sequence ?? 9999;
      if (sa !== sb) return sa - sb;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [db.costings, isAdmin, currentUser, search, productFilter, statusFilter, versionFilter, fromDate, toDate]);

  const productOptions = useMemo(() => Array.from(new Set(db.costings.map(c => c.productName || c.title).filter(Boolean))).sort(), [db.costings]);
  const versionOptions = useMemo(() => Array.from(new Set(db.costings.map(c => `v${c.version || 1}`))).sort(), [db.costings]);
  const selectedList = list.filter(c => selectedIds.has(c.id));

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === list.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(list.map(c => c.id)));
  };
  const clearFilters = () => {
    setSearch(""); setProductFilter(""); setStatusFilter(""); setVersionFilter(""); setFromDate(""); setToDate("");
  };

  const handleDragStart = (id: string) => setDragId(id);
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    // Build ordered list of ids using current sort, then reorder
    const currentOrder = list.map(c => c.id);
    const from = currentOrder.indexOf(dragId);
    const to = currentOrder.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const reordered = [...currentOrder];
    reordered.splice(from, 1);
    reordered.splice(to, 0, dragId);
    // Persist sequence 0..n
    const seqMap = new Map(reordered.map((id, i) => [id, i]));
    setDB(d => ({
      ...d,
      costings: d.costings.map(c => seqMap.has(c.id) ? { ...c, sequence: seqMap.get(c.id) } : c),
    }));
    setDragId(null);
  };

  const openNew = () => {
    setEditing(null);
    setForm(blank());
    setOpen(true);
    setShowNewItemInline(false);
  };
  const openEdit = (c: CostingSheet) => {
    setEditing(c);
    setForm({ ...c, materials: c.materials.map(m => ({ ...m })), history: c.history || [] });
    setOpen(true);
    setShowNewItemInline(false);
  };

  const pickFinishedGood = (itemId: string) => {
    const it = db.items.find(x => x.id === itemId);
    setForm(f => ({
      ...f,
      productItemId: itemId,
      productName: it?.name || "",
      title: f.title || it?.name || "",
      gstRate: it?.gstRate ?? f.gstRate,
    }));
  };

  const createInlineFinishedGood = () => {
    if (!newItem.name?.trim()) return alert("Product name is required");
    const item: Item = {
      id: uid(),
      name: newItem.name.trim(),
      category: "Finished Goods",
      unit: newItem.unit || "Nos",
      hsn: "",
      gstRate: Number(newItem.gstRate) || 18,
      openingStock: 0,
      currentStock: 0,
      minStock: 0,
      reorderLevel: 0,
      purchaseRate: Number(newItem.purchaseRate) || 0,
      saleRate: Number(newItem.saleRate) || 0,
    };
    setDB(d => ({ ...d, items: [item, ...d.items] }));
    setForm(f => ({ ...f, productItemId: item.id, productName: item.name, title: f.title || item.name, gstRate: item.gstRate }));
    setNewItem({ name: "", category: "Finished Goods", unit: "Nos", gstRate: 18, purchaseRate: 0, saleRate: 0 });
    setShowNewItemInline(false);
  };

  const addMaterial = () => {
    setForm(f => ({ ...f, materials: [...f.materials, { itemId: "", name: "", unit: "Nos", qty: 1, rate: 0 }] }));
  };
  const pickMaterial = (idx: number, itemId: string) => {
    const it = db.items.find(x => x.id === itemId);
    if (!it) return;
    setForm(f => ({
      ...f,
      materials: f.materials.map((m, i) => i === idx ? { ...m, itemId: it.id, name: it.name, unit: it.unit || m.unit || "Nos", rate: Number(it.purchaseRate) || m.rate || 0 } : m),
    }));
  };
  const updateMaterial = (idx: number, patch: Partial<CostingMaterial>) => {
    setForm(f => ({ ...f, materials: f.materials.map((m, i) => i === idx ? { ...m, ...patch } : m) }));
  };
  const removeMaterial = (idx: number) => {
    setForm(f => ({ ...f, materials: f.materials.filter((_, i) => i !== idx) }));
  };

  const totals = computeTotals(form.materials, form.marginPct, form.labourPct || 0, form.officePct || 0);

  const save = () => {
    if (!form.title.trim()) return alert("Enter a title (or pick a Finished Good)");
    if (form.materials.length === 0) return alert("Add at least one raw material");
    const payload: CostingSheet = { ...form, locked: true };

    if (edit) {
      // Push previous state to history and bump version
      const prev = edit;
      const prevSnapshot = {
        version: prev.version || 1,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.id,
        materials: prev.materials.map(m => ({ ...m })),
        marginPct: prev.marginPct,
        gstRate: prev.gstRate,
        totalCost: computeTotals(prev.materials, prev.marginPct, prev.labourPct || 0, prev.officePct || 0).totalCost,
        salePrice: computeTotals(prev.materials, prev.marginPct, prev.labourPct || 0, prev.officePct || 0).salePrice,
        profit: computeTotals(prev.materials, prev.marginPct, prev.labourPct || 0, prev.officePct || 0).profit,
      };
      payload.version = (prev.version || 1) + 1;
      payload.history = [...(prev.history || []), prevSnapshot];
      setDB(d => ({ ...d, costings: d.costings.map(x => x.id === edit.id ? payload : x) }));
      log(`Updated costing ${payload.number} → v${payload.version}`, "Costing");
    } else {
      payload.id = uid();
      payload.version = 1;
      payload.history = [];
      setDB(d => ({ ...d, costings: [payload, ...d.costings] }));
      log(`Created costing ${payload.number}`, "Costing");
    }
    setOpen(false);
  };

  const unlockForEdit = (c: CostingSheet) => {
    // Simply open the edit modal — save will lock it back and push history
    openEdit(c);
  };

  const duplicateCosting = (c: CostingSheet) => {
    setEditing(null);
    setForm({
      ...blank(),
      title: `${c.title} (Copy)`,
      productItemId: c.productItemId,
      productName: c.productName,
      kva: c.kva,
      customerId: c.customerId,
      gstRate: c.gstRate,
      marginPct: c.marginPct,
      labourPct: c.labourPct || 0,
      officePct: c.officePct || 0,
      materials: c.materials.map(m => ({ ...m })),
    });
    setOpen(true);
    setShowNewItemInline(false);
  };

  const refreshMaterialRates = () => {
    let updated = 0;
    setForm(f => ({
      ...f,
      materials: f.materials.map(m => {
        const it = m.itemId
          ? db.items.find(x => x.id === m.itemId)
          : db.items.find(x => x.name.toLowerCase() === m.name.toLowerCase());
        if (it && Number(it.purchaseRate) > 0 && Number(it.purchaseRate) !== Number(m.rate)) {
          updated += 1;
          return { ...m, itemId: it.id, unit: m.unit || it.unit || "Nos", rate: Number(it.purchaseRate) };
        }
        return m;
      }),
    }));
    setTimeout(() => alert(updated > 0
      ? `Refreshed ${updated} material rate${updated === 1 ? "" : "s"} from Item Master.`
      : "All material rates already match the latest Item Master purchase rates."), 50);
  };

  const remove = (c: CostingSheet) => {
    if (!confirm(`Delete costing ${c.number}?`)) return;
    setDB(d => ({ ...d, costings: d.costings.filter(x => x.id !== c.id) }));
    log(`Deleted costing ${c.number}`, "Costing");
  };

  const printCosting = (c: CostingSheet) => {
    const t = computeTotals(c.materials, c.marginPct, c.labourPct || 0, c.officePct || 0);
    const body = `
      <div class="box"><div class="section-title">Product</div>
        <b>${c.productName || c.title}</b><br/>${c.kva ? `Rating: ${c.kva}<br/>` : ""}
        Version: v${c.version || 1}${c.locked ? " · LOCKED" : ""}
      </div>
      <table>
        <thead><tr><th>#</th><th>Material</th><th>Unit</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead>
        <tbody>
          ${c.materials.map((m, i) => `<tr>
            <td>${i + 1}</td>
            <td>${m.name}</td>
            <td>${m.unit || ""}</td>
            <td class="right">${fmt2(m.qty)}</td>
            <td class="right">${fmt2(m.rate)}</td>
            <td class="right">${fmt2(m.qty * m.rate)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      <table style="margin-top:8px;max-width:340px;margin-left:auto">
        <tr><td>Material Cost</td><td class="right">${fmtINR(t.materialCost)}</td></tr>
        <tr><td>Labour @ ${fmt2(c.labourPct || 0)}%</td><td class="right">${fmtINR(t.labourAmt)}</td></tr>
        <tr><td>Office Expenses @ ${fmt2(c.officePct || 0)}%</td><td class="right">${fmtINR(t.officeAmt)}</td></tr>
        <tr><td>Total Costing</td><td class="right"><b>${fmtINR(t.totalCost)}</b></td></tr>
        <tr><td>Profit %</td><td class="right">${fmt2(c.marginPct)}%</td></tr>
        <tr><td>Profit</td><td class="right">${fmtINR(t.profit)}</td></tr>
        <tr><td><b>Sale Price</b></td><td class="right"><b>${fmtINR(t.salePrice)}</b></td></tr>
      </table>
    `;
    const html = professionalDocument(db.settings, { title: "Costing Sheet", number: c.number, date: c.createdAt.slice(0, 10), body, accent: "#0891b2" });
    printArea(html, c.number);
  };

  if (!canView) return <div className="p-6"><Empty title="No access — you do not have permission to view Costings" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Costing Sheets</h1>
          <p className="text-sm text-slate-500">Build a bill of costs for each finished good with automatic profit &amp; sale price calculation.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={selectedIds.size >= 2 ? "primary" : "outline"}
            disabled={selectedIds.size < 2}
            onClick={() => setCompareOpen(true)}
            data-testid="compare-costings-btn"
          >
            Compare Selected {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
          </Button>
          {canCreate && <Button onClick={openNew} data-testid="new-costing-btn"><IconPlus size={14}/> New Costing</Button>}
        </div>
      </div>

      <Card>
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 grid sm:grid-cols-6 gap-2 text-sm">
          <div className="sm:col-span-2 relative">
            <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
            <Input className="pl-9" placeholder="Search costing no / title / product..." value={search} onChange={(e: any) => setSearch(e.target.value)} data-testid="costing-search"/>
          </div>
          <Select value={productFilter} onChange={(e: any) => setProductFilter(e.target.value)} data-testid="costing-filter-product">
            <option value="">All Products</option>
            {productOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Select value={versionFilter} onChange={(e: any) => setVersionFilter(e.target.value)} data-testid="costing-filter-version">
            <option value="">All Versions</option>
            {versionOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </Select>
          <Select value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)} data-testid="costing-filter-status">
            <option value="">All Statuses</option>
            <option value="locked">Locked</option>
            <option value="draft">Draft</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </Select>
          <div className="flex gap-1">
            <Input type="date" value={fromDate} onChange={(e: any) => setFromDate(e.target.value)} title="From date" data-testid="costing-filter-from" />
            <Input type="date" value={toDate} onChange={(e: any) => setToDate(e.target.value)} title="To date" data-testid="costing-filter-to" />
          </div>
          {(search || productFilter || statusFilter || versionFilter || fromDate || toDate) && (
            <button onClick={clearFilters} className="sm:col-span-6 text-left text-xs text-indigo-600 hover:underline" data-testid="costing-clear-filters">Clear all filters</button>
          )}
        </div>
        <Table>
          <thead><tr>
            <Th className="w-8">
              <input
                type="checkbox"
                checked={list.length > 0 && selectedIds.size === list.length}
                onChange={toggleSelectAll}
                data-testid="costing-select-all"
              />
            </Th>
            <Th className="w-6"></Th>
            <Th>#</Th><Th>Date</Th><Th>Product</Th><Th>Title</Th><Th className="text-right">Total Cost</Th><Th className="text-right">Margin</Th><Th className="text-right">Sale Price</Th><Th>Version</Th><Th>Status</Th><Th></Th>
          </tr></thead>
          <tbody>
            {list.map(c => {
              const t = computeTotals(c.materials, c.marginPct, c.labourPct || 0, c.officePct || 0);
              const isSelected = selectedIds.has(c.id);
              return (
                <tr
                  key={c.id}
                  className={"hover:bg-slate-50 dark:hover:bg-slate-800/50 " + (isSelected ? "bg-indigo-50/50 dark:bg-indigo-900/20 " : "") + (dragId === c.id ? "opacity-50 " : "")}
                  draggable
                  onDragStart={() => handleDragStart(c.id)}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(c.id)}
                  data-testid={`costing-row-${c.id}`}
                >
                  <Td>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(c.id)}
                      onClick={e => e.stopPropagation()}
                      data-testid={`costing-select-${c.id}`}
                    />
                  </Td>
                  <Td className="cursor-move text-slate-400 select-none" title="Drag to reorder">⋮⋮</Td>
                  <Td className="font-mono text-xs">
                    <button
                      className="text-indigo-600 hover:underline"
                      onClick={() => openEdit(c)}
                      data-testid={`costing-view-${c.id}`}
                    >{c.number}</button>
                  </Td>
                  <Td>{c.createdAt.slice(0, 10)}</Td>
                  <Td className="font-medium">{c.productName || "—"}</Td>
                  <Td>{c.title}</Td>
                  <Td className="text-right">{fmtINR(t.totalCost)}</Td>
                  <Td className="text-right">{fmt2(c.marginPct)}%</Td>
                  <Td className="text-right font-semibold text-emerald-600">{fmtINR(t.salePrice)}</Td>
                  <Td>
                    <Badge color="blue">v{c.version || 1}</Badge>
                    {(c.history?.length || 0) > 0 && (
                      <button onClick={() => setHistoryFor(c)} className="ml-1 text-[10px] text-indigo-600 hover:underline" data-testid={`costing-history-${c.id}`}>history</button>
                    )}
                  </Td>
                  <Td>{c.locked ? <Badge color="amber">Locked</Badge> : <Badge color="green">Draft</Badge>}</Td>
                  <Td>
                    <div className="flex gap-1">
                      {canCreate && <Button size="sm" variant="ghost" title="Duplicate costing" onClick={() => duplicateCosting(c)} data-testid={`costing-duplicate-${c.id}`}><IconPlus size={14}/></Button>}
                      <Button size="sm" variant="ghost" title="Cost trend" onClick={() => setTrendFor(c)} data-testid={`costing-trend-${c.id}`}><IconChart size={14}/></Button>
                      {canEdit && c.locked && <Button size="sm" variant="ghost" title="Edit costing" onClick={() => unlockForEdit(c)} data-testid={`costing-edit-${c.id}`}><IconEdit size={14}/></Button>}
                      {canEdit && !c.locked && <Button size="sm" variant="ghost" title="Continue draft" onClick={() => openEdit(c)}><IconEdit size={14}/></Button>}
                      {canPrint && <Button size="sm" variant="ghost" title="Print" onClick={() => printCosting(c)}><IconPrint size={14}/></Button>}
                      {canDelete && <Button size="sm" variant="ghost" onClick={() => remove(c)}><IconTrash size={14}/></Button>}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {list.length === 0 && <Empty title="No costings match the current filters" />}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit Costing · ${edit.number}${edit.locked ? " (Locked → will save as new version)" : ""}` : "New Costing"} size="xl">
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label>Number</Label><Input value={form.number} disabled /></div>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between">
              <Label>Finished Good (from Item Master)</Label>
              <button
                type="button"
                onClick={() => setShowNewItemInline(v => !v)}
                className="text-xs text-indigo-600 hover:underline"
                data-testid="costing-new-item-toggle"
              >
                {showNewItemInline ? "Cancel" : "+ Create New Finished Good"}
              </button>
            </div>
            {!showNewItemInline ? (
              <Select
                value={form.productItemId || ""}
                onChange={(e: any) => pickFinishedGood(e.target.value)}
                data-testid="costing-fg-select"
              >
                <option value="">— Select Finished Good —</option>
                {finishedGoods.map(fg => <option key={fg.id} value={fg.id}>{fg.name}</option>)}
              </Select>
            ) : (
              <div className="rounded-lg border border-indigo-200 dark:border-indigo-700 p-3 bg-indigo-50/60 dark:bg-indigo-900/20 grid sm:grid-cols-2 gap-2">
                <div className="sm:col-span-2"><Label>Product Name *</Label><Input value={newItem.name || ""} onChange={(e: any) => setNewItem(v => ({ ...v, name: e.target.value }))} data-testid="costing-new-item-name" /></div>
                <div><Label>Unit</Label>
                  <Select value={newItem.unit || "Nos"} onChange={(e: any) => setNewItem(v => ({ ...v, unit: e.target.value }))}>
                    {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                  </Select>
                </div>
                <div><Label>GST %</Label><Input type="number" value={newItem.gstRate || 18} onChange={(e: any) => setNewItem(v => ({ ...v, gstRate: Number(e.target.value) || 0 }))} /></div>
                <div className="sm:col-span-2 text-right">
                  <Button size="sm" onClick={createInlineFinishedGood} data-testid="costing-create-item-btn">Create & Select</Button>
                </div>
              </div>
            )}
          </div>
          <div className="sm:col-span-2"><Label>Title / Description</Label><Input value={form.title} onChange={(e: any) => setForm({ ...form, title: e.target.value })} placeholder="e.g., 100 kVA 11/0.433 kV Oil Immersed Transformer" data-testid="costing-title" /></div>
          <div><Label>KVA / Rating</Label><Input value={form.kva || ""} onChange={(e: any) => setForm({ ...form, kva: e.target.value })} /></div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Raw Material (from Item Master)</Th>
                <Th>Unit</Th>
                <Th className="text-right">Qty / Weight</Th>
                <Th className="text-right">Rate</Th>
                <Th className="text-right">Amount</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {form.materials.map((m, i) => (
                <tr key={i}>
                  <Td>{i + 1}</Td>
                  <Td className="min-w-[260px]">
                    <Input
                      value={m.name}
                      list={`costing-mat-suggest-${i}`}
                      onChange={(e: any) => {
                        const val = e.target.value;
                        // Attempt to match by name
                        const found = rawMaterials.find(x => x.name.toLowerCase() === val.toLowerCase());
                        if (found) {
                          pickMaterial(i, found.id);
                        } else {
                          updateMaterial(i, { name: val, itemId: "" });
                        }
                      }}
                      placeholder="Type material name..."
                      data-testid={`costing-mat-name-${i}`}
                    />
                    <datalist id={`costing-mat-suggest-${i}`}>
                      {rawMaterials.map(rm => <option key={rm.id} value={rm.name}>{rm.category} · ₹{fmt2(rm.purchaseRate)}</option>)}
                    </datalist>
                  </Td>
                  <Td>
                    <Select value={m.unit || "Nos"} onChange={(e: any) => updateMaterial(i, { unit: e.target.value })}>
                      {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                    </Select>
                  </Td>
                  <Td className="text-right">
                    <Input type="number" value={m.qty} onChange={(e: any) => updateMaterial(i, { qty: Number(e.target.value) || 0 })} className="w-24 text-right" data-testid={`costing-mat-qty-${i}`} />
                  </Td>
                  <Td className="text-right">
                    <Input type="number" value={m.rate} onChange={(e: any) => updateMaterial(i, { rate: Number(e.target.value) || 0 })} className="w-28 text-right" data-testid={`costing-mat-rate-${i}`} />
                  </Td>
                  <Td className="text-right font-medium">{fmtINR(m.qty * m.rate)}</Td>
                  <Td>
                    <Button size="sm" variant="ghost" onClick={() => removeMaterial(i)}><IconTrash size={14}/></Button>
                  </Td>
                </tr>
              ))}
              {form.materials.length === 0 && (
                <tr><Td colSpan={7} className="text-center text-slate-500 py-6">No materials added yet.</Td></tr>
              )}
            </tbody>
          </Table>
          <div className="p-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={addMaterial} data-testid="costing-add-material"><IconPlus size={14}/> Add Raw Material</Button>
            {form.materials.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={refreshMaterialRates}
                data-testid="costing-refresh-rates"
                title="Pull the latest purchase rate for every material from Item Master"
              >
                <IconRefresh size={14}/> Refresh Rates from Item Master
              </Button>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Labour Charges %</Label>
                <Input type="number" value={form.labourPct ?? 0} onChange={(e: any) => setForm({ ...form, labourPct: Number(e.target.value) || 0 })} data-testid="costing-labour-pct" />
              </div>
              <div>
                <Label>Office Expenses %</Label>
                <Input type="number" value={form.officePct ?? 0} onChange={(e: any) => setForm({ ...form, officePct: Number(e.target.value) || 0 })} data-testid="costing-office-pct" />
              </div>
            </div>
            <div>
              <Label>Profit / Margin %</Label>
              <Input type="number" value={form.marginPct} onChange={(e: any) => setForm({ ...form, marginPct: Number(e.target.value) || 0 })} data-testid="costing-margin" />
            </div>
            <div>
              <Label>GST %</Label>
              <Input type="number" value={form.gstRate} onChange={(e: any) => setForm({ ...form, gstRate: Number(e.target.value) || 0 })} />
            </div>
            <div className="text-[11px] text-slate-500">
              Labour &amp; Office are calculated on <b>Material Cost</b> and added into Total Costing. Profit % is applied on Total Costing (Material + Labour + Office).
            </div>
          </div>
          <div className="rounded-lg border p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700 text-sm space-y-1">
            <div className="flex justify-between"><span>Material Cost</span><b>{fmtINR(totals.materialCost)}</b></div>
            <div className="flex justify-between"><span>Labour @ {fmt2(form.labourPct || 0)}%</span><b>{fmtINR(totals.labourAmt)}</b></div>
            <div className="flex justify-between"><span>Office Expenses @ {fmt2(form.officePct || 0)}%</span><b>{fmtINR(totals.officeAmt)}</b></div>
            <div className="flex justify-between border-t pt-1 mt-1"><span>Total Costing</span><b>{fmtINR(totals.totalCost)}</b></div>
            <div className="flex justify-between"><span>Profit %</span><b>{fmt2(form.marginPct)}%</b></div>
            <div className="flex justify-between"><span>Profit</span><b className="text-emerald-600">{fmtINR(totals.profit)}</b></div>
            <div className="flex justify-between text-base border-t pt-1 mt-1"><span>Sale Price</span><b className="text-indigo-700 dark:text-indigo-300">{fmtINR(totals.salePrice)}</b></div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} data-testid="costing-save-btn">{edit ? `Save as v${(edit.version || 1) + 1}` : "Save & Lock"}</Button>
        </div>
      </Modal>

      <Modal open={!!historyFor} onClose={() => setHistoryFor(null)} title={historyFor ? `Version History · ${historyFor.number}` : "History"} size="lg">
        {historyFor && (
          <div className="space-y-3">
            <Table>
              <thead><tr><Th>Version</Th><Th>Updated</Th><Th className="text-right">Total Cost</Th><Th className="text-right">Margin %</Th><Th className="text-right">Sale Price</Th><Th className="text-right">Materials</Th></tr></thead>
              <tbody>
                {[...(historyFor.history || [])].reverse().map(h => (
                  <tr key={h.version}>
                    <Td><Badge color="blue">v{h.version}</Badge></Td>
                    <Td className="text-xs">{h.updatedAt.slice(0, 16).replace("T", " ")}</Td>
                    <Td className="text-right">{fmtINR(h.totalCost)}</Td>
                    <Td className="text-right">{fmt2(h.marginPct)}%</Td>
                    <Td className="text-right">{fmtINR(h.salePrice)}</Td>
                    <Td className="text-right">{h.materials.length}</Td>
                  </tr>
                ))}
                <tr className="bg-emerald-50 dark:bg-emerald-900/20 font-semibold">
                  <Td><Badge color="green">v{historyFor.version || 1} (current)</Badge></Td>
                  <Td className="text-xs">{historyFor.createdAt.slice(0, 16).replace("T", " ")}</Td>
                  <Td className="text-right">{fmtINR(computeTotals(historyFor.materials, historyFor.marginPct, historyFor.labourPct || 0, historyFor.officePct || 0).totalCost)}</Td>
                  <Td className="text-right">{fmt2(historyFor.marginPct)}%</Td>
                  <Td className="text-right">{fmtINR(computeTotals(historyFor.materials, historyFor.marginPct, historyFor.labourPct || 0, historyFor.officePct || 0).salePrice)}</Td>
                  <Td className="text-right">{historyFor.materials.length}</Td>
                </tr>
              </tbody>
            </Table>
          </div>
        )}
      </Modal>

      <Modal open={!!trendFor} onClose={() => setTrendFor(null)} title={trendFor ? `Cost Trend · ${trendFor.productName || trendFor.title}` : "Cost Trend"} size="lg">
        {trendFor && (() => {
          const points = [
            ...(trendFor.history || []).map(h => ({
              version: h.version,
              at: h.updatedAt,
              cost: h.totalCost,
              sale: h.salePrice,
              margin: h.marginPct,
            })),
            {
              version: trendFor.version || 1,
              at: trendFor.createdAt,
              cost: computeTotals(trendFor.materials, trendFor.marginPct, trendFor.labourPct || 0, trendFor.officePct || 0).totalCost,
              sale: computeTotals(trendFor.materials, trendFor.marginPct, trendFor.labourPct || 0, trendFor.officePct || 0).salePrice,
              margin: trendFor.marginPct,
            },
          ];
          if (points.length < 2) {
            return <Empty title="Not enough versions yet — save an edit at least once to see the trend." />;
          }
          const maxCost = Math.max(...points.map(p => p.cost), 1);
          const minCost = Math.min(...points.map(p => p.cost));
          const first = points[0].cost;
          const last = points[points.length - 1].cost;
          const delta = last - first;
          const pctChange = first > 0 ? (delta / first) * 100 : 0;
          const W = 640;
          const H = 220;
          const pad = 30;
          const step = points.length > 1 ? (W - pad * 2) / (points.length - 1) : 0;
          const y = (v: number) => H - pad - ((v - minCost) / Math.max(1, maxCost - minCost)) * (H - pad * 2);
          const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${pad + i * step} ${y(p.cost)}`).join(" ");
          return (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-xs text-slate-500">Latest Cost</div>
                  <div className="text-lg font-bold">{fmtINR(last)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-xs text-slate-500">Change vs v1</div>
                  <div className={"text-lg font-bold " + (delta > 0 ? "text-rose-600" : delta < 0 ? "text-emerald-600" : "text-slate-600")}>
                    {delta >= 0 ? "+" : ""}{fmtINR(delta)} ({fmt2(pctChange)}%)
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-xs text-slate-500">Versions</div>
                  <div className="text-lg font-bold">{points.length}</div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-56">
                  <path d={path} fill="none" stroke="#4f46e5" strokeWidth="2" />
                  {points.map((p, i) => (
                    <g key={i}>
                      <circle cx={pad + i * step} cy={y(p.cost)} r="4" fill="#4f46e5" />
                      <text x={pad + i * step} y={y(p.cost) - 10} textAnchor="middle" fontSize="10" fill="#475569">₹{Math.round(p.cost).toLocaleString("en-IN")}</text>
                      <text x={pad + i * step} y={H - pad + 15} textAnchor="middle" fontSize="10" fill="#94a3b8">v{p.version}</text>
                    </g>
                  ))}
                </svg>
              </div>
              <Table>
                <thead><tr><Th>Version</Th><Th>Date</Th><Th className="text-right">Cost</Th><Th className="text-right">Margin</Th><Th className="text-right">Sale Price</Th><Th className="text-right">Δ vs prev</Th></tr></thead>
                <tbody>
                  {points.map((p, i) => {
                    const prev = i > 0 ? points[i - 1].cost : null;
                    const d = prev !== null ? p.cost - prev : null;
                    const dPct = prev && prev > 0 ? (d! / prev) * 100 : null;
                    return (
                      <tr key={i}>
                        <Td><Badge color={i === points.length - 1 ? "green" : "blue"}>v{p.version}{i === points.length - 1 ? " (current)" : ""}</Badge></Td>
                        <Td className="text-xs">{p.at.slice(0, 16).replace("T", " ")}</Td>
                        <Td className="text-right">{fmtINR(p.cost)}</Td>
                        <Td className="text-right">{fmt2(p.margin)}%</Td>
                        <Td className="text-right">{fmtINR(p.sale)}</Td>
                        <Td className={"text-right " + (d === null ? "text-slate-400" : d > 0 ? "text-rose-600" : d < 0 ? "text-emerald-600" : "")}>
                          {d === null ? "—" : `${d >= 0 ? "+" : ""}${fmtINR(d)} (${fmt2(dPct!)}%)`}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          );
        })()}
      </Modal>
      <Modal open={compareOpen} onClose={() => setCompareOpen(false)} title={`Compare Costings (${selectedList.length})`} size="xl">
        {selectedList.length < 2 ? (
          <Empty title="Select at least 2 costings to compare" />
        ) : (() => {
          // Union of material names across selected costings
          const matNames = Array.from(new Set(selectedList.flatMap(c => c.materials.map(m => m.name)))).sort();
          const matRows = matNames.map(name => {
            const perCosting = selectedList.map(c => c.materials.find(m => m.name === name));
            const qtyValues = perCosting.map(m => m ? Number(m.qty) : NaN);
            const rateValues = perCosting.map(m => m ? Number(m.rate) : NaN);
            const distinctQty = new Set(qtyValues.filter(v => !isNaN(v)));
            const distinctRate = new Set(rateValues.filter(v => !isNaN(v)));
            return { name, perCosting, qtyDiffers: distinctQty.size > 1, rateDiffers: distinctRate.size > 1 };
          });
          const totals = selectedList.map(c => computeTotals(c.materials, c.marginPct, c.labourPct || 0, c.officePct || 0));
          const totalCostDiffers = new Set(totals.map(t => t.totalCost.toFixed(2))).size > 1;
          const marginDiffers = new Set(selectedList.map(c => Number(c.marginPct).toFixed(2))).size > 1;
          const saleDiffers = new Set(totals.map(t => t.salePrice.toFixed(2))).size > 1;
          return (
            <div className="overflow-x-auto max-h-[70vh]">
              <Table>
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/70 backdrop-blur z-10">
                  <tr>
                    <Th>Field / Material</Th>
                    {selectedList.map(c => (
                      <Th key={c.id} className="text-right whitespace-nowrap">
                        <div>{c.number}</div>
                        <div className="text-[10px] text-slate-500 font-normal">v{c.version || 1} · {c.productName || "—"}</div>
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matRows.map(row => (
                    <tr key={row.name}>
                      <Td className="font-medium">{row.name}</Td>
                      {row.perCosting.map((m, i) => (
                        <Td key={i} className="text-right">
                          {m ? (
                            <div className="space-y-0.5">
                              <div className={row.qtyDiffers ? "px-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 inline-block" : ""}>
                                {fmt2(m.qty)} {m.unit || ""}
                              </div>
                              <div className={"text-xs " + (row.rateDiffers ? "px-1 rounded bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200 inline-block" : "text-slate-500")}>
                                @ {fmt2(m.rate)}
                              </div>
                            </div>
                          ) : <span className="text-slate-300">—</span>}
                        </Td>
                      ))}
                    </tr>
                  ))}
                  <tr className="bg-slate-100 dark:bg-slate-800/60 border-t-2 border-slate-300 dark:border-slate-600">
                    <Td className="font-semibold">Total Cost</Td>
                    {totals.map((t, i) => (
                      <Td key={i} className={"text-right font-semibold " + (totalCostDiffers ? "bg-amber-50 dark:bg-amber-900/20" : "")}>{fmtINR(t.totalCost)}</Td>
                    ))}
                  </tr>
                  <tr>
                    <Td className="font-semibold">Margin %</Td>
                    {selectedList.map((c, i) => (
                      <Td key={i} className={"text-right " + (marginDiffers ? "bg-amber-50 dark:bg-amber-900/20" : "")}>{fmt2(c.marginPct)}%</Td>
                    ))}
                  </tr>
                  <tr className="bg-emerald-50 dark:bg-emerald-900/20">
                    <Td className="font-semibold">Sale Price</Td>
                    {totals.map((t, i) => (
                      <Td key={i} className={"text-right font-bold text-emerald-700 dark:text-emerald-300 " + (saleDiffers ? "bg-amber-50 dark:bg-amber-900/30" : "")}>{fmtINR(t.salePrice)}</Td>
                    ))}
                  </tr>
                </tbody>
              </Table>
              <div className="mt-3 text-xs text-slate-500">
                <span className="inline-block px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 mr-2">amber</span> qty / total difference &nbsp;·&nbsp;
                <span className="inline-block px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200 mr-2">rose</span> rate difference
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
