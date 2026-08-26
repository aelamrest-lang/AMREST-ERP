import { useMemo, useState, useEffect } from "react";
import { useStore } from "../lib/store";
import { Card, Button, Input, Select, Label, Table, Th, Td, Badge } from "../components/ui";
import { fmtINR, todayISO } from "../lib/utils";

// Standard transformer manufacturing stages
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

// Winding stages can run in parallel; the rest sequential
const PARALLEL_STAGES: MfgStage[] = ["LV Winding", "HV Winding", "Primary Winding", "Secondary Winding"];

// Default daily production capacity per stage (Nos/day)
const DEFAULT_CAPACITY: Record<MfgStage, number> = {
  "LV Winding": 60,
  "HV Winding": 20,
  "Primary Winding": 20,
  "Secondary Winding": 20,
  "Core Coil Assembly": 20,
  "Tanking": 30,
  "Finishing": 40,
  "QC / Testing": 60,
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

  // Step 1: Finished Goods
  const finishedGoods = useMemo(() => db.items.filter(i => i.category === "Finished Goods"), [db.items]);
  const [fgId, setFgId] = useState<string>("");
  const [bomId, setBomId] = useState<string>("");
  const [qty, setQty] = useState<number>(120);
  const [startDate, setStartDate] = useState<string>(todayISO());
  const [runInParallel, setRunInParallel] = useState<boolean>(true);

  const currentFG = db.items.find(i => i.id === fgId);
  const currentBOM = db.boms.find(b => b.id === bomId);

  useEffect(() => {
    if (!fgId) { setBomId(""); return; }
    const fg = db.items.find(i => i.id === fgId);
    if (!fg) return;
    const match = db.boms.find(b => (b.productItemId === fg.id) || (b.name || "").toLowerCase() === (fg.name || "").toLowerCase());
    setBomId(match?.id || "");
  }, [fgId, db.items, db.boms]);

  // Raw Material Procurement Days (editable, default 10)
  const persistedRmDays = (db.settings as any).rawMaterialProcurementDays;
  const [rmDays, setRmDays] = useState<number>(typeof persistedRmDays === "number" ? persistedRmDays : 10);

  // Stage Capacities (Nos/day) — persisted via settings.stageCapacity
  const [stageCapacity, setStageCapacity] = useState<Record<MfgStage, number>>({ ...DEFAULT_CAPACITY });
  useEffect(() => {
    const persisted = ((db.settings as any).stageCapacity || {}) as Record<string, number>;
    setStageCapacity(prev => {
      const next: Record<MfgStage, number> = { ...prev };
      MFG_STAGES.forEach(s => { if (typeof persisted[s] === "number" && persisted[s] > 0) next[s] = persisted[s]; });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveDefaults = () => {
    setDB(d => ({
      ...d,
      settings: {
        ...d.settings,
        stageCapacity: { ...((d.settings as any).stageCapacity || {}), ...stageCapacity },
        rawMaterialProcurementDays: rmDays,
      } as any,
    }));
    log("Saved default Stage Capacity + RM Procurement Days", "Manufacturing Time");
  };

  // Compute required days per stage = ceil(qty / capacity)
  const stageDaysNeeded = useMemo(() => {
    const map: Record<MfgStage, number> = { ...DEFAULT_CAPACITY };
    MFG_STAGES.forEach(s => {
      const cap = Number(stageCapacity[s]) || 0;
      map[s] = cap > 0 ? Math.ceil((Number(qty) || 0) / cap) : 0;
    });
    return map;
  }, [stageCapacity, qty]);

  const seqDays = MFG_STAGES.reduce((s, k) => s + (stageDaysNeeded[k] || 0), 0);
  const parallelDays = (() => {
    const parallelMax = Math.max(0, ...PARALLEL_STAGES.map(s => stageDaysNeeded[s] || 0));
    const rest = MFG_STAGES.filter(s => !PARALLEL_STAGES.includes(s)).reduce((sum, s) => sum + (stageDaysNeeded[s] || 0), 0);
    return parallelMax + rest;
  })();

  const productionDays = runInParallel ? parallelDays : seqDays;
  const totalDays = (Number(rmDays) || 0) + productionDays;

  const productionStartDate = startDate ? addWorkingDays(startDate, Number(rmDays) || 0) : "";
  const completionDate = startDate ? addWorkingDays(startDate, totalDays) : "";
  const canCalculate = !!fgId && qty > 0 && !!startDate;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Estimated Manufacturing Time</h1>
          <p className="text-sm text-slate-500">Capacity-based estimator · parallel/sequential production stages · working-day aware</p>
        </div>
        <Button variant="outline" onClick={saveDefaults} data-testid="mfg-save-defaults">Save as Default</Button>
      </div>

      {/* Step 1 */}
      <Card>
        <div className="p-4">
          <h3 className="font-semibold mb-3">Step 1 · Select Finished Product</h3>
          <div className="grid sm:grid-cols-5 gap-3">
            <div className="sm:col-span-2">
              <Label>Finished Product</Label>
              <Select value={fgId} onChange={(e: any) => setFgId(e.target.value)} data-testid="mfg-fg">
                <option value="">— Select finished good —</option>
                {finishedGoods.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>BOM (optional)</Label>
              <Select value={bomId} onChange={(e: any) => setBomId(e.target.value)} data-testid="mfg-bom">
                <option value="">— None —</option>
                {db.boms.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Quantity (Nos)</Label>
              <Input type="number" value={qty} min={1} onChange={(e: any) => setQty(Math.max(1, Number(e.target.value) || 1))} data-testid="mfg-qty" />
            </div>
            <div>
              <Label>Required Start Date</Label>
              <Input type="date" value={startDate} onChange={(e: any) => setStartDate(e.target.value)} data-testid="mfg-start" />
            </div>
          </div>
        </div>
      </Card>

      {/* Raw Material Procurement Days (single input, replaces Step 2 table) */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-semibold">Raw Material Procurement</h3>
              <p className="text-xs text-slate-500">Default 10–15 working days. Edit to match this order's supplier lead time.</p>
            </div>
            <div className="flex items-end gap-2">
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Procurement Days</Label>
                <Input type="number" min={0} value={rmDays} onChange={(e: any) => setRmDays(Math.max(0, Number(e.target.value) || 0))} className="w-32 h-8 py-1" data-testid="mfg-rm-days" />
              </div>
              <Badge color={rmDays >= 10 && rmDays <= 15 ? "green" : "amber"}>Recommended 10–15</Badge>
            </div>
          </div>
        </div>
      </Card>

      {/* Production Stage Capacity */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-semibold">Step 2 · Production Stage Capacity</h3>
              <p className="text-xs text-slate-500">Set daily output capacity (Nos/day) per stage. Days = <b>Job Qty ÷ Capacity/Day</b>. Windings can run in parallel.</p>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={runInParallel} onChange={e => setRunInParallel(e.target.checked)} data-testid="mfg-parallel" className="h-4 w-4 accent-indigo-600" />
              Run windings in parallel
            </label>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Stage</Th>
                  <Th className="text-right">Job Qty (Nos)</Th>
                  <Th className="text-right">Capacity / Day</Th>
                  <Th className="text-right">Required Days</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {MFG_STAGES.map(s => {
                  const cap = stageCapacity[s] || 0;
                  const days = stageDaysNeeded[s] || 0;
                  const isParallel = PARALLEL_STAGES.includes(s);
                  return (
                    <tr key={s} className={isParallel ? "bg-indigo-50/40 dark:bg-indigo-900/10" : ""}>
                      <Td className="font-medium">
                        {s}
                        {isParallel && <span className="ml-2 text-[9px] uppercase tracking-wide text-indigo-600 font-semibold">Parallel</span>}
                      </Td>
                      <Td className="text-right">{qty}</Td>
                      <Td className="text-right">
                        <Input
                          type="number"
                          min={0}
                          value={cap}
                          onChange={(e: any) => setStageCapacity(prev => ({ ...prev, [s]: Math.max(0, Number(e.target.value) || 0) }))}
                          className="w-24 text-right py-1 h-8 ml-auto"
                          data-testid={`mfg-cap-${s}`}
                        />
                      </Td>
                      <Td className="text-right font-semibold text-indigo-700">
                        {cap > 0 ? `${days} ${days === 1 ? "Day" : "Days"}` : <span className="text-rose-500">Set capacity</span>}
                      </Td>
                      <Td>
                        <span className="text-[11px] text-slate-500">{qty} ÷ {cap || 0} = {days}</span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
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
                <div className="text-3xl font-bold text-amber-800 dark:text-amber-200 mt-1" data-testid="mfg-summary-rm-days">{rmDays} <span className="text-sm font-normal">Days</span></div>
                <div className="text-[11px] text-slate-500 mt-1">Editable · applies before production starts</div>
              </div>
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/30 dark:to-slate-900 p-4">
                <div className="text-[11px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300 font-semibold">Production Time</div>
                <div className="text-3xl font-bold text-indigo-800 dark:text-indigo-200 mt-1" data-testid="mfg-summary-prod-days">{productionDays} <span className="text-sm font-normal">Days</span></div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {runInParallel
                    ? <>Parallel windings max ({Math.max(0, ...PARALLEL_STAGES.map(s => stageDaysNeeded[s] || 0))}d) + sequential rest</>
                    : <>Sequential total: {seqDays}d</>}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-900/30 dark:to-slate-900 p-4">
                <div className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300 font-semibold">Total Estimated Manufacturing</div>
                <div className="text-3xl font-bold text-emerald-800 dark:text-emerald-200 mt-1" data-testid="mfg-summary-total-days">{totalDays} <span className="text-sm font-normal">Working Days</span></div>
                <div className="text-[11px] text-slate-500 mt-1">Excludes Sundays</div>
              </div>

              <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-[11px] text-slate-500 uppercase">Required Start Date</div>
                  <div className="text-base font-semibold">{startDate || "—"}</div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-[11px] text-slate-500 uppercase">Production Start</div>
                  <div className="text-base font-semibold">{productionStartDate || "—"}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">After procurement window</div>
                </div>
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3">
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-300 uppercase">Estimated Completion Date</div>
                  <div className="text-base font-bold text-emerald-700 dark:text-emerald-300" data-testid="mfg-summary-completion">{completionDate || "—"}</div>
                </div>
              </div>

              <div className="lg:col-span-3 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <Table>
                  <thead><tr><Th>Details</Th><Th className="text-right">Estimated Days</Th></tr></thead>
                  <tbody>
                    <tr><Td>Raw Material Procurement</Td><Td className="text-right font-semibold">{rmDays} Days</Td></tr>
                    <tr><Td>Production Time ({runInParallel ? "parallel" : "sequential"})</Td><Td className="text-right font-semibold">{productionDays} Days</Td></tr>
                    <tr className="bg-emerald-50/60 dark:bg-emerald-900/20">
                      <Td className="font-semibold">Total Estimated Manufacturing Time</Td>
                      <Td className="text-right font-bold text-emerald-700 dark:text-emerald-300">{totalDays} Days</Td>
                    </tr>
                  </tbody>
                </Table>
              </div>

              <div className="lg:col-span-3 text-[11px] text-slate-500">
                {currentFG && <>Estimating for <b>{currentFG.name}</b> × <b>{qty}</b> Nos{currentBOM ? <> · BOM: {currentBOM.name}</> : null} · Value at sale rate ≈ <b>{fmtINR((Number(currentFG.saleRate) || 0) * qty)}</b></>}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
