/**
 * Personal settings of one user: their LLM router (base URL, API key, model) and their Groq key. They live in
 * `<cache>/users/<id>/settings.json` (mode 600; `<cache>/settings.json` without a user, i.e. local development), next to
 * the Z-Library session, and are never returned in full by the API.
 *
 * In the hosted setup the keys in the server environment (EHUB_AI_*, GROQ_API_KEY) belong to the owner and are NOT a
 * fallback for anybody: a user without their own keys gets "not configured". Without a user (local), the environment
 * (`.env.local`) is the fallback and the file overrides it.
 */
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { currentUserId, userScopedDir } from "./user-context.ts";

export const UserSettingsSchema = z.object({
  ai: z
    .object({
      baseUrl: z.url().optional(),
      apiKey: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
    })
    .default({}),
  groqApiKey: z.string().min(1).optional(),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

/** Variables the personal settings stand in for. */
const AI_ENV = ["EHUB_AI_BASE_URL", "EHUB_AI_API_KEY", "EHUB_AI_MODEL"] as const;

/** Base cache folder (`ELIB_CACHE_DIR`, default `~/.cache/e-library`). */
export function settingsBaseDir(env: Record<string, string | undefined> = process.env): string {
  const raw = env.ELIB_CACHE_DIR?.trim();
  if (!raw) return path.join(os.homedir(), ".cache", "e-library");
  return raw === "~" || raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(1)) : raw;
}

function settingsFile(baseDir: string): string {
  return path.join(userScopedDir(baseDir), "settings.json");
}

export async function readUserSettings(baseDir = settingsBaseDir()): Promise<UserSettings> {
  try {
    const parsed = UserSettingsSchema.safeParse(JSON.parse(await readFile(settingsFile(baseDir), "utf8")));
    return parsed.success ? parsed.data : { ai: {} };
  } catch {
    return { ai: {} };
  }
}

export async function writeUserSettings(settings: UserSettings, baseDir = settingsBaseDir()): Promise<void> {
  const file = settingsFile(baseDir);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(settings), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
}

/** Environment for the AI and Groq code: personal settings of the current user over (local) or instead of (hosted) `base`. */
export async function userEnv(
  base: NodeJS.ProcessEnv = process.env,
  baseDir = settingsBaseDir(base),
): Promise<NodeJS.ProcessEnv> {
  const settings = await readUserSettings(baseDir);
  const env: NodeJS.ProcessEnv = { ...base };
  if (currentUserId() !== null) {
    for (const key of [...AI_ENV, "GROQ_API_KEY"]) delete env[key];
  }
  if (settings.ai.baseUrl) env.EHUB_AI_BASE_URL = settings.ai.baseUrl;
  if (settings.ai.apiKey) env.EHUB_AI_API_KEY = settings.ai.apiKey;
  if (settings.ai.model) env.EHUB_AI_MODEL = settings.ai.model;
  if (settings.groqApiKey) env.GROQ_API_KEY = settings.groqApiKey;
  return env;
}
