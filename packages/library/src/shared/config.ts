import { z } from "zod";

/** An origin such as `http://127.0.0.1:5173` (scheme + host + optional port, nothing else). */
const OriginSchema = z
  .string()
  .regex(/^https?:\/\/[^/\s?#]+$/, "must be an origin like http://127.0.0.1:5173 (no path)");

export const KoboConfigSchema = z.object({
  /** SSH destination `user@host` (or a Host alias of ~/.ssh/config). Env `ELIB_KOBO_HOST` overrides it. */
  host: z.string().regex(/^[\w.@:-]+$/, "must be an SSH destination like root@192.168.1.11"),
  port: z.number().int().min(1).max(65535),
  /** Private key; `~` is expanded by the Node loader. Never inside the repo. */
  identityFile: z.string().min(1),
  /**
   * Optional name the host key is checked under (ssh `HostKeyAlias`): keeps `StrictHostKeyChecking` working when the
   * Kobo gets a new DHCP address.
   */
  hostKeyAlias: z
    .string()
    .regex(/^[\w.:[\]-]+$/)
    .optional(),
  /** Absolute folder on the Kobo holding the KEPUBs and their KOReader `.sdr` sidecar folders (flat). */
  booksDir: z
    .string()
    .regex(/^\/(?:[^/\s'][^/']*\/?)+$/, 'must be an absolute path like "/mnt/onboard/books"')
    .refine((s) => !s.split("/").some((seg) => seg === ".." || seg === "."), "no . or .. segments"),
});
export type KoboConfig = z.infer<typeof KoboConfigSchema>;

/** Shape of `elib.config.json` (versioned, no secrets: the SSH key stays in ~/.ssh). */
export const ElibConfigSchema = z.object({
  kobo: KoboConfigSchema,
  cache: z.object({
    /** Local cache outside the repo; `~` is expanded by the Node loader. */
    dir: z.string().min(1),
  }),
  server: z.object({
    /** Local Hono server, always bound to 127.0.0.1. */
    port: z.number().int().min(1).max(65535),
    /** UI origins allowed to call the local API (Origin header check). */
    allowedOrigins: z.array(OriginSchema).min(1),
  }),
  site: z.object({
    /** Base path of the public site and of the router, with leading and trailing slash. */
    basePath: z
      .string()
      .regex(/^\/(?:[^/\s]+\/)*$/, 'must start and end with "/", e.g. "/e-library/"'),
  }),
});
export type ElibConfig = z.infer<typeof ElibConfigSchema>;
