import { rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

export interface TempDir {
  dir: string;
  cleanup(): Promise<void>;
}

/** Fresh directory under the OS temp dir. Call `cleanup()` in afterEach/afterAll. */
export async function makeTempDir(prefix = "elib-test-"): Promise<TempDir> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const tracked = new Set<string>();

// Registered when a test file imports the helpers: removes every directory handed to `trackTempDir`.
afterAll(() => {
  for (const dir of tracked) rmSync(dir, { recursive: true, force: true });
  tracked.clear();
});

/** Registers a temp dir created by a helper (no explicit cleanup call) for removal at the end of the test file. */
export function trackTempDir(dir: string): string {
  tracked.add(dir);
  return dir;
}

/** `mkdtemp` under the OS temp dir whose result is removed when the test file ends. */
export async function makeTrackedTempDir(prefix = "elib-test-"): Promise<string> {
  return trackTempDir(await mkdtemp(path.join(os.tmpdir(), prefix)));
}
