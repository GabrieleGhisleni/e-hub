import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cachedEpubPath } from "../../../src/node/cache/index.ts";
import { type CliIO, runCli } from "../../../src/node/cli/program.ts";
import { writeBook } from "../../../src/node/repo/index.ts";
import { type TestEnv, buildEpub, createTestEnv } from "../../helpers/index.ts";

const ID = "7k2m9q4t";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function elib(env: TestEnv, ...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const io: CliIO = {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
    env: env.env,
  };
  const code = await runCli(argv, io);
  return { code, stdout, stderr };
}

describe("elib text command", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
    await writeBook(env.dataDir, {
      id: ID,
      title: "Il giardino delle prove",
      authors: ["Ada Esempio"],
      topic: "narrativa",
      status: "to-read",
    });
    const file = cachedEpubPath(env.cacheDir, ID);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, await buildEpub());
  });
  afterEach(async () => {
    await env.cleanup();
  });

  it("prints the output dir and the chapter list, then reports a skip", async () => {
    const first = await elib(env, "text", ID);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain(path.join(env.cacheDir, "books", ID, "text"));
    expect(first.stdout).toContain("Capitolo secondo");

    const second = await elib(env, "text", ID);
    expect(second.code).toBe(0);
    expect(second.stdout.split("\n")[0]).toContain("already extracted");
  });

  it("fails with exit code 1 for an invalid book ID", async () => {
    const run = await elib(env, "text", "../x");
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("error:");
  });
});
