/**
 * `elib text <id>`: EPUB → Markdown per chapter, written to `<cache>/books/<id>/text/` (PLAN §11).
 * Book text never goes into the repo (PLAN §14): the output dir is checked against the repo root at runtime.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "../../shared/slug.ts";
import { cachedEpubPath, cachedTextDir, isNonEmptyFile } from "../cache/index.ts";
import { REPO_ROOT } from "../config/index.ts";
import { extractEpubMetadata } from "../epub/index.ts";
import { BookNotFoundError, readBook } from "../repo/index.ts";
import { buildChapters } from "./chapters.ts";
import { EpubTextError, readEpubStructure } from "./structure.ts";

export { EpubTextError } from "./structure.ts";

export const TEXT_INDEX_FILE = "00-index.md";
export const TEXT_MANIFEST_FILE = "manifest.json";

export interface TextManifestChapter {
  n: number;
  file: string;
  title: string;
  words: number;
}

export interface TextManifest {
  id: string;
  title: string;
  authors: string[];
  generatedAt: string;
  chapters: TextManifestChapter[];
}

/** What text extraction needs: the repo data dir (book.json for title/authors) and the local cache (the EPUB). */
export interface TextContext {
  readonly dataDir: string;
  readonly cacheDir: string;
}

export interface ExtractTextOptions {
  /** Regenerate even when the output exists. */
  force?: boolean;
  /** Overrides the repo root used by the guard (tests). */
  repoRoot?: string;
  /** Clock for `generatedAt` (tests). */
  now?: () => Date;
}

export interface ExtractTextResult {
  outputDir: string;
  manifest: TextManifest;
  /** True when the existing output was kept (no `force`). */
  skipped: boolean;
}

export class UnsafeTextOutputError extends Error {
  constructor(dir: string, repoRoot: string) {
    super(`refusing to write book text inside the repo: ${dir} is under ${repoRoot} (PLAN §14)`);
    this.name = "UnsafeTextOutputError";
  }
}

export class EpubNotFoundError extends Error {
  constructor(id: string, file: string) {
    super(
      `no EPUB for book ${id} in the local cache (${file}): upload the book again from the admin`,
    );
    this.name = "EpubNotFoundError";
  }
}

export { EpubNotFoundError as NoEpubError };

async function realpathOfExistingAncestor(target: string): Promise<string> {
  let probe = path.resolve(target);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(await realpath(probe), ...rest.reverse());
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return path.resolve(target);
      rest.push(path.basename(probe));
      probe = parent;
    }
  }
}

/** Throws `UnsafeTextOutputError` when `dir` is the repo root or inside it (symlinks resolved). */
export async function assertOutsideRepo(dir: string, repoRoot: string = REPO_ROOT): Promise<void> {
  const target = await realpathOfExistingAncestor(dir);
  const root = await realpathOfExistingAncestor(repoRoot);
  const relative = path.relative(root, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new UnsafeTextOutputError(dir, root);
  }
}

/** The manifest in `outputDir`, or undefined when missing or unreadable. */
export async function readManifest(outputDir: string): Promise<TextManifest | undefined> {
  try {
    return JSON.parse(
      await readFile(path.join(outputDir, TEXT_MANIFEST_FILE), "utf8"),
    ) as TextManifest;
  } catch {
    return undefined;
  }
}

/** Path of the cached EPUB. Throws `EpubNotFoundError` when it is missing: the EPUB is never downloaded. */
async function ensureEpub(ctx: TextContext, id: string): Promise<string> {
  const file = cachedEpubPath(ctx.cacheDir, id);
  if (!(await isNonEmptyFile(file))) throw new EpubNotFoundError(id, file);
  return file;
}

async function bookMetadata(
  ctx: TextContext,
  id: string,
  epub: Uint8Array,
): Promise<{ title: string; authors: string[] }> {
  try {
    const book = await readBook(ctx.dataDir, id);
    return { title: book.title, authors: book.authors };
  } catch (error) {
    if (!(error instanceof BookNotFoundError)) throw error;
    const meta = await extractEpubMetadata(epub);
    return { title: meta.title, authors: meta.authors };
  }
}

export function chapterFileName(n: number, title: string, width: number): string {
  return `${String(n).padStart(width, "0")}-${slugify(title, 60) || "capitolo"}.md`;
}

function renderIndex(manifest: TextManifest): string {
  const lines = [
    `# ${manifest.title}`,
    "",
    ...(manifest.authors.length > 0 ? [`Autori: ${manifest.authors.join(", ")}`, ""] : []),
    `Capitoli: ${manifest.chapters.length}. Parole totali: ${manifest.chapters.reduce((s, c) => s + c.words, 0)}.`,
    "",
    ...manifest.chapters.map((c) => `${c.n}. [${c.title}](${c.file}) (${c.words} parole)`),
    "",
  ];
  return lines.join("\n");
}

export interface WriteBookTextOptions {
  /** Book ID (used in error messages). */
  id: string;
  title: string;
  authors: string[];
  /** Folder to create (replaced when it exists). Its parent must be writable: the temp dir is made next to it. */
  outputDir: string;
  /** Clock for `generatedAt` (tests). */
  now?: () => Date;
  /** Message of the error when the EPUB has no readable text (default: English, for `elib`). */
  noTextMessage?: string;
}

/**
 * Builds the chapters of an EPUB and writes them into `outputDir`: one Markdown file per chapter, `00-index.md`
 * and `manifest.json`. Written to a temp dir next to the target and swapped in with renames, so a failure keeps the
 * previous output. Does not check the output dir against the repo: callers do that (`assertOutsideRepo`).
 */
export async function writeBookText(
  epub: Uint8Array,
  options: WriteBookTextOptions,
): Promise<TextManifest> {
  const { id, outputDir } = options;
  const structure = readEpubStructure(epub);
  const chapters = buildChapters(structure);
  if (chapters.length === 0)
    throw new EpubTextError(
      options.noTextMessage ?? `book ${id}: no readable text found in the EPUB`,
    );

  const width = Math.max(2, String(chapters.length).length);
  const manifest: TextManifest = {
    id,
    title: options.title,
    authors: options.authors,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    chapters: chapters.map((c) => ({
      n: c.n,
      file: chapterFileName(c.n, c.title, width),
      title: c.title,
      words: c.words,
    })),
  };

  // The temp dir sits next to the target (same parent), so the final rename stays on one filesystem.
  const parentDir = path.dirname(outputDir);
  const suffix = randomBytes(4).toString("hex");
  const tmpDir = path.join(parentDir, `.text-${suffix}.tmp`);
  const oldDir = path.join(parentDir, `.text-${suffix}.old`);
  await mkdir(tmpDir, { recursive: true });
  try {
    for (const [i, chapter] of chapters.entries()) {
      await writeFile(path.join(tmpDir, manifest.chapters[i]!.file), chapter.markdown);
    }
    await writeFile(path.join(tmpDir, TEXT_INDEX_FILE), renderIndex(manifest));
    await writeFile(
      path.join(tmpDir, TEXT_MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const hadOld = await readdir(outputDir).then(
      () => true,
      () => false,
    );
    if (hadOld) await rename(outputDir, oldDir);
    try {
      await rename(tmpDir, outputDir);
    } catch (error) {
      if (hadOld) await rename(oldDir, outputDir);
      throw error;
    }
    await rm(oldDir, { recursive: true, force: true });
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

/**
 * Extracts the book text into `<cache>/books/<id>/text/`, from the EPUB in the local cache. Without `force`, an
 * existing output is kept.
 */
export async function extractBookText(
  ctx: TextContext,
  id: string,
  options: ExtractTextOptions = {},
): Promise<ExtractTextResult> {
  const outputDir = cachedTextDir(ctx.cacheDir, id); // validates the ID
  await assertOutsideRepo(outputDir, options.repoRoot);

  if (!options.force) {
    const existing = await readManifest(outputDir);
    if (existing) return { outputDir, manifest: existing, skipped: true };
  }

  const file = await ensureEpub(ctx, id);
  const bytes = new Uint8Array(await readFile(file));
  const meta = await bookMetadata(ctx, id, bytes);
  const manifest = await writeBookText(bytes, {
    id,
    title: meta.title,
    authors: meta.authors,
    outputDir,
    ...(options.now ? { now: options.now } : {}),
  });
  return { outputDir, manifest, skipped: false };
}
