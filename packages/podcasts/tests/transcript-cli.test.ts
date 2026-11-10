import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_CODES } from "../src/core/errors";
import { DATA_DIR_ENV, REPO_ROOT } from "../src/core/paths";
import { writeTranscript } from "../src/core/transcripts";
import { seedEpisode, syntheticTranscript, useTempDirs } from "./helpers";

const dirs = useTempDirs();
const SLUG = "demo-show-first-episode";
const TSX = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [path.join(REPO_ROOT, "src", "cli", "transcript.ts"), ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, [DATA_DIR_ENV]: dirs.data },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

describe("pnpm transcript export (CLI)", { timeout: 30_000 }, () => {
  it("prints to stdout, writes --out, and fails clearly without a transcript", async () => {
    await seedEpisode();
    const missing = await run(["export", SLUG]);
    expect(missing.code).toBe(EXIT_CODES["not-found"]);
    expect(missing.stderr).toMatch(/no local transcript/);

    await writeTranscript(SLUG, syntheticTranscript(300).transcript);
    const printed = await run(["export", SLUG]);
    expect(printed.code).toBe(0);
    expect(printed.stdout).toMatch(/^# First episode\n/);
    expect(printed.stdout).toContain("**Host Person** [00:00:00]");

    const out = path.join(dirs.root, "export.md");
    const written = await run(["export", SLUG, "--out", out]);
    expect(written.code).toBe(0);
    expect(written.stdout).toBe("");
    expect(await readFile(out, "utf8")).toBe(printed.stdout);

    expect((await run(["export"])).code).toBe(EXIT_CODES.usage);
    expect((await run(["export", "Bad_Slug"])).code).toBe(EXIT_CODES.validation);
  });
});
