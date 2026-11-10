/**
 * `elib text <id>`: EPUB → Markdown per chapter, written to `<cache>/books/<id>/text/` (PLAN §11).
 * Book text never goes into the repo (PLAN §14): the output dir is checked against the repo root at runtime.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "../../shared/slug.ts";
import {
  cacheBookDir,
  cachedEpubPath,
  cachedTextDir,
  ensureDir,
  isNonEmptyFile,
} from "../cache/index.ts";
import { REPO_ROOT } from "../config/index.ts";
import type { DriveContext } from "../drive/context.ts";
import { listLibraryFiles } from "../drive/remote-index.ts";
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
  /** True when the EPUB was downloaded from Drive in this run. */
  downloaded: boolean;
}

export class UnsafeTextOutputError extends Error {
  constructor(dir: string, repoRoot: string) {
    super(`refusing to write book text inside the repo: ${dir} is under ${repoRoot} (PLAN §14)`);
    this.name = "UnsafeTextOutputError";
  }
}

export class EpubNotFoundError extends Error {
  constructor(id: string) {
    super(`no EPUB for book ${id}: not in the cache and not found in the Drive Archive tree`);
    this.name = "EpubNotFoundError";
  }
}

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

async function readManifest(outputDir: string): Promise<TextManifest | undefined> {
  try {
    return JSON.parse(
      await readFile(path.join(outputDir, TEXT_MANIFEST_FILE), "utf8"),
    ) as TextManifest;
  } catch {
    return undefined;
  }
}

/** Cached EPUB path, downloading it from the Drive Archive tree first when missing. Returns whether it downloaded. */
async function ensureEpub(
  ctx: DriveContext,
  id: string,
): Promise<{ file: string; downloaded: boolean }> {
  const file = cachedEpubPath(ctx.cacheDir, id);
  if (await isNonEmptyFile(file)) return { file, downloaded: false };
  const files = await listLibraryFiles(ctx.rclone, ctx.drive);
  const candidates = files
    .filter((f) => f.tree === "archive" && f.id === id && f.kind === "epub")
    .sort((a, b) => (a.modTime < b.modTime ? 1 : a.modTime > b.modTime ? -1 : 0));
  const remote = candidates[0];
  if (!remote) throw new EpubNotFoundError(id);
  await ensureDir(path.dirname(file));
  await ctx.rclone.download(remote.path, file);
  return { file, downloaded: true };
}

async function bookMetadata(
  ctx: DriveContext,
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

/**
 * Extracts the book text into `<cache>/books/<id>/text/`. Without `force`, an existing output is kept.
 * Written to a temp dir next to the target and swapped in with renames.
 */
export async function extractBookText(
  ctx: DriveContext,
  id: string,
  options: ExtractTextOptions = {},
): Promise<ExtractTextResult> {
  const outputDir = cachedTextDir(ctx.cacheDir, id); // validates the ID
  await assertOutsideRepo(outputDir, options.repoRoot);

  if (!options.force) {
    const existing = await readManifest(outputDir);
    if (existing) return { outputDir, manifest: existing, skipped: true, downloaded: false };
  }

  const { file, downloaded } = await ensureEpub(ctx, id);
  const bytes = new Uint8Array(await readFile(file));
  const structure = readEpubStructure(bytes);
  const chapters = buildChapters(structure);
  if (chapters.length === 0)
    throw new EpubTextError(`book ${id}: no readable text found in the EPUB`);
  const meta = await bookMetadata(ctx, id, bytes);

  const width = Math.max(2, String(chapters.length).length);
  const manifest: TextManifest = {
    id,
    title: meta.title,
    authors: meta.authors,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    chapters: chapters.map((c) => ({
      n: c.n,
      file: chapterFileName(c.n, c.title, width),
      title: c.title,
      words: c.words,
    })),
  };

  const bookDir = cacheBookDir(ctx.cacheDir, id);
  const suffix = randomBytes(4).toString("hex");
  const tmpDir = path.join(bookDir, `.text-${suffix}.tmp`);
  const oldDir = path.join(bookDir, `.text-${suffix}.old`);
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
  return { outputDir, manifest, skipped: false, downloaded };
}
