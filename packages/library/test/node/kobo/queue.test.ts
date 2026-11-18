import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cachedKepubPath } from "../../../src/node/cache/index.ts";
import {
  createKoboContext,
  discoverKoboHost,
  setKoboAccessPolicy,
  drainKoboQueue,
  koboResolver,
  listQueue,
  localTransport,
  reconcileOrQueue,
  subnetCandidates,
} from "../../../src/node/kobo/index.ts";
import type { KoboTransport } from "../../../src/node/kobo/transport.ts";
import { writeBook } from "../../../src/node/repo/index.ts";
import { type TestEnv, createTestEnv } from "../../helpers/test-env.ts";

const ID = "ab12cd34";
let env: TestEnv;
let asleep: boolean;

function ctxOf(queue: boolean) {
  const inner = localTransport(env.koboDir);
  const transport: KoboTransport = new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (asleep) return Promise.reject(new Error("ssh: connect timed out"));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return createKoboContext(
    {
      kobo: { host: "root@127.0.0.1", port: 2222, identityFile: "x", booksDir: "/mnt/onboard/books" },
      dataDir: env.dataDir,
      cache: { dir: env.cacheDir },
    },
    { transport, queue },
  );
}

beforeEach(async () => {
  env = await createTestEnv();
  asleep = true;
  await writeBook(env.dataDir, {
    id: ID,
    title: "Il giardino delle prove",
    authors: ["Ada Esempio"],
    topic: "narrativa",
    status: "to-read",
  });
  const kepub = cachedKepubPath(env.cacheDir, ID);
  await mkdir(path.dirname(kepub), { recursive: true });
  await writeFile(kepub, "KEPUB");
});
afterEach(async () => {
  setKoboAccessPolicy(null);
  await env.cleanup();
});

describe("Kobo queue", () => {
  it("without the queue it is plain reconcile (a sleeping Kobo is an error)", async () => {
    const report = await reconcileOrQueue(ctxOf(false), [ID]);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(await listQueue(env.dataDir)).toEqual([]);
  });

  it("queues while the Kobo sleeps and drains when it answers", async () => {
    const ctx = ctxOf(true);
    const report = await reconcileOrQueue(ctx, [ID]);
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((w) => w.code)).toEqual(["queued"]);
    expect((await listQueue(env.dataDir)).map((e) => e.bookId)).toEqual([ID]);
    expect(await readdir(env.koboDir)).toEqual([]);

    expect(await drainKoboQueue(ctx)).toMatchObject({ status: "asleep", pending: 1 });

    asleep = false;
    const drained = await drainKoboQueue(ctx);
    expect(drained.status).toBe("synced");
    expect(await listQueue(env.dataDir)).toEqual([]);
    expect((await readdir(env.koboDir)).some((n) => n.endsWith(".kepub.epub"))).toBe(true);
    expect(await drainKoboQueue(ctx)).toEqual({ status: "empty", pending: 0 });
  });

  it("for a user who is not the Kobo owner every Kobo operation is a no-op: no sync, no queue", async () => {
    setKoboAccessPolicy(() => false);
    const ctx = ctxOf(true);
    for (const awake of [false, true]) {
      asleep = !awake;
      const report = await reconcileOrQueue(ctx, [ID]);
      expect(report).toMatchObject({ errors: [], warnings: [], actions: [] });
    }
    expect(await listQueue(env.dataDir)).toEqual([]);
    expect(await readdir(env.koboDir)).toEqual([]);
    expect(await drainKoboQueue(ctx)).toEqual({ status: "empty", pending: 0 });
  });

  it("syncs right away (no queue entry) when the Kobo is awake", async () => {
    asleep = false;
    const report = await reconcileOrQueue(ctxOf(true), [ID]);
    expect(report.actions.some((a) => a.type === "upload" && a.status === "done")).toBe(true);
    expect(await listQueue(env.dataDir)).toEqual([]);
  });

  it("drops queued books that were deleted meanwhile", async () => {
    const ctx = ctxOf(true);
    await reconcileOrQueue(ctx, [ID, "ffffffff"]);
    asleep = false;
    const drained = await drainKoboQueue(ctx);
    expect(drained.status).toBe("synced");
    expect(await listQueue(env.dataDir)).toEqual([]);
  });
});

describe("Kobo discovery", () => {
  const kobo = {
    host: "root@192.168.1.12",
    port: 2222,
    identityFile: "x",
    booksDir: "/mnt/onboard/books",
    hostKeyAlias: "ehub-kobo",
  };

  it("lists the /24 neighbours of the non-internal IPv4 interfaces", () => {
    const ips = subnetCandidates({
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      wlan0: [{ address: "192.168.1.5", family: "IPv4", internal: false }],
    } as never);
    expect(ips).toHaveLength(253);
    expect(ips).not.toContain("192.168.1.5");
    expect(ips).toContain("192.168.1.77");
  });

  it("accepts only the address where the strict SSH login works", async () => {
    const verified: string[] = [];
    const host = await discoverKoboHost(kobo, {
      candidates: () => ["10.0.0.2", "10.0.0.3", "10.0.0.4"],
      open: async (ip) => ip !== "10.0.0.2",
      verify: async (k) => {
        verified.push(k.host);
        return k.host === "root@10.0.0.4";
      },
    });
    expect(host).toBe("root@10.0.0.4");
    expect(verified).toEqual(["root@10.0.0.3", "root@10.0.0.4"]);
  });

  it("finds nothing when no listener passes the host key check, or there is no host key alias", async () => {
    const deps = { candidates: () => ["10.0.0.2"], open: async () => true, verify: async () => false };
    expect(await discoverKoboHost(kobo, deps)).toBeNull();
    const { hostKeyAlias: _alias, ...noAlias } = kobo;
    expect(await discoverKoboHost(noAlias, { ...deps, verify: async () => true })).toBeNull();
  });

  it("the resolver remembers the address it found", async () => {
    asleep = true;
    const base = ctxOf(false);
    const resolver = koboResolver({
      candidates: () => ["10.0.0.9"],
      open: async () => true,
      verify: async () => true,
      makeContext: (host) => {
        const c = ctxOf(false);
        return { ...c, kobo: { ...c.kobo, host }, transport: localTransport(env.koboDir) };
      },
    });
    const found = await resolver({ ...base, kobo: { ...base.kobo, hostKeyAlias: "ehub-kobo" } });
    expect(found?.kobo.host).toBe("root@10.0.0.9");
  });
});
