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

/** Names of the missing variables (never their values). */
export function missingHostedEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return HOSTED_ENV.filter((name) => !env[name]);
}

/** The Turso client (HTTP only: no native module, so it bundles for the Pi). */
export function tursoFromEnv(env: NodeJS.ProcessEnv = process.env): DocClient | null {
  const url = env.TURSO_DATABASE_URL;
  const authToken = env.TURSO_AUTH_TOKEN;
  return url && authToken ? new TursoDocClient(createClient({ url, authToken })) : null;
}

export function r2FromEnv(env: NodeJS.ProcessEnv = process.env): BlobStore | null {
  const options = r2OptionsFromEnv(env);
  return options ? new R2BlobStore(options) : null;
}
