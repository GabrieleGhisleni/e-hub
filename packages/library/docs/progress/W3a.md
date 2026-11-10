# W3a — Services layer + Hono server + CLI

Status: done (started 2026-11-10; cut once by the API limit, resumed and finished the same day)

## Checklist

- [x] Read contracts (PROGRESS.md, W2a/W2b/W2c progress + index.ts exports, PLAN §2,3,5,6,7,8,11,12,14)
- [x] `src/shared/api.ts` finalized
- [x] `src/node/services/` — context.ts, mutex.ts, errors.ts, internal.ts
- [x] services: uploads.ts — analyzeUpload, readUploadCover, discardUpload, cleanupStaleUploads
- [x] services: books.ts — createBook (idempotent retry, book.json last), updateBook, bulkUpdate, deleteBook
- [x] services: covers.ts — coverCandidates, readBookCoverCandidate, setBookCover
- [x] services: topics.ts — listTopics (usage), addTopic, renameTopic, deleteTopic
- [x] services: import.ts — scanImportFolder, importFolder
- [x] services: index.ts barrel + `createServices(ctx)`
- [x] typecheck services (`tsc -b` clean)
- [x] server: app.ts (createApp, routes, error mapping, body limits), security.ts, main.ts
- [x] CLI: program.ts (`runCli`, `createProgram`, `CliContext`, `CliCommand`), format.ts,
      commands/{index,sync,import,validate}.ts, main.ts (typechecks, `--help` OK, `elib validate` OK on repo data).
      W4b owns `src/node/cli/commands/text.ts` and `src/node/text/`: NOT created here.
- [x] tests: services — test/node/services/books.test.ts (13: analyze, rejects, create e2e + retry, OL cover, validation, half-way Drive failure + retry via failing rclone wrapper script, duplicates, update, bulk, delete, delete with Drive down, concurrency, staging cleanup) + topics-covers.test.ts (5: add/clash, rename moves Drive folders, delete reassigns + usage, candidates with Drive re-download + OL, placeholder/image/invalid/too large). 18/18 green
- [x] tests: server — test/node/server/security.test.ts (21: Host/Origin/missing Origin/Sec-Fetch-Site matrix, proxy case, no CORS, validation 415/400/413/404/500 with fake services) + routes.test.ts (4: full flow with real services, upload errors + cancel, topics CRUD, health). 25/25 green
- [x] tests: CLI — test/node/cli/cli.test.ts (5, in-process `runCli`: help/unknown, validate ok/invalid/json, sync dry-run/json/real/--prune notice/orphan/exit 1, import --dry-run table+json+limit, real import + rerun skipped as duplicates). Output checked by eye with a scratch demo.
- [x] typecheck / lint / format / test — `tsc -b` 0, `oxlint` 0 (whole repo), own paths oxfmt-clean, `pnpm test` 36 files / 328 tests green
- [x] manual smoke run: server started with `ELIB_CONFIG`/`ELIB_DATA_DIR`/`ELIB_CACHE_DIR`/`RCLONE_CONFIG` → temp
      config on an alias remote (`elibsmoke`, root `Libri-test`) in the scratchpad, port 18787. Listens on 127.0.0.1 only
      (`ss`). curl: health 200; foreign Host 403; upload without Origin 403; upload with Origin 200 (metadata, EPUB
      candidate, real Open Library lookup on the synthetic ISBN → no cover); candidate image 200 image/webp; create 201
      (both files on the remote, book.json + cover.webp); PATCH topic → 2 moves + 2 rmdir; cross-site GET 403; topics with
      bookCount; DELETE → remote and data/books empty. Through Vite dev (`vite --port 5199`, origin 5199 added to the temp
      config): GET/POST `/api/topics` proxied OK (Host 127.0.0.1:5199 forwarded as-is), foreign Origin 403.
- [x] PROGRESS.md "Local API" subsection (endpoint table, error/status rules, security, services, CLI) + Cache layout line (staging files, cover-candidates) updated; oxfmt touched only that table

## Decisions

- Services are plain functions `fn(ctx, …)`; `createServices(ctx)` binds them for the server. One `ServiceContext`
  (`config, dataDir, cacheDir, drive, fetch, now, logger, openLibraryLimiter, limits, lock`) per process.
- Writes are serialized by an in-process, non-reentrant `Mutex` (`ctx.lock.runExclusive`); internal helpers that run
  inside the lock never take it again (e.g. `ensureEpubCandidate(…, locked)`).
- Errors: `ServiceError {code, status, details}` (codes listed in `ApiErrorCode` in api.ts); messages in Italian
  (shown by the admin UI as they are). Rule: repo changed → 2xx even with Drive errors in the report; operation
  aborted with the repo unchanged (create/delete whose Drive step failed) → 502 `drive-failed` with `details.report`.
- Staging dir `<cache>/uploads/<uploadId>/`: `upload.epub`, `analysis.json` (UploadResponse + createdAt +
  openLibrary match + hasEpubCover), `cover-epub.webp`, `cover-openlibrary.webp` (both already `toCoverWebp`-normalized,
  so the candidate served to the UI is exactly the final cover and always `image/webp`, never raw SVG), `state.json`
  (`{bookId, status: reserved|created}`).
- createBook failure handling: ID reserved in `state.json` before any side effect; on failure the repo folder is
  removed (it only holds cover.webp; a folder with other files is left and logged), so the repo has nothing
  half-written. Staging, reserved ID and cached EPUB/KEPUB stay: a retry of the same uploadId reuses the ID and
  reconcile finds what was already uploaded (no duplicate Drive files). After success the big staged files are removed,
  `state.json` = created, and a retry returns the existing book. Files that reached Drive before an abandoned upload
  become orphans for `elib sync` (warning; `--prune` trashes them). Discard / 24h cleanup of a never-created upload
  also removes its cache book dir and a cover-only repo folder.
- New IDs avoid: data/books folders (incomplete too), `<cache>/books/*` folders, IDs reserved by other staging dirs.
- Upload title fallback: file name (extractEpubMetadata on bytes, so the staged name `upload.epub` never leaks).
- `.kepub.epub` uploads rejected (400 `kepub-not-supported`): kepubify cannot convert them.
- Duplicates: MD5 vs Archive (failure → warning, not an error); title+author vs repo = same normalized title
  (NFC + fold accents + lowercase + non-alnum→space) and an author in common (title only when the EPUB has no author).
- Open Library cover chosen at create → `openLibraryCoverId` stored, plus `isbn` when the match came from the ISBN and
  the form sent none. Changing the cover of an existing book to another source leaves `openLibraryCoverId` alone.
- Cover candidates of existing books: `<cache>/books/<id>/cover-candidates/{epub.webp, openlibrary.webp,
  openlibrary.json}`; EPUB downloaded from Drive into `book.epub` when missing (under the lock). Cover change returns an
  empty report (repo only).
- Delete: cache `<cache>/books/<id>/` is KEPT (last local copy while the Drive trash keeps 30 days; consistent with
  W2b's trashBookFiles). An incomplete folder (no book.json) can be deleted too.
- Bulk tags compare case/accent-insensitively; `tags` key removed when it becomes empty; unchanged books not rewritten.
- deleteTopic order: books rewritten to `unsorted` first, then topics.json, then one reconcile of those books.
- Import: one `rclone md5sum` of the Archive for the whole batch (not per file); real run aborts if that listing
  fails, dry run warns. MD5 dup (Archive or earlier in batch) → skipped; title+author → warning only. Cover: EPUB, else
  Open Library ISBN match (only with `--openlibrary`, and lookups only for EPUBs without a cover), else placeholder.
  No author → "Autore sconosciuto". Failed item → its staging discarded, run continues.

- Server: extra endpoints beyond the draft: `DELETE /api/uploads/:uploadId` (form cancelled → staging removed),
  `GET /api/books/:id/cover-candidates/:source` (candidate image), `GET /api/topics` (topics + bookCount).
  Responses get `X-Content-Type-Options: nosniff` + `Cache-Control: no-store`. 415 for wrong body type.

## Deviations / fixes in other modules

- No bug found in W2a/W2b/W2c modules: none modified. `src/shared/api.ts` finalized (additions: `apiPaths`, `API_LIMITS`,
  `ApiErrorCode`, `mergeReconcileReports`, `HealthResponse`, `CandidateSource`, `UploadResponse.size/warnings`,
  `CoverCandidate.title/authors`, `CoverCandidatesResponse.warnings`, `TopicUsage`/`TopicsResponse`, `BulkPatch`).
- The smoke run's upload made a real Open Library lookup (server uses the global fetch) with the synthetic test
  metadata only; tests never touch the network (injected fetch).

## W4b registration pattern (`elib text <id>`)

`src/node/cli/commands/text.ts` exports `export const textCommand: CliCommand = { register(program, ctx) { program
.command("text").argument("<id>")….action(async (id, opts) => { … }) } }` (`CliCommand`, `CliContext` from
`../program.ts`; `ctx.config()`, `ctx.services()` (ServiceContext: `cacheDir`, `drive` for rclone downloads), `ctx.out/err`,
`ctx.fail(1)`). Registration in `src/node/cli/commands/index.ts`: `import { textCommand } from "./text.ts";` and add
`textCommand` to the `COMMANDS` array. Tests: `runCli(argv, io)` from `src/node/cli/program.ts` with a capturing `CliIO`
(see test/node/cli/cli.test.ts).

## Notes for resume

- Vite proxy has `changeOrigin: false` → the Hono server sees `Host: 127.0.0.1:5173` / `localhost:5173`; allowed Hosts =
  `127.0.0.1:<port>`, `localhost:<port>` + the host of every allowed origin.
- Security plan: reject bad Host (403 forbidden-host), foreign Origin (403), non-GET/HEAD without Origin (403
  origin-required), `Sec-Fetch-Site` cross-site **or same-site** (403; the UI is same-origin through the proxy).
- CLI plan: `src/node/cli/program.ts` (`createProgram`, `runCli(argv, io)`, `CliContext`, `CliCommand`),
  `src/node/cli/commands/index.ts` exports `COMMANDS` array; W4b registers with one import + one array entry.
