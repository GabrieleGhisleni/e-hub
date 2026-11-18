import path from "node:path";
import { z } from "zod";

const List = z
  .string()
  .default("")
  .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean));

const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  /** The tunnel (cloudflared / tailscale) connects from this machine: loopback by default. */
  HOST: z.string().default("127.0.0.1"),
  /** Origins that may call the API from a browser, comma separated (the GitHub Pages origin). */
  CORS_ORIGINS: List,
  /** Supabase Auth issuer: `https://<ref>.supabase.co/auth/v1`. */
  SUPABASE_JWT_ISSUER: z.string().url().optional(),
  /** Emails allowed to write, comma separated. */
  ALLOWED_EMAILS: List,
  /** Folder that holds the four data dirs (mount roots when hosted; real files otherwise). */
  EHUB_DATA_ROOT: z.string().default(""),
  /** `1`: no login, loopback only. For `pnpm` on the laptop; refused with a non-loopback HOST. */
  API_LOCAL_DEV: z.enum(["0", "1"]).default("0"),
});
export type ApiEnv = z.output<typeof Env>;

export function readEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configurazione non valida: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

export function dataRoots(root: string) {
  return {
    library: path.join(root, "library"),
    explore: path.join(root, "explore"),
    notes: path.join(root, "notes"),
    podcasts: path.join(root, "podcasts"),
  };
}
