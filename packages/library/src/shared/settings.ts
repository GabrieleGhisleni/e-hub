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
