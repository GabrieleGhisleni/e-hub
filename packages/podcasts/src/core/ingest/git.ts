/**
 * `git` runner for the Huberman wiki clone, injectable so tests never touch
 * the network (they pass a fake that lays out files in a temp dir).
 */
import { execFile } from "node:child_process";

/** Runs `git <args>` (in `cwd` if given) and returns stdout. Rejects on non-zero exit. */
export type GitRunner = (args: string[], options?: { cwd?: string }) => Promise<string>;

const GIT_TIMEOUT_MS = 180_000;

export const runGit: GitRunner = (args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        // Never prompt for credentials (public repo; fail fast instead).
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr).trim() || error.message;
          reject(new Error(`git ${args.join(" ")} failed: ${detail}`));
        } else resolve(String(stdout));
      },
    );
  });
