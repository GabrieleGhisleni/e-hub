import { useMemo, useSyncExternalStore } from "react";
import { type Note, type NoteItemRef, itemKey } from "./types";

/*
 * Notes store. Components only talk to `NotesStore`; the app picks the implementation at startup
 * (`setNotesStore`):
 *
 * - local dev: `createHttpNotesStore()`, the dev server's /api/notes (files in packages/notes/data, in git);
 * - published site: `createStaticNotesStore(notes)`, the notes bundled at build time, read-only;
 * - tests: `createMemoryNotesStore()`.
 *
 * Writes are optimistic: the UI changes at once, the request follows; if it fails the store reloads from the
 * server and reports the error in `meta.error`.
 */

export interface NotesMeta {
  status: "loading" | "ready" | "error";
  /** Published site: notes can be read, not written. */
  readOnly: boolean;
  /** Last failure (load or save), shown to the user until dismissed. */
  error: string | null;
  /** Text of a new note the server refused, so the composer can give it back instead of losing it. */
  rejectedDraft: { itemKey: string; body: string; at: number } | null;
}

export interface NotesStore {
  /** Stable snapshot (same array until something changes). */
  getAll(): readonly Note[];
  getMeta(): NotesMeta;
  subscribe(listener: () => void): () => void;
  add(item: NoteItemRef, body: string, options?: { pinned?: boolean }): Note;
  update(id: string, patch: Partial<Pick<Note, "body" | "pinned">>): void;
  remove(id: string): void;
  /** Reload from the source and clear the error. */
  reload(): void;
  dismissError(): void;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // RFC 4122 v4 from Math.random (only for very old browsers; the server validates the format).
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
  );
}

/** Shape check for notes coming from outside (static bundle, API). */
export function isNote(value: unknown): value is Note {
  if (typeof value !== "object" || value === null) return false;
  const note = value as Note;
  return (
    typeof note.id === "string" &&
    typeof note.body === "string" &&
    typeof note.pinned === "boolean" &&
    typeof note.createdAt === "string" &&
    typeof note.updatedAt === "string" &&
    typeof note.item === "object" &&
    note.item !== null &&
    (note.item.module === "library" || note.item.module === "podcasts") &&
    typeof note.item.id === "string" &&
    typeof note.item.title === "string" &&
    typeof note.item.href === "string" &&
    note.item.href.startsWith(`/${note.item.module}/`)
  );
}

/** Notes, listeners and meta, shared by every implementation. */
function createState(initial: readonly Note[], meta: NotesMeta) {
  let notes = initial;
  let current = meta;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    getAll: () => notes,
    getMeta: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listenerCount: () => listeners.size,
    setNotes(next: readonly Note[]) {
      notes = next;
      emit();
    },
    setMeta(patch: Partial<NotesMeta>) {
      current = { ...current, ...patch };
      emit();
    },
  };
}

/** Pure state changes, applied optimistically on the client (the server makes the same ones). */
function applyAdd(notes: readonly Note[], note: Note): Note[] {
  // The latest title snapshot wins for every note of the item.
  const key = itemKey(note.item);
  return [...notes.map((n) => (itemKey(n.item) === key ? { ...n, item: note.item } : n)), note];
}

function applyUpdate(
  notes: readonly Note[],
  id: string,
  patch: Partial<Pick<Note, "body" | "pinned">>,
  now: string,
): Note[] {
  return notes.map((note) => {
    if (note.id !== id) return note;
    const body = patch.body?.trim();
    const bodyChanged = body !== undefined && body !== note.body;
    return {
      ...note,
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(bodyChanged ? { body, updatedAt: now } : {}),
    };
  });
}

/** In-memory store (tests, and the default before the app picks one). */
export function createMemoryNotesStore(
  initial: readonly Note[] = [],
  now = () => new Date(),
): NotesStore {
  const state = createState(initial, {
    status: "ready",
    readOnly: false,
    error: null,
    rejectedDraft: null,
  });
  return {
    getAll: state.getAll,
    getMeta: state.getMeta,
    subscribe: state.subscribe,
    add(item, body, options) {
      const at = now().toISOString();
      const note: Note = {
        id: newId(),
        item,
        body: body.trim(),
        pinned: options?.pinned ?? false,
        createdAt: at,
        updatedAt: at,
      };
      state.setNotes(applyAdd(state.getAll(), note));
      return note;
    },
    update(id, patch) {
      state.setNotes(applyUpdate(state.getAll(), id, patch, now().toISOString()));
    },
    remove(id) {
      state.setNotes(state.getAll().filter((note) => note.id !== id));
    },
    reload() {},
    dismissError() {
      state.setMeta({ error: null });
    },
  };
}

/** The published site: the notes bundled at build time, read-only. */
export function createStaticNotesStore(notes: readonly unknown[]): NotesStore {
  const valid = notes.filter(isNote);
  const state = createState(valid, {
    status: "ready",
    readOnly: true,
    error: null,
    rejectedDraft: null,
  });
  const readOnly = () => {
    throw new Error("Le note sono in sola lettura sul sito pubblicato.");
  };
  return {
    getAll: state.getAll,
    getMeta: state.getMeta,
    subscribe: state.subscribe,
    add: readOnly,
    update: readOnly,
    remove: readOnly,
    reload() {},
    dismissError() {},
  };
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; details?: unknown };
    const details = Array.isArray(body.details)
      ? body.details.filter((d) => typeof d === "string")
      : [];
    if (typeof body.error === "string") {
      return details.length > 0 ? `${body.error} (${details.slice(0, 2).join("; ")})` : body.error;
    }
  } catch {
    // Not JSON: fall through.
  }
  return `Errore ${response.status}`;
}

/** Local dev: the dev server's notes API. Loads on first use and again when the tab comes back into view. */
export function createHttpNotesStore(
  options: { baseUrl?: string; fetch?: typeof fetch; now?: () => Date } = {},
): NotesStore {
  const baseUrl = options.baseUrl ?? "/api/notes";
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => new Date());
  const state = createState([], {
    status: "loading",
    readOnly: false,
    error: null,
    rejectedDraft: null,
  });
  let started = false;
  let generation = 0;
  // Writes go out one at a time, in order (an "add" must reach the server before a "pin" of the same note).
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;

  const load = async () => {
    const mine = ++generation;
    try {
      const response = await doFetch(baseUrl, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = (await response.json()) as { notes?: unknown };
      if (mine !== generation) return;
      if (pending > 0) {
        // Writes went out meanwhile: this list may predate them. Load again once they are all done.
        queue = queue.then(load);
        return;
      }
      const notes = Array.isArray(body.notes) ? body.notes.filter(isNote) : [];
      state.setNotes(notes);
      state.setMeta({ status: "ready" });
    } catch (error) {
      if (mine !== generation) return;
      state.setMeta({
        status: state.getMeta().status === "ready" ? "ready" : "error",
        error: `Impossibile caricare le note: ${(error as Error).message}`,
      });
    }
  };

  const start = () => {
    if (started) return;
    started = true;
    void load();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        // Pick up notes edited elsewhere (another tab, a file change), but never over unsent writes.
        if (document.visibilityState === "visible" && pending === 0) void load();
      });
    }
  };

  const send = (
    label: string,
    request: () => Promise<Response>,
    onOk?: (response: Response) => Promise<void>,
    onFail?: () => void,
  ) => {
    pending += 1;
    queue = queue
      .then(async () => {
        const response = await request();
        if (!response.ok) throw new Error(await errorMessage(response));
        await onOk?.(response);
      })
      .catch(async (error: unknown) => {
        state.setMeta({ error: `${label}: ${(error as Error).message}` });
        onFail?.();
        // The optimistic change may be wrong: the server's copy is the truth.
        await load();
      })
      .finally(() => {
        pending -= 1;
      });
  };

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const notePath = (note: Note) =>
    `${baseUrl}/${note.item.module}/${encodeURIComponent(note.item.id)}/${note.id}`;
  /** Replace the optimistic copy with the server's (exact timestamps). */
  const adopt = async (response: Response) => {
    const saved: unknown = await response.json();
    if (isNote(saved)) state.setNotes(state.getAll().map((n) => (n.id === saved.id ? saved : n)));
  };

  return {
    getAll: state.getAll,
    getMeta: state.getMeta,
    subscribe(listener) {
      start();
      return state.subscribe(listener);
    },
    add(item, body, opts) {
      const at = now().toISOString();
      const note: Note = {
        id: newId(),
        item,
        body: body.trim(),
        pinned: opts?.pinned ?? false,
        createdAt: at,
        updatedAt: at,
      };
      state.setNotes(applyAdd(state.getAll(), note));
      send(
        "Nota non salvata",
        () =>
          doFetch(
            baseUrl,
            json("POST", { id: note.id, item, body: note.body, pinned: note.pinned }),
          ),
        adopt,
        () =>
          state.setMeta({
            rejectedDraft: { itemKey: itemKey(item), body: note.body, at: Date.now() },
          }),
      );
      return note;
    },
    update(id, patch) {
      const before = state.getAll().find((n) => n.id === id);
      if (!before) return;
      state.setNotes(applyUpdate(state.getAll(), id, patch, now().toISOString()));
      const payload = {
        ...(patch.body !== undefined
          ? { body: patch.body.trim(), expectedUpdatedAt: before.updatedAt }
          : {}),
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      };
      send("Modifica non salvata", () => doFetch(notePath(before), json("PATCH", payload)), adopt);
    },
    remove(id) {
      const before = state.getAll().find((n) => n.id === id);
      if (!before) return;
      state.setNotes(state.getAll().filter((n) => n.id !== id));
      send("Nota non eliminata", () => doFetch(notePath(before), { method: "DELETE" }));
    },
    reload() {
      state.setMeta({ error: null, rejectedDraft: null });
      void load();
    },
    dismissError() {
      state.setMeta({ error: null, rejectedDraft: null });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The app's store

let active: NotesStore = createMemoryNotesStore();

/** Chooses the implementation; call once at startup, before rendering. */
export function setNotesStore(store: NotesStore): void {
  active = store;
}

/** Delegates to the store chosen with `setNotesStore` (components take it as their default). */
export const notesStore: NotesStore = {
  getAll: () => active.getAll(),
  getMeta: () => active.getMeta(),
  subscribe: (listener) => active.subscribe(listener),
  add: (item, body, options) => active.add(item, body, options),
  update: (id, patch) => active.update(id, patch),
  remove: (id) => active.remove(id),
  reload: () => active.reload(),
  dismissError: () => active.dismissError(),
};

/** Every note, re-rendering on change. */
export function useNotes(store: NotesStore = notesStore): readonly Note[] {
  return useSyncExternalStore(store.subscribe, store.getAll, store.getAll);
}

/** Loading state, read-only flag and last error. */
export function useNotesMeta(store: NotesStore = notesStore): NotesMeta {
  return useSyncExternalStore(store.subscribe, store.getMeta, store.getMeta);
}

/** Notes of one item, oldest first (a conversation). */
export function useItemNotes(
  item: Pick<NoteItemRef, "module" | "id">,
  store: NotesStore = notesStore,
) {
  const all = useNotes(store);
  const key = itemKey(item);
  return useMemo(
    () =>
      all
        .filter((note) => itemKey(note.item) === key)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [all, key],
  );
}

/** Note count per item key (for badges on cards and rows). */
export function useNoteCounts(store: NotesStore = notesStore): ReadonlyMap<string, number> {
  const all = useNotes(store);
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of all) {
      const key = itemKey(note.item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [all]);
}
