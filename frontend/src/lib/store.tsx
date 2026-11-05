import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { legacyDispatch } from "./invoice";
import type { DB, User, ActivityLog } from "./types";
import { defaultDocumentFormats, seedDB } from "./seed";
import { defaultPermissionsForRole, normalizePermissions } from "./permissions";
import { apiLogin, fetchState, fetchChanges, isApplied, commitOps, fetchRemoteVersion, getToken, setToken, type RemoteState } from "./api";
import { applyChanges, applyOpsLocally, computeOps, renumber, type PullInfo, type SyncOp } from "./sync";

const SESSION_KEY = "amrest_erp_session";
const THEME_KEY = "amrest_theme";
const SETTINGS_CACHE_KEY = "amrest_settings_cache";

function readCachedSettings(): Partial<import("./types").CompanySettings> | null {
  try {
    const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeCachedSettings(settings: import("./types").CompanySettings) {
  try {
    const slim = {
      name: settings.name,
      address: settings.address,
      gst: settings.gst,
      logoUrl: settings.logoUrl,
      logoText: settings.logoText,
      email: settings.email,
      phone: settings.phone,
    };
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(slim));
  } catch { /* quota exceeded */ }
}

function migrateDB(db: DB): DB {
  const seeded = seedDB();
  const existingIds = new Set(db.users.map(u => u.id));
  const missingDepartmentUsers = seeded.users.filter(u => !existingIds.has(u.id));
  const users = [...db.users, ...missingDepartmentUsers].map(u => ({
    ...u,
    permissions: u.permissions ? normalizePermissions(u) : defaultPermissionsForRole(u.role),
  }));
  const seededDtr = seeded.qcFormats.find(f => f.id === "qcf-dtr");
  const seededCt = seeded.qcFormats.find(f => f.id === "qcf-ct");
  const seededPt = seeded.qcFormats.find(f => f.id === "qcf-pt");
  const seededCtPt = seeded.qcFormats.find(f => f.id === "qcf-oil");
  const qcFormats = db.qcFormats?.length ? db.qcFormats.map(format => {
    if (format.id === "qcf-dtr" && seededDtr && !format.columns.some(c => c.id === "nllFreq")) return seededDtr;
    if (format.id === "qcf-ct" && seededCt && !format.columns.some(c => c.id === "sepHv")) return seededCt;
    if (format.id === "qcf-pt" && seededPt && !format.columns.some(c => c.id === "sepLv03")) return seededPt;
    if (format.id === "qcf-oil" && seededCtPt && format.name === "Oil Test Format") return seededCtPt;
    return format;
  }) : (seeded.qcFormats || []);
  const seedFormats = seeded.settings.documentFormats || defaultDocumentFormats(new Date().toISOString());
  const existingFormats = (db.settings?.documentFormats || []).map(f =>
    f.documentType === "Delivery Challan" || f.documentType === "Dispatch Challan" ? { ...f, documentType: "Sales Invoice" } : f
  );
  const mergedDocumentFormats = [
    ...existingFormats,
    ...seedFormats.filter(sf => !existingFormats.some(ef => ef.documentType === sf.documentType)),
  ];
  // Also merge missing seed data (parties, items, boms, quotations) if the server started empty
  const hasBase = (db.parties?.length || 0) + (db.items?.length || 0) > 0;
  const parties = hasBase ? (db.parties || []) : seeded.parties;
  const items = hasBase ? (db.items || []) : seeded.items;
  const costings = hasBase ? (db.costings || []) : seeded.costings;
  const quotations = hasBase ? (db.quotations || []) : seeded.quotations;
  const boms = hasBase ? (db.boms || []) : seeded.boms;
  const purchaseOrders = hasBase ? (db.purchaseOrders || []) : seeded.purchaseOrders;

  // One-time stock model migration: holds no longer deduct Current Stock (only issues do) —
  // add back the still-active holds that were deducted by the old reservation model
  let migratedItems = items;
  let migratedSettings = { ...(db.settings || {}) } as DB["settings"];
  if (!migratedSettings.stockModelV2) {
    const activeHold = new Map<string, number>();
    (db.jobCards || []).filter(j => j.status !== "Completed").forEach(j => (j.reservedItems || []).forEach(r => {
      const issuedQty = (db.materialIssues || [])
        .filter(mi => mi.jobCardId === j.id)
        .flatMap(mi => mi.lines || [])
        .filter(l => l.itemId === r.itemId)
        .reduce((s, l) => s + (l.issueQty || 0), 0);
      const pending = Math.max(0, r.qty - issuedQty);
      if (pending > 0) activeHold.set(r.itemId, (activeHold.get(r.itemId) || 0) + pending);
    }));
    if (activeHold.size) {
      migratedItems = (items || []).map(i => activeHold.has(i.id) ? { ...i, currentStock: (i.currentStock || 0) + (activeHold.get(i.id) || 0) } : i);
    }
    migratedSettings = { ...migratedSettings, stockModelV2: true };
  }

  return {
    ...db,
    leads: db.leads || [],
    ctCostings: db.ctCostings || [],
    materialIssues: db.materialIssues || [],
    productionEntries: db.productionEntries || [],
    grnAudit: db.grnAudit || [],
    sfgBatches: db.sfgBatches || [],
    sfgConsumptions: db.sfgConsumptions || [],
    operators: db.operators || [],
    serials: db.serials || [],
    qcTests: db.qcTests || [],
    qcFinalReports: db.qcFinalReports || [],
    qcFormats,
    challans: (db.challans || []).map(c => c.dispatches ? c : { ...c, dispatches: [legacyDispatch(c)] }),
    parties, items: migratedItems, costings, quotations, boms, purchaseOrders,
    users,
    settings: { ...seeded.settings, ...migratedSettings, documentFormats: mergedDocumentFormats },
  };
}

interface Ctx {
  db: DB;
  setDB: (updater: (db: DB) => DB) => void;
  currentUser: User | null;
  hydrating: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; msg?: string }>;
  logout: () => void | Promise<void>;
  changePassword: (oldPwd: string, newPwd: string) => { ok: boolean; msg?: string };
  log: (action: string, module: string) => void;
  syncStatus: "syncing" | "connected" | "error" | "not-configured";
  syncError: string;
  syncNow: () => Promise<void>;
  saveState: SaveState;
  conflicts: ConflictItem[];
  resolveConflicts: (mode: "reload" | "reapply") => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
}

export type SaveState = "saving" | "saved" | "unsaved" | "failed" | "conflict" | "expired";
export interface ConflictItem { coll?: string; rid?: string; key?: string; reason: string; label: string; theirs: any; mine: any; rev: number | null; fields: { field: string; base: any; mine: any; theirs: any; mineChanged?: boolean }[] }
const UNSAVED_KEY = "amrest-erp-unsaved-ops";
const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(() => {
    const base = seedDB();
    const cached = readCachedSettings();
    return cached ? { ...base, settings: { ...base.settings, ...cached } } : base;
  });
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => (localStorage.getItem(THEME_KEY) as any) || "light");
  const [syncStatus, setSyncStatus] = useState<Ctx["syncStatus"]>("syncing");
  const [syncError, setSyncError] = useState("");
  const [saveState, setSaveStateRaw] = useState<SaveState>("saved");
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const saveTimer = useRef<any>(null);
  const saving = useRef(false);
  const version = useRef<number>(0);
  const baseRef = useRef<DB | null>(null);
  const dbRef = useRef<DB | null>(null);
  const revs = useRef<Record<string, Record<string, number>>>({});
  const vrevs = useRef<Record<string, number>>({});
  const inflight = useRef<{ opId: string; ops: SyncOp[]; snapshot: DB; origs?: Record<string, any> } | null>(null);
  const rejected = useRef<{ origs: Record<string, any>; sideIds: Set<string> }>({ origs: {}, sideIds: new Set() });
  const hydrated = useRef(false);
  const origsFor = (ops: SyncOp[], base: any) => Object.fromEntries(ops.filter(o => (o.kind === "upsert" || o.kind === "delete") && o.coll && o.coll !== "logs")
    .map(o => [`${o.coll}:${o.rid}`, pulled.current.get(`${o.coll}:${o.rid}`)?.data ?? (base?.[o.coll!] || []).find((x: any) => x.id === o.rid) ?? null]));
  const blocked = useRef(false);
  const pulled = useRef<PullInfo>(new Map());
  const setSaveState = (st: SaveState, msg = "") => {
    setSaveStateRaw(st); setSyncError(msg);
    setSyncStatus(st === "saved" ? "connected" : st === "saving" || st === "unsaved" ? "syncing" : "error");
  };
  const pendingOps = () => (dbRef.current && baseRef.current ? computeOps(baseRef.current, dbRef.current, revs.current, vrevs.current, pulled.current) : []);
  const adopt = useCallback((remote: RemoteState) => {
    const next = migrateDB(remote.data || seedDB());
    baseRef.current = next; dbRef.current = next;
    revs.current = remote.revs || {}; vrevs.current = remote.vrevs || {}; version.current = remote.version;
    setDb(next);
    return next;
  }, []);
  const saveUnsaved = (v: any) => { try { v ? localStorage.setItem(UNSAVED_KEY, JSON.stringify(v)) : localStorage.removeItem(UNSAVED_KEY); } catch {} };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const pull = useCallback(async () => {
    const ch = await fetchChanges(version.current);
    if (!ch.records.length && !ch.values.length) { version.current = ch.version; return; }
    const r = applyChanges(baseRef.current, dbRef.current, revs.current, vrevs.current, ch, pulled.current);
    baseRef.current = r.base; dbRef.current = r.local; version.current = ch.version;
    setDb(r.local);
  }, []);

  const schedule = (ms: number) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; flushRef.current(); }, ms);
  };
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const flushSave = useCallback(async (): Promise<void> => {
    if (saving.current || blocked.current || !baseRef.current) return;
    if (!inflight.current) {
      const ops = pendingOps();
      if (!ops.length) { setSaveState("saved"); return; }
      const origs = origsFor(ops, baseRef.current);
      inflight.current = { opId: crypto.randomUUID(), ops, snapshot: dbRef.current!, origs };
      saveUnsaved({ opId: inflight.current.opId, ops, origs });
    }
    saving.current = true;
    setSaveState("saving");
    const { opId, ops, snapshot } = inflight.current;
    const res = await commitOps(opId, ops);
    saving.current = false;
    if (res.status === "ok") {
      res.revs.forEach(r => { if (r.key) vrevs.current[r.key] = r.rev; else if (r.coll && r.rid) (revs.current[r.coll] = revs.current[r.coll] || {})[r.rid] = r.rev; });
      ops.forEach(o => { if (o.kind === "delete" && o.coll && o.rid) delete revs.current[o.coll]?.[o.rid]; if (o.coll && o.rid && o.kind !== "inc") pulled.current.delete(`${o.coll}:${o.rid}`); });
      baseRef.current = snapshot;
      inflight.current = null;
      saveUnsaved(null);
      try { await pull(); } catch { version.current = Math.max(version.current, res.version); }
      if (pendingOps().length) { setSaveState("unsaved"); schedule(400); } else setSaveState("saved");
      return;
    }
    if (res.status === "conflict") {
      const batchOrigs = inflight.current?.origs || {};
      inflight.current = null;
      saveUnsaved({ opId: crypto.randomUUID(), ops, origs: batchOrigs });
      rejected.current = { origs: batchOrigs, sideIds: new Set(ops.filter(o => o.kind === "upsert" && o.baseRev == null && (o.coll === "logs" || o.coll === "grnAudit")).map(o => `${o.coll}:${o.rid}`)) };
      try { await pull(); } catch {}
      if (res.duplicates.length && !res.conflicts.length) {
        const { db: fixed, map } = renumber(dbRef.current, res.duplicates);
        const baseLogs = new Set((baseRef.current!.logs || []).map(l => l.id));
        const fix = (t: string) => map.reduce((a, [o, n]) => a.split(o).join(n), t);
        fixed.logs = fixed.logs.map((l: ActivityLog) => baseLogs.has(l.id) ? l : { ...l, action: fix(l.action) });
        const baseAudit = new Set(((baseRef.current as any).grnAudit || []).map((a: any) => a.id));
        if (fixed.grnAudit) fixed.grnAudit = fixed.grnAudit.map((a: any) => baseAudit.has(a.id) ? a : { ...a, grnNumber: fix(String(a.grnNumber || "")) });
        dbRef.current = fixed; setDb(fixed);
        schedule(100);
        return;
      }
      const b: any = baseRef.current, l: any = dbRef.current;
      setConflicts(res.conflicts.map((c: any) => {
        const mine = c.key ? (c.key.startsWith("settings.") ? l.settings?.[c.key.slice(9)] : l[c.key]) : (l[c.coll] || []).find((x: any) => x.id === c.rid);
        const k0 = `${c.coll}:${c.rid}`;
        const orig = c.key ? (c.key.startsWith("settings.") ? b.settings?.[c.key.slice(9)] : b[c.key]) : (k0 in batchOrigs ? batchOrigs[k0] : (pulled.current.get(k0)?.data ?? (b[c.coll] || []).find((x: any) => x.id === c.rid)));
        const eq = (x: any, y: any) => JSON.stringify(x) === JSON.stringify(y);
        const fields = mine && typeof mine === "object" && !Array.isArray(mine)
          ? [...new Set([...Object.keys(mine), ...Object.keys(c.theirs || {})])].filter(k => !(c.coll === "items" && k === "currentStock") && (!eq(mine[k], orig?.[k]) || !eq(c.theirs?.[k], orig?.[k])))
              .map(k => ({ field: k, base: orig?.[k], mine: mine[k], theirs: c.theirs?.[k], mineChanged: !eq(mine[k], orig?.[k]) }))
          : [{ field: c.key || "value", base: orig, mine, theirs: c.theirs }];
        return { ...c, mine, label: c.key || `${c.coll} · ${mine?.number || mine?.name || orig?.number || orig?.name || c.rid}`, fields };
      }));
      blocked.current = true;
      setSaveState("conflict", "Another user changed the same record. Review and choose how to continue.");
      return;
    }
    if (res.status === "expired") { blocked.current = true; setSaveState("expired", "Session expired — your changes are NOT saved yet (kept in this browser). Log in again to save them."); return; }
    if (res.status === "outdated") { blocked.current = true; setSaveState("failed", "The ERP was updated. Reload the page — your unsaved changes are kept in this browser."); return; }
    setSaveState("failed", `${res.message}. Your changes are kept and will be retried.`);
    schedule(5000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  flushRef.current = flushSave;

  const resolveConflicts = useCallback((mode: "reload" | "reapply") => {
    const b: any = { ...baseRef.current, settings: { ...baseRef.current!.settings } }, l: any = { ...dbRef.current, settings: { ...dbRef.current!.settings } };
    conflicts.forEach(c => {
      if (c.key) {
        const sub = c.key.startsWith("settings.") ? c.key.slice(9) : null;
        if (sub) { b.settings[sub] = c.theirs; if (mode === "reload") l.settings[sub] = c.theirs; } else { b[c.key] = c.theirs; if (mode === "reload") l[c.key] = c.theirs; }
        vrevs.current[c.key] = c.rev ?? 0;
        return;
      }
      const coll = c.coll!;
      const put = (list: any[], rec: any) => rec ? (list.some(x => x.id === c.rid) ? list.map(x => x.id === c.rid ? rec : x) : [rec, ...list]) : list.filter(x => x.id !== c.rid);
      b[coll] = put(b[coll] || [], c.theirs);
      const mineChanges = Object.fromEntries(c.fields.filter((f: any) => f.mineChanged !== false).map(f => [f.field, f.mine]));
      l[coll] = put(l[coll] || [], mode === "reload" ? c.theirs : (c.theirs ? { ...c.theirs, ...mineChanges } : c.mine));
      if (c.rev != null && c.theirs) (revs.current[coll] = revs.current[coll] || {})[c.rid!] = c.rev; else delete revs.current[coll]?.[c.rid!];
    });
    if (mode === "reload") {
      // Drop activity-log / audit lines that described the discarded changes.
      const side = rejected.current.sideIds;
      l.logs = (l.logs || []).filter((x: any) => !side.has(`logs:${x.id}`));
      if (l.grnAudit) l.grnAudit = l.grnAudit.filter((x: any) => !side.has(`grnAudit:${x.id}`));
    }
    conflicts.forEach(c => { if (c.coll && c.rid) pulled.current.delete(`${c.coll}:${c.rid}`); });
    baseRef.current = b; dbRef.current = l; setDb(l);
    setConflicts([]); blocked.current = false;
    saveUnsaved(null);
    schedule(50);
  }, [conflicts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hydrate from backend on mount; replays any unsaved batch left from a previous session (same one-time key).
  const [hydrating, setHydrating] = useState<boolean>(() => !!getToken());
  const hydrateFromServer = useCallback(async () => {
    const remote = await fetchState();
    const next = adopt(remote);
    writeCachedSettings(next.settings);
    let saved: any = null;
    try { saved = JSON.parse(localStorage.getItem(UNSAVED_KEY) || "null"); } catch {}
    if (saved?.opId && saved?.ops?.length && await isApplied(saved.opId).catch(() => false)) { saveUnsaved(null); saved = null; }
    if (saved?.ops?.length) {
      const withMine = applyOpsLocally(next, saved.ops) as DB;
      dbRef.current = withMine; setDb(withMine);
      inflight.current = { opId: saved.opId, ops: saved.ops, snapshot: withMine, origs: saved.origs || {} };
      setSaveState("unsaved", "Re-sending changes that were not saved last time…");
      setTimeout(async () => { await flushRef.current(); try { await pull(); } catch {} }, 0);
    } else setSaveState("saved");
    return next;
  }, [adopt, pull]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // hydrated ref makes this run once (StrictMode double effect); no cancel flag, or the only run would be discarded.
    const cancelled = false;
    (async () => {
      if (hydrated.current) return;
      hydrated.current = true;
      if (!getToken()) { setSyncStatus("not-configured"); setHydrating(false); return; }
      setSyncStatus("syncing");
      try {
        const next = await hydrateFromServer();
        if (cancelled) return;
        const sessionId = localStorage.getItem(SESSION_KEY);
        if (sessionId) {
          const restored = next.users.find(u => u.id === sessionId) || null;
          setCurrentUser(restored);
          if (!restored) localStorage.removeItem(SESSION_KEY);
        }
      } catch (err: any) {
        if (cancelled) return;
        setSaveState("failed", err?.message || "Load failed");
        if (err?.message === "Unauthorized") { setToken(null); localStorage.removeItem(SESSION_KEY); setCurrentUser(null); }
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pull other users' committed changes every 10s (incremental; never overwrites this tab's unsaved edits).
  useEffect(() => {
    if (!currentUser) return;
    const int = setInterval(async () => {
      if (!getToken() || saving.current || blocked.current) return;
      try { if ((await fetchRemoteVersion()) !== version.current) await pull(); } catch {}
    }, 10000);
    return () => clearInterval(int);
  }, [currentUser, pull]);

  const persistRemote = useCallback((next: DB) => {
    dbRef.current = next;
    if (!blocked.current) { setSaveState("unsaved"); schedule(400); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const keep = (e: BeforeUnloadEvent) => {
      if (inflight.current || pendingOps().length) {
        if (!inflight.current) { const ops = pendingOps(); saveUnsaved({ opId: crypto.randomUUID(), ops, origs: origsFor(ops, baseRef.current) }); }
        flushRef.current();
        e.preventDefault(); e.returnValue = "";
      }
    };
    const onVis = () => { if (document.visibilityState === "hidden" && pendingOps().length) flushRef.current(); };
    window.addEventListener("beforeunload", keep);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("beforeunload", keep); document.removeEventListener("visibilitychange", onVis); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setDB = useCallback((updater: (db: DB) => DB) => {
    setDb(prev => {
      const next = updater(prev);
      persistRemote(next);
      return next;
    });
  }, [persistRemote]);

  const syncNow = useCallback(async () => {
    if (saveState === "expired") return;
    blocked.current = false;
    await flushRef.current();
    try { await pull(); } catch {}
  }, [pull, saveState]);

  const log = useCallback((action: string, module: string) => {
    if (!currentUser) return;
    const entry: ActivityLog = { id: crypto.randomUUID(), userId: currentUser.id, action, module, timestamp: new Date().toISOString() };
    setDb(prev => {
      const next = { ...prev, logs: [entry, ...prev.logs].slice(0, 500) };
      persistRemote(next);
      return next;
    });
  }, [currentUser, persistRemote]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await apiLogin(username, password);
      setSyncStatus("syncing");
      // Unsaved work of an expired session stays in this browser and is re-sent (with conflict checks) after login.
      if (inflight.current) saveUnsaved({ opId: inflight.current.opId, ops: inflight.current.ops, origs: inflight.current.origs });
      else if (pendingOps().length) { const ops = pendingOps(); saveUnsaved({ opId: crypto.randomUUID(), ops, origs: origsFor(ops, baseRef.current) }); }
      inflight.current = null; blocked.current = false;
      const next = await hydrateFromServer();
      const user = next.users.find(u => u.id === res.user.id) || res.user;
      setCurrentUser(user);
      localStorage.setItem(SESSION_KEY, user.id);
      const entry: ActivityLog = { id: crypto.randomUUID(), userId: user.id, action: "Logged in", module: "Auth", timestamp: new Date().toISOString() };
      setDb(prev => { const withLog = { ...prev, logs: [entry, ...prev.logs].slice(0, 500) }; persistRemote(withLog); return withLog; });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, msg: err?.message || "Login failed" };
    }
  }, [persistRemote, hydrateFromServer]); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = useCallback(async () => {
    if (currentUser && saveState !== "expired") {
      const entry: ActivityLog = { id: crypto.randomUUID(), userId: currentUser.id, action: "Logged out", module: "Auth", timestamp: new Date().toISOString() };
      const cur = dbRef.current || db;
      dbRef.current = { ...cur, logs: [entry, ...cur.logs].slice(0, 500) };
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      await flushRef.current();
    }
    setCurrentUser(null);
    setToken(null);
    localStorage.removeItem(SESSION_KEY);
    setSyncStatus("not-configured");
  }, [currentUser, db, saveState]);

  const changePassword = useCallback((oldPwd: string, newPwd: string) => {
    if (!currentUser) return { ok: false, msg: "Not logged in" };
    if (currentUser.password !== oldPwd) return { ok: false, msg: "Old password is incorrect" };
    setDB(prev => ({
      ...prev,
      users: prev.users.map(u => u.id === currentUser.id ? { ...u, password: newPwd } : u),
    }));
    setCurrentUser({ ...currentUser, password: newPwd });
    return { ok: true };
  }, [currentUser, setDB]);

  const toggleTheme = () => setTheme(t => t === "light" ? "dark" : "light");

  return (
    <StoreCtx.Provider value={{ db, setDB, currentUser, hydrating, login, logout, changePassword, log, syncStatus, syncError, syncNow, saveState, conflicts, resolveConflicts, theme, toggleTheme }}>
      {children}
    </StoreCtx.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore must be inside StoreProvider");
  return ctx;
}

export function uid() { return crypto.randomUUID(); }
