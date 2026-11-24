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
  /** Google OAuth client id (the same one the site uses with Google Identity Services). */
  GOOGLE_CLIENT_ID: z.string().optional(),
  /** Signs the session tokens: at least 32 random characters. */
  SESSION_SECRET: z.string().min(32).optional(),
  /** Optional allowlist, comma separated. Empty (default): any verified Google account may log in. */
  ALLOWED_EMAILS: List,
  /** Email of the one user who owns the Kobo (host/port/SSH key are the owner's). Empty: nobody has the Kobo. */
  KOBO_OWNER_EMAIL: z.string().default("").transform((v) => v.trim().toLowerCase()),
  /** Folder that holds the four data dirs, used as mount roots (default: the packages' own default paths). */
  EHUB_DATA_ROOT: z.string().default(""),
  /**
   * `pnpm dev` on the laptop: this email's user (an existing one, in the real database) can get a session without
   * Google through `POST /auth/dev`. Refused unless HOST is loopback. Never set it on the Pi.
   */
  API_DEV_OWNER_EMAIL: z.string().default("").transform((v) => v.trim().toLowerCase()),
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
