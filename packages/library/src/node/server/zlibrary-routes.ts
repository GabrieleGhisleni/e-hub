/**
 * Z-Library routes of the local API (contract in src/shared/zlibrary.ts): status, search, the EPUB download (the raw
 * file as an attachment), and the EPUB staged like an upload. Registered before `app.notFound`.
 */
import type { Hono, MiddlewareHandler } from "hono";
import type { ZlibraryStatusResponse } from "../../shared/zlibrary.ts";
import { ZlibraryLoginRequestSchema, ZlibrarySearchRequestSchema, zlibraryPaths } from "../../shared/zlibrary.ts";
import { ServiceError, type Services } from "../services/index.ts";
import {
  type DownloadedFile,
  type ZlibraryClient,
  ZlibraryError,
  safeFileStem,
} from "../zlibrary/index.ts";
import { jsonBody } from "./http.ts";

const EPUB_PATH = "/api/library/zlibrary/books/:id/:hash/epub";
const STAGE_PATH = "/api/library/zlibrary/books/:id/:hash/stage";

/** Adds the Z-Library routes to `app`. `jsonLimit` is the JSON body size guard of the app. */
export function registerZlibraryRoutes(
  app: Hono,
  services: Services,
  clientOrFactory: ZlibraryClient | (() => ZlibraryClient | Promise<ZlibraryClient>),
  jsonLimit: MiddlewareHandler,
): void {
  /** One client per request: in the hosted setup each user has their own (own session file). */
  const pick = async (): Promise<ZlibraryClient> =>
    typeof clientOrFactory === "function" ? clientOrFactory() : clientOrFactory;

  app.get(zlibraryPaths.status, async (c) => {
    const client = await pick();
    await client.restore();
    const configured = client.configured;
    let quota: ZlibraryStatusResponse["quota"] = null;
    let error: string | null = null;
    if (configured) {
      try {
        quota = await client.quota();
      } catch (cause) {
        error = errorMessage(cause);
      }
    }
    const body: ZlibraryStatusResponse = { configured, account: client.accountEmail, baseUrl: client.baseUrl, quota, error };
    return c.json(body);
  });

  app.post(zlibraryPaths.session, jsonLimit, async (c) => {
    const client = await pick();
    const { email, password } = await jsonBody(c, ZlibraryLoginRequestSchema);
    await guard(() => client.connect(email, password));
    const body: ZlibraryStatusResponse = {
      configured: true,
      account: client.accountEmail,
      baseUrl: client.baseUrl,
      quota: null,
      error: null,
    };
    return c.json(body);
  });

  app.delete(zlibraryPaths.session, async (c) => {
    await (await pick()).disconnect();
    return c.json({ ok: true });
  });

  app.post(zlibraryPaths.search, jsonLimit, async (c) => {
    const client = await pick();
    const body = await jsonBody(c, ZlibrarySearchRequestSchema);
    return c.json(await guard(() => client.search(body)));
  });

  app.post(EPUB_PATH, async (c) => {
    const book = await downloadEpub(
      await pick(),
      services,
      c.req.param("id"),
      c.req.param("hash"),
      "scaricati",
    );
    const stem = `${safeFileStem(book.displayName)}.epub`;
    const asciiFallback = stem.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    return c.body(book.bytes as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": "application/epub+zip",
      "Content-Length": String(book.bytes.length),
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(stem)}`,
    });
  });

  app.post(STAGE_PATH, async (c) => {
    const book = await downloadEpub(
      await pick(),
      services,
      c.req.param("id"),
      c.req.param("hash"),
      "caricati",
    );
    const fileName = `${safeFileStem(book.displayName)}.epub`;
    const pages = Number(c.req.query("pages"));
    return c.json(
      await services.analyzeUpload(
        { fileName, bytes: book.bytes },
        Number.isInteger(pages) && pages >= 1 && pages <= 100000 ? { pages } : {},
      ),
    );
  });
}

/** Downloads the book; anything but an EPUB is refused (after the download, which the API gives no way to skip). */
async function downloadEpub(
  client: ZlibraryClient,
  services: Services,
  id: string,
  hash: string,
  purpose: string,
): Promise<DownloadedFile> {
  const book = await guard(() =>
    client.download(id, hash, services.ctx.limits.epubMaxBytes, "epub"),
  );
  const extension = book.extension.toUpperCase();
  if (extension !== "EPUB") {
    throw new ServiceError(
      "not-an-epub",
      400,
      `Solo gli EPUB possono essere ${purpose}: questo libro è ${extension}.`,
    );
  }
  return book;
}

/** Maps Z-Library failures to the API error codes (503 / 429 / 502); other errors pass through. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof ZlibraryError)) throw error;
    switch (error.kind) {
      case "not-configured":
        throw new ServiceError("zlibrary-not-configured", 503, error.message);
      case "limit":
        throw new ServiceError("zlibrary-limit", 429, error.message);
      case "wrong-format":
        throw new ServiceError("not-an-epub", 400, error.message);
      case "auth":
      case "failed":
        throw new ServiceError("zlibrary-failed", 502, error.message);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
