/**
 * Local write server for explorations, mounted in the Vite dev server only (never in the production build):
 *
 *   GET    /api/explore                              → { explorations }
 *   GET    /api/explore/library-books                → { books: LibraryBookRef[] }
 *   GET    /api/explore/:id                          → Exploration
 *   POST   /api/explore                              { title, question, books? } → 201 Exploration
 *   PATCH  /api/explore/:id                          { title?, question?, summary?, status? } → Exploration
 *   POST   /api/explore/:id/books                    { bookId } → 201 Exploration
 *   POST   /api/explore/:id/epub                     raw application/epub+zip, header x-file-name → 201 Exploration
 *                                                   (starts the summary of the new explore book in the background)
 *   DELETE /api/explore/:id/books/:bookId            → Exploration
 *   GET    /api/explore/:id/summaries                → { books: BookSummaryStatus[] }
 *   POST   /api/explore/:id/books/:bookId/summary    { } → 202 { state: "running" } (explore books only; restarts)
 *   PUT    /api/explore/:id/verdicts/:bookId         { decision, chapters?, reason } → Exploration
 *   POST   /api/explore/:id/notes                    { id?, body, book? } → 201 Exploration
 *   PATCH  /api/explore/:id/notes/:noteId            { body } → Exploration
 *   DELETE /api/explore/:id/notes/:noteId            → Exploration
 *   POST   /api/explore/:id/journal                  { text } → 201 Exploration
 *   PUT    /api/explore/:id/notebook                 { body } (empty clears) → Exploration
 *   POST   /api/explore/:id/notebook/append          { text } → Exploration
 *   POST   /api/explore/kobo                         { ids?, tags?, decisions?, topic?, dryRun? } → { plan, reports, failures }
 *                                                   (explore books → library under `topic` → Kobo)
 *   GET    /api/explore/topics                      → { topics: { id, label }[] } (library topics)
 *
 * Writes come from the app, so they are recorded with `via: "app"`. Error bodies: `{ error, code, details? }`.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z, ZodError } from "zod";
import {
  ExploreError,
  ExplorationPatch,
  VerdictInput,
  type LibraryDeps,
  type SummaryLogger,
  addExploreBook,
  addJournal,
  addLibraryBook,
  addNote,
  appendNotebook,
  createExploration,
  listExplorations,
  addBooksToLibraryAndKobo,
  planKoboBooks,
  readExploration,
  removeBook,
  removeNote,
  setNotebook,
  setVerdict,
  summaryStatuses,
  updateExploration,
  updateNote,
  withLibraryDeps,
} from "../node/index.ts";
import {
  BookId,
  JournalEntry,
  Tag,
  VerdictDecision,
  MAX_EPUB_BYTES,
  MAX_NOTEBOOK_LENGTH,
  Exploration,
  ExplorationId,
  Note,
  formatIssues,
} from "../schema.ts";

const MAX_JSON_BYTES = 256 * 1024;
/** 100k characters of UTF-8 (up to 3 bytes each, more when escaped in JSON) do not fit in the 256 KB limit. */
const MAX_NOTEBOOK_JSON_BYTES = 1024 * 1024;

const CreateBody = z.strictObject({
  title: Exploration.shape.title,
  question: Exploration.shape.question,
  books: z.array(BookId).max(30).optional(),
});
const KoboBody = z.strictObject({
  ids: z.array(ExplorationId).max(200).optional(),
  tags: z.array(Tag).max(20).optional(),
  decisions: z.array(VerdictDecision).max(4).optional(),
  /** Library topic ID: required unless `dryRun`. */
  topic: z.string().trim().min(1).max(80).optional(),
  dryRun: z.boolean().optional(),
});
const AddBookBody = z.strictObject({ bookId: BookId });
const NoteBody = z.strictObject({
  id: z.uuid().optional(),
  body: Note.shape.body,
  book: BookId.optional(),
});
const NoteEditBody = z.strictObject({ body: Note.shape.body });
const JournalBody = z.strictObject({ text: JournalEntry.shape.text });
const NotebookBody = z.strictObject({
  body: z.string().max(MAX_NOTEBOOK_LENGTH, `Il quaderno supera ${MAX_NOTEBOOK_LENGTH} caratteri`),
});
const NotebookAppendBody = z.strictObject({
  text: z.string().max(MAX_NOTEBOOK_LENGTH, `Il testo supera ${MAX_NOTEBOOK_LENGTH} caratteri`),
});

class BadRequest extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const EPUB_ROUTE = /^\/api\/explore\/[^/]+\/epub$/;
const NOTEBOOK_ROUTE = /^\/api\/explore\/[^/]+\/notebook(\/append)?$/;

/**
 * The server writes files that end up in a public repo, so every request must come from the app itself: loopback
 * `Host` (DNS rebinding), and for writes a body type of `application/json` (or the EPUB upload) plus a same-origin
 * `Origin`.
 */
const localOnly: MiddlewareHandler = async (c, next) => {
  const host = c.req.header("host");
  if (host === undefined || !LOOPBACK_HOST.test(host)) {
    return c.json(
      { error: "Host non consentito: il server accetta solo localhost.", code: "forbidden-host" },
      403,
    );
  }
  if (WRITE_METHODS.has(c.req.method)) {
    const upload = c.req.method === "POST" && EPUB_ROUTE.test(c.req.path);
    if (c.req.method !== "DELETE") {
      const type = c.req.header("content-type") ?? "";
      const accepted = upload
        ? /^application\/epub\+zip\s*(;|$)/i.test(type)
        : /^application\/json\s*(;|$)/i.test(type);
      if (!accepted) {
        return c.json(
          {
            error: upload
              ? "Il caricamento richiede Content-Type: application/epub+zip."
              : "Le scritture richiedono Content-Type: application/json.",
            code: "unsupported-media-type",
          },
          415,
        );
      }
    }
    const origin = c.req.header("origin");
    if (origin === undefined || origin.toLowerCase() !== `http://${host}`.toLowerCase()) {
      return c.json(
        { error: "Origin non consentito per le scritture.", code: "forbidden-origin" },
        403,
      );
    }
  }
  await next();
};

async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new BadRequest("Il corpo della richiesta non è JSON valido.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new BadRequest("Richiesta non valida.", formatIssues(result.error));
  }
  return result.data;
}

/** Validated path parameter; anything malformed is a 400 before it reaches the repo. */
function param(c: Context, name: string, schema: z.ZodType): string {
  const result = schema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new BadRequest(`Parametro «${name}» non valido.`, formatIssues(result.error));
  }
  return result.data as string;
}

const explorationId = (c: Context) => param(c, "id", ExplorationId);

/** Summaries run in the dev server: their progress and failures go to the terminal. */
const summaryLogger: SummaryLogger = {
  info: (message) => console.info(`[explore] ${message}`),
  warn: (message) => console.warn(`[explore] ${message}`),
};

function handleError(error: unknown, c: Context): Response {
  if (error instanceof BadRequest) {
    return c.json({ error: error.message, code: "bad-request", details: error.details }, 400);
  }
  if (error instanceof ZodError) {
    return c.json(
      { error: "Richiesta non valida.", code: "bad-request", details: formatIssues(error) },
      400,
    );
  }
  if (error instanceof ExploreError) {
    const status = {
      "not-found": 404,
      conflict: 409,
      "already-exists": 409,
      "invalid-file": 500,
      "invalid-input": 422,
    } as const;
    return c.json(
      { error: error.message, code: error.code, details: error.details },
      status[error.code],
    );
  }
  console.error("[explore] unexpected error:", error instanceof Error ? error.message : error);
  return c.json({ error: "Errore interno del server.", code: "internal" }, 500);
}

/** `x-file-name`: URI-encoded, reduced to a plain file name (no folders, no control characters). */
function uploadFileName(c: Context): string {
  const raw = c.req.header("x-file-name");
  if (!raw) throw new BadRequest("Manca l'intestazione x-file-name con il nome del file.");
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new BadRequest("Intestazione x-file-name non valida.");
  }
  const name = path.posix.basename(decoded.replace(/\\/g, "/")).replace(/[\u0000-\u001f]/g, "");
  if (name.length === 0 || name.length > 300) {
    throw new BadRequest("Nome del file non valido (1-300 caratteri).");
  }
  return name;
}

export interface ExploreAppOptions {
  /** Library dependencies (tests pass fakes; the default is the library facade). */
  deps?: Partial<LibraryDeps>;
  /** Request check for /api/explore (default: loopback only). The hosted server passes its own (docs/hosting.md). */
  access?: MiddlewareHandler;
}

export function createExploreApp(options: ExploreAppOptions = {}): Hono {
  const app = new Hono();
  const deps = withLibraryDeps(options.deps);

  app.onError(handleError);
  app.notFound((c) => c.json({ error: "Endpoint inesistente.", code: "not-found" }, 404));
  const access = options.access ?? localOnly;
  app.use("/api/explore/*", access);
  app.use("/api/explore", access);

  // Body limits: 256 KB for JSON writes; the notebook routes and the EPUB upload have their own, larger limits
  // (see their routes). Only on requests with a body (the limiter reads the stream, which a bodyless DELETE does
  // not have).
  const jsonLimit = bodyLimit({
    maxSize: MAX_JSON_BYTES,
    onError: (c) => c.json({ error: "Richiesta troppo grande.", code: "too-large" }, 413),
  });
  const notebookLimit = bodyLimit({
    maxSize: MAX_NOTEBOOK_JSON_BYTES,
    onError: (c) => c.json({ error: "Il quaderno è troppo grande.", code: "too-large" }, 413),
  });
  const epubLimit = bodyLimit({
    maxSize: MAX_EPUB_BYTES,
    onError: (c) =>
      c.json({ error: "L'EPUB supera la dimensione massima (100 MB).", code: "too-large" }, 413),
  });
  const limitJson: MiddlewareHandler = (c, next) =>
    EPUB_ROUTE.test(c.req.path) || NOTEBOOK_ROUTE.test(c.req.path) ? next() : jsonLimit(c, next);
  app.on(["POST", "PATCH"], ["/api/explore", "/api/explore/*"], limitJson);

  // Registered before `/api/explore/:id`, so the word is not taken for an ID.
  app.get("/api/explore/library-books", async (c) =>
    c.json({ books: await deps.listLibraryBookRefs() }),
  );

  app.get("/api/explore/topics", async (c) => c.json({ topics: await deps.listLibraryTopics() }));

  // Explore books of the chosen explorations → library (same ID, under `topic`) → Kobo.
  app.post("/api/explore/kobo", async (c) => {
    const input = await readJson(c, KoboBody);
    const plan = planKoboBooks(await listExplorations(), {
      ...(input.ids ? { ids: input.ids } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
      ...(input.decisions ? { decisions: input.decisions } : {}),
    });
    if (input.dryRun === true || plan.books.length === 0) return c.json({ plan, reports: [], failures: [] });
    if (!input.topic) {
      throw new ExploreError("invalid-input", "Scegli l'argomento della libreria per i libri.");
    }
    const topics = await deps.listLibraryTopics();
    if (!topics.some((t) => t.id === input.topic)) {
      throw new ExploreError("invalid-input", `Argomento «${input.topic}» non trovato in libreria.`);
    }
    return c.json({ plan, ...(await addBooksToLibraryAndKobo(plan, input.topic, deps)) });
  });

  app.get("/api/explore", async (c) => c.json({ explorations: await listExplorations() }));

  app.get("/api/explore/:id", async (c) => c.json(await readExploration(explorationId(c))));

  app.post("/api/explore", async (c) => {
    const input = await readJson(c, CreateBody);
    const exploration = await createExploration(
      { title: input.title, question: input.question, books: input.books ?? [] },
      new Date(),
      deps,
    );
    return c.json(exploration, 201);
  });

  app.patch("/api/explore/:id", async (c) => {
    const id = explorationId(c);
    const patch = await readJson(c, ExplorationPatch);
    return c.json(await updateExploration(id, patch));
  });

  app.post("/api/explore/:id/books", async (c) => {
    const id = explorationId(c);
    const input = await readJson(c, AddBookBody);
    return c.json(await addLibraryBook(id, input.bookId, deps), 201);
  });

  app.post("/api/explore/:id/epub", epubLimit, async (c) => {
    const id = explorationId(c);
    const fileName = uploadFileName(c);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const exploration = await addExploreBook(id, { bytes, fileName }, deps);
    // The explore sources with this file (the new one, or the same file re-imported): their summary starts in the
    // background. The start skips a book whose summary already exists.
    const md5 = createHash("md5").update(bytes).digest("hex");
    for (const source of exploration.sources) {
      if (source.origin === "explore" && source.epub?.md5 === md5) {
        deps.startExploreSummaryInBackground(source.id, { logger: summaryLogger });
      }
    }
    return c.json(exploration, 201);
  });

  app.get("/api/explore/:id/summaries", async (c) => {
    const exploration = await readExploration(explorationId(c));
    const books = await summaryStatuses(exploration.sources, deps);
    return c.json({ books });
  });

  app.post("/api/explore/:id/books/:bookId/summary", async (c) => {
    const id = explorationId(c);
    const bookId = param(c, "bookId", BookId);
    const exploration = await readExploration(id);
    const source = exploration.sources.find((s) => s.id === bookId);
    if (!source) throw new ExploreError("not-found", "Libro non trovato in questa esplorazione.");
    if (source.origin !== "explore") {
      throw new BadRequest("Solo i libri esplorati hanno una sintesi da rigenerare.");
    }
    deps.startExploreSummaryInBackground(bookId, { force: true, logger: summaryLogger });
    return c.json({ state: "running" }, 202);
  });

  app.delete("/api/explore/:id/books/:bookId", async (c) => {
    const id = explorationId(c);
    const bookId = param(c, "bookId", BookId);
    return c.json(await removeBook(id, bookId));
  });

  app.put("/api/explore/:id/verdicts/:bookId", async (c) => {
    const id = explorationId(c);
    const bookId = param(c, "bookId", BookId);
    const input = await readJson(c, VerdictInput);
    return c.json(await setVerdict(id, bookId, input, "app"));
  });

  app.post("/api/explore/:id/notes", async (c) => {
    const id = explorationId(c);
    const input = await readJson(c, NoteBody);
    return c.json(await addNote(id, input, "app"), 201);
  });

  app.patch("/api/explore/:id/notes/:noteId", async (c) => {
    const id = explorationId(c);
    const noteId = param(c, "noteId", z.uuid());
    const input = await readJson(c, NoteEditBody);
    return c.json(await updateNote(id, noteId, input.body));
  });

  app.delete("/api/explore/:id/notes/:noteId", async (c) => {
    const id = explorationId(c);
    const noteId = param(c, "noteId", z.uuid());
    return c.json(await removeNote(id, noteId));
  });

  app.post("/api/explore/:id/journal", async (c) => {
    const id = explorationId(c);
    const input = await readJson(c, JournalBody);
    return c.json(await addJournal(id, input.text, "app"), 201);
  });

  app.put("/api/explore/:id/notebook", notebookLimit, async (c) => {
    const id = explorationId(c);
    const input = await readJson(c, NotebookBody);
    return c.json(await setNotebook(id, input.body, "app"));
  });

  app.post("/api/explore/:id/notebook/append", notebookLimit, async (c) => {
    const id = explorationId(c);
    const input = await readJson(c, NotebookAppendBody);
    return c.json(await appendNotebook(id, input.text, "app"));
  });

  return app;
}
