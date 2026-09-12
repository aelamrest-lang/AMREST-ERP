import { useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
import { BarChart } from "../components/charts";
import type { Operator, ProductionStage } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint, IconSearch } from "../components/icons";
import { fmtINR, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

const PRODUCTION_STAGES: ProductionStage[] = [
  "LV Winding", "HV Winding", "Primary Winding",
  "Secondary Winding 1", "Secondary Winding 2", "Secondary Winding 3",
  "Core Coil Assembly", "Tanking", "Finishing", "Testing Ready", "Dispatch Ready",
];

function OperatorsMaster() {
  const { db, setDB, log, currentUser } = useStore();
  const canCreate = userCan(currentUser, "operators", "create");
  const canEdit = userCan(currentUser, "operators", "edit");
  const canDelete = userCan(currentUser, "operators", "delete");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Operator | null>(null);
  const blank: Operator = { id: "", name: "", department: "", stages: [], defaultRate: 0, active: true, createdAt: new Date().toISOString() };
  const [form, setForm] = useState<Operator>(blank);
  const stageMaster: string[] = db.settings.productionStages?.length ? db.settings.productionStages : PRODUCTION_STAGES;

  const toggleStage = (stage: ProductionStage) => {
    setForm(f => {
      const list = f.stages || [];
      return { ...f, stages: list.includes(stage) ? list.filter(s => s !== stage) : [...list, stage] };
    });
  };
  const toggleAllStages = () => {
    setForm(f => ({ ...f, stages: (f.stages || []).length === stageMaster.length ? [] : [...stageMaster] }));
  };

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? db.operators.filter(o => o.name.toLowerCase().includes(q) || (o.department || "").toLowerCase().includes(q)) : db.operators;
  }, [db.operators, search]);

  const openNew = () => { setEdit(null); setForm(blank); setOpen(true); };
  const openEdit = (o: Operator) => { setEdit(o); setForm({ ...o }); setOpen(true); };

  const save = () => {
    if (!form.name.trim()) return alert("Operator name is required");
    if (!form.stages || form.stages.length === 0) {
      if (!confirm("This operator isn't mapped to any production stage. They won't appear in the Production Entry dropdown for any stage. Save anyway?")) return;
    }
    if (edit) setDB(d => ({ ...d, operators: d.operators.map(o => o.id === edit.id ? form : o) }));
    else setDB(d => ({ ...d, operators: [{ ...form, id: uid() }, ...d.operators] }));
    log(`${edit ? "Updated" : "Created"} operator ${form.name}`, "Operators");
    setOpen(false);
  };

  const remove = (o: Operator) => {
    if (!confirm(`Delete operator ${o.name}? This will not affect past production entries.`)) return;
    setDB(d => ({ ...d, operators: d.operators.filter(x => x.id !== o.id) }));
    log(`Deleted operator ${o.name}`, "Operators");
  };

  const toggleActive = (o: Operator) => {
    setDB(d => ({ ...d, operators: d.operators.map(x => x.id === o.id ? { ...x, active: !x.active } : x) }));
  };

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div className="relative w-full sm:w-72">
          <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
          <Input className="pl-9" placeholder="Search operator by name / department..." value={search} onChange={(e: any) => setSearch(e.target.value)}/>
        </div>
        {canCreate && <Button onClick={openNew} data-testid="new-operator-btn"><IconPlus size={14}/> New Operator</Button>}
      </div>
      <Card>
        <Table>
          <thead><tr><Th>Name</Th><Th>Department</Th><Th>Assigned Stages</Th><Th>Default Rate (₹)</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {list.map(o => (
              <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Td className="font-medium">{o.name}</Td>
                <Td>{o.department || "—"}</Td>
                <Td className="max-w-md">
                  {o.stages && o.stages.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {o.stages.map(s => <Badge key={s} color="blue">{s}</Badge>)}
                    </div>
                  ) : (
                    <span className="text-xs text-amber-600">Not mapped</span>
                  )}
                </Td>
                <Td>{fmtINR(o.defaultRate || 0)}</Td>
                <Td>
                  <button
                    onClick={() => canEdit && toggleActive(o)}
                    disabled={!canEdit}
                    className={canEdit ? "cursor-pointer" : "cursor-default"}
                  >
                    <Badge color={o.active ? "green" : "amber"}>{o.active ? "Active" : "Inactive"}</Badge>
                  </button>
                </Td>
                <Td>
                  <div className="flex gap-1">
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(o)}><IconEdit size={14}/></Button>}
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => remove(o)}><IconTrash size={14}/></Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {list.length === 0 && <Empty title="No operators yet" />}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit ${edit.name}` : "New Operator"}>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label>Operator Name *</Label>
            <Input value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} data-testid="operator-name-input" />
          </div>
          <div>
            <Label>Department</Label>
            <Input value={form.department || ""} onChange={(e: any) => setForm({ ...form, department: e.target.value })} placeholder="e.g. Winding, Assembly, Testing" />
          </div>
          <div>
            <Label>Default Rate (₹ / unit)</Label>
            <Input type="number" value={form.defaultRate || 0} onChange={(e: any) => setForm({ ...form, defaultRate: Number(e.target.value) || 0 })} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active (available for production entry)
          </label>

          <div className="sm:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <Label>Assigned Production Stages *</Label>
              <button
                type="button"
                onClick={toggleAllStages}
                className="text-xs text-indigo-600 hover:underline"
                data-testid="operator-toggle-all-stages"
              >
                {(form.stages || []).length === stageMaster.length ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="grid sm:grid-cols-3 gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/30">
              {stageMaster.map(stage => {
                const checked = (form.stages || []).includes(stage);
                return (
                  <label key={stage} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleStage(stage)}
                      data-testid={`operator-stage-${stage.replace(/\s+/g, "-").toLowerCase()}`}
                    />
                    <span>{stage}</span>
                  </label>
                );
              })}
            </div>
            {(form.stages || []).length === 0 && (
              <div className="text-xs text-amber-600 mt-1">Pick at least one stage — the operator will only appear in the dropdown for those stages.</div>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} data-testid="operator-save-btn">{edit ? "Update" : "Create"}</Button>
        </div>
      </Modal>
    </div>
  );
}

function OperatorLedger() {
  const { db, currentUser } = useStore();
  const canPrint = userCan(currentUser, "operators", "print");
  const canExport = userCan(currentUser, "operators", "export");
  const currentMonth = todayISO().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [operatorIds, setOperatorIds] = useState<Set<string>>(new Set());
  const [operatorPickerOpen, setOperatorPickerOpen] = useState(false);
  const [operatorSearch, setOperatorSearch] = useState<string>("");

  const toggleOperator = (id: string) => {
    setOperatorIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllOperators = () => setOperatorIds(new Set(db.operators.map(o => o.id)));
  const clearOperators = () => setOperatorIds(new Set());

  // Helper: resolve the effective ₹/unit for a production entry.
  //  1) Entry.priceEach captured at save time (source of truth)
  //  2) Fallback → the linked Job Card's stagePrices[stage]
  //  3) Fallback → company-level Stage Prices master
  const resolvePriceEach = (e: any): number => {
    if (Number(e.priceEach) > 0) return Number(e.priceEach);
    const jc = db.jobCards.find(j => j.id === e.jobCardId);
    const jcPrice = jc?.stagePrices?.[e.stage];
    if (typeof jcPrice === "number" && jcPrice > 0) return jcPrice;
    const settingsPrice = db.settings.stagePrices?.[e.stage];
    if (typeof settingsPrice === "number" && settingsPrice > 0) return settingsPrice;
    return 0;
  };

  // Range filtering — if either date range field is set, use range; otherwise fall back to month.
  const useRange = !!(dateFrom || dateTo);

  const rows = useMemo(() => {
    return db.productionEntries
      .filter(e => {
        if (useRange) {
          if (dateFrom && e.date < dateFrom) return false;
          if (dateTo && e.date > dateTo) return false;
          return true;
        }
        return e.date.startsWith(month);
      })
      .filter(e => operatorIds.size === 0 || (e.operatorId && operatorIds.has(e.operatorId)))
      .map(e => {
        const priceEach = resolvePriceEach(e);
        return { ...e, priceEach, totalAmount: (Number(e.todayQty) || 0) * priceEach };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || (a.operatorName || "").localeCompare(b.operatorName || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.productionEntries, db.jobCards, db.settings.stagePrices, month, dateFrom, dateTo, operatorIds, useRange]);

  const summary = useMemo(() => {
    const byOperator = new Map<string, { name: string; qty: number; amount: number; entries: number }>();
    rows.forEach(r => {
      const key = r.operatorId || r.operatorName || "—";
      const prev = byOperator.get(key) || { name: r.operatorName || "—", qty: 0, amount: 0, entries: 0 };
      prev.qty += Number(r.todayQty) || 0;
      prev.amount += r.totalAmount;
      prev.entries += 1;
      byOperator.set(key, prev);
    });
    return Array.from(byOperator.values()).sort((a, b) => b.amount - a.amount);
  }, [rows]);

  const grandQty = rows.reduce((s, r) => s + (Number(r.todayQty) || 0), 0);
  const grandAmount = rows.reduce((s, r) => s + r.totalAmount, 0);

  // ---- Operator Performance Chart ----
  const [perfMetric, setPerfMetric] = useState<"qty" | "amount">("qty");
  const [perfMinQty, setPerfMinQty] = useState<number>(0);
  const [perfMinAmount, setPerfMinAmount] = useState<number>(0);
  const [perfDrill, setPerfDrill] = useState<string | null>(null); // operator name

  const rankedOperators = useMemo(() => {
    return summary
      .filter(s => s.qty >= perfMinQty && s.amount >= perfMinAmount)
      .slice()
      .sort((a, b) => perfMetric === "qty" ? b.qty - a.qty : b.amount - a.amount);
  }, [summary, perfMetric, perfMinQty, perfMinAmount]);

  const perfChartData = useMemo(() => rankedOperators.slice(0, 12).map(o => ({
    label: o.name.length > 12 ? o.name.slice(0, 12) + "…" : o.name,
    value: perfMetric === "qty" ? o.qty : Math.round(o.amount / 100), // ₹ in hundreds for readable bars
  })), [rankedOperators, perfMetric]);

  const perfDrillEntries = useMemo(() => {
    if (!perfDrill) return [];
    return rows.filter(r => r.operatorName === perfDrill)
      .slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [rows, perfDrill]);

  const monthLabel = new Date(`${month}-01`).toLocaleString("en-IN", { month: "long", year: "numeric" });
  const selectedOps = db.operators.filter(o => operatorIds.has(o.id));
  const opFilterLabel = operatorIds.size === 0
    ? "All Operators"
    : operatorIds.size === 1
      ? (selectedOps[0]?.name || "1 selected")
      : `${operatorIds.size} operators`;

  const printLedger = () => {
    const opFilterText = opFilterLabel;
    const body = `
      <div class="box">
        <div class="section-title">Operator Ledger — ${monthLabel}</div>
        <b>Operator:</b> ${opFilterText} · <b>Total Qty:</b> ${grandQty} · <b>Total Amount:</b> ${fmtINR(grandAmount)}
      </div>
      <table>
        <thead><tr>
          <th>Date</th><th>Operator</th><th>Job Card</th><th>Product</th><th>Stage</th>
          <th class="right">Qty</th><th>Shift</th><th class="right">Rate (₹)</th><th class="right">Amount (₹)</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td>${r.date}</td>
            <td>${r.operatorName}</td>
            <td>${r.jobCardNumber}</td>
            <td>${r.productName}</td>
            <td>${r.stage}</td>
            <td class="right">${r.todayQty}</td>
            <td>${r.shift}</td>
            <td class="right">${fmtINR(Number(r.priceEach) || 0)}</td>
            <td class="right">${fmtINR(r.totalAmount)}</td>
          </tr>`).join("")}
          <tr><td colspan="5"><b>Grand Total</b></td><td class="right"><b>${grandQty}</b></td><td></td><td></td><td class="right"><b>${fmtINR(grandAmount)}</b></td></tr>
        </tbody>
      </table>
      <div class="section-title" style="margin-top:14px">Operator-wise Summary</div>
      <table>
        <thead><tr><th>Operator</th><th class="right">Entries</th><th class="right">Total Qty</th><th class="right">Total Amount (₹)</th></tr></thead>
        <tbody>
          ${summary.map(s => `<tr><td>${s.name}</td><td class="right">${s.entries}</td><td class="right">${s.qty}</td><td class="right">${fmtINR(s.amount)}</td></tr>`).join("")}
        </tbody>
      </table>
    `;
    const html = professionalDocument(db.settings, { title: "Operator Ledger", number: `OP-${month}-${operatorIds.size === 1 ? (selectedOps[0]?.name || "OP") : (operatorIds.size ? "MULTI" : "ALL")}`, date: todayISO(), body, accent: "#0f766e" });
    printArea(html, `Operator-Ledger-${month}`);
  };

  const exportCSV = () => {
    const header = ["Date", "Operator", "Job Card", "Product", "Stage", "Qty", "Shift", "Rate (Rs)", "Amount (Rs)"];
    const csvRows = [
      header,
      ...rows.map(r => [r.date, r.operatorName, r.jobCardNumber, r.productName, r.stage, r.todayQty, r.shift, (Number(r.priceEach) || 0).toFixed(2), r.totalAmount.toFixed(2)]),
      ["", "", "", "", "Grand Total", grandQty, "", "", grandAmount.toFixed(2)],
    ];
    const csv = csvRows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `operator-ledger-${month}${operatorIds.size === 1 ? `-${selectedOps[0]?.name}` : (operatorIds.size ? "-multi" : "")}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div>
      <Card className="mb-3">
        <div className="p-3 flex flex-wrap items-end gap-3" data-testid="ledger-filters">
          <div>
            <Label>Month</Label>
            <Input type="month" value={month} onChange={(e: any) => { setMonth(e.target.value); setDateFrom(""); setDateTo(""); }} data-testid="ledger-month" disabled={useRange} />
          </div>
          <div className="border-l border-slate-200 dark:border-slate-700 pl-3 flex gap-2 items-end">
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Date From</Label>
              <Input type="date" value={dateFrom} onChange={(e: any) => setDateFrom(e.target.value)} data-testid="ledger-date-from" />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Date To</Label>
              <Input type="date" value={dateTo} onChange={(e: any) => setDateTo(e.target.value)} data-testid="ledger-date-to" />
            </div>
            {useRange && <Button size="sm" variant="outline" onClick={() => { setDateFrom(""); setDateTo(""); }} data-testid="ledger-date-clear">Clear Range</Button>}
          </div>
          <div className="min-w-[260px] relative">
            <Label>Operators (multi-select)</Label>
            <button
              type="button"
              onClick={() => setOperatorPickerOpen(v => !v)}
              className="w-full flex items-center justify-between rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-left hover:border-indigo-400"
              data-testid="ledger-operator-picker"
            >
              <span className={operatorIds.size ? "text-slate-800 dark:text-slate-100" : "text-slate-400"}>
                {opFilterLabel}
              </span>
              <span className="text-slate-400 text-xs">{operatorPickerOpen ? "▲" : "▼"}</span>
            </button>
            {operatorPickerOpen && (
              <div className="absolute z-40 mt-1 w-full max-h-72 overflow-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg" data-testid="ledger-operator-picker-panel">
                <div className="p-2 border-b border-slate-100 dark:border-slate-800 flex gap-2">
                  <Input type="search" value={operatorSearch} onChange={(e: any) => setOperatorSearch(e.target.value)} placeholder="Search operator..." className="h-7 py-0 text-xs" data-testid="ledger-operator-picker-search"/>
                  <button type="button" className="text-[11px] text-indigo-600 hover:underline" onClick={selectAllOperators} data-testid="ledger-op-select-all">All</button>
                  <button type="button" className="text-[11px] text-slate-500 hover:underline" onClick={clearOperators} data-testid="ledger-op-clear">Clear</button>
                </div>
                {db.operators
                  .filter(o => !operatorSearch.trim() || o.name.toLowerCase().includes(operatorSearch.trim().toLowerCase()) || (o.department || "").toLowerCase().includes(operatorSearch.trim().toLowerCase()))
                  .map(o => (
                    <label key={o.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={operatorIds.has(o.id)}
                        onChange={() => toggleOperator(o.id)}
                        className="h-4 w-4 accent-indigo-600"
                        data-testid={`ledger-op-check-${o.name}`}
                      />
                      <span className="flex-1">{o.name}</span>
                      {o.department && <span className="text-[10px] text-slate-500">{o.department}</span>}
                    </label>
                  ))}
                {db.operators.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">No operators defined</div>}
              </div>
            )}
          </div>
          <div className="ml-auto flex gap-2">
            {canExport && <Button variant="outline" onClick={exportCSV}>Export CSV</Button>}
            {canPrint && <Button onClick={printLedger}><IconPrint size={14}/> Print Ledger</Button>}
          </div>
        </div>
      </Card>

      <Card className="mb-3">
        <div className="p-3 grid sm:grid-cols-4 gap-3 text-sm">
          <div><div className="text-slate-500 text-xs">Period</div><b>{useRange ? `${dateFrom || "…"} → ${dateTo || "…"}` : monthLabel}</b></div>
          <div><div className="text-slate-500 text-xs">Operator</div><b>{opFilterLabel}</b></div>
          <div><div className="text-slate-500 text-xs">Total Production Qty</div><b className="text-xl">{grandQty}</b></div>
          <div><div className="text-slate-500 text-xs">{useRange ? "Total Amount" : "Total Monthly Amount"}</div><b className="text-xl text-emerald-600">{fmtINR(grandAmount)}</b></div>
        </div>
      </Card>

      <Card className="mb-3">
        <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-end gap-3">
          <div>
            <div className="font-semibold">Operator Performance Chart</div>
            <p className="text-xs text-slate-500">Ranked top → lowest for the filtered period. Click a bar or row for details.</p>
          </div>
          <div className="ml-auto flex items-end gap-2 flex-wrap">
            <div className="flex items-center gap-1 text-[11px]">
              <button
                type="button"
                onClick={() => setPerfMetric("qty")}
                className={"px-2 py-1 rounded " + (perfMetric === "qty" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
                data-testid="perf-metric-qty"
              >By Qty</button>
              <button
                type="button"
                onClick={() => setPerfMetric("amount")}
                className={"px-2 py-1 rounded " + (perfMetric === "amount" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
                data-testid="perf-metric-amount"
              >By Amount</button>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Min Qty</Label>
              <Input type="number" value={perfMinQty} min={0} onChange={(e: any) => setPerfMinQty(Number(e.target.value) || 0)} className="h-8 py-1 w-24" data-testid="perf-min-qty" />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Min Amount (₹)</Label>
              <Input type="number" value={perfMinAmount} min={0} onChange={(e: any) => setPerfMinAmount(Number(e.target.value) || 0)} className="h-8 py-1 w-32" data-testid="perf-min-amount" />
            </div>
            {(perfMinQty > 0 || perfMinAmount > 0) && (
              <Button size="sm" variant="outline" onClick={() => { setPerfMinQty(0); setPerfMinAmount(0); }} data-testid="perf-clear">Clear</Button>
            )}
          </div>
        </div>
        <div className="p-4 grid lg:grid-cols-2 gap-4">
          <div>
            {perfChartData.length === 0 ? <Empty title="No operators match the current filters" /> : (
              <BarChart
                data={perfChartData}
                color={perfMetric === "qty" ? "#6366f1" : "#f59e0b"}
                onBarClick={(i) => setPerfDrill(rankedOperators[i]?.name || null)}
              />
            )}
            <div className="mt-1 text-[11px] text-slate-500">{perfMetric === "amount" ? "Values shown as ₹ ÷ 100 for readability." : "Values are total quantity produced."}</div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <thead><tr><Th>#</Th><Th>Operator</Th><Th className="text-right">Entries</Th><Th className="text-right">Total Qty</Th><Th className="text-right">Total Amount</Th></tr></thead>
              <tbody>
                {rankedOperators.length === 0 && <tr><Td colSpan={5}><Empty title="No operators match" /></Td></tr>}
                {rankedOperators.map((o, i) => (
                  <tr
                    key={o.name}
                    onClick={() => setPerfDrill(o.name)}
                    className={"cursor-pointer hover:bg-indigo-50/40 dark:hover:bg-indigo-900/20 " + (i === 0 ? "bg-emerald-50/40 dark:bg-emerald-900/10" : "")}
                    data-testid={`perf-row-${o.name}`}
                  >
                    <Td className="font-mono text-xs">{i + 1}</Td>
                    <Td className="font-medium text-indigo-600 hover:underline">{o.name}</Td>
                    <Td className="text-right">{o.entries}</Td>
                    <Td className="text-right font-semibold">{o.qty}</Td>
                    <Td className="text-right font-semibold text-emerald-600">{fmtINR(o.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      </Card>

      <Modal open={!!perfDrill} onClose={() => setPerfDrill(null)} title={perfDrill ? `${perfDrill} — Performance Details` : "Operator"} size="xl">
        {perfDrill && (() => {
          const drillQty = perfDrillEntries.reduce((s, r) => s + (Number(r.todayQty) || 0), 0);
          const drillAmount = perfDrillEntries.reduce((s, r) => s + r.totalAmount, 0);
          const drillUniqueJC = new Set(perfDrillEntries.map(e => e.jobCardId)).size;
          return (
            <div className="space-y-4 text-sm">
              <div className="grid sm:grid-cols-4 gap-3">
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 p-3 bg-emerald-50 dark:bg-emerald-900/20">
                  <div className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Total Qty</div>
                  <div className="text-xl font-bold text-emerald-800 dark:text-emerald-200">{drillQty}</div>
                </div>
                <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 p-3 bg-indigo-50 dark:bg-indigo-900/20">
                  <div className="text-[11px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Total Amount</div>
                  <div className="text-xl font-bold text-indigo-800 dark:text-indigo-200">{fmtINR(drillAmount)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Entries</div>
                  <div className="text-xl font-bold">{perfDrillEntries.length}</div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Job Cards Worked</div>
                  <div className="text-xl font-bold">{drillUniqueJC}</div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden max-h-[420px] overflow-y-auto">
                <Table>
                  <thead><tr><Th>Date</Th><Th>Job Card No.</Th><Th>Product</Th><Th>Stage</Th><Th className="text-right">Qty</Th><Th className="text-right">Price/Unit (₹)</Th><Th className="text-right">Amount (₹)</Th></tr></thead>
                  <tbody>
                    {perfDrillEntries.length === 0 && <tr><Td colSpan={7}><Empty title="No entries" /></Td></tr>}
                    {perfDrillEntries.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <Td>{r.date}</Td>
                        <Td className="font-mono text-xs">{r.jobCardNumber || "—"}</Td>
                        <Td>{r.productName || "—"}</Td>
                        <Td>{r.stage}</Td>
                        <Td className="text-right font-semibold">{r.todayQty}</Td>
                        <Td className="text-right">{fmtINR(r.priceEach || 0)}</Td>
                        <Td className="text-right font-semibold text-emerald-600">{fmtINR(r.totalAmount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-700">
                <Button variant="outline" onClick={() => setPerfDrill(null)}>Close</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Operator</Th>
              <Th>Job Card No.</Th>
              <Th>Product</Th>
              <Th>Production Stage</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Price / Unit (₹)</Th>
              <Th className="text-right">Total Amount (₹)</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              return (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="whitespace-nowrap">{r.date}</Td>
                  <Td className="font-medium">{r.operatorName || "—"}</Td>
                  <Td className="font-mono text-xs">{r.jobCardNumber || "—"}</Td>
                  <Td>{r.productName || "—"}</Td>
                  <Td>{r.stage}</Td>
                  <Td className="text-right font-semibold">{r.todayQty}</Td>
                  <Td className="text-right">{fmtINR(r.priceEach || 0)}</Td>
                  <Td className="text-right font-semibold text-emerald-600">{fmtINR(r.totalAmount)}</Td>
                </tr>
              );
            })}
            {rows.length > 0 && (
              <tr className="bg-slate-50 dark:bg-slate-800/40 font-semibold">
                <Td colSpan={5}>Grand Total</Td>
                <Td className="text-right">{grandQty}</Td>
                <Td></Td>
                <Td className="text-right text-emerald-700">{fmtINR(grandAmount)}</Td>
              </tr>
            )}
          </tbody>
        </Table>
        {rows.length === 0 && <Empty title="No production entries in this period" />}
      </Card>

      {summary.length > 1 && (
        <Card className="mt-4">
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="font-semibold">
              {operatorIds.size >= 2 ? "Operator Comparison" : "Operator-wise Summary"} — {useRange ? `${dateFrom || "…"} → ${dateTo || "…"}` : monthLabel}
            </div>
            <div className="text-xs text-slate-500">{summary.length} operator{summary.length === 1 ? "" : "s"} in view</div>
          </div>
          <Table>
            <thead><tr><Th>#</Th><Th>Operator</Th><Th className="text-right">Entries</Th><Th className="text-right">Total Qty</Th><Th className="text-right">Total Amount (₹)</Th><Th className="text-right">Share of Amount</Th></tr></thead>
            <tbody>
              {summary.map((s, i) => {
                const share = grandAmount > 0 ? (s.amount / grandAmount) * 100 : 0;
                return (
                  <tr key={i} className={i === 0 ? "bg-emerald-50/40 dark:bg-emerald-900/10" : ""}>
                    <Td className="font-mono text-xs">{i + 1}</Td>
                    <Td className="font-medium">{s.name}</Td>
                    <Td className="text-right">{s.entries}</Td>
                    <Td className="text-right">{s.qty}</Td>
                    <Td className="text-right font-semibold text-emerald-600">{fmtINR(s.amount)}</Td>
                    <Td>
                      <div className="flex items-center gap-2 justify-end">
                        <div className="w-24 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, share)}%` }} />
                        </div>
                        <span className="text-xs w-10 text-right">{share.toFixed(1)}%</span>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

export function OperatorsPage() {
  const [tab, setTab] = useState<"master" | "ledger">("master");
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Operators &amp; Monthly Ledger</h1>
          <p className="text-sm text-slate-500">Maintain a list of production operators and view their monthly output and earnings.</p>
        </div>
        <div className="inline-flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          <button
            className={"px-4 py-1.5 text-sm rounded-md " + (tab === "master" ? "bg-white dark:bg-slate-700 shadow font-medium" : "text-slate-600 dark:text-slate-300")}
            onClick={() => setTab("master")}
            data-testid="tab-operators-master"
          >Operator Master</button>
          <button
            className={"px-4 py-1.5 text-sm rounded-md " + (tab === "ledger" ? "bg-white dark:bg-slate-700 shadow font-medium" : "text-slate-600 dark:text-slate-300")}
            onClick={() => setTab("ledger")}
            data-testid="tab-operators-ledger"
          >Ledger Report</button>
        </div>
      </div>
      {tab === "master" ? <OperatorsMaster /> : <OperatorLedger />}
    </div>
  );
}
