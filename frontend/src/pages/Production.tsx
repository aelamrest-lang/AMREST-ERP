import { useEffect, useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty, KPI, Textarea } from "../components/ui";
import type { DB, JobCard, ProductionEntry, ProductionStage, QCTestRecord, SerialRecord } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconFactory, IconCheck, IconPrint } from "../components/icons";
import { nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

const STAGES: ProductionStage[] = ["LV Winding", "HV Winding", "Primary Winding", "Secondary Winding 1", "Secondary Winding 2", "Secondary Winding 3", "Core Coil Assembly", "Tanking", "Finishing", "Testing Ready", "Dispatch Ready"];
const STAGE_MULTIPLIERS: Record<string, number> = {
  "LV Winding": 1,
  "HV Winding": 1,
  "Primary Winding": 1,
  "Secondary Winding 1": 0,
  "Secondary Winding 2": 0,
  "Secondary Winding 3": 0,
  "Core Coil Assembly": 1,
  "Tanking": 1,
  "Finishing": 1,
  "Testing Ready": 1,
  "Dispatch Ready": 1,
};

function makeSerials(job: JobCard, db: DB): { serials: SerialRecord[]; tests: QCTestRecord[] } {
  const existing = db.serials.filter(s => s.jobCardId === job.id);
  if (existing.length >= job.qty) return { serials: [], tests: [] };
  const so = db.salesOrders.find(s => s.id === job.salesOrderId);
  const start = db.serials.length + 1;
  const serials: SerialRecord[] = [];
  const tests: QCTestRecord[] = [];
  for (let i = existing.length; i < job.qty; i++) {
    const serialNo = job.serialStart ? nextSerial(job.serialStart, i) : `DTR25${String(start + i).padStart(4, "0")}`;
    serials.push({
      id: uid(), serialNo, jobCardId: job.id, productName: job.product,
      productionStatus: "Pending", qcStatus: "Pending", dispatchStatus: "Pending", reworkStatus: "None",
      customerId: so?.customerId, warrantyStatus: "Pending", createdAt: new Date().toISOString(),
    });
    const format = db.qcFormats.find(f => f.id === job.qcFormatId) || db.qcFormats[0];
    tests.push({
      id: uid(), jobCardId: job.id, serialNo, srNo: i + 1, uniqueNo: serialNo, polarity: "OK",
      hvTitle: "HV Winding Resistance (Ohm)", hvAmbientTemp: 30, hvAB: "", hvBC: "", hvCA: "",
      lvTitle: "LV Winding Resistance (m-ohm)", lvAB: "", lvBC: "", lvCA: "",
      ratioR: "", ratioY: "", ratioB: "", irHVE: "", irLVE: "", irHVLV: "",
      dvdfVolt: "", hvKv: "", lvKv: "", result: "Pending", workflowStatus: "Testing Entry",
      testingEngineer: "", dateOfTesting: todayISO(), qcFormatId: format?.id, dynamicValues: Object.fromEntries((format?.columns || []).map(c => [c.id, ""])),
    });
  }
  return { serials, tests };
}

function nextSerial(start: string, index: number) {
  const match = start.match(/^(.*?)(\d+)$/);
  if (!match) return index === 0 ? start : `${start}-${index + 1}`;
  const prefix = match[1];
  const num = match[2];
  return `${prefix}${String(Number(num) + index).padStart(num.length, "0")}`;
}

export function JobCards() {
  const { db, setDB, log, currentUser } = useStore();
  const canCreate = userCan(currentUser, "jobcards", "create");
  const canEdit = userCan(currentUser, "jobcards", "edit");
  const canDelete = userCan(currentUser, "jobcards", "delete");
  const canPrint = userCan(currentUser, "jobcards", "print");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<JobCard | null>(null);

  const defaultStageQuantities = (qty: number) => STAGES.map(stage => ({
    stage,
    multiplier: STAGE_MULTIPLIERS[stage] ?? 1,
    totalQty: qty * (STAGE_MULTIPLIERS[stage] ?? 1),
  }));

  const blank = (): JobCard => ({
    id: "", number: nextNumber("JC", db.jobCards), date: todayISO(), salesOrderId: "", bomId: db.boms[0]?.id || "",
    qcFormatId: db.qcFormats[0]?.id || "", serialStart: "",
    product: "100 KVA Transformer", qty: 1, reservedItems: [],
    stageQuantities: defaultStageQuantities(1),
    stages: STAGES.map(s => ({ stage: s, status: "pending" as const })), status: "Open",
    createdAt: new Date().toISOString(),
  });
  const [form, setForm] = useState<JobCard>(blank());

  const openNew = () => {
    const f = blank();
    const bom = db.boms.find(b => b.id === f.bomId);
    if (bom) {
      f.reservedItems = bom.materials.filter(m => m.itemId).map(m => ({ itemId: m.itemId!, qty: m.qty * f.qty }));
      f.number = `${f.number.split(" - ")[0]} - ${bom.name}`;
    }
    setEdit(null); setForm(f); setOpen(true);
  };
  const openEdit = (j: JobCard) => {
    setEdit(j);
    // Migrate legacy stage "Secondary Winding" → 3 sub-stages
    const migratedStageQuantities = (j.stageQuantities || defaultStageQuantities(j.qty))
      .flatMap(sq => sq.stage === "Secondary Winding"
        ? ["Secondary Winding 1", "Secondary Winding 2", "Secondary Winding 3"].map((s, i) => ({
            stage: s as ProductionStage,
            multiplier: i === 0 ? sq.multiplier : 0,
            totalQty: i === 0 ? sq.totalQty : 0,
          }))
        : [sq],
      );
    // Ensure any missing STAGES have a row (with 0 multiplier if the sub-stage wasn't there yet)
    const known = new Set(migratedStageQuantities.map(x => x.stage));
    STAGES.forEach(s => {
      if (!known.has(s)) migratedStageQuantities.push({ stage: s, multiplier: STAGE_MULTIPLIERS[s] ?? 0, totalQty: (STAGE_MULTIPLIERS[s] ?? 0) * j.qty });
    });
    const migratedStages = j.stages.flatMap(st => st.stage === "Secondary Winding"
      ? ["Secondary Winding 1", "Secondary Winding 2", "Secondary Winding 3"].map((s, i) => ({ stage: s as ProductionStage, status: i === 0 ? st.status : "pending" as const, worker: i === 0 ? st.worker : undefined, date: i === 0 ? st.date : undefined }))
      : [st],
    );
    const stagesKnown = new Set(migratedStages.map(x => x.stage));
    STAGES.forEach(s => {
      if (!stagesKnown.has(s)) migratedStages.push({ stage: s, status: "pending" as const });
    });
    setForm({
      ...j,
      reservedItems: j.reservedItems.map(i => ({ ...i })),
      stageQuantities: migratedStageQuantities,
      stages: migratedStages,
    });
    setOpen(true);
  };

  const save = () => {
    if (!form.qcFormatId) return alert("QC Format selection is mandatory in Job Card.");
    if (edit) {
      setDB(d => {
        const itemIds = new Set([...edit.reservedItems.map(r => r.itemId), ...form.reservedItems.map(r => r.itemId)]);
        const items = d.items.map(it => {
          if (!itemIds.has(it.id)) return it;
          const oldQty = edit.reservedItems.find(r => r.itemId === it.id)?.qty || 0;
          const newQty = form.reservedItems.find(r => r.itemId === it.id)?.qty || 0;
          return { ...it, currentStock: Math.max(0, it.currentStock + oldQty - newQty) };
        });
        const generated = makeSerials(form, { ...d, jobCards: d.jobCards.map(x => x.id === edit.id ? form : x) });
        return {...d, items, jobCards: d.jobCards.map(x => x.id === edit.id ? form : x), serials: [...d.serials, ...generated.serials], qcTests: [...d.qcTests, ...generated.tests]};
      });
    } else {
      // reserve inventory: subtract from current stock
      setDB(d => {
        const newJob = {...form, id: uid()};
        const items = d.items.map(it => {
          const r = newJob.reservedItems.find(x => x.itemId === it.id);
          return r ? {...it, currentStock: Math.max(0, it.currentStock - r.qty)} : it;
        });
        const generated = makeSerials(newJob, d);
        return {...d, items, jobCards: [newJob, ...d.jobCards], serials: [...d.serials, ...generated.serials], qcTests: [...d.qcTests, ...generated.tests]};
      });
    }
    log(`${edit ? "Updated" : "Created"} Job Card ${form.number}`, "Job Card");
    setOpen(false);
  };
  const remove = (j: JobCard) => {
    if (!confirm(`Delete ${j.number}?`)) return;
    // restore reserved stock
    setDB(d => {
      const items = d.items.map(it => {
        const r = j.reservedItems.find(x => x.itemId === it.id);
        return r ? {...it, currentStock: it.currentStock + r.qty} : it;
      });
      return {...d, items, jobCards: d.jobCards.filter(x => x.id !== j.id)};
    });
    log(`Deleted Job Card ${j.number}`, "Job Card");
  };

  const updateBOM = (bomId: string) => {
    const bom = db.boms.find(b => b.id === bomId);
    setForm(f => ({
      ...f,
      bomId,
      number: `${f.number.split(" - ")[0]}${bom ? ` - ${bom.name}` : ""}`,
      reservedItems: bom ? bom.materials.filter(m => m.itemId).map(m => ({ itemId: m.itemId!, qty: m.qty * f.qty })) : [],
    }));
  };
  const updateQty = (qty: number) => {
    setForm(f => {
      const bom = db.boms.find(b => b.id === f.bomId);
      return {
        ...f,
        qty,
        reservedItems: bom ? bom.materials.filter(m => m.itemId).map(m => ({ itemId: m.itemId!, qty: m.qty * qty })) : f.reservedItems,
        stageQuantities: (f.stageQuantities || defaultStageQuantities(qty)).map(s => ({ ...s, totalQty: qty * s.multiplier })),
      };
    });
  };

  const updateStageMultiplier = (stage: string, multiplier: number) => {
    setForm(f => ({
      ...f,
      stageQuantities: (f.stageQuantities || defaultStageQuantities(f.qty)).map(row => row.stage === stage ? {
        ...row,
        multiplier: Number(multiplier) || 0,
        totalQty: f.qty * (Number(multiplier) || 0),
      } : row),
    }));
  };

  const printJobCard = (j: JobCard) => {
    const so = db.salesOrders.find(s => s.id === j.salesOrderId);
    const bom = db.boms.find(b => b.id === j.bomId);
    const body = `
      <div class="box"><div class="section-title">Production Details</div><b>Product:</b> ${j.product}<br/><b>Quantity:</b> ${j.qty}<br/><b>Status:</b> <span class="badge">${j.status}</span><br/><b>Sales Order:</b> ${so?.number || "-"}<br/><b>BOM:</b> ${bom?.name || "-"}</div>
      <div class="section-title">Reserved Materials</div>
      <table><thead><tr><th>#</th><th>Item</th><th class="right">Qty Reserved</th><th>UOM</th></tr></thead><tbody>
      ${j.reservedItems.map((r, idx) => { const it = db.items.find(i => i.id === r.itemId); return `<tr><td>${idx+1}</td><td>${it?.name || "-"}</td><td class="right">${r.qty}</td><td>${it?.unit || ""}</td></tr>`; }).join("")}
      </tbody></table>
      <div class="section-title">Production Stages</div>
      <table><thead><tr><th>#</th><th>Stage</th><th>Status</th><th>Worker</th><th>Date</th></tr></thead><tbody>
      ${j.stages.map((s, idx) => `<tr><td>${idx+1}</td><td>${s.stage}</td><td>${s.status}</td><td>${s.worker || "-"}</td><td>${s.date || "-"}</td></tr>`).join("")}
      </tbody></table>
      <div class="section-title">Production Stage Quantity Calculation</div>
      <table><thead><tr><th>Stage</th><th class="right">Job Qty</th><th class="right">Multiplier</th><th class="right">Total Stage Qty</th></tr></thead><tbody>
      ${(j.stageQuantities || defaultStageQuantities(j.qty)).map(row => `<tr><td>${row.stage}</td><td class="right">${j.qty}</td><td class="right">${row.multiplier}</td><td class="right">${row.totalQty}</td></tr>`).join("")}
      </tbody></table>
      <div class="box"><b>Formula:</b> Total Stage Qty = Job Qty x Stage Multiplier</div>
      <div class="signs"><div class="sign-box">Production Supervisor</div><div class="sign-box">Stores</div><div class="sign-box">Quality</div></div>
    `;
    const html = professionalDocument(db.settings, { title: "Job Card", number: j.number, date: j.date, body, accent: "#4f46e5" });
    printArea(html, j.number);
  };

  const printMaterialIssue = (j: JobCard) => {
    const body = `
      <div class="box"><div class="section-title">Issue Against Job Card</div><b>Job Card:</b> ${j.number}<br/><b>Product:</b> ${j.product}<br/><b>Production Qty:</b> ${j.qty}</div>
      <table><thead><tr><th>#</th><th>Material</th><th class="right">Issue Qty</th><th>UOM</th><th>Remarks</th></tr></thead><tbody>
      ${j.reservedItems.map((r, idx) => { const it = db.items.find(i => i.id === r.itemId); return `<tr><td>${idx+1}</td><td>${it?.name || "-"}</td><td class="right">${r.qty}</td><td>${it?.unit || ""}</td><td>Issued for production hold</td></tr>`; }).join("")}
      </tbody></table>
      <div class="signs"><div class="sign-box">Issued By Stores</div><div class="sign-box">Received By Production</div><div class="sign-box">Approved By</div></div>
    `;
    const html = professionalDocument(db.settings, { title: "Material Issue Slip", number: `MIS-${j.number}`, date: todayISO(), body, accent: "#c2410c" });
    printArea(html, `MIS-${j.number}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">Job Cards</h1><p className="text-sm text-slate-500">Production planning, inventory reservation and stage tracking</p></div>
        {canCreate && <Button onClick={openNew}><IconPlus size={14}/> New Job Card</Button>}
      </div>

      <Card>
        <Table>
          <thead><tr><Th>#</Th><Th>Date</Th><Th>Product</Th><Th>Qty</Th><Th>Stages Done</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {db.jobCards.map(j => {
              const done = j.stages.filter(s => s.status === "done").length;
              return (
                <tr key={j.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-mono text-xs">{j.number}</Td>
                  <Td>{j.date}</Td>
                  <Td className="font-medium">{j.product}</Td>
                  <Td>{j.qty}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 rounded bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${(done / j.stages.length) * 100}%` }}/>
                      </div>
                      <span className="text-xs">{done}/{j.stages.length}</span>
                    </div>
                  </Td>
                  <Td><Badge color={j.status === "Completed" ? "green" : j.status === "In Progress" ? "yellow" : "blue"}>{j.status}</Badge></Td>
                  <Td><div className="flex gap-1">
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(j)}><IconEdit size={14}/></Button>}
                    {canPrint && <Button size="sm" variant="ghost" onClick={() => printJobCard(j)} title="Print Job Card"><IconPrint size={14}/></Button>}
                    {canPrint && <Button size="sm" variant="outline" onClick={() => printMaterialIssue(j)} title="Print Material Issue Slip">MIS</Button>}
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => remove(j)}><IconTrash size={14}/></Button>}
                  </div></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {db.jobCards.length === 0 && <Empty title="No job cards" subtitle="Create one to start production"/>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit ${edit.number}` : "New Job Card"} size="xl">
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label>Job Card No.</Label><Input value={form.number} disabled/></div>
          <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e: any) => setForm({...form, date: e.target.value})}/></div>
          <div><Label>Sales Order</Label>
            <Select value={form.salesOrderId} onChange={(e: any) => setForm({...form, salesOrderId: e.target.value})}>
              <option value="">— None —</option>
              {db.salesOrders.map(s => <option key={s.id} value={s.id}>{s.number}</option>)}
            </Select>
          </div>
          <div className="sm:col-span-2"><Label>Product</Label><Input value={form.product} onChange={(e: any) => setForm({...form, product: e.target.value})}/></div>
          <div><Label>Quantity</Label><Input type="number" value={form.qty} onChange={(e: any) => updateQty(Number(e.target.value))}/></div>
          <div><Label>Unique No. / Serial Start</Label><Input value={form.serialStart || ""} placeholder="e.g. DTR250001" onChange={(e: any) => setForm({...form, serialStart: e.target.value})}/></div>
          <div className="sm:col-span-2"><Label>BOM</Label>
            <Select value={form.bomId} onChange={(e: any) => updateBOM(e.target.value)}>
              <option value="">— None —</option>
              {db.boms.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
          <div><Label>QC Format Selection *</Label>
            <Select value={form.qcFormatId || ""} onChange={(e: any) => setForm({...form, qcFormatId: e.target.value})}>
              <option value="">Select QC Format...</option>
              {db.qcFormats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              <option value="custom">Custom QC Format</option>
            </Select>
          </div>
          <div><Label>Status</Label>
            <Select value={form.status} onChange={(e: any) => setForm({...form, status: e.target.value})}>
              <option>Open</option><option>In Progress</option><option>Completed</option>
            </Select>
          </div>
        </div>

        <div className="mt-4">
          <h4 className="font-semibold text-sm mb-2">Reserved Inventory (will be deducted from stock)</h4>
          <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <Table>
              <thead><tr><Th>Item</Th><Th>Qty Reserved</Th></tr></thead>
              <tbody>
                {form.reservedItems.length === 0 && <tr><Td className="text-slate-500" {...{colSpan:2}}>No items reserved (select a BOM)</Td></tr>}
                {form.reservedItems.map((r, i) => {
                  const it = db.items.find(x => x.id === r.itemId);
                  return <tr key={i}><Td>{it?.name}</Td><Td>{r.qty} {it?.unit}</Td></tr>;
                })}
              </tbody>
            </Table>
          </div>
        </div>

        <div className="mt-4">
          <h4 className="font-semibold text-sm mb-2">Production Stage Quantity Calculation</h4>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <Table>
              <thead><tr><Th>Stage</Th><Th>Job Qty</Th><Th>Multiplier</Th><Th>Total Stage Qty</Th></tr></thead>
              <tbody>
                {(form.stageQuantities || defaultStageQuantities(form.qty)).map(row => (
                  <tr key={row.stage}>
                    <Td className="font-medium">{row.stage}</Td>
                    <Td>{form.qty}</Td>
                    <Td><Input className="max-w-32" type="number" min="0" step="0.01" value={row.multiplier} onChange={(e: any) => updateStageMultiplier(row.stage, Number(e.target.value))} /></Td>
                    <Td className="font-semibold text-indigo-600">{row.totalQty}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p className="mt-2 text-xs text-slate-500">Total Stage Qty = Job Qty x Stage Multiplier. Set a multiplier of <b>0</b> to skip that stage — it will not appear in the Production dropdown.</p>
        </div>

        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>{edit ? "Update" : "Create & Reserve Stock"}</Button></div>
      </Modal>
    </div>
  );
}

export function ProductionDashboard() {
  const { db, setDB, log, currentUser } = useStore();
  const canEditProduction = userCan(currentUser, "production", "edit");
  const isAdmin = currentUser?.role === "admin";
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryJobId, setEntryJobId] = useState(db.jobCards[0]?.id || "");
  const [entryStage, setEntryStage] = useState<ProductionStage>(STAGES[0]);
  const [entryQty, setEntryQty] = useState(0);
  const [operatorId, setOperatorId] = useState("");
  const [priceEach, setPriceEach] = useState(0);
  const [shift, setShift] = useState<"Day" | "Night" | "General">("Day");
  const [machineName, setMachineName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [entryWarning, setEntryWarning] = useState("");

  const inProg = db.jobCards.filter(j => j.status !== "Completed");
  const completed = db.jobCards.filter(j => j.status === "Completed").length;

  const stageCounts = STAGES.map(s => ({
    label: s.replace(" / ", " ").split(" ")[0],
    count: db.jobCards.reduce((acc, j) => acc + j.stages.filter(x => x.stage === s && x.status === "in-progress").length, 0),
  }));

  const selectedJob = db.jobCards.find(j => j.id === entryJobId) || db.jobCards[0];
  const enabledStages = useMemo(() => {
    if (!selectedJob) return STAGES;
    if (!selectedJob.stageQuantities || selectedJob.stageQuantities.length === 0) return STAGES;
    return STAGES.filter(s => {
      const sq = selectedJob.stageQuantities?.find(row => row.stage === s);
      return (sq?.multiplier ?? 0) > 0;
    });
  }, [selectedJob]);
  // Auto-correct entryStage when it's not enabled for the current job
  useEffect(() => {
    if (!entryOpen) return;
    if (enabledStages.length > 0 && !enabledStages.includes(entryStage)) {
      setEntryStage(enabledStages[0]);
    }
  }, [entryOpen, enabledStages, entryStage]);
  const entryTotalQty = selectedJob?.stageQuantities?.find(row => row.stage === entryStage)?.totalQty || selectedJob?.qty || 0;
  const previousCompleted = selectedJob ? db.productionEntries.filter(e => e.jobCardId === selectedJob.id && e.stage === entryStage).reduce((s, e) => s + e.todayQty, 0) : 0;
  const balanceQty = selectedJob ? Math.max(0, entryTotalQty - previousCompleted) : 0;
  const projectedBalanceQty = selectedJob ? Math.max(0, entryTotalQty - previousCompleted - entryQty) : 0;
  const productionComplete = !!selectedJob && previousCompleted >= entryTotalQty;
  const dailyProduction = db.productionEntries.filter(e => e.date === todayISO()).reduce((s, e) => s + e.todayQty, 0);
  const completedQty = db.productionEntries.filter(e => e.stage === "Dispatch Ready").reduce((s, e) => s + e.todayQty, 0);
  const pendingQty = db.jobCards.reduce((s, j) => s + j.qty, 0) - completedQty;
  const reworkQty = db.serials.filter(s => s.reworkStatus === "Rework" || s.reworkStatus === "Scrap").length;

  const saveProductionEntry = () => {
    if (!selectedJob) return alert("Select a job card");
    if (!entryTotalQty || entryTotalQty <= 0) return alert("Total stage quantity is mandatory");
    if (productionComplete && !isAdmin) return alert("Production Quantity Completed");
    if (entryQty <= 0) return alert("Enter today's production quantity");
    if (!operatorId) return alert("Please select an operator");
    if (entryQty > balanceQty && !isAdmin) return setEntryWarning("Entered quantity exceeds pending quantity");
    const qty = isAdmin ? entryQty : Math.min(entryQty, balanceQty);
    const operator = db.operators.find(o => o.id === operatorId);
    const operatorName = operator?.name || "";
    const entry: ProductionEntry = {
      id: uid(), date: todayISO(), jobCardId: selectedJob.id, jobCardNumber: selectedJob.number,
      stage: entryStage, productName: selectedJob.product, totalJobQty: entryTotalQty,
      previousCompletedQty: previousCompleted, todayQty: qty, balanceQty: Math.max(0, entryTotalQty - previousCompleted - qty),
      operatorName, operatorId, shift, machineName, priceEach: Number(priceEach) || 0,
      status: previousCompleted + qty >= entryTotalQty ? "Completed" : "Running", remarks, createdAt: new Date().toISOString(),
    };
    setDB(d => ({
      ...d,
      productionEntries: [entry, ...d.productionEntries],
      jobCards: d.jobCards.map(j => {
        if (j.id !== selectedJob.id) return j;
        const stageTotal = previousCompleted + qty;
        const stages = j.stages.map(s => s.stage === entryStage ? { ...s, status: stageTotal >= entryTotalQty ? "done" as const : "in-progress" as const, date: todayISO(), worker: operatorName } : s);
        const complete = stages.every(s => s.status === "done");
        return { ...j, stages, status: complete ? "Completed" as const : "In Progress" as const };
      }),
      serials: d.serials.map(s => s.jobCardId === selectedJob.id && entryStage === "Dispatch Ready" ? { ...s, productionStatus: "Completed" as const } : s.jobCardId === selectedJob.id ? { ...s, productionStatus: "In Production" as const } : s),
    }));
    log(`Production entry ${selectedJob.number} ${entryStage}: ${qty}`, "Production");
    printProductionEntry(entry);
    setEntryQty(0); setOperatorId(""); setPriceEach(0); setMachineName(""); setRemarks(""); setEntryWarning(""); setEntryOpen(false);
  };

  const setEntryQtySafe = (value: number) => {
    if (value > balanceQty) {
      setEntryQty(balanceQty);
      setEntryWarning("Entered quantity exceeds pending quantity");
    } else {
      setEntryQty(value);
      setEntryWarning("");
    }
  };

  const printDailyProduction = () => {
    const rows = db.productionEntries.filter(e => e.date === todayISO());
    const body = `<div class="section-title">Daily Production Report</div><table><thead><tr><th>Job Card</th><th>Stage</th><th>Product</th><th class="right">Today Qty</th><th>Operator</th><th>Shift</th><th>Machine</th></tr></thead><tbody>${rows.map(e => `<tr><td>${e.jobCardNumber}</td><td>${e.stage}</td><td>${e.productName}</td><td class="right">${e.todayQty}</td><td>${e.operatorName}</td><td>${e.shift}</td><td>${e.machineName}</td></tr>`).join("")}</tbody></table><div class="signs"><div class="sign-box">Production Supervisor</div><div class="sign-box">Planning</div><div class="sign-box">Approved By</div></div>`;
    printArea(professionalDocument(db.settings, { title: "Daily Production Report", number: `DPR-${todayISO()}`, date: todayISO(), body, accent: "#4f46e5" }), `DPR-${todayISO()}`);
  };

  const printProductionEntry = (entry: ProductionEntry) => {
    const body = `<div class="box"><div class="section-title">Production Update</div><b>Job Card:</b> ${entry.jobCardNumber}<br/><b>Product:</b> ${entry.productName}<br/><b>Stage:</b> ${entry.stage}<br/><b>Operator:</b> ${entry.operatorName || "-"}<br/><b>Machine:</b> ${entry.machineName || "-"}<br/><b>Status:</b> ${entry.status || "Running"}</div><table><thead><tr><th>Total Stage Qty</th><th>Previous Completed</th><th>Today Qty</th><th>Total Completed</th><th>Balance Qty</th><th>Shift</th></tr></thead><tbody><tr><td>${entry.totalJobQty}</td><td>${entry.previousCompletedQty}</td><td>${entry.todayQty}</td><td>${entry.previousCompletedQty + entry.todayQty}</td><td>${entry.balanceQty}</td><td>${entry.shift}</td></tr></tbody></table><div class="box"><b>Remarks:</b> ${entry.remarks || "-"}</div><div class="signs"><div class="sign-box">Operator</div><div class="sign-box">Supervisor</div><div class="sign-box">Approved By</div></div>`;
    printArea(professionalDocument(db.settings, { title: "Production Update", number: `PU-${entry.jobCardNumber}-${entry.id.slice(0, 6)}`, date: entry.date, body, accent: "#4f46e5" }), `Production-${entry.jobCardNumber}`);
  };

  const completeStage = (jcId: string, stage: ProductionStage) => {
    if (!canEditProduction) return;
    if (currentUser?.role === "testing" && stage !== "Testing") return;
    if (currentUser?.role === "production" && stage === "Testing") return;
    setDB(d => ({...d, jobCards: d.jobCards.map(j => {
      if (j.id !== jcId) return j;
      const stages = j.stages.map(s => s.stage === stage ? {...s, status: "done" as const, date: todayISO()} : s);
      const allDone = stages.every(s => s.status === "done");
      return {...j, stages, status: allDone ? "Completed" as const : "In Progress" as const};
    })}));
    log(`Stage ${stage} completed for ${jcId}`, "Production");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap"><div><h1 className="text-2xl font-bold">Production Dashboard</h1><p className="text-sm text-slate-500">Stage-wise tracking and daily updates</p></div><div className="flex gap-2"><Button variant="outline" onClick={printDailyProduction}><IconPrint size={14}/> Daily Report</Button>{canEditProduction && <Button onClick={() => setEntryOpen(true)}><IconPlus size={14}/> Daily Production Entry</Button>}</div></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Daily Production" value={String(dailyProduction)} color="indigo" icon={<IconFactory size={22}/>}/>
        <KPI label="Pending Quantity" value={String(Math.max(0, pendingQty))} color="amber" icon={<IconFactory size={22}/>}/>
        <KPI label="Completed Quantity" value={String(completedQty || completed)} color="emerald" icon={<IconCheck size={22}/>}/>
        <KPI label="Rework Quantity" value={String(reworkQty)} color="rose" icon={<IconFactory size={22}/>}/>
      </div>

      <Card>
        <div className="p-5">
          <h3 className="font-semibold mb-3">Stage-wise Active Jobs</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {stageCounts.map(s => (
              <div key={s.label} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-center">
                <div className="text-2xl font-bold text-indigo-600">{s.count}</div>
                <div className="text-xs text-slate-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card><div className="p-4"><h3 className="font-semibold mb-3">Operator Wise Output</h3>{groupRows(db.productionEntries, "operatorName")}</div></Card>
        <Card><div className="p-4"><h3 className="font-semibold mb-3">Machine Wise Output</h3>{groupRows(db.productionEntries, "machineName")}</div></Card>
      </div>

      <div className="space-y-3">
        {inProg.map(j => (
          <Card key={j.id}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <div className="font-semibold">{j.number} — {j.product}</div>
                  <div className="text-xs text-slate-500">Qty: {j.qty} | Created: {j.date}</div>
                </div>
                <Badge color={j.status === "In Progress" ? "yellow" : "blue"}>{j.status}</Badge>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {j.stages.map(s => (
                  <button key={s.stage} onClick={() => s.status !== "done" && completeStage(j.id, s.stage)}
                    disabled={!canEditProduction || (currentUser?.role === "testing" && s.stage !== "Testing") || (currentUser?.role === "production" && s.stage === "Testing")}
                    title={currentUser?.role === "testing" && s.stage !== "Testing" ? "Testing users can update only the Testing stage" : currentUser?.role === "production" && s.stage === "Testing" ? "Testing stage is reserved for Testing users" : "Click to complete stage"}
                    className={`text-left p-2 rounded-lg border text-xs disabled:opacity-50 disabled:cursor-not-allowed ${s.status === "done" ? "bg-emerald-50 border-emerald-300 dark:bg-emerald-900/30 dark:border-emerald-700" : s.status === "in-progress" ? "bg-amber-50 border-amber-300 dark:bg-amber-900/30 dark:border-amber-700 cursor-pointer" : "bg-slate-50 border-slate-300 dark:bg-slate-800 dark:border-slate-700 cursor-pointer hover:border-indigo-400"}`}>
                    <div className="flex items-center gap-1.5">
                      {s.status === "done" && <IconCheck size={12}/>}
                      <span className="font-medium">{s.stage}</span>
                    </div>
                    {s.worker && <div className="text-slate-500 mt-0.5">{s.worker}</div>}
                    {s.date && <div className="text-slate-400">{s.date}</div>}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        ))}
        {inProg.length === 0 && <Card><Empty title="No active production" subtitle="Create a job card to start"/></Card>}
      </div>

      <Modal open={entryOpen} onClose={() => setEntryOpen(false)} title="Daily Production Entry" size="lg">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Job Card Number</Label><Select value={entryJobId} onChange={(e: any) => { setEntryJobId(e.target.value); setEntryQty(0); }}>{db.jobCards.map(j => <option key={j.id} value={j.id}>{j.number} - {j.product}</option>)}</Select></div>
          <div><Label>Production Stage</Label>
            <Select
              value={entryStage}
              onChange={(e: any) => { setEntryStage(e.target.value); setEntryQty(0); setOperatorId(""); }}
              data-testid="prod-entry-stage-select"
            >
              {enabledStages.length > 0
                ? enabledStages.map(s => <option key={s} value={s}>{s}</option>)
                : <option value="">— No stages enabled in Job Card —</option>}
            </Select>
            {enabledStages.length < STAGES.length && selectedJob && (
              <div className="text-[10px] text-slate-500 mt-1">Showing only stages enabled in this Job Card.</div>
            )}
          </div>
          <div><Label>Product Name</Label><Input value={selectedJob?.product || ""} disabled /></div>
          <div><Label>Total {entryStage} Quantity</Label><Input type="number" value={entryTotalQty} disabled /></div>
          <div><Label>Previously Completed Quantity</Label><Input value={previousCompleted} disabled /></div>
          <div><Label>Today {entryStage} Quantity</Label><Input type="number" value={entryQty} max={balanceQty} onChange={(e: any) => setEntryQtySafe(Number(e.target.value))} /></div>
          <div><Label>Total Completed Quantity</Label><Input value={previousCompleted + entryQty} disabled /></div>
          <div><Label>Balance {entryStage} Quantity</Label><Input value={projectedBalanceQty} disabled /></div>
          <div>
            <Label>Operator Name *</Label>
            <Select
              value={operatorId}
              onChange={(e: any) => {
                const id = e.target.value;
                setOperatorId(id);
                const op = db.operators.find(o => o.id === id);
                if (op && !priceEach) setPriceEach(op.defaultRate || 0);
              }}
              data-testid="production-operator-select"
            >
              <option value="">— Select Operator —</option>
              {db.operators
                .filter(o => o.active && (o.stages || []).includes(entryStage))
                .map(o => (
                  <option key={o.id} value={o.id}>{o.name}{o.department ? ` · ${o.department}` : ""}</option>
                ))
              }
            </Select>
            {db.operators.filter(o => o.active && (o.stages || []).includes(entryStage)).length === 0 && (
              <div className="text-xs text-amber-600 mt-1">
                No operators mapped to <b>{entryStage}</b>. Go to “Operators &amp; Ledger” → edit an operator → assign this stage.
              </div>
            )}
          </div>
          <div><Label>Shift</Label><Select value={shift} onChange={(e: any) => setShift(e.target.value)}><option>Day</option><option>Night</option><option>General</option></Select></div>
          <div><Label>Machine Name</Label><Input value={machineName} onChange={(e: any) => setMachineName(e.target.value)} /></div>
          <div><Label>Price Each (₹ per unit)</Label><Input type="number" value={priceEach} onChange={(e: any) => setPriceEach(Number(e.target.value) || 0)} data-testid="production-price-each" /></div>
          <div className="sm:col-span-2"><Label>Remarks</Label><Textarea rows={3} value={remarks} onChange={(e: any) => setRemarks(e.target.value)} /></div>
        </div>
        {entryWarning && <div className="mt-3 rounded-lg bg-rose-50 text-rose-700 px-3 py-2 text-sm">{entryWarning}</div>}
        {productionComplete && <div className="mt-3 rounded-lg bg-emerald-50 text-emerald-700 px-3 py-2 text-sm">Production Quantity Completed</div>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setEntryOpen(false)}>Cancel</Button><Button onClick={saveProductionEntry}>Save Production Entry</Button></div>
      </Modal>
    </div>
  );
}

function groupRows(entries: ProductionEntry[], field: "operatorName" | "machineName") {
  const map = new Map<string, number>();
  entries.forEach(e => map.set(e[field] || "Not Set", (map.get(e[field] || "Not Set") || 0) + e.todayQty));
  const rows = Array.from(map.entries()).slice(0, 8);
  if (!rows.length) return <Empty title="No data" />;
  return <div className="space-y-2">{rows.map(([name, qty]) => <div key={name} className="flex justify-between text-sm border-b border-slate-100 dark:border-slate-800 pb-2"><span>{name}</span><b>{qty}</b></div>)}</div>;
}
