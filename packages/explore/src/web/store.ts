import { useMemo, useSyncExternalStore } from "react";
import type {
  BookSource,
  Exploration,
  ExplorationStatus,
  JournalEntry,
  Note,
  Notebook,
  VerdictDecision,
} from "../schema.ts";

/*
 * Explorations store. Components only talk to `ExploreStore`; the app picks the implementation at startup
 * (`setExploreStore`):
 *
 * - local dev: `createHttpExploreStore()`, the dev server's /api/explore (files in packages/explore/data, editable);
 * - published site: `createStaticExploreStore(explorations)`, the files bundled at build time, read-only;
 * - tests: `createMemoryExploreStore()`.
 *
 * Writes are not optimistic: the server answers with the whole exploration, which replaces the cached copy. A
 * failed write throws `ExploreApiError` with the server's Italian message, for the caller to show.
 */

export interface ExploreMeta {
  status: "loading" | "ready" | "error";
  /** Published site: explorations can be read, not written. */
  readOnly: boolean;
  /** Last load failure, shown until dismissed. */
  error: string | null;
}

/** A library book offered when starting or extending an exploration (`GET /api/explore/library-books`). */
export interface LibraryBookRef {
  id: string;
  title: string;
  authors: string[];
  language?: string;
  href: string;
}

/** The verdict fields the server takes (`PUT /api/explore/:id/verdicts/:bookId`). */
export interface VerdictInput {
  decision: VerdictDecision;
  chapters?: number[];
  reason: string;
}

/** Chapter-summary state of one source (`GET /api/explore/:id/summaries`). */
export interface BookSummaryStatus {
  bookId: string;
  origin: "library" | "explore";
  state: "none" | "running" | "done" | "failed";
  /** Chapters done and total while running (total unknown until the chapters are listed). */
  done?: number;
  total?: number;
  error?: string;
}

export interface SummaryStatusResponse {
  books: BookSummaryStatus[];
}

export interface NewExplorationInput {
  title: string;
  question: string;
  books?: string[];
}

export interface ExplorationPatch {
  title?: string;
  question?: string;
  summary?: string | null;
  status?: ExplorationStatus;
}

/** An error from the store, with the message to show the user (already in Italian). */
export class ExploreApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ExploreApiError";
    this.status = status;
  }
}

export interface ExploreStore {
  /** Stable snapshot (same array until something changes), newest first. */
  getAll(): readonly Exploration[];
  get(id: string): Exploration | undefined;
  getMeta(): ExploreMeta;
  subscribe(listener: () => void): () => void;
  /** Loads the list again. */
  reload(): Promise<void>;
  /** Loads one exploration into the cache (rejects with status 404 when it does not exist). */
  fetchOne(id: string): Promise<Exploration>;
  libraryBooks(): Promise<LibraryBookRef[]>;
  create(input: NewExplorationInput): Promise<Exploration>;
  update(id: string, patch: ExplorationPatch): Promise<Exploration>;
  addBook(id: string, bookId: string): Promise<Exploration>;
  uploadEpub(id: string, file: File): Promise<Exploration>;
  removeBook(id: string, bookId: string): Promise<Exploration>;
  /** Chapter-summary state of every source (`GET /api/explore/:id/summaries`). */
  summaries(id: string): Promise<SummaryStatusResponse>;
  /** Starts the summary of an explore book again after a failure (`POST /api/explore/:id/books/:bookId/summary`). */
  retrySummary(id: string, bookId: string): Promise<void>;
  setVerdict(id: string, bookId: string, verdict: VerdictInput): Promise<Exploration>;
  addNote(id: string, input: { body: string; book?: string }): Promise<Exploration>;
  removeNote(id: string, noteId: string): Promise<Exploration>;
  addJournal(id: string, text: string): Promise<Exploration>;
  /** Replaces the notebook; an empty body clears it (`PUT /api/explore/:id/notebook`). */
  setNotebook(id: string, body: string): Promise<Exploration>;
  /** Appends text to the notebook after a blank line (`POST /api/explore/:id/notebook/append`). */
  appendNotebook(id: string, text: string): Promise<Exploration>;
  dismissError(): void;
}

/** Shape check for explorations coming from outside (static bundle, API). The build already validated them. */
export function isExploration(value: unknown): value is Exploration {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Exploration;
  return (
    e.version === 1 &&
    typeof e.id === "string" &&
    typeof e.title === "string" &&
    typeof e.question === "string" &&
    (e.status === "open" || e.status === "closed") &&
    typeof e.createdAt === "string" &&
    Array.isArray(e.sources) &&
    Array.isArray(e.notes) &&
    Array.isArray(e.journal)
  );
}

function newestFirst(list: readonly Exploration[]): Exploration[] {
  return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Cached explorations and listeners, shared by every implementation. */
function createState(readOnly: boolean) {
  let items: readonly Exploration[] = [];
  let meta: ExploreMeta = { status: "loading", readOnly, error: null };
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    getAll: () => items,
    get: (id: string) => items.find((e) => e.id === id),
    getMeta: () => meta,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setAll(next: readonly Exploration[]) {
      items = newestFirst(next);
      emit();
    },
    upsert(exploration: Exploration) {
      items = newestFirst([...items.filter((e) => e.id !== exploration.id), exploration]);
      emit();
      return exploration;
    },
    setMeta(patch: Partial<ExploreMeta>) {
      meta = { ...meta, ...patch };
      emit();
    },
  };
}

const readOnlyError = () =>
  new ExploreApiError("Le esplorazioni sono in sola lettura sul sito pubblicato.", 405);

/** The published site: the explorations bundled at build time, read-only. */
export function createStaticExploreStore(explorations: readonly unknown[]): ExploreStore {
  const state = createState(true);
  state.setAll(explorations.filter(isExploration));
  state.setMeta({ status: "ready" });
  const reject = async (): Promise<never> => {
    throw readOnlyError();
  };
  return {
    getAll: state.getAll,
    get: state.get,
    getMeta: state.getMeta,
    subscribe: state.subscribe,
    reload: async () => {},
    fetchOne: async (id) => {
      const found = state.get(id);
      if (!found) throw new ExploreApiError("Esplorazione non trovata.", 404);
      return found;
    },
    libraryBooks: async () => [],
    create: reject,
    update: reject,
    addBook: reject,
    uploadEpub: reject,
    removeBook: reject,
    // The published site has no summaries in progress: every source reports "none".
    summaries: async (id) => ({
      books: (state.get(id)?.sources ?? []).map((source) => ({
        bookId: source.id,
        origin: source.origin,
        state: "none" as const,
      })),
    }),
    retrySummary: reject,
    setVerdict: reject,
    addNote: reject,
    removeNote: reject,
    addJournal: reject,
    setNotebook: reject,
    appendNotebook: reject,
    dismissError: () => {},
  };
}

/** Message and status of a failed response: the server's `error` text when it sent one. */
async function apiError(response: Response): Promise<ExploreApiError> {
  let message = `Errore ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown; details?: unknown };
    const details = Array.isArray(body.details)
      ? body.details.filter((d): d is string => typeof d === "string")
      : [];
    if (typeof body.error === "string") {
      message = details.length > 0 ? `${body.error} (${details.slice(0, 2).join("; ")})` : body.error;
    }
  } catch {
    // Not JSON: keep the status message.
  }
  return new ExploreApiError(message, response.status);
}

/** Local dev: the dev server's explorations API. Loads the list on first subscription. */
export function createHttpExploreStore(
  options: { baseUrl?: string; fetch?: typeof fetch } = {},
): ExploreStore {
  const baseUrl = options.baseUrl ?? "/api/explore";
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const state = createState(false);
  let started = false;

  const reload = async () => {
    try {
      const response = await doFetch(baseUrl, { headers: { accept: "application/json" } });
      if (!response.ok) throw await apiError(response);
      const body = (await response.json()) as { explorations?: unknown };
      const list = Array.isArray(body.explorations) ? body.explorations.filter(isExploration) : [];
      state.setAll(list);
      state.setMeta({ status: "ready", error: null });
    } catch (error) {
      state.setMeta({
        status: state.getMeta().status === "ready" ? "ready" : "error",
        error: `Impossibile caricare le esplorazioni: ${(error as Error).message}`,
      });
    }
  };

  const start = () => {
    if (started) return;
    started = true;
    void reload();
  };

  /** One request that answers with a whole exploration; the answer replaces the cached copy. */
  const send = async (method: string, path: string, body?: unknown, extra?: RequestInit) => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      ...extra,
      headers: { ...headers, ...(extra?.headers as Record<string, string> | undefined) },
      body: body !== undefined ? JSON.stringify(body) : (extra?.body as BodyInit | undefined),
    });
    if (!response.ok) throw await apiError(response);
    return state.upsert((await response.json()) as Exploration);
  };
  const at = (id: string) => `/${encodeURIComponent(id)}`;

  return {
    getAll: state.getAll,
    get: state.get,
    getMeta: state.getMeta,
    subscribe(listener) {
      start();
      return state.subscribe(listener);
    },
    reload,
    async fetchOne(id) {
      const response = await doFetch(`${baseUrl}${at(id)}`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw await apiError(response);
      return state.upsert((await response.json()) as Exploration);
    },
    async libraryBooks() {
      const response = await doFetch(`${baseUrl}/library-books`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw await apiError(response);
      const body = (await response.json()) as { books?: LibraryBookRef[] };
      return Array.isArray(body.books) ? body.books : [];
    },
    create: (input) => send("POST", "", input),
    update: (id, patch) => send("PATCH", at(id), patch),
    addBook: (id, bookId) => send("POST", `${at(id)}/books`, { bookId }),
    uploadEpub: (id, file) =>
      send("POST", `${at(id)}/epub`, undefined, {
        body: file,
        headers: {
          "content-type": "application/epub+zip",
          "x-file-name": encodeURIComponent(file.name),
        },
      }),
    removeBook: (id, bookId) => send("DELETE", `${at(id)}/books/${encodeURIComponent(bookId)}`),
    async summaries(id) {
      const response = await doFetch(`${baseUrl}${at(id)}/summaries`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw await apiError(response);
      return (await response.json()) as SummaryStatusResponse;
    },
    async retrySummary(id, bookId) {
      // The server only reads the path, but its write rules require a JSON body.
      const response = await doFetch(
        `${baseUrl}${at(id)}/books/${encodeURIComponent(bookId)}/summary`,
        {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: "{}",
        },
      );
      if (!response.ok) throw await apiError(response);
    },
    setVerdict: (id, bookId, verdict) =>
      send("PUT", `${at(id)}/verdicts/${encodeURIComponent(bookId)}`, verdict),
    addNote: (id, input) => send("POST", `${at(id)}/notes`, input),
    removeNote: (id, noteId) => send("DELETE", `${at(id)}/notes/${encodeURIComponent(noteId)}`),
    addJournal: (id, text) => send("POST", `${at(id)}/journal`, { text }),
    setNotebook: (id, body) => send("PUT", `${at(id)}/notebook`, { body }),
    appendNotebook: (id, text) => send("POST", `${at(id)}/notebook/append`, { text }),
    dismissError: () => state.setMeta({ error: null }),
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
}

/**
 * In-memory store for tests and previews. Edits of an exploration are applied locally with the same rules as the
 * server (for the parts that need no files: creating, adding books and uploads are not offered here).
 */
export function createMemoryExploreStore(
  initial: readonly Exploration[] = [],
  options: {
    libraryBooks?: LibraryBookRef[];
    now?: () => Date;
    /** Summary state per book ID; a book not listed reports "none". `retrySummary` sets it to "running". */
    summaries?: Record<string, Omit<BookSummaryStatus, "bookId" | "origin">>;
  } = {},
): ExploreStore {
  const now = options.now ?? (() => new Date());
  const state = createState(false);
  state.setAll(initial);
  state.setMeta({ status: "ready" });
  const summaryStates = new Map(Object.entries(options.summaries ?? {}));

  const change = (id: string, edit: (current: Exploration, at: string) => Exploration) => {
    const current = state.get(id);
    if (!current) throw new ExploreApiError("Esplorazione non trovata.", 404);
    const at = now().toISOString();
    return state.upsert({ ...edit(current, at), updatedAt: at });
  };
  const unsupported = async (): Promise<never> => {
    throw new ExploreApiError("Operazione non disponibile nello store di prova.", 501);
  };

  return {
    getAll: state.getAll,
    get: state.get,
    getMeta: state.getMeta,
    subscribe: state.subscribe,
    reload: async () => {},
    fetchOne: async (id) => {
      const found = state.get(id);
      if (!found) throw new ExploreApiError("Esplorazione non trovata.", 404);
      return found;
    },
    libraryBooks: async () => options.libraryBooks ?? [],
    create: unsupported,
    addBook: unsupported,
    uploadEpub: unsupported,
    summaries: async (id) => {
      const current = state.get(id);
      if (!current) throw new ExploreApiError("Esplorazione non trovata.", 404);
      return {
        books: current.sources.map((source) => ({
          bookId: source.id,
          origin: source.origin,
          ...(summaryStates.get(source.id) ?? { state: "none" as const }),
        })),
      };
    },
    retrySummary: async (id, bookId) => {
      const current = state.get(id);
      if (!current) throw new ExploreApiError("Esplorazione non trovata.", 404);
      const source = current.sources.find((s) => s.id === bookId);
      if (!source) throw new ExploreApiError("Libro non trovato in questa esplorazione.", 404);
      if (source.origin !== "explore") {
        throw new ExploreApiError("Solo i libri esplorati hanno una sintesi da rigenerare.", 400);
      }
      summaryStates.set(bookId, { state: "running", done: 0 });
    },
    update: async (id, patch) =>
      change(id, (e) => ({
        ...e,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.question !== undefined ? { question: patch.question } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      })),
    removeBook: async (id, bookId) =>
      change(id, (e) => ({
        ...e,
        sources: e.sources.filter((s) => s.id !== bookId),
        notes: e.notes.map(({ book, ...note }) => (book === bookId ? note : { ...note, book })),
      })),
    setVerdict: async (id, bookId, verdict) =>
      change(id, (e, at) => ({
        ...e,
        sources: e.sources.map((s): BookSource => {
          if (s.id !== bookId) return s;
          const decided = {
            decision: verdict.decision,
            reason: verdict.reason,
            decidedAt: at,
            via: "app" as const,
            ...(verdict.decision === "parts" ? { chapters: verdict.chapters ?? [] } : {}),
          };
          return { ...s, verdict: decided as BookSource["verdict"] };
        }),
      })),
    addNote: async (id, input) =>
      change(id, (e, at) => {
        const note: Note = {
          id: newId(),
          body: input.body.trim(),
          ...(input.book ? { book: input.book } : {}),
          createdAt: at,
          updatedAt: at,
          via: "app",
        };
        return { ...e, notes: [...e.notes, note] };
      }),
    removeNote: async (id, noteId) =>
      change(id, (e) => ({ ...e, notes: e.notes.filter((n) => n.id !== noteId) })),
    addJournal: async (id, text) =>
      change(id, (e, at) => {
        const entry: JournalEntry = { at, via: "app", text: text.trim() };
        return { ...e, journal: [...e.journal, entry] };
      }),
    setNotebook: async (id, body) =>
      change(id, (e, at) => {
        const text = body.trim();
        if (text === "") {
          const { notebook: _cleared, ...rest } = e;
          return rest;
        }
        const notebook: Notebook = { body: text, updatedAt: at, via: "app" };
        return { ...e, notebook };
      }),
    appendNotebook: async (id, text) =>
      change(id, (e, at) => {
        const addition = text.trim();
        if (addition === "") throw new ExploreApiError("Il testo da aggiungere al quaderno è vuoto.", 422);
        const body = e.notebook ? `${e.notebook.body}\n\n${addition}` : addition;
        const notebook: Notebook = { body, updatedAt: at, via: "app" };
        return { ...e, notebook };
      }),
    dismissError: () => {},
  };
}

// ---------------------------------------------------------------------------------------------
// The app's store

let active: ExploreStore = createMemoryExploreStore();

/** Chooses the implementation; call once at startup, before rendering. */
export function setExploreStore(store: ExploreStore): void {
  active = store;
}

/** Delegates to the store chosen with `setExploreStore` (components take it as their default). */
export const exploreStore: ExploreStore = {
  getAll: () => active.getAll(),
  get: (id) => active.get(id),
  getMeta: () => active.getMeta(),
  subscribe: (listener) => active.subscribe(listener),
  reload: () => active.reload(),
  fetchOne: (id) => active.fetchOne(id),
  libraryBooks: () => active.libraryBooks(),
  create: (input) => active.create(input),
  update: (id, patch) => active.update(id, patch),
  addBook: (id, bookId) => active.addBook(id, bookId),
  uploadEpub: (id, file) => active.uploadEpub(id, file),
  removeBook: (id, bookId) => active.removeBook(id, bookId),
  summaries: (id) => active.summaries(id),
  retrySummary: (id, bookId) => active.retrySummary(id, bookId),
  setVerdict: (id, bookId, verdict) => active.setVerdict(id, bookId, verdict),
  addNote: (id, input) => active.addNote(id, input),
  removeNote: (id, noteId) => active.removeNote(id, noteId),
  addJournal: (id, text) => active.addJournal(id, text),
  setNotebook: (id, body) => active.setNotebook(id, body),
  appendNotebook: (id, text) => active.appendNotebook(id, text),
  dismissError: () => active.dismissError(),
};

/** Every exploration, re-rendering on change. */
export function useExplorations(store: ExploreStore = exploreStore): readonly Exploration[] {
  return useSyncExternalStore(store.subscribe, store.getAll, store.getAll);
}

/** One exploration from the cache (undefined until it is loaded). */
export function useExploration(id: string, store: ExploreStore = exploreStore): Exploration | undefined {
  const all = useExplorations(store);
  return useMemo(() => all.find((e) => e.id === id), [all, id]);
}

/** Loading state, read-only flag and last error. */
export function useExploreMeta(store: ExploreStore = exploreStore): ExploreMeta {
  return useSyncExternalStore(store.subscribe, store.getMeta, store.getMeta);
}

/** Every exploration that has a source with this library book ID, with that source. */
export function explorationsOfBook(
  explorations: readonly Exploration[],
  bookId: string,
): { exploration: Exploration; source: BookSource }[] {
  return explorations.flatMap((exploration) => {
    const source = exploration.sources.find((s) => s.id === bookId);
    return source ? [{ exploration, source }] : [];
  });
}
