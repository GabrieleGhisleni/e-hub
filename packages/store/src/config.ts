import { type BlobStore, R2BlobStore, r2OptionsFromEnv } from "./blobs.ts";
import { type DocClient, SupabaseDocClient } from "./docs.ts";

/** Names of the variables the hosted setup needs (the values live in `.env.local`, never in the repo). */
export const HOSTED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

/** Names of the missing variables (never their values). */
export function missingHostedEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return HOSTED_ENV.filter((name) => !env[name]);
}

export function supabaseFromEnv(env: NodeJS.ProcessEnv = process.env): DocClient | null {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey ? new SupabaseDocClient({ url, serviceRoleKey }) : null;
}

export function r2FromEnv(env: NodeJS.ProcessEnv = process.env): BlobStore | null {
  const options = r2OptionsFromEnv(env);
  return options ? new R2BlobStore(options) : null;
}
