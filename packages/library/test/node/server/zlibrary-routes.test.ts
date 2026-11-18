import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../src/node/server/app.ts";
import type { ServiceContext, Services } from "../../../src/node/services/index.ts";
import { silentLogger } from "../../../src/node/services/index.ts";
import type { ElibConfig } from "../../../src/shared/config.ts";
import { ZlibraryError, type ZlibraryClient } from "../../../src/node/zlibrary/index.ts";
import { ZlibraryStatusResponseSchema, zlibraryPaths } from "../../../src/shared/zlibrary.ts";

const UI = "http://127.0.0.1:5173";
const HEADERS = { host: "127.0.0.1:5173", origin: UI, "sec-fetch-site": "same-origin" };
const config = { server: { port: 8787, allowedOrigins: [UI] } } as unknown as Pick<
  ElibConfig,
  "server"
>;

describe("Z-Library routes", () => {
  let cacheDir: string;
  let client: {
    configured: boolean;
    accountEmail: string | null;
    restore: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    baseUrl: string;
    quota: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    download: ReturnType<typeof vi.fn>;
  };
  let analyzeUpload: ReturnType<typeof vi.fn>;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    cacheDir = await mkdtemp(path.join(tmpdir(), "zlib-routes-"));
    client = {
      configured: false,
      accountEmail: null,
      restore: vi.fn(async () => {}),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      baseUrl: "https://z-library.example",
      quota: vi.fn(),
      search: vi.fn(),
      download: vi.fn(),
    };
    analyzeUpload = vi.fn(async (input: { fileName: string }) => ({
      uploadId: "u1",
      fileName: input.fileName,
    }));
    const services = {
      ctx: {
        cacheDir,
        dataDir: cacheDir,
        logger: silentLogger,
        limits: { epubMaxBytes: 1024 * 1024 },
      } as unknown as ServiceContext,
      analyzeUpload,
    } as unknown as Services;
    app = createApp(services, config, { zlibrary: client as unknown as ZlibraryClient });
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  const post = (urlPath: string, body: unknown) =>
    app.request(`http://127.0.0.1:8787${urlPath}`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("status when not configured: 200, no quota call", async () => {
    const res = await app.request(`http://127.0.0.1:8787${zlibraryPaths.status}`, {
      headers: HEADERS,
    });
    expect(res.status).toBe(200);
    const body = ZlibraryStatusResponseSchema.parse(await res.json());
    expect(body).toEqual({
      configured: false,
      account: null,
      baseUrl: "https://z-library.example",
      quota: null,
      error: null,
    });
    expect(client.quota).not.toHaveBeenCalled();
  });

  it("session: POST signs in with the credentials, DELETE forgets the session", async () => {
    client.accountEmail = "me@example.com";
    const login = await app.request(`http://127.0.0.1:8787${zlibraryPaths.session}`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ email: "me@example.com", password: "pw" }),
    });
    expect(login.status).toBe(200);
    expect(client.connect).toHaveBeenCalledWith("me@example.com", "pw");
    expect(JSON.stringify(await login.json())).not.toContain("pw");
    const out = await app.request(`http://127.0.0.1:8787${zlibraryPaths.session}`, {
      method: "DELETE",
      headers: HEADERS,
    });
    expect(out.status).toBe(200);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it("session: a wrong login is a 502 and the password is not in the answer", async () => {
    client.connect.mockRejectedValue(new ZlibraryError("auth", "Accesso a Z-Library non riuscito: no."));
    const res = await app.request(`http://127.0.0.1:8787${zlibraryPaths.session}`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ email: "me@example.com", password: "segreto" }),
    });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("segreto");
  });

  it("status when configured but the quota call fails: 200 with the error message", async () => {
    client.configured = true;
    client.quota.mockRejectedValue(new ZlibraryError("auth", "Sessione rifiutata."));
    const res = await app.request(`http://127.0.0.1:8787${zlibraryPaths.status}`, {
      headers: HEADERS,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      configured: true,
      account: null,
      baseUrl: "https://z-library.example",
      quota: null,
      error: "Sessione rifiutata.",
    });
  });

  it("search rejects an invalid body with 400 invalid-request", async () => {
    const res = await post(zlibraryPaths.search, { query: "   " });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid-request");
    expect(client.search).not.toHaveBeenCalled();
  });

  it("search passes the validated request to the client", async () => {
    client.search.mockResolvedValue({
      books: [],
      page: 2,
      totalPages: 3,
      totalItems: 80,
      filteredOut: 0,
    });
    const res = await post(zlibraryPaths.search, { query: "dune", page: 2 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      books: [],
      page: 2,
      totalPages: 3,
      totalItems: 80,
      filteredOut: 0,
    });
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "dune", page: 2, extensions: ["EPUB"], order: "bestmatch" }),
    );
  });

  it("a limit error from the client becomes 429 zlibrary-limit", async () => {
    client.search.mockRejectedValue(new ZlibraryError("limit", "Limite raggiunto."));
    const res = await post(zlibraryPaths.search, { query: "dune" });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error).toEqual({ code: "zlibrary-limit", message: "Limite raggiunto." });
  });

  it("a not-configured error becomes 503 zlibrary-not-configured", async () => {
    client.search.mockRejectedValue(
      new ZlibraryError("not-configured", "Manca la configurazione."),
    );
    const res = await post(zlibraryPaths.search, { query: "dune" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "zlibrary-not-configured",
    );
  });

  it("a successful epub download returns the raw bytes as an attachment", async () => {
    const bytes = new Uint8Array([80, 75, 3, 4, 9]);
    client.download.mockResolvedValue({
      bytes,
      extension: "epub",
      displayName: "Autore: Titolo à",
    });
    const res = await post(zlibraryPaths.epub("123", "abc"), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).toMatch(/\.epub$/);
    expect(client.download).toHaveBeenCalledWith("123", "abc", 1024 * 1024, "epub");
  });

  it("epub of a non-EPUB book is refused with 400 not-an-epub", async () => {
    client.download.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      extension: "pdf",
      displayName: "Autore - Titolo",
    });
    const res = await post(zlibraryPaths.epub("123", "abc"), {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("not-an-epub");
    expect(body.error.message).toBe("Solo gli EPUB possono essere scaricati: questo libro è PDF.");
    expect(client.download).toHaveBeenCalledWith("123", "abc", 1024 * 1024, "epub");
  });

  it("stage of an EPUB hands the bytes to analyzeUpload under a safe name", async () => {
    client.download.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      extension: "epub",
      displayName: "Autore: Titolo/Lungo",
    });
    const res = await post(zlibraryPaths.stage("123", "abc"), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uploadId: "u1", fileName: "Autore Titolo Lungo.epub" });
    expect(analyzeUpload).toHaveBeenCalledWith({
      fileName: "Autore Titolo Lungo.epub",
      bytes: new Uint8Array([1, 2, 3]),
    });
  });

  it("a client failure (e.g. invalid book id) becomes 502 zlibrary-failed", async () => {
    client.download.mockRejectedValue(
      new ZlibraryError("failed", "Identificativo del libro non valido."),
    );
    const res = await post(zlibraryPaths.stage("x", "y"), {});
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("zlibrary-failed");
  });
});
