const BASE = '/api/v1';
const TOKEN_KEY = 'newtonite.token';

// Bearer token lives in sessionStorage (cleared when the tab closes). It is readable by any script
// running on the page, so an XSS bug would expose it — see "Known limitations".
let token = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(TOKEN_KEY) : null;
let onUnauthorized = () => {};

export const getToken = () => token;
export function setToken(t) {
  token = t;
  if (typeof sessionStorage === 'undefined') return;
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else sessionStorage.removeItem(TOKEN_KEY);
}
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(status, code, message, body = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body; // full server error object (may include `current` item and `details`)
  }
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body (e.g. proxy error page) */ }
  if (!res.ok) {
    const e = data?.error ?? {};
    const err = new ApiError(res.status, e.code ?? (res.status >= 500 ? 'SERVER_ERROR' : 'UNKNOWN'), e.message ?? `Request failed (${res.status})`, e);
    if (res.status === 401 && path !== '/auth/login') onUnauthorized(err);
    throw err;
  }
  return data;
}

/** Maps any error to a short title/message and a "kind" the UI uses for styling and actions. */
export function describeError(err) {
  if (!(err instanceof ApiError)) return { kind: 'error', title: 'Something went wrong', message: err?.message ?? 'Unexpected error' };
  switch (true) {
    case err.code === 'NETWORK_ERROR':
      return { kind: 'network', title: 'Network problem', message: err.message };
    case err.status === 503 || err.code === 'SERVICE_UNAVAILABLE':
      return { kind: 'unavailable', title: 'Service unavailable', message: 'The server or database is temporarily unavailable. Please try again shortly.' };
    case err.code === 'VERSION_CONFLICT':
      return { kind: 'conflict', title: 'This item changed', message: 'Someone else updated this item. The latest version has been loaded — review it and try again.' };
    case err.code === 'ALREADY_CLAIMED':
      return { kind: 'conflict', title: 'Already claimed', message: err.message };
    case err.status === 401:
      return { kind: 'auth', title: 'Signed out', message: err.message };
    case err.status === 403:
      return { kind: 'forbidden', title: 'Not allowed', message: err.message };
    case err.status === 404:
      return { kind: 'notfound', title: 'Not found', message: 'This item does not exist or you do not have access to it.' };
    case err.status === 400 || err.status === 422:
      return { kind: 'validation', title: err.code === 'VALIDATION_ERROR' ? 'Please check the form' : 'Request rejected', message: err.message };
    default:
      return { kind: 'error', title: 'Something went wrong', message: err.message };
  }
}

export function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
