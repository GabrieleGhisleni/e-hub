# e-library — Implementation progress tracker

> **Restore point.** If a session breaks, a new session reads this file first, then `docs/progress/*.md`
> (one file per task, kept up to date by the agent working on it), then continues from the first task
> that is not `done`. `docs/PLAN.md` is the product spec (Italian); this file holds the execution plan,
> the cross-task contracts and the status.

Started: 2026-11-09. Orchestrator: main Claude Code session (Opus 5.5) delegating to subagents.

## Scope of this implementation run

| Plan phase                    | In scope?   | Notes                                                                                                          |
| ----------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| Fase 0 (manual prerequisites) | No (manual) | OAuth client, `elib` remote, `Libri/`, Kobo tests, GitHub repo, noreply email. Listed for the user at the end. |
| Fase 1 scaffolding            | Yes         | Wave 1                                                                                                         |
| Fase 2 core logic             | Yes         | Waves 2–3. No test ever touches real Drive: integration tests use a local rclone remote in a temp dir.         |
| Fase 3 admin UI               | Yes         | Waves 3–4                                                                                                      |
| Fase 4 public site + deploy   | Yes         | Waves 2–3 (workflow written, not run: no GitHub remote yet)                                                    |
| Fase 5 migration              | Code only   | `elib import [--dry-run]` is implemented; the real migration run is manual and later.                          |
| Fase 6 study skill            | Yes         | Wave 4 (`elib text <id>` + `.claude/skills/study/`). RAG not built (plan: only if grep is not enough).         |

Hard rules for every agent: no git commits (the noreply email is not set yet, Fase 0); never call the real
`gdrive:` or `elib:` rclone remotes; never put EPUB/KEPUB/extracted text in the repo; no secrets in the repo.

## Task board

Status values: `todo` · `in-progress` · `done` · `blocked`. Model = subagent model chosen for difficulty.

| ID  | Wave | Task                                                                                                                                                                                                          | Model  | Depends on | Status | Progress file          |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------ | ---------------------- |
| W1  | 1    | Scaffolding + shared core (deps, tsconfig, lint boundary, Zod schemas, config, ids, naming, paths, repo store, test helpers, shadcn init)                                                                     | opus   | –          | done   | `docs/progress/W1.md`  |
| W2a | 2    | EPUB metadata + cover extraction, cover → WebP, placeholder cover, Open Library client                                                                                                                        | sonnet | W1         | done   | `docs/progress/W2a.md` |
| W2b | 2    | rclone + kepubify wrappers, cache layout, `reconcile(id)`, `sync`, MD5 duplicate check                                                                                                                        | opus   | W1         | done   | `docs/progress/W2b.md` |
| W2c | 2    | Site data generation (index.json, books/<id>.json, Markdown→HTML), Vite data plugin, 404.html, `validate:data`                                                                                                | sonnet | W1         | done   | `docs/progress/W2c.md` |
| W2d | 2    | GitHub Actions workflow (validate, lint, format, typecheck, build, deploy Pages)                                                                                                                              | haiku  | W1         | done   | `docs/progress/W2d.md` |
| W3a | 3    | Services layer + Hono server (127.0.0.1, Origin/Host checks) + CLI (`sync`, `import`, `validate`)                                                                                                             | opus   | W2a, W2b   | done   | `docs/progress/W3a.md` |
| W3b | 3    | Public SPA: layout, theme, grid, filters, search, book page, routing, admin extension points                                                                                                                  | opus   | W2c        | done   | `docs/progress/W3b.md` |
| W4a | 4    | Admin UI: upload + cover choice, edit, bulk edit, delete, topics management                                                                                                                                   | sonnet | W3a, W3b   | done   | `docs/progress/W4a.md` |
| W4b | 4    | `elib text <id>` (EPUB → Markdown per chapter, in cache) + `.claude/skills/study/` skill                                                                                                                      | sonnet | W3a        | done   | `docs/progress/W4b.md` |
| R1  | 5    | Final review (correctness, plan conformance, security of local server, privacy rules)                                                                                                                         | opus   | all        | done   | `docs/progress/R1.md`  |
| R2a | 5    | Fixes, backend: R1-02 prune guard, R1-03 import retry, R1-04 unzip caps, R1-05 staging cleanup, R1-07 cache dir guard, R1-08 value scan, R1-10 cross-process lock, test temp-dir hygiene, CI epub guard icase | sonnet | R1         | done   | `docs/progress/R2a.md` |
| R2b | 5    | Fixes, site/admin: R1-01 Markdown URL sanitizing, R1-06 dev middleware crash, R1-09 edit-form baseline, bundle split + lighter public controls, admin nits                                                    | sonnet | R1         | done   | `docs/progress/R2b.md` |

## Cross-task contracts

These are the agreements that let tasks run in parallel. The agent that owns a contract may refine it, but
must update this section when it does.

### Layout and ownership

```
elib.config.json            W1   versioned config, no secrets
data/topics.json            W1   initial list, always contains {"id":"unsorted","label":"Da smistare"}
data/books/<id>/            runtime (written by the server/CLI)
src/shared/                 W1   Zod schemas, config schema, ids, slugs, Drive naming + paths, labels, API contract
src/node/repo/              W1   read/write book.json + topics.json (unknown fields preserved, stable format)
src/node/config/            W1   load elib.config.json (+ ELIB_CONFIG / ELIB_DATA_DIR overrides for tests)
src/node/epub/              W2a  metadata + cover extraction
src/node/covers/            W2a  cover → WebP (~600px), placeholder generation
src/node/openlibrary/       W2a  ISBN / title-author lookup, cover download, throttling
src/node/drive/             W2b  rclone wrapper, remote listing, reconcile, sync, md5 duplicate check
src/node/kepub/             W2b  kepubify wrapper
src/node/cache/             W2b  cache layout helpers (~/.cache/e-library by default)
src/node/site-data/         W2c  build index.json + books/<id>.json (no sharp import here!)
src/node/vite/              W2c  Vite data plugin (dev serve + watch + HMR event, build emit, 404.html)
src/node/services/          W3a  add/update/bulk/delete book, topics ops (shared by server and CLI)
src/node/server/            W3a  Hono app + entry
src/node/cli/               W3a  `elib` entry (commander); W4b adds `text`
src/node/text/              W4b  EPUB → Markdown per chapter
src/web/                    W3b  SPA (public); src/web/admin/ is W4a
.claude/skills/study/       W4b  study skill
.github/workflows/          W2d  CI + Pages deploy
test/helpers/               W1   synthetic EPUB builder, local rclone remote helper, temp data dir
```

Boundary: `src/web` never imports `src/node` (enforced by TS project references and an oxlint rule).
`src/shared` imports nothing from `src/node` or `src/web` and has no Node-only APIs.

Enforcement details (W1): `tsconfig.json` (solution) → `tsconfig.web.json` (src/web + src/shared, DOM, `vite/client`
types) and `tsconfig.node.json` (src/node, src/shared, test, vite/vitest configs, Node types), both `composite`
(shared options in `tsconfig.base.json`); a web file importing src/node fails with TS6307. `.oxlintrc.json`
overrides add `no-restricted-imports` for `src/web/**` (relative `…/node/…`, `node:*`, bare built-ins) and
`src/shared/**` (`…/node/…`, `…/web/…`, `@/…`, `node:*`, bare built-ins).

Import conventions: `src/node`, `src/shared` and `test` use **relative imports with explicit `.ts` extensions**
(`import { x } from "../../shared/ids.ts"`), no aliases. `src/web` uses `@/…` (→ `src/web`, shadcn convention) and
may import shared code as `@shared/…` (→ `src/shared`, alias in tsconfig.web.json + vite.config.ts) or relatively.
Unit tests live in `test/` (`test/shared`, `test/node`, `test/helpers`), not next to the sources.

### W1 modules and exports (for W2+)

- `src/shared/schema.ts`: `BookStatusSchema`/`BOOK_STATUSES`, `BookIdSchema`, `TopicIdSchema`, `IsoDateSchema`,
  `NonBlankStringSchema`, `BookSchema` (loose) + `Book`, `BOOK_KEY_ORDER`, `TopicSchema` + `Topic`,
  `TopicsFileSchema` (JSON **array**; unique ids, `unsorted` required, no two labels mapping to the same Drive
  folder), `BookCardSchema`/`BookCard`, `BookDetailSchema`/`BookDetail`, `SiteIndexSchema`/`SiteIndex`.
- `src/shared/labels.ts`: `UNSORTED_TOPIC_ID`, `UNSORTED_TOPIC_LABEL`, `STATUS_LABELS` (sentence case: "Da leggere"…),
  `statusLabel()`.
- `src/shared/ids.ts`: `generateBookId(existing, rng?)` (`rng: () => number` in [0,1), default Web Crypto),
  `isBookId`, `BOOK_ID_PATTERN`, `CROCKFORD_ALPHABET`, `topicIdFromLabel(label, existingIds)`, `isTopicId`.
- `src/shared/slug.ts`: `bookSlug(book)`, `authorSurname(author)`, `slugify(text, max?)`.
- `src/shared/naming.ts`: `driveFileName(book, "epub" | "kepub")`, `driveBaseName(book)`, `topicFolderName(label)`,
  `parseDriveFileName(name) → {id, kind} | null`, `parseIdFromDriveName(name)`, `sanitizeNameSegment`,
  `truncateName`, `DRIVE_FILE_EXTENSIONS`, `DriveFileKind`.
- `src/shared/paths.ts`: `expectedDrivePaths(book, topics, drive) → {kepub, epub}` (throws `UnknownTopicError`),
  `driveTreeDir(drive, "kobo" | "archive")`, `driveTopicDir(drive, tree, topicLabel)`, `remoteSpec(drive, path)`.
- `src/shared/config.ts`: `ElibConfigSchema`/`ElibConfig`, `DriveConfigSchema`/`DriveConfig`.
- `src/shared/api.ts` (draft, W3a owns): `ReconcileReport` `{dryRun, actions[{type: upload|move|trash|rmdir,
  status: planned|done|failed, bookId?, tree?, from?, to?}], warnings[], errors[]}` (messages `{code, message,
  bookId?, path?}`), `emptyReconcileReport()`, `UploadResponse`, `CoverCandidate`, `DuplicateMatch`, `NewBook`,
  `CreateBookRequest`, `BookPatch` (`null` removes an optional field), `BookWriteResponse`, `BulkUpdateRequest`,
  `SetCoverRequest`, `TopicLabelRequest`, `TopicWriteResponse`, `DeleteTopicResponse`, `ApiError`.
- `src/node/config/index.ts`: `loadConfig({env?, configPath?}) → LoadedConfig` (sync; `ElibConfig` + `configPath`,
  `repoRoot`, `dataDir`; `cache.dir` absolute), `REPO_ROOT`, `DEFAULT_DATA_DIR`, `expandHome`, `ConfigError`.
- `src/node/repo/index.ts` (every function takes `dataDir` first): `readTopics`, `writeTopics`, `listBookIds`,
  `readBook` (throws `BookNotFoundError` / `InvalidDataError`), `readAllBooks → {books, incomplete, invalid}`,
  `writeBook`, `serializeBook`, `deleteBookDir`, `readBookMarkdown(dataDir, id, "notes"|"recall"|"study")`,
  path helpers `booksDir`, `bookDir` (throws `InvalidBookIdError` on non-IDs), `bookJsonPath`, `coverPath`,
  `notesPath`, `recallPath`, `studyPath`, `topicsPath`, plus `writeFileAtomic`, `readTextIfExists`, `formatJson`.
- `test/helpers/index.ts`: `makeEpub(options) → path` / `buildEpub(options) → bytes` (EPUB 3 or 2, nav + NCX,
  cover PNG/JPEG via sharp, every field omittable), `createLocalRemote() → LocalRemote` (alias remote `elibtest`
  over a temp dir, temp rclone.conf via `RCLONE_CONFIG`; `.env`, `.spec(path)`, `.localPath(path)`,
  `.driveConfig()`, `.rclone(...args)`), `createTestEnv()` (temp data + cache + remote + elib.config.json and env
  `ELIB_CONFIG`/`ELIB_DATA_DIR`/`ELIB_CACHE_DIR`/`RCLONE_CONFIG`), `makeTempDataDir()`, `makeTempDir()`,
  `hasBinary(name)`. W2b's rclone/kepubify wrappers must accept an `env` option so tests can pass `remote.env`.
- Web: `src/web/lib/utils.ts` (`cn`), `src/web/hooks/use-resolved-theme.ts` (follows the `dark` class on `<html>`;
  used by `ui/sonner.tsx`, no next-themes), 21 shadcn components (style radix-vega, base color stone) in
  `src/web/components/ui/`. `__ELIB_ADMIN__` is declared in `src/web/env.d.ts`. Tooltip needs `TooltipProvider`.

### Data rules (from PLAN §5–6)

- Book ID: 8 random chars, Crockford base32 lowercase (`0123456789abcdefghjkmnpqrstvwxyz`), unique among `data/books/*`.
- `book.json`: required `id,title,authors,topic,status`; optional fields per PLAN §5; unknown fields always preserved;
  written as 2-space JSON + trailing newline, known keys in canonical order, unknown keys after them in original order.
  No Drive IDs, paths or file hashes, ever.
- A `data/books/<id>/` folder without `book.json` is an incomplete upload: readers skip it (and report it), ID generation still counts it.
- Status enum: `to-read | reading | read | abandoned` (labels: da leggere / in lettura / letto / abbandonato).
- Drive file name: `<first author> - <title> [<id>].epub` / `.kepub.epub`, FAT32-safe, truncated: rules fixed in
  PLAN §6 and implemented only in `src/shared/naming.ts` (`: | / \` → " - " or "-", `"` → `'`, `? * < >` removed,
  author ≤ 60 chars, `<author> - <title>` ≤ 120 chars and ≤ 200 UTF-8 bytes). Never rebuild names elsewhere.
- Drive paths: `<root>/<koboTree>/<topic label?>/<name>.kepub.epub` and `<root>/<archiveTree>/<topic label?>/<name>.epub`; topic subfolders configurable per tree.

### Config (`elib.config.json`, shape owned by W1)

rclone remote name, Drive root inside the remote, tree names, topic-subfolder flag per tree, cache path
(default `~/.cache/e-library`), server port + allowed UI origins, site base path `/e-library/`. Exact shape:

```json
{
  "drive": {
    "remote": "elib",
    "root": "",
    "koboTree": "Rakuten Kobo",
    "archiveTree": "Archivio",
    "topicSubfolders": { "kobo": true, "archive": true }
  },
  "cache": { "dir": "~/.cache/e-library" },
  "server": { "port": 8787, "allowedOrigins": ["http://127.0.0.1:5173", "http://localhost:5173"] },
  "site": { "basePath": "/e-library/" }
}
```

`drive.root` is a relative path inside the remote ("" = remote root; no leading/trailing "/", no ".."). The data
dir is not in the file: it is `<repo>/data` unless `ELIB_DATA_DIR` is set.

### Cache layout (owned by W2b)

`<cache>/books/<id>/book.epub`, `<cache>/books/<id>/book.kepub.epub`, `<cache>/books/<id>/text/` (W4b),
`<cache>/uploads/<uploadId>/` (staging for uploads, W3a: `upload.epub`, `analysis.json`, `cover-epub.webp`,
`cover-openlibrary.webp`, `state.json`), `<cache>/books/<id>/cover-candidates/` (W3a: `epub.webp`, `openlibrary.webp`,
`openlibrary.json` for the cover change of an existing book), `<cache>/highlights/` (future).

Helpers in `src/node/cache/index.ts` (never build these paths by hand): `cacheBooksDir`, `cacheBookDir(cache, id)`,
`cachedEpubPath`, `cachedKepubPath`, `cachedTextDir`, `cacheUploadsDir`, `uploadDir(cache, uploadId)`, `highlightsDir`,
`ensureDir`, `newUploadId()` (UUID v4) / `isUploadId` / `assertUploadId`, `isNonEmptyFile`, `removeCachedBook`.
Book-ID and upload-ID arguments are validated (`InvalidBookIdError` / `InvalidUploadIdError`), so no path tricks.
The cache is only a cache: reconcile reads `book.epub` / `book.kepub.epub` to upload, regenerates a missing KEPUB
with kepubify (from the cached EPUB, or from the EPUB downloaded back from Drive into `book.epub`), and never deletes
anything there. `trashBookFiles` leaves the cache alone too (a last local copy while the Drive trash keeps 30 days).

### Site data (owned by W2c)

Dev and build expose the same URLs under the base path (`src/shared/site-urls.ts`: `siteDataUrls(basePath)` →
`indexUrl`, `bookUrl(id)`, `coverUrl(fileName)`; `DATA_CHANGED_EVENT`): `<base>data/index.json`,
`<base>data/books/<id>.json`, `<base>data/covers/<id>.<sha256 first 8 hex>.webp`.

- `index.json` = `SiteIndex`: `topics[{id,label}]` + `books[BookCard]` sorted by title (it, accent-insensitive).
  `BookCard`: `id, slug, title, authors, topic, status, tags (always array), rating?, startedAt?, finishedAt?, coverUrl (full URL incl. base, or null)`.
- `books/<id>.json` = `BookDetail` = card + `isbn?, openLibraryCoverId?, publisher?, language?, description?, subjects?`
  - `notesHtml, recallHtml, studyHtml` (string or null). Unknown `book.json` fields are never published. Raw HTML in the
    Markdown is escaped.
- Node API: `src/node/site-data` (`buildSiteData`, `validateData`, `renderMarkdown`); Vite plugin `elibData({dataDir?, basePath?})` in `src/node/vite`.
- Dev: middleware + lazy in-memory cache; `data/` is watched and any change sends HMR custom event `elib:data-changed`
  (SPA: `import.meta.hot?.on("elib:data-changed", refetch)`). Invalid books are skipped with a warning.
- Build: `validateData` errors fail the build; emits the data files and `404.html` (= final `index.html`).
- `pnpm validate:data` errors: invalid topics/book, id≠folder, unknown topic, any file outside the allowed set
  (`topics.json`, `.gitkeep`, per book `book.json cover.webp notes.md recall.md study.md`), keys matching
  `/drive|md5|sha\d*|hash|path|fileId/i`. Warning: folder without `book.json`.

### Local API (owned by W3a, consumed by W4a; types + `apiPaths` + `API_LIMITS` in `src/shared/api.ts`)

All under `/api/library` (not under the site base path), proxied by Vite dev (`changeOrigin: false`) to the Hono server on
`127.0.0.1:<port>`; the UI calls relative URLs from `apiPaths`. JSON in/out; errors are `ApiError`
`{error:{code, message (Italian, showable), details?}}` with the codes listed in `ApiErrorCode`; Zod issues in
`details.issues` on 400 `invalid-request`. Every write response has a `ReconcileReport`. Status rule: repo changed → 2xx
even when Drive could not be aligned (report has errors; `elib sync` finishes later); operation aborted with the repo
unchanged (create/delete whose Drive step failed) → 502 `drive-failed` with `details.report`.

| Method + path                                 | Body                                                                                                        | Response                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/library/health`                             | –                                                                                                           | `{ok:true}`                                                                                                                                 |
| `POST /api/library/uploads`                           | multipart `file` (≤ 200 MB)                                                                                 | `UploadResponse` `{uploadId, fileName, size, metadata, covers[], duplicates[], warnings[]}`; 400 `not-an-epub` / `kepub-not-supported`, 413 |
| `GET /api/library/uploads/:uploadId/covers/:source`   | –                                                                                                           | `image/webp` (`epub` \| `openlibrary`, already the final normalized cover)                                                                  |
| `DELETE /api/library/uploads/:uploadId`               | –                                                                                                           | 204 (form cancelled: staging removed)                                                                                                       |
| `POST /api/library/books`                             | `CreateBookRequest` `{uploadId, book: NewBook, cover: epub\|openlibrary\|placeholder, openLibraryCoverId?}` | 201 `BookWriteResponse` `{book, report}`; retry of the same `uploadId` → same book                                                          |
| `PATCH /api/library/books/:id`                        | `BookPatch` (strict; `null` removes an optional field)                                                      | `BookWriteResponse` (write + reconcile)                                                                                                     |
| `DELETE /api/library/books/:id`                       | –                                                                                                           | `DeleteBookResponse` `{id, report}` (Drive trash, then repo folder removed; cache kept)                                                     |
| `GET /api/library/books/:id/cover-candidates`         | –                                                                                                           | `CoverCandidatesResponse` `{candidates[], warnings[]}` (may download the EPUB from Drive, queries Open Library)                             |
| `GET /api/library/books/:id/cover-candidates/:source` | –                                                                                                           | `image/webp`                                                                                                                                |
| `PUT /api/library/books/:id/cover`                    | `SetCoverRequest` `{source, openLibraryCoverId?}` or multipart `image` (≤ 20 MB)                            | `BookWriteResponse` (empty report: covers are repo-only)                                                                                    |
| `POST /api/library/books/bulk`                        | `BulkUpdateRequest` `{ids, patch:{topic?, status?, addTags?, removeTags?}}`                                 | `BulkUpdateResponse` `{books, report}` (tags compared case/accent-insensitively)                                                            |
| `GET /api/library/topics`                             | –                                                                                                           | `TopicsResponse` `{topics:[{id, label, bookCount}]}`                                                                                        |
| `POST /api/library/topics`                            | `{label}`                                                                                                   | 201 `TopicWriteResponse` `{topic, topics, report}`; 409 `topic-conflict` (same Drive folder)                                                |
| `PATCH /api/library/topics/:id`                       | `{label}`                                                                                                   | `TopicWriteResponse` (Drive folders renamed; books unchanged)                                                                               |
| `DELETE /api/library/topics/:id`                      | –                                                                                                           | `DeleteTopicResponse` `{id, reassigned, topics, report}`; 400 `topic-protected` for `unsorted`                                              |

Security (src/node/server/security.ts): listens on 127.0.0.1 only; `Host` must be `127.0.0.1:<port>`, `localhost:<port>`
or the host of an allowed origin (the Vite proxy forwards the browser's `Host: 127.0.0.1:5173`); `Origin`, when present,
must be in `server.allowedOrigins`; non-GET/HEAD requires an allowed `Origin` (curl: `-H 'Origin: http://127.0.0.1:5173'`);
`Sec-Fetch-Site` must be `same-origin`/`none` when present (`cross-site` and `same-site` → 403); no CORS headers;
`nosniff` + `no-store` on every response.

Services (`src/node/services/index.ts`, shared by server and CLI; `createServiceContext(config, opts)`,
`createServices(ctx)`): `analyzeUpload`, `readUploadCover`, `discardUpload`, `cleanupStaleUploads` (server start, 24h),
`createBook`, `updateBook`, `bulkUpdate`, `deleteBook`, `coverCandidates`, `readBookCoverCandidate`, `setBookCover`,
`listTopics`, `addTopic`, `renameTopic`, `deleteTopic`, `importFolder`/`scanImportFolder`. Writes are serialized by an
in-process mutex. CLI (`src/node/cli/`): `runCli(argv, io)`; commands are `CliCommand` objects listed in
`src/node/cli/commands/index.ts` (`COMMANDS`): `sync`, `import`, `validate` (+ W4b `text`).

## Decisions taken during implementation

(Orchestrator appends here; agents report decisions in their progress files.)

- Subagent models: opus for foundation/Drive logic/services/public UI design/review; sonnet for well-scoped modules; haiku for the CI workflow.
- No commits during this run (PLAN Fase 0 requires the GitHub noreply email first).

## Log

- 2026-11-09 — Tracker created. Toolchain checked: node 26.5, pnpm 11.28, kepubify 5.0, rclone 1.76 (only `gdrive:` remote, no `elib:` yet), registry reachable.
- 2026-11-09 — W1 launched (opus, background). Waves 2+ wait for it.
- 2026-11-10 — W1 stopped at deliverable 4/12 (API usage limit). Resumed the same agent via SendMessage; progress file docs/progress/W1.md is the resume point.
- 2026-11-10 — W1 done and verified by orchestrator (typecheck, lint, format:check, 110 tests, build all green). W2a (sonnet), W2b (opus), W2c (sonnet), W2d (haiku) launched in parallel.
- 2026-11-10 — W2d done (haiku): `.github/workflows/deploy.yml`, actions checkout@v7, pnpm/action-setup@v6, setup-node@v7, configure-pages@v6, upload-pages-artifact@v5, deploy-pages@v5. Not run on GitHub yet (no remote).
- 2026-11-10 — W2c done (sonnet): site data, `elibData()` Vite plugin, 404.html, `validate:data`; 16 tests incl. real build + dev server. Orchestrator fixed `SUSPICIOUS_KEY` (`sha\d*` flagged `shape`; now `sha-?\d+`). Decision kept: raw HTML in notes Markdown is escaped (no scripts on the public site).
- 2026-11-10 — W3b (opus) launched early: it only depends on W2c.
- 2026-11-10 — W2a done (sonnet): epub/covers/openlibrary, 29 tests. Smoke check on the real EPUBs in ~/Downloads: author, language, publisher, subjects, description and cover extracted; no ISBN in that OPF (correct). Orchestrator fixed the invalid default ISBN in test/helpers/epub.ts (now 9788800000000).
- 2026-11-10 — W2b (code written, tests pending) and W3b (mid-CSS; its progress file was not ticked) stopped at the API usage limit. Both resumed via SendMessage; W3b told to sync its progress file first.
- 2026-11-10 — W2b done (opus): rclone/kepubify wrappers, cache, reconcile/sync, md5 duplicates, trash; 62 tests (all local remote). Never run against real Drive: first real run must be `elib sync --dry-run`. W3a (opus) launched.
- 2026-11-10 — W3b done (opus): public SPA, admin extension points (`src/web/admin/types.ts`, `useLibrarySelection`, `refreshSiteData()`), demo data (`pnpm demo-data` → /tmp/elib-demo-data). Checked in browser at 375/768/1440, light+dark. Open for review: single 513 kB JS chunk (162 kB gzip); `tsconfig.node.json` now includes `src/web/lib` for tests.
- 2026-11-10 — Orchestrator removed a stray 8-byte `bad.epub` ("garbage") at the repo root, left by W2b's manual kepubify probe.
- 2026-11-10 — W3a stopped at the API usage limit (services files written, checklist unticked); resumed via SendMessage. W4b (sonnet) launched in parallel: owns `src/node/text/` + `src/node/cli/commands/text.ts`; the orchestrator registers the command in `main.ts` after W3a finishes. W4a waits for W3a's final API. TODO for the user at the end: decide whether to let the agent read `~/.cache/e-library` (PLAN §11-bis) — not done automatically (permission setting).
- 2026-11-10 — W4b done (sonnet): `extractBookText`, `.claude/skills/study/`, 21 tests. PENDING (orchestrator, after W3a): register `registerTextCommand(program)` from `./commands/text.ts` in `src/node/cli/main.ts`.
- 2026-11-10 — W3a done (opus): services, Hono server (127.0.0.1, Host/Origin/Sec-Fetch-Site checks), CLI sync/import/validate; API in `src/shared/api.ts`. createBook reserves the ID in staging `state.json` (retry-safe); delete keeps the cache copy. Orchestrator rewrote `elib text` as a `CliCommand` (`textCommand`) and registered it; its test now uses `runCli`. W4a (sonnet) launched.
- 2026-11-10 — R1 (opus, read-only) launched in parallel with W4a, scoped to everything except `src/web/admin/**`; the admin UI gets a separate review pass after W4a. Findings go to `docs/progress/R1.md`.
- 2026-11-10 — W4a done (sonnet): admin UI (upload + cover choice + duplicates, edit, cover change, bulk, delete, topics), 359 tests, admin absent from dist; checked in browser on demo data + local remote (desktop, light/dark). Not verified: Open Library candidate UI (needs network), image-file cover upload, 375px admin layout. R1 scope extended to `src/web/admin/**` via SendMessage.
- 2026-11-10 — R1 done (opus): 0 critical, 0 high, 4 medium, 6 low (8 reproduced); orchestrator re-confirmed R1-01. Fixes split into R2a (backend) and R2b (site/admin), both sonnet, disjoint files. Not taken: running rclone/kepubify integration tests in CI (can't be verified without a GitHub remote) — follow-up.
- 2026-11-10 — R2a and R2b actually launched now (a usage-limit stop hit between the tracker update and the launch).
- 2026-11-10 — R2b done (sonnet): R1-01 safe URLs in Markdown, R1-06, R1-09, admin nits; first-load JS 512.9→399 kB min (161.5→127.7 kB gzip) via vendor chunks, native sort select, theme toggle, lazy filter sheet. CSP meta skipped. One failing test in R2a's in-progress `validate.ts` area.
- 2026-11-10 — R2a done (sonnet): prune guard (`--force` to override), import resume + orphan MD5 rule, capped unzip, staging cleanup fix, cache-dir-in-repo rejected, value scan in `validate:data`, cross-process lock (new API error `busy`, 409), test temp-dir cleanup, CI guard case-insensitive.
- 2026-11-10 — **Run complete.** Orchestrator verification: typecheck, lint, format:check, validate:data, 409 tests (43 files), build all green; admin marker absent from `dist/`; repo `data/` untouched; first-load JS 399 kB min / 128 kB gzip. Re-checked by hand: unsafe Markdown URLs rendered as text; prune refused on an empty data dir (hardening.test.ts). PLAN §7.5, §11 and §16 updated with the decisions that changed behaviour.

## Remaining (not done in this run)

Manual (PLAN Fase 0, user):

- Personal OAuth client for rclone (urgent: the shared client stops working during 2026), re-auth `gdrive`.
- Create `Libri/` and the restricted remote `elib` (`root_folder_id` → `Libri/`).
- Kobo tests 1–4 (move `Rakuten Kobo`, subfolders, moved/renamed file keeps progress, `.kepub.epub` recognised). Adjust `elib.config.json` (`topicSubfolders.kobo`) to the results.
- Public GitHub repo + Pages via Actions; local `git config user.email` = GitHub noreply **before the first commit**.

First real runs, in this order: `pnpm elib import --dry-run <folder with a copy of the EPUBs>`; then point `drive.root` at `Libri-test` and try one upload + `pnpm elib sync --dry-run`; only then the real `elib` remote.

Decisions for the user:

- Let the agent read `~/.cache/e-library` (PLAN §11-bis, needed by the study skill) — a permission setting, not changed automatically.
- Raw HTML in notes is escaped (W2c); say if it should pass through.

Follow-ups (not verified or not built):

- Run the 62 rclone/kepubify integration tests in CI (install pinned rclone + kepubify); currently skipped there.
- Optional build-only CSP meta tag (skipped by R2b).
- Never exercised: real Google Drive, a real GitHub Actions run, Open Library cover candidates in the admin UI (network), uploading an image file as a cover, admin screens at 375px.
- Port 5173 is used by another local project: `pnpm dev` fails fast while it runs (use `pnpm exec vite --port 5199` and add that origin to `server.allowedOrigins`).
