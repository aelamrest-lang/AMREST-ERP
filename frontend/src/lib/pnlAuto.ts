import type { DB } from "./types";
import { buildStockLedger, stockValueAsOf } from "./stockHistory";

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

// Month-end stock uses the same historical valuation as Inventory's date filter.
export function computeAutoPnl(db: DB, keys: string[]): Record<string, MonthAuto> {
  const today = new Date();
  const curKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const ledger = buildStockLedger(db);
  const out: Record<string, MonthAuto> = {};
  keys.forEach(key => {
    const future = key > curKey;
    out[key] = future ? { opening: 0, purchase: 0, closing: 0, sales: 0, future } : {
      opening: stockValueAsOf(db, ledger, monthEnd(prevMonthKey(key))),
      closing: stockValueAsOf(db, ledger, monthEnd(key)),
      purchase: db.grns.filter(g => (g.date || "").startsWith(key)).reduce((s, g) => s + grnNetValue(db, g), 0),
      sales: db.challans.filter(c => (c.date || "").startsWith(key)).reduce((s, c) => s + invoiceTaxable(c), 0),
      future,
    };
  });
  return out;
}
