/**
 * `explore prepare`: makes sure the text of every source is cached and reports its size, so the chat can decide
 * between reading whole books ("intero") and chapter by chapter ("per capitoli"). Read-only for the exploration.
 */
import { ExploreError, readExploration } from "./repo.ts";
import { type LibraryDeps, withLibraryDeps } from "./library.ts";

/** Rough token estimate for prose: words times 1.4. */
export const TOKENS_PER_WORD = 1.4;
export const DEFAULT_TOKEN_BUDGET = 500_000;

export interface PreparedBook {
  id: string;
  origin: "library" | "explore";
  title: string;
  chapters: number;
  words: number;
  tokens: number;
  /** Whether a `summary.json` exists (library books only; `null` for explore books, which have none). */
  summary: boolean | null;
  textDir: string;
}

export interface PreparedExploration {
  id: string;
  budget: number;
  books: PreparedBook[];
  totalWords: number;
  totalTokens: number;
  strategy: "intero" | "per capitoli";
}

export async function prepareExploration(
  id: string,
  options: { budget?: number } = {},
  deps: Partial<LibraryDeps> = {},
): Promise<PreparedExploration> {
  const library = withLibraryDeps(deps);
  const budget = options.budget ?? DEFAULT_TOKEN_BUDGET;
  const exploration = await readExploration(id);
  const books: PreparedBook[] = [];
  for (const source of exploration.sources) {
    let prepared;
    try {
      prepared = await library.ensureBookText(source.origin, source.id);
    } catch (error) {
      throw new ExploreError(
        "invalid-input",
        `Testo non disponibile per «${source.title}»: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const words = prepared.manifest.chapters.reduce((sum, chapter) => sum + chapter.words, 0);
    books.push({
      id: source.id,
      origin: source.origin,
      title: source.title,
      chapters: prepared.manifest.chapters.length,
      words,
      tokens: Math.round(words * TOKENS_PER_WORD),
      summary:
        source.origin === "library"
          ? (await library.readLibraryBookSummary(source.id)) !== null
          : null,
      textDir: prepared.textDir,
    });
  }
  const totalWords = books.reduce((sum, b) => sum + b.words, 0);
  const totalTokens = books.reduce((sum, b) => sum + b.tokens, 0);
  return {
    id,
    budget,
    books,
    totalWords,
    totalTokens,
    strategy: totalTokens <= budget ? "intero" : "per capitoli",
  };
}
