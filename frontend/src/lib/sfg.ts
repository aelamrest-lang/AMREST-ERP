import type { DB, SfgBatch, SfgConsumption } from "./types";
import { uid } from "./store";
import { todayISO } from "./utils";

export const DEFAULT_SFG_STAGES = [
  "LV Winding", "HV Winding", "Primary Winding", "Secondary Winding 1", "Secondary Winding 2",
  "Secondary Winding 3", "Core Coil Assembly", "Tanking", "Finishing", "Testing Ready", "Dispatch Ready",
];

export function sfgStages(db: DB): string[] {
  const master = db.settings.productionStages?.length ? db.settings.productionStages : DEFAULT_SFG_STAGES;
  const set = new Set<string>(master);
  const seen = new Set([...set].map(s => s.toLowerCase()));
  const add = (s: string) => {
    const t = (s || "").trim();
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); set.add(t); }
  };
  db.jobCards.forEach(j => (j.stages || []).forEach(s => add(s.stage)));
  Object.keys(db.settings.sfgStageItems || {}).forEach(add);
  Object.keys(db.settings.sfgConsumptionMap || {}).forEach(add);
  return [...set];
}

export function sfgAvailable(b: SfgBatch) { return Math.max(0, b.qtyProduced - b.qtyUsed); }

export function applySfgProduction(d: DB, args: { jobCardId: string; jobCardNumber: string; stage: string; qty: number; entryId?: string; date?: string }): Partial<DB> {
  const itemId = d.settings.sfgStageItemsByJc?.[args.jobCardId]?.[args.stage];
  if (!itemId || args.qty <= 0) return {};
  const batch: SfgBatch = {
    id: uid(), itemId, jobCardId: args.jobCardId, jobCardNumber: args.jobCardNumber,
    stage: args.stage, qtyProduced: args.qty, qtyUsed: 0, date: args.date || todayISO(), entryId: args.entryId,
    createdAt: new Date().toISOString(),
  };
  return {
    sfgBatches: [batch, ...(d.sfgBatches || [])],
    items: d.items.map(i => i.id === itemId ? { ...i, currentStock: (i.currentStock || 0) + args.qty } : i),
  };
}

export function consumeSfgItems(d: DB, args: {
  needs: { itemId: string; qty: number }[];
  outputStage: string;
  outputJobCardId?: string;
  outputJobCardNumber?: string;
  mode: "auto" | "manual";
  remarks?: string;
  date?: string;
}): { updates: Partial<DB>; shortages: string[] } {
  let batches = (d.sfgBatches || []).slice();
  let items = d.items.slice();
  const consumptions: SfgConsumption[] = [];
  const shortages: string[] = [];
  for (const need of args.needs) {
    let remaining = need.qty;
    if (remaining <= 0) continue;
    const candidates = batches
      .filter(b => b.itemId === need.itemId && sfgAvailable(b) > 0)
      .sort((a, b) => {
        const aJ = args.outputJobCardId && a.jobCardId === args.outputJobCardId ? 0 : 1;
        const bJ = args.outputJobCardId && b.jobCardId === args.outputJobCardId ? 0 : 1;
        if (aJ !== bJ) return aJ - bJ;
        return (a.date + a.createdAt).localeCompare(b.date + b.createdAt);
      });
    for (const c of candidates) {
      if (remaining <= 0) break;
      const take = Math.min(sfgAvailable(c), remaining);
      batches = batches.map(b => b.id === c.id ? { ...b, qtyUsed: b.qtyUsed + take } : b);
      consumptions.push({
        id: uid(), date: args.date || todayISO(), itemId: need.itemId, batchId: c.id, qty: take,
        sourceJobCardId: c.jobCardId, sourceJobCardNumber: c.jobCardNumber,
        outputStage: args.outputStage, outputJobCardId: args.outputJobCardId, outputJobCardNumber: args.outputJobCardNumber,
        mode: args.mode, remarks: args.remarks, createdAt: new Date().toISOString(),
      });
      remaining -= take;
    }
    const consumedQty = need.qty - remaining;
    if (consumedQty > 0) items = items.map(i => i.id === need.itemId ? { ...i, currentStock: Math.max(0, (i.currentStock || 0) - consumedQty) } : i);
    if (remaining > 0) {
      const name = d.items.find(i => i.id === need.itemId)?.name || need.itemId;
      shortages.push(`${name}: short by ${remaining}`);
    }
  }
  if (!consumptions.length) return { updates: {}, shortages };
  return { updates: { sfgBatches: batches, sfgConsumptions: [...consumptions, ...(d.sfgConsumptions || [])], items }, shortages };
}

export function applySfgAutoConsumption(d: DB, args: { stage: string; qty: number; jobCardId: string; jobCardNumber: string; date?: string }) {
  const rules = d.settings.sfgConsumptionMapByJc?.[args.jobCardId]?.[args.stage] ?? d.settings.sfgConsumptionMap?.[args.stage] ?? [];
  const needs = rules.map(r => ({ itemId: r.itemId, qty: r.qtyPerUnit * args.qty })).filter(n => n.qty > 0);
  if (!needs.length) return { updates: {}, shortages: [] as string[] };
  return consumeSfgItems(d, { needs, outputStage: args.stage, outputJobCardId: args.jobCardId, outputJobCardNumber: args.jobCardNumber, mode: "auto", date: args.date });
}
