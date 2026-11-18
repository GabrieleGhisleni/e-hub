import { createClient } from "@libsql/client/web";
import { type BlobStore, R2BlobStore, r2OptionsFromEnv } from "./blobs.ts";
import { type DocClient, TursoDocClient } from "./docs.ts";

/** Names of the variables the hosted setup needs (the values live in `.env.local`, never in the repo). */
export const HOSTED_ENV = [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

/** Names of the missing variables (never their values). A `file:` database needs only the R2 ones when used with R2. */
export function missingHostedEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const local = env.TURSO_DATABASE_URL?.startsWith("file:") || env.TURSO_DATABASE_URL === ":memory:";
  return HOSTED_ENV.filter((name) => !env[name] && !(local && name === "TURSO_AUTH_TOKEN"));
}

/** The Turso client (HTTP only: no native module, so it bundles for the Pi). */
export function tursoFromEnv(env: NodeJS.ProcessEnv = process.env): DocClient | null {
  const url = env.TURSO_DATABASE_URL;
  const authToken = env.TURSO_AUTH_TOKEN;
  return url && authToken ? new TursoDocClient(createClient({ url, authToken })) : null;
}

/**
 * Local database for development: `TURSO_DATABASE_URL=file:./dev.db` (or `:memory:`). Needs no token and no network;
 * it uses the native libSQL client, loaded only here so the Pi bundle (HTTP only) never needs it.
 */
export async function localDbFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<DocClient | null> {
  const url = env.TURSO_DATABASE_URL;
  if (!url || !(url.startsWith("file:") || url === ":memory:")) return null;
  const { createClient: createLocal } = await import("@libsql/client");
  return new TursoDocClient(createLocal({ url }));
}

export function r2FromEnv(env: NodeJS.ProcessEnv = process.env): BlobStore | null {
  const options = r2OptionsFromEnv(env);
  return options ? new R2BlobStore(options) : null;
}
