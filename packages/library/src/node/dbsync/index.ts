/**
 * Local vs hosted comparison (`elib db`): the books of the data dir (and their EPUBs in the cache) against the ones of
 * the user's account on the API (`/api/store`, same routes the `explore` CLI uses). Pure planning plus an `apply` that
 * copies what is missing on either side; a file that exists on both sides with different content is only touched when
 * the caller says which side wins.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Backend } from "@ehub/store";
import { isBookId } from "../../shared/ids.ts";

/** Per-book files that travel; `book.epub` lives in the cache folder locally and in R2 remotely. */
const BOOK_FILES = ["book.json", "summary.json", "highlights.json", "notes.md", "recall.md", "study.md", "cover.webp"] as const;
export const EPUB_FILE = "book.epub";

export type Side = "local" | "remote";

export interface BookDiff {
  id: string;
  title: string;
  /** Present on each side (book.json). */
  local: boolean;
  remote: boolean;
  /** Files only on this side. */
  onlyLocal: string[];
  onlyRemote: string[];
  /** Files on both sides with different content. */
  differing: string[];
}

export interface DbDiff {
  books: BookDiff[];
  /** Topic ids missing on one side. */
  topicsOnlyLocal: string[];
  topicsOnlyRemote: string[];
}

export interface DiffOptions {
  dataDir: string;
  cacheDir: string;
  remote: Backend;
  /** Also compare the EPUBs (downloads each remote one: slow). Always counted for a book missing on one side. */
  epubs?: boolean;
}

function canonical(bytes: Uint8Array, file: string): string {
  const text = Buffer.from(bytes).toString("utf8");
  if (!file.endsWith(".json")) return text;
  try {
    return JSON.stringify(sortKeys(JSON.parse(text)));
  } catch {
    return text;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

function same(a: Uint8Array, b: Uint8Array, file: string): boolean {
  if (file.endsWith(".webp") || file.endsWith(".epub")) return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
  return canonical(a, file) === canonical(b, file);
}

async function readIfExists(file: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function localFile(options: Pick<DiffOptions, "dataDir" | "cacheDir">, id: string, file: string): string {
  return file === EPUB_FILE
    ? path.join(options.cacheDir, "books", id, "book.epub")
    : path.join(options.dataDir, "books", id, file);
}

async function localIds(dataDir: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(dataDir, "books"), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && isBookId(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}

function titleOf(bytes: Uint8Array | null): string {
  if (!bytes) return "";
  try {
    return String((JSON.parse(Buffer.from(bytes).toString("utf8")) as { title?: unknown }).title ?? "");
  } catch {
    return "";
  }
}

function topicIds(bytes: Uint8Array | null): string[] {
  if (!bytes) return [];
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.map((t) => String((t as { id?: unknown }).id ?? "")).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function diffLibrary(options: DiffOptions): Promise<DbDiff> {
  const remoteEntries = (await options.remote.list("books")) ?? [];
  const remoteIds = remoteEntries.filter((e) => e.isDirectory && isBookId(e.name)).map((e) => e.name);
  const ids = [...new Set([...(await localIds(options.dataDir)), ...remoteIds])].sort();
  const books: BookDiff[] = [];
  for (const id of ids) {
    const localBook = await readIfExists(localFile(options, id, "book.json"));
    const remoteBook = await options.remote.readBytes(`books/${id}/book.json`);
    const entry: BookDiff = {
      id,
      title: titleOf(localBook) || titleOf(remoteBook),
      local: localBook !== null,
      remote: remoteBook !== null,
      onlyLocal: [],
      onlyRemote: [],
      differing: [],
    };
    const withEpub = options.epubs || !entry.local || !entry.remote;
    for (const file of withEpub ? [...BOOK_FILES, EPUB_FILE] : BOOK_FILES) {
      const a = file === "book.json" ? localBook : await readIfExists(localFile(options, id, file));
      // A book missing remotely has no files there: do not ask the API for each one.
      const b = file === "book.json" ? remoteBook : entry.remote ? await options.remote.readBytes(`books/${id}/${file}`) : null;
      if (a && !b) entry.onlyLocal.push(file);
      else if (!a && b) entry.onlyRemote.push(file);
      else if (a && b && !same(a, b, file)) entry.differing.push(file);
    }
    if (entry.onlyLocal.length || entry.onlyRemote.length || entry.differing.length || !entry.local || !entry.remote) {
      books.push(entry);
    }
  }
  const localTopics = topicIds(await readIfExists(path.join(options.dataDir, "topics.json")));
  const remoteTopics = topicIds(await options.remote.readBytes("topics.json"));
  return {
    books,
    topicsOnlyLocal: localTopics.filter((t) => !remoteTopics.includes(t)),
    topicsOnlyRemote: remoteTopics.filter((t) => !localTopics.includes(t)),
  };
}

export interface ApplyOptions extends DiffOptions {
  /** Which side wins for files that differ; without it they are left alone. */
  prefer?: Side;
}

export interface ApplyResult {
  pushed: string[];
  pulled: string[];
  skipped: string[];
  failed: { key: string; message: string }[];
}

async function writeLocal(options: DiffOptions, id: string, file: string, bytes: Uint8Array): Promise<void> {
  const target = localFile(options, id, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

/** Fills the gaps in both directions (and resolves differing files toward `prefer`). Topics: union, local order first. */
export async function applyDiff(diff: DbDiff, options: ApplyOptions): Promise<ApplyResult> {
  const result: ApplyResult = { pushed: [], pulled: [], skipped: [], failed: [] };
  const attempt = async (key: string, bucket: string[], run: () => Promise<void>) => {
    try {
      await run();
      bucket.push(key);
    } catch (error) {
      result.failed.push({ key, message: (error as Error).message });
    }
  };
  const push = (id: string, file: string) =>
    attempt(`${id}/${file}`, result.pushed, async () => {
      const bytes = await readIfExists(localFile(options, id, file));
      if (bytes) await options.remote.write(`books/${id}/${file}`, bytes);
    });
  const pull = (id: string, file: string) =>
    attempt(`${id}/${file}`, result.pulled, async () => {
      const bytes = await options.remote.readBytes(`books/${id}/${file}`);
      if (bytes) await writeLocal(options, id, file, bytes);
    });
  for (const book of diff.books) {
    // book.json first: the API wants the book before its satellites.
    const order = (files: string[]) => files.toSorted((a, b) => Number(b === "book.json") - Number(a === "book.json"));
    for (const file of order(book.onlyLocal)) await push(book.id, file);
    for (const file of order(book.onlyRemote)) await pull(book.id, file);
    for (const file of book.differing) {
      if (options.prefer === "local") await push(book.id, file);
      else if (options.prefer === "remote") await pull(book.id, file);
      else result.skipped.push(`${book.id}/${file}`);
    }
  }
  if (diff.topicsOnlyLocal.length > 0 || diff.topicsOnlyRemote.length > 0) {
    await attempt("topics.json", result.pushed, async () => {
      const read = async (bytes: Uint8Array | null) =>
        bytes ? (JSON.parse(Buffer.from(bytes).toString("utf8")) as { id: string }[]) : [];
      const local = await read(await readIfExists(path.join(options.dataDir, "topics.json")));
      const remote = await read(await options.remote.readBytes("topics.json"));
      const merged = [...local, ...remote.filter((t) => !local.some((l) => l.id === t.id))];
      const text = `${JSON.stringify(merged, null, 2)}\n`;
      await writeFile(path.join(options.dataDir, "topics.json"), text);
      await options.remote.write("topics.json", text);
    });
  }
  return result;
}
