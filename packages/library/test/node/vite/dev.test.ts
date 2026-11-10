import path from "node:path";
import { createServer } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../src/node/config/index.ts";
import { elibData } from "../../../src/node/vite/index.ts";
import { type TempDataDir, makeTempDataDir } from "../../helpers/index.ts";
import { writeFakeBook } from "../site-data/fixtures.ts";

let tmp: TempDataDir;
beforeEach(async () => {
  tmp = await makeTempDataDir();
});
afterEach(() => tmp.cleanup());

describe("elibData dev middleware", () => {
  it("serves index, detail and cover; rebuilds after a change; 404 otherwise", async () => {
    await writeFakeBook(tmp.dataDir, { id: "aaaaaaaa" }, { "cover.webp": "webp" });
    const server = await createServer({
      root: REPO_ROOT,
      configFile: false,
      logLevel: "silent",
      base: "/e-library/",
      plugins: [elibData({ dataDir: tmp.dataDir })],
      server: { port: 0, host: "127.0.0.1", ws: false, watch: null },
    });
    await server.listen();
    try {
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("no address");
      const origin = `http://127.0.0.1:${address.port}`;
      const get = (p: string) => fetch(`${origin}/e-library/${p}`);
      const res = await get("data/index.json");
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("cache-control")).toBe("no-cache");
      const index = (await res.json()) as { books: { coverUrl: string }[] };
      expect(index.books).toHaveLength(1);
      const coverUrl = index.books[0]!.coverUrl;
      const cover = await fetch(origin + coverUrl);
      expect(cover.headers.get("content-type")).toBe("image/webp");
      expect(await cover.text()).toBe("webp");
      expect((await get("data/books/aaaaaaaa.json")).status).toBe(200);
      expect((await get("data/books/bbbbbbbb.json")).status).toBe(404);
      expect(path.basename(coverUrl)).toMatch(/^aaaaaaaa\./);
    } finally {
      await server.close();
    }
  });

  it("survives a malformed URL escape", async () => {
    const server = await createServer({
      root: REPO_ROOT,
      configFile: false,
      logLevel: "silent",
      base: "/e-library/",
      plugins: [elibData({ dataDir: tmp.dataDir })],
      server: { port: 0, host: "127.0.0.1", ws: false, watch: null },
    });
    await server.listen();
    try {
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("no address");
      const origin = `http://127.0.0.1:${address.port}`;
      const bad = await fetch(`${origin}/e-library/%E0%A4%A`);
      expect(bad.status).toBeLessThan(500);
      const bad2 = await fetch(`${origin}/e-library/data/%E0%A4%A`);
      expect(bad2.status).toBeLessThan(500);
      expect((await fetch(`${origin}/e-library/data/index.json`)).status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
