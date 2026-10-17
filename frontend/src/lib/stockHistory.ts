import type { DB, Item } from "./types";

export interface StockMove { date: string; itemId: string; qty: number; type: "GRN" | "Issue" | "SFG Produced" | "SFG Consumed" | "Dispatch" }
export interface StockLedger { moves: StockMove[]; rates: Map<string, { date: string; rate: number }[]> }

// All dated inventory movements, newest first, plus GRN purchase rates per item (oldest first).
export function buildStockLedger(db: DB): StockLedger {
  const moves: StockMove[] = [];
  const rates = new Map<string, { date: string; rate: number }[]>();
  db.grns.forEach(g => {
    const po = db.purchaseOrders.find(p => p.id === g.poId);
    g.receivedItems.forEach(r => {
      moves.push({ date: g.date || "", itemId: r.itemId, qty: r.qty || 0, type: "GRN" });
      const rate = Number(po?.items.find(x => x.itemId === r.itemId)?.rate) || 0;
      if (rate > 0) (rates.get(r.itemId) || rates.set(r.itemId, []).get(r.itemId)!).push({ date: g.date || "", rate });
    });
  });
  db.materialIssues.forEach(mi => mi.lines.forEach(l => { if (l.issueQty > 0) moves.push({ date: mi.date, itemId: l.itemId, qty: -l.issueQty, type: "Issue" }); }));
  (db.sfgBatches || []).forEach(b => moves.push({ date: b.date, itemId: b.itemId, qty: b.qtyProduced || 0, type: "SFG Produced" }));
  (db.sfgConsumptions || []).forEach(c => moves.push({ date: c.date, itemId: c.itemId, qty: -(c.qty || 0), type: "SFG Consumed" }));
  db.challans.forEach(c => (c.dispatches || []).forEach(d => d.lines.forEach(l => { if (l.itemId && l.deducted) moves.push({ date: d.date, itemId: l.itemId, qty: -l.deducted, type: "Dispatch" }); })));
  moves.sort((a, b) => b.date.localeCompare(a.date));
  rates.forEach(list => list.sort((a, b) => a.date.localeCompare(b.date)));
  return { moves, rates };
}

// Closing qty at end of `date` = current stock − every movement dated after it.
export function stockAsOf(db: DB, ledger: StockLedger, date: string): Map<string, number> {
  const stock = new Map(db.items.map(i => [i.id, Number(i.currentStock) || 0]));
  for (const m of ledger.moves) { if (m.date <= date) break; stock.set(m.itemId, (stock.get(m.itemId) || 0) - m.qty); }
  return stock;
}

// Same rule as live Inventory, applied as of a date: RM/SFG = avg of last 3 purchases up to the date, FG = sale price.
export function rateAsOf(item: Item, ledger: StockLedger, date: string): { rate: number; basis: string } {
  if (item.category === "Finished Goods") return { rate: item.saleRate || item.purchaseRate || 0, basis: "sale price" };
  const last = (ledger.rates.get(item.id) || []).filter(r => r.date <= date).slice(-3);
  if (last.length) return { rate: last.reduce((s, r) => s + r.rate, 0) / last.length, basis: `avg of last ${last.length} purchase${last.length > 1 ? "s" : ""}` };
  return { rate: item.purchaseRate || 0, basis: "item master rate" };
}

export function movementsBetween(ledger: StockLedger, from: string, to: string) {
  const inQ = new Map<string, number>(), outQ = new Map<string, number>();
  ledger.moves.forEach(m => {
    if (m.date < from || m.date > to) return;
    const t = m.qty >= 0 ? inQ : outQ;
    t.set(m.itemId, (t.get(m.itemId) || 0) + Math.abs(m.qty));
  });
  return { inQ, outQ };
}

export function stockValueAsOf(db: DB, ledger: StockLedger, date: string) {
  const st = stockAsOf(db, ledger, date);
  return db.items.reduce((s, i) => s + (st.get(i.id) || 0) * rateAsOf(i, ledger, date).rate, 0);
}
