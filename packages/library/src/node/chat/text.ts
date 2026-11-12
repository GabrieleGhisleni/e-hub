/**
 * Book text for the chat tools: the chapters of `elib text` (local cache). The manifest may be read without
 * touching Drive (`readCachedManifest`); the full text is loaded only by `loadBookText`, which may download the EPUB.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cachedTextDir } from "../cache/index.ts";
import type { DriveContext } from "../drive/context.ts";
import { TEXT_MANIFEST_FILE, extractBookText, type TextManifest } from "../text/index.ts";

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

/** The book text from the local cache, extracting it first when missing (may download the EPUB from Drive). */
export async function loadBookText(drive: DriveContext, id: string): Promise<BookText> {
  const { outputDir, manifest } = await extractBookText(drive, id);
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
