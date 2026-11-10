import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/node/server/app.ts";
import { allowedHosts } from "../../../src/node/server/security.ts";
import {
  type ServiceContext,
  type Services,
  silentLogger,
} from "../../../src/node/services/index.ts";
import { API_LIMITS, emptyReconcileReport } from "../../../src/shared/api.ts";

const CONFIG = {
  server: { port: 8787, allowedOrigins: ["http://127.0.0.1:5173", "http://localhost:5173"] },
};
const UI = "http://127.0.0.1:5173";

/** Services that never touch disk: only what the security tests call is implemented. */
export function fakeServices(overrides: Partial<Services> = {}): Services {
  const unused = async () => {
    throw new Error("not used in this test");
  };
  return {
    ctx: { logger: silentLogger } as unknown as ServiceContext,
    analyzeUpload: unused,
    readUploadCover: unused,
    discardUpload: unused,
    cleanupStaleUploads: async () => 0,
    createBook: unused,
    updateBook: unused,
    bulkUpdate: unused,
    deleteBook: unused,
    coverCandidates: unused,
    readBookCoverCandidate: unused,
    setBookCover: unused,
    listTopics: async () => ({ topics: [{ id: "unsorted", label: "Da smistare", bookCount: 0 }] }),
    addTopic: async (label) => ({
      topic: { id: "nuovo", label },
      topics: [],
      report: emptyReconcileReport(),
    }),
    renameTopic: unused,
    deleteTopic: unused,
    ...overrides,
  };
}

interface Req {
  host?: string | null;
  origin?: string;
  fetchSite?: string;
  json?: unknown;
}

function request(app: ReturnType<typeof createApp>, method: string, path: string, opts: Req = {}) {
  const headers: Record<string, string> = {};
  if (opts.host !== null) headers.host = opts.host ?? "127.0.0.1:8787";
  if (opts.origin) headers.origin = opts.origin;
  if (opts.fetchSite) headers["sec-fetch-site"] = opts.fetchSite;
  if (opts.json !== undefined) headers["content-type"] = "application/json";
  return app.request(`http://127.0.0.1:8787${path}`, {
    method,
    headers,
    ...(opts.json !== undefined ? { body: JSON.stringify(opts.json) } : {}),
  });
}

async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("security middleware", () => {
  const app = createApp(fakeServices(), CONFIG);

  it("allowed hosts: the server's own port and the UI origins (Vite proxy keeps the browser's Host)", () => {
    expect([...allowedHosts({ port: 8787, allowedOrigins: CONFIG.server.allowedOrigins })]).toEqual(
      ["127.0.0.1:8787", "localhost:8787", "127.0.0.1:5173", "localhost:5173"],
    );
  });

  it.each([
    ["127.0.0.1:8787", 200],
    ["localhost:8787", 200],
    ["127.0.0.1:5173", 200],
    ["LOCALHOST:5173", 200],
    ["evil.example:8787", 403],
    ["127.0.0.1", 403],
    ["127.0.0.1:9999", 403],
    ["[::1]:8787", 403],
  ])("Host %s → %i", async (host, status) => {
    const res = await request(app, "GET", "/api/library/health", { host });
    expect(res.status).toBe(status);
    if (status === 403) expect(await code(res)).toBe("forbidden-host");
  });

  it("rejects a missing Host", async () => {
    const res = await request(app, "GET", "/api/library/health", { host: null });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("forbidden-host");
  });

  it("rejects a foreign Origin, also on GET and on preflights", async () => {
    for (const [method, origin] of [
      ["GET", "https://evil.example"],
      ["GET", "null"],
      ["POST", "http://127.0.0.1:8787"],
      ["OPTIONS", "https://evil.example"],
    ] as const) {
      const res = await request(app, method, "/api/library/topics", {
        origin,
        ...(method === "POST" ? { json: { label: "X" } } : {}),
      });
      expect(res.status, `${method} ${origin}`).toBe(403);
      expect(await code(res)).toBe("forbidden-origin");
    }
  });

  it("requires an allowed Origin on every non-GET/HEAD request", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE", "OPTIONS"]) {
      const res = await request(app, method, "/api/library/topics", { json: { label: "X" } });
      expect(res.status, method).toBe(403);
      expect(await code(res)).toBe("origin-required");
    }
    const ok = await request(app, "POST", "/api/library/topics", { origin: UI, json: { label: "Nuovo" } });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { topic: unknown }).topic).toEqual({
      id: "nuovo",
      label: "Nuovo",
    });
  });

  it.each([
    ["cross-site", 403],
    ["same-site", 403],
    ["same-origin", 200],
    ["none", 200],
  ])("Sec-Fetch-Site %s → %i", async (fetchSite, status) => {
    const res = await request(app, "GET", "/api/library/topics", { fetchSite });
    expect(res.status).toBe(status);
    if (status === 403) expect(await code(res)).toBe("forbidden-fetch-site");
  });

  it("a browser request from the UI through the Vite proxy passes", async () => {
    const res = await request(app, "POST", "/api/library/topics", {
      host: "localhost:5173",
      origin: "http://localhost:5173",
      fetchSite: "same-origin",
      json: { label: "Nuovo" },
    });
    expect(res.status).toBe(201);
  });

  it("never sends CORS headers; sets nosniff and no-store", async () => {
    const responses = await Promise.all([
      request(app, "GET", "/api/library/health", { origin: UI }),
      request(app, "OPTIONS", "/api/library/topics", { origin: UI }),
      request(app, "GET", "/api/library/health", { origin: "https://evil.example" }),
    ]);
    for (const res of responses) {
      for (const [name] of res.headers) expect(name.startsWith("access-control-")).toBe(false);
    }
    expect(responses[0]!.headers.get("x-content-type-options")).toBe("nosniff");
    expect(responses[0]!.headers.get("cache-control")).toBe("no-store");
  });
});

describe("route validation (fake services)", () => {
  it("JSON bodies: 415 when not JSON, 400 with Zod issues, 413 beyond the limit, 404 unknown route", async () => {
    const app = createApp(fakeServices(), CONFIG, { limits: { jsonMaxBytes: 200 } });
    const post = (path: string, body: string, type = "application/json") =>
      app.request(`http://127.0.0.1:8787${path}`, {
        method: "POST",
        headers: { host: "127.0.0.1:8787", origin: UI, "content-type": type },
        body,
      });

    let res = await post("/api/library/topics", "label=x", "application/x-www-form-urlencoded");
    expect([res.status, await code(res)]).toEqual([415, "unsupported-media-type"]);
    res = await post("/api/library/topics", "{not json");
    expect([res.status, await code(res)]).toEqual([400, "invalid-request"]);
    res = await post("/api/library/topics", JSON.stringify({ label: "   " }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: { issues: unknown[] } } };
    expect(body.error.code).toBe("invalid-request");
    expect(body.error.details.issues.length).toBeGreaterThan(0);
    res = await post("/api/library/topics", JSON.stringify({ label: "x".repeat(500) }));
    expect([res.status, await code(res)]).toEqual([413, "payload-too-large"]);
    res = await post("/api/library/books", JSON.stringify({ uploadId: "x" }));
    expect([res.status, await code(res)]).toEqual([400, "invalid-request"]);
    res = await post("/api/library/books/bulk", JSON.stringify({ ids: ["7k2m9q4t"], patch: {} }));
    expect([res.status, await code(res)]).toEqual([400, "invalid-request"]);
    res = await post("/api/library/nothing", "{}");
    expect([res.status, await code(res)]).toEqual([404, "not-found"]);
  });

  it("uploads: 415 without multipart, 400 without the file field, 413 when too large", async () => {
    const app = createApp(fakeServices(), CONFIG, {
      limits: { epubMaxBytes: API_LIMITS.epubMaxBytes },
    });
    const send = (body: string | FormData, type?: string) =>
      app.request("http://127.0.0.1:8787/api/library/uploads", {
        method: "POST",
        headers: { host: "127.0.0.1:8787", origin: UI, ...(type ? { "content-type": type } : {}) },
        body,
      });
    let res = await send("{}", "application/json");
    expect([res.status, await code(res)]).toEqual([415, "unsupported-media-type"]);
    const form = new FormData();
    form.set("other", "x");
    res = await send(form);
    expect([res.status, await code(res)]).toEqual([400, "invalid-request"]);

    const tiny = createApp(fakeServices(), CONFIG, { limits: { epubMaxBytes: 10 } });
    const big = new FormData();
    big.set("file", new File([new Uint8Array(3 * 1024 * 1024)], "big.epub"));
    res = await tiny.request("http://127.0.0.1:8787/api/library/uploads", {
      method: "POST",
      headers: { host: "127.0.0.1:8787", origin: UI },
      body: big,
    });
    expect([res.status, await code(res)]).toEqual([413, "payload-too-large"]);
  });

  it("unexpected errors become 500 internal-error", async () => {
    const app = createApp(
      fakeServices({
        listTopics: async () => {
          throw new Error("boom");
        },
      }),
      CONFIG,
    );
    const res = await request(app, "GET", "/api/library/topics");
    expect([res.status, await code(res)]).toEqual([500, "internal-error"]);
  });
});
