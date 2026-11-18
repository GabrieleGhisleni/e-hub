/**
 * Notes on disk (Node only): `<dataDir>/<module>/<itemId>.json`, one file per book or episode, notes oldest first.
 * Writes are atomic (temp file + rename) and serialised per file, so two quick edits never lose each other.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listDir, readTextIfExists, removeFile, writeFileAtomic } from "@ehub/store";
import { ZodError } from "zod";
import type { Note, NoteItemRef, NoteModule } from "../types.ts";
import { ItemId, NoteModule as ModuleSchema, NotesFile, formatIssues } from "../schema.ts";

export const DATA_DIR_ENV = "EHUB_NOTES_DATA_DIR";
const DEFAULT_DATA_DIR = fileURLToPath(new URL("../../data", import.meta.url));

export function notesDataDir(): string {
  return path.resolve(process.env[DATA_DIR_ENV] || DEFAULT_DATA_DIR);
}

export type NotesErrorCode =
  | "not-found"
  | "conflict"
  | "already-exists"
  | "invalid-file"
  | "rejected";

export class NotesError extends Error {
  // Plain fields, no parameter properties: this file is also loaded by Node's type stripping (vite.config).
  readonly code: NotesErrorCode;
  readonly details: string[];
  constructor(code: NotesErrorCode, message: string, details: string[] = []) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function filePath(module: NoteModule, itemId: string): string {
  // Both are validated (enum, ID regex) before they reach the file system.
  ModuleSchema.parse(module);
  ItemId.parse(itemId);
  return path.join(notesDataDir(), module, `${itemId}.json`);
}

async function readNotesFile(file: string): Promise<NotesFile | undefined> {
  const text = await readTextIfExists(file);
  if (text === null) return undefined;
  try {
    return NotesFile.parse(JSON.parse(text));
  } catch (error) {
    const details = error instanceof ZodError ? formatIssues(error) : [(error as Error).message];
    throw new NotesError(
      "invalid-file",
      `File di note non valido: ${path.basename(file)}`,
      details,
    );
  }
}

async function writeNotesFile(file: string, content: NotesFile | null): Promise<void> {
  if (content === null || content.notes.length === 0) {
    await removeFile(file);
    return;
  }
  await writeFileAtomic(file, `${JSON.stringify(content, null, 2)}\n`);
}

const locks = new Map<string, Promise<unknown>>();

/** Runs `fn` after every earlier call for the same key has settled. */
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

const toNote = (file: NotesFile, stored: NotesFile["notes"][number]): Note => ({
  ...stored,
  item: file.item,
});

/** Every note of every item. Invalid files are reported, not skipped silently. */
export async function listAllNotes(): Promise<Note[]> {
  const notes: Note[] = [];
  for (const module of ModuleSchema.options) {
    const names = (await listDir(path.join(notesDataDir(), module)))
      .filter((e) => !e.isDirectory)
      .map((e) => e.name);
    for (const name of names.filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort()) {
      const file = await readNotesFile(path.join(notesDataDir(), module, name));
      if (file) notes.push(...file.notes.map((stored) => toNote(file, stored)));
    }
  }
  return notes;
}

/** The notes of one book or episode, oldest first; `[]` when it has none. */
export async function listItemNotes(module: NoteModule, itemId: string): Promise<Note[]> {
  const file = await readNotesFile(filePath(module, itemId));
  return file ? file.notes.map((stored) => toNote(file, stored)) : [];
}

/** Strictly later than `previous` (two writes in the same millisecond still order). */
function nextInstant(previous: string | undefined, now: Date): string {
  const at = now.getTime();
  const after = previous ? Date.parse(previous) + 1 : at;
  return new Date(Math.max(at, after)).toISOString();
}

export async function addNote(
  input: { id: string; item: NoteItemRef; body: string; pinned: boolean },
  now = new Date(),
): Promise<Note> {
  const file = filePath(input.item.module, input.item.id);
  return withLock(file, async () => {
    const current = await readNotesFile(file);
    if (current?.notes.some((n) => n.id === input.id)) {
      throw new NotesError("already-exists", "Esiste già una nota con questo ID.");
    }
    const last = current?.notes.at(-1)?.createdAt;
    const at = nextInstant(last, now);
    const stored = {
      id: input.id,
      body: input.body,
      pinned: input.pinned,
      createdAt: at,
      updatedAt: at,
    };
    // The latest title/href snapshot wins (a renamed book shows its new title in every note).
    const next: NotesFile = { item: input.item, notes: [...(current?.notes ?? []), stored] };
    await writeNotesFile(file, NotesFile.parse(next));
    return toNote(next, stored);
  });
}

export async function updateNote(
  ref: { module: NoteModule; itemId: string; noteId: string },
  patch: { body?: string; pinned?: boolean; expectedUpdatedAt?: string },
  now = new Date(),
): Promise<Note> {
  const file = filePath(ref.module, ref.itemId);
  return withLock(file, async () => {
    const current = await readNotesFile(file);
    const existing = current?.notes.find((n) => n.id === ref.noteId);
    if (!current || !existing) throw new NotesError("not-found", "Nota non trovata.");
    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    // Only a text edit can lose work: pinning is checked against nothing.
    if (
      bodyChanged &&
      patch.expectedUpdatedAt !== undefined &&
      patch.expectedUpdatedAt !== existing.updatedAt
    ) {
      throw new NotesError("conflict", "La nota è stata modificata altrove: ricarica e riprova.");
    }
    const updated = {
      ...existing,
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      updatedAt: bodyChanged ? nextInstant(existing.updatedAt, now) : existing.updatedAt,
    };
    const next: NotesFile = {
      item: current.item,
      notes: current.notes.map((n) => (n.id === ref.noteId ? updated : n)),
    };
    await writeNotesFile(file, NotesFile.parse(next));
    return toNote(next, updated);
  });
}

export async function removeNote(ref: {
  module: NoteModule;
  itemId: string;
  noteId: string;
}): Promise<void> {
  const file = filePath(ref.module, ref.itemId);
  await withLock(file, async () => {
    const current = await readNotesFile(file);
    if (!current?.notes.some((n) => n.id === ref.noteId)) {
      throw new NotesError("not-found", "Nota non trovata.");
    }
    await writeNotesFile(file, {
      item: current.item,
      notes: current.notes.filter((n) => n.id !== ref.noteId),
    });
  });
}
