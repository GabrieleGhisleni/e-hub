/**
 * Local write server for notes, mounted in the Vite dev server only (never in the production build):
 *
 *   GET    /api/notes                               → { notes: Note[] }
 *   POST   /api/notes                               { id, item, body, pinned? } → 201 Note
 *   PATCH  /api/notes/:module/:itemId/:noteId       { body?, pinned?, expectedUpdatedAt? } → Note
 *   DELETE /api/notes/:module/:itemId/:noteId       → { deleted: true }
 *
 * The client generates the note ID (UUID), so an optimistic note keeps its identity once saved.
 */
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z, ZodError } from "zod";
import { NotesError, addNote, listAllNotes, removeNote, updateNote } from "../node/repo";
import { ItemId, NoteBody, NoteId, NoteItemRef, NoteModule, formatIssues } from "../schema";
import type { NoteItemRef as ItemRef } from "../types";

/**
 * Optional check of a note's text before it is written; returns reasons to refuse it (empty = OK). The app wires
 * the podcasts transcript guard here (the repo is public).
 */
export type NoteGuard = (item: Pick<ItemRef, "module" | "id">, body: string) => Promise<string[]>;

const MAX_BODY_BYTES = 256 * 1024;

const AddBody = z.strictObject({
  id: NoteId,
  item: NoteItemRef,
  body: NoteBody,
  pinned: z.boolean().optional(),
});
const PatchBody = z
  .strictObject({
    body: NoteBody.optional(),
    pinned: z.boolean().optional(),
    expectedUpdatedAt: z.string().min(1).optional(),
  })
  .refine(
    (patch) => patch.body !== undefined || patch.pinned !== undefined,
    "Niente da modificare",
  );
const RefParams = z.object({ module: NoteModule, itemId: ItemId, noteId: NoteId });

class BadRequest extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

class GuardRejected extends Error {
  constructor(readonly details: string[]) {
    super(
      "La nota contiene un estratto troppo lungo della trascrizione (massimo 20 parole di fila).",
    );
  }
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The server writes files that end up in a public repo, so every request must come from the app itself: loopback
 * `Host` (DNS rebinding), and for writes `application/json` (forces a CORS preflight) plus a same-origin `Origin`.
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
    if (
      c.req.method !== "DELETE" &&
      !/^application\/json\s*(;|$)/i.test(c.req.header("content-type") ?? "")
    ) {
      return c.json(
        {
          error: "Le scritture richiedono Content-Type: application/json.",
          code: "unsupported-media-type",
        },
        415,
      );
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
  return schema.parse(raw);
}

function parseRef(c: Context) {
  const result = RefParams.safeParse(c.req.param());
  if (!result.success)
    throw new BadRequest("Riferimento alla nota non valido.", formatIssues(result.error));
  return { module: result.data.module, itemId: result.data.itemId, noteId: result.data.noteId };
}

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
  if (error instanceof GuardRejected) {
    return c.json({ error: error.message, code: "transcript-guard", details: error.details }, 422);
  }
  if (error instanceof NotesError) {
    const status = {
      "not-found": 404,
      conflict: 409,
      "already-exists": 409,
      "invalid-file": 500,
      rejected: 422,
    } as const;
    return c.json(
      { error: error.message, code: error.code, details: error.details },
      status[error.code],
    );
  }
  console.error("[notes] unexpected error:", error instanceof Error ? error.message : error);
  return c.json({ error: "Errore interno del server.", code: "internal" }, 500);
}

export function createNotesApp(options: { guard?: NoteGuard } = {}): Hono {
  const app = new Hono();
  const guard = async (item: Pick<ItemRef, "module" | "id">, body: string) => {
    const reasons = (await options.guard?.(item, body)) ?? [];
    if (reasons.length > 0) throw new GuardRejected(reasons);
  };

  app.onError(handleError);
  app.notFound((c) => c.json({ error: "Endpoint inesistente.", code: "not-found" }, 404));
  app.use("/api/notes/*", localOnly);
  app.use("/api/notes", localOnly);
  // Only on requests with a body: on a body-less DELETE the limiter reads an empty stream, which fails inside
  // Vite's Node adapter.
  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: "Richiesta troppo grande.", code: "too-large" }, 413),
  });
  app.on(["POST", "PATCH"], ["/api/notes", "/api/notes/*"], limit);

  app.get("/api/notes", async (c) => c.json({ notes: await listAllNotes() }));

  app.post("/api/notes", async (c) => {
    const input = await readJson(c, AddBody);
    await guard(input.item, input.body);
    const note = await addNote({ ...input, pinned: input.pinned ?? false });
    return c.json(note, 201);
  });

  app.patch("/api/notes/:module/:itemId/:noteId", async (c) => {
    const ref = parseRef(c);
    const patch = await readJson(c, PatchBody);
    if (patch.body !== undefined) await guard({ module: ref.module, id: ref.itemId }, patch.body);
    return c.json(await updateNote(ref, patch));
  });

  app.delete("/api/notes/:module/:itemId/:noteId", async (c) => {
    await removeNote(parseRef(c));
    // A JSON body, not a bare 204: the Node adapter inside Vite fails on null-body responses.
    return c.json({ deleted: true });
  });

  return app;
}
