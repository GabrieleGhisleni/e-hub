/**
 * Local cache layout (PLAN §5). The cache lives outside the repo (`~/.cache/e-library` by default, `cache.dir` in
 * elib.config.json): book text must never sit inside the public repo, and `git clean -fdx` must not wipe it.
 *
 *   <cache>/books/<id>/book.epub         original EPUB (uploaded: the only copy of the original)
 *   <cache>/books/<id>/book.kepub.epub   KEPUB made by kepubify
 *   <cache>/books/<id>/text/             chapters as Markdown (`elib text`, W4b)
 *   <cache>/uploads/<uploadId>/          staging area of an upload in progress (W3a)
 *   <cache>/highlights/                  raw highlight exports (future, never public)
 *
 * The cache holds the only local copy of the EPUBs and KEPUBs (the Kobo gets the KEPUB over SSH): back it up. A
 * missing EPUB cannot be fetched again.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { assertBookId } from "../repo/paths.ts";

export const CACHE_BOOKS_DIR = "books";
export const CACHE_UPLOADS_DIR = "uploads";
export const CACHE_HIGHLIGHTS_DIR = "highlights";
export const CACHE_EPUB_FILE = "book.epub";
export const CACHE_KEPUB_FILE = "book.kepub.epub";
export const CACHE_TEXT_DIR = "text";
export const CACHE_SUMMARY_PROGRESS_FILE = "summary-progress.json";

/** `<cache>/books`. */
export function cacheBooksDir(cacheDir: string): string {
  return path.join(cacheDir, CACHE_BOOKS_DIR);
}

/** `<cache>/books/<id>`. Throws `InvalidBookIdError` for anything that is not a book ID (no path tricks). */
export function cacheBookDir(cacheDir: string, id: string): string {
  assertBookId(id);
  return path.join(cacheBooksDir(cacheDir), id);
}

/** `<cache>/books/<id>/book.epub`. */
export function cachedEpubPath(cacheDir: string, id: string): string {
  return path.join(cacheBookDir(cacheDir, id), CACHE_EPUB_FILE);
}

/** `<cache>/books/<id>/book.kepub.epub`. */
export function cachedKepubPath(cacheDir: string, id: string): string {
  return path.join(cacheBookDir(cacheDir, id), CACHE_KEPUB_FILE);
}

/** `<cache>/books/<id>/text/` (W4b writes one Markdown file per chapter here). */
export function cachedTextDir(cacheDir: string, id: string): string {
  return path.join(cacheBookDir(cacheDir, id), CACHE_TEXT_DIR);
}

/** `<cache>/books/<id>/summary-progress.json` (chapter summaries saved while a book summary is being made). */
export function cachedSummaryProgressPath(cacheDir: string, id: string): string {
  return path.join(cacheBookDir(cacheDir, id), CACHE_SUMMARY_PROGRESS_FILE);
}

/** `<cache>/uploads`. */
export function cacheUploadsDir(cacheDir: string): string {
  return path.join(cacheDir, CACHE_UPLOADS_DIR);
}

/** `<cache>/uploads/<uploadId>`. Throws `InvalidUploadIdError` unless `uploadId` came from `newUploadId()`. */
export function uploadDir(cacheDir: string, uploadId: string): string {
  assertUploadId(uploadId);
  return path.join(cacheUploadsDir(cacheDir), uploadId);
}

/** `<cache>/highlights` (raw exports: never public, never in the repo). */
export function highlightsDir(cacheDir: string): string {
  return path.join(cacheDir, CACHE_HIGHLIGHTS_DIR);
}

/** `mkdir -p`; returns `dir`. */
export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Random upload ID (UUID v4, lowercase): safe as a folder name and in URLs. */
export function newUploadId(): string {
  return randomUUID();
}

export function isUploadId(value: unknown): value is string {
  return typeof value === "string" && UPLOAD_ID_PATTERN.test(value);
}

export class InvalidUploadIdError extends Error {
  constructor(value: string) {
    super(`invalid upload ID ${JSON.stringify(value)}`);
    this.name = "InvalidUploadIdError";
  }
}

export function assertUploadId(value: string): void {
  if (!isUploadId(value)) throw new InvalidUploadIdError(value);
}

/** True when `file` exists, is a regular file and is not empty. */
export async function isNonEmptyFile(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

/** Removes `<cache>/books/<id>/` (EPUB, KEPUB, text). No-op when missing. */
export async function removeCachedBook(cacheDir: string, id: string): Promise<void> {
  await rm(cacheBookDir(cacheDir, id), { recursive: true, force: true });
}
