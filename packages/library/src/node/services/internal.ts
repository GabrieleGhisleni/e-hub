/** Helpers shared by the service modules (not exported from the barrel). */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isBookId } from "../../shared/ids.ts";
import type { Book, Topic } from "../../shared/schema.ts";
import { foldToAscii } from "../../shared/text.ts";
import { cacheBooksDir } from "../cache/index.ts";
import {
  BookNotFoundError,
  InvalidDataError,
  bookDir,
  listBookIds,
  readBook,
  readTopics,
} from "../repo/index.ts";
import type { ServiceContext } from "./context.ts";
import { ServiceError, badRequest, conflict, notFound } from "./errors.ts";

/** Validates `value` with `schema`; 400 `invalid-request` with the Zod issues otherwise. */
export function parseInput<T extends z.ZodType>(
  schema: T,
  value: unknown,
  what: string,
): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest(
      "invalid-request",
      `Richiesta non valida (${what}): ${z.prettifyError(parsed.error)}`,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

export function assertValidBookId(id: string): void {
  if (!isBookId(id))
    throw badRequest("invalid-request", `ID libro non valido: ${JSON.stringify(id)}`);
}

/** Reads a book: 404 `book-not-found`, 409 `invalid-book` when its book.json does not validate. */
export async function loadBook(ctx: ServiceContext, id: string): Promise<Book> {
  assertValidBookId(id);
  try {
    return await readBook(ctx.dataDir, id);
  } catch (error) {
    if (error instanceof BookNotFoundError) {
      throw notFound("book-not-found", `Libro ${id} non trovato.`);
    }
    if (error instanceof InvalidDataError) {
      throw conflict("invalid-book", `Il book.json di ${id} non è valido: ${error.message}`);
    }
    throw error;
  }
}

/** Reads topics.json; an invalid file becomes a 409 (fix it by hand or with `elib validate`). */
export async function loadTopics(ctx: ServiceContext): Promise<Topic[]> {
  try {
    return await readTopics(ctx.dataDir);
  } catch (error) {
    if (error instanceof InvalidDataError) {
      throw conflict("invalid-request", `topics.json non è valido: ${error.message}`);
    }
    throw error;
  }
}

export function assertTopicExists(topics: readonly Topic[], topicId: string): Topic {
  const topic = topics.find((t) => t.id === topicId);
  if (!topic) throw badRequest("unknown-topic", `L'argomento "${topicId}" non esiste.`);
  return topic;
}

/** Maps the repo's validation error on a write to a 400 (the input produced an invalid book/topics file). */
export function asWriteError(error: unknown): unknown {
  if (error instanceof InvalidDataError) {
    return badRequest("invalid-request", `Dati non validi: ${error.message}`);
  }
  return error;
}

/** Case- and accent-insensitive comparison key ("Dèi, Uomini!" → "dei uomini"). */
export function normalizeForMatch(text: string): string {
  return foldToAscii(text.normalize("NFC"))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Names of the folders directly inside `dir` (empty when it does not exist). */
export async function listDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * IDs that a new book must not take: every folder in data/books (incomplete uploads included), every book folder in
 * the cache (files of a book that may still be on the Kobo) and the IDs reserved by uploads in progress.
 */
export async function takenBookIds(
  ctx: ServiceContext,
  reservedByUploads: Iterable<string>,
): Promise<Set<string>> {
  const taken = new Set<string>(await listBookIds(ctx.dataDir));
  for (const name of await listDirNames(cacheBooksDir(ctx.cacheDir))) {
    if (isBookId(name)) taken.add(name);
  }
  for (const id of reservedByUploads) taken.add(id);
  return taken;
}

/** True when `data/books/<id>/` exists (with or without book.json). */
export async function bookFolderExists(ctx: ServiceContext, id: string): Promise<boolean> {
  return (await listBookIds(ctx.dataDir)).includes(id);
}

/** `data/books/<id>/` (validated ID). */
export function repoBookDir(ctx: ServiceContext, id: string): string {
  return bookDir(ctx.dataDir, id);
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

export function baseName(fileName: string): string {
  return path.basename(fileName.replace(/\\/g, "/"));
}
