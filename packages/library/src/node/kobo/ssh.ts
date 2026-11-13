/**
 * Kobo transport over SSH (docs/kobo-ssh-migration.md). Each operation runs one `ssh` process (no local shell, the
 * remote command is a single string built from quoted paths). Connections are multiplexed (ControlMaster) so a sync
 * does not pay the handshake for every file.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import type { KoboConfig } from "../../shared/config.ts";
import { type KoboEntry, type KoboTransport, assertSafeRelPath } from "./transport.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export interface SshTransportOptions {
  /** Env of the ssh process (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Executable (default `ssh`). */
  binary?: string;
  /** Kill ssh after this long; overrides the per-operation defaults (30 s, 120 s for uploads). */
  timeoutMs?: number;
}

/** ssh failed: unreachable, refused, or the remote command exited non-zero. */
export class SshError extends Error {
  /** Remote exit code (or ssh's own, 255 for connection errors); null when it did not run or was killed. */
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(
    message: string,
    details: { exitCode?: number | null; stderr?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = "SshError";
    this.exitCode = details.exitCode ?? null;
    this.stderr = details.stderr ?? "";
  }
}

/** POSIX single-quote quoting: `it's` → `'it'\''s'`. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function byName(a: KoboEntry, b: KoboEntry): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function sshTransport(kobo: KoboConfig, opts: SshTransportOptions = {}): KoboTransport {
  const binary = opts.binary ?? "ssh";
  const env = opts.env ?? process.env;
  const root = kobo.booksDir.replace(/\/+$/, "");
  const q = shellQuote;

  const sshArgs = [
    "-p",
    String(kobo.port),
    "-i",
    kobo.identityFile,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectTimeout=5",
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ControlMaster=auto",
    "-o",
    "ControlPersist=30",
    "-o",
    `ControlPath=${os.tmpdir()}/elib-ssh-%C`,
  ];
  if (kobo.hostKeyAlias) sshArgs.push("-o", `HostKeyAlias=${kobo.hostKeyAlias}`);

  const description = `${kobo.host}:${kobo.booksDir}`;
  const absolute = (rel: string): string => `${root}/${rel}`;
  const timeoutFor = (fallback: number): number => opts.timeoutMs ?? fallback;

  /** Runs one remote command; resolves with its stdout, rejects with an SshError on any failure. */
  function runSsh(command: string, timeoutMs: number, stdin?: Buffer | Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(binary, [...sshArgs, kobo.host, command], {
          env,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        reject(new SshError(`cannot run ${binary}: ${(error as Error).message}`, { cause: error }));
        return;
      }
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new SshError(`ssh to ${description} timed out after ${timeoutMs} ms`));
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new SshError(`cannot run ${binary}: ${error.message}`, { cause: error }));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const errorText = Buffer.concat(stderr).toString("utf8").trim();
        if (code === 0) {
          resolve(Buffer.concat(stdout).toString("utf8"));
          return;
        }
        reject(
          new SshError(
            `ssh to ${description} failed${code === null ? "" : ` (exit ${code})`}: ${errorText || "no error output"}`,
            { exitCode: code, stderr: errorText },
          ),
        );
      });

      child.stdin?.on("error", () => {
        // EPIPE when the remote side stops reading: the exit code reports the failure.
      });
      if (stdin === undefined) {
        child.stdin?.end();
      } else if (Buffer.isBuffer(stdin)) {
        child.stdin?.end(stdin);
      } else {
        stdin.on("error", (error) => {
          child.kill("SIGKILL");
          clearTimeout(timer);
          reject(new SshError(`cannot read the local file: ${error.message}`, { cause: error }));
        });
        if (child.stdin) stdin.pipe(child.stdin);
      }
    });
  }

  /** `mkdir -p`, write stdin to a hidden temp name in the same folder, then `mv`; the temp file is removed on failure. */
  function writeAtomic(
    relPath: string,
    stdin: Buffer | Readable,
    timeoutMs: number,
  ): Promise<void> {
    assertSafeRelPath(relPath);
    const target = absolute(relPath);
    const temp = path.posix.join(
      path.posix.dirname(target),
      `.elib-upload-${randomBytes(8).toString("hex")}`,
    );
    const command =
      `mkdir -p ${q(path.posix.dirname(target))} && cat > ${q(temp)} && mv -f ${q(temp)} ${q(target)}` +
      ` || { rm -f ${q(temp)}; exit 1; }`;
    return runSsh(command, timeoutMs, stdin).then(() => undefined);
  }

  return {
    description,

    async list(): Promise<KoboEntry[]> {
      const command =
        `cd ${q(root)} && for f in * ; do [ -e "$f" ] || continue; ` +
        `if [ -d "$f" ]; then printf 'd %s\\0' "$f"; else printf 'f %s\\0' "$f"; fi; done`;
      const output = await runSsh(command, timeoutFor(DEFAULT_TIMEOUT_MS));
      const entries: KoboEntry[] = [];
      for (const record of output.split("\0")) {
        if (record === "") continue;
        const kind = record[0];
        if (kind !== "d" && kind !== "f") {
          throw new SshError(`unexpected listing from ${description}: ${JSON.stringify(record)}`);
        }
        const name = record.slice(2);
        if (name.startsWith(".")) continue;
        entries.push({ name, dir: kind === "d" });
      }
      return entries.sort(byName);
    },

    async md5(relPaths: readonly string[]): Promise<Map<string, string>> {
      const result = new Map<string, string>();
      if (relPaths.length === 0) return result;
      for (const rel of relPaths) assertSafeRelPath(rel);
      const command = `cd ${q(root)} && md5sum -- ${relPaths.map((p) => q(p)).join(" ")} 2>/dev/null; true`;
      const output = await runSsh(command, timeoutFor(DEFAULT_TIMEOUT_MS));
      for (const line of output.split("\n")) {
        const match = /^([0-9a-f]{32}) {2}(.+)$/.exec(line);
        if (match?.[1] && match[2]) result.set(match[2], match[1]);
      }
      return result;
    },

    async readFile(relPath: string): Promise<string | null> {
      assertSafeRelPath(relPath);
      const file = q(absolute(relPath));
      // First byte says whether the file exists: "1" + content, or "0" alone.
      const output = await runSsh(
        `if [ -f ${file} ]; then printf 1; cat -- ${file}; else printf 0; fi`,
        timeoutFor(DEFAULT_TIMEOUT_MS),
      );
      if (output.startsWith("0")) return null;
      if (!output.startsWith("1")) {
        throw new SshError(`unexpected output reading ${relPath} from ${description}`);
      }
      return output.slice(1);
    },

    async upload(localPath: string, relPath: string): Promise<void> {
      assertSafeRelPath(relPath); // before the local file is opened
      await writeAtomic(relPath, createReadStream(localPath), timeoutFor(UPLOAD_TIMEOUT_MS));
    },

    async writeFile(relPath: string, content: string): Promise<void> {
      await writeAtomic(relPath, Buffer.from(content, "utf8"), timeoutFor(DEFAULT_TIMEOUT_MS));
    },

    async rename(from: string, to: string): Promise<void> {
      assertSafeRelPath(from);
      assertSafeRelPath(to);
      const command = `[ ! -e ${q(absolute(to))} ] && mv ${q(absolute(from))} ${q(absolute(to))}`;
      await runSsh(command, timeoutFor(DEFAULT_TIMEOUT_MS));
    },

    async remove(relPath: string): Promise<void> {
      assertSafeRelPath(relPath);
      await runSsh(`rm -rf -- ${q(absolute(relPath))}`, timeoutFor(DEFAULT_TIMEOUT_MS));
    },

    async flush(): Promise<void> {
      await runSsh("sync", timeoutFor(DEFAULT_TIMEOUT_MS));
    },
  };
}
