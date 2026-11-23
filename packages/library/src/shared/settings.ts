/** Personal keys contract: the user's own LLM router and Groq key. The API never returns a key, only whether it is set. */
import { z } from "zod";

export const settingsPaths = { keys: "/api/library/settings/keys" } as const;

/** `null` or an empty string clears the field; a missing field is left as it is. */
/** A mirror address: http(s), no path needed (a trailing slash is dropped by the server). */
const MirrorUrl = z.url({ protocol: /^https?$/ });

const clearable = <T extends z.ZodType>(schema: T) =>
  z.union([schema, z.literal("").transform(() => null), z.null()]).optional();

export const SettingsUpdateSchema = z.object({
  baseUrl: clearable(z.url()),
  apiKey: clearable(z.string().min(1)),
  model: clearable(z.string().min(1)),
  groqApiKey: clearable(z.string().min(1)),
  zlibraryBaseUrl: clearable(MirrorUrl),
});
export type SettingsUpdate = z.input<typeof SettingsUpdateSchema>;

export const SettingsResponseSchema = z.object({
  ai: z.object({
    baseUrl: z.string().nullable(),
    model: z.string().nullable(),
    hasKey: z.boolean(),
    /** `env` only without a user (local): the `.env.local` keys are in use. */
    source: z.enum(["personal", "env"]).nullable(),
  }),
  groq: z.object({ hasKey: z.boolean(), source: z.enum(["personal", "env"]).nullable() }),
  /** `baseUrl`: the personal mirror (null = default); `defaultBaseUrl`: the one used without it. */
  zlibrary: z.object({ baseUrl: z.string().nullable(), defaultBaseUrl: z.string() }),
});
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

/** Health of the services the app depends on (Impostazioni → Stato dei servizi). */
export const healthPaths = { services: "/api/library/health/services" } as const;

export const ServiceCheckSchema = z.object({
  id: z.enum(["backend", "db", "ai", "zlibrary"]),
  label: z.string(),
  /** `ok` works, `error` is configured but fails, `off` is not configured. */
  status: z.enum(["ok", "error", "off"]),
  detail: z.string(),
  /** Round trip of the check, in milliseconds (null when nothing was called). */
  ms: z.number().nullable(),
});
export type ServiceCheck = z.infer<typeof ServiceCheckSchema>;

export const ServicesHealthResponseSchema = z.object({
  checkedAt: z.string(),
  checks: z.array(ServiceCheckSchema),
});
export type ServicesHealthResponse = z.infer<typeof ServicesHealthResponseSchema>;
