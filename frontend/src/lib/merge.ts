const isObj = (v: any) => v && typeof v === "object" && !Array.isArray(v);
const isIdList = (v: any) => Array.isArray(v) && v.length > 0 && v.every(x => isObj(x) && "id" in x);
const same = (a: any, b: any) => a === b || JSON.stringify(a) === JSON.stringify(b);
// Quantity fields that several users may change at once: combine both users' deltas instead of overwriting.
const ACCUMULATORS = new Set(["currentStock"]);

export function changedKeys<T extends Record<string, any>>(base: T | null, local: T): Partial<T> {
  const out: Partial<T> = {};
  Object.keys(local).forEach(k => { if (!base || local[k] !== base[k]) (out as any)[k] = local[k]; });
  return out;
}

function mergeRecord(base: any, local: any, remote: any) {
  const out: any = { ...remote };
  Object.keys(local).forEach(k => {
    if (same(local[k], base[k])) return;
    if (ACCUMULATORS.has(k) && typeof local[k] === "number" && typeof remote[k] === "number" && typeof base[k] === "number") out[k] = remote[k] + (local[k] - base[k]);
    else out[k] = merge3(base[k], local[k], remote[k]);
  });
  return out;
}

function mergeList(base: any[], local: any[], remote: any[]) {
  const b = new Map(base.map(x => [x.id, x]));
  const l = new Map(local.map(x => [x.id, x]));
  const r = new Set(remote.map(x => x.id));
  const kept = remote
    .filter(x => !(b.has(x.id) && !l.has(x.id)))
    .map(x => {
      const li = l.get(x.id), bi = b.get(x.id);
      if (!li || li === bi) return x;
      if (bi && !same(x, bi)) return mergeRecord(bi, li, x);
      return li;
    });
  const added = local.filter(x => !b.has(x.id) && !r.has(x.id));
  return [...added, ...kept];
}

// 3-way merge: keeps everything another user saved (remote) and re-applies only what this user changed since `base`.
export function merge3(base: any, local: any, remote: any): any {
  if (local === base) return remote;
  if (remote === undefined || base === undefined) return local;
  if ((isIdList(local) || isIdList(base) || isIdList(remote)) && [base, local, remote].every(Array.isArray)) return mergeList(base, local, remote);
  if (isObj(local) && isObj(base) && isObj(remote)) {
    const out: any = { ...remote };
    Object.keys(local).forEach(k => { if (local[k] !== base[k]) out[k] = merge3(base[k], local[k], remote[k]); });
    Object.keys(base).forEach(k => { if (!(k in local)) delete out[k]; });
    return out;
  }
  return local;
}

const NUMBERED = ["grns", "purchaseOrders", "materialIssues", "jobCards", "challans", "quotations", "salesOrders", "proformas", "leads"];
const NUM_RE = /^(.*?-\d{4}-)(\d+)(.*)$/s;

// Records this tab created while another user created one with the same document number get the next free number.
export function renumberCollisions(merged: any, base: any, local: any): { db: any; renamed: [string, string][] } {
  const map = new Map<string, string>();
  const out = { ...merged };
  const short = (num: any) => { const m = String(num || "").match(NUM_RE); return m ? m[1] + m[2] : null; };
  NUMBERED.forEach(key => {
    const list: any[] = out[key];
    if (!Array.isArray(list)) return;
    const baseIds = new Set((base?.[key] || []).map((x: any) => x.id));
    const mine = new Set((local?.[key] || []).filter((x: any) => !baseIds.has(x.id)).map((x: any) => x.id));
    if (!mine.size) return;
    const othersTaken = new Set(list.filter(x => !mine.has(x.id)).map(x => short(x.number)).filter(Boolean) as string[]);
    const taken = new Set(othersTaken);
    list.forEach(x => { const sh = short(x.number); if (mine.has(x.id) && sh && !othersTaken.has(sh)) taken.add(sh); });
    const renameIds = new Map<string, string>();
    [...list].reverse().forEach(x => {
      const m = String(x.number || "").match(NUM_RE);
      if (!mine.has(x.id) || !m || !othersTaken.has(m[1] + m[2])) return;
      const max = Math.max(...[...taken].filter(t => t.startsWith(m[1])).map(t => Number(t.slice(m[1].length)) || 0));
      const nextShort = m[1] + String(max + 1).padStart(m[2].length, "0");
      taken.add(nextShort);
      map.set(m[1] + m[2], nextShort);
      renameIds.set(x.id, nextShort + m[3]);
    });
    out[key] = list.map(x => renameIds.has(x.id) ? { ...x, number: renameIds.get(x.id) } : x);
  });
  if (!map.size) return { db: out, renamed: [] };
  const re = new RegExp([...map.keys()].map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + "(?!\\d)", "g");
  const fix = (v: string) => v.replace(re, m => map.get(m) || m);
  // Update text references (activity log, GRN audit, etc.) inside records this tab created.
  Object.keys(out).forEach(key => {
    if (!Array.isArray(out[key]) || NUMBERED.includes(key)) return;
    const baseIds = new Set((base?.[key] || []).map((x: any) => x?.id));
    const mine = new Set((local?.[key] || []).filter((x: any) => x?.id && !baseIds.has(x.id)).map((x: any) => x.id));
    if (!mine.size) return;
    out[key] = out[key].map((x: any) => !mine.has(x?.id) ? x : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === "string" ? fix(v) : v])));
  });
  return { db: out, renamed: [...map.entries()] };
}

// PO receipt status derived from the merged GRNs (concurrent GRN create/delete can leave a stale status).
export function normalizePoStatus(db: any, base: any) {
  const ids = (l: any[]) => new Map((l || []).map((g: any) => [g.id, g.poId]));
  const a = ids(base?.grns), b = ids(db.grns);
  const affected = new Set<string>();
  a.forEach((po, id) => { if (!b.has(id)) affected.add(po); });
  b.forEach((po, id) => { if (!a.has(id)) affected.add(po); });
  const recv = new Map<string, Record<string, number>>();
  (db.grns || []).forEach((g: any) => { const c = recv.get(g.poId) || {}; (g.receivedItems || []).forEach((r: any) => { c[r.itemId] = (c[r.itemId] || 0) + (Number(r.qty) || 0); }); recv.set(g.poId, c); });
  const purchaseOrders = (db.purchaseOrders || []).map((p: any) => {
    if (!affected.has(p.id) || !["Approved", "Partially Received", "Completed"].includes(p.status) || !(p.items || []).length) return p;
    const c = recv.get(p.id) || {};
    const st = p.items.every((i: any) => (c[i.itemId] || 0) >= i.qty) ? "Completed" : p.items.some((i: any) => (c[i.itemId] || 0) > 0) ? "Partially Received" : "Approved";
    return st === p.status ? p : { ...p, status: st };
  });
  return { ...db, purchaseOrders };
}
