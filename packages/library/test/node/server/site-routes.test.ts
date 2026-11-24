import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/node/server/app.ts";
import { saveCover } from "../../../src/node/covers/index.ts";
import { writeBook } from "../../../src/node/repo/index.ts";
import { silentLogger } from "../../../src/node/services/context.ts";
import type { ServiceContext } from "../../../src/node/services/context.ts";
import { type TempDataDir, makeTempDataDir } from "../../helpers/data-dir.ts";
import { fakeServices } from "./security.test.ts";

let tmp: TempDataDir;
beforeEach(async () => {
  tmp = await makeTempDataDir();
});
afterEach(() => tmp.cleanup());

const CONFIG = { server: { port: 8787, allowedOrigins: ["http://127.0.0.1:5173"] } };

function appFor(dataDir: string) {
  const services = fakeServices({
    ctx: { logger: silentLogger, cacheDir: "/nonexistent-cache", dataDir } as unknown as ServiceContext,
    updateBook: async () => {
      await writeBook(dataDir, { id: "ab12cd34", title: "Rinominato", authors: ["Ada Esempio"], topic: "narrativa", status: "to-read" });
      return {} as never;
    },
  });
  return createApp(services, CONFIG, { publicUrl: "https://api.example.com" });
}

describe("hosted site routes", () => {
  it("serve the index, the book detail and the hashed cover; a write drops the cache", async () => {
    await writeBook(tmp.dataDir, { id: "ab12cd34", title: "Il giardino", authors: ["Ada Esempio"], topic: "narrativa", status: "to-read" });
    await saveCover(tmp.dataDir, "ab12cd34", new Uint8Array([1, 2, 3, 4]));
    const app = appFor(tmp.dataDir);
    const headers = { host: "127.0.0.1:8787" };

    const index = (await (await app.request("/api/library/site/index.json", { headers })).json()) as {
      books: { id: string; title: string; coverUrl: string }[];
    };
    expect(index.books.map((b) => b.title)).toEqual(["Il giardino"]);
    expect(index.books[0]!.coverUrl).toMatch(/^https:\/\/api\.example\.com\/api\/library\/site\/covers\/ab12cd34\.[0-9a-f]{8}\.webp$/);

    const detail = await app.request("/api/library/site/books/ab12cd34.json", { headers });
    expect(detail.status).toBe(200);
    expect((await app.request("/api/library/site/books/zzzzzzzz.json", { headers })).status).toBe(404);

    const file = new URL(index.books[0]!.coverUrl).pathname;
    const cover = await app.request(file, { headers });
    expect(cover.headers.get("content-type")).toBe("image/webp");
    expect([...new Uint8Array(await cover.arrayBuffer())]).toEqual([1, 2, 3, 4]);

    // cached: still the old title after the file changed behind the API's back...
    await writeBook(tmp.dataDir, { id: "ab12cd34", title: "Cambiato", authors: ["Ada Esempio"], topic: "narrativa", status: "to-read" });
    const cached = (await (await app.request("/api/library/site/index.json", { headers })).json()) as typeof index;
    expect(cached.books[0]!.title).toBe("Il giardino");
    // ...and fresh after a write through the API.
    await app.request("/api/library/books/ab12cd34", {
      method: "PATCH",
      headers: { ...headers, origin: "http://127.0.0.1:5173", "content-type": "application/json" },
      body: "{}",
    });
    const fresh = (await (await app.request("/api/library/site/index.json", { headers })).json()) as typeof index;
    expect(fresh.books[0]!.title).toBe("Rinominato");
  });

  it("cover URLs are https on a public host and keep the origin on loopback", async () => {
    await writeBook(tmp.dataDir, { id: "ab12cd34", title: "Il giardino", authors: ["Ada Esempio"], topic: "narrativa", status: "to-read" });
    await saveCover(tmp.dataDir, "ab12cd34", new Uint8Array([1, 2, 3, 4]));
    const services = fakeServices({
      ctx: { logger: silentLogger, cacheDir: "/nonexistent-cache", dataDir: tmp.dataDir } as unknown as ServiceContext,
    });
    const app = createApp(services, CONFIG, { access: async (_c, next) => next() }); // the hosted API checks access itself
    const urlFor = async (origin: string) => {
      const res = await app.request(`${origin}/api/library/site/index.json`, { headers: { host: new URL(origin).host } });
      return ((await res.json()) as { books: { coverUrl: string }[] }).books[0]!.coverUrl;
    };
    expect(await urlFor("http://api.example.com")).toMatch(/^https:\/\/api\.example\.com\//);
    expect(await urlFor("http://127.0.0.1:8788")).toMatch(/^http:\/\/127\.0\.0\.1:8788\//);
  });
});
