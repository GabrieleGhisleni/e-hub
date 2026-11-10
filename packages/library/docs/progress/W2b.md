# W2b — rclone + kepubify wrappers, cache layout, reconcile / sync, MD5 duplicates, trash

Status: done (started 2026-11-10, interrupted once by the API limit, finished 2026-11-10)

## Checklist

- [x] Read docs (PROGRESS contracts, PLAN §2/5/6/7/11/14) and W1 code
- [x] Probed rclone 1.76 / kepubify 5 on a scratch alias remote (see Notes)
- [x] `src/node/cache/index.ts`: layout helpers, `ensureDir`, `newUploadId()`
- [x] `src/node/kepub/index.ts`: `convertToKepub`, `KepubifyError`
- [x] `src/node/drive/rclone.ts`: `createRclone`, `RcloneError`; `guard.ts`: path guard
- [x] `src/node/drive/remote-index.ts`: `listLibraryFiles`
- [x] `src/node/drive/plan.ts` + `execute.ts` + `reconcile.ts`: `reconcile`, `reconcileBooks`
- [x] `src/node/drive/topics.ts`: `renameTopicFolders`
- [x] `src/node/drive/duplicates.ts`: `findDuplicatesByMd5`, `md5File`
- [x] `src/node/drive/trash.ts`: `trashBookFiles`
- [x] `src/node/drive/context.ts`: `createDriveContext`; barrel `src/node/drive/index.ts`
- [x] Tests: 62 tests in 9 files (`test/node/drive/*`, `test/node/kepub/`, `test/node/cache/`), stable over repeated runs
- [x] `pnpm typecheck`, `pnpm lint` (whole repo) exit 0; own dirs formatted (`oxfmt --check` clean); full `vitest run` 257/257
- [x] "Cache layout" in docs/PROGRESS.md updated

## Exported API (for W3a)

From `src/node/drive/index.ts`:

- `createDriveContext(config: Pick<LoadedConfig,"drive"|"dataDir"|"cache">, { env?, dryRun?, rcloneBinary?, kepubifyBinary?, rcloneTimeoutMs?, kepubifyTimeoutMs? }) → DriveContext`
  (`{ config, drive, dataDir, cacheDir, rclone, kepubify, dryRun }`). A dry-run context never writes.
- `reconcile(ctx, ids: string[] | "all", { dryRun?, prune? }) → Promise<ReconcileReport>`. `"all"` = `elib sync`.
- `reconcileBooks(ctx, books: Book[], { dryRun?, prune? })`: same, with explicit book objects (upload flow: upload the
  cached EPUB/KEPUB before writing book.json).
- `renameTopicFolders(ctx, oldLabel, newLabel, { dryRun? }) → ReconcileReport` (call after topics.json has the new label).
- `trashBookFiles(ctx, id, { dryRun? }) → ReconcileReport`. Delete the repo folder only if `report.errors` is empty.
- `findDuplicatesByMd5(ctx, localEpubPath) → { kind: "md5", path, bookId: string | null }[]` (= `DuplicateMatch` md5
  variant), `md5File(path)`.
- Lower level: `createRclone`, `RcloneError`, `listLibraryFiles`, `planReconcile`, `emptiedFolders`,
  `assertSafeRemotePath`, `UnsafeRemotePathError`.
- `src/node/kepub/index.ts`: `convertToKepub(input, output.kepub.epub, { env?, binary?, timeoutMs? })`, `KepubifyError`.

Report message codes: warnings `duplicate-file`, `duplicate-name`, `orphan-file`, `unrecognized-file`,
`incomplete-upload`, `invalid-book`, `kepub-regenerated`, `topic-folder-exists`, `no-files`; errors `missing-in-cache`,
`unknown-topic`, `book-not-found`, `invalid-book`, `invalid-book-id`, `invalid-topics`, `read-failed`,
`listing-failed`, `rclone-failed`, `kepub-failed`, `download-failed`, `unsafe-path`, `action-failed`.

## Decisions / deviations

- **A file never changes kind.** A slot (KEPUB in the Kobo tree, EPUB in the Archive tree) is filled only by a file of
  its kind (`.kepub.epub` vs `.epub`, from the name). "Exact-kind match, then most recent" is implemented as: among
  same-kind copies, the one already in the slot's tree first, then the newest modTime, then path (deterministic).
- **Same-name twins** (Drive allows two files with the same name in a folder) are never trashed, even with `prune`:
  a path cannot tell them apart. Warning `duplicate-name`, fix by hand (e.g. `rclone dedupe`).
- **Protected IDs**: every folder in data/books (valid books, incomplete uploads, invalid book.json) is never an
  orphan, so a typo in a book.json can never get its files pruned. A book whose topic is not in topics.json gets an
  `unknown-topic` error and its files are left alone.
- **No-clobber**: `copyto`/`moveto` always pass `--ignore-existing` (never overwrite a Drive file, never delete the
  source because "the same file is already there"). Every write passes `--drive-use-trash=true`, which beats env vars
  and rclone.conf.
- **Local paths** are made absolute before reaching rclone/kepubify, so a file name can never look like a flag or a
  `remote:` spec. The two trees must be different folders (`assertDistinctTrees`, checked by `createRclone`).
- **Dry run** runs the same executor against a dry-run rclone (writes only recorded, guard still applies) and skips
  kepubify/downloads, so the report lists exactly what a real run would attempt. Statuses are `planned`.
- **KEPUB regeneration** has no own action type (the `ReconcileAction` enum is W3a's): it is an `upload` whose `from`
  is the cache KEPUB path, plus a `kepub-regenerated` warning. If the EPUB's move failed in the same run, the download
  uses its old path.
- **Empty folders**: after moves/trash, folders left without files are computed from the listing and the successful
  steps; one `rclone rmdirs --leave-root <tree>` per affected tree; each such folder is an `rmdir` action. No rmdir
  when nothing moved, so a second run plans nothing.
- **Topic rename**: if the new folder already exists, the folder is not merged (warning `topic-folder-exists`) and
  reconcile moves the files one by one. After a folder move rclone may fall back to per-file moves (leaving the empty
  source): the source is checked and `rmdirs` cleans it. In dry run the books are planned as if the folder had moved.
- **Order**: listings are sorted (Kobo tree first, then path), and MD5 matches by path, so reports are deterministic
  (`rclone md5sum` output order varies between runs).
- **Reconcile never throws for data problems**: listing/topics/book read failures become report errors. Programming
  errors and `trashBookFiles` with a non-ID throw.
- `rclone.planned` only records in dry-run (a long-running server context does not grow a log forever).

## Notes (probe results, 2026-11-10)

- `--drive-use-trash=true` is accepted with the local/alias test remote (backend flags are global), and a command-line
  flag beats env vars and rclone.conf: the wrapper passes it on every write to force the trash.
- Missing directory: `lsjson`, `md5sum`, `rmdirs` exit 3; `deletefile` on a missing file exits 4.
- `moveto <dir> <newdir>` moves the folder (server-side DirMove); onto an existing dir it falls back to per-file moves
  and leaves the empty source. `moveto` has no `--delete-empty-src-dirs`.
- `copyto`/`moveto --ignore-existing` skip (exit 0) when the destination exists: never overwrite, never delete the
  source (without it, moveto deletes the source when the destination is "identical").
- kepubify 5: `-o <nonexistent>.kepub.epub` = output file name; it creates the parent dir; an input that is already a
  KEPUB is "copied" unchanged (exit 0), which the byte-compare check catches; invalid zip → exit 1. `--` before the
  input is accepted.
- `rclone md5sum` prints in nondeterministic order (parallel hashing).

## Not done / for later

- Not verified against real Google Drive (forbidden in this run). Trash behaviour on Drive relies on rclone's
  `--drive-use-trash=true` semantics; the first real `elib sync` should be a `--dry-run`.
- No `elib sync` CLI wiring (W3a).
