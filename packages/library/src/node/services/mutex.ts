/**
 * Write serialization: an in-process queue (`Mutex`) plus a cross-process lock file (`ProcessLock`), so the server,
 * `elib sync` and `elib import` never write the repo / cache / Drive at the same time (R1-10).
 */
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { ServiceError } from "./errors.ts";

/** Lock file name inside the cache dir. */
export const LOCK_FILE_NAME = ".elib.lock";

/** Another live elib process holds the lock. */
export class LockBusyError extends ServiceError {
  constructor(lockFile: string, holder: { pid?: number; startedAt?: string }) {
    const who = holder.pid
      ? ` (PID ${holder.pid}${holder.startedAt ? `, dal ${holder.startedAt}` : ""})`
      : "";
    super(
      "busy",
      409,
      `Un altro processo elib sta scrivendo sulla libreria${who}: riprova quando ha finito. ` +
        `(Se non c'è nessun altro processo elib, rimuovi ${lockFile}.)`,
    );
    this.name = "LockBusyError";
  }
}

export interface ProcessLockOptions {
  /** Default: `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean;
  now?: () => Date;
  pid?: number;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * `O_EXCL` lock file `<cache>/.elib.lock` holding `{pid, startedAt}`. Re-entrant inside one process (a depth counter),
 * fails fast when a live process holds it, and reclaims the lock of a dead PID.
 */
export class ProcessLock {
  private depth = 0;
  private readonly isAlive: (pid: number) => boolean;
  private readonly now: () => Date;
  private readonly pid: number;
  readonly file: string;

  constructor(file: string, options: ProcessLockOptions = {}) {
    this.file = file;
    this.isAlive = options.isAlive ?? pidAlive;
    this.now = options.now ?? (() => new Date());
    this.pid = options.pid ?? process.pid;
  }

  /** Runs `fn` holding the lock (taken on the outermost call, released when it settles). */
  async hold<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return await fn();
      } finally {
        this.depth -= 1;
      }
    }
    await this.acquire();
    this.depth = 1;
    try {
      return await fn();
    } finally {
      this.depth = 0;
      await unlink(this.file).catch(() => undefined);
    }
  }

  private async acquire(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const handle = await open(this.file, "wx");
        try {
          await handle.writeFile(
            JSON.stringify({ pid: this.pid, startedAt: this.now().toISOString() }),
          );
        } finally {
          await handle.close();
        }
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const holder = await this.readHolder();
      if (holder.live) throw new LockBusyError(this.file, holder);
      await unlink(this.file).catch(() => undefined);
    }
    throw new LockBusyError(this.file, {});
  }

  private async readHolder(): Promise<{ pid?: number; startedAt?: string; live: boolean }> {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8")) as {
        pid?: unknown;
        startedAt?: unknown;
      };
      if (typeof data.pid === "number" && Number.isInteger(data.pid)) {
        return {
          pid: data.pid,
          ...(typeof data.startedAt === "string" ? { startedAt: data.startedAt } : {}),
          live: data.pid === this.pid || this.isAlive(data.pid),
        };
      }
    } catch {
      // empty (being written) or corrupt: decided by age below
    }
    try {
      const age = this.now().getTime() - (await stat(this.file)).mtimeMs;
      return { live: age < 10_000 };
    } catch {
      return { live: false }; // vanished: retry
    }
  }
}

/** In-process mutex: every write operation of the services runs inside `runExclusive`, one at a time. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  private readonly processLock: ProcessLock | undefined;

  constructor(processLock?: ProcessLock) {
    this.processLock = processLock;
  }

  /**
   * Runs `fn` after every previously queued call has settled (holding the cross-process lock, if any); resolves/rejects
   * with `fn`'s result. Rejects with `LockBusyError` when another process holds the lock.
   */
  runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const lock = this.processLock;
    const run = lock ? () => lock.hold(fn) : fn;
    const result = this.tail.then(run);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
