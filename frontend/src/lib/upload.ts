import { getToken } from "./api";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export interface UploadedFile {
  id: string;
  path: string;
  filename: string;
  content_type: string;
  size: number;
  url: string;         // relative /api/files/{id}
  fullUrl: string;     // absolute URL usable in <img src> with ?auth= token
}

/**
 * Upload a File to the backend object storage.
 * Returns metadata including `fullUrl` you can use directly in <img src>.
 * The URL is auth-guarded via `?auth={token}` since <img> can't send headers.
 */
export async function uploadFile(file: File, category: string = "general"): Promise<UploadedFile> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API}/upload?category=${encodeURIComponent(category)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    let msg = `Upload failed (HTTP ${res.status})`;
    try {
      const j = await res.json();
      msg = j.detail || msg;
    } catch {}
    throw new Error(msg);
  }
  const data = await res.json();
  return {
    ...data,
    fullUrl: `${BACKEND_URL}${data.url}?auth=${encodeURIComponent(token)}`,
  };
}

/**
 * Build a display URL for a previously-uploaded file id (or full path).
 * Accepts either a raw `id`, a `/api/files/{id}` relative URL, an absolute URL
 * that already contains our backend host, or a data:/http(s) URL (returned as-is).
 */
export function fileDisplayUrl(idOrUrl: string | undefined | null): string {
  if (!idOrUrl) return "";
  if (idOrUrl.startsWith("data:") || idOrUrl.startsWith("blob:")) return idOrUrl;
  const token = getToken() || "";
  // Absolute URL already targeting our backend
  if (idOrUrl.startsWith("http://") || idOrUrl.startsWith("https://")) {
    if (idOrUrl.includes("/api/files/") && !idOrUrl.includes("auth=")) {
      const sep = idOrUrl.includes("?") ? "&" : "?";
      return `${idOrUrl}${sep}auth=${encodeURIComponent(token)}`;
    }
    return idOrUrl;
  }
  // Relative /api/files/{id}
  if (idOrUrl.startsWith("/api/files/")) {
    return `${BACKEND_URL}${idOrUrl}?auth=${encodeURIComponent(token)}`;
  }
  // Raw file id
  return `${BACKEND_URL}/api/files/${idOrUrl}?auth=${encodeURIComponent(token)}`;
}
