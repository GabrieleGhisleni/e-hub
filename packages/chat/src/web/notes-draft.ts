/**
 * Notes mode ("Appunti") of the chat panel: replies picked by the user go into a draft, reviewed and saved as one note.
 * The draft and the on/off state are kept in localStorage per source (`ehub:chat-draft:<kind>:<id>`,
 * `ehub:chat-notes-mode:<kind>:<id>`), so they survive a reload. Every storage access is guarded.
 */
import type { ChatSource } from "../shared/types";

export type DraftEntry = {
  id: string;
  /** Markdown of the entry (a reply, or the text of a `save_note` call). */
  text: string;
  /** The reply it comes from, when added with "Aggiungi alla bozza". */
  messageId?: string;
};

export const draftKey = (source: ChatSource) => `ehub:chat-draft:${source.kind}:${source.id}`;
export const notesModeKey = (source: ChatSource) => `ehub:chat-notes-mode:${source.kind}:${source.id}`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked or full: the draft lives only in memory.
  }
}

function isEntry(value: unknown): value is DraftEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.text === "string" &&
    (entry.messageId === undefined || typeof entry.messageId === "string")
  );
}

export function loadDraft(source: ChatSource): DraftEntry[] {
  const raw = read(draftKey(source));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export function saveDraft(source: ChatSource, entries: readonly DraftEntry[]): void {
  write(draftKey(source), entries.length === 0 ? null : JSON.stringify(entries));
}

export function loadNotesMode(source: ChatSource): boolean {
  return read(notesModeKey(source)) === "1";
}

export function saveNotesMode(source: ChatSource, on: boolean): void {
  write(notesModeKey(source), on ? "1" : null);
}

/** The note the draft becomes: its entries in order, separated by a blank line. */
export function draftNoteText(entries: readonly DraftEntry[]): string {
  return entries
    .map((entry) => entry.text.trim())
    .filter((text) => text !== "")
    .join("\n\n");
}

export function newDraftEntry(text: string, messageId?: string): DraftEntry {
  return { id: crypto.randomUUID(), text: text.trim(), ...(messageId ? { messageId } : {}) };
}

/** Moves the entry at `index` by `delta` places (clamped); returns a new array. */
export function moveEntry(entries: readonly DraftEntry[], index: number, delta: number): DraftEntry[] {
  const target = Math.max(0, Math.min(entries.length - 1, index + delta));
  if (target === index || index < 0 || index >= entries.length) return [...entries];
  const next = [...entries];
  const [entry] = next.splice(index, 1);
  next.splice(target, 0, entry!);
  return next;
}
