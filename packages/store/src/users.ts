/**
 * Users (docs/hosting.md, «Utenti»). A Google login gives `sub` (stable id), email and name.
 *
 * The data migration may prepare the owner before they ever log in: their rows then belong to the placeholder user
 * `email:<address>`. At the first login with that (verified) email the placeholder is renamed to the real `sub`:
 * database rows move in `UserStore.reassign`, R2 objects are copied under the new prefix and the old ones deleted.
 */
import { type BlobStore } from "./blobs.ts";
import { type DocClient, type UserRecord } from "./docs.ts";
import { DEMO_USER_ID } from "./user-context.ts";

export const PENDING_PREFIX = "email:";

export function pendingUserId(email: string): string {
  return `${PENDING_PREFIX}${email.trim().toLowerCase()}`;
}

export class UserConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserConflictError";
  }
}

/** Copies every object of `users/<from>/` to `users/<to>/`, then deletes the old ones. Safe to repeat. */
export async function moveUserBlobs(blobs: BlobStore, from: string, to: string): Promise<number> {
  const keys = await blobs.list(`users/${from}/`);
  for (const key of keys) {
    const bytes = await blobs.get(key);
    if (bytes) await blobs.put(`users/${to}/${key.slice(`users/${from}/`.length)}`, bytes);
    await blobs.delete(key);
  }
  return keys.length;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
}

/** Creates or updates the user of a login; claims the placeholder of the same email if there is one. */
export async function loginUser(docs: DocClient, blobs: BlobStore | null, profile: GoogleProfile): Promise<UserRecord> {
  if (profile.sub === DEMO_USER_ID) throw new UserConflictError("Identità riservata.");
  const email = profile.email.trim().toLowerCase();
  const byId = await docs.users.findById(profile.sub);
  const byEmail = await docs.users.findByEmail(email);
  if (!byId && byEmail) {
    if (!byEmail.id.startsWith(PENDING_PREFIX)) {
      throw new UserConflictError("Esiste già un altro utente con questa email.");
    }
    if (blobs) await moveUserBlobs(blobs, byEmail.id, profile.sub);
    await docs.users.reassign(byEmail.id, profile.sub);
  } else if (byId && byEmail && byEmail.id !== byId.id) {
    throw new UserConflictError("Esiste già un altro utente con questa email.");
  }
  return docs.users.upsert({ id: profile.sub, email, name: profile.name });
}

/** Creates the placeholder owner for `--owner-email` (no-op when the user exists, as placeholder or real). */
export async function ensureOwner(docs: DocClient, email: string): Promise<UserRecord> {
  const normalized = email.trim().toLowerCase();
  const existing = await docs.users.findByEmail(normalized);
  if (existing) return existing;
  return docs.users.upsert({ id: pendingUserId(normalized), email: normalized, name: "" });
}
