# R2a — backend fixes from R1

Status: done. typecheck, lint, format check and `pnpm test` (43 files, 409 tests) pass.

- [x] R1-02 prune guard: `src/node/drive/prune-guard.ts` (`assessPrune`), `elib sync` prints data dir + book count, real `--prune` refused on 0 books / >10 files / >20% unless `--force`. Tests: `test/node/services/hardening.test.ts`.
- [x] R1-03 import: failed import keeps staging + reserved ID, rerun resumes it (`findReusableStaging`); MD5 match with no book folder is an orphan (warning) in `importOne` and `analyzeUpload` (`dropOrphanMd5Matches`). Tests: hardening.test.ts.
- [x] R1-04 zip caps: `src/node/epub/zip.ts` (`openCappedZip`: 16 MB text / 50 MB other per entry via declared `originalSize`, 512 MB total, 20k entries, 256 MB inflated); used by `epub/index.ts` and `text/structure.ts`; non-EpubError in `extractEpubMetadata` becomes `EpubError`. Tests: `test/node/epub/zip-limits.test.ts`, hardening.test.ts (400 not-an-epub).
- [x] R1-05 `removeStaging` cleans cache/cover-only folder only when state is `reserved`. Test: hardening.test.ts.
- [x] R1-07 `loadConfig` rejects cache dir inside the repo (realpath-aware, `isInsideDir`); CI guard `git ls-files ':(icase)*.epub'`. Tests: `test/node/config.test.ts`.
- [x] R1-08 `validateData` scans values (Drive/Docs URLs, .epub paths, 32/40/64 hex) and keys (`file|link|url|checksum|digest` as words, not `profile`), JSON path in messages, also topics.json. Tests: `test/node/site-data/validate.test.ts`.
- [x] R1-10 lock: `ProcessLock` (`<cache>/.elib.lock`, O_EXCL, PID+time, stale reclaim) in `services/mutex.ts`; `Mutex.runExclusive` takes it; `sync`/`import` hold it for the whole real run; new API code `busy` (409). Tests: `test/node/services/process-lock.test.ts`, hardening.test.ts.
- [x] Gap 8 bulkUpdate preserves unknown fields (books.test.ts).
- [x] Gap 11 `trackTempDir`/`makeTrackedTempDir` + afterAll cleanup in `test/helpers/tmp.ts`; used by `makeEpub()` and covers test.

## Log

- Also ran `oxfmt src` once (whole tree); idempotent on already formatted files.
