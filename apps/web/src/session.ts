/**
 * Login of the hosted site. Google Identity Services gives the browser an ID token, the API trades it for its own
 * session token (30 days); we keep it in localStorage and attach it to the calls to the API (no cookies). Admin controls show up
 * only with a valid session: logging in and out reload the page, so the flag is read once at startup
 * (`globalThis.__EHUB_ADMIN__`, which vite.config.ts wires to the admin gates).
 */

export const HOSTED = import.meta.env.VITE_HOSTED === "1";
/** Origin of the API (the Pi, behind its tunnel). Empty = same origin (local dev with the Vite proxy). */
/** Google OAuth client id (public): the same one the API checks the ID token against. */
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";
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

/** Keeps a session token (after the login); false when it is not a valid, unexpired token. */
export function storeToken(storage: StorageLike, token: string, nowMs = Date.now()): boolean {
  if (!sessionFromToken(token, nowMs)) return false;
  try {
    storage.setItem(KEY, token);
  } catch {
    /* storage blocked: the session lasts until the next page load only */
  }
  return true;
}

/** Trades the Google ID token (from Google Identity Services) for the API's session token. */
export async function exchangeCredential(
  apiUrl: string,
  credential: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(`${apiUrl}/auth/google`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  if (response.status === 403) throw new Error("Questo account non è autorizzato.");
  if (!response.ok) throw new Error("Accesso non riuscito.");
  const body = (await response.json()) as { token?: unknown };
  if (typeof body.token !== "string") throw new Error("Accesso non riuscito.");
  return body.token;
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

/** Startup: sets the admin flag and wraps `fetch`. Import this before anything else. */
export function bootSession(): Session | null {
  if (!HOSTED) return null;
  const storage = window.localStorage;
  const session = loadSession(storage);
  (globalThis as { __EHUB_ADMIN__?: boolean }).__EHUB_ADMIN__ = session !== null;
  window.fetch = apiFetch(API_URL, () => loadSession(storage)?.token ?? null, window.fetch.bind(window), () => {
    // The session is gone (expired, or the API refused it): back to the login page.
    clearSession(storage);
    window.location.reload();
  });
  return session;
}

export const currentSession: Session | null = bootSession();

/** Called by the Google button with the ID token: exchanges it, stores the session and reloads. */
export async function completeLogin(credential: string): Promise<void> {
  const token = await exchangeCredential(API_URL, credential, window.fetch);
  if (!storeToken(window.localStorage, token)) throw new Error("Accesso non riuscito.");
  window.location.reload();
}

export function logout(): void {
  clearSession(window.localStorage);
  window.location.reload();
}
