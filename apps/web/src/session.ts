/**
 * Login of the hosted site. The API runs the Google login and sends the browser back with a session token in the URL
 * fragment (`#token=...`); we keep it in localStorage and attach it to the calls to the API. Admin controls show up
 * only with a valid session: logging in and out reload the page, so the flag is read once at startup
 * (`globalThis.__EHUB_ADMIN__`, which vite.config.ts wires to the admin gates).
 */

export const HOSTED = import.meta.env.VITE_HOSTED === "1";
/** Origin of the API (the Pi, behind its tunnel). Empty = same origin (local dev with the Vite proxy). */
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/+$/, "");

const KEY = "ehub.session";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Session {
  token: string;
  email: string;
  /** Seconds since the epoch. */
  exp: number;
}

function decodePayload(token: string): { email?: unknown; exp?: unknown } | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0)))) as {
      email?: unknown;
      exp?: unknown;
    };
  } catch {
    return null;
  }
}

/** The session a token stands for; null when it is malformed or expired. The API still checks the signature. */
export function sessionFromToken(token: string, nowMs = Date.now()): Session | null {
  const payload = decodePayload(token);
  if (!payload || typeof payload.email !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp * 1000 <= nowMs) return null;
  return { token, email: payload.email, exp: payload.exp };
}

export function loadSession(storage: StorageLike, nowMs = Date.now()): Session | null {
  try {
    const token = storage.getItem(KEY);
    if (!token) return null;
    const session = sessionFromToken(token, nowMs);
    if (!session) storage.removeItem(KEY);
    return session;
  } catch {
    return null;
  }
}

export function clearSession(storage: StorageLike): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* storage blocked: nothing to clear */
  }
}

/** Takes `#token=...` from the URL (after the Google login) into storage. Returns the URL without the fragment, or null. */
export function takeTokenFromUrl(href: string, storage: StorageLike, nowMs = Date.now()): string | null {
  const url = new URL(href);
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  if (!token) return null;
  if (sessionFromToken(token, nowMs)) {
    try {
      storage.setItem(KEY, token);
    } catch {
      /* storage blocked: the session lasts until the next page load only */
    }
  }
  url.hash = "";
  return `${url.pathname}${url.search}`;
}

/** Where the "Accedi" button goes: the API starts the Google login and returns to `returnTo`. */
export function loginUrl(apiUrl: string, returnTo: string): string {
  return `${apiUrl}/auth/google?return=${encodeURIComponent(returnTo)}`;
}

/**
 * `fetch` that sends `/api/...` calls to the API origin and adds the session token. Other URLs pass through untouched,
 * so the token never leaves for another host.
 */
export function apiFetch(
  base: string,
  getToken: () => string | null,
  inner: typeof fetch,
  onUnauthorized: () => void = () => {},
): typeof fetch {
  return async (input, init) => {
    if (typeof input !== "string" || !/^\/(api|auth)\//.test(input)) return inner(input, init);
    const headers = new Headers(init?.headers);
    const token = getToken();
    if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
    const response = await inner(`${base}${input}`, { ...init, headers });
    if (response.status === 401 && token) onUnauthorized();
    return response;
  };
}

/** Startup: takes the token from the URL, sets the admin flag and wraps `fetch`. Import this before anything else. */
export function bootSession(): Session | null {
  if (!HOSTED) return null;
  const storage = window.localStorage;
  const clean = takeTokenFromUrl(window.location.href, storage);
  if (clean !== null) window.history.replaceState(null, "", clean);
  const session = loadSession(storage);
  (globalThis as { __EHUB_ADMIN__?: boolean }).__EHUB_ADMIN__ = session !== null;
  window.fetch = apiFetch(API_URL, () => loadSession(storage)?.token ?? null, window.fetch.bind(window), () => {
    clearSession(storage);
  });
  return session;
}

export const currentSession: Session | null = bootSession();

export function login(): void {
  window.location.assign(loginUrl(API_URL, `${window.location.origin}${import.meta.env.BASE_URL}`));
}

export function logout(): void {
  clearSession(window.localStorage);
  window.location.reload();
}
