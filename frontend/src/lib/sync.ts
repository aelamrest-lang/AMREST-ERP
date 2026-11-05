import type { RemoteChanges } from "./api";

type Revs = Record<string, Record<string, number>>;
// Records refreshed from other users while possibly open in a form: original rev/data, so a stale form can't revert their change.
export type PullInfo = Map<string, { rev: number; data: any; at: number }>;
const PULL_TTL = 30 * 60 * 1000;
const revertsPulled = (x: any, bx: any, p?: { data: any; at: number }) =>
  !!p && Date.now() - p.at < PULL_TTL && Object.keys(bx || {}).some(f => !same(bx[f], p.data?.[f]) && same(x[f], p.data?.[f]));
export interface SyncOp { kind: "upsert" | "delete" | "inc" | "set"; coll?: string; rid?: string; baseRev?: number | null; data?: any; delta?: number; key?: string; value?: any }

const same = (a: any, b: any) => a === b || JSON.stringify(a) === JSON.stringify(b);
const without = (o: any, k: string) => { const { [k]: _x, ...rest } = o || {}; return rest; };
const DERIVED_PO = ["Approved", "Partially Received", "Completed"];

// Turns the difference between the last server-confirmed state and the local state into record-level operations.
export function computeOps(base: any, local: any, revs: Revs, vrevs: Record<string, number>, pulled: PullInfo = new Map()): SyncOp[] {
  const ops: SyncOp[] = [];
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(local || {})]);
  keys.forEach(key => {
    const b = base?.[key], l = local?.[key];
    if (b === l) return;
    if (key === "settings") {
      new Set([...Object.keys(b || {}), ...Object.keys(l || {})]).forEach(sub => {
        if (!same(b?.[sub], l?.[sub])) ops.push({ kind: "set", key: `settings.${sub}`, baseRev: vrevs[`settings.${sub}`] ?? 0, value: l?.[sub] ?? null });
      });
      return;
    }
    if (Array.isArray(b) || Array.isArray(l)) {
      const bm = new Map((b || []).map((x: any) => [x.id, x]));
      const lm = new Map((l || []).map((x: any) => [x.id, x]));
      (l || []).forEach((x: any) => {
        const bx: any = bm.get(x.id);
        if (!bx) { ops.push({ kind: "upsert", coll: key, rid: x.id, baseRev: null, data: x }); return; }
        if (x === bx || same(x, bx)) return;
        const p = pulled.get(`${key}:${x.id}`);
        const stale = revertsPulled(x, bx, p);
        if (key === "items") {
          const staleStock = !!p && Date.now() - p.at < PULL_TTL && !same(bx.currentStock, p.data?.currentStock) && same(x.currentStock, p.data?.currentStock);
          const delta = staleStock ? 0 : (Number(x.currentStock) || 0) - (Number(bx.currentStock) || 0);
          if (Math.abs(delta) > 1e-9) ops.push({ kind: "inc", coll: key, rid: x.id, delta: Math.round(delta * 1e6) / 1e6 });
          if (!same(without(x, "currentStock"), without(bx, "currentStock"))) ops.push({ kind: "upsert", coll: key, rid: x.id, baseRev: (revertsPulled(without(x, "currentStock"), without(bx, "currentStock"), p) ? p!.rev : revs[key]?.[x.id]) ?? 0, data: x });
          return;
        }
        if (key === "purchaseOrders" && DERIVED_PO.includes(x.status) && DERIVED_PO.includes(bx.status) && same(without(x, "status"), without(bx, "status"))) return;
        ops.push({ kind: "upsert", coll: key, rid: x.id, baseRev: (stale ? p!.rev : revs[key]?.[x.id]) ?? 0, data: x });
      });
      if (key !== "logs") (b || []).forEach((x: any) => { if (!lm.has(x.id)) ops.push({ kind: "delete", coll: key, rid: x.id, baseRev: revs[key]?.[x.id] ?? 0 }); });
      return;
    }
    if (!same(b, l)) ops.push({ kind: "set", key, baseRev: vrevs[key] ?? 0, value: l ?? null });
  });
  return ops;
}

// Applies other users' committed changes. Records this tab is still editing keep their old base/rev so a clash is detected on save.
export function applyChanges(base: any, local: any, revs: Revs, vrevs: Record<string, number>, ch: RemoteChanges, pulled: PullInfo = new Map()) {
  const nb: any = { ...base }, nl: any = { ...local, settings: { ...local.settings } };
  nb.settings = { ...base.settings };
  const byColl = new Map<string, RemoteChanges["records"]>();
  ch.records.forEach(r => { if (!byColl.has(r.coll)) byColl.set(r.coll, []); byColl.get(r.coll)!.push(r); });
  byColl.forEach((list, coll) => {
    let bl: any[] = [...(nb[coll] || [])], ll: any[] = [...(nl[coll] || [])];
    revs[coll] = { ...(revs[coll] || {}) };
    list.forEach(r => {
      const bi = bl.findIndex(x => x.id === r.rid), li = ll.findIndex(x => x.id === r.rid);
      const b = bi >= 0 ? bl[bi] : undefined, l = li >= 0 ? ll[li] : undefined;
      const untouched = l === b || (l && b && same(l, b));
      if (coll === "items" && r.data && l && b && !untouched && same(without(l, "currentStock"), without(b, "currentStock"))) {
        const mine = (Number(l.currentStock) || 0) - (Number(b.currentStock) || 0);
        if (!pulled.has(`${coll}:${r.rid}`)) pulled.set(`${coll}:${r.rid}`, { rev: revs[coll][r.rid] ?? 0, data: b, at: Date.now() });
        bl[bi] = r.data; ll[li] = { ...r.data, currentStock: (Number(r.data.currentStock) || 0) + mine }; revs[coll][r.rid] = r.rev;
        return;
      }
      if (b && !untouched) {
        if (coll === "items" && r.data) { bl[bi] = { ...b, currentStock: r.data.currentStock }; ll[li] = { ...l, currentStock: (Number(r.data.currentStock) || 0) + ((Number(l.currentStock) || 0) - (Number(b.currentStock) || 0)) }; }
        return;
      }
      if (!b && l) return;
      if (r.deleted) { if (bi >= 0) bl.splice(bi, 1); if (li >= 0) ll.splice(li, 1); delete revs[coll][r.rid]; return; }
      if (b && coll !== "logs" && !pulled.has(`${coll}:${r.rid}`)) pulled.set(`${coll}:${r.rid}`, { rev: revs[coll][r.rid] ?? 0, data: b, at: Date.now() });
      if (bi >= 0) bl[bi] = r.data; else bl = [r.data, ...bl];
      if (li >= 0) ll[li] = r.data; else ll = [r.data, ...ll];
      revs[coll][r.rid] = r.rev;
    });
    if (coll === "logs") { const sort = (a: any[]) => a.sort((x, y) => String(y.timestamp).localeCompare(String(x.timestamp))).slice(0, 500); bl = sort(bl); ll = sort(ll); }
    nb[coll] = bl; nl[coll] = ll;
  });
  ch.values.forEach(v => {
    const isSet = v.key.startsWith("settings."), sub = v.key.slice(9);
    const b = isSet ? nb.settings[sub] : nb[v.key], l = isSet ? nl.settings[sub] : nl[v.key];
    if (!same(b, l)) return;
    if (isSet) { nb.settings[sub] = v.value; nl.settings[sub] = v.value; } else { nb[v.key] = v.value; nl[v.key] = v.value; }
    vrevs[v.key] = v.rev;
  });
  return { base: nb, local: nl };
}

const NUM_RE = /^(.*?-\d{4}-)(\d+)(.*)$/s;
// Gives this tab's new record the next free document number after the server rejected a duplicate.
export function renumber(local: any, dups: { coll: string; rid: string }[]) {
  const out: any = { ...local };
  const map: [string, string][] = [];
  dups.forEach(d => {
    const list: any[] = out[d.coll] || [];
    const rec = list.find(x => x.id === d.rid);
    const m = String(rec?.number || "").match(NUM_RE);
    if (!rec || !m) return;
    const max = Math.max(...list.map(x => String(x.number || "").match(NUM_RE)).filter(x => x && x[1] === m[1]).map(x => Number(x![2]) || 0));
    const nextShort = m[1] + String(max + 1).padStart(m[2].length, "0");
    map.push([m[1] + m[2], nextShort]);
    out[d.coll] = list.map(x => x.id === d.rid ? { ...x, number: nextShort + m[3] } : x);
  });
  return { db: out, map };
}

// Puts a not-yet-saved batch (from a previous session) into local state so it is visible and can be renumbered / reviewed.
export function applyOpsLocally(local: any, ops: SyncOp[]) {
  const out: any = { ...local, settings: { ...local.settings } };
  ops.forEach(o => {
    if (o.kind === "set" && o.key) { if (o.key.startsWith("settings.")) out.settings[o.key.slice(9)] = o.value; else out[o.key] = o.value; return; }
    const list: any[] = out[o.coll!] || [];
    if (o.kind === "upsert") out[o.coll!] = list.some(x => x.id === o.rid) ? list.map(x => x.id === o.rid ? (o.coll === "items" ? { ...o.data, currentStock: x.currentStock } : o.data) : x) : [o.data, ...list];
    else if (o.kind === "delete") out[o.coll!] = list.filter(x => x.id !== o.rid);
    else if (o.kind === "inc") out[o.coll!] = list.map(x => x.id === o.rid ? { ...x, currentStock: (Number(x.currentStock) || 0) + (o.delta || 0) } : x);
  });
  return out;
}
