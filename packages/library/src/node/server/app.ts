/**
 * The local API (contract in src/shared/api.ts): a thin HTTP layer over the services. Testable with `app.request()`.
 */
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  API_LIMITS,
  BookPatchSchema,
  BulkUpdateRequestSchema,
  SaveNotesRequestSchema,
  CreateBookRequestSchema,
  type HealthResponse,
  SetCoverRequestSchema,
  SummarizeRequestSchema,
  TopicLabelRequestSchema,
} from "../../shared/api.ts";
import type { ElibConfig } from "../../shared/config.ts";
import { InvalidUploadIdError } from "../cache/index.ts";
import { InvalidBookIdError } from "../repo/index.ts";
import { ServiceError, type Services, startSummaryInBackground } from "../services/index.ts";
import { ZlibraryClient, zlibraryEnvFrom } from "../zlibrary/index.ts";
import { currentUserId, readUserSettings, userScopedDir } from "@ehub/store";
import { apiError, jsonBody } from "./http.ts";
import { securityConfig, securityMiddleware } from "./security.ts";
import { registerSettingsRoutes } from "./settings-routes.ts";
import { registerSiteRoutes } from "./site-routes.ts";
import { registerZlibraryRoutes } from "./zlibrary-routes.ts";

export interface AppOptions {
  /** Request size limits (default `API_LIMITS`). */
  limits?: Partial<typeof API_LIMITS>;
  /** Z-Library client (default: built from the environment, see `zlibraryEnvFrom`). Tests inject a fake. */
  zlibrary?: ZlibraryClient;
  /** Request check (default: the local Host/Origin checks). The hosted server passes its own (docs/hosting.md). */
  access?: MiddlewareHandler;
  /** Public URL of the API, used for the absolute cover URLs of the site data (default: the request origin). */
  publicUrl?: string;
}

/** Room for the multipart envelope around the file. */
const MULTIPART_OVERHEAD = 1024 * 1024;

export function createApp(
  services: Services,
  config: Pick<ElibConfig, "server">,
  options: AppOptions = {},
): Hono {
  const limits = { ...API_LIMITS, ...options.limits };
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  });
  app.use("*", options.access ?? securityMiddleware(securityConfig(config)));

  const limit = (maxSize: number) =>
    bodyLimit({
      maxSize,
      onError: (c) =>
        apiError(
          c,
          413,
          "payload-too-large",
          `Richiesta troppo grande: il limite è ${Math.round(maxSize / (1024 * 1024))} MB.`,
        ),
    });
  const jsonLimit = limit(limits.jsonMaxBytes);

  // ---- site data (hosted: the site reads it at runtime). Any write drops the cache.
  const site = registerSiteRoutes(app, {
    dataDir: services.ctx.dataDir,
    ...(options.publicUrl ? { publicUrl: options.publicUrl } : {}),
  });
  app.use("/api/library/*", async (c, next) => {
    await next();
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) site.invalidate();
  });

  app.get("/api/library/health", (c) => c.json({ ok: true } satisfies HealthResponse));

  // ---- Kobo queue (hosted setup)
  app.get("/api/library/kobo/queue", async (c) => c.json(await services.koboQueue()));
  app.post("/api/library/kobo/sync", async (c) => c.json(await services.syncKoboNow()));

  // ---- uploads
  app.post("/api/library/uploads", limit(limits.epubMaxBytes + MULTIPART_OVERHEAD), async (c) => {
    const file = await multipartFile(c, "file");
    const bytes = new Uint8Array(await file.arrayBuffer());
    return c.json(await services.analyzeUpload({ fileName: file.name, bytes }));
  });
  app.get("/api/library/uploads/:uploadId/covers/:source", async (c) =>
    webp(c, await services.readUploadCover(c.req.param("uploadId"), c.req.param("source"))),
  );
  app.delete("/api/library/uploads/:uploadId", async (c) => {
    await services.discardUpload(c.req.param("uploadId"));
    return c.body(null, 204);
  });

  // ---- books
  app.post("/api/library/books", jsonLimit, async (c) => {
    const body = await jsonBody(c, CreateBookRequestSchema);
    const created = await services.createBook(body);
    // The summary of the new book runs in the background: the 201 does not wait for it.
    startSummaryInBackground(services.ctx, created.book.id);
    return c.json(created, 201);
  });
  app.post("/api/library/books/bulk", jsonLimit, async (c) => {
    const body = await jsonBody(c, BulkUpdateRequestSchema);
    return c.json(await services.bulkUpdate(body));
  });
  app.patch("/api/library/books/:id", jsonLimit, async (c) => {
    const body = await jsonBody(c, BookPatchSchema);
    return c.json(await services.updateBook(c.req.param("id"), body));
  });
  app.delete("/api/library/books/:id", async (c) =>
    c.json(await services.deleteBook(c.req.param("id"))),
  );
  app.get("/api/library/books/:id/cover-candidates", async (c) =>
    c.json(await services.coverCandidates(c.req.param("id"))),
  );
  app.get("/api/library/books/:id/cover-candidates/:source", async (c) =>
    webp(c, await services.readBookCoverCandidate(c.req.param("id"), c.req.param("source"))),
  );
  app.put(
    "/api/library/books/:id/cover",
    limit(limits.imageMaxBytes + MULTIPART_OVERHEAD),
    async (c) => {
      const id = c.req.param("id");
      if (isMultipart(c)) {
        const image = await multipartFile(c, "image");
        return c.json(
          await services.setBookCover(id, { image: new Uint8Array(await image.arrayBuffer()) }),
        );
      }
      if (Number(c.req.header("content-length") ?? 0) > limits.jsonMaxBytes) {
        return apiError(c, 413, "payload-too-large", "Richiesta troppo grande.");
      }
      return c.json(await services.setBookCover(id, await jsonBody(c, SetCoverRequestSchema)));
    },
  );

  // ---- general notes (notes.md)
  app.put("/api/library/books/:id/notes", jsonLimit, async (c) => {
    const body = await jsonBody(c, SaveNotesRequestSchema);
    return c.json(await services.saveBookNotes(c.req.param("id"), body));
  });

  // ---- summaries (docs/chat.md §4). Literal path: `apiPaths.bookSummary(":id")` would encode the colon.
  app.post("/api/library/books/:id/summary", jsonLimit, async (c) => {
    const body = await optionalJsonBody(c, SummarizeRequestSchema);
    return c.json(await services.summarizeBook(c.req.param("id"), body));
  });

  // ---- topics
  app.get("/api/library/topics", async (c) => c.json(await services.listTopics()));
  app.post("/api/library/topics", jsonLimit, async (c) => {
    const { label } = await jsonBody(c, TopicLabelRequestSchema);
    return c.json(await services.addTopic(label), 201);
  });
  app.patch("/api/library/topics/:id", jsonLimit, async (c) => {
    const { label } = await jsonBody(c, TopicLabelRequestSchema);
    return c.json(await services.renameTopic(c.req.param("id"), label));
  });
  app.delete("/api/library/topics/:id", async (c) =>
    c.json(await services.deleteTopic(c.req.param("id"))),
  );

  registerSettingsRoutes(app, jsonLimit);

  registerZlibraryRoutes(
    app,
    services,
    options.zlibrary ?? perUserZlibrary(services.ctx.cacheDir),
    jsonLimit,
  );

  app.notFound((c) =>
    apiError(c, 404, "not-found", `Nessun endpoint ${c.req.method} ${c.req.path}.`),
  );

  app.onError((error, c) => {
    if (error instanceof ServiceError) {
      return apiError(
        c,
        error.status as ContentfulStatusCode,
        error.code,
        error.message,
        error.details,
      );
    }
    if (error instanceof InvalidUploadIdError || error instanceof InvalidBookIdError) {
      return apiError(c, 400, "invalid-request", error.message);
    }
    if (error instanceof HTTPException) {
      const status = error.status as ContentfulStatusCode;
      return apiError(
        c,
        status,
        status === 413 ? "payload-too-large" : "invalid-request",
        error.message,
      );
    }
    services.ctx.logger.error(`${c.req.method} ${c.req.path} failed`, error);
    return apiError(c, 500, "internal-error", `Errore interno: ${(error as Error).message}`);
  });

  return app;
}

function webp(c: Context, bytes: Uint8Array): Response {
  return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
    "Content-Type": "image/webp",
    "Content-Length": String(bytes.length),
  });
}

function isMultipart(c: Context): boolean {
  return (c.req.header("content-type") ?? "").toLowerCase().startsWith("multipart/form-data");
}

/** The `field` file of a multipart body: 415 when the body is not multipart, 400 when the file is missing. */
async function multipartFile(c: Context, field: string): Promise<File> {
  if (!isMultipart(c)) {
    throw new ServiceError(
      "unsupported-media-type",
      415,
      `Serve un corpo multipart/form-data con il campo "${field}".`,
    );
  }
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new ServiceError("invalid-request", 400, "Corpo multipart non leggibile.");
  }
  const file = body[field];
  if (!(file instanceof File)) {
    throw new ServiceError("invalid-request", 400, `Manca il file nel campo "${field}".`);
  }
  return file;
}

/** Like `jsonBody`, but an empty body means `{}` (every field of the schema has a default). */
async function optionalJsonBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  const text = await c.req.text();
  if (text.trim() === "") return jsonBodyFrom(schema, {});
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ServiceError("invalid-request", 400, "JSON non valido.");
  }
  return jsonBodyFrom(schema, raw);
}

function jsonBodyFrom<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ServiceError(
      "invalid-request",
      400,
      `Richiesta non valida: ${z.prettifyError(parsed.error)}`,
      { details: { issues: parsed.error.issues } },
    );
  }
  return parsed.data;
}

/**
 * Z-Library client per request. Without a user (local dev) it is the one from the environment; with one (hosted) each
 * user has their own, with the session file under their cache folder and no shared credentials from the environment.
 */
function perUserZlibrary(cacheDir: string): () => Promise<ZlibraryClient> {
  const clients = new Map<string, ZlibraryClient>();
  return async () => {
    const dir = userScopedDir(cacheDir);
    let client = clients.get(dir);
    if (!client) {
      const env = zlibraryEnvFrom();
      client = new ZlibraryClient(
        currentUserId() === null ? env : { baseUrl: env.baseUrl },
        dir,
      );
      clients.set(dir, client);
    }
    // The mirror is a personal setting and changes often: read it on every request.
    client.setBaseUrl((await readUserSettings()).zlibraryBaseUrl ?? zlibraryEnvFrom().baseUrl);
    return client;
  };
}
