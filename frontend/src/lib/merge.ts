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
  const renamed: [string, string][] = [];
  const out = { ...merged };
  NUMBERED.forEach(key => {
    const list: any[] = out[key];
    if (!Array.isArray(list)) return;
    const baseIds = new Set((base?.[key] || []).map((x: any) => x.id));
    const mine = new Set((local?.[key] || []).filter((x: any) => !baseIds.has(x.id)).map((x: any) => x.id));
    if (!mine.size) return;
    const others = list.filter(x => !mine.has(x.id));
    const taken = new Set(others.map(x => String(x.number || "").match(NUM_RE)?.slice(1, 3).join("") || x.number));
    out[key] = list.map(x => {
      const m = String(x.number || "").match(NUM_RE);
      if (!mine.has(x.id) || !m || !taken.has(m[1] + m[2])) return x;
      let n = Number(m[2]);
      const max = Math.max(n, ...[...taken].filter(t => t.startsWith(m[1])).map(t => Number(t.slice(m[1].length)) || 0));
      n = max + 1;
      const next = `${m[1]}${String(n).padStart(m[2].length, "0")}${m[3]}`;
      taken.add(m[1] + String(n).padStart(m[2].length, "0"));
      renamed.push([`${m[1]}${m[2]}`, `${m[1]}${String(n).padStart(m[2].length, "0")}`]);
      return { ...x, number: next };
    });
  });
  if (renamed.length && Array.isArray(out.logs)) {
    const baseLogIds = new Set((base?.logs || []).map((l: any) => l.id));
    const myLogs = new Set((local?.logs || []).filter((l: any) => !baseLogIds.has(l.id)).map((l: any) => l.id));
    out.logs = out.logs.map((l: any) => !myLogs.has(l.id) ? l : { ...l, action: renamed.reduce((a: string, [o, n]) => a.split(o).join(n), l.action) });
  }
  return { db: out, renamed };
}
