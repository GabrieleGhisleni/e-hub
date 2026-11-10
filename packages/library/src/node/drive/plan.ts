/**
 * Reconcile planning: from the repo (books + topics), one listing of both trees and the cache contents, decide which
 * moves, uploads and trash operations make Drive mirror the repo (PLAN §7, §11). Planning never writes anything.
 *
 * Per book there are two slots: the KEPUB at `expectedDrivePaths(…).kepub` (Kobo tree) and the EPUB at `.epub`
 * (Archive tree). Files are matched to a slot by the `[<id>]` in their name and by kind (`.kepub.epub` vs `.epub`):
 * a file never changes kind, so a plain EPUB never fills the KEPUB slot and vice versa.
 *
 * - a file of that kind already at the expected path → nothing;
 * - elsewhere (other topic folder, old name, wrong tree) → move the best copy (already in the right tree first, then
 *   the most recent) to the expected path; other copies are duplicates (warning; trashed only with `prune`);
 * - nowhere → upload from the cache; a missing KEPUB is regenerated with kepubify from the cached EPUB, or from the
 *   EPUB on Drive downloaded into the cache; nothing to upload → error for that book only.
 *
 * With `orphans` (sync of the whole library) it also reports files whose ID has no folder in data/books and files
 * whose name is not ours; with `prune` they go to the trash. IDs with a folder in data/books (incomplete uploads,
 * invalid book.json) are never orphans, so their files are never pruned.
 */
import type { ReconcileMessage } from "../../shared/api.ts";
import type { DriveConfig } from "../../shared/config.ts";
import type { DriveFileKind } from "../../shared/naming.ts";
import {
  type DriveTree,
  UnknownTopicError,
  driveTreeDir,
  expectedDrivePaths,
} from "../../shared/paths.ts";
import type { Book, Topic } from "../../shared/schema.ts";
import { cachedEpubPath, cachedKepubPath } from "../cache/index.ts";
import { treeOf } from "./guard.ts";
import type { LibraryFile } from "./remote-index.ts";

export interface MoveStep {
  type: "move";
  /** Destination tree. */
  tree: DriveTree;
  from: string;
  to: string;
  bookId?: string;
}

/** Where a regenerated KEPUB comes from: the cached EPUB, downloaded first from Drive when `download` is set. */
export interface KepubRegeneration {
  /** Cache path of the EPUB fed to kepubify. */
  epub: string;
  download?: {
    /** Where the EPUB is once this run's moves are done. */
    remote: string;
    /** Where it was before: used when its move failed. */
    remoteBeforeMove?: string;
  };
}

export interface UploadStep {
  type: "upload";
  tree: DriveTree;
  /** Local cache file. */
  from: string;
  to: string;
  bookId: string;
  /** Set when the KEPUB has to be made first. */
  regenerate?: KepubRegeneration;
}

export interface TrashStep {
  type: "trash";
  tree: DriveTree;
  from: string;
  bookId?: string;
}

/** Empty folder removal (`rclone rmdirs --leave-root` on the tree). */
export interface RmdirStep {
  type: "rmdir";
  tree: DriveTree;
  from: string;
}

export type PlanStep = MoveStep | UploadStep | TrashStep | RmdirStep;

export interface Plan {
  /** Moves first, then uploads, then trash, then folder removal. */
  steps: PlanStep[];
  warnings: ReconcileMessage[];
  errors: ReconcileMessage[];
}

export interface OrphanScan {
  /** Every folder name in data/books: books, incomplete uploads, invalid book.json. Never orphans. */
  knownIds: ReadonlySet<string>;
  /** Folders without book.json: their files are reported, never pruned. */
  incompleteIds: ReadonlySet<string>;
}

export interface PlanInput {
  drive: DriveConfig;
  cacheDir: string;
  topics: readonly Topic[];
  books: readonly Book[];
  files: readonly LibraryFile[];
  prune: boolean;
  /** Set for a whole-library sync: also look at files that belong to no book. */
  orphans?: OrphanScan;
  /** True when a cache file exists and is not empty. */
  cacheHas(file: string): Promise<boolean>;
}

const PRUNE_HINT = "`elib sync --prune` moves it to the Drive trash";

export async function planReconcile(input: PlanInput): Promise<Plan> {
  const { drive, cacheDir, prune } = input;
  const moves: MoveStep[] = [];
  const uploads: UploadStep[] = [];
  const trashes: TrashStep[] = [];
  const warnings: ReconcileMessage[] = [];
  const errors: ReconcileMessage[] = [];

  const byId = new Map<string, LibraryFile[]>();
  for (const file of input.files) {
    if (!file.id) continue;
    const list = byId.get(file.id) ?? [];
    list.push(file);
    byId.set(file.id, list);
  }

  /** Decides the slot's keeper (moving it if needed) and handles the other copies. */
  const planSlot = (
    bookId: string,
    kind: DriveFileKind,
    tree: DriveTree,
    expected: string,
  ): LibraryFile | undefined => {
    const candidates = (byId.get(bookId) ?? []).filter((f) => f.kind === kind);
    if (candidates.length === 0) return undefined;
    const keeper = candidates.find((f) => f.path === expected) ?? pickBest(candidates, tree);
    if (keeper.path !== expected) {
      moves.push({ type: "move", tree, from: keeper.path, to: expected, bookId });
    }
    for (const other of candidates) {
      if (other === keeper) continue;
      if (other.path === keeper.path) {
        // Drive allows two files with the same name in one folder; a path cannot tell them apart.
        warnings.push({
          code: "duplicate-name",
          bookId,
          path: other.path,
          message: `two files named "${other.path}": left alone (never pruned), remove one by hand (e.g. rclone dedupe)`,
        });
        continue;
      }
      warnings.push({
        code: "duplicate-file",
        bookId,
        path: other.path,
        message: `extra copy of the ${kind.toUpperCase()} of book ${bookId}${prune ? "" : `; ${PRUNE_HINT}`}`,
      });
      if (prune) trashes.push({ type: "trash", tree: other.tree, from: other.path, bookId });
    }
    return keeper;
  };

  for (const book of input.books) {
    let expected;
    try {
      expected = expectedDrivePaths(book, input.topics, drive);
    } catch (error) {
      if (!(error instanceof UnknownTopicError)) throw error;
      errors.push({
        code: "unknown-topic",
        bookId: book.id,
        message: `book ${book.id} has topic "${book.topic}", which is not in topics.json: its Drive files are left alone`,
      });
      continue;
    }

    // EPUB first: a missing KEPUB may be regenerated from it.
    const epub = planSlot(book.id, "epub", "archive", expected.epub);
    const kepub = planSlot(book.id, "kepub", "kobo", expected.kepub);
    if (epub && kepub) continue;

    const cacheEpub = cachedEpubPath(cacheDir, book.id);
    const cacheKepub = cachedKepubPath(cacheDir, book.id);
    const hasCacheEpub = await input.cacheHas(cacheEpub);

    if (!epub) {
      if (hasCacheEpub) {
        uploads.push(upload(book.id, "archive", cacheEpub, expected.epub));
      } else {
        errors.push({
          code: "missing-in-cache",
          bookId: book.id,
          path: expected.epub,
          message: `the EPUB of book ${book.id} is neither on Drive nor in the local cache (${cacheEpub})`,
        });
      }
    }

    if (!kepub) {
      if (await input.cacheHas(cacheKepub)) {
        uploads.push(upload(book.id, "kobo", cacheKepub, expected.kepub));
      } else if (hasCacheEpub || epub) {
        const regenerate: KepubRegeneration = { epub: cacheEpub };
        if (!hasCacheEpub && epub) {
          regenerate.download = {
            remote: expected.epub,
            ...(epub.path === expected.epub ? {} : { remoteBeforeMove: epub.path }),
          };
        }
        uploads.push({ ...upload(book.id, "kobo", cacheKepub, expected.kepub), regenerate });
        warnings.push({
          code: "kepub-regenerated",
          bookId: book.id,
          path: expected.kepub,
          message: hasCacheEpub
            ? `KEPUB of book ${book.id} missing on Drive and in the cache: regenerated with kepubify from the cached EPUB`
            : `KEPUB of book ${book.id} missing on Drive and in the cache: regenerated with kepubify from the EPUB on Drive (downloaded into the cache)`,
        });
      } else {
        errors.push({
          code: "missing-in-cache",
          bookId: book.id,
          path: expected.kepub,
          message: `the KEPUB of book ${book.id} is neither on Drive nor in the local cache, and there is no EPUB to regenerate it from`,
        });
      }
    }
  }

  if (input.orphans) {
    const { knownIds, incompleteIds } = input.orphans;
    for (const file of input.files) {
      if (!file.id) {
        warnings.push({
          code: "unrecognized-file",
          path: file.path,
          message: `"${file.path}" has no [<id>] in its name${prune ? "" : `; ${PRUNE_HINT}`}`,
        });
        if (prune) trashes.push({ type: "trash", tree: file.tree, from: file.path });
      } else if (incompleteIds.has(file.id)) {
        warnings.push({
          code: "incomplete-upload",
          bookId: file.id,
          path: file.path,
          message: `"${file.path}" belongs to an unfinished upload (data/books/${file.id}/ has no book.json): left alone, never pruned`,
        });
      } else if (!knownIds.has(file.id)) {
        warnings.push({
          code: "orphan-file",
          bookId: file.id,
          path: file.path,
          message: `"${file.path}" belongs to no book in the repo${prune ? "" : `; ${PRUNE_HINT}`}`,
        });
        if (prune) {
          trashes.push({ type: "trash", tree: file.tree, from: file.path, bookId: file.id });
        }
      }
    }
  }

  const steps: PlanStep[] = [...moves, ...uploads, ...trashes];
  steps.push(...emptiedFolders(drive, input.files, steps));
  return { steps, warnings, errors };
}

function upload(bookId: string, tree: DriveTree, from: string, to: string): UploadStep {
  return { type: "upload", tree, from, to, bookId };
}

/** Best copy for a slot: already in the slot's tree first, then the most recent, then by path (deterministic). */
function pickBest(candidates: readonly LibraryFile[], tree: DriveTree): LibraryFile {
  const time = (f: LibraryFile): number => {
    const t = Date.parse(f.modTime);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  const sorted = [...candidates].sort(
    (a, b) =>
      Number(b.tree === tree) - Number(a.tree === tree) ||
      time(b) - time(a) ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  return sorted[0] as LibraryFile;
}

/**
 * Folders (strictly inside a tree) that the given moves and trash operations leave without any file. Deepest first.
 * Uploads and move destinations keep their folders alive.
 */
export function emptiedFolders(
  drive: DriveConfig,
  files: readonly Pick<LibraryFile, "path">[],
  steps: readonly PlanStep[],
): RmdirStep[] {
  const counts = new Map<string, number>();
  const bump = (p: string, by: number): void => {
    counts.set(p, (counts.get(p) ?? 0) + by);
  };
  for (const file of files) bump(file.path, 1);
  const vacated: string[] = [];
  for (const step of steps) {
    if (step.type === "move") {
      bump(step.from, -1);
      bump(step.to, 1);
      vacated.push(step.from);
    } else if (step.type === "upload") {
      bump(step.to, 1);
    } else if (step.type === "trash") {
      bump(step.from, -1);
      vacated.push(step.from);
    }
  }

  const occupied = new Set<string>();
  for (const [p, count] of counts) {
    if (count <= 0) continue;
    for (const dir of parentDirs(p)) occupied.add(dir);
  }

  const result = new Map<string, DriveTree>();
  for (const p of vacated) {
    const tree = treeOf(drive, p);
    if (!tree) continue;
    const treeDir = driveTreeDir(drive, tree);
    for (const dir of parentDirs(p)) {
      if (dir === treeDir || !dir.startsWith(`${treeDir}/`)) break;
      if (!occupied.has(dir)) result.set(dir, tree);
    }
  }
  return [...result]
    .sort(([a], [b]) => b.split("/").length - a.split("/").length || (a < b ? -1 : 1))
    .map(([from, tree]) => ({ type: "rmdir", tree, from }));
}

/** `a/b/c/x` → `a/b/c`, `a/b`, `a`. */
function parentDirs(p: string): string[] {
  const dirs: string[] = [];
  let i = p.lastIndexOf("/");
  while (i > 0) {
    dirs.push(p.slice(0, i));
    i = p.lastIndexOf("/", i - 1);
  }
  return dirs;
}
