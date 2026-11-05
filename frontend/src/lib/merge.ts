const isObj = (v: any) => v && typeof v === "object" && !Array.isArray(v);
const isIdList = (v: any) => Array.isArray(v) && v.length > 0 && v.every(x => isObj(x) && "id" in x);

export function changedKeys<T extends Record<string, any>>(base: T | null, local: T): Partial<T> {
  const out: Partial<T> = {};
  Object.keys(local).forEach(k => { if (!base || local[k] !== base[k]) (out as any)[k] = local[k]; });
  return out;
}

function mergeList(base: any[], local: any[], remote: any[]) {
  const b = new Map(base.map(x => [x.id, x]));
  const l = new Map(local.map(x => [x.id, x]));
  const r = new Set(remote.map(x => x.id));
  const kept = remote
    .filter(x => !(b.has(x.id) && !l.has(x.id)))
    .map(x => { const li = l.get(x.id); return li && li !== b.get(x.id) ? li : x; });
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
