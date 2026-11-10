# Phase 3 — Core and data

Status: done (nothing committed)

## Checklist

- [x] schemas (`src/core/schema.ts`)
- [x] paths, stable JSON, atomic writes, store (`paths.ts`, `json-file.ts`, `store.ts`, `errors.ts`)
- [x] slug generation, url helpers (`slug.ts`, `urls.ts`)
- [x] transcript guard (`transcript-guard.ts`)
- [x] saveEpisode + errors (`save.ts`, `errors.ts`)
- [x] createEpisode / findEpisodeByUrlOrYoutubeId (`episodes.ts`), createShow / saveShowImage (`shows.ts`), writeTranscript / correctTranscriptSpeakers (`transcripts.ts`), pure `speakers.ts`, `tags.ts`
- [x] CLI `episode save` (+ stub spot for `add`), `tags`
- [x] shows Lex + Huberman (verified URLs, images via core: `pnpm exec tsx scripts/seed-shows.ts` → 512×512 webp, checked visually)
- [x] tests (92 passing, 7 files)
- [x] end-to-end CLI demo against a temp data dir
- [x] typecheck / lint / test pass; `format:check` clean on every file this phase owns (see Verification)

## Files

- `src/core/schema.ts` — Zod schemas + types (isomorphic, imports only `zod`).
- `src/core/errors.ts` — error classes, `EXIT_CODES`, `exitCodeFor`, `httpStatusFor` (isomorphic).
- `src/core/slug.ts`, `urls.ts`, `tags.ts`, `speakers.ts`, `transcript-guard.ts` — pure helpers (isomorphic).
- `src/core/paths.ts`, `json-file.ts`, `store.ts`, `save.ts`, `episodes.ts`, `shows.ts`, `transcripts.ts` — Node only.
- `src/cli/episode.ts` (`save`; `add` stub for phase 4), `src/cli/tags.ts`.
- `scripts/seed-shows.ts` — creates/refreshes the two hand-entered shows through core.
- `data/shows/{lex-fridman,huberman-lab}.json`, `public/shows/{lex-fridman,huberman-lab}.webp`.
- `tests/helpers.ts`, `tests/core/{transcript-guard,save,schema-slug,store}.test.ts`, `tests/cli.test.ts`, `tests/data.test.ts`.
- `.oxfmtrc.json`: added `data` to `ignorePatterns` (data files are written by core, not by the formatter).

## Verification

- `pnpm typecheck` OK, `pnpm lint` OK (0 warnings), `pnpm test` OK: 7 files, 92 tests (~7 s, the CLI tests spawn `tsx`).
- Isomorphic modules (`schema, errors, slug, urls, tags, speakers, transcript-guard`) typechecked separately under `tsconfig.web.json` settings (DOM libs, no Node types): OK; none imports `node:*`.
- `pnpm format:check`: all files owned by this phase are clean. At the end of the phase it still reports 5 files owned by others, left untouched to avoid racing their owners: `docs/DESIGN.md` and `transcriber/pyproject.toml` (phase 2 is editing them), `docs/PROGRESS.md`, `docs/progress/briefs/phase-5.md`, `docs/progress/briefs/phase-7.md` (orchestrator). A plain `pnpm format` fixes them once their owners are done.
- Tests never touch the real `data/`: every core test points `E_PODCASTS_DATA_DIR`/`E_PODCASTS_PUBLIC_DIR` at a fresh `mkdtemp` dir (removed afterwards). `tests/data.test.ts` only reads the real data (validates shows/episodes/conversations, checks images exist).
- "Done when" criteria, covered by tests (`tests/core/save.test.ts`, `tests/cli.test.ts`, `tests/core/transcript-guard.test.ts`) and demonstrated once through the CLI against a temp data dir (synthetic show + episode + 2000-word synthetic transcript created via `createShow`/`createEpisode`):
  1. valid input with `--expected-updated-at <current>` → exit 0, `fields changed: summary, tags`, `conversations: 1 added`, `transcript excerpts removed: 1`; stored conversation = `Quoting: [estratto della trascrizione rimosso] What do you think?`; `notes` (absent) unchanged.
  2. same input again → exit 0, `No changes`, `0 added, 1 skipped`, `updatedAt` unchanged.
  3. invalid input (`sumary`, tag `C++`) → exit 3 with `- tags[0]: tag must be lowercase…` and `- Unrecognized key: "sumary"`.
  4. stale `--expected-updated-at` → exit 5, `was modified in the meantime (expected …, found …)`.
  5. notes with a 25-word transcript excerpt → exit 6, `notes: 25 consecutive words from the transcript, starting "…"`.
  6. `pnpm tags` → `ai\t1`, `sleep\t1`. No temp files left in the data dir.
- Guard robustness/speed: a full §4.4-style export pasted into a conversation collapses into one placeholder with zero transcript words left; a 19-word quote is kept; 60k-word transcript × 200 KB conversation (2165 excerpts) redacted in well under 1 s (test bound 3 s).
- Shows: oEmbed `author_url` verified on 2026-11-09 — `https://www.youtube.com/@lexfridman` (video `ugvHCXCOmm4`), `https://www.youtube.com/@hubermanlab` (video `wbJ_Q1xsDHg`); feeds `https://lexfridman.com/feed/podcast/` (200, rss+xml) and `https://feeds.megaphone.fm/hubermanlab` (200); websites 200. Covers = channel-level `<itunes:image>` of each feed, saved by `createShow` → `saveShowImage`.

## Decisions and deviations

- **Summary = `string[]`** (0–10 points, each ≤ 500 chars, trimmed, non-empty). DESIGN's "3–5 key points" is guidance for agents, not enforced (a new episode has none).
- **Conversations file = plain JSON array** `[{date, agent, markdown}]`, oldest first; `date` stored as ISO UTC datetime (input accepts `YYYY-MM-DD` → midnight UTC). No hash stored: dedupe recomputes sha256 of the normalised markdown (CRLF→LF, trimmed); an input conversation is skipped if either its raw hash or its post-redaction hash is already stored, so re-running an input that contained excerpts still dedupes.
- **Transcript** has `createdAt` (required) and `sourceUrl?` besides the brief's fields; header info for the §4.4 export (title, guests, link) comes from the episode. Whisper transcripts must have `audio`, and `audio.source` must equal `timebase`.
- **Entities are strict**: unknown keys are validation errors (free data goes in `extra`). Defaults (`[]`, `""`, `{}`) are filled on parse and always written.
- **Tag normalisation**: trim + lowercase + runs of whitespace/underscores → `-`, then dedupe (first occurrence wins, order kept); then must match the slug regex (max 40 chars). Guests: trimmed, deduped.
- **`updatedAt`** is strictly increasing (now, or previous + 1 ms if the clock is not ahead) so two saves in the same millisecond still produce different versions. A save that changes nothing writes nothing and keeps `updatedAt`.
- **Guard transparency**: timestamps (`01:23`, `[01:23:45]`), speaker labels before a timestamp (bold anywhere, plain at line start), markdown headings and editor line-number prefixes (`12→`) are skipped when building the word stream, on both sides. Words are normalised (lowercase, NFKD without diacritics, apostrophes dropped). A redacted span also swallows the label/timestamp right before it on the same line and closing punctuation after it.
- **Size limit** (200 KB UTF-8 per conversation) applies only when there is no local transcript; checked only for conversations that would actually be added.
- **In-process lock** per episode (`withLock`) serialises read-modify-write within a process (the dev server can get concurrent requests); across processes the `updatedAt` check is the guard.
- `writeEpisode` ignores any `updatedAt` in its input (bug found by tests and fixed).
- Generated episode slugs are ≤ 80 chars (schema max 100); a leading repetition of the show name in the title is dropped; empty title slug → `<show>-episode`.
- Note for phase 8 / DESIGN §7.2: the Lex feed now has **503 items with enclosures back to 2018**, not ~38.

## API for later phases

All paths below are under `src/core/`. Node-side code imports with relative paths (e.g. `../core/save`); web code may import **only** the isomorphic modules (`@core/schema`, `@core/errors`, `@core/slug`, `@core/urls`, `@core/tags`, `@core/speakers`, `@core/transcript-guard`).

### Env vars

- `E_PODCASTS_DATA_DIR` — data root (default `<repo>/data`).
- `E_PODCASTS_PUBLIC_DIR` — public dir (default `<repo>/public`; show images go to `<public>/shows/`).
- Read on every call (`dataDir()`, `publicDir()` in `paths.ts`), so tests can set them per test.

### File formats

- `data/shows/<slug>.json` — `Show`: `{slug, name, host, links: {website?, youtube?}, youtubeAuthorUrl?, feedUrl?, image?: "shows/<slug>.webp", extra}`.
- `data/episodes/<slug>.json` — `Episode` (example below).
- `data/conversations/<slug>.json` — `Conversation[]`: `[{date: ISO datetime, agent: string, markdown: string}]`, oldest first; file absent = none.
- `data/transcripts/<slug>.json` (gitignored) — `Transcript`: `{source: "lex-official"|"patrykwajs-wiki"|"whisper-local", timebase: "youtube"|"feed", audio?: {source: "youtube"|"feed", url}, sourceUrl?, createdAt: ISO datetime, segments: [{speaker?, start: seconds, text}], chapters: [{title, start}], extra}`.
- All written as 2-space JSON + trailing newline, keys in schema order, `extra` keys sorted; atomic (hidden `.<name>.<hex>.tmp` + rename). `data/` is in oxfmt `ignorePatterns`.

Example episode:

```json
{
  "slug": "lex-fridman-452-dario-amodei-anthropic-ceo-on-claude-agi-the-future-of-ai",
  "title": "#452 – Dario Amodei: Anthropic CEO on Claude, AGI & the Future of AI & Humanity",
  "guests": ["Dario Amodei"],
  "show": "lex-fridman",
  "number": 452,
  "url": "https://lexfridman.com/dario-amodei",
  "youtubeId": "ugvHCXCOmm4",
  "publishedAt": "2024-11-11",
  "addedAt": "2026-11-09T10:15:00.000Z",
  "updatedAt": "2026-11-09T11:02:41.512Z",
  "transcriptSource": "lex-official",
  "transcriptTimebase": "youtube",
  "tags": ["ai", "ai-safety", "scaling-laws"],
  "summary": ["Scaling keeps working…", "Interpretability as…", "Responsible scaling…"],
  "notes": "## Scaling\n\nAt [01:23:45] he argues…",
  "extra": {}
}
```

Required: `slug, title, show, url, addedAt, updatedAt` (`guests, tags, summary, notes, extra` default to empty). `transcriptSource`/`transcriptTimebase`: both or neither.

### `schema.ts` (isomorphic)

- Schemas: `Slug`, `Tag`, `Show`, `ShowLinks`, `Episode`, `Conversation`, `ConversationsFile`, `Transcript`, `TranscriptSegment`, `TranscriptChapter`, `TranscriptAudio`, `TranscriptSource`, `Timebase`, `Summary`, `SaveEpisodeInput`, `NewConversation`, `HttpUrl`, `IsoDate`, `IsoDateTime`, `YoutubeId`, `Extra`.
- Types: same names (`z.infer`), plus `ShowInput`, `EpisodeInput`, `TranscriptInput` (pre-default input types), `SaveEpisodeInput` (input type), `ParsedSaveEpisodeInput`, `SaveField`.
- Constants: `SLUG_PATTERN`, `SLUG_MAX_LENGTH = 100`, `TAG_MAX_LENGTH = 40`, `SUMMARY_MAX_POINTS = 10`, `SUMMARY_POINT_MAX_LENGTH = 500`, `NOTES_MAX_LENGTH = 200000`, `TRANSCRIPT_SOURCES`, `TIMEBASES`, `SAVE_FIELDS = ["summary","notes","tags","guests"]`.
- Functions: `isValidSlug(s): boolean`, `normalizeTag(s): string`, `normalizeTags(tags): string[]`, `formatIssues(zodError, prefix?): string[]`.

### `errors.ts` (isomorphic)

- `CoreError {code, details: string[], describe(): string}`; subclasses `ValidationError`, `NotFoundError`, `ConflictError {expectedUpdatedAt, actualUpdatedAt}`, `TranscriptGuardError`, `DuplicateEpisodeError {existingSlug}`, `AlreadyExistsError`.
- `EXIT_CODES`: ok 0, unexpected 1, usage 2, validation 3, not-found 4, conflict 5, transcript-guard 6, duplicate 7, already-exists 8. `exitCodeFor(err): number`.
- `httpStatusFor(err)`: validation 400, not-found 404, conflict 409, transcript-guard 422, duplicate 409, already-exists 409, other 500.

### `save.ts` (Node)

- `saveEpisode(slug, input: unknown, {expectedUpdatedAt?, now?}?): Promise<SaveEpisodeResult>` where `SaveEpisodeResult = {episode, written, changedFields: SaveField[], conversations: {added, skipped, excerptsRemoved}, transcriptChecked}`. Throws `ValidationError | NotFoundError | ConflictError | TranscriptGuardError`; nothing is written on any error. Input: `{summary?: string[], notes?: string, tags?: string[], guests?: string[], conversations?: [{date?, agent, markdown}]}` (strict).
- `parseSaveInput(input): ParsedSaveEpisodeInput`, `normalizeMarkdown(md)`, `markdownHash(md)`.

### `episodes.ts` (Node) — phase 4

- `createEpisode(input: CreateEpisodeInput, {now?}?): Promise<Episode>`; `CreateEpisodeInput = {show, title, url, guests?, number?, youtubeId?, publishedAt?, tags?, extra?, addedAt?: string|Date, slug?, transcript?: TranscriptInput}`. Checks show exists (`NotFoundError`), duplicates (`DuplicateEpisodeError`), generates the slug, validates everything (incl. transcript) before writing; writes transcript then episode.
- `findEpisodeByUrlOrYoutubeId({url?, youtubeId?}): Promise<{episode, matchedBy: "youtubeId"|"url"} | undefined>`.
- `normalizeAddedAt(value: string|Date): string` (`YYYY-MM-DD` → `T00:00:00.000Z`; ISO datetime with offset → UTC).

### `shows.ts` (Node) — phase 4

- `createShow(input: ShowInput, {imageSource?: string|URL|Uint8Array, overwrite?}?): Promise<Show>` (validates before downloading; `AlreadyExistsError` unless `overwrite`; sets `image`).
- `saveShowImage(slug, source, {size?}?): Promise<"shows/<slug>.webp">` — http(s) download (30 s timeout, 25 MB cap) or bytes → sharp, square 512 px cover crop, webp q82 → `<public>/shows/<slug>.webp`.
- `findShowByYoutubeAuthorUrl(authorUrl): Promise<Show | undefined>` (normalised comparison).
- `SHOW_IMAGE_SIZE = 512`.

### `transcripts.ts` (Node) — phases 4, 7, 8

- `writeTranscript(slug, transcript: TranscriptInput, {now?}?): Promise<{transcript, episode}>` — writes the file and syncs `transcriptSource`/`transcriptTimebase` on the episode (rewrites the episode, bumping `updatedAt`, only if they change).
- `correctTranscriptSpeakers(slug, mapping: Record<old,new>, range?: {from?, to?}): Promise<Transcript>` — local transcript only.

### `speakers.ts` (isomorphic) — phase 7

- `listSpeakers(t): {speaker, segments, firstStart}[]` (order of appearance), `renameSpeakers(t, mapping, range?)` (simultaneous, so `{A:"B",B:"A"}` swaps; unknown speaker/empty name → `ValidationError`), `swapSpeakers(t, a, b, range?)`.

### `store.ts` (Node, low level)

- `readShow/readShowIfExists/listShows/listShowSlugs/writeShow`, `readEpisode/readEpisodeIfExists/listEpisodes` (newest `addedAt` first)`/listEpisodeSlugs/writeEpisode(input, {now?})` (always sets a fresh `updatedAt`; no guard/version check — use `saveEpisode` for content), `readConversations/writeConversations`, `readTranscript/readTranscriptIfExists/writeTranscriptFile`, `nextUpdatedAt(prev, now?)`, `withLock(key, fn)` (keys used: `episode:<slug>`, `episodes:create`, `show:<slug>`).

### Other

- `paths.ts`: `dataDir()`, `publicDir()`, `REPO_ROOT`, `assertSlug(slug, what?)`, `dirs.*`, `files.{show,episode,conversations,transcript,showImage}(slug)`, `showImageRelativePath(slug)`, `DATA_DIR_ENV`, `PUBLIC_DIR_ENV`.
- `json-file.ts`: `writeFileAtomic(path, content)`, `writeJsonAtomic(path, value)`, `readJsonIfExists(path)`, `toStableJson(value)`, `sortKeysDeep(value)`.
- `slug.ts`: `slugify(text, maxLength?)`, `truncateSlug(slug, max)`, `generateEpisodeSlug(showSlug, title, isTaken, maxLength = 80)`, `EPISODE_SLUG_MAX_LENGTH`. Use `slugify(channelName)` for generic show slugs.
- `urls.ts`: `extractYoutubeId(url)` (watch, youtu.be, embed, shorts, live, v), `normalizeUrlForComparison(url)`, `findMatchingEpisode(episodes, {url?, youtubeId?})` (pure).
- `tags.ts`: `countTags(episodes): {tag, count}[]` (desc, ties alphabetical).
- `transcript-guard.ts`: `buildTranscriptIndex(transcript | string)`, `findTranscriptExcerpts(index, text): {start, end, wordCount, preview}[]`, `redactTranscriptExcerpts(index, text): {text, removed, removedWords}`, `tokenize(text)`, `utf8ByteLength(text)`, `TRANSCRIPT_EXCERPT_MIN_WORDS = 20`, `TRANSCRIPT_EXCERPT_PLACEHOLDER = "[estratto della trascrizione rimosso]"`, `MAX_CONVERSATION_BYTES_WITHOUT_TRANSCRIPT = 204800`.

### CLI

- `pnpm episode save <slug> --input <file|-> [--expected-updated-at <ts>] [--json]` — human summary on stdout (`Saved <slug>` / `No changes for <slug>`, fields changed, conversations added/skipped, excerpts removed, new `updatedAt`); `--json` prints `{slug, written, updatedAt, changedFields, conversations: {added, skipped, excerptsRemoved}, transcriptChecked}`. Errors on stderr as `error (<code>): <message>` + `  - <detail>` lines.
- `pnpm episode add <url> [--added-at <date>]` — stub (exit 1). Phase 4: implement `runAdd` in `src/cli/episode.ts` (marked), map errors with `exitCodeFor` (the `main` catch already does it for `CoreError`).
- `pnpm tags [--json]` — `tag<TAB>count` per line, most used first; `--json` → `[{tag, count}]`. Read-only.
- Exit codes: 0 ok, 1 unexpected, 2 usage (bad args, unreadable `--input` file), 3 validation (incl. input not JSON), 4 not found, 5 conflict, 6 transcript guard, 7 duplicate, 8 already exists.
- `pnpm exec tsx scripts/seed-shows.ts [slug…]` — re-creates the two hand-entered shows (re-downloads covers).

### Notes for later phases

- Phase 4: feed cover extraction (channel `<itunes:image>` via fast-xml-parser) is in `scripts/seed-shows.ts`; move it into `src/core/ingest/` if ingest needs it. Use `findShowByYoutubeAuthorUrl` for show recognition and `createEpisode({..., transcript})` to write episode + transcript in one go.
- Phase 5: import JSON with `import.meta.glob`; types from `@core/schema` (`Episode`, `Show`, `Conversation`); `summary` is a list of points; `image` is relative to `import.meta.env.BASE_URL`.
- Phase 7: server maps errors with `httpStatusFor`; always pass `expectedUpdatedAt` to `saveEpisode`; on `ConflictError` the editor keeps the text and offers reload. The §4.4 export must keep the `**Speaker** [HH:MM:SS] text` paragraph format and `##` chapters (the guard treats those as transparent; tests in `tests/helpers.ts` → `compactMarkdownExport` mirror it).
- Phase 8: write the result with `writeTranscript(slug, {source: "whisper-local", timebase, audio: {source, url}, createdAt, segments, chapters: []})`.
