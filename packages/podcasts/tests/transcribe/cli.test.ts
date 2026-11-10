import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_DIR_ENV, REPO_ROOT } from "../../src/core/paths";
import { useTempDirs } from "../helpers";

const dirs = useTempDirs();
const TSX = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

function run(...args: string[]) {
  const result = spawnSync(TSX, [path.join(REPO_ROOT, "src", "cli", "transcribe.ts"), ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, [DATA_DIR_ENV]: dirs.data },
    encoding: "utf8",
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("pnpm transcribe (CLI arguments)", { timeout: 30_000 }, () => {
  it("rejects bad usage with exit 2 and explains the flags", () => {
    expect(run().code).toBe(2);
    const bad = run("some-episode", "--diarizer", "whisperx");
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("--diarizer must be one of: diarize, pyannote");
    expect(run("some-episode", "--limit-minutes", "-3").code).toBe(2);
    expect(run("some-episode", "--bogus").code).toBe(2);
    const help = run("--help");
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--keep-audio");
  });

  it("exits 4 for an unknown episode", () => {
    const result = run("no-such-episode");
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("not-found");
  });
});
