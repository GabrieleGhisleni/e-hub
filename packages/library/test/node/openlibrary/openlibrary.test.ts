import { describe, expect, it, vi } from "vitest";
import {
  RateLimiter,
  downloadOpenLibraryCover,
  findOpenLibraryCover,
  findOpenLibraryCoverDetailed,
} from "../../../src/node/openlibrary/index.ts";

type Handler = (url: string) => Response | Promise<Response>;
function mockFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("findOpenLibraryCover", () => {
  it("finds by ISBN", async () => {
    const { fn, calls } = mockFetch(() => json({ title: "Atomic", covers: [-1, 1234] }));
    const result = await findOpenLibraryCover({ isbn: "9780735211292", title: "x" }, { fetch: fn });
    expect(result).toMatchObject({ coverId: 1234, matchedBy: "isbn", needsConfirmation: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://openlibrary.org/isbn/9780735211292.json");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^e-library\/1\.0/);
    expect(JSON.stringify(headers)).not.toMatch(/@/);
  });

  it("falls back to the ISBN search, then title+author, which needs confirmation", async () => {
    const { fn, calls } = mockFetch((url) => {
      if (url.includes("/isbn/")) return json({ covers: [-1] });
      if (url.includes("isbn=")) return json({ docs: [{ title: "No cover" }] });
      return json({
        docs: [
          { title: "Other", cover_i: 7, author_name: ["Zed"] },
          { title: "Atomic Habits", cover_i: 99, author_name: ["James Clear"] },
        ],
      });
    });
    const result = await findOpenLibraryCover(
      { isbn: "9780735211292", title: "Atomic Habits", authors: ["James Clear"] },
      { fetch: fn },
    );
    expect(result).toEqual({
      coverId: 99,
      matchedBy: "title-author",
      needsConfirmation: true,
      olTitle: "Atomic Habits",
      olAuthors: ["James Clear"],
    });
    const last = new URL(calls.at(-1)!.url);
    expect(last.searchParams.get("title")).toBe("Atomic Habits");
    expect(last.searchParams.get("author")).toBe("James Clear");
    expect(last.searchParams.get("limit")).toBe("5");
  });

  it("returns null with a reason on 404, 5xx, bad JSON, network error and timeout", async () => {
    const cases: [string, Handler][] = [
      ["404", () => new Response("", { status: 404 })],
      ["HTTP 503", () => new Response("", { status: 503 })],
      ["invalid JSON", () => new Response("<html>", { status: 200 })],
      [
        "network",
        () => {
          throw new TypeError("boom");
        },
      ],
    ];
    for (const [reason, handler] of cases) {
      const { fn } = mockFetch(handler);
      const r = await findOpenLibraryCoverDetailed({ isbn: "9780735211292" }, { fetch: fn });
      expect(r.match).toBeNull();
      expect(r.failures.length).toBeGreaterThan(0);
      if (reason !== "404")
        expect(r.failures.join(" ")).toContain(reason === "network" ? "boom" : reason);
    }
    const hanging = (async (_u: unknown, init?: RequestInit) =>
      new Promise((_, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const t = await findOpenLibraryCoverDetailed({ title: "x" }, { fetch: hanging, timeoutMs: 20 });
    expect(t.match).toBeNull();
    expect(t.failures.join(" ")).toContain("timeout");
  });

  it("awaits the limiter before each request", async () => {
    const acquire = vi.fn(async () => {});
    const { fn, calls } = mockFetch((url) =>
      url.includes("/isbn/") ? json({ covers: [] }) : json({ docs: [] }),
    );
    await findOpenLibraryCover(
      { isbn: "9780735211292", title: "t" },
      { fetch: fn, limiter: { acquire } },
    );
    expect(acquire).toHaveBeenCalledTimes(calls.length);
    expect(calls.length).toBe(3);
  });
});

describe("downloadOpenLibraryCover", () => {
  it("returns bytes", async () => {
    const { fn, calls } = mockFetch(() => new Response(new Uint8Array(5000)));
    const bytes = await downloadOpenLibraryCover(42, { fetch: fn });
    expect(bytes?.length).toBe(5000);
    expect(calls[0]!.url).toBe("https://covers.openlibrary.org/b/id/42-L.jpg?default=false");
  });
  it("returns null for 404, tiny placeholders and failures", async () => {
    expect(
      await downloadOpenLibraryCover(1, {
        fetch: mockFetch(() => new Response("", { status: 404 })).fn,
      }),
    ).toBeNull();
    expect(
      await downloadOpenLibraryCover(1, {
        fetch: mockFetch(() => new Response(new Uint8Array(43))).fn,
      }),
    ).toBeNull();
    expect(
      await downloadOpenLibraryCover(1, {
        fetch: mockFetch(() => {
          throw new Error("x");
        }).fn,
      }),
    ).toBeNull();
  });
});

describe("RateLimiter", () => {
  it("delays when the window is full", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const limiter = new RateLimiter({
      max: 2,
      windowMs: 1000,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    await limiter.acquire();
    await limiter.acquire();
    expect(sleeps).toEqual([]);
    await limiter.acquire();
    expect(sleeps).toEqual([1000]);
  });
});
