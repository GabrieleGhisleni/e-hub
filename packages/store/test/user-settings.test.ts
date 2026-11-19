import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readUserSettings, runAsUser, userEnv, writeUserSettings } from "../src/index.ts";

const base = () => mkdtemp(path.join(os.tmpdir(), "settings-"));
const SHARED = { EHUB_AI_API_KEY: "owner-key", GROQ_API_KEY: "owner-groq", OTHER: "x" };

describe("user settings", () => {
  it("overrides the environment locally and keeps its other variables", async () => {
    const dir = await base();
    await writeUserSettings({ ai: { model: "mine" }, groqApiKey: "g" }, dir);
    const env = await userEnv(SHARED, dir);
    expect(env).toMatchObject({ EHUB_AI_API_KEY: "owner-key", EHUB_AI_MODEL: "mine", GROQ_API_KEY: "g", OTHER: "x" });
  });

  it("never falls back to the server keys for a logged-in user", async () => {
    const dir = await base();
    const env = await runAsUser("u1", () => userEnv(SHARED, dir));
    expect(env.EHUB_AI_API_KEY).toBeUndefined();
    expect(env.GROQ_API_KEY).toBeUndefined();
    expect(env.OTHER).toBe("x");
  });

  it("keeps each user's keys apart, in a 600 file", async () => {
    const dir = await base();
    await runAsUser("u1", () => writeUserSettings({ ai: { apiKey: "k1" } }, dir));
    expect((await runAsUser("u2", () => userEnv({}, dir))).EHUB_AI_API_KEY).toBeUndefined();
    expect((await runAsUser("u1", () => userEnv({}, dir))).EHUB_AI_API_KEY).toBe("k1");
    const mode = (await stat(path.join(dir, "users/u1/settings.json"))).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(await readUserSettings(dir)).toEqual({ ai: {} });
  });
});
