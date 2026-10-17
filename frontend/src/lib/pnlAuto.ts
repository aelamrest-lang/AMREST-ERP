import type { DB } from "./types";

export interface MonthAuto { opening: number; purchase: number; closing: number; sales: number; future: boolean }

const monthEnd = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};
const prevMonthKey = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

export const grnNetValue = (db: DB, g: DB["grns"][0]) => {
  const po = db.purchaseOrders.find(p => p.id === g.poId);
  const items = g.receivedItems.reduce((s, r) => s + (r.qty || 0) * (Number(po?.items.find(x => x.itemId === r.itemId)?.rate) || 0), 0);
  return items + (g.freightEnabled ? Number(g.freight) || 0 : 0) + (g.packingEnabled ? Number(g.packing) || 0 : 0);
};

export const invoiceTaxable = (c: DB["challans"][0]) =>
  (c.items || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0) + (Number(c.freight) || 0);

// Reconstructs month-end stock backwards from current stock using dated transactions; valued at that month's purchase rates.
export function computeAutoPnl(db: DB, keys: string[]): Record<string, MonthAuto> {
  const today = new Date();
  const curKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const moves: { date: string; itemId: string; qty: number }[] = [];
  const rates = new Map<string, { date: string; rate: number; qty: number }[]>();
  db.grns.forEach(g => {
    const po = db.purchaseOrders.find(p => p.id === g.poId);
    g.receivedItems.forEach(r => {
      moves.push({ date: g.date, itemId: r.itemId, qty: r.qty || 0 });
      const rate = Number(po?.items.find(x => x.itemId === r.itemId)?.rate) || 0;
      if (rate > 0) (rates.get(r.itemId) || rates.set(r.itemId, []).get(r.itemId)!).push({ date: g.date, rate, qty: r.qty || 0 });
    });
  });
  db.materialIssues.forEach(mi => mi.lines.forEach(l => { if (l.issueQty > 0) moves.push({ date: mi.date, itemId: l.itemId, qty: -l.issueQty }); }));
  (db.sfgBatches || []).forEach(b => moves.push({ date: b.date, itemId: b.itemId, qty: b.qtyProduced || 0 }));
  (db.sfgConsumptions || []).forEach(c => moves.push({ date: c.date, itemId: c.itemId, qty: -(c.qty || 0) }));
  db.challans.forEach(c => (c.dispatches || []).forEach(d => d.lines.forEach(l => { if (l.itemId && l.deducted) moves.push({ date: d.date, itemId: l.itemId, qty: -l.deducted }); })));
  moves.sort((a, b) => b.date.localeCompare(a.date));

  const rateAt = (item: DB["items"][0], key: string) => {
    if (item.category === "Finished Goods") return item.saleRate || item.purchaseRate || 0;
    const list = rates.get(item.id) || [];
    const inMonth = list.filter(r => r.date.startsWith(key));
    const q = inMonth.reduce((s, r) => s + r.qty, 0);
    if (inMonth.length) return q > 0 ? inMonth.reduce((s, r) => s + r.rate * r.qty, 0) / q : inMonth[0].rate;
    const before = list.filter(r => r.date <= monthEnd(key)).sort((a, b) => b.date.localeCompare(a.date))[0];
    return before?.rate ?? item.purchaseRate ?? 0;
  };

  const valueAt = (key: string) => {
    const end = monthEnd(key);
    const stock = new Map(db.items.map(i => [i.id, Number(i.currentStock) || 0]));
    for (const m of moves) { if (m.date <= end) break; stock.set(m.itemId, (stock.get(m.itemId) || 0) - m.qty); }
    return db.items.reduce((s, i) => s + Math.max(0, stock.get(i.id) || 0) * rateAt(i, key), 0);
  };

  const out: Record<string, MonthAuto> = {};
  keys.forEach(key => {
    const future = key > curKey;
    out[key] = future ? { opening: 0, purchase: 0, closing: 0, sales: 0, future } : {
      opening: valueAt(prevMonthKey(key)),
      closing: valueAt(key),
      purchase: db.grns.filter(g => (g.date || "").startsWith(key)).reduce((s, g) => s + grnNetValue(db, g), 0),
      sales: db.challans.filter(c => (c.date || "").startsWith(key)).reduce((s, c) => s + invoiceTaxable(c), 0),
      future,
    };
  });
  return out;
}
