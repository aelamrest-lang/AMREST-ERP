import { useMemo, useState, useEffect } from "react";
import { useStore } from "../lib/store";
import { Card, Button, Input, Select, Label, Table, Th, Td, Badge, Empty } from "../components/ui";
import { fmtINR, todayISO } from "../lib/utils";

// Standard transformer manufacturing stages (independent of Job Card stage config)
const MFG_STAGES = [
  "LV Winding",
  "HV Winding",
  "Primary Winding",
  "Secondary Winding",
  "Core Coil Assembly",
  "Tanking",
  "Finishing",
  "QC / Testing",
] as const;
type MfgStage = (typeof MFG_STAGES)[number];

// Stages that CAN run in parallel with each other (all winding operations).
// Everything else runs sequentially after the parallel windings + core coil assembly.
const PARALLEL_STAGES: MfgStage[] = ["LV Winding", "HV Winding", "Primary Winding", "Secondary Winding"];

const DEFAULT_STAGE_DAYS: Record<MfgStage, number> = {
  "LV Winding": 5,
  "HV Winding": 4,
  "Primary Winding": 4,
  "Secondary Winding": 4,
  "Core Coil Assembly": 3,
  "Tanking": 2,
  "Finishing": 2,
  "QC / Testing": 1,
};

// Working day = any weekday (Mon-Sat). Sundays are skipped.
function isSunday(d: Date) { return d.getDay() === 0; }
function addWorkingDays(startISO: string, days: number): string {
  if (!startISO) return "";
  const d = new Date(startISO + "T00:00:00");
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (!isSunday(d)) added += 1;
  }
  return d.toISOString().slice(0, 10);
}

export function ManufacturingTime() {
  const { db, setDB, log } = useStore();

  // --------------- Step 1: Finished Goods selection ---------------
  const finishedGoods = useMemo(() => db.items.filter(i => i.category === "Finished Goods"), [db.items]);
  const [fgId, setFgId] = useState<string>("");
  const [bomId, setBomId] = useState<string>("");
  const [qty, setQty] = useState<number>(1);
  const [startDate, setStartDate] = useState<string>(todayISO());
  const [runInParallel, setRunInParallel] = useState<boolean>(true);

  const currentFG = db.items.find(i => i.id === fgId);
  const currentBOM = db.boms.find(b => b.id === bomId);

  // Auto-pick BOM matching FG name when FG changes
  useEffect(() => {
    if (!fgId) { setBomId(""); return; }
    const fg = db.items.find(i => i.id === fgId);
    if (!fg) return;
    const match = db.boms.find(b => (b.productItemId === fg.id) || (b.name || "").toLowerCase() === (fg.name || "").toLowerCase());
    setBomId(match?.id || "");
  }, [fgId, db.items, db.boms]);

  // --------------- Step 2: Raw Material Lead Times ---------------
  interface RmRow {
    itemId?: string;
    name: string;
    requiredQty: number;
    availableStock: number;
    shortage: number;
    leadTimeDays: number;
  }
  const [rmRows, setRmRows] = useState<RmRow[]>([]);

  // Rebuild RM rows whenever BOM or qty changes
  useEffect(() => {
    if (!currentBOM) { setRmRows([]); return; }
    const savedLeads = db.settings.itemLeadTimeDays || {};
    const rows: RmRow[] = currentBOM.materials.map(m => {
      const item = m.itemId ? db.items.find(i => i.id === m.itemId) : undefined;
      const requiredQty = (Number(m.qty) || 0) * (Number(qty) || 0);
      const availableStock = Number(item?.currentStock) || 0;
      const shortage = Math.max(0, requiredQty - availableStock);
      const savedLead = m.itemId ? savedLeads[m.itemId] : undefined;
      // If already in stock, purchase lead time is 0
      const leadTimeDays = shortage <= 0 ? 0 : (typeof savedLead === "number" ? savedLead : 7);
      return { itemId: m.itemId, name: m.name, requiredQty, availableStock, shortage, leadTimeDays };
    });
    setRmRows(rows);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBOM?.id, qty, db.items, db.settings.itemLeadTimeDays]);

  const updateRmLead = (idx: number, val: number) => {
    setRmRows(prev => prev.map((r, i) => i === idx ? { ...r, leadTimeDays: Math.max(0, Number(val) || 0) } : r));
  };

  const persistLeadTime = (row: RmRow) => {
    if (!row.itemId) return;
    setDB(d => ({
      ...d,
      settings: {
        ...d.settings,
        itemLeadTimeDays: { ...(d.settings.itemLeadTimeDays || {}), [row.itemId!]: row.leadTimeDays },
      },
    }));
  };

  // Raw Material Procurement Days = the longest lead time across all shortage materials
  // (parallel purchasing assumed; the slowest supplier is the bottleneck).
  const rawMaterialDays = useMemo(() => {
    const leads = rmRows.filter(r => r.shortage > 0).map(r => r.leadTimeDays || 0);
    return leads.length ? Math.max(...leads) : 0;
  }, [rmRows]);

  // --------------- Step 3: Production Stage Days ---------------
  const [stageDays, setStageDays] = useState<Record<MfgStage, number>>({ ...DEFAULT_STAGE_DAYS });

  // Load persisted stage days from settings on mount
  useEffect(() => {
    const persisted = (db.settings.stageDays || {}) as Record<string, number>;
    setStageDays(prev => {
      const next: Record<MfgStage, number> = { ...prev };
      MFG_STAGES.forEach(s => {
        if (typeof persisted[s] === "number") next[s] = persisted[s];
      });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveStageDaysMaster = () => {
    setDB(d => ({ ...d, settings: { ...d.settings, stageDays: { ...(d.settings.stageDays || {}), ...stageDays } } }));
    log("Saved default Production Stage Days master", "Manufacturing Time");
  };

  // Sequential total = simple sum
  const seqDays = MFG_STAGES.reduce((s, k) => s + (Number(stageDays[k]) || 0), 0);

  // Parallel: winding stages run concurrently → max(winding). Then sequential rest.
  const parallelDays = (() => {
    const parallelMax = Math.max(0, ...PARALLEL_STAGES.map(s => Number(stageDays[s]) || 0));
    const sequentialRest = MFG_STAGES
      .filter(s => !PARALLEL_STAGES.includes(s))
      .reduce((sum, s) => sum + (Number(stageDays[s]) || 0), 0);
    return parallelMax + sequentialRest;
  })();

  const productionDays = runInParallel ? parallelDays : seqDays;
  const totalDays = rawMaterialDays + productionDays;

  const targetStartWithRM = startDate ? addWorkingDays(startDate, 0) : "";
  const productionStartDate = startDate ? addWorkingDays(startDate, rawMaterialDays) : "";
  const completionDate = startDate ? addWorkingDays(startDate, totalDays) : "";

  const canCalculate = !!fgId && !!currentBOM && qty > 0 && !!startDate;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Estimated Manufacturing Time</h1>
          <p className="text-sm text-slate-500">Plan delivery dates from raw-material procurement + parallel/sequential production stages</p>
        </div>
      </div>

      {/* Step 1 */}
      <Card>
        <div className="p-4">
          <h3 className="font-semibold mb-3">Step 1 · Select Finished Product</h3>
          <div className="grid sm:grid-cols-4 gap-3">
            <div>
              <Label>Finished Product</Label>
              <Select value={fgId} onChange={(e: any) => setFgId(e.target.value)} data-testid="mfg-fg">
                <option value="">— Select finished good —</option>
                {finishedGoods.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>BOM</Label>
              <Select value={bomId} onChange={(e: any) => setBomId(e.target.value)} data-testid="mfg-bom">
                <option value="">— Select BOM —</option>
                {db.boms.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Quantity</Label>
              <Input type="number" value={qty} min={1} onChange={(e: any) => setQty(Math.max(1, Number(e.target.value) || 1))} data-testid="mfg-qty" />
            </div>
            <div>
              <Label>Required Start Date / Target Start</Label>
              <Input type="date" value={startDate} onChange={(e: any) => setStartDate(e.target.value)} data-testid="mfg-start" />
            </div>
          </div>
          {currentFG && !currentBOM && (
            <div className="mt-2 text-xs text-amber-700">No BOM auto-matched for this product — pick one from the list to load raw materials.</div>
          )}
        </div>
      </Card>

      {/* Step 2 */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold">Step 2 · Raw Material Purchase Lead Time</h3>
            <Badge color="slate">Procurement Days = max lead time across shortages</Badge>
          </div>
          <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Material</Th>
                  <Th className="text-right">Required Qty</Th>
                  <Th className="text-right">Available Stock</Th>
                  <Th className="text-right">Shortage</Th>
                  <Th className="text-right">Lead Time (Days)</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {rmRows.length === 0 && <tr><Td colSpan={6}><Empty title={currentBOM ? "This BOM has no materials" : "Select a BOM to load materials"} /></Td></tr>}
                {rmRows.map((r, i) => (
                  <tr key={r.itemId || r.name + i} className={r.shortage > 0 ? "" : "bg-emerald-50/40 dark:bg-emerald-900/10"}>
                    <Td className="font-medium">{r.name}</Td>
                    <Td className="text-right">{r.requiredQty}</Td>
                    <Td className="text-right">{r.availableStock}</Td>
                    <Td className={"text-right font-semibold " + (r.shortage > 0 ? "text-rose-600" : "text-emerald-600")}>
                      {r.shortage > 0 ? r.shortage : "In stock"}
                    </Td>
                    <Td className="text-right">
                      {r.shortage > 0 ? (
                        <Input
                          type="number"
                          value={r.leadTimeDays}
                          min={0}
                          onChange={(e: any) => updateRmLead(i, Number(e.target.value))}
                          className="w-24 text-right py-1 h-8 ml-auto"
                          data-testid={`mfg-rm-lead-${i}`}
                        />
                      ) : <span className="text-slate-400">0</span>}
                    </Td>
                    <Td>
                      {r.shortage > 0 && r.itemId && (
                        <button type="button" onClick={() => persistLeadTime(r)} className="text-[11px] text-indigo-600 hover:underline" title="Save this lead time as default for this item">Save default</button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <div className="mt-2 text-xs text-slate-500">Materials already in stock have 0-day purchase lead time. Only shortage lines drive the procurement window.</div>
        </div>
      </Card>

      {/* Step 3 */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-semibold">Step 3 · Production Stage Days (working days)</h3>
              <p className="text-xs text-slate-500">Winding stages (LV/HV/Primary/Secondary) can run in parallel. Everything else runs sequentially.</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={runInParallel} onChange={e => setRunInParallel(e.target.checked)} data-testid="mfg-parallel" className="h-4 w-4 accent-indigo-600" />
                Run windings in parallel
              </label>
              <Button size="sm" variant="outline" onClick={saveStageDaysMaster} data-testid="mfg-save-stage-days">Save as Default</Button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
            {MFG_STAGES.map(s => (
              <div key={s} className={"rounded-lg border p-3 " + (PARALLEL_STAGES.includes(s) ? "border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-900/20" : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40")}>
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{s}{PARALLEL_STAGES.includes(s) && <span className="ml-1 text-[9px] text-indigo-600">PARALLEL</span>}</div>
                <Input
                  type="number"
                  min={0}
                  value={stageDays[s]}
                  onChange={(e: any) => setStageDays(prev => ({ ...prev, [s]: Math.max(0, Number(e.target.value) || 0) }))}
                  className="mt-1 h-8 py-1"
                  data-testid={`mfg-stage-day-${s}`}
                />
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Summary */}
      <Card>
        <div className="p-4">
          <h3 className="font-semibold mb-3">Summary</h3>
          {!canCalculate && <div className="text-sm text-slate-500">Complete Step 1 to view the estimate.</div>}
          {canCalculate && (
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50 to-white dark:from-amber-900/30 dark:to-slate-900 p-4">
                <div className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-300 font-semibold">Raw Material Procurement</div>
                <div className="text-3xl font-bold text-amber-800 dark:text-amber-200 mt-1" data-testid="mfg-summary-rm-days">{rawMaterialDays} <span className="text-sm font-normal">Days</span></div>
                <div className="text-[11px] text-slate-500 mt-1">Longest supplier lead time across shortages</div>
              </div>
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/30 dark:to-slate-900 p-4">
                <div className="text-[11px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300 font-semibold">Production Time</div>
                <div className="text-3xl font-bold text-indigo-800 dark:text-indigo-200 mt-1" data-testid="mfg-summary-prod-days">{productionDays} <span className="text-sm font-normal">Days</span></div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {runInParallel ? <>Parallel windings max ({Math.max(0, ...PARALLEL_STAGES.map(s => stageDays[s] || 0))}d) + sequential rest</> : <>Sequential: {seqDays}d</>}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-900/30 dark:to-slate-900 p-4">
                <div className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300 font-semibold">Total Estimated Manufacturing</div>
                <div className="text-3xl font-bold text-emerald-800 dark:text-emerald-200 mt-1" data-testid="mfg-summary-total-days">{totalDays} <span className="text-sm font-normal">Working Days</span></div>
                <div className="text-[11px] text-slate-500 mt-1">Excludes Sundays</div>
              </div>

              <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-[11px] text-slate-500 uppercase">Start Date (Procurement)</div>
                  <div className="text-base font-semibold">{targetStartWithRM || "—"}</div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-[11px] text-slate-500 uppercase">Production Start</div>
                  <div className="text-base font-semibold">{productionStartDate || "—"}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">After procurement window</div>
                </div>
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3">
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-300 uppercase">Estimated Completion</div>
                  <div className="text-base font-bold text-emerald-700 dark:text-emerald-300" data-testid="mfg-summary-completion">{completionDate || "—"}</div>
                </div>
              </div>

              <div className="lg:col-span-3 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <Table>
                  <thead><tr><Th>Details</Th><Th className="text-right">Estimated Days</Th></tr></thead>
                  <tbody>
                    <tr><Td>Raw Material Procurement</Td><Td className="text-right font-semibold">{rawMaterialDays} Days</Td></tr>
                    <tr><Td>Production Time ({runInParallel ? "parallel" : "sequential"})</Td><Td className="text-right font-semibold">{productionDays} Days</Td></tr>
                    <tr className="bg-emerald-50/60 dark:bg-emerald-900/20">
                      <Td className="font-semibold">Total Estimated Manufacturing Time</Td>
                      <Td className="text-right font-bold text-emerald-700 dark:text-emerald-300">{totalDays} Days</Td>
                    </tr>
                  </tbody>
                </Table>
              </div>

              <div className="lg:col-span-3 text-[11px] text-slate-500">
                {currentFG && <>Estimating for <b>{currentFG.name}</b> × <b>{qty}</b> Nos · BOM: {currentBOM?.name || "—"} · Value at sale rate ≈ <b>{fmtINR((Number(currentFG.saleRate) || 0) * qty)}</b></>}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
