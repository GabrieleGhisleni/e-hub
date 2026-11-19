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
  exploreSummaryStatus,
  importExploreEpub,
  listLibraryBookRefs,
  newExploreBookId,
  readCachedBookManifest,
  readExploreBookSummary,
  readExploreBookCover,
  readLibraryBookRef,
  readLibraryBookSummary,
  startExploreSummaryInBackground,
  createExploreKoboContext,
  listLibraryTopics,
  promoteExploreBook,
  removeExploreBookFiles,
  formatKoboReport,
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
  /** `summary.json` of an explore book, or null. */
  readExploreBookSummary: typeof readExploreBookSummary;
  /** Starts the summary of an explore book in the background (never throws, skips an existing summary). */
  startExploreSummaryInBackground: typeof startExploreSummaryInBackground;
  /** Progress of the summary of an explore book in this process, else whether it exists. */
  exploreSummaryStatus: typeof exploreSummaryStatus;
  bookTextDir: typeof bookTextDir;
  readExploreBookCover: typeof readExploreBookCover;
  /** The Kobo (SSH, or a local folder with `ELIB_KOBO_LOCAL_DIR`). */
  createKoboContext: typeof createExploreKoboContext;
  /** Topics of the library (the series on the Kobo). */
  listLibraryTopics: typeof listLibraryTopics;
  /** Library book from an explore book (same ID), uploaded to the Kobo by the library. */
  promoteExploreBook: typeof promoteExploreBook;
  removeExploreBookFiles: typeof removeExploreBookFiles;
  formatKoboReport: typeof formatKoboReport;
}

export const defaultLibraryDeps: LibraryDeps = {
  readLibraryBookRef,
  listLibraryBookRefs,
  newExploreBookId,
  importExploreEpub,
  ensureBookText,
  readCachedBookManifest,
  readLibraryBookSummary,
  readExploreBookSummary,
  readExploreBookCover,
  startExploreSummaryInBackground,
  exploreSummaryStatus,
  bookTextDir,
  createKoboContext: createExploreKoboContext,
  listLibraryTopics,
  promoteExploreBook,
  removeExploreBookFiles,
  formatKoboReport,
};

/** Overrides for some of the dependencies (the rest keep their defaults). */
export function withLibraryDeps(overrides: Partial<LibraryDeps> = {}): LibraryDeps {
  return { ...defaultLibraryDeps, ...overrides };
}
