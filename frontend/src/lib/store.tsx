import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { legacyDispatch } from "./invoice";
import type { DB, User, ActivityLog } from "./types";
import { defaultDocumentFormats, seedDB } from "./seed";
import { defaultPermissionsForRole, normalizePermissions } from "./permissions";
import { apiLogin, fetchRemoteState, patchRemoteDB, patchRemoteDBFinal, fetchRemoteVersion, getToken, setToken, ConflictError } from "./api";
import { changedKeys, merge3, renumberCollisions } from "./merge";

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
  logout: () => void;
  changePassword: (oldPwd: string, newPwd: string) => { ok: boolean; msg?: string };
  log: (action: string, module: string) => void;
  syncStatus: "syncing" | "connected" | "error" | "not-configured";
  syncError: string;
  syncNow: () => Promise<void>;
  theme: "light" | "dark";
  toggleTheme: () => void;
}

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
  const saveTimer = useRef<any>(null);
  const saving = useRef(false);
  const localVersion = useRef<number>(0);
  const baseRef = useRef<DB | null>(null);
  const dbRef = useRef<DB | null>(null);
  const hasLocalChanges = () => !!dbRef.current && Object.keys(changedKeys(baseRef.current, dbRef.current)).length > 0;
  const adopt = useCallback((data: DB | null, version: number) => {
    const next = migrateDB(data || seedDB());
    baseRef.current = next;
    dbRef.current = next;
    localVersion.current = version;
    setDb(next);
    return next;
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Hydrate from backend on mount. If a valid JWT token exists in localStorage
  // and the stored session ID matches a user, restore the session automatically.
  // Session is only cleared on explicit Logout or if the token is rejected.
  const [hydrating, setHydrating] = useState<boolean>(() => !!getToken());
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      if (!getToken()) {
        setSyncStatus("not-configured");
        setHydrating(false);
        return;
      }
      setSyncStatus("syncing");
      try {
        const remote = await fetchRemoteState();
        if (cancelled) return;
        const next = adopt(remote.data, remote.version);
        writeCachedSettings(next.settings);
        setSyncStatus("connected");
        setSyncError("");
        const sessionId = localStorage.getItem(SESSION_KEY);
        if (sessionId) {
          const restored = next.users.find(u => u.id === sessionId) || null;
          setCurrentUser(restored);
          if (!restored) localStorage.removeItem(SESSION_KEY);
        }
      } catch (err: any) {
        if (cancelled) return;
        setSyncStatus("error");
        setSyncError(err?.message || "Load failed");
        // Only clear session if the server explicitly rejected the token
        if (err?.message === "Unauthorized") {
          setToken(null);
          localStorage.removeItem(SESSION_KEY);
          setCurrentUser(null);
        }
      } finally {
        if (!cancelled) setHydrating(false);
      }
    }
    hydrate();
    return () => { cancelled = true; };
  }, []);

  // Poll for external changes every 15s (only adopt remote when this tab has nothing unsaved)
  useEffect(() => {
    if (!currentUser) return;
    const int = setInterval(async () => {
      if (!getToken() || saving.current || saveTimer.current || hasLocalChanges()) return;
      try {
        const v = await fetchRemoteVersion();
        if (v !== localVersion.current) {
          const remote = await fetchRemoteState();
          if (!saving.current && !saveTimer.current && !hasLocalChanges()) adopt(remote.data, remote.version);
        }
      } catch {}
    }, 15000);
    return () => clearInterval(int);
  }, [currentUser, adopt]);

  const mergeOnto = (remoteDb: DB): DB => {
    const raw = merge3(baseRef.current, dbRef.current, remoteDb) as DB;
    const { db: merged } = renumberCollisions(raw, baseRef.current, dbRef.current);
    merged.logs = [...merged.logs].sort((a: ActivityLog, b: ActivityLog) => b.timestamp.localeCompare(a.timestamp)).slice(0, 500);
    return merged;
  };

  const flushSave = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    setSyncStatus("syncing");
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        const local = dbRef.current!;
        const changes = changedKeys(baseRef.current, local);
        if (!Object.keys(changes).length) break;
        try {
          localVersion.current = await patchRemoteDB(localVersion.current, changes);
          baseRef.current = local;
        } catch (err) {
          if (!(err instanceof ConflictError)) throw err;
          // Someone else saved first: merge their records with ours, then retry.
          const remote = await fetchRemoteState();
          const remoteDb = migrateDB(remote.data || seedDB());
          const merged = mergeOnto(remoteDb);
          baseRef.current = remoteDb;
          localVersion.current = remote.version;
          dbRef.current = merged;
          setDb(merged);
        }
      }
      if (hasLocalChanges()) throw new Error("Could not save — other users are saving at the same time. Retrying…");
      setSyncStatus("connected");
      setSyncError("");
    } catch (err: any) {
      setSyncStatus("error");
      setSyncError(err?.message === "Unauthorized" ? "Session expired — your changes are NOT saved yet. Log in again to save them." : (err?.message || "Save failed"));
    } finally {
      saving.current = false;
    }
    if (hasLocalChanges() && getToken() && !saveTimer.current) saveTimer.current = setTimeout(() => { saveTimer.current = null; flushSave(); }, 3000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const persistRemote = useCallback((next: DB) => {
    dbRef.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; flushSave(); }, 400);
  }, [flushSave]);

  useEffect(() => {
    const flush = () => {
      if (!dbRef.current || saving.current) return;
      const changes = changedKeys(baseRef.current, dbRef.current);
      if (!Object.keys(changes).length) return;
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      patchRemoteDBFinal(localVersion.current, changes);
    };
    const onVis = () => { if (document.visibilityState === "hidden" && dbRef.current && Object.keys(changedKeys(baseRef.current, dbRef.current)).length) { if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; } flushSave(); } };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const setDB = useCallback((updater: (db: DB) => DB) => {
    setDb(prev => {
      const next = updater(prev);
      persistRemote(next);
      return next;
    });
  }, [persistRemote]);

  const syncNow = useCallback(async () => {
    setSyncStatus("syncing");
    try {
      if (hasLocalChanges()) await flushSave();
      if (hasLocalChanges()) return;
      const remote = await fetchRemoteState();
      adopt(remote.data, remote.version);
      setSyncStatus("connected");
      setSyncError("");
    } catch (err: any) {
      setSyncStatus("error");
      setSyncError(err?.message || "Sync failed");
    }
  }, [db]);

  const log = useCallback((action: string, module: string) => {
    if (!currentUser) return;
    const entry: ActivityLog = {
      id: crypto.randomUUID(),
      userId: currentUser.id,
      action, module,
      timestamp: new Date().toISOString(),
    };
    setDb(prev => {
      const next = { ...prev, logs: [entry, ...prev.logs].slice(0, 500) };
      persistRemote(next);
      return next;
    });
  }, [currentUser, persistRemote]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await apiLogin(username, password);
      // After login, hydrate state
      setSyncStatus("syncing");
      const remote = await fetchRemoteState();
      let next: DB;
      if (hasLocalChanges()) {
        // Unsaved work from an expired session: merge it onto the latest server data instead of discarding it.
        const remoteDb = migrateDB(remote.data || seedDB());
        next = mergeOnto(remoteDb);
        baseRef.current = remoteDb;
        localVersion.current = remote.version;
        dbRef.current = next;
        setDb(next);
      } else next = adopt(remote.data, remote.version);
      const user = next.users.find(u => u.id === res.user.id) || res.user;
      writeCachedSettings(next.settings);
      setCurrentUser(user);
      localStorage.setItem(SESSION_KEY, user.id);
      const entry: ActivityLog = { id: crypto.randomUUID(), userId: user.id, action: "Logged in", module: "Auth", timestamp: new Date().toISOString() };
      const withLog = { ...next, logs: [entry, ...next.logs].slice(0, 500) };
      setDb(withLog);
      persistRemote(withLog);
      setSyncStatus("connected");
      return { ok: true };
    } catch (err: any) {
      return { ok: false, msg: err?.message || "Login failed" };
    }
  }, [persistRemote]);

  const logout = useCallback(() => {
    if (currentUser) {
      const entry: ActivityLog = { id: crypto.randomUUID(), userId: currentUser.id, action: "Logged out", module: "Auth", timestamp: new Date().toISOString() };
      const cur = dbRef.current || db;
      const next = { ...cur, logs: [entry, ...cur.logs].slice(0, 500) };
      dbRef.current = next;
      setDb(next);
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      patchRemoteDBFinal(localVersion.current, changedKeys(baseRef.current, next));
    }
    setCurrentUser(null);
    setToken(null);
    localStorage.removeItem(SESSION_KEY);
    setSyncStatus("not-configured");
  }, [currentUser, db]);

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
    <StoreCtx.Provider value={{ db, setDB, currentUser, hydrating, login, logout, changePassword, log, syncStatus, syncError, syncNow, theme, toggleTheme }}>
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
