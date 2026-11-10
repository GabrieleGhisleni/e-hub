/**
 * Typed rclone wrapper: the only code that runs rclone.
 *
 * Safety (Drive is the only durable copy of the EPUBs, PLAN §14):
 * - processes are spawned with `execFile` and an argument array (no shell); local paths are made absolute, so neither
 *   a flag nor a `remote:` spec can be smuggled in through a file name;
 * - remote paths always go through `assertSafeRemotePath` and `remoteSpec(drive, …)`: the remote is the configured one,
 *   paths stay inside `drive.root`, writes stay inside the two trees;
 * - only these verbs exist: `lsjson`, `md5sum`, `copyto` (upload/download), `moveto` (file or folder), `deletefile`,
 *   `rmdirs --leave-root` (removes empty folders only), `mkdir`. Never `sync`, `purge`, `delete`, `rmdir`, `cleanup`;
 * - every write passes `--drive-use-trash=true` (a command-line flag beats env vars and rclone.conf), so deletions on
 *   Drive always go to the trash;
 * - `copyto`/`moveto` pass `--ignore-existing`: an existing destination is never overwritten and the source is never
 *   deleted because "the same file is already there";
 * - with `dryRun` the write methods only record what they would run.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { DriveConfig } from "../../shared/config.ts";
import { remoteSpec } from "../../shared/paths.ts";
import { UnsafeRemotePathError, assertDistinctTrees, assertSafeRemotePath } from "./guard.ts";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/** rclone exit code for "directory not found". */
export const RCLONE_EXIT_DIR_NOT_FOUND = 3;
/** rclone exit code for "file not found". */
export const RCLONE_EXIT_FILE_NOT_FOUND = 4;

const TRASH_FLAG = "--drive-use-trash=true";
const NO_CLOBBER_FLAG = "--ignore-existing";

export interface RcloneOptions {
  drive: DriveConfig;
  /** Environment of the rclone processes (tests pass the local remote's env with RCLONE_CONFIG). */
  env?: NodeJS.ProcessEnv;
  /** Executable name or path (default `rclone`). */
  binary?: string;
  /** Record write operations instead of running them. Reads still run. */
  dryRun?: boolean;
  /** Kill a single rclone run after this long (default 10 minutes). */
  timeoutMs?: number;
}

/** One entry of `lsjson`. */
export interface RcloneEntry {
  /** Path relative to the remote root (not to the listed folder), e.g. `Archivio/Narrativa/x [id].epub`. */
  path: string;
  name: string;
  /** Bytes; -1 when unknown (e.g. Google Docs). */
  size: number;
  /** RFC 3339, as rclone prints it. */
  modTime: string;
  isDir: boolean;
}

export interface Md5Entry {
  md5: string;
  /** Path relative to the remote root. */
  path: string;
}

export interface LsjsonOptions {
  recursive?: boolean;
  filesOnly?: boolean;
  dirsOnly?: boolean;
  /** Return [] instead of throwing when the folder does not exist. */
  missingOk?: boolean;
}

export type RcloneWriteOp =
  | "copyto"
  | "moveto"
  | "movedir"
  | "deletefile"
  | "download"
  | "rmdirs"
  | "mkdir";

/** A write that a dry-run instance would have run. */
export interface RcloneRecordedOp {
  op: RcloneWriteOp;
  /** Source: local path (copyto) or remote path. */
  from?: string;
  /** Destination: remote path, or local path for downloads. */
  to?: string;
  /** Target of single-path ops (deletefile, rmdirs, mkdir). */
  path?: string;
  /** Full rclone argument list. */
  args: string[];
}

export interface Rclone {
  readonly drive: DriveConfig;
  readonly dryRun: boolean;
  /** Dry-run only: the writes that would have run, in order (always empty otherwise). */
  readonly planned: readonly RcloneRecordedOp[];
  /** Same configuration, but every write is only recorded. */
  withDryRun(): Rclone;

  lsjson(dir: string, options?: LsjsonOptions): Promise<RcloneEntry[]>;
  /** Recursive MD5 of every file under `dir`. Files without an MD5 are skipped. */
  md5sum(dir: string, options?: { missingOk?: boolean }): Promise<Md5Entry[]>;
  /** Uploads a local file to `remotePath` (inside a tree). Never overwrites. */
  copyTo(localPath: string, remotePath: string): Promise<void>;
  /** Moves/renames a file (both paths inside the trees). Never overwrites. */
  moveTo(from: string, to: string): Promise<void>;
  /** Moves/renames a folder inside one tree (e.g. a topic folder). Never overwrites. */
  moveDir(from: string, to: string): Promise<void>;
  /** Sends one file to the Drive trash. */
  deleteFile(remotePath: string): Promise<void>;
  /** Downloads a remote file to `localPath` atomically (temp file + rename). Overwrites `localPath`. */
  download(remotePath: string, localPath: string): Promise<void>;
  /** Removes the empty folders under `dir`, never `dir` itself (`--leave-root`). A missing `dir` is a no-op. */
  rmdirs(dir: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
}

export class RcloneError extends Error {
  /** Process exit code (3 = directory not found, 4 = file not found…); null when it did not start or was killed. */
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: string;
  readonly args: readonly string[];
  constructor(
    message: string,
    details: {
      args: readonly string[];
      exitCode?: number | null;
      signal?: string | null;
      stderr?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: details.cause });
    this.name = "RcloneError";
    this.args = details.args;
    this.exitCode = details.exitCode ?? null;
    this.signal = details.signal ?? null;
    this.stderr = details.stderr ?? "";
  }
}

export function createRclone(options: RcloneOptions): Rclone {
  const { drive } = options;
  assertDistinctTrees(drive);
  const binary = options.binary ?? "rclone";
  const env = options.env ?? process.env;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const dryRun = options.dryRun ?? false;
  const planned: RcloneRecordedOp[] = [];

  const spec = (remotePath: string): string => remoteSpec(drive, remotePath);

  const run = (args: string[]): Promise<string> =>
    new Promise((resolve, reject) => {
      execFile(
        binary,
        args,
        { env, timeout, maxBuffer: 256 * 1024 * 1024, windowsHide: true, encoding: "utf8" },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(stdout);
            return;
          }
          const exitCode = typeof error.code === "number" ? error.code : null;
          const tail = lastLines(stderr);
          reject(
            new RcloneError(
              `rclone ${args[0]} failed${exitCode === null ? "" : ` (exit ${exitCode})`}: ${tail || error.message}`,
              { args, exitCode, signal: error.signal ?? null, stderr, cause: error },
            ),
          );
        },
      );
    });

  /** Runs a write, or only records it in dry-run. */
  const write = async (op: Omit<RcloneRecordedOp, "args">, args: string[]): Promise<void> => {
    if (dryRun) planned.push({ ...op, args });
    else await run(args);
  };

  const localAbsolute = (localPath: string): string => {
    if (typeof localPath !== "string" || localPath === "") {
      throw new UnsafeRemotePathError(String(localPath), "empty local path");
    }
    return path.resolve(localPath);
  };

  return {
    drive,
    dryRun,
    planned,
    withDryRun: () => createRclone({ ...options, dryRun: true }),

    async lsjson(dir, opts = {}) {
      assertSafeRemotePath(drive, dir, "read");
      const args = ["lsjson", "--no-mimetype"];
      if (opts.recursive) args.push("--recursive", "--fast-list");
      if (opts.filesOnly) args.push("--files-only");
      if (opts.dirsOnly) args.push("--dirs-only");
      args.push(spec(dir));
      let stdout: string;
      try {
        stdout = await run(args);
      } catch (error) {
        if (opts.missingOk && isDirNotFound(error)) return [];
        throw error;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(stdout);
      } catch (error) {
        throw new RcloneError(`rclone lsjson printed invalid JSON for ${dir}`, {
          args,
          cause: error,
        });
      }
      if (!Array.isArray(raw)) {
        throw new RcloneError(`rclone lsjson did not print an array for ${dir}`, { args });
      }
      return raw.map((item: Record<string, unknown>) => {
        const relative = String(item.Path ?? "");
        return {
          path: dir === "" ? relative : `${dir}/${relative}`,
          name: String(item.Name ?? relative.slice(relative.lastIndexOf("/") + 1)),
          size: typeof item.Size === "number" ? item.Size : -1,
          modTime: String(item.ModTime ?? ""),
          isDir: item.IsDir === true,
        };
      });
    },

    async md5sum(dir, opts = {}) {
      assertSafeRemotePath(drive, dir, "read");
      const args = ["md5sum", "--fast-list", spec(dir)];
      let stdout: string;
      try {
        stdout = await run(args);
      } catch (error) {
        if (opts.missingOk && isDirNotFound(error)) return [];
        throw error;
      }
      const entries: Md5Entry[] = [];
      for (const line of stdout.split("\n")) {
        const match = /^([0-9a-fA-F]{32}) {2}(.+)$/.exec(line);
        if (!match?.[1] || !match[2]) continue;
        entries.push({
          md5: match[1].toLowerCase(),
          path: dir === "" ? match[2] : `${dir}/${match[2]}`,
        });
      }
      return entries;
    },

    async copyTo(localPath, remotePath) {
      const local = localAbsolute(localPath);
      assertSafeRemotePath(drive, remotePath, "tree-entry");
      await write({ op: "copyto", from: local, to: remotePath }, [
        "copyto",
        NO_CLOBBER_FLAG,
        TRASH_FLAG,
        local,
        spec(remotePath),
      ]);
    },

    async moveTo(from, to) {
      assertSafeRemotePath(drive, from, "tree-entry");
      assertSafeRemotePath(drive, to, "tree-entry");
      if (from === to) throw new UnsafeRemotePathError(to, "source and destination are the same");
      await write({ op: "moveto", from, to }, [
        "moveto",
        NO_CLOBBER_FLAG,
        TRASH_FLAG,
        spec(from),
        spec(to),
      ]);
    },

    async moveDir(from, to) {
      const fromTree = assertSafeRemotePath(drive, from, "tree-entry");
      const toTree = assertSafeRemotePath(drive, to, "tree-entry");
      if (fromTree !== toTree) {
        throw new UnsafeRemotePathError(to, "folders can only be moved inside the same tree");
      }
      if (from === to || to.startsWith(`${from}/`) || from.startsWith(`${to}/`)) {
        throw new UnsafeRemotePathError(to, "a folder cannot be moved into itself or its parent");
      }
      await write({ op: "movedir", from, to }, [
        "moveto",
        NO_CLOBBER_FLAG,
        TRASH_FLAG,
        spec(from),
        spec(to),
      ]);
    },

    async deleteFile(remotePath) {
      assertSafeRemotePath(drive, remotePath, "tree-entry");
      await write({ op: "deletefile", path: remotePath }, [
        "deletefile",
        TRASH_FLAG,
        spec(remotePath),
      ]);
    },

    async download(remotePath, localPath) {
      assertSafeRemotePath(drive, remotePath, "read-file");
      const local = localAbsolute(localPath);
      const tmp = path.join(
        path.dirname(local),
        `.${path.basename(local)}.${randomBytes(6).toString("hex")}.download`,
      );
      const args = ["copyto", spec(remotePath), tmp];
      if (dryRun) {
        planned.push({ op: "download", from: remotePath, to: local, args });
        return;
      }
      await mkdir(path.dirname(local), { recursive: true });
      try {
        await run(args);
        await rename(tmp, local);
      } finally {
        await rm(tmp, { force: true });
      }
    },

    async rmdirs(dir) {
      assertSafeRemotePath(drive, dir, "tree-dir");
      try {
        await write({ op: "rmdirs", path: dir }, ["rmdirs", "--leave-root", TRASH_FLAG, spec(dir)]);
      } catch (error) {
        if (!isDirNotFound(error)) throw error;
      }
    },

    async mkdir(dir) {
      assertSafeRemotePath(drive, dir, "tree-dir");
      await write({ op: "mkdir", path: dir }, ["mkdir", spec(dir)]);
    },
  };
}

export function isDirNotFound(error: unknown): boolean {
  return error instanceof RcloneError && error.exitCode === RCLONE_EXIT_DIR_NOT_FOUND;
}

function lastLines(text: string, count = 3): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-count)
    .join(" | ");
}
