import type { BOM, DB, Item } from "./types";

export function bomForItem(db: Pick<DB, "boms">, item?: Pick<Item, "id" | "name">): BOM | undefined {
  if (!item) return undefined;
  return db.boms.find(b => b.productItemId === item.id) || db.boms.find(b => b.name === item.name);
}

// True if `childId`'s BOM tree (FG components only) reaches `parentId`, or child === parent.
export function createsCycle(db: Pick<DB, "boms" | "items">, parentId: string, childId: string): boolean {
  const seen = new Set<string>();
  const walk = (id: string): boolean => {
    if (id === parentId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const item = db.items.find(i => i.id === id);
    if (item?.category !== "Finished Goods") return false;
    return (bomForItem(db, item)?.materials || []).some(m => !!m.itemId && walk(m.itemId));
  };
  return walk(childId);
}

export interface ExplodedRow { itemId: string; name: string; category: string; unit: string; qty: number; via: Set<string> }

// Expands FG components that have their own BOM; RM, SFG and FG without BOM are leaves.
export function explodeBom(db: Pick<DB, "boms" | "items">, rootId: string, qty: number) {
  const rows = new Map<string, ExplodedRow>();
  const cycles: string[] = [];
  let depth = 0;
  const walk = (itemId: string, mult: number, path: string[], level: number) => {
    depth = Math.max(depth, level);
    const item = db.items.find(i => i.id === itemId);
    const bom = bomForItem(db, item);
    bom?.materials.forEach(m => {
      if (!m.itemId) return;
      const child = db.items.find(i => i.id === m.itemId);
      const q = (Number(m.qty) || 0) * mult;
      if (path.includes(m.itemId)) { cycles.push([...path, m.itemId].map(id => db.items.find(i => i.id === id)?.name || id).join(" → ")); return; }
      if (child?.category === "Finished Goods" && bomForItem(db, child)?.materials.length) return walk(m.itemId, q, [...path, m.itemId], level + 1);
      const r = rows.get(m.itemId) || { itemId: m.itemId, name: child?.name || m.name, category: child?.category || "-", unit: child?.unit || m.unit, qty: 0, via: new Set<string>() };
      r.qty = Math.round((r.qty + q) * 1e6) / 1e6;
      r.via.add(item?.name || "");
      rows.set(m.itemId, r);
    });
  };
  walk(rootId, qty, [rootId], 1);
  return { rows: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)), cycles, depth };
}
