/**
 * Explorations on the Kobo. The books imported only for an exploration (origin `explore`, EPUB in the local cache) are
 * first added to the library, under a topic and with the same ID; the library then puts them on the Kobo (its topic
 * is their series there). Which explorations go is chosen by ID or by tag; which books, by verdict. Books already in
 * the library are skipped: `elib sync` handles them.
 */
import type { ReconcileReport } from "@ehub/library/explore";
import { type Exploration, type VerdictDecision } from "../schema.ts";
import { type LibraryDeps, withLibraryDeps } from "./library.ts";
import { markBookPromoted } from "./repo.ts";
import { ExploreError } from "./store.ts";

export interface KoboSelection {
  /** Explorations by ID. */
  ids?: readonly string[];
  /** Explorations that have at least one of these tags. */
  tags?: readonly string[];
  /** Only books whose verdict is one of these (`undecided` also covers books with no verdict). Default: all but `skip`. */
  decisions?: readonly VerdictDecision[];
}

export interface KoboBookPlan {
  id: string;
  title: string;
  authors: string[];
  language?: string;
  /** The exploration it comes from. */
  exploration: string;
}

export interface KoboPlan {
  explorations: string[];
  books: KoboBookPlan[];
  /** Library books of the selected explorations (already handled by `elib sync`). */
  skippedLibrary: number;
  /** Books left out by the verdict filter. */
  skippedVerdict: number;
}

/** Pure: which books of which explorations go to the library and the Kobo. */
export function planKoboBooks(all: readonly Exploration[], selection: KoboSelection): KoboPlan {
  const ids = new Set(selection.ids ?? []);
  const tags = new Set((selection.tags ?? []).map((t) => t.trim().toLowerCase()));
  if (ids.size === 0 && tags.size === 0) {
    throw new ExploreError("invalid-input", "Indica almeno un'esplorazione (--id) o un tag (--tag).");
  }
  for (const id of ids) {
    if (!all.some((e) => e.id === id)) throw new ExploreError("not-found", `Esplorazione «${id}» non trovata.`);
  }
  const decisions = selection.decisions ? new Set(selection.decisions) : undefined;
  const chosen = all.filter((e) => ids.has(e.id) || (e.tags ?? []).some((tag) => tags.has(tag)));

  const plan: KoboPlan = { explorations: [], books: [], skippedLibrary: 0, skippedVerdict: 0 };
  const seen = new Set<string>();
  for (const exploration of chosen) {
    plan.explorations.push(exploration.id);
    for (const source of exploration.sources) {
      if (source.origin === "library") {
        plan.skippedLibrary += 1;
        continue;
      }
      const decision: VerdictDecision = source.verdict?.decision ?? "undecided";
      const keep = decisions ? decisions.has(decision) : decision !== "skip";
      if (!keep) {
        plan.skippedVerdict += 1;
        continue;
      }
      if (seen.has(source.id)) continue;
      seen.add(source.id);
      plan.books.push({
        id: source.id,
        title: source.title,
        authors: source.authors,
        ...(source.language ? { language: source.language } : {}),
        exploration: exploration.id,
      });
    }
  }
  return plan;
}

/**
 * Adds the planned books to the library under `topic` (library topic ID) and, through the library, to the Kobo. One
 * report per book; a book that fails does not stop the others. In every exploration that has it, the source becomes
 * a library source. A Kobo that is off does not fail the step: the book is in the library and `elib sync` finishes it.
 */
export async function addBooksToLibraryAndKobo(
  plan: KoboPlan,
  topic: string,
  deps: Partial<LibraryDeps> = {},
): Promise<{ reports: ReconcileReport[]; failures: { id: string; message: string }[] }> {
  const library = withLibraryDeps(deps);
  const reports: ReconcileReport[] = [];
  const failures: { id: string; message: string }[] = [];
  for (const book of plan.books) {
    try {
      const { report } = await library.promoteExploreBook({ id: book.id, topic });
      reports.push(report);
      await markBookPromoted(book.id);
    } catch (error) {
      failures.push({ id: book.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { reports, failures };
}

/** Removes the planned books from the Kobo. Irreversible: the Kobo has no trash. */
export async function removeBooksFromKobo(
  plan: KoboPlan,
  options: { dryRun?: boolean } = {},
  deps: Partial<LibraryDeps> = {},
): Promise<ReconcileReport[]> {
  const library = withLibraryDeps(deps);
  const ctx = library.createKoboContext({ dryRun: options.dryRun === true });
  const reports: ReconcileReport[] = [];
  for (const book of plan.books) {
    reports.push(await library.removeExploreBookFiles(ctx, book.id, { dryRun: options.dryRun === true }));
  }
  return reports;
}
