import { useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
import type { Operator } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint, IconSearch } from "../components/icons";
import { fmtINR, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

function OperatorsMaster() {
  const { db, setDB, log, currentUser } = useStore();
  const canCreate = userCan(currentUser, "operators", "create");
  const canEdit = userCan(currentUser, "operators", "edit");
  const canDelete = userCan(currentUser, "operators", "delete");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Operator | null>(null);
  const blank: Operator = { id: "", name: "", department: "", defaultRate: 0, active: true, createdAt: new Date().toISOString() };
  const [form, setForm] = useState<Operator>(blank);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? db.operators.filter(o => o.name.toLowerCase().includes(q) || (o.department || "").toLowerCase().includes(q)) : db.operators;
  }, [db.operators, search]);

  const openNew = () => { setEdit(null); setForm(blank); setOpen(true); };
  const openEdit = (o: Operator) => { setEdit(o); setForm({ ...o }); setOpen(true); };

  const save = () => {
    if (!form.name.trim()) return alert("Operator name is required");
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
          <thead><tr><Th>Name</Th><Th>Department</Th><Th>Default Rate (₹)</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {list.map(o => (
              <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Td className="font-medium">{o.name}</Td>
                <Td>{o.department || "—"}</Td>
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
  const [operatorId, setOperatorId] = useState<string>("");

  const rows = useMemo(() => {
    return db.productionEntries
      .filter(e => e.date.startsWith(month))
      .filter(e => !operatorId || e.operatorId === operatorId)
      .map(e => ({
        ...e,
        totalAmount: (Number(e.todayQty) || 0) * (Number(e.priceEach) || 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.operatorName.localeCompare(b.operatorName));
  }, [db.productionEntries, month, operatorId]);

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
        <div className="p-3 flex flex-wrap items-end gap-3">
          <div>
            <Label>Month</Label>
            <Input type="month" value={month} onChange={(e: any) => setMonth(e.target.value)} data-testid="ledger-month" />
          </div>
          <div className="min-w-[220px]">
            <Label>Operator</Label>
            <Select value={operatorId} onChange={(e: any) => setOperatorId(e.target.value)} data-testid="ledger-operator">
              <option value="">All Operators</option>
              {db.operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </div>
          <div className="ml-auto flex gap-2">
            {canExport && <Button variant="outline" onClick={exportCSV}>Export CSV</Button>}
            {canPrint && <Button onClick={printLedger}><IconPrint size={14}/> Print Ledger</Button>}
          </div>
        </div>
      </Card>

      <Card className="mb-3">
        <div className="p-3 grid sm:grid-cols-4 gap-3 text-sm">
          <div><div className="text-slate-500 text-xs">Period</div><b>{monthLabel}</b></div>
          <div><div className="text-slate-500 text-xs">Operator</div><b>{filterOp?.name || "All"}</b></div>
          <div><div className="text-slate-500 text-xs">Total Quantity</div><b>{grandQty}</b></div>
          <div><div className="text-slate-500 text-xs">Total Amount</div><b className="text-emerald-600">{fmtINR(grandAmount)}</b></div>
        </div>
      </Card>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Operator Name</Th>
              <Th>Production Stage</Th>
              <Th>Job Card / Product</Th>
              <Th className="text-right">Qty Completed</Th>
              <Th>Shift</Th>
              <Th className="text-right">Price Each (₹)</Th>
              <Th className="text-right">Total Amount (₹)</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Td className="whitespace-nowrap">{r.date}</Td>
                <Td className="font-medium">{r.operatorName || "—"}</Td>
                <Td>{r.stage}</Td>
                <Td>
                  <div className="font-mono text-xs text-slate-500">{r.jobCardNumber}</div>
                  <div>{r.productName}</div>
                </Td>
                <Td className="text-right font-semibold">{r.todayQty}</Td>
                <Td>{r.shift}</Td>
                <Td className="text-right">{fmtINR(Number(r.priceEach) || 0)}</Td>
                <Td className="text-right font-semibold text-emerald-600">{fmtINR(r.totalAmount)}</Td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="bg-slate-50 dark:bg-slate-800/40 font-semibold">
                <Td colSpan={4}>Grand Total</Td>
                <Td className="text-right">{grandQty}</Td>
                <Td></Td>
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
