/**
 * Safety rails for `elib sync --prune` (R1-02). Prune treats as orphan every Drive file whose ID has no folder in the
 * data dir it reads, so a wrong or empty data dir would send the whole library to the Drive trash. A real prune is
 * refused when the repo has no books, or when it would trash "too much", unless forced.
 */
import type { ReconcileReport } from "../../shared/api.ts";

/** More than this many files to trash needs `--force`. */
export const PRUNE_MAX_FILES = 10;
/** …and so does trashing more than this share of the files the library is made of. */
export const PRUNE_MAX_FRACTION = 0.2;
/** The share limit only applies from this many files on (a duplicate or two in a tiny library is fine). */
export const PRUNE_FRACTION_MIN_FILES = 3;

export interface PruneAssessment {
  /** Books read from the data dir. */
  books: number;
  /** Files the prune would send to the trash. */
  trash: number;
  /** Why a real prune must be refused (without `--force`); null when it is fine. */
  refusal: string | null;
}

/** Judges a prune from a dry-run report (`prune: true`) and the number of books in the data dir. */
export function assessPrune(
  dryRunReport: ReconcileReport,
  books: number,
  dataDir: string,
): PruneAssessment {
  const trash = dryRunReport.actions.filter((a) => a.type === "trash").length;
  let refusal: string | null = null;
  if (books === 0) {
    refusal = `the data dir ${dataDir} has no books: every file on Drive would look like an orphan (wrong ELIB_DATA_DIR?)`;
  } else if (trash > PRUNE_MAX_FILES) {
    refusal = `${trash} files would go to the Drive trash (more than ${PRUNE_MAX_FILES})`;
  } else {
    const total = trash + books * 2;
    if (trash >= PRUNE_FRACTION_MIN_FILES && trash > total * PRUNE_MAX_FRACTION) {
      refusal = `${trash} of about ${total} files would go to the Drive trash (more than ${PRUNE_MAX_FRACTION * 100}%)`;
    }
  }
  return { books, trash, refusal };
}
