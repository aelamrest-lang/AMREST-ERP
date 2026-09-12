import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import type { DB, User, ActivityLog } from "./types";
import { defaultDocumentFormats, seedDB } from "./seed";
import { defaultPermissionsForRole, normalizePermissions } from "./permissions";
import { apiLogin, fetchRemoteDB, saveRemoteDB, saveRemoteDBFinal, fetchRemoteVersion, getToken, setToken } from "./api";

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
  const existingFormats = db.settings?.documentFormats || [];
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

  return {
    ...db,
    leads: db.leads || [],
    ctCostings: db.ctCostings || [],
    materialIssues: db.materialIssues || [],
    productionEntries: db.productionEntries || [],
    sfgBatches: db.sfgBatches || [],
    sfgConsumptions: db.sfgConsumptions || [],
    operators: db.operators || [],
    serials: db.serials || [],
    qcTests: db.qcTests || [],
    qcFinalReports: db.qcFinalReports || [],
    qcFormats,
    parties, items, costings, quotations, boms, purchaseOrders,
    users,
    settings: { ...seeded.settings, ...db.settings, documentFormats: mergedDocumentFormats },
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
  const pendingSave = useRef<DB | null>(null);
  const localVersion = useRef<number>(0);

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
        const remote = await fetchRemoteDB();
        if (cancelled) return;
        const next = migrateDB(remote || seedDB());
        setDb(next);
        writeCachedSettings(next.settings);
        localVersion.current = await fetchRemoteVersion().catch(() => 0);
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

  // Poll for external changes every 15s
  useEffect(() => {
    if (!currentUser) return;
    const int = setInterval(async () => {
      if (!getToken()) return;
      try {
        const v = await fetchRemoteVersion();
        if (v > localVersion.current) {
          const remote = await fetchRemoteDB();
          if (remote) {
            const next = migrateDB(remote);
            setDb(next);
            localVersion.current = v;
          }
        }
      } catch {}
    }, 15000);
    return () => clearInterval(int);
  }, [currentUser]);

  const persistRemote = useCallback((next: DB) => {
    pendingSave.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const payload = pendingSave.current;
      if (!payload) return;
      pendingSave.current = null;
      setSyncStatus("syncing");
      try {
        await saveRemoteDB(payload);
        localVersion.current += 1;
        setSyncStatus("connected");
        setSyncError("");
      } catch (err: any) {
        setSyncStatus("error");
        setSyncError(err?.message || "Save failed");
      }
    }, 400);
  }, []);

  useEffect(() => {
    const flush = () => {
      const p = pendingSave.current;
      if (!p) return;
      pendingSave.current = null;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveRemoteDBFinal(p);
    };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
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
      const remote = await fetchRemoteDB();
      const next = migrateDB(remote || db);
      setDb(next);
      localVersion.current = await fetchRemoteVersion().catch(() => 0);
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
      const remote = await fetchRemoteDB();
      const next = migrateDB(remote || seedDB());
      const user = next.users.find(u => u.id === res.user.id) || res.user;
      setDb(next);
      writeCachedSettings(next.settings);
      localVersion.current = await fetchRemoteVersion().catch(() => 0);
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
      setDb(prev => {
        const next = { ...prev, logs: [entry, ...prev.logs].slice(0, 500) };
        persistRemote(next);
        return next;
      });
    }
    setCurrentUser(null);
    setToken(null);
    localStorage.removeItem(SESSION_KEY);
    setSyncStatus("not-configured");
  }, [currentUser, persistRemote]);

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
