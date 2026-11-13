/**
 * Test doubles: a library with a few books (no data dir, no Drive, no EPUB parsing), and a CLI io that captures
 * its output. The EPUB "import" only records what it was given; the md5 is the real one of the bytes.
 */
import { createHash } from "node:crypto";
import type { LibraryBookRef, LibraryDeps, TextManifest } from "../src/node/index.ts";

export const LIBRARY_BOOKS: Record<string, { title: string; authors: string[]; language?: string }> = {
  "78w462eb": { title: "The Let Them Theory", authors: ["Mel Robbins"], language: "en" },
  eec5cpre: { title: "Also Sprach Zarathustra", authors: ["Friedrich Nietzsche"], language: "de" },
};

export const EMPTY_MANIFEST = (id: string, title: string): TextManifest => ({
  id,
  title,
  authors: [],
  generatedAt: "2026-11-12T00:00:00.000Z",
  chapters: [{ n: 1, file: "01.md", title: "Uno", words: 1000 }],
});

export interface FakeLibrary extends Partial<LibraryDeps> {
  /** Calls to importExploreEpub, to check that reuse does not import again. */
  imports: string[];
  /** Empties the fake explore text cache (as if ~/.cache were wiped). */
  clearCache(): void;
}

export function fakeLibrary(
  options: { books?: Record<string, { title: string; authors: string[]; language?: string }> } = {},
): FakeLibrary {
  const books = options.books ?? LIBRARY_BOOKS;
  const imports: string[] = [];
  const cached = new Set<string>();
  const ref = (id: string): LibraryBookRef | undefined => {
    const book = books[id];
    if (!book) return undefined;
    return { id, ...book, href: `/library/book/${id}/slug` };
  };
  return {
    imports,
    clearCache: () => cached.clear(),
    readLibraryBookRef: async (id: string) => ref(id),
    listLibraryBookRefs: async () =>
      Object.keys(books)
        .map((id) => ref(id)!)
        .sort((a, b) => a.title.localeCompare(b.title)),
    newExploreBookId: async (taken: ReadonlySet<string>) => {
      for (let n = 1; ; n += 1) {
        const id = `ex${String(n).padStart(6, "0")}`;
        if (!taken.has(id) && !books[id]) return id;
      }
    },
    importExploreEpub: async ({ id, bytes, fileName }) => {
      imports.push(id);
      cached.add(id);
      const md5 = createHash("md5").update(bytes).digest("hex");
      return {
        id,
        title: "Genealogia della morale",
        authors: ["Friedrich Nietzsche"],
        language: "it",
        epub: { fileName, md5, bytes: bytes.byteLength },
        textDir: `/cache/explore/books/${id}/text`,
        manifest: EMPTY_MANIFEST(id, "Genealogia della morale"),
      };
    },
    readCachedBookManifest: async (_origin, id) =>
      cached.has(id) || books[id] ? EMPTY_MANIFEST(id, books[id]?.title ?? "") : undefined,
    ensureBookText: async (origin, id) => {
      if (origin === "explore" && !cached.has(id)) throw new Error("Testo non in cache.");
      return { textDir: `/cache/${origin}/${id}/text`, manifest: EMPTY_MANIFEST(id, books[id]?.title ?? "") };
    },
    readLibraryBookSummary: async () => null,
    bookTextDir: (origin, id) => `/cache/${origin}/${id}/text`,
  };
}

/** Bytes that stand for an EPUB in the tests (the fake import does not parse them). */
export const FAKE_EPUB = new TextEncoder().encode("PK fake epub bytes");

export function captureIo(cwd: string, stdin = "") {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (text: string) => void stdout.push(text),
      stderr: (text: string) => void stderr.push(text),
      cwd,
      env: {} as NodeJS.ProcessEnv,
      readStdin: async () => stdin,
    },
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
  };
}
