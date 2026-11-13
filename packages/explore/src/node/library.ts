/**
 * The only door to the library: every library call the explorations need goes through `LibraryDeps`. The defaults
 * are the `@ehub/library/explore` facade; tests and the CLI pass fakes, so nothing touches a real data dir, Drive or
 * an EPUB unless it is asked to.
 */
import {
  type ExploreEpubImport,
  type LibraryBookRef,
  type BookSummary,
  type TextManifest,
  bookTextDir,
  ensureBookText,
  importExploreEpub,
  listLibraryBookRefs,
  newExploreBookId,
  readCachedBookManifest,
  readLibraryBookRef,
  readLibraryBookSummary,
} from "@ehub/library/explore";

export type { ExploreEpubImport, LibraryBookRef, BookSummary, TextManifest };

export interface LibraryDeps {
  readLibraryBookRef: typeof readLibraryBookRef;
  listLibraryBookRefs: typeof listLibraryBookRefs;
  newExploreBookId: typeof newExploreBookId;
  importExploreEpub: typeof importExploreEpub;
  ensureBookText: typeof ensureBookText;
  readCachedBookManifest: typeof readCachedBookManifest;
  readLibraryBookSummary: typeof readLibraryBookSummary;
  bookTextDir: typeof bookTextDir;
}

export const defaultLibraryDeps: LibraryDeps = {
  readLibraryBookRef,
  listLibraryBookRefs,
  newExploreBookId,
  importExploreEpub,
  ensureBookText,
  readCachedBookManifest,
  readLibraryBookSummary,
  bookTextDir,
};

/** Overrides for some of the dependencies (the rest keep their defaults). */
export function withLibraryDeps(overrides: Partial<LibraryDeps> = {}): LibraryDeps {
  return { ...defaultLibraryDeps, ...overrides };
}
