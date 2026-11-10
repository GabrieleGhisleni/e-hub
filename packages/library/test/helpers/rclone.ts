/**
 * Local rclone remote for integration tests: a temp folder exposed as an rclone `alias` remote through a
 * temp rclone.conf. Passing `remote.env` to rclone sets RCLONE_CONFIG to that file, so the user's
 * ~/.config/rclone/rclone.conf is never read and the real `gdrive:` / `elib:` remotes do not even exist
 * for that process. Works with md5sum, lsjson, copyto, moveto, deletefile, mkdir, rmdir… (local backend).
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { DriveConfig } from "../../src/shared/config.ts";
import { makeTempDir } from "./tmp.ts";

const execFileAsync = promisify(execFile);

export const TEST_REMOTE_NAME = "elibtest";

export interface LocalRemote {
  /** Remote name for `DriveConfig.remote` (no colon). */
  name: string;
  /** Local folder the remote root maps to (plays the role of Drive `Libri/`). */
  dir: string;
  /** Temp rclone.conf defining only this remote. */
  configPath: string;
  /** Environment for rclone child processes: `process.env` without RCLONE_* vars, plus RCLONE_CONFIG. */
  env: NodeJS.ProcessEnv;
  /** `elibtest:<path>`. */
  spec(remotePath?: string): string;
  /** Local filesystem path of a remote path (to assert on files directly). */
  localPath(remotePath: string): string;
  /** A DriveConfig on this remote (root "", trees "Rakuten Kobo"/"Archivio", subfolders on) plus overrides. */
  driveConfig(overrides?: Partial<DriveConfig>): DriveConfig;
  /** Runs `rclone <args>` with `env`; resolves to stdout. */
  rclone(...args: string[]): Promise<string>;
  cleanup(): Promise<void>;
}

export async function createLocalRemote(options: { name?: string } = {}): Promise<LocalRemote> {
  const name = options.name ?? TEST_REMOTE_NAME;
  const tmp = await makeTempDir("elib-rclone-");
  const dir = path.join(tmp.dir, "remote");
  await mkdir(dir, { recursive: true });
  const configPath = path.join(tmp.dir, "rclone.conf");
  await writeFile(configPath, `[${name}]\ntype = alias\nremote = ${dir}\n`);
  // Drop any inherited RCLONE_* variable (e.g. RCLONE_CONFIG_<NAME>_* remotes defined in the shell).
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("RCLONE_")),
  );
  const env: NodeJS.ProcessEnv = { ...inherited, RCLONE_CONFIG: configPath };

  return {
    name,
    dir,
    configPath,
    env,
    spec: (remotePath = "") => `${name}:${remotePath}`,
    localPath: (remotePath) => path.join(dir, ...remotePath.split("/").filter(Boolean)),
    driveConfig: (overrides = {}) => ({
      remote: name,
      root: "",
      koboTree: "Rakuten Kobo",
      archiveTree: "Archivio",
      topicSubfolders: { kobo: true, archive: true },
      ...overrides,
    }),
    rclone: async (...args) => {
      const { stdout } = await execFileAsync("rclone", args, { env, maxBuffer: 64 * 1024 * 1024 });
      return stdout;
    },
    cleanup: tmp.cleanup,
  };
}
