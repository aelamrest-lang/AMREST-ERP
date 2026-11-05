import type { DB } from "./types";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const TOKEN_KEY = "amrest_erp_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path: string, opts: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (res.status === 401) {
    setToken(null);
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.detail || j.message || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function apiLogin(username: string, password: string): Promise<{ token: string; user: any }> {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    let msg = "Login failed";
    try {
      const j = await res.json();
      msg = j.detail || msg;
    } catch {}
    throw new Error(msg);
  }
  const data = await res.json();
  setToken(data.token);
  return data;
}

export async function fetchRemoteDB(): Promise<DB | null> {
  const res = await request("/erp/state");
  return (res?.data as DB) || null;
}

export async function saveRemoteDB(dbState: DB): Promise<void> {
  await request("/erp/state", {
    method: "PUT",
    body: JSON.stringify({ data: dbState }),
  });
}

export class ConflictError extends Error {}

// Sends only the changed top-level collections; server rejects (409) if someone else saved since baseVersion.
export async function patchRemoteDB(baseVersion: number, changes: Partial<DB>): Promise<number> {
  const token = getToken();
  const res = await fetch(`${API}/erp/state`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ baseVersion, changes }),
  });
  if (res.status === 409) throw new ConflictError("conflict");
  if (res.status === 401) { setToken(null); throw new Error("Unauthorized"); }
  if (!res.ok) { let msg = `HTTP ${res.status}`; try { const j = await res.json(); msg = j.detail?.message || j.detail || msg; } catch {} throw new Error(msg); }
  return (await res.json()).version;
}

export function patchRemoteDBFinal(baseVersion: number, changes: Partial<DB>): void {
  const token = getToken();
  const body = JSON.stringify({ baseVersion, changes });
  fetch(`${API}/erp/state`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
    keepalive: body.length < 60000,
  }).catch(() => {});
}

export async function fetchRemoteState(): Promise<{ data: DB | null; version: number }> {
  const res = await request("/erp/state");
  return { data: (res?.data as DB) || null, version: res?.version ?? 0 };
}

export async function fetchRemoteVersion(): Promise<number> {
  const res = await request("/erp/version");
  return res?.version ?? 0;
}
