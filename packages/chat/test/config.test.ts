// Config loading: required vars, defaults, validation and .env.local parsing.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiConfigError, loadAiConfig, loadDotEnvLocal } from "../src/node/index.ts";

const base = { EHUB_AI_BASE_URL: "https://llm.example.test/v1", EHUB_AI_API_KEY: "key-123" };

describe("loadAiConfig", () => {
  it("throws AiConfigError naming the missing required variables", () => {
    let caught: unknown;
    try {
      loadAiConfig({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiConfigError);
    const problems = (caught as AiConfigError).problems;
    expect(problems).toContain("EHUB_AI_BASE_URL is missing");
    expect(problems).toContain("EHUB_AI_API_KEY is missing");
    expect((caught as Error).message).toContain("EHUB_AI_BASE_URL");
  });

  it("treats empty values as missing", () => {
    expect(() => loadAiConfig({ ...base, EHUB_AI_API_KEY: "   " })).toThrow(/EHUB_AI_API_KEY is missing/);
  });

  it("rejects a base URL that is not absolute", () => {
    expect(() => loadAiConfig({ ...base, EHUB_AI_BASE_URL: "llm.example.test/v1" })).toThrow(
      /EHUB_AI_BASE_URL must be an absolute URL/,
    );
  });

  it("applies the defaults: model smart, summary model = model, 1_000_000 tokens", () => {
    expect(loadAiConfig(base)).toEqual({
      baseUrl: "https://llm.example.test/v1",
      apiKey: "key-123",
      model: "smart",
      summaryModel: "smart",
      maxContextTokens: 1_000_000,
    });
  });

  it("reads explicit model, summary model and context size", () => {
    const config = loadAiConfig({
      ...base,
      EHUB_AI_MODEL: "big",
      EHUB_AI_SUMMARY_MODEL: "small",
      EHUB_AI_MAX_CONTEXT_TOKENS: "200000",
    });
    expect(config.model).toBe("big");
    expect(config.summaryModel).toBe("small");
    expect(config.maxContextTokens).toBe(200_000);
  });

  it.each(["0", "-5", "1.5", "abc", "1e6"])("rejects max context tokens %s", (value) => {
    expect(() => loadAiConfig({ ...base, EHUB_AI_MAX_CONTEXT_TOKENS: value })).toThrow(
      /EHUB_AI_MAX_CONTEXT_TOKENS must be a positive integer/,
    );
  });
});

describe("loadDotEnvLocal", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ehub-chat-env-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses KEY=VALUE, skips comments and blanks, strips quotes, and never overrides", () => {
    writeFileSync(
      join(dir, ".env.local"),
      [
        "# comment",
        "",
        "EHUB_AI_BASE_URL=https://llm.example.test/v1",
        'EHUB_AI_API_KEY="quoted-key"',
        "EHUB_AI_MODEL='single-quoted'",
        "export EHUB_AI_SUMMARY_MODEL=summary",
        "EHUB_AI_MAX_CONTEXT_TOKENS=5000",
        "NOT A PAIR",
      ].join("\n"),
    );
    const env: Record<string, string | undefined> = { EHUB_AI_MAX_CONTEXT_TOKENS: "9000" };

    loadDotEnvLocal(dir, env);

    expect(env.EHUB_AI_BASE_URL).toBe("https://llm.example.test/v1");
    expect(env.EHUB_AI_API_KEY).toBe("quoted-key");
    expect(env.EHUB_AI_MODEL).toBe("single-quoted");
    expect(env.EHUB_AI_SUMMARY_MODEL).toBe("summary");
    expect(env.EHUB_AI_MAX_CONTEXT_TOKENS).toBe("9000");
  });

  it("does nothing when the file is absent", () => {
    const env: Record<string, string | undefined> = {};
    expect(() => loadDotEnvLocal(dir, env)).not.toThrow();
    expect(env).toEqual({});
  });
});
