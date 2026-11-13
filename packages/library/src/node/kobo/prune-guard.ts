/**
 * Safety rails for `elib sync --prune` on the Kobo (port of the Drive guard). Prune treats as orphan every file on the
 * Kobo whose ID has no folder in the data dir it reads, so a wrong or empty data dir would delete the whole library
 * from the reader (irreversible: the Kobo has no trash). A real prune is refused when the repo has no books, or when it
 * would remove "too much", unless forced.
 */
import type { ReconcileReport } from "../../shared/api.ts";

/** More than this many files to delete needs `--force`. */
export const PRUNE_MAX_FILES = 10;
/** …and so does deleting more than this share of the files the library is made of. */
export const PRUNE_MAX_FRACTION = 0.2;
/** The share limit only applies from this many files on (a duplicate or two in a tiny library is fine). */
export const PRUNE_FRACTION_MIN_FILES = 3;

export interface PruneAssessment {
  /** Books read from the data dir. */
  books: number;
  /** Files the prune would delete from the Kobo. */
  removals: number;
  /** Why a real prune must be refused (without `--force`); null when it is fine. */
  refusal: string | null;
}

/** Judges a prune from a dry-run report (`prune: true`) and the number of books in the data dir. */
export function assessPrune(
  dryRunReport: ReconcileReport,
  books: number,
  dataDir: string,
): PruneAssessment {
  const removals = dryRunReport.actions.filter((a) => a.type === "remove").length;
  let refusal: string | null = null;
  if (books === 0) {
    refusal = `the data dir ${dataDir} has no books: every file on the Kobo would look like an orphan (wrong ELIB_DATA_DIR?)`;
  } else if (removals > PRUNE_MAX_FILES) {
    refusal = `${removals} files would be deleted from the Kobo (irreversible): more than ${PRUNE_MAX_FILES}`;
  } else {
    const total = removals + books * 2;
    if (removals >= PRUNE_FRACTION_MIN_FILES && removals > total * PRUNE_MAX_FRACTION) {
      refusal = `${removals} of about ${total} files would be deleted from the Kobo (irreversible): more than ${PRUNE_MAX_FRACTION * 100}%`;
    }
  }
  return { books, removals, refusal };
}
