import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LockBusyError, Mutex, ProcessLock } from "../../../src/node/services/mutex.ts";
import { type TempDir, makeTempDir } from "../../helpers/tmp.ts";

let tmp: TempDir;
let file: string;
beforeEach(async () => {
  tmp = await makeTempDir();
  file = path.join(tmp.dir, "cache", ".elib.lock");
});
afterEach(() => tmp.cleanup());

describe("ProcessLock", () => {
  it("writes PID + timestamp, is re-entrant, and is released afterwards", async () => {
    const lock = new ProcessLock(file, { pid: 111 });
    await lock.hold(async () => {
      expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ pid: 111 });
      await lock.hold(() => undefined); // nested: no second acquisition
      await readFile(file, "utf8"); // still there
    });
    await expect(readFile(file, "utf8")).rejects.toThrow();
  });

  it("a second process fails fast while the holder is alive", async () => {
    const first = new ProcessLock(file, { pid: 111, isAlive: () => true });
    const second = new ProcessLock(file, { pid: 222, isAlive: () => true });
    await first.hold(async () => {
      await expect(second.hold(() => "x")).rejects.toBeInstanceOf(LockBusyError);
      await expect(second.hold(() => "x")).rejects.toThrow(/PID 111/);
    });
    await expect(second.hold(() => "ok")).resolves.toBe("ok");
  });

  it("reclaims the lock of a dead process", async () => {
    await new ProcessLock(file, { pid: 1 }).hold(() => undefined); // creates the dir
    await writeFile(file, JSON.stringify({ pid: 999, startedAt: "2020-01-01T00:00:00Z" }));
    const lock = new ProcessLock(file, { pid: 222, isAlive: (pid) => pid !== 999 });
    await expect(lock.hold(() => "ok")).resolves.toBe("ok");
  });

  it("an unreadable fresh lock file counts as busy, an old one as stale", async () => {
    await new ProcessLock(file).hold(() => undefined);
    await writeFile(file, "");
    await expect(new ProcessLock(file).hold(() => 1)).rejects.toBeInstanceOf(LockBusyError);
    const later = new ProcessLock(file, { now: () => new Date(Date.now() + 60_000) });
    await expect(later.hold(() => 1)).resolves.toBe(1);
  });

  it("releases the lock when the function throws; Mutex serializes and takes the lock", async () => {
    const lock = new ProcessLock(file);
    const mutex = new Mutex(lock);
    await expect(
      mutex.runExclusive(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const order: number[] = [];
    await Promise.all([
      mutex.runExclusive(async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push(1);
      }),
      mutex.runExclusive(() => void order.push(2)),
    ]);
    expect(order).toEqual([1, 2]);
    await expect(readFile(file, "utf8")).rejects.toThrow();
  });
});
