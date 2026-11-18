/**
 * Book form state <-> API payloads. Pure and DOM-free (unit-tested).
 * The form keeps every field as editable text/lists; `diffToPatch` builds a `BookPatch` with only the changed
 * fields (`null` removes an optional field), `toNewBook` builds the `NewBook` of an upload.
 */
import type { BookPatch, ExtractedMetadata, NewBook } from "../../../shared/api.ts";
import type { BookStatus } from "../../../shared/schema.ts";
import { normalizeTag } from "./tags.ts";

export interface BookFormState {
  title: string;
  authors: string[];
  topic: string;
  status: BookStatus;
  tags: string[];
  /** `YYYY-MM-DD` or "". */
  startedAt: string;
  finishedAt: string;
  isbn: string;
  publisher: string;
  /** Year as typed ("" when unknown). */
  year: string;
  /** Pages as typed ("" when unknown). */
  pages: string;
  translators: string[];
  language: string;
  description: string;
}

/** The subset of a book (BookDetail or Book) the edit form reads. */
export interface FormSourceBook {
  title: string;
  authors: readonly string[];
  topic: string;
  status: BookStatus;
  tags?: readonly string[];
  startedAt?: string;
  finishedAt?: string;
  isbn?: string;
  publisher?: string;
  year?: number;
  pages?: number;
  translators?: readonly string[];
  language?: string;
  description?: string;
}

export function bookToFormState(book: FormSourceBook): BookFormState {
  return {
    title: book.title,
    authors: [...book.authors],
    topic: book.topic,
    status: book.status,
    tags: [...(book.tags ?? [])],
    startedAt: book.startedAt ?? "",
    finishedAt: book.finishedAt ?? "",
    isbn: book.isbn ?? "",
    publisher: book.publisher ?? "",
    year: book.year === undefined ? "" : String(book.year),
    pages: book.pages === undefined ? "" : String(book.pages),
    translators: [...(book.translators ?? [])],
    language: book.language ?? "",
    description: book.description ?? "",
  };
}

/**
 * True when the book on disk no longer matches the baseline the form was opened with
 * (the form keeps diffing against its frozen baseline, so saving never reverts such changes).
 */
export function bookChangedSince(baseline: BookFormState, current: FormSourceBook): boolean {
  return JSON.stringify(baseline) !== JSON.stringify(bookToFormState(current));
}

/** Starting form of an upload: extracted metadata, "Da leggere", the unsorted topic unless the caller picks one. */
export function formStateFromMetadata(
  metadata: ExtractedMetadata,
  defaults: { title: string; topic: string },
): BookFormState {
  return {
    title: metadata.title?.trim() || defaults.title,
    authors: metadata.authors.map(normalizeTag).filter((a) => a !== ""),
    topic: defaults.topic,
    status: "to-read",
    tags: [],
    startedAt: "",
    finishedAt: "",
    isbn: metadata.isbn ?? "",
    publisher: metadata.publisher ?? "",
    year: metadata.year === undefined ? "" : String(metadata.year),
    pages: metadata.pages === undefined ? "" : String(metadata.pages),
    translators: [...(metadata.translators ?? [])],
    language: metadata.language ?? "",
    description: metadata.description ?? "",
  };
}

/** ISBN as typed: spaces and hyphens dropped. */
export function normalizeIsbn(raw: string): string {
  return raw.replace(/[\s-]+/g, "");
}

function cleanList(list: readonly string[]): string[] {
  return list.map(normalizeTag).filter((s) => s !== "");
}

/** The page count typed in the form, or undefined when blank or not a positive whole number. */
export function parsePages(text: string): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined;
  const pages = Number(text);
  return pages >= 1 && pages <= 100000 ? pages : undefined;
}

/** The year typed in the form, or undefined when blank or not a plausible year. */
export function parseYear(raw: string): number | undefined {
  const text = raw.trim();
  if (!/^\d{1,4}$/.test(text)) return undefined;
  const year = Number(text);
  return year >= 1 ? year : undefined;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

type OptionalTextKey =
  | "startedAt"
  | "finishedAt"
  | "isbn"
  | "publisher"
  | "language"
  | "description";
const OPTIONAL_TEXT_KEYS: readonly OptionalTextKey[] = [
  "startedAt",
  "finishedAt",
  "isbn",
  "publisher",
  "language",
  "description",
];

function cleanOptional(key: OptionalTextKey, value: string): string {
  return key === "isbn" ? normalizeIsbn(value) : value.trim();
}

/** Only the changed fields. An optional field emptied by the user becomes `null` (removed from book.json). */
export function diffToPatch(initial: BookFormState, current: BookFormState): BookPatch {
  const patch: BookPatch = {};
  const title = current.title.trim();
  if (title !== initial.title.trim()) patch.title = title;
  const authors = cleanList(current.authors);
  if (!sameList(authors, cleanList(initial.authors))) patch.authors = authors;
  if (current.topic !== initial.topic) patch.topic = current.topic;
  if (current.status !== initial.status) patch.status = current.status;

  const tags = cleanList(current.tags);
  const initialTags = cleanList(initial.tags);
  if (!sameList(tags, initialTags)) patch.tags = tags.length === 0 ? null : tags;

  const translators = cleanList(current.translators);
  if (!sameList(translators, cleanList(initial.translators))) {
    patch.translators = translators.length === 0 ? null : translators;
  }
  const year = parseYear(current.year);
  if (year !== parseYear(initial.year)) patch.year = year ?? null;
  const pages = parsePages(current.pages);
  if (pages !== parsePages(initial.pages)) patch.pages = pages ?? null;

  for (const key of OPTIONAL_TEXT_KEYS) {
    const now = cleanOptional(key, current[key]);
    const before = cleanOptional(key, initial[key]);
    if (now === before) continue;
    patch[key] = now === "" ? null : now;
  }
  return patch;
}

export function isEmptyPatch(patch: BookPatch): boolean {
  return Object.values(patch).every((v) => v === undefined);
}

/**
 * True when the patch changes the file name of the book on the Kobo: the title changed, or the first author did
 * (the file is renamed, reading progress is kept). A topic change only rewrites the series in the metadata, so it
 * is not reported here. `initialAuthors` is the author list before the edit.
 */
export function patchMovesFiles(patch: BookPatch, initialAuthors: readonly string[]): boolean {
  if (patch.title !== undefined) return true;
  if (patch.authors === undefined) return false;
  return (patch.authors[0] ?? "") !== (cleanList(initialAuthors)[0] ?? "");
}

export type FormErrors = Partial<Record<keyof BookFormState, string>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Client-side checks mirroring the shared schema (the server stays the authority). */
export function validateForm(state: BookFormState): FormErrors {
  const errors: FormErrors = {};
  if (state.title.trim() === "") errors.title = "Il titolo è obbligatorio.";
  if (cleanList(state.authors).length === 0) errors.authors = "Serve almeno un autore.";
  if (state.topic === "") errors.topic = "Scegli un argomento.";
  const started = state.startedAt.trim();
  const finished = state.finishedAt.trim();
  if (state.year.trim() !== "" && parseYear(state.year) === undefined) {
    errors.year = "Anno non valido.";
  }
  if (state.pages.trim() !== "" && parsePages(state.pages) === undefined) {
    errors.pages = "Numero di pagine non valido.";
  }
  if (started !== "" && !validDate(started)) errors.startedAt = "Data non valida.";
  if (finished !== "" && !validDate(finished)) errors.finishedAt = "Data non valida.";
  if (
    !errors.startedAt &&
    !errors.finishedAt &&
    started !== "" &&
    finished !== "" &&
    finished < started
  ) {
    errors.finishedAt = "La fine non può precedere l’inizio.";
  }
  return errors;
}

/** Body of `POST /api/library/books`. Empty optional fields are omitted; `subjects` come from the EPUB. */
export function toNewBook(state: BookFormState, subjects: readonly string[] = []): NewBook {
  const book: NewBook = {
    title: state.title.trim(),
    authors: cleanList(state.authors),
    topic: state.topic,
    status: state.status,
  };
  const tags = cleanList(state.tags);
  if (tags.length > 0) book.tags = tags;
  for (const key of OPTIONAL_TEXT_KEYS) {
    const value = cleanOptional(key, state[key]);
    if (value !== "") book[key] = value;
  }
  const year = parseYear(state.year);
  if (year !== undefined) book.year = year;
  const pages = parsePages(state.pages);
  if (pages !== undefined) book.pages = pages;
  const translators = cleanList(state.translators);
  if (translators.length > 0) book.translators = translators;
  const cleanSubjects = subjects.map((s) => s.trim()).filter((s) => s !== "");
  if (cleanSubjects.length > 0) book.subjects = cleanSubjects;
  return book;
}
