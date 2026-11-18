/**
 * Who is asking. The hosted API runs every request inside `runAsUser(userId, …)`; the storage layer reads the user from
 * here on every operation, so a route cannot forget to scope a query: with no user in scope the hosted backend throws
 * instead of touching data. Local use (CLI on files, tests with a temp dir) never sets a user and is unaffected.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface Scope {
  id: string;
  email: string | null;
}
const storage = new AsyncLocalStorage<Scope>();

/** Google `sub` (digits) or the placeholder of a user not yet seen (`email:<address>`, see users.ts). */
const USER_ID = /^[A-Za-z0-9_.:@+-]{1,254}$/;

/**
 * The reserved user that owns the public demo (demo/seed). It is not a Google account: nobody can log in as `demo`
 * (the login refuses it, session tokens for it are never accepted); anonymous GETs of a few read routes are served as it.
 */
export const DEMO_USER_ID = "demo";

export class NoUserError extends Error {
  constructor() {
    super("nessun utente nel contesto della richiesta");
    this.name = "NoUserError";
  }
}

export function assertUserId(userId: string): string {
  if (!USER_ID.test(userId) || userId === "." || userId === "..") throw new Error("user id non valido");
  return userId;
}

/** Runs `fn` (and everything it awaits) as `userId`. `email` is only for rules like «is this the owner». */
export function runAsUser<T>(userId: string, fn: () => T, options: { email?: string } = {}): T {
  return storage.run({ id: assertUserId(userId), email: options.email?.toLowerCase() ?? null }, fn);
}

/** The email of the user of the current request, if known. */
export function currentUserEmail(): string | null {
  return storage.getStore()?.email ?? null;
}

/** The user of the current request, or null outside any (local use). */
export function currentUserId(): string | null {
  return storage.getStore()?.id ?? null;
}

/** The user of the current request; throws `NoUserError` outside any. */
export function requireUserId(): string {
  const id = storage.getStore()?.id;
  if (!id) throw new NoUserError();
  return id;
}

/**
 * `base` for local use; `<base>/users/<id>` inside a user's request. The Pi's disk caches (EPUB, KEPUB, text, audio,
 * transcripts) go through this, so users never share a file. Ids that are not plain `[A-Za-z0-9_-]` never reach a disk.
 */
export function userScopedDir(base: string): string {
  const id = currentUserId();
  if (id === null) return base;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("user id senza cartella su disco");
  return `${base.replace(/\/+$/, "")}/users/${id}`;
}
