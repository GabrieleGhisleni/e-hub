import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isBookId } from "../../shared/ids.ts";
import { readAllBooks, readTopics } from "../repo/index.ts";

export interface DataIssue {
  /** Path relative to the data dir, when the issue concerns a file or folder. */
  path?: string;
  message: string;
}

export interface ValidationResult {
  errors: DataIssue[];
  warnings: DataIssue[];
}

/** Files allowed per book folder (PLAN §5, §14: nothing else may enter the public repo). */
export const ALLOWED_BOOK_FILES: ReadonlySet<string> = new Set([
  "book.json",
  "cover.webp",
  "notes.md",
  "recall.md",
  "study.md",
]);

/**
 * Keys that look like file identifiers (PLAN §5 forbids Drive IDs, paths and hashes in book.json). `file`, `link`,
 * `url`, `checksum` and `digest` count as a word of the key (`file`, `fileUrl`, `drive_link`) but not as a substring of
 * an ordinary word (`profile`, `openLibraryCoverId` is fine).
 */
export function suspiciousKey(key: string): boolean {
  if (/drive|md5|sha-?\d+|hash|path|fileId/i.test(key)) return true;
  return (
    /(^|[^a-zA-Z])(file|link|url|checksum|digest)/i.test(key) ||
    /(File|Link|Url|URL|Checksum|Digest)/.test(key)
  );
}

/** Values that look like file identifiers: Drive/Docs URLs, EPUB paths, MD5 / SHA-1 / SHA-256 hex digests. */
const SUSPICIOUS_VALUES: readonly { re: RegExp; what: string }[] = [
  { re: /(drive|docs)\.google\.com|googleusercontent\.com/i, what: "a Google Drive/Docs URL" },
  { re: /\.(kepub\.)?epub(?![a-z0-9])/i, what: "an EPUB file name or path" },
  {
    re: /(?<![0-9a-z])(?:[0-9a-f]{64}|[0-9a-f]{40}|[0-9a-f]{32})(?![0-9a-z])/i,
    what: "a hex digest (MD5/SHA)",
  },
];

/** JSON paths of keys and string values that look like file identifiers. */
export function suspiciousFindings(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") {
    const hit = SUSPICIOUS_VALUES.find(({ re }) => re.test(value));
    return hit ? [`${prefix || "(root)"}: value looks like ${hit.what}`] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => suspiciousFindings(v, `${prefix}[${i}]`));
  }
  if (value === null || typeof value !== "object") return [];
  const found: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const where = prefix ? `${prefix}.${key}` : key;
    if (suspiciousKey(key)) found.push(`${where}: key looks like a file identifier`);
    found.push(...suspiciousFindings(child, where));
  }
  return found;
}

async function entries(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function checkFileSet(dataDir: string, result: ValidationResult): Promise<void> {
  const rel = (...p: string[]) => p.join("/");
  const forbidden = (p: string, what: string) =>
    result.errors.push({
      path: p,
      message: `${what} is not allowed in data/ (only topics.json and per-book book.json, cover.webp, notes.md, recall.md, study.md)`,
    });

  for (const top of (await entries(dataDir)) ?? []) {
    if (top.name === "topics.json" && top.isFile()) continue;
    if (top.name === ".gitkeep" && top.isFile()) continue;
    if (top.name === "books" && top.isDirectory()) continue;
    forbidden(top.name, top.isDirectory() ? "directory" : "file");
  }

  const booksDir = path.join(dataDir, "books");
  for (const book of (await entries(booksDir)) ?? []) {
    if (book.name === ".gitkeep" && book.isFile()) continue;
    const bookRel = rel("books", book.name);
    if (!book.isDirectory()) {
      forbidden(bookRel, "file");
      continue;
    }
    for (const file of (await entries(path.join(booksDir, book.name))) ?? []) {
      const fileRel = rel(bookRel, file.name);
      if (file.isFile() && ALLOWED_BOOK_FILES.has(file.name)) continue;
      forbidden(fileRel, file.isDirectory() ? "directory" : "file");
    }
  }
}

/** Validates the whole data dir: schemas, references, forbidden files, suspicious keys. */
export async function validateData(dataDir: string): Promise<ValidationResult> {
  const result: ValidationResult = { errors: [], warnings: [] };

  let topicIds: Set<string> | null = null;
  try {
    topicIds = new Set((await readTopics(dataDir)).map((t) => t.id));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    result.errors.push({
      path: "topics.json",
      message: code === "ENOENT" ? "topics.json is missing" : (error as Error).message,
    });
  }

  await checkFileSet(dataDir, result);

  const { books, incomplete, invalid } = await readAllBooks(dataDir);
  for (const bad of invalid) {
    result.errors.push({ path: `books/${bad.id}`, message: bad.message });
  }
  for (const id of incomplete) {
    result.warnings.push({
      path: `books/${id}`,
      message: "folder without book.json (incomplete upload)",
    });
  }
  for (const book of books) {
    if (topicIds && !topicIds.has(book.topic)) {
      result.errors.push({
        path: `books/${book.id}/book.json`,
        message: `unknown topic "${book.topic}"`,
      });
    }
  }
  try {
    const rawTopics = JSON.parse(await readFile(path.join(dataDir, "topics.json"), "utf8"));
    for (const finding of suspiciousFindings(rawTopics)) {
      result.errors.push({
        path: "topics.json",
        message: `${finding} (Drive IDs, paths and hashes must never be stored)`,
      });
    }
  } catch {
    // missing or unparsable: reported above
  }
  // Suspicious keys and values: also in books that failed schema validation, as long as the JSON parses.
  const allIds = [...books.map((b) => b.id), ...invalid.map((b) => b.id)].filter(isBookId);
  for (const id of allIds) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path.join(dataDir, "books", id, "book.json"), "utf8"));
    } catch {
      continue;
    }
    for (const finding of suspiciousFindings(raw)) {
      result.errors.push({
        path: `books/${id}/book.json`,
        message: `${finding} (Drive IDs, paths and hashes must never be stored)`,
      });
    }
  }
  return result;
}
