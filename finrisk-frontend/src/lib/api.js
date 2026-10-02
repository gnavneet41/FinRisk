// All backend calls. The JWT is kept in localStorage and sent as a
// Bearer token. /api is proxied to the backend by Vite in development.

const TOKEN_KEY = "finrisk_token";

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
    this.code = body?.code;
  }
}

export async function request(path, { method = "GET", body, form, raw = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(path, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch {
    throw new ApiError("Cannot reach the FinRisk server. Check that the backend is running.", 0);
  }

  if (raw && res.ok) return res;
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }

  if (res.status === 401 && path !== "/api/auth/login") onUnauthorized();
  if (!res.ok || data?.success === false) {
    throw new ApiError(data?.message || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: "POST", body: body ?? {} }),
  put: (p, body) => request(p, { method: "PUT", body }),
  patch: (p, body) => request(p, { method: "PATCH", body }),
  del: (p) => request(p, { method: "DELETE" }),
  upload: (p, form) => request(p, { method: "POST", form })
};

/** Downloads (or opens) a protected file such as a PDF report. */
export async function downloadFile(path, filename, { open = false } = {}) {
  const win = open ? window.open("", "_blank") : null;
  try {
    const res = await request(path, { raw: true });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (win) {
      win.location.href = url;
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}
