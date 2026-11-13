/**
 * Explorations repo (Node only): every change goes through here, so every write is validated against the schema
 * before it reaches the disk, `updatedAt` moves forward, and errors are `ExploreError`s with Italian messages.
 * Library access (catalog, EPUB import) is injected through `LibraryDeps`, so the tests never touch a real library.
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  BookId,
  BookSource,
  Exploration,
  ExplorationStatus,
  JournalEntry,
  MAX_EPUB_BYTES,
  MAX_NOTEBOOK_LENGTH,
  Note,
  Notebook,
  Reason,
  Verdict,
  VerdictDecision,
  type Exploration as ExplorationT,
  type BookSource as BookSourceT,
  type Via,
  explorationIdFor,
  formatIssues,
} from "../schema.ts";
import { type LibraryDeps, withLibraryDeps } from "./library.ts";
import {
  ExploreError,
  checkExplorations,
  explorationFile,
  listExplorations,
  readExplorationFile,
  withLock,
  writeExplorationFile,
} from "./store.ts";

export { ExploreError, checkExplorations, listExplorations };
export type { ExploreErrorCode } from "./store.ts";

/** Strictly later than `previous` (two writes in the same millisecond still order). */
function nextInstant(previous: string | undefined, now: Date): string {
  const at = now.getTime();
  const after = previous ? Date.parse(previous) + 1 : at;
  return new Date(Math.max(at, after)).toISOString();
}

/** Parses `value` with `schema`, turning Zod issues into an `invalid-input` error with the reasons. */
function parseInput<T extends z.ZodType>(schema: T, value: unknown, message: string): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ExploreError("invalid-input", message, formatIssues(result.error));
  return result.data;
}

function notFound(what: string): ExploreError {
  return new ExploreError("not-found", `${what} non trovata.`);
}

function sourceNotFound(): ExploreError {
  return new ExploreError("not-found", "Fonte non trovata in questa esplorazione.");
}

/**
 * Read-modify-write of one exploration under its lock. `change` returns the new content; `updatedAt` is set here.
 */
async function mutate(
  id: string,
  change: (current: ExplorationT, now: Date) => ExplorationT | Promise<ExplorationT>,
  now = new Date(),
): Promise<ExplorationT> {
  const file = explorationFile(id);
  return withLock(file, async () => {
    const current = await readExplorationFile(file);
    if (!current) throw notFound("Esplorazione");
    const changed = await change(current, now);
    const next = parseInput(
      Exploration,
      { ...changed, updatedAt: nextInstant(current.updatedAt, now) },
      "Modifica non valida.",
    );
    await writeExplorationFile(file, next);
    return next;
  });
}

export async function readExploration(id: string): Promise<ExplorationT> {
  const exploration = await readExplorationFile(explorationFile(id));
  if (!exploration) throw notFound("Esplorazione");
  return exploration;
}

/** Ids of explore-only books already used by any exploration (a new upload must not reuse one of them). */
function takenExploreBookIds(all: ExplorationT[]): Set<string> {
  return new Set(
    all.flatMap((e) => e.sources.filter((s) => s.origin === "explore").map((s) => s.id)),
  );
}

export const TitleInput = Exploration.shape.title;
export const QuestionInput = Exploration.shape.question;

export interface NewExploration {
  title: string;
  question: string;
  /** Library books to start with. */
  books?: string[];
}

/**
 * Creates an exploration. The ID is the date plus the title slug; `-2`, `-3`… when it is taken. Library books
 * are checked before anything is written, so a bad ID creates nothing.
 */
export async function createExploration(
  input: NewExploration,
  now = new Date(),
  deps: Partial<LibraryDeps> = {},
): Promise<ExplorationT> {
  const library = withLibraryDeps(deps);
  const title = parseInput(TitleInput, input.title, "Titolo non valido.");
  const question = parseInput(QuestionInput, input.question, "Domanda non valida.");
  const bookIds = [...new Set(input.books ?? [])];
  const addedAt = now.toISOString();
  const sources: BookSourceT[] = [];
  for (const raw of bookIds) {
    const bookId = parseInput(BookId, raw, `ID libro non valido: ${raw}`);
    const ref = await library.readLibraryBookRef(bookId);
    if (!ref) throw new ExploreError("not-found", `Libro «${bookId}» non trovato in libreria.`);
    sources.push(
      parseInput(
        BookSource,
        {
          kind: "book",
          id: bookId,
          origin: "library",
          title: ref.title,
          authors: ref.authors,
          ...(ref.language ? { language: ref.language } : {}),
          addedAt,
          verdict: null,
        },
        `Libro non valido: ${bookId}`,
      ),
    );
  }

  const base = explorationIdFor(title, now);
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
    const file = explorationFile(id);
    const created = await withLock(file, async () => {
      if (await readExplorationFile(file)) return undefined;
      const exploration = parseInput(
        Exploration,
        {
          version: 1,
          id,
          title,
          question,
          status: "open",
          createdAt: addedAt,
          updatedAt: addedAt,
          sources,
          summary: null,
          notes: [],
          journal: [],
        },
        "Esplorazione non valida.",
      );
      await writeExplorationFile(file, exploration);
      return exploration;
    });
    if (created) return created;
  }
}

/** Fields a user may change on an exploration (the ID never changes). */
export const ExplorationPatch = z
  .strictObject({
    title: TitleInput.optional(),
    question: QuestionInput.optional(),
    summary: Exploration.shape.summary.optional(),
    status: ExplorationStatus.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Niente da modificare");
export type ExplorationPatch = z.input<typeof ExplorationPatch>;

export async function updateExploration(
  id: string,
  patch: ExplorationPatch,
  now = new Date(),
): Promise<ExplorationT> {
  const valid = parseInput(ExplorationPatch, patch, "Modifica non valida.");
  return mutate(
    id,
    (current) => ({
      ...current,
      ...(valid.title !== undefined ? { title: valid.title } : {}),
      ...(valid.question !== undefined ? { question: valid.question } : {}),
      ...(valid.summary !== undefined ? { summary: valid.summary } : {}),
      ...(valid.status !== undefined ? { status: valid.status } : {}),
    }),
    now,
  );
}

/** Adds a book of the library as a source (its text is read from the library cache when needed). */
export async function addLibraryBook(
  id: string,
  bookId: string,
  deps: Partial<LibraryDeps> = {},
  now = new Date(),
): Promise<ExplorationT> {
  const library = withLibraryDeps(deps);
  const valid = parseInput(BookId, bookId, `ID libro non valido: ${bookId}`);
  const ref = await library.readLibraryBookRef(valid);
  if (!ref) throw new ExploreError("not-found", `Libro «${valid}» non trovato in libreria.`);
  return mutate(
    id,
    (current) => {
      if (current.sources.some((s) => s.id === valid)) {
        throw new ExploreError("already-exists", "Il libro è già tra le fonti di questa esplorazione.");
      }
      const source = parseInput(
        BookSource,
        {
          kind: "book",
          id: valid,
          origin: "library",
          title: ref.title,
          authors: ref.authors,
          ...(ref.language ? { language: ref.language } : {}),
          addedAt: now.toISOString(),
          verdict: null,
        },
        `Libro non valido: ${valid}`,
      );
      return { ...current, sources: [...current.sources, source] };
    },
    now,
  );
}

/**
 * Adds an EPUB uploaded for exploring only. The same file (same MD5) already used by this exploration is refused;
 * the same file used by another exploration reuses its book ID, so the cache holds one copy.
 */
export async function addExploreBook(
  id: string,
  upload: { bytes: Uint8Array; fileName: string },
  deps: Partial<LibraryDeps> = {},
  now = new Date(),
): Promise<ExplorationT> {
  const library = withLibraryDeps(deps);
  if (upload.bytes.byteLength === 0) throw new ExploreError("invalid-input", "Il file EPUB è vuoto.");
  if (upload.bytes.byteLength > MAX_EPUB_BYTES) {
    throw new ExploreError("invalid-input", "L'EPUB supera la dimensione massima (100 MB).");
  }
  const md5 = createHash("md5").update(upload.bytes).digest("hex");
  return mutate(
    id,
    async (current) => {
      const own = current.sources.find((s) => s.epub?.md5 === md5);
      if (own) {
        if (await library.readCachedBookManifest("explore", own.id)) {
          throw new ExploreError("already-exists", "Questo EPUB è già tra le fonti di questa esplorazione.");
        }
        // Same file, but the cache was cleared: import the text again under the same ID, keeping verdict and notes.
        try {
          await library.importExploreEpub({ id: own.id, bytes: upload.bytes, fileName: upload.fileName });
        } catch (error) {
          throw new ExploreError("invalid-input", epubErrorMessage(error));
        }
        return current;
      }
      const all = await listExplorations();
      const known = all
        .flatMap((e) => e.sources)
        .find((s) => s.origin === "explore" && s.epub?.md5 === md5);
      let source: BookSourceT;
      const addedAt = now.toISOString();
      if (known && (await library.readCachedBookManifest("explore", known.id))) {
        // Same file, text already in the cache: reuse the book, nothing to import.
        source = parseInput(
          BookSource,
          { ...known, addedAt, verdict: null },
          "Libro esplorato non valido.",
        );
      } else {
        const bookId = known?.id ?? (await library.newExploreBookId(takenExploreBookIds(all)));
        let imported;
        try {
          imported = await library.importExploreEpub({
            id: bookId,
            bytes: upload.bytes,
            fileName: upload.fileName,
          });
        } catch (error) {
          // Import errors are about the file itself (no readable text, bad archive): the user can fix them.
          throw new ExploreError("invalid-input", epubErrorMessage(error));
        }
        source = parseInput(
          BookSource,
          {
            kind: "book",
            id: imported.id,
            origin: "explore",
            title: imported.title,
            authors: imported.authors,
            ...(imported.language ? { language: imported.language } : {}),
            epub: imported.epub,
            addedAt,
            verdict: null,
          },
          "Libro esplorato non valido.",
        );
      }
      return { ...current, sources: [...current.sources, source] };
    },
    now,
  );
}

/** Import errors are about the file itself (no readable text, bad archive): the user can fix them. */
function epubErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  // The library's EPUB errors are in English (they serve `elib` too): keep the detail, but say it in Italian.
  return detail.startsWith("L'EPUB") ? detail : `Importazione dell'EPUB non riuscita: ${detail}`;
}

/** Removes a source, its verdict, and the `book` reference of every note about it (the notes stay). */
export async function removeBook(id: string, bookId: string, now = new Date()): Promise<ExplorationT> {
  const valid = parseInput(BookId, bookId, `ID libro non valido: ${bookId}`);
  return mutate(
    id,
    (current) => {
      if (!current.sources.some((s) => s.id === valid)) {
        throw sourceNotFound();
      }
      return {
        ...current,
        sources: current.sources.filter((s) => s.id !== valid),
        notes: current.notes.map((note) => {
          if (note.book !== valid) return note;
          const { book: _dropped, ...rest } = note;
          return rest;
        }),
      };
    },
    now,
  );
}

/** A verdict as the user states it; `decidedAt` and `via` are added by the repo. */
export const VerdictInput = z.strictObject({
  decision: VerdictDecision,
  chapters: z.array(z.int()).optional(),
  reason: Reason,
});
export type VerdictInput = z.input<typeof VerdictInput>;

/** Sets (or replaces) the verdict for one source. Chapters only with `parts`. */
export async function setVerdict(
  id: string,
  bookId: string,
  input: VerdictInput,
  via: Via,
  now = new Date(),
): Promise<ExplorationT> {
  const valid = parseInput(VerdictInput, input, "Verdetto non valido.");
  if (valid.decision !== "parts" && valid.chapters !== undefined) {
    throw new ExploreError("invalid-input", "I capitoli si indicano solo con il verdetto «parts».");
  }
  if (valid.decision === "parts" && valid.chapters === undefined) {
    throw new ExploreError("invalid-input", "Per leggere in parte indica i capitoli.");
  }
  const verdict = parseInput(
    Verdict,
    {
      ...valid,
      decidedAt: now.toISOString(),
      via,
    },
    "Verdetto non valido.",
  );
  return mutate(
    id,
    (current) => {
      if (!current.sources.some((s) => s.id === bookId)) {
        throw sourceNotFound();
      }
      return {
        ...current,
        sources: current.sources.map((s) => (s.id === bookId ? { ...s, verdict } : s)),
      };
    },
    now,
  );
}

export interface NoteInput {
  id?: string;
  body: string;
  book?: string;
}

export async function addNote(
  id: string,
  input: NoteInput,
  via: Via,
  now = new Date(),
): Promise<ExplorationT> {
  const at = now.toISOString();
  return mutate(
    id,
    (current) => {
      if (input.id !== undefined && current.notes.some((n) => n.id === input.id)) {
        throw new ExploreError("already-exists", "Esiste già una nota con questo ID.");
      }
      if (input.book !== undefined && !current.sources.some((s) => s.id === input.book)) {
        throw new ExploreError(
          "invalid-input",
          "Il libro della nota non è una fonte di questa esplorazione.",
        );
      }
      const note = parseInput(
        Note,
        {
          id: input.id ?? randomUUID(),
          body: input.body,
          ...(input.book !== undefined ? { book: input.book } : {}),
          createdAt: at,
          updatedAt: at,
          via,
        },
        "Nota non valida.",
      );
      return { ...current, notes: [...current.notes, note] };
    },
    now,
  );
}

export async function updateNote(
  id: string,
  noteId: string,
  body: string,
  now = new Date(),
): Promise<ExplorationT> {
  return mutate(
    id,
    (current) => {
      if (!current.notes.some((n) => n.id === noteId)) throw notFound("Nota");
      const text = parseInput(Note.shape.body, body, "Il testo della nota non è valido.");
      return {
        ...current,
        notes: current.notes.map((n) =>
          n.id === noteId ? { ...n, body: text, updatedAt: now.toISOString() } : n,
        ),
      };
    },
    now,
  );
}

export async function removeNote(id: string, noteId: string, now = new Date()): Promise<ExplorationT> {
  return mutate(
    id,
    (current) => {
      if (!current.notes.some((n) => n.id === noteId)) throw notFound("Nota");
      return { ...current, notes: current.notes.filter((n) => n.id !== noteId) };
    },
    now,
  );
}

export async function addJournal(
  id: string,
  text: string,
  via: Via,
  now = new Date(),
): Promise<ExplorationT> {
  const entry = parseInput(
    JournalEntry,
    { at: now.toISOString(), via, text },
    "Voce del diario non valida.",
  );
  return mutate(id, (current) => ({ ...current, journal: [...current.journal, entry] }), now);
}

function notebookTooLong(): ExploreError {
  return new ExploreError("invalid-input", `Il quaderno supera ${MAX_NOTEBOOK_LENGTH} caratteri.`);
}

/**
 * Replaces the notebook with `body` (trimmed). An empty body removes the notebook altogether (it is then empty
 * again, as if it had never been written).
 */
export async function setNotebook(
  id: string,
  body: string,
  via: Via,
  now = new Date(),
): Promise<ExplorationT> {
  const text = body.trim();
  if (text.length > MAX_NOTEBOOK_LENGTH) throw notebookTooLong();
  const at = now.toISOString();
  return mutate(
    id,
    (current) => {
      if (text === "") {
        const { notebook: _cleared, ...rest } = current;
        return rest;
      }
      const notebook = parseInput(
        Notebook,
        { body: text, updatedAt: at, via },
        "Quaderno non valido.",
      );
      return { ...current, notebook };
    },
    now,
  );
}

/**
 * Appends `text` (trimmed) to the notebook after a blank line; the first text of an empty notebook is the notebook.
 */
export async function appendNotebook(
  id: string,
  text: string,
  via: Via,
  now = new Date(),
): Promise<ExplorationT> {
  const addition = text.trim();
  if (addition === "") {
    throw new ExploreError("invalid-input", "Il testo da aggiungere al quaderno è vuoto.");
  }
  const at = now.toISOString();
  return mutate(
    id,
    (current) => {
      const body = current.notebook ? `${current.notebook.body}\n\n${addition}` : addition;
      if (body.length > MAX_NOTEBOOK_LENGTH) throw notebookTooLong();
      const notebook = parseInput(Notebook, { body, updatedAt: at, via }, "Quaderno non valido.");
      return { ...current, notebook };
    },
    now,
  );
}
