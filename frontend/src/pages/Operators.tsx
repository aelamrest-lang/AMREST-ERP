import { useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
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

  const toggleStage = (stage: ProductionStage) => {
    setForm(f => {
      const list = f.stages || [];
      return { ...f, stages: list.includes(stage) ? list.filter(s => s !== stage) : [...list, stage] };
    });
  };
  const toggleAllStages = () => {
    setForm(f => ({ ...f, stages: (f.stages || []).length === PRODUCTION_STAGES.length ? [] : [...PRODUCTION_STAGES] }));
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
                {(form.stages || []).length === PRODUCTION_STAGES.length ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="grid sm:grid-cols-3 gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/30">
              {PRODUCTION_STAGES.map(stage => {
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
  const [operatorId, setOperatorId] = useState<string>("");
  const [operatorSearch, setOperatorSearch] = useState<string>("");

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
      .filter(e => !operatorId || e.operatorId === operatorId)
      .map(e => {
        const priceEach = resolvePriceEach(e);
        return { ...e, priceEach, totalAmount: (Number(e.todayQty) || 0) * priceEach };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || (a.operatorName || "").localeCompare(b.operatorName || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.productionEntries, db.jobCards, db.settings.stagePrices, month, dateFrom, dateTo, operatorId, useRange]);

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

  const monthLabel = new Date(`${month}-01`).toLocaleString("en-IN", { month: "long", year: "numeric" });
  const filterOp = db.operators.find(o => o.id === operatorId);

  const printLedger = () => {
    const opFilterText = filterOp ? filterOp.name : "All Operators";
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
    const html = professionalDocument(db.settings, { title: "Operator Ledger", number: `OP-${month}-${filterOp?.name || "ALL"}`, date: todayISO(), body, accent: "#0f766e" });
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
    a.href = url; a.download = `operator-ledger-${month}${filterOp ? `-${filterOp.name}` : ""}.csv`;
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
          <div className="min-w-[240px]">
            <Label>Operator</Label>
            <Select value={operatorId} onChange={(e: any) => setOperatorId(e.target.value)} data-testid="ledger-operator">
              <option value="">All Operators</option>
              {db.operators
                .filter(o => !operatorSearch.trim() || o.name.toLowerCase().includes(operatorSearch.trim().toLowerCase()) || (o.department || "").toLowerCase().includes(operatorSearch.trim().toLowerCase()))
                .map(o => <option key={o.id} value={o.id}>{o.name}{o.department ? ` · ${o.department}` : ""}</option>)}
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Label>Search Operator</Label>
            <Input type="search" value={operatorSearch} onChange={(e: any) => setOperatorSearch(e.target.value)} placeholder="Type name / dept..." data-testid="ledger-operator-search" />
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
          <div><div className="text-slate-500 text-xs">Operator</div><b>{filterOp?.name || "All"}</b></div>
          <div><div className="text-slate-500 text-xs">Total Production Qty</div><b className="text-xl">{grandQty}</b></div>
          <div><div className="text-slate-500 text-xs">{useRange ? "Total Amount" : "Total Monthly Amount"}</div><b className="text-xl text-emerald-600">{fmtINR(grandAmount)}</b></div>
        </div>
      </Card>

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
              const jc = db.jobCards.find(j => j.id === r.jobCardId);
              const gotoJC = () => {
                if (!jc) return;
                try { localStorage.setItem("amrest_goto_jc_id", jc.id); } catch { /* noop */ }
                const goto = (window as any).__amrestSetRoute;
                if (typeof goto === "function") goto("production");
                else window.location.reload();
              };
              return (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="whitespace-nowrap">{r.date}</Td>
                  <Td className="font-medium">{r.operatorName || "—"}</Td>
                  <Td className="font-mono text-xs">
                    {jc ? (
                      <button
                        type="button"
                        className="text-indigo-600 hover:underline"
                        onClick={gotoJC}
                        title="Open Job Card in Production"
                        data-testid={`ledger-jc-link-${jc.number}`}
                      >{jc.number}</button>
                    ) : (r.jobCardNumber || "—")}
                  </Td>
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
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 font-semibold">Operator-wise Summary — {monthLabel}</div>
          <Table>
            <thead><tr><Th>Operator</Th><Th className="text-right">Entries</Th><Th className="text-right">Total Qty</Th><Th className="text-right">Total Amount (₹)</Th></tr></thead>
            <tbody>
              {summary.map((s, i) => (
                <tr key={i}>
                  <Td className="font-medium">{s.name}</Td>
                  <Td className="text-right">{s.entries}</Td>
                  <Td className="text-right">{s.qty}</Td>
                  <Td className="text-right font-semibold text-emerald-600">{fmtINR(s.amount)}</Td>
                </tr>
              ))}
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
