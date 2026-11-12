import { describe, expect, it } from "vitest";
import { type CliIO, runCli } from "../../../src/node/cli/program.ts";
import { progressLine } from "../../../src/node/cli/commands/summarize.ts";
import type { TestEnv } from "../../helpers/index.ts";
import { createTestEnv } from "../../helpers/index.ts";

describe("elib summarize progress line", () => {
  const chapter = { n: 3, title: "Notes", file: "03.md", words: 5055 };

  it("labels a short chapter as skipped for being short", () => {
    const line = progressLine({ kind: "chapter", done: 2, total: 10, chapter, status: "skipped", reason: "short" });
    expect(line).toBe('   2/10 Capitolo 3 "Notes"… saltato (meno di 150 parole)');
  });

  it("labels front and back matter as skipped for being accessory, not short", () => {
    const line = progressLine({
      kind: "chapter",
      done: 1,
      total: 10,
      chapter,
      status: "skipped",
      reason: "front-back-matter",
    });
    expect(line).toContain("saltato (parte accessoria)");
    expect(line).not.toContain("meno di 150 parole");
  });

  it("labels a summarized chapter ok", () => {
    expect(
      progressLine({ kind: "chapter", done: 1, total: 1, chapter, status: "summarized" }),
    ).toMatch(/… ok$/);
  });
});

async function elib(env: NodeJS.ProcessEnv, ...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const io: CliIO = {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
    env,
  };
  const code = await runCli(argv, io);
  return { code, stdout, stderr };
}

describe("elib summarize (argument and configuration errors)", () => {
  // An invalid EHUB_AI_BASE_URL is set on purpose: loadDotEnvLocal never overrides a set variable, so a real
  // .env.local cannot make this run call the model.
  const badConfig = { EHUB_AI_BASE_URL: "not-a-url", EHUB_AI_API_KEY: "x" };

  it("refuses to start with an invalid configuration, pointing to .env.example", async () => {
    const env: TestEnv = await createTestEnv();
    try {
      const run = await elib({ ...env.env, ...badConfig }, "summarize", "stpgkrdt");
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("Chat AI non configurata");
      expect(run.stderr).toContain(".env.example");
      expect(run.stdout).toBe("");
    } finally {
      await env.cleanup();
    }
  });

  it("needs an ID or --missing (checked after the configuration; no model call happens)", async () => {
    const env: TestEnv = await createTestEnv();
    try {
      const configured = { EHUB_AI_BASE_URL: "http://127.0.0.1:9/v1", EHUB_AI_API_KEY: "test" };
      const run = await elib({ ...env.env, ...configured }, "summarize");
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("indica un ID di libro oppure --missing");
    } finally {
      await env.cleanup();
    }
  });
});
