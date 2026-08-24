import { useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
import type { DeliveryChallan, SalesOrder, JobCard, ProductionEntry, ProductionStage } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint } from "../components/icons";
import { calcDocTotalsWithFreight, fmtINR, nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

interface DispatchRow {
  name: string;
  ordered: number;
  alreadyDispatched: number;   // total qty dispatched for this SO+item across all DCs
  jcCompleted: number;         // qty already completed on the selected JC (Dispatch Ready reached)
  jcAlreadyDispatched: number; // qty already dispatched linked to this JC
  currentQty: number;
  rate: number;
  gst: number;
}

// Sum of qty already dispatched for a given SO/item name across all existing challans,
// excluding the challan currently being edited (if any).
function sumDispatched(challans: DeliveryChallan[], salesOrderId: string, itemName: string, excludeChallanId?: string) {
  return challans
    .filter(c => c.salesOrderId === salesOrderId && c.id !== excludeChallanId)
    .flatMap(c => c.items || [])
    .filter(i => i.name === itemName)
    .reduce((s, i) => s + (Number(i.qty) || 0), 0);
}

// Sum of qty already dispatched against a specific JC (across all DCs), used to enforce JC-cap.
function sumDispatchedFromJC(challans: DeliveryChallan[], jobCardId: string, excludeChallanId?: string) {
  return challans
    .filter(c => c.jobCardId === jobCardId && c.id !== excludeChallanId)
    .flatMap(c => c.items || [])
    .reduce((s, i) => s + (Number(i.qty) || 0), 0);
}

// A JC's "completed" qty for dispatch = the qty that has reached the final Dispatch Ready stage.
// If the JC status is already "Completed", the full qty is considered dispatch-ready.
function jobCardCompletedQty(jc: JobCard, entries: ProductionEntry[]) {
  if (jc.status === "Completed") return jc.qty;
  const dispatchReady = entries
    .filter(e => e.jobCardId === jc.id && e.stage === ("Dispatch Ready" as ProductionStage))
    .reduce((s, e) => s + (Number(e.todayQty) || 0), 0);
  return Math.min(jc.qty, dispatchReady);
}

// Build a dispatch row from a JC, with or without a linked SO.
// - With SO: cap = min(SO balance for the JC's product, JC completed remaining).
// - Without SO: cap = JC completed remaining. ordered = JC.qty; alreadyDispatched = 0 for display.
function buildDispatchRow(
  so: SalesOrder | undefined,
  jc: JobCard,
  entries: ProductionEntry[],
  challans: DeliveryChallan[],
  excludeChallanId?: string,
  existing?: DeliveryChallan["items"],
): DispatchRow | null {
  const jcCompleted = jobCardCompletedQty(jc, entries);
  const jcAlreadyDispatched = sumDispatchedFromJC(challans, jc.id, excludeChallanId);
  const jcRemaining = Math.max(0, jcCompleted - jcAlreadyDispatched);

  if (so) {
    // A JC targets exactly one product name. Try to find the matching SO item.
    const soi = so.items.find(i => i.name === jc.product);
    if (soi) {
      const already = sumDispatched(challans, so.id, soi.name, excludeChallanId);
      const soBalance = Math.max(0, soi.qty - already);
      const cap = Math.min(soBalance, jcRemaining);
      const existingRow = existing?.find(x => x.name === soi.name);
      return {
        name: soi.name,
        ordered: soi.qty,
        alreadyDispatched: already,
        jcCompleted,
        jcAlreadyDispatched,
        currentQty: existingRow?.qty ?? cap,
        rate: existingRow?.rate ?? soi.rate,
        gst: existingRow?.gst ?? soi.gst,
      };
    }
    // SO exists but product name mismatch — fall through to JC-only dispatch.
  }

  // No SO linked (or product mismatch) — dispatch directly from the JC.
  const existingRow = existing?.find(x => x.name === jc.product);
  return {
    name: jc.product,
    ordered: jc.qty,
    alreadyDispatched: 0,
    jcCompleted,
    jcAlreadyDispatched,
    currentQty: existingRow?.qty ?? jcRemaining,
    rate: existingRow?.rate ?? 0,
    gst: existingRow?.gst ?? 18,
  };
}

const STAGES: ProductionStage[] = ["LV Winding", "HV Winding", "Primary Winding", "Secondary Winding 1", "Secondary Winding 2", "Secondary Winding 3", "Core Coil Assembly", "Tanking", "Finishing", "Testing Ready", "Dispatch Ready"];

export function Challans() {
  const { db, setDB, log, currentUser } = useStore();
  const canCreate = userCan(currentUser, "challans", "create");
  const canEdit = userCan(currentUser, "challans", "edit");
  const canDelete = userCan(currentUser, "challans", "delete");
  const canPrint = userCan(currentUser, "challans", "print");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<DeliveryChallan | null>(null);
  const [balancePrompt, setBalancePrompt] = useState<{ so: SalesOrder; parentJc: JobCard; balance: number } | null>(null);
  const [viewDC, setViewDC] = useState<DeliveryChallan | null>(null);

  const blank = (): DeliveryChallan => ({
    id: "", number: nextNumber("DC", db.challans), date: todayISO(),
    salesOrderId: "", jobCardId: "", customerId: "",
    items: [], freight: 0,
    vehicle: "", driver: "", transport: "", acknowledged: false, createdAt: new Date().toISOString(),
  });
  const [form, setForm] = useState<DeliveryChallan>(blank());
  const [row, setRow] = useState<DispatchRow | null>(null);

  const currentSO = db.salesOrders.find(s => s.id === form.salesOrderId);
  const currentJC = db.jobCards.find(j => j.id === form.jobCardId);

  // Any JC (with or without SO link) whose completed qty is not yet fully dispatched is eligible.
  // A JC with status "Completed" counts as fully ready (jc.qty), even without production entries.
  const dispatchableJobCards = useMemo(() => {
    return db.jobCards.filter(j => {
      const completed = jobCardCompletedQty(j, db.productionEntries);
      if (completed <= 0) return false;
      const dispatched = sumDispatchedFromJC(db.challans, j.id, edit?.id);
      return dispatched < completed;
    });
  }, [db.jobCards, db.productionEntries, db.challans, edit?.id]);

  const totals = useMemo(() => {
    const items = row ? [{ qty: row.currentQty, rate: row.rate, gst: row.gst }] : [];
    return calcDocTotalsWithFreight(items, Number(form.freight) || 0);
  }, [row, form.freight]);
  const grandTotal = totals.total;

  const openNew = () => {
    setEdit(null);
    setForm(blank());
    setRow(null);
    setOpen(true);
  };
  const openEdit = (c: DeliveryChallan) => {
    setEdit(c);
    setForm({ ...c });
    const jc = db.jobCards.find(j => j.id === c.jobCardId);
    const so = db.salesOrders.find(s => s.id === c.salesOrderId);
    if (jc) setRow(buildDispatchRow(so, jc, db.productionEntries, db.challans, c.id, c.items));
    else setRow(null);
    setOpen(true);
  };

  const applyJobCard = (jobCardId: string) => {
    const jc = db.jobCards.find(j => j.id === jobCardId);
    if (!jc) { setForm(f => ({ ...f, jobCardId: "", salesOrderId: "", customerId: "" })); setRow(null); return; }
    const so = jc.salesOrderId ? db.salesOrders.find(s => s.id === jc.salesOrderId) : undefined;
    setForm(f => ({
      ...f,
      jobCardId,
      salesOrderId: so?.id || "",
      customerId: so?.customerId || f.customerId || "",
      freight: so?.freight ?? f.freight ?? 0,
    }));
    setRow(buildDispatchRow(so, jc, db.productionEntries, db.challans, edit?.id));
  };

  const updateRow = (patch: Partial<DispatchRow>) => {
    setRow(prev => prev ? { ...prev, ...patch } : prev);
  };

  const save = () => {
    if (!currentJC) return alert("Job Card is required — dispatch is only allowed against a Job Card. If none exists, please create a Job Card in Production first.");
    if (!row) return alert("No dispatch row available. Please re-select the Job Card.");
    if (!form.customerId) return alert("Please select a Customer for this dispatch.");
    // Cap = min(SO balance for item, JC completed remaining). If no SO, only JC cap applies.
    const soBalance = currentSO ? Math.max(0, row.ordered - row.alreadyDispatched) : Infinity;
    const jcRemaining = Math.max(0, row.jcCompleted - row.jcAlreadyDispatched);
    const cap = Math.min(soBalance, jcRemaining);
    if (row.currentQty <= 0) return alert(`Enter a Current Dispatch quantity greater than 0.`);
    if (row.currentQty > cap) {
      const reason = jcRemaining < soBalance
        ? `only ${jcRemaining} unit(s) are completed on Job Card ${currentJC.number}`
        : `only ${soBalance} unit(s) remain on Sales Order ${currentSO?.number || ""}`;
      return alert(`Cannot dispatch ${row.currentQty} unit(s) of "${row.name}" — ${reason}. Please reduce the qty.`);
    }
    const dispatchItems = [{ name: row.name, qty: row.currentQty, rate: row.rate, gst: row.gst }];
    const payload: DeliveryChallan = { ...form, items: dispatchItems };

    // Total dispatched against this JC after this save
    const jcTotalDispatched = row.jcAlreadyDispatched + row.currentQty;
    const jcFullyDispatched = jcTotalDispatched >= currentJC.qty;

    // Check if the SO becomes fully dispatched → auto-mark "Delivered"
    let soFullyDispatched = false;
    if (currentSO) {
      const newDispatchedForItemPreview = row.alreadyDispatched + row.currentQty;
      const totalSoOrderedPreview = currentSO.items.reduce((s, i) => s + i.qty, 0);
      const totalSoDispatchedPreview = currentSO.items.reduce((s, i) => {
        if (i.name === row.name) return s + newDispatchedForItemPreview;
        return s + sumDispatched(db.challans, currentSO.id, i.name, edit?.id);
      }, 0);
      soFullyDispatched = totalSoOrderedPreview > 0 && totalSoDispatchedPreview >= totalSoOrderedPreview;
    }

    setDB(d => {
      const challans = edit
        ? d.challans.map(x => x.id === edit.id ? payload : x)
        : [{ ...payload, id: uid() }, ...d.challans];
      const jobCards = jcFullyDispatched
        ? d.jobCards.map(j => j.id === currentJC.id ? { ...j, status: "Completed" as const } : j)
        : d.jobCards;
      const salesOrders = (soFullyDispatched && currentSO)
        ? d.salesOrders.map(o => o.id === currentSO.id ? { ...o, status: "Delivered" as const } : o)
        : d.salesOrders;
      return { ...d, challans, jobCards, salesOrders };
    });
    log(`${edit ? "Updated" : "Created"} DC ${form.number}${jcFullyDispatched ? ` · Job Card ${currentJC.number} fully dispatched` : ""}${soFullyDispatched && currentSO ? ` · Sales Order ${currentSO.number} auto-marked Delivered` : ""}`, "Delivery Challan");

    // After save, if SO still has balance across all items, offer to create a new JC.
    let soBalanceAfter = 0;
    if (currentSO) {
      const newDispatchedForItem = row.alreadyDispatched + row.currentQty;
      const totalSoOrdered = currentSO.items.reduce((s, i) => s + i.qty, 0);
      const totalSoDispatched = currentSO.items.reduce((s, i) => {
        if (i.name === row.name) return s + newDispatchedForItem;
        return s + sumDispatched(db.challans, currentSO.id, i.name, edit?.id);
      }, 0);
      soBalanceAfter = Math.max(0, totalSoOrdered - totalSoDispatched);
    }

    setOpen(false);

    if (currentSO && jcFullyDispatched && soBalanceAfter > 0) {
      setBalancePrompt({ so: currentSO, parentJc: currentJC, balance: soBalanceAfter });
    }
  };

  const createBalanceJobCard = () => {
    if (!balancePrompt) return;
    const { so, parentJc, balance } = balancePrompt;
    const newJc: JobCard = {
      id: uid(),
      number: nextNumber("JC", db.jobCards),
      date: todayISO(),
      salesOrderId: so.id,
      bomId: parentJc.bomId,
      qcFormatId: parentJc.qcFormatId,
      product: parentJc.product,
      qty: balance,
      serialStart: "",
      reservedItems: [],
      stageQuantities: STAGES.map(s => ({ stage: s, multiplier: 1, totalQty: balance })),
      stages: STAGES.map(s => ({ stage: s, status: "pending" as const })),
      status: "Open",
      createdAt: new Date().toISOString(),
    };
    setDB(d => ({ ...d, jobCards: [newJc, ...d.jobCards] }));
    log(`Auto-created Job Card ${newJc.number} for SO ${so.number} balance (${balance} nos)`, "Job Card");
    setBalancePrompt(null);
    alert(`Job Card ${newJc.number} created for the remaining ${balance} nos of "${parentJc.product}". Continue production in the Production module.`);
  };

  const remove = (c: DeliveryChallan) => {
    if (!confirm(`Delete ${c.number}?`)) return;
    setDB(d => ({ ...d, challans: d.challans.filter(x => x.id !== c.id) }));
    log(`Deleted DC ${c.number}`, "Delivery Challan");
  };

  const printDC = (c: DeliveryChallan) => {
    const so = db.salesOrders.find(s => s.id === c.salesOrderId);
    const jc = db.jobCards.find(j => j.id === c.jobCardId);
    const cust = db.parties.find(p => p.id === c.customerId);
    const dItems = c.items || [];
    const t = calcDocTotalsWithFreight(dItems.map(i => ({ qty: i.qty, rate: i.rate, gst: i.gst })), Number(c.freight) || 0);
    const rowsHtml = dItems.map((i, idx) => {
      const ordered = so?.items.find(x => x.name === i.name)?.qty ?? 0;
      const otherDispatched = sumDispatched(db.challans, c.salesOrderId, i.name, c.id);
      const balance = Math.max(0, ordered - otherDispatched - i.qty);
      return `<tr>
        <td>${idx + 1}</td>
        <td>${i.name}</td>
        <td class="right">${ordered}</td>
        <td class="right">${otherDispatched}</td>
        <td class="right"><b>${i.qty}</b></td>
        <td class="right">${balance}</td>
        <td class="right">${fmtINR(i.rate)}</td>
        <td class="right">${i.gst}%</td>
        <td class="right">${fmtINR(i.qty * i.rate)}</td>
      </tr>`;
    }).join("");
    const body = `
      <div class="box"><div class="section-title">Consignee</div><b>${cust?.name || ""}</b><br/>${cust?.address || ""}${cust?.city ? `, ${cust.city}` : ""}<br/>GST: ${cust?.gst || ""}<br/>Contact: ${cust?.mobile || ""}</div>
      <div class="box"><div class="section-title">Dispatch Details</div><b>Sales Order:</b> ${so?.number || "-"} &nbsp; | &nbsp; <b>Job Card:</b> ${jc?.number || "-"}<br/><b>Vehicle:</b> ${c.vehicle || "-"} | <b>Driver:</b> ${c.driver || "-"}<br/><b>Transport:</b> ${c.transport || "-"}<br/><b>Acknowledgement:</b> ${c.acknowledged ? "Received" : "Pending"}</div>
      <table>
        <thead><tr>
          <th>#</th><th>Item</th>
          <th class="right">Ordered</th>
          <th class="right">Prev Dispatched</th>
          <th class="right">This Dispatch</th>
          <th class="right">Balance</th>
          <th class="right">Rate</th>
          <th class="right">GST%</th>
          <th class="right">Amount</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <table style="margin-top:8px;max-width:340px;margin-left:auto">
        <tr><td>Sub Total</td><td class="right">${fmtINR(t.sub)}</td></tr>
        <tr><td>Freight</td><td class="right">${fmtINR(t.freight)}</td></tr>
        <tr><td>GST</td><td class="right">${fmtINR(t.gst)}</td></tr>
        <tr><td><b>Total</b></td><td class="right"><b>${fmtINR(t.total)}</b></td></tr>
      </table>
      <div class="signs"><div class="sign-box">Receiver Signature</div><div class="sign-box">Dispatch</div><div class="sign-box">Authorized Signatory</div></div>
    `;
    const html = professionalDocument(db.settings, { title: "Delivery Challan", number: c.number, date: c.date, body, accent: "#0f766e" });
    printArea(html, c.number);
  };

  // Live JC-cap indicators for the form banner
  const jcCompletedNow = currentJC ? jobCardCompletedQty(currentJC, db.productionEntries) : 0;
  const jcAlreadyDispatchedNow = currentJC ? sumDispatchedFromJC(db.challans, currentJC.id, edit?.id) : 0;
  const jcAvailable = Math.max(0, jcCompletedNow - jcAlreadyDispatchedNow);

  // SO-level totals (across ALL items and ALL JCs) — used in the summary tiles.
  const soTotalQty = currentSO ? currentSO.items.reduce((s, i) => s + (Number(i.qty) || 0), 0) : 0;
  const soTotalDispatched = currentSO
    ? currentSO.items.reduce((s, i) => s + sumDispatched(db.challans, currentSO.id, i.name, edit?.id), 0)
    : 0;
  const soTotalBalance = Math.max(0, soTotalQty - soTotalDispatched);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">Delivery Challan</h1><p className="text-sm text-slate-500">Dispatch tracking with partial dispatch, JC-gated qty and balance</p></div>
        {canCreate && <Button onClick={openNew} data-testid="new-challan-btn"><IconPlus size={14}/> New Challan</Button>}
      </div>
      <Card>
        <Table>
          <thead><tr><Th>#</Th><Th>Date</Th><Th>SO</Th><Th>Job Card</Th><Th>Customer</Th><Th>Items</Th><Th>Total</Th><Th>Vehicle</Th><Th>Ack</Th><Th></Th></tr></thead>
          <tbody>
            {db.challans.map(c => {
              const totalsC = calcDocTotalsWithFreight((c.items || []).map(i => ({ qty: i.qty, rate: i.rate, gst: i.gst })), Number(c.freight) || 0);
              const totalUnits = (c.items || []).reduce((s, i) => s + i.qty, 0);
              return (
                <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-mono text-xs">
                    <button
                      type="button"
                      className="text-indigo-600 hover:underline"
                      onClick={() => setViewDC(c)}
                      title="View full Delivery Challan details"
                      data-testid={`dc-view-${c.number}`}
                    >{c.number}</button>
                  </Td>
                  <Td>{c.date}</Td>
                  <Td>{db.salesOrders.find(s => s.id === c.salesOrderId)?.number || "—"}</Td>
                  <Td>{db.jobCards.find(j => j.id === c.jobCardId)?.number || "—"}</Td>
                  <Td>{db.parties.find(p => p.id === c.customerId)?.name}</Td>
                  <Td className="text-xs">{(c.items || []).length ? `${(c.items || []).length} line · Qty ${totalUnits}` : "—"}</Td>
                  <Td className="font-semibold">{fmtINR(totalsC.total)}</Td>
                  <Td>{c.vehicle}</Td>
                  <Td><Badge color={c.acknowledged ? "green" : "yellow"}>{c.acknowledged ? "Yes" : "Pending"}</Badge></Td>
                  <Td><div className="flex gap-1">
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(c)}><IconEdit size={14}/></Button>}
                    {canPrint && <Button size="sm" variant="ghost" onClick={() => printDC(c)}><IconPrint size={14}/></Button>}
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => remove(c)}><IconTrash size={14}/></Button>}
                  </div></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {db.challans.length === 0 && <Empty/>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit ${edit.number}` : "New Delivery Challan"} size="xl">
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label>Challan No.</Label><Input value={form.number} disabled/></div>
          <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e: any) => setForm({...form, date: e.target.value})}/></div>
          <div>
            <Label>Job Card *</Label>
            <Select value={form.jobCardId || ""} onChange={(e: any) => applyJobCard(e.target.value)} data-testid="dc-jobcard-select">
              <option value="">— Select Job Card —</option>
              {dispatchableJobCards.map(j => {
                const so = db.salesOrders.find(s => s.id === j.salesOrderId);
                const completed = jobCardCompletedQty(j, db.productionEntries);
                const disp = sumDispatchedFromJC(db.challans, j.id, edit?.id);
                const avail = Math.max(0, completed - disp);
                return <option key={j.id} value={j.id}>{j.number} · {j.product} · Ready {completed}/{j.qty} · Available {avail}{so ? ` · ${so.number}` : ""}</option>;
              })}
            </Select>
          </div>
          <div>
            <Label>Sales Order (auto)</Label>
            <Input value={currentSO?.number || ""} disabled placeholder={currentJC ? "Not linked (JC has no SO)" : "Auto-set from Job Card"} data-testid="dc-so-display" />
          </div>
          <div className="sm:col-span-2">
            <Label>Customer{currentSO ? " (auto)" : " *"}</Label>
            <Select
              value={form.customerId}
              onChange={(e: any) => setForm({...form, customerId: e.target.value})}
              disabled={!!currentSO}
              data-testid="dc-customer-select"
            >
              <option value="">— Select Customer —</option>
              {db.parties.filter(p => p.type === "customer").map(p => <option key={p.id} value={p.id}>{p.name}{p.city ? ` · ${p.city}` : ""}</option>)}
            </Select>
          </div>
        </div>

        {!currentJC && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3 text-sm text-amber-800 dark:text-amber-200" data-testid="dc-no-jc-warning">
            <b>Job Card is required.</b> Dispatch is only allowed against a Job Card and up to its completed quantity. If no Job Card exists for this Sales Order, please create one in <b>Production</b> first.
            {dispatchableJobCards.length === 0 && <div className="mt-1 text-xs">Also: no Job Cards currently have completed (Dispatch Ready) quantity available for dispatch.</div>}
          </div>
        )}

        {currentJC && (
          <div className="mt-4 grid gap-3 md:grid-cols-5 sm:grid-cols-2" data-testid="dc-dispatch-summary">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Sales Order Qty</div>
              <div className="text-xl font-bold" data-testid="dc-sum-so-qty">{currentSO ? soTotalQty : (row?.ordered ?? 0)}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{currentSO ? `${currentSO.number} · ${currentSO.items.length} item${currentSO.items.length > 1 ? "s" : ""}` : "No SO linked"}</div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Already Dispatched</div>
              <div className="text-xl font-bold" data-testid="dc-sum-already-dispatched">{currentSO ? soTotalDispatched : (row?.alreadyDispatched ?? 0)}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{currentSO ? "All items, all JCs combined" : "This item, all JCs"}</div>
            </div>
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 p-3 bg-emerald-50 dark:bg-emerald-900/20">
              <div className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Sales Order Balance</div>
              <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300" data-testid="dc-sum-so-balance">{currentSO ? soTotalBalance : Math.max(0, (row?.ordered ?? 0) - (row?.alreadyDispatched ?? 0))}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">SO Qty − Already Dispatched</div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Selected Job Card Qty</div>
              <div className="text-xl font-bold" data-testid="dc-sum-jc-qty">{currentJC.qty}</div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono">{currentJC.number}</div>
            </div>
            <div className="rounded-lg border border-teal-300 dark:border-teal-700 p-3 bg-teal-50 dark:bg-teal-900/20">
              <div className="text-[11px] uppercase tracking-wide text-teal-700 dark:text-teal-300">Available on this JC</div>
              <div className="text-xl font-bold text-teal-700 dark:text-teal-300" data-testid="dc-sum-jc-available">{jcAvailable}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Ready {jcCompletedNow} − Dispatched {jcAlreadyDispatchedNow}</div>
            </div>
          </div>
        )}

        {row && (
          <div className="mt-4 border border-slate-200 dark:border-slate-700 rounded-lg overflow-x-auto" data-testid="dc-partial-panel">
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-xs">
              <div className="font-semibold text-slate-700 dark:text-slate-200">Partial Dispatch — enter any quantity up to the Available JC qty</div>
              {(() => {
                const jcRemaining = Math.max(0, row.jcCompleted - row.jcAlreadyDispatched);
                const soBalance = currentSO ? Math.max(0, row.ordered - row.alreadyDispatched) : Infinity;
                const cap = Math.min(soBalance, jcRemaining);
                return (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => updateRow({ currentQty: Math.floor(cap / 2) })} data-testid="dc-fill-half">Half ({Math.floor(cap / 2)})</Button>
                    <Button size="sm" variant="outline" onClick={() => updateRow({ currentQty: cap })} data-testid="dc-fill-full">Full ({cap})</Button>
                  </div>
                );
              })()}
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th className="text-right">SO Qty</Th>
                  <Th className="text-right">Already Dispatched</Th>
                  <Th className="text-right">SO Balance</Th>
                  <Th className="text-right">JC Available</Th>
                  <Th className="text-right">This Dispatch</Th>
                  <Th className="text-right">Balance After</Th>
                  <Th className="text-right">Rate</Th>
                  <Th className="text-right">GST%</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const soBalance = currentSO ? Math.max(0, row.ordered - row.alreadyDispatched) : row.jcCompleted;
                  const jcRemaining = Math.max(0, row.jcCompleted - row.jcAlreadyDispatched);
                  const cap = Math.min(soBalance, jcRemaining);
                  const over = row.currentQty > cap;
                  const soBalanceAfter = Math.max(0, soBalance - row.currentQty);
                  const jcBalanceAfter = Math.max(0, jcRemaining - row.currentQty);
                  return (
                    <tr className={over ? "bg-rose-50 dark:bg-rose-900/20" : ""}>
                      <Td className="font-medium">{row.name}</Td>
                      <Td className="text-right">{row.ordered}</Td>
                      <Td className="text-right">{row.alreadyDispatched}</Td>
                      <Td className="text-right font-medium">{soBalance === Infinity ? "—" : soBalance}</Td>
                      <Td className="text-right font-medium text-teal-700">{jcRemaining}</Td>
                      <Td className="text-right">
                        <Input
                          type="number"
                          value={row.currentQty}
                          min={0}
                          max={cap}
                          onChange={(e: any) => {
                            const v = Number(e.target.value) || 0;
                            updateRow({ currentQty: Math.max(0, v) });
                          }}
                          className={"w-24 text-right py-1 h-8 " + (over ? "border-rose-500" : "")}
                          data-testid="dc-current-qty"
                        />
                      </Td>
                      <Td className={"text-right font-semibold " + (over ? "text-rose-600" : "text-emerald-600")} data-testid="dc-balance-after">
                        <div>SO: {currentSO ? soBalanceAfter : "—"}</div>
                        <div className="text-teal-700 text-[11px]">JC: {jcBalanceAfter}{jcBalanceAfter === 0 && row.currentQty > 0 ? " · will Complete" : ""}</div>
                      </Td>
                      <Td className="text-right">
                        <Input type="number" value={row.rate} onChange={(e: any) => updateRow({ rate: Number(e.target.value) || 0 })} className="w-24 text-right py-1 h-8"/>
                      </Td>
                      <Td className="text-right">
                        <Input type="number" value={row.gst} onChange={(e: any) => updateRow({ gst: Number(e.target.value) || 0 })} className="w-16 text-right py-1 h-8"/>
                      </Td>
                      <Td className="text-right font-medium">{fmtINR(row.currentQty * row.rate)}</Td>
                    </tr>
                  );
                })()}
              </tbody>
            </Table>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div className="space-y-3">
            <div><Label>Vehicle Number</Label><Input value={form.vehicle || ""} onChange={(e: any) => setForm({...form, vehicle: e.target.value})}/></div>
            <div><Label>Driver Name</Label><Input value={form.driver || ""} onChange={(e: any) => setForm({...form, driver: e.target.value})}/></div>
            <div><Label>Transport / LR</Label><Input value={form.transport || ""} onChange={(e: any) => setForm({...form, transport: e.target.value})}/></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.acknowledged} onChange={e => setForm({...form, acknowledged: e.target.checked})}/> Customer acknowledgement received</label>
          </div>

          <div className="rounded-lg border p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700 text-sm space-y-1 max-w-sm ml-auto self-start">
            <div className="flex justify-between"><span>Sub Total</span><b>{fmtINR(totals.sub)}</b></div>
            <div className="flex justify-between items-center gap-2">
              <span>Freight</span>
              <Input
                type="number"
                value={form.freight ?? 0}
                onChange={(e: any) => setForm({...form, freight: Number(e.target.value) || 0})}
                className="w-32 text-right py-1 h-8"
                data-testid="dc-freight-input"
              />
            </div>
            <div className="flex justify-between"><span>GST</span><b>{fmtINR(totals.gst)}</b></div>
            <div className="flex justify-between text-base border-t pt-1 mt-1"><span>Total</span><b className="text-emerald-600">{fmtINR(grandTotal)}</b></div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={!currentJC} data-testid="dc-save-btn">{edit ? "Update" : "Create"}</Button>
        </div>
      </Modal>

      <Modal open={!!viewDC} onClose={() => setViewDC(null)} title={viewDC ? `Delivery Challan · ${viewDC.number}` : "Delivery Challan"} size="xl">
        {viewDC && (() => {
          const c = viewDC;
          const so = db.salesOrders.find(s => s.id === c.salesOrderId);
          const jc = db.jobCards.find(j => j.id === c.jobCardId);
          const cust = db.parties.find(p => p.id === c.customerId);
          const t = calcDocTotalsWithFreight((c.items || []).map(i => ({ qty: i.qty, rate: i.rate, gst: i.gst })), Number(c.freight) || 0);
          const totalUnits = (c.items || []).reduce((s, i) => s + i.qty, 0);
          return (
            <div className="space-y-4 text-sm">
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Challan</div>
                  <div><span className="text-slate-500">No.:</span> <b className="font-mono">{c.number}</b></div>
                  <div><span className="text-slate-500">Date:</span> <b>{c.date}</b></div>
                  <div><span className="text-slate-500">Ack:</span> <Badge color={c.acknowledged ? "green" : "yellow"}>{c.acknowledged ? "Received" : "Pending"}</Badge></div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40 sm:col-span-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Consignee</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-100">{cust?.name || "—"}</div>
                  {cust?.address && <div className="text-xs text-slate-500">{cust.address}{cust?.city ? `, ${cust.city}` : ""}</div>}
                  <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {cust?.gst && <span>GST: <b>{cust.gst}</b></span>}
                    {cust?.mobile && <span>Mobile: <b>{cust.mobile}</b></span>}
                    {cust?.contactPerson && <span>Contact: <b>{cust.contactPerson}</b></span>}
                  </div>
                </div>
              </div>

              <div className="grid sm:grid-cols-4 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                  <div className="text-[11px] text-slate-500">Sales Order</div>
                  <div className="text-base font-semibold font-mono">{so?.number || "—"}</div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                  <div className="text-[11px] text-slate-500">Job Card</div>
                  <div className="text-base font-semibold font-mono">{jc?.number || "—"}</div>
                  {jc && <div className="text-[10px] text-slate-500 mt-0.5">{jc.product}</div>}
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                  <div className="text-[11px] text-slate-500">Dispatched Qty</div>
                  <div className="text-base font-semibold">{totalUnits}</div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                  <div className="text-[11px] text-slate-500">Grand Total</div>
                  <div className="text-base font-semibold text-emerald-600">{fmtINR(t.total)}</div>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold mb-2">Items Dispatched</div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <Table>
                    <thead>
                      <tr>
                        <Th>#</Th>
                        <Th>Item</Th>
                        <Th className="text-right">SO Qty</Th>
                        <Th className="text-right">Prev Dispatched</Th>
                        <Th className="text-right">This Dispatch</Th>
                        <Th className="text-right">SO Balance After</Th>
                        <Th className="text-right">Rate</Th>
                        <Th className="text-right">GST%</Th>
                        <Th className="text-right">Amount</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {(c.items || []).map((i, idx) => {
                        const ordered = so?.items.find(x => x.name === i.name)?.qty ?? 0;
                        const otherDispatched = sumDispatched(db.challans, c.salesOrderId, i.name, c.id);
                        const balanceAfter = Math.max(0, ordered - otherDispatched - i.qty);
                        return (
                          <tr key={idx}>
                            <Td>{idx + 1}</Td>
                            <Td className="font-medium">{i.name}</Td>
                            <Td className="text-right">{ordered || "—"}</Td>
                            <Td className="text-right">{otherDispatched}</Td>
                            <Td className="text-right font-medium">{i.qty}</Td>
                            <Td className="text-right">{ordered ? balanceAfter : "—"}</Td>
                            <Td className="text-right">{fmtINR(i.rate)}</Td>
                            <Td className="text-right">{i.gst}%</Td>
                            <Td className="text-right font-medium">{fmtINR(i.qty * i.rate)}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Dispatch Details</div>
                  <div className="space-y-1 text-xs">
                    <div><span className="text-slate-500">Vehicle:</span> <b>{c.vehicle || "—"}</b></div>
                    <div><span className="text-slate-500">Driver:</span> <b>{c.driver || "—"}</b></div>
                    <div><span className="text-slate-500">Transport / LR:</span> <b>{c.transport || "—"}</b></div>
                    <div><span className="text-slate-500">Acknowledgement:</span> <b>{c.acknowledged ? "Received" : "Pending"}</b></div>
                  </div>
                </div>
                <div className="rounded-lg border p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700 space-y-1">
                  <div className="flex justify-between"><span>Sub Total</span><b>{fmtINR(t.sub)}</b></div>
                  <div className="flex justify-between"><span>Freight</span><b>{fmtINR(t.freight)}</b></div>
                  <div className="flex justify-between"><span>GST</span><b>{fmtINR(t.gst)}</b></div>
                  <div className="flex justify-between text-base border-t pt-1 mt-1"><span>Total</span><b className="text-emerald-600">{fmtINR(t.total)}</b></div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                <Button variant="outline" onClick={() => setViewDC(null)}>Close</Button>
                {canPrint && <Button variant="outline" onClick={() => printDC(c)} data-testid="dc-view-print"><IconPrint size={14}/> Print</Button>}
                {canEdit && <Button onClick={() => { setViewDC(null); openEdit(c); }} data-testid="dc-view-edit"><IconEdit size={14}/> Edit</Button>}
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={!!balancePrompt} onClose={() => setBalancePrompt(null)} title="Sales Order still has balance" size="md">
        {balancePrompt && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700 p-3">
              <b>Job Card {balancePrompt.parentJc.number} is now fully dispatched and marked Completed.</b>
              <div className="mt-1">Sales Order <span className="font-mono">{balancePrompt.so.number}</span> still has <b>{balancePrompt.balance}</b> nos of <b>{balancePrompt.parentJc.product}</b> pending.</div>
            </div>
            <p className="text-slate-600 dark:text-slate-300">Do you want to create a new Job Card for the remaining quantity so production can continue?</p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
              <Button variant="outline" onClick={() => setBalancePrompt(null)} data-testid="dc-balance-later">Later</Button>
              <Button onClick={createBalanceJobCard} data-testid="dc-balance-create-jc"><IconPlus size={14}/> Create Job Card for {balancePrompt.balance} nos</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
