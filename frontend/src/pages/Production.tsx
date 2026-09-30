import { useEffect, useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty, KPI, Textarea } from "../components/ui";
import type { DB, JobCard, ProductionEntry, ProductionStage, QCTestRecord, SerialRecord } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconFactory, IconCheck, IconPrint } from "../components/icons";
import { fmtINR, nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";
import { applySfgProduction, applySfgAutoConsumption } from "../lib/sfg";

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
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const isAdmin = currentUser?.role === "admin";
  const stageMaster: string[] = db.settings.productionStages?.length ? db.settings.productionStages : STAGES;
  const [stageModal, setStageModal] = useState<{ mode: "create" | "edit" | "delete"; stage?: string } | null>(null);
  const [stageName, setStageName] = useState("");

  const renameKeyRec = <T,>(rec: Record<string, T> | undefined, oldN: string, newN: string): Record<string, T> | undefined => {
    if (!rec || !(oldN in rec)) return rec;
    const out: Record<string, T> = {};
    Object.entries(rec).forEach(([k, v]) => { out[k === oldN ? newN : k] = v; });
    return out;
  };

  const stageHasTransactions = (stage: string) =>
    db.productionEntries.some(e => e.stage === stage) ||
    db.jobCards.some(j => (j.stages || []).some(s => s.stage === stage && (s.status !== "pending" || s.worker))) ||
    (db.sfgBatches || []).some(b => b.stage === stage) ||
    (db.sfgConsumptions || []).some(c => c.outputStage === stage);

  const createStage = () => {
    const name = stageName.trim();
    if (!name) return;
    if (stageMaster.some(s => s.toLowerCase() === name.toLowerCase())) return alert("A stage with this name already exists");
    setDB(d => ({ ...d, settings: { ...d.settings, productionStages: [...stageMaster, name] } }));
    log(`Created production stage ${name}`, "Job Card");
    setStageModal(null); setStageName("");
  };

  const renameStage = () => {
    const oldN = stageModal?.stage || "";
    const newN = stageName.trim();
    if (!newN || newN === oldN) { setStageModal(null); return; }
    if (stageMaster.some(s => s !== oldN && s.toLowerCase() === newN.toLowerCase())) return alert("Another stage with this name already exists");
    setDB(d => ({
      ...d,
      settings: {
        ...d.settings,
        productionStages: stageMaster.map(s => s === oldN ? newN : s),
        stagePrices: renameKeyRec(d.settings.stagePrices, oldN, newN),
        stageDays: renameKeyRec(d.settings.stageDays, oldN, newN),
        stageCapacity: renameKeyRec(d.settings.stageCapacity, oldN, newN),
        sfgStageItems: renameKeyRec(d.settings.sfgStageItems, oldN, newN),
        sfgConsumptionMap: renameKeyRec(d.settings.sfgConsumptionMap, oldN, newN),
        sfgStageItemsByJc: d.settings.sfgStageItemsByJc ? Object.fromEntries(Object.entries(d.settings.sfgStageItemsByJc).map(([k, v]) => [k, renameKeyRec(v, oldN, newN)!])) : d.settings.sfgStageItemsByJc,
        sfgConsumptionMapByJc: d.settings.sfgConsumptionMapByJc ? Object.fromEntries(Object.entries(d.settings.sfgConsumptionMapByJc).map(([k, v]) => [k, renameKeyRec(v, oldN, newN)!])) : d.settings.sfgConsumptionMapByJc,
      },
      jobCards: d.jobCards.map(j => ({
        ...j,
        stages: (j.stages || []).map(s => s.stage === oldN ? { ...s, stage: newN } : s),
        stageQuantities: (j.stageQuantities || []).map(sq => sq.stage === oldN ? { ...sq, stage: newN } : sq),
        stagePrices: renameKeyRec(j.stagePrices, oldN, newN),
      })),
      productionEntries: d.productionEntries.map(e => e.stage === oldN ? { ...e, stage: newN } : e),
      sfgBatches: (d.sfgBatches || []).map(b => b.stage === oldN ? { ...b, stage: newN } : b),
      sfgConsumptions: (d.sfgConsumptions || []).map(c => c.outputStage === oldN ? { ...c, outputStage: newN } : c),
      operators: (d.operators || []).map(o => ({ ...o, stages: (o.stages || []).map(s => s === oldN ? newN : s) })),
    }));
    setSelectedStages(prev => prev.map(s => s === oldN ? newN : s));
    setForm(f => ({
      ...f,
      stageQuantities: (f.stageQuantities || []).map(sq => sq.stage === oldN ? { ...sq, stage: newN } : sq),
      stages: (f.stages || []).map(s => s.stage === oldN ? { ...s, stage: newN } : s),
    }));
    log(`Renamed production stage ${oldN} → ${newN}`, "Job Card");
    setStageModal(null); setStageName("");
  };

  const deleteStage = () => {
    const stage = stageModal?.stage || "";
    if (!stage || stageHasTransactions(stage)) return;
    const rmKey = <T,>(rec: Record<string, T> | undefined): Record<string, T> | undefined => {
      if (!rec) return rec;
      const out = { ...rec };
      delete out[stage];
      return out;
    };
    setDB(d => ({
      ...d,
      settings: {
        ...d.settings,
        productionStages: stageMaster.filter(s => s !== stage),
        stagePrices: rmKey(d.settings.stagePrices),
        stageDays: rmKey(d.settings.stageDays),
        stageCapacity: rmKey(d.settings.stageCapacity),
        sfgStageItems: rmKey(d.settings.sfgStageItems),
        sfgConsumptionMap: rmKey(d.settings.sfgConsumptionMap),
        sfgStageItemsByJc: d.settings.sfgStageItemsByJc ? Object.fromEntries(Object.entries(d.settings.sfgStageItemsByJc).map(([k, v]) => [k, rmKey(v)!])) : d.settings.sfgStageItemsByJc,
        sfgConsumptionMapByJc: d.settings.sfgConsumptionMapByJc ? Object.fromEntries(Object.entries(d.settings.sfgConsumptionMapByJc).map(([k, v]) => [k, rmKey(v)!])) : d.settings.sfgConsumptionMapByJc,
      },
      jobCards: d.jobCards.map(j => ({
        ...j,
        stages: (j.stages || []).filter(s => s.stage !== stage),
        stageQuantities: (j.stageQuantities || []).filter(sq => sq.stage !== stage),
      })),
      operators: (d.operators || []).map(o => ({ ...o, stages: (o.stages || []).filter(s => s !== stage) })),
    }));
    setSelectedStages(prev => prev.filter(s => s !== stage));
    setForm(f => ({
      ...f,
      stageQuantities: (f.stageQuantities || []).filter(sq => sq.stage !== stage),
      stages: (f.stages || []).filter(s => s.stage !== stage),
    }));
    log(`Deleted production stage ${stage}`, "Job Card");
    setStageModal(null);
  };

  const defaultStageQuantities = (qty: number) => STAGES.map(stage => ({
    stage,
    multiplier: STAGE_MULTIPLIERS[stage] ?? 1,
    totalQty: qty * (STAGE_MULTIPLIERS[stage] ?? 1),
  }));

  const orderedSelectedStages = () => {
    const inKnown = stageMaster.filter(s => selectedStages.includes(s));
    const custom = selectedStages.filter(s => !stageMaster.includes(s));
    return [...inKnown, ...custom];
  };

  const [dragStage, setDragStage] = useState<string | null>(null);

  const reorderStages = (from: string, to: string) => {
    if (from === to) return;
    const arr = stageMaster.slice();
    const fi = arr.indexOf(from), ti = arr.indexOf(to);
    if (fi < 0 || ti < 0) return;
    arr.splice(ti, 0, arr.splice(fi, 1)[0]);
    setDB(d => ({ ...d, settings: { ...d.settings, productionStages: arr } }));
    log(`Reordered production stages: ${from} moved before ${to}`, "Job Card");
  };

  const toggleStage = (stage: string) => {
    const on = !selectedStages.includes(stage);
    setSelectedStages(prev => on ? [...prev, stage] : prev.filter(s => s !== stage));
    setForm(f => {
      const mult = STAGE_MULTIPLIERS[stage] ?? 1;
      return {
        ...f,
        stageQuantities: on
          ? [...(f.stageQuantities || []).filter(r => r.stage !== stage), { stage, multiplier: mult, totalQty: f.qty * mult }]
          : (f.stageQuantities || []).filter(r => r.stage !== stage),
        stages: on
          ? [...(f.stages || []).filter(x => x.stage !== stage), { stage, status: "pending" as const }]
          : (f.stages || []).filter(x => x.stage !== stage),
      };
    });
  };

  const blank = (): JobCard => {
    const firstBom = db.boms[0];
    return {
      id: "", number: `${nextNumber("JC", db.jobCards)}${firstBom ? ` - ${firstBom.name}` : ""}`, date: todayISO(), salesOrderId: "", bomId: firstBom?.id || "",
      qcFormatId: db.qcFormats[0]?.id || "", serialStart: "",
      product: firstBom?.name || "", qty: 1, reservedItems: firstBom ? firstBom.materials.filter(m => m.itemId).map(m => ({ itemId: m.itemId!, qty: m.qty })) : [],
      stageQuantities: [],
      stages: [], status: "Open",
      createdAt: new Date().toISOString(),
    };
  };
  const [form, setForm] = useState<JobCard>(blank());

  // Look up the most recently created Job Card with the same product name and inherit its stage prices.
  const inheritStagePrices = (product: string): Record<string, number> => {
    if (!product) return {};
    const norm = product.trim().toLowerCase();
    const match = db.jobCards
      .filter(j => (j.product || "").trim().toLowerCase() === norm && j.stagePrices)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
    if (match?.stagePrices) return { ...match.stagePrices };
    // Fallback to company-level Stage Prices master
    return { ...(db.settings.stagePrices || {}) };
  };

  const openNew = () => {
    const f = blank();
    const bom = db.boms.find(b => b.id === f.bomId);
    if (bom) {
      f.reservedItems = bom.materials.filter(m => m.itemId).map(m => ({ itemId: m.itemId!, qty: m.qty * f.qty }));
      f.number = `${f.number.split(" - ")[0]} - ${bom.name}`;
    }
    f.stagePrices = inheritStagePrices(f.product);
    setEdit(null); setForm(f); setSelectedStages([]); setOpen(true);
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
    const migratedStages = j.stages.flatMap(st => st.stage === "Secondary Winding"
      ? ["Secondary Winding 1", "Secondary Winding 2", "Secondary Winding 3"].map((s, i) => ({ stage: s as ProductionStage, status: i === 0 ? st.status : "pending" as const, worker: i === 0 ? st.worker : undefined, date: i === 0 ? st.date : undefined }))
      : [st],
    );
    // Selected stages = rows with a multiplier, or stages already worked on
    const sel = new Set<string>();
    migratedStageQuantities.forEach(sq => { if (sq.multiplier > 0) sel.add(sq.stage); });
    migratedStages.forEach(st => { if (st.status !== "pending" || st.worker) sel.add(st.stage); });
    setSelectedStages([...sel]);
    setForm({
      ...j,
      reservedItems: j.reservedItems.map(i => ({ ...i })),
      stageQuantities: migratedStageQuantities.filter(sq => sel.has(sq.stage)),
      stages: migratedStages.filter(st => sel.has(st.stage)),
    });
    setOpen(true);
  };

  const save = () => {
    if (!form.qcFormatId) return alert("QC Format selection is mandatory in Job Card.");
    if ((form.stageQuantities || []).length === 0) return alert("Select at least one Production Stage for this Job Card.");
    if (edit) {
      setDB(d => {
        // Holds no longer change central stock — only Raw Material Issue deducts it
        const generated = makeSerials(form, { ...d, jobCards: d.jobCards.map(x => x.id === edit.id ? form : x) });
        return {...d, jobCards: d.jobCards.map(x => x.id === edit.id ? form : x), serials: [...d.serials, ...generated.serials], qcTests: [...d.qcTests, ...generated.tests]};
      });
    } else {
      setDB(d => {
        const newJob = {...form, id: uid()};
        const generated = makeSerials(newJob, d);
        return {...d, jobCards: [newJob, ...d.jobCards], serials: [...d.serials, ...generated.serials], qcTests: [...d.qcTests, ...generated.tests]};
      });
    }
    log(`${edit ? "Updated" : "Created"} Job Card ${form.number}`, "Job Card");
    setOpen(false);
  };
  const remove = (j: JobCard) => {
    if (!confirm(`Delete ${j.number}?`)) return;
    // holds do not affect central stock — nothing to restore
    setDB(d => ({ ...d, jobCards: d.jobCards.filter(x => x.id !== j.id) }));
    log(`Deleted Job Card ${j.number}`, "Job Card");
  };

  const updateBOM = (bomId: string) => {
    const bom = db.boms.find(b => b.id === bomId);
    setForm(f => ({
      ...f,
      bomId,
      // Auto-sync Product name from BOM name so job cards stay consistent with the BOM
      product: bom ? bom.name : f.product,
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

  const updateStagePrice = (stage: string, price: number) => {
    setForm(f => ({ ...f, stagePrices: { ...(f.stagePrices || {}), [stage]: Number(price) || 0 } }));
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
      ${j.stages.slice().sort((a, b) => { const i = (s: string) => { const x = stageMaster.indexOf(s); return x < 0 ? stageMaster.length : x; }; return i(a.stage) - i(b.stage); }).map((s, idx) => `<tr><td>${idx+1}</td><td>${s.stage}</td><td>${s.status}</td><td>${s.worker || "-"}</td><td>${s.date || "-"}</td></tr>`).join("")}
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
          <div className="sm:col-span-2">
            <Label>Product</Label>
            <Input
              value={form.product}
              onChange={(e: any) => {
                const newProduct = e.target.value;
                setForm(f => {
                  const next = { ...f, product: newProduct };
                  // Only inherit on new JC or when current stagePrices are empty (respect explicit edits)
                  if (!edit && (!f.stagePrices || Object.values(f.stagePrices).every(v => !v))) {
                    next.stagePrices = inheritStagePrices(newProduct);
                  }
                  return next;
                });
              }}
              onBlur={(e: any) => {
                if (edit) return;
                const p = e.target.value;
                const inherited = inheritStagePrices(p);
                if (Object.values(inherited).some(v => v > 0)) {
                  setForm(f => ({ ...f, stagePrices: { ...inherited, ...(f.stagePrices || {}) } }));
                }
              }}
            />
          </div>
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
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <h4 className="font-semibold text-sm">Select Production Stages</h4>
            {isAdmin && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setStageName(""); setStageModal({ mode: "create" }); }} data-testid="stage-create-btn"><IconPlus size={12}/> Create Stage</Button>
                <Button size="sm" variant="outline" disabled={!selectedStages.length} onClick={() => { const s = selectedStages[selectedStages.length - 1]; setStageName(s); setStageModal({ mode: "edit", stage: s }); }} data-testid="stage-edit-btn"><IconEdit size={12}/> Edit Stage</Button>
                <Button size="sm" variant="outline" disabled={!selectedStages.length} onClick={() => { const s = selectedStages[selectedStages.length - 1]; setStageModal({ mode: "delete", stage: s }); }} data-testid="stage-delete-btn"><IconTrash size={12}/> Delete Stage</Button>
              </div>
            )}
          </div>
          {isAdmin && <p className="text-[10px] text-slate-500 mb-2">Tip: select a stage pill below, then use Edit/Delete to manage it. Edit renames the stage everywhere (job cards, entries, SFG mappings).</p>}
          <div className="flex flex-wrap gap-2 mb-3" data-testid="jc-stage-selector">
            {stageMaster.map(stage => {
              const on = selectedStages.includes(stage);
              const slug = stage.replace(/\s+/g, "-").toLowerCase();
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => toggleStage(stage)}
                  draggable={isAdmin}
                  onDragStart={() => setDragStage(stage)}
                  onDragOver={(e: any) => { if (isAdmin && dragStage && dragStage !== stage) e.preventDefault(); }}
                  onDrop={(e: any) => { e.preventDefault(); if (isAdmin && dragStage) reorderStages(dragStage, stage); setDragStage(null); }}
                  onDragEnd={() => setDragStage(null)}
                  className={"text-xs px-3 py-1.5 rounded-full border font-medium transition-colors inline-flex items-center " + (on
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400") + (dragStage === stage ? " opacity-50" : "")}
                  data-testid={`jc-stage-toggle-${slug}`}
                  title={isAdmin ? "Click to select · drag to reorder stages" : "Click to select"}
                >
                  {isAdmin && <span className="mr-1.5 cursor-grab opacity-60 tracking-tighter" data-testid={`jc-stage-drag-${slug}`}>⋮⋮</span>}
                  {stage}
                </button>
              );
            })}
          </div>
          <h4 className="font-semibold text-sm mb-2">Production Stage Quantity Calculation</h4>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <Table>
              <thead><tr><Th>Stage</Th><Th>Job Qty</Th><Th>Multiplier</Th><Th>Total Stage Qty</Th><Th>Price / Unit (₹)</Th></tr></thead>
              <tbody>
                {orderedSelectedStages().length === 0 && <tr><Td colSpan={5} className="text-slate-500">No stages selected — pick the required production stages above.</Td></tr>}
                {orderedSelectedStages().map(stageName => {
                  const row = (form.stageQuantities || []).find(r => r.stage === stageName) || { stage: stageName, multiplier: 0, totalQty: 0 };
                  return (
                  <tr key={row.stage}>
                    <Td className="font-medium">{row.stage}</Td>
                    <Td>{form.qty}</Td>
                    <Td><Input className="max-w-32" type="number" min="0" step="0.01" value={row.multiplier} onChange={(e: any) => updateStageMultiplier(row.stage, Number(e.target.value))} /></Td>
                    <Td className="font-semibold text-indigo-600">{row.totalQty}</Td>
                    <Td>
                      <Input
                        className="max-w-32"
                        type="number"
                        min="0"
                        step="0.01"
                        value={(form.stagePrices || {})[row.stage] ?? 0}
                        onChange={(e: any) => updateStagePrice(row.stage, Number(e.target.value))}
                        placeholder="0"
                        data-testid={`jc-stage-price-${row.stage}`}
                      />
                    </Td>
                  </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          <p className="mt-2 text-xs text-slate-500">Only selected stages appear in Daily Production Entry and Production SFG mapping. Total Stage Qty = Job Qty x Stage Multiplier. Enter <b>Price / Unit</b> to auto-fill Price Each on Production Entries; new Job Cards for the same product auto-inherit these prices.</p>
        </div>

        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} data-testid="jc-save-btn">{edit ? "Update" : "Create & Reserve Stock"}</Button></div>
      </Modal>

      <Modal open={!!stageModal} onClose={() => setStageModal(null)} title={stageModal?.mode === "create" ? "Create Production Stage" : stageModal?.mode === "edit" ? `Edit Stage — ${stageModal.stage}` : `Delete Stage — ${stageModal?.stage}`} size="sm">
        {stageModal && (
          <div className="space-y-3" data-testid="stage-manage-modal">
            {stageModal.mode !== "delete" ? (
              <div><Label>Stage Name</Label><Input value={stageName} onChange={(e: any) => setStageName(e.target.value)} placeholder="e.g. Oil Filling" data-testid="stage-name-input" /></div>
            ) : (
              stageHasTransactions(stageModal.stage || "") ? (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-200" data-testid="stage-delete-warning">
                  <b>{stageModal.stage}</b> has production transactions (entries, worked job cards or SFG records) and cannot be deleted. You can rename it instead.
                </div>
              ) : (
                <div className="text-sm text-slate-600 dark:text-slate-300">Delete stage <b>{stageModal.stage}</b>? It will be removed from the stage master, all job cards and SFG mappings. This cannot be undone.</div>
              )
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
              <Button variant="outline" onClick={() => setStageModal(null)}>Cancel</Button>
              {stageModal.mode === "create" && <Button onClick={createStage} data-testid="stage-create-save">Create</Button>}
              {stageModal.mode === "edit" && <Button onClick={renameStage} data-testid="stage-edit-save">Save</Button>}
              {stageModal.mode === "delete" && !stageHasTransactions(stageModal.stage || "") && <Button onClick={deleteStage} data-testid="stage-delete-confirm">Delete</Button>}
            </div>
          </div>
        )}
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
  const [stageDetails, setStageDetails] = useState<{ jcId: string; stage: ProductionStage } | null>(null);
  const [editEntry, setEditEntry] = useState<ProductionEntry | null>(null);
  const [editEntryForm, setEditEntryForm] = useState<Partial<ProductionEntry>>({});
  const [editEntryNote, setEditEntryNote] = useState<string>("");

  const openEditEntry = (e: ProductionEntry) => {
    setEditEntry(e);
    setEditEntryForm({
      date: e.date, todayQty: e.todayQty, operatorName: e.operatorName,
      shift: e.shift, machineName: e.machineName, priceEach: e.priceEach || 0, remarks: e.remarks || "",
    });
    setEditEntryNote("");
  };
  const saveEditedEntry = () => {
    if (!editEntry) return;
    const original = editEntry;
    const changes: Record<string, { from: any; to: any }> = {};
    (Object.keys(editEntryForm) as Array<keyof ProductionEntry>).forEach(k => {
      const from = (original as any)[k];
      const to = (editEntryForm as any)[k];
      if (from !== to && !(from == null && to == null)) changes[k as string] = { from, to };
    });
    if (Object.keys(changes).length === 0) { setEditEntry(null); return; }
    setDB(d => ({
      ...d,
      productionEntries: d.productionEntries.map(pe => pe.id === original.id ? {
        ...pe,
        ...editEntryForm,
        editHistory: [
          ...(pe.editHistory || []),
          { at: new Date().toISOString(), byName: currentUser?.name || currentUser?.email || "User", changes, note: editEntryNote || undefined },
        ],
      } : pe),
    }));
    log(`Production entry fix: ${original.jobCardNumber} · ${original.stage} · ${Object.keys(changes).join(", ")}`, "Production");
    setEditEntry(null);
  };
  const [entryQty, setEntryQty] = useState(0);
  const [operatorId, setOperatorId] = useState("");
  const [priceEach, setPriceEach] = useState(0);
  const [shift, setShift] = useState<"Day" | "Night" | "General">("Day");
  const [machineName, setMachineName] = useState("");
  const [operatorDrill, setOperatorDrill] = useState<string | null>(null);
  const [stagePricesOpen, setStagePricesOpen] = useState(false);
  const [stagePriceDraft, setStagePriceDraft] = useState<Record<string, number>>(db.settings.stagePrices || {});
  const [remarks, setRemarks] = useState("");
  const [entryWarning, setEntryWarning] = useState("");
  const [dateMode, setDateMode] = useState<"today" | "yesterday" | "custom">("today");
  const [customDate, setCustomDate] = useState("");
  const shiftDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const entryMinDate = shiftDays(7);
  const entryDate = dateMode === "today" ? todayISO() : dateMode === "yesterday" ? shiftDays(1) : customDate;

  // Handle deep-link from Operator Ledger: read amrest_goto_jc_id and scroll+highlight.
  useEffect(() => {
    const targetId = localStorage.getItem("amrest_goto_jc_id");
    if (!targetId) return;
    localStorage.removeItem("amrest_goto_jc_id");
    // Wait for cards to render
    setTimeout(() => {
      const el = document.getElementById(`jc-${targetId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("ring-2", "ring-indigo-500");
        setTimeout(() => el.classList.remove("ring-2", "ring-indigo-500"), 2500);
      }
    }, 300);
  }, []);

  const inProg = db.jobCards.filter(j => j.status !== "Completed");
  const completed = db.jobCards.filter(j => j.status === "Completed").length;
  const stageMaster: string[] = db.settings.productionStages?.length ? db.settings.productionStages : STAGES;

  const orderStages = <T extends { stage: string }>(arr: T[]): T[] => {
    const idx = (s: string) => { const i = stageMaster.indexOf(s); return i < 0 ? stageMaster.length : i; };
    return arr.slice().sort((a, b) => idx(a.stage) - idx(b.stage));
  };

  const stageCounts = stageMaster.map(s => ({
    label: s.replace(" / ", " ").split(" ")[0],
    count: db.jobCards.reduce((acc, j) => acc + j.stages.filter(x => x.stage === s && x.status === "in-progress").length, 0),
  }));

  const selectedJob = db.jobCards.find(j => j.id === entryJobId) || db.jobCards[0];
  const enabledStages = useMemo(() => {
    if (!selectedJob) return stageMaster;
    if (!selectedJob.stageQuantities || selectedJob.stageQuantities.length === 0) return stageMaster;
    const active = selectedJob.stageQuantities.filter(row => (row.multiplier ?? 0) > 0).map(row => row.stage);
    return [...stageMaster.filter(s => active.includes(s)), ...active.filter(s => !stageMaster.includes(s))];
  }, [selectedJob, stageMaster]);
  // Auto-correct entryStage when it's not enabled for the current job
  useEffect(() => {
    if (!entryOpen) return;
    if (enabledStages.length > 0 && !enabledStages.includes(entryStage)) {
      setEntryStage(enabledStages[0]);
    }
  }, [entryOpen, enabledStages, entryStage]);
  const entryTotalQty = selectedJob?.stageQuantities?.find(row => row.stage === entryStage)?.totalQty || selectedJob?.qty || 0;
  const mappedSfgItem = selectedJob ? db.items.find(i => i.id === db.settings.sfgStageItemsByJc?.[selectedJob.id]?.[entryStage]) : undefined;
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
    if (!entryDate) return alert("Select a production date");
    if (entryDate > todayISO() || entryDate < entryMinDate) return alert("Production date must be within the last 7 days and cannot be a future date");
    const qty = isAdmin ? entryQty : Math.min(entryQty, balanceQty);
    const operator = db.operators.find(o => o.id === operatorId);
    const operatorName = operator?.name || "";
    const entry: ProductionEntry = {
      id: uid(), date: entryDate, jobCardId: selectedJob.id, jobCardNumber: selectedJob.number,
      stage: entryStage, productName: selectedJob.product, totalJobQty: entryTotalQty,
      previousCompletedQty: previousCompleted, todayQty: qty, balanceQty: Math.max(0, entryTotalQty - previousCompleted - qty),
      operatorName, operatorId, shift, machineName, priceEach: Number(priceEach) || 0,
      status: previousCompleted + qty >= entryTotalQty ? "Completed" : "Running", remarks, createdAt: new Date().toISOString(),
    };
    let sfgShortages: string[] = [];
    setDB(d => {
      let next: DB = {
        ...d,
        productionEntries: [entry, ...d.productionEntries],
        jobCards: d.jobCards.map(j => {
          if (j.id !== selectedJob.id) return j;
          const stageTotal = previousCompleted + qty;
          const stages = j.stages.map(s => s.stage === entryStage ? { ...s, status: stageTotal >= entryTotalQty ? "done" as const : "in-progress" as const, date: entryDate, worker: operatorName } : s);
          const complete = stages.every(s => s.status === "done");
          return { ...j, stages, status: complete ? "Completed" as const : "In Progress" as const };
        }),
        serials: d.serials.map(s => s.jobCardId === selectedJob.id && entryStage === "Dispatch Ready" ? { ...s, productionStatus: "Completed" as const } : s.jobCardId === selectedJob.id ? { ...s, productionStatus: "In Production" as const } : s),
      };
      const prodUpd = applySfgProduction(next, { jobCardId: selectedJob.id, jobCardNumber: selectedJob.number, stage: entryStage, qty, entryId: entry.id, date: entryDate });
      next = { ...next, ...prodUpd };
      const cons = applySfgAutoConsumption(next, { stage: entryStage, qty, jobCardId: selectedJob.id, jobCardNumber: selectedJob.number, date: entryDate });
      next = { ...next, ...cons.updates };
      sfgShortages = cons.shortages;
      return next;
    });
    if (sfgShortages.length) alert("SFG shortage — consumed partially:\n" + sfgShortages.join("\n"));
    const sfgMappedItemId = db.settings.sfgStageItemsByJc?.[selectedJob.id]?.[entryStage];
    if (sfgMappedItemId) log(`SFG produced: ${db.items.find(i => i.id === sfgMappedItemId)?.name || entryStage} × ${qty} (${selectedJob.number})`, "Production SFG");
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
      <div className="flex items-center justify-between gap-3 flex-wrap"><div><h1 className="text-2xl font-bold">Production Dashboard</h1><p className="text-sm text-slate-500">Stage-wise tracking and daily updates</p></div><div className="flex gap-2"><Button variant="outline" onClick={printDailyProduction}><IconPrint size={14}/> Daily Report</Button>{canEditProduction && <Button onClick={() => { setDateMode("today"); setCustomDate(""); setEntryOpen(true); }} data-testid="open-daily-entry"><IconPlus size={14}/> Daily Production Entry</Button>}</div></div>

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
        <Card><div className="p-4"><h3 className="font-semibold mb-3">Operator Wise Output</h3>{groupRows(db.productionEntries, "operatorName", (name) => setOperatorDrill(name))}</div></Card>
        <Card><div className="p-4"><h3 className="font-semibold mb-3">Machine Wise Output</h3>{groupRows(db.productionEntries, "machineName")}</div></Card>
      </div>

      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-semibold">Stage Prices (₹ per unit)</h3>
              <p className="text-xs text-slate-500 mt-0.5">Fix a default rate for each production stage. Auto-fills "Price Each" when creating a Production Entry.</p>
            </div>
            {canEditProduction && (
              <Button size="sm" variant="outline" onClick={() => { setStagePriceDraft(db.settings.stagePrices || {}); setStagePricesOpen(true); }} data-testid="stage-prices-edit-btn">
                <IconEdit size={14}/> Edit Stage Prices
              </Button>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {stageMaster.map(s => {
              const price = (db.settings.stagePrices || {})[s] || 0;
              return (
                <div key={s} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 bg-slate-50 dark:bg-slate-800/40" data-testid={`stage-price-tile-${s}`}>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 truncate" title={s}>{s}</div>
                  <div className={"text-sm font-semibold " + (price > 0 ? "text-slate-800 dark:text-slate-100" : "text-slate-400")}>{price > 0 ? `₹${price}` : "— Not set"}</div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="space-y-3">
        {inProg.map(j => (
          <div key={j.id} id={`jc-${j.id}`} className="rounded-xl transition-shadow scroll-mt-4">
          <Card>
            <div className="p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <div className="font-semibold">{j.number} — {j.product}</div>
                  <div className="text-xs text-slate-500">Qty: {j.qty} | Created: {j.date}</div>
                </div>
                <Badge color={j.status === "In Progress" ? "yellow" : "blue"}>{j.status}</Badge>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {orderStages(j.stages).map(s => (
                  <div key={s.stage} className="relative">
                  <button onClick={() => s.status !== "done" && completeStage(j.id, s.stage)}
                    disabled={!canEditProduction || (currentUser?.role === "testing" && s.stage !== "Testing") || (currentUser?.role === "production" && s.stage === "Testing")}
                    title={currentUser?.role === "testing" && s.stage !== "Testing" ? "Testing users can update only the Testing stage" : currentUser?.role === "production" && s.stage === "Testing" ? "Testing stage is reserved for Testing users" : "Click to complete stage"}
                    className={`w-full text-left p-2 rounded-lg border text-xs disabled:opacity-50 disabled:cursor-not-allowed ${s.status === "done" ? "bg-emerald-50 border-emerald-300 dark:bg-emerald-900/30 dark:border-emerald-700" : s.status === "in-progress" ? "bg-amber-50 border-amber-300 dark:bg-amber-900/30 dark:border-amber-700 cursor-pointer" : "bg-slate-50 border-slate-300 dark:bg-slate-800 dark:border-slate-700 cursor-pointer hover:border-indigo-400"}`}>
                    <div className="flex items-center gap-1.5 pr-6">
                      {s.status === "done" && <IconCheck size={12}/>}
                      <span className="font-medium">{s.stage}</span>
                    </div>
                    {s.worker && <div className="text-slate-500 mt-0.5">{s.worker}</div>}
                    {s.date && <div className="text-slate-400">{s.date}</div>}
                  </button>
                  <button
                    type="button"
                    onClick={(ev) => { ev.stopPropagation(); setStageDetails({ jcId: j.id, stage: s.stage }); }}
                    className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300"
                    title="View stage details & history"
                    data-testid={`stage-details-${j.id}-${s.stage}`}
                  >Details</button>
                  </div>
                ))}
              </div>
            </div>
          </Card>
          </div>
        ))}
        {inProg.length === 0 && <Card><Empty title="No active production" subtitle="Create a job card to start"/></Card>}
      </div>

      <Modal open={entryOpen} onClose={() => setEntryOpen(false)} title="Daily Production Entry" size="lg">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Job Card Number</Label><Select value={entryJobId} onChange={(e: any) => { setEntryJobId(e.target.value); setEntryQty(0); }}>{db.jobCards.map(j => <option key={j.id} value={j.id}>{j.number} - {j.product}</option>)}</Select></div>
          <div><Label>Production Stage</Label>
            <Select
              value={entryStage}
              onChange={(e: any) => {
                const newStage = e.target.value as ProductionStage;
                setEntryStage(newStage);
                setEntryQty(0);
                setOperatorId("");
                // Operator stage-wise rate wins, then JC-level stage price, then company-level Stage Prices master
                const op = db.operators.find(o => o.id === operatorId);
                const opRate = op?.stageRates?.[newStage];
                const currentJc = db.jobCards.find(j => j.id === entryJobId);
                const jcPrice = (currentJc?.stagePrices || {})[newStage];
                const settingsPrice = (db.settings.stagePrices || {})[newStage];
                const priceToUse = (typeof opRate === "number" && opRate > 0) ? opRate
                  : (typeof jcPrice === "number" && jcPrice > 0) ? jcPrice
                  : (typeof settingsPrice === "number" && settingsPrice > 0) ? settingsPrice : 0;
                if (priceToUse > 0) setPriceEach(priceToUse);
              }}
              data-testid="prod-entry-stage-select"
            >
              {enabledStages.length > 0
                ? enabledStages.map(s => <option key={s} value={s}>{s}</option>)
                : <option value="">— No stages enabled in Job Card —</option>}
            </Select>
            {enabledStages.length < stageMaster.length && selectedJob && (
              <div className="text-[10px] text-slate-500 mt-1">Showing only stages enabled in this Job Card.</div>
            )}
          </div>
          <div className="sm:col-span-2">
            <Label>Production Date *</Label>
            <div className="flex flex-wrap items-center gap-2" data-testid="entry-date-picker">
              {([["today", "Today"], ["yesterday", "Yesterday"], ["custom", "Select Date"]] as const).map(([k, lbl]) => (
                <button key={k} type="button" onClick={() => setDateMode(k)}
                  className={"text-xs px-3 py-1.5 rounded-full border font-medium " + (dateMode === k ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 hover:border-indigo-400")}
                  data-testid={`entry-date-${k}`}>{lbl}</button>
              ))}
              {dateMode === "custom" && (
                <Input type="date" className="!w-44" min={entryMinDate} max={todayISO()} value={customDate} onChange={(e: any) => setCustomDate(e.target.value)} data-testid="entry-date-custom" />
              )}
              <span className="text-xs text-slate-500">Entry will be saved with date: <b data-testid="entry-date-preview">{entryDate || "—"}</b></span>
            </div>
          </div>
          <div><Label>Product Name</Label><Input value={selectedJob?.product || ""} disabled /></div>
          <div>
            <Label>Semi-Finished Product (Auto-Mapped)</Label>
            <Input value={mappedSfgItem ? mappedSfgItem.name : "— Not mapped for this JC + Stage —"} disabled data-testid="prod-entry-sfg-item" />
            {mappedSfgItem && <div className="text-[10px] text-emerald-600 mt-1">Saving will add Today Qty to this SFG's stock under {selectedJob?.number}</div>}
          </div>
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
                if (op) {
                  const stageRate = op.stageRates?.[entryStage];
                  if (stageRate && stageRate > 0) setPriceEach(stageRate);
                  else if (!priceEach && op.defaultRate) setPriceEach(op.defaultRate);
                }
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

      <Modal open={stagePricesOpen} onClose={() => setStagePricesOpen(false)} title="Edit Stage Prices" size="lg">
        <div className="space-y-3 text-sm">
          <p className="text-xs text-slate-500">Enter a fixed rate (₹ per unit) for each production stage. When you create a Production Entry for a stage, its price auto-fills from here.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {stageMaster.map(s => (
              <div key={s}>
                <Label>{s}</Label>
                <Input
                  type="number"
                  value={stagePriceDraft[s] ?? 0}
                  onChange={(e: any) => setStagePriceDraft(prev => ({ ...prev, [s]: Number(e.target.value) || 0 }))}
                  placeholder="0"
                  data-testid={`stage-price-input-${s}`}
                />
              </div>
            ))}
          </div>
          <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
            <Button variant="ghost" onClick={() => setStagePriceDraft(Object.fromEntries(stageMaster.map(s => [s, 0])))} data-testid="stage-prices-reset">Reset All to 0</Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStagePricesOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  setDB(d => ({ ...d, settings: { ...d.settings, stagePrices: stagePriceDraft } }));
                  log("Updated Stage Prices master", "Production");
                  setStagePricesOpen(false);
                }}
                data-testid="stage-prices-save"
              >Save</Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={!!operatorDrill} onClose={() => setOperatorDrill(null)} title={operatorDrill ? `Operator: ${operatorDrill}` : "Operator"} size="xl">
        {operatorDrill && (() => {
          const rows = db.productionEntries
            .filter(e => (e.operatorName || "Not Set") === operatorDrill)
            .slice()
            .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          const totalQty = rows.reduce((s, e) => s + (Number(e.todayQty) || 0), 0);
          const uniqueJCs = new Set(rows.map(e => e.jobCardId)).size;
          const scrollToJC = (jcId: string) => {
            setOperatorDrill(null);
            setTimeout(() => {
              const el = document.getElementById(`jc-${jcId}`);
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                el.classList.add("ring-2", "ring-indigo-500");
                setTimeout(() => el.classList.remove("ring-2", "ring-indigo-500"), 2500);
              }
            }, 200);
          };
          return (
            <div className="space-y-4 text-sm">
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 p-3 bg-emerald-50 dark:bg-emerald-900/20">
                  <div className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Total Output</div>
                  <div className="text-2xl font-bold text-emerald-800 dark:text-emerald-200">{totalQty}</div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Production Entries</div>
                  <div className="text-2xl font-bold">{rows.length}</div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Job Cards Worked</div>
                  <div className="text-2xl font-bold">{uniqueJCs}</div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden max-h-[420px] overflow-y-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Job Card #</Th>
                      <Th>Product</Th>
                      <Th>Stage</Th>
                      <Th className="text-right">Qty</Th>
                      <Th>Machine</Th>
                      <Th>Shift</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && <tr><Td colSpan={7}><Empty title="No production entries" /></Td></tr>}
                    {rows.map(e => {
                      const jc = db.jobCards.find(j => j.id === e.jobCardId);
                      return (
                        <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <Td>{e.date}</Td>
                          <Td className="font-mono text-xs">
                            {jc ? (
                              <button
                                type="button"
                                className="text-indigo-600 hover:underline"
                                onClick={() => scrollToJC(jc.id)}
                                title="Jump to this Job Card"
                                data-testid={`op-drill-jc-${jc.number}`}
                              >{jc.number}</button>
                            ) : "—"}
                          </Td>
                          <Td>{jc?.product || "—"}</Td>
                          <Td>{e.stage}</Td>
                          <Td className="text-right font-semibold">{e.todayQty}</Td>
                          <Td>{e.machineName || "—"}</Td>
                          <Td>{e.shift || "—"}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-700">
                <Button variant="outline" onClick={() => setOperatorDrill(null)}>Close</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Stage Details Modal */}
      <Modal
        open={!!stageDetails}
        onClose={() => setStageDetails(null)}
        title={stageDetails ? `Stage Details — ${stageDetails.stage}` : ""}
        size="xl"
      >
        {stageDetails && (() => {
          const jc = db.jobCards.find(j => j.id === stageDetails.jcId);
          const rows = db.productionEntries
            .filter(e => e.jobCardId === stageDetails.jcId && e.stage === stageDetails.stage)
            .slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
          const totalToday = rows.reduce((s, r) => s + (r.todayQty || 0), 0);
          const totalAmt = rows.reduce((s, r) => s + (r.todayQty || 0) * (r.priceEach || 0), 0);
          const stageTarget = jc?.stageQuantities?.find(sq => sq.stage === stageDetails.stage)?.totalQty ?? (jc?.qty || 0);
          const balanceQty = Math.max(0, stageTarget - totalToday);
          return (
            <div className="space-y-3" data-testid="stage-details-modal">
              <div className="text-xs text-slate-500">Job Card <b>{jc?.number}</b> · Product <b>{jc?.product}</b> · Total Job Qty <b>{jc?.qty}</b></div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 text-center border border-blue-200 dark:border-blue-800" data-testid="kpi-total-qty">
                  <div className="text-[10px] uppercase text-blue-700 font-semibold">Total Qty</div>
                  <div className="text-2xl font-bold text-blue-700">{stageTarget}</div>
                  <div className="text-[9px] text-blue-500 mt-0.5">from Job Card</div>
                </div>
                <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 p-3 text-center border border-indigo-200 dark:border-indigo-800" data-testid="kpi-completed-qty">
                  <div className="text-[10px] uppercase text-indigo-700 font-semibold">Previously Completed</div>
                  <div className="text-2xl font-bold text-indigo-700">{totalToday}</div>
                  <div className="text-[9px] text-indigo-500 mt-0.5">{rows.length} entries</div>
                </div>
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-center border border-amber-200 dark:border-amber-800" data-testid="kpi-balance-qty">
                  <div className="text-[10px] uppercase text-amber-700 font-semibold">Balance Qty</div>
                  <div className="text-2xl font-bold text-amber-700">{balanceQty}</div>
                  <div className="text-[9px] text-amber-600 mt-0.5">{stageTarget} − {totalToday}</div>
                </div>
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 text-center border border-emerald-200 dark:border-emerald-800" data-testid="kpi-total-amount">
                  <div className="text-[10px] uppercase text-emerald-700 font-semibold">Total Amount</div>
                  <div className="text-2xl font-bold text-emerald-700">{fmtINR(totalAmt)}</div>
                  <div className="text-[9px] text-emerald-600 mt-0.5">stage value</div>
                </div>
              </div>
              <div className="max-h-[430px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <Table>
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr>
                      <Th>Date</Th>
                      <Th>Operator</Th>
                      <Th>Shift</Th>
                      <Th>Machine</Th>
                      <Th className="text-right">Prev Qty</Th>
                      <Th className="text-right">Today</Th>
                      <Th className="text-right">Balance</Th>
                      <Th className="text-right">Rate</Th>
                      <Th className="text-right">Amount</Th>
                      <Th>Remarks</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><Td colSpan={11}><Empty title="No entries yet for this stage" /></Td></tr>
                    ) : rows.map(e => (
                      <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <Td>{e.date}</Td>
                        <Td className="font-medium">{e.operatorName}</Td>
                        <Td>{e.shift}</Td>
                        <Td>{e.machineName}</Td>
                        <Td className="text-right">{e.previousCompletedQty}</Td>
                        <Td className="text-right font-semibold">{e.todayQty}</Td>
                        <Td className="text-right">{e.balanceQty}</Td>
                        <Td className="text-right">{fmtINR(e.priceEach || 0)}</Td>
                        <Td className="text-right font-semibold">{fmtINR((e.priceEach || 0) * (e.todayQty || 0))}</Td>
                        <Td className="text-xs text-slate-500 max-w-40 truncate" title={e.remarks}>{e.remarks || "—"}
                          {(e.editHistory || []).length > 0 && <Badge color="yellow" className="ml-1">{e.editHistory!.length} edits</Badge>}
                        </Td>
                        <Td>
                          {canEditProduction && (
                            <Button size="sm" variant="ghost" onClick={() => openEditEntry(e)} title="Fix / edit this entry" data-testid={`stage-entry-edit-${e.id}`}>Fix</Button>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="flex justify-end pt-1">
                <Button variant="ghost" onClick={() => setStageDetails(null)} data-testid="stage-details-close">Close</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Fix Entry Modal */}
      <Modal open={!!editEntry} onClose={() => setEditEntry(null)} title={editEntry ? `Fix Entry — ${editEntry.jobCardNumber} · ${editEntry.stage} · ${editEntry.date}` : ""} size="lg">
        {editEntry && (
          <div className="space-y-3" data-testid="stage-entry-fix-modal">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={editEntryForm.date || ""} onChange={(e: any) => setEditEntryForm(f => ({ ...f, date: e.target.value }))} data-testid="fix-date" /></div>
              <div><Label>Operator</Label><Input value={editEntryForm.operatorName || ""} onChange={(e: any) => setEditEntryForm(f => ({ ...f, operatorName: e.target.value }))} data-testid="fix-operator" /></div>
              <div><Label>Today Qty</Label><Input type="number" value={editEntryForm.todayQty ?? 0} onChange={(e: any) => setEditEntryForm(f => ({ ...f, todayQty: Number(e.target.value) || 0 }))} data-testid="fix-today" /></div>
              <div><Label>Shift</Label>
                <Select value={editEntryForm.shift || "General"} onChange={(e: any) => setEditEntryForm(f => ({ ...f, shift: e.target.value as any }))} data-testid="fix-shift">
                  <option value="Day">Day</option><option value="Night">Night</option><option value="General">General</option>
                </Select>
              </div>
              <div><Label>Machine</Label><Input value={editEntryForm.machineName || ""} onChange={(e: any) => setEditEntryForm(f => ({ ...f, machineName: e.target.value }))} data-testid="fix-machine" /></div>
              <div><Label>Price / Unit</Label><Input type="number" value={editEntryForm.priceEach ?? 0} onChange={(e: any) => setEditEntryForm(f => ({ ...f, priceEach: Number(e.target.value) || 0 }))} data-testid="fix-price" /></div>
              <div className="sm:col-span-2"><Label>Remarks</Label><Input value={editEntryForm.remarks || ""} onChange={(e: any) => setEditEntryForm(f => ({ ...f, remarks: e.target.value }))} data-testid="fix-remarks" /></div>
              <div className="sm:col-span-2"><Label>Reason for edit (audit note)</Label><Input value={editEntryNote} onChange={(e: any) => setEditEntryNote(e.target.value)} placeholder="e.g. Corrected shift; qty mis-typed" data-testid="fix-note" /></div>
            </div>
            {(editEntry.editHistory || []).length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/10 p-3">
                <div className="text-xs font-semibold text-amber-800 mb-2">Update History</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {(editEntry.editHistory || []).slice().reverse().map((h, i) => (
                    <div key={i} className="text-[11px] text-slate-700 dark:text-slate-300 border-b border-amber-100 py-1">
                      <div><b>{new Date(h.at).toLocaleString()}</b> — {h.byName}{h.note ? ` · ${h.note}` : ""}</div>
                      <div className="text-slate-500 pl-3">
                        {Object.entries(h.changes).map(([k, v]) => (<span key={k}>{k}: <b>{String(v.from)}</b> → <b>{String(v.to)}</b>&nbsp;&nbsp;</span>))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setEditEntry(null)} data-testid="fix-cancel">Cancel</Button>
              <Button onClick={saveEditedEntry} data-testid="fix-save">Save Changes</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function groupRows(entries: ProductionEntry[], field: "operatorName" | "machineName", onClick?: (name: string) => void) {
  const map = new Map<string, number>();
  entries.forEach(e => map.set(e[field] || "Not Set", (map.get(e[field] || "Not Set") || 0) + e.todayQty));
  const rows = Array.from(map.entries()).slice(0, 8);
  if (!rows.length) return <Empty title="No data" />;
  return (
    <div className="space-y-2">
      {rows.map(([name, qty]) => onClick ? (
        <button
          key={name}
          type="button"
          onClick={() => onClick(name)}
          className="w-full flex justify-between items-center text-sm border-b border-slate-100 dark:border-slate-800 pb-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-1 rounded transition-colors cursor-pointer"
          data-testid={`operator-row-${name}`}
        >
          <span className="text-indigo-600 hover:underline">{name}</span>
          <b>{qty}</b>
        </button>
      ) : (
        <div key={name} className="flex justify-between text-sm border-b border-slate-100 dark:border-slate-800 pb-2">
          <span>{name}</span>
          <b>{qty}</b>
        </div>
      ))}
    </div>
  );
}
