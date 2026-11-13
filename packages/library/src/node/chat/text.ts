/**
 * Book text for the chat tools: the chapters of `elib text` (local cache). The manifest may be read without
 * extracting it (`readCachedManifest`); the full text is loaded only by `loadBookText`, which reads the cached EPUB.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cachedTextDir } from "../cache/index.ts";
import {
  TEXT_MANIFEST_FILE,
  extractBookText,
  type TextContext,
  type TextManifest,
} from "../text/index.ts";

/** A book's text: its manifest and the Markdown of each chapter, by chapter number. */
export type BookText = {
  manifest: TextManifest;
  readChapter(n: number): Promise<string>;
};

/** The manifest from the local cache, or undefined when the text was never extracted. Never downloads. */
export async function readCachedManifest(
  cacheDir: string,
  id: string,
): Promise<TextManifest | undefined> {
  try {
    const raw = await readFile(path.join(cachedTextDir(cacheDir, id), TEXT_MANIFEST_FILE), "utf8");
    return JSON.parse(raw) as TextManifest;
  } catch {
    return undefined;
  }
}

/**
 * The book text of an output dir with its manifest: the chapters are read from the files the manifest names, and
 * each chapter is read at most once. Shared by the library (`loadBookText`) and the explorations (`loadExploreBookText`).
 */
export function bookTextFromDir(outputDir: string, manifest: TextManifest): BookText {
  const files = new Map(manifest.chapters.map((chapter) => [chapter.n, chapter.file]));
  const chapters = new Map<number, Promise<string>>();
  return {
    manifest,
    readChapter(n) {
      const file = files.get(n);
      if (file === undefined) return Promise.reject(new Error(`capitolo ${n} inesistente`));
      let text = chapters.get(n);
      if (text === undefined) {
        text = readFile(path.join(outputDir, file), "utf8");
        chapters.set(n, text);
      }
      return text;
    },
  };
}

/** The book text from the local cache, extracting it first when missing (reads the cached EPUB). */
export async function loadBookText(ctx: TextContext, id: string): Promise<BookText> {
  const { outputDir, manifest } = await extractBookText(ctx, id);
  return bookTextFromDir(outputDir, manifest);
}
