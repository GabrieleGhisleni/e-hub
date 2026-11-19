/** Personal keys of the current user (contract in src/shared/settings.ts): LLM router and Groq. */
import type { Hono, MiddlewareHandler } from "hono";
import { currentUserId, readUserSettings, settingsBaseDir, writeUserSettings } from "@ehub/store";
import {
  SettingsUpdateSchema,
  settingsPaths,
  type SettingsResponse,
} from "../../shared/settings.ts";
import { zlibraryEnvFrom } from "../zlibrary/index.ts";
import { jsonBody } from "./http.ts";

async function snapshot(): Promise<SettingsResponse> {
  const own = await readUserSettings();
  // Without a user (local) `.env.local` is the fallback; in the hosted setup nothing is.
  const env = currentUserId() === null ? process.env : {};
  const source = (personal: boolean, fromEnv: boolean) => (personal ? "personal" : fromEnv ? "env" : null) as
    | "personal"
    | "env"
    | null;
  return {
    ai: {
      baseUrl: own.ai.baseUrl ?? null,
      model: own.ai.model ?? null,
      hasKey: Boolean(own.ai.apiKey ?? env.EHUB_AI_API_KEY?.trim()),
      source: source(Boolean(own.ai.apiKey), Boolean(env.EHUB_AI_API_KEY?.trim())),
    },
    groq: {
      hasKey: Boolean(own.groqApiKey ?? env.GROQ_API_KEY?.trim()),
      source: source(Boolean(own.groqApiKey), Boolean(env.GROQ_API_KEY?.trim())),
    },
    zlibrary: { baseUrl: own.zlibraryBaseUrl ?? null, defaultBaseUrl: zlibraryEnvFrom().baseUrl },
  };
}

export function registerSettingsRoutes(app: Hono, jsonLimit: MiddlewareHandler): void {
  app.get(settingsPaths.keys, async (c) => c.json(await snapshot(), 200, { "Cache-Control": "no-store" }));

  app.put(settingsPaths.keys, jsonLimit, async (c) => {
    const update = await jsonBody(c, SettingsUpdateSchema);
    const current = await readUserSettings();
    const apply = <T>(value: T | null | undefined, old: T | undefined): T | undefined =>
      value === undefined ? old : value === null ? undefined : value;
    const next = {
      ai: {
        baseUrl: apply(update.baseUrl, current.ai.baseUrl),
        apiKey: apply(update.apiKey, current.ai.apiKey),
        model: apply(update.model, current.ai.model),
      },
      groqApiKey: apply(update.groqApiKey, current.groqApiKey),
      zlibraryBaseUrl: apply(
        typeof update.zlibraryBaseUrl === "string" ? update.zlibraryBaseUrl.replace(/\/+$/, "") : update.zlibraryBaseUrl,
        current.zlibraryBaseUrl,
      ),
    };
    await writeUserSettings(JSON.parse(JSON.stringify(next)), settingsBaseDir());
    return c.json(await snapshot(), 200, { "Cache-Control": "no-store" });
  });
}
