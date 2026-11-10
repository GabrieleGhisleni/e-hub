# Brief — phase 3 (Core and data) — model: opus

You are implementing **phase 3 (Core and data)** of the e-podcasts project in /home/ggabry/projects/e-podcasts. This phase defines the data contracts every later phase builds on (ingest, frontend, server, transcriber, skills), so favour clear, stable, well-tested APIs.

First read `docs/PROGRESS.md` ("Rules every subagent gets" — follow them strictly), `docs/progress/phase-1.md` (how the project is set up: aliases, tsconfigs, scripts) and `docs/DESIGN.md` §2.4, §3.1, §4 (all), §5 (all), §6 (for what ingest will need from you), §8.1, §13, §15 phase 3. The design doc is in Italian. A phase-2 agent may still be working in `transcriber/` — don't touch it or `docs/DESIGN.md`.

Keep `docs/progress/phase-3.md` updated as you go (checklist of done/remaining, verification evidence, deviations, **an "API for later phases" section**). If it already exists, continue from its checklist.

## You own

`src/core/` (except `src/core/ingest/`, reserved for phase 4), `src/cli/episode.ts` (the `save` subcommand; leave a clear spot for `add`, which phase 4 implements), `src/cli/tags.ts`, `data/shows/`, `public/shows/`, `tests/` (core tests + fixtures). Minimal edits allowed to `.oxfmtrc.json` / `.oxlintrc.json`.

## What to build

### 1. Schemas (Zod) — `src/core/schema.ts`, isomorphic

Must import nothing but `zod`, because the web bundle imports it (types and, if useful, parsing). Export schemas and inferred types.

- **Slug**: `^[a-z0-9]+(-[a-z0-9]+)*$` (with a sane max length), used for show and episode slugs before they become file names/URLs.
- **Show** (`data/shows/<slug>.json`): slug, name, host, links (website?, youtube?), `youtubeAuthorUrl?` (the oEmbed `author_url` of the channel, e.g. `https://www.youtube.com/@lexfridman`, used by ingest to recognise the show from a YouTube URL; one generic show per channel), `feedUrl?`, `image?` (path relative to the site base, e.g. `shows/<slug>.webp`), `extra`.
- **Episode** (`data/episodes/<slug>.json`): slug, title, `guests: string[]` (may be empty), `show` (show slug), `number?`, `url` (original link), `youtubeId?`, `publishedAt?` (YYYY-MM-DD), `addedAt` (ISO datetime), `updatedAt` (ISO datetime), `transcriptSource?` (`lex-official` | `patrykwajs-wiki` | `whisper-local`), `transcriptTimebase?` (`youtube` | `feed`, present iff there is a transcript), `tags: string[]`, `summary`, `notes` (markdown string), `extra`.
  - `summary`: DESIGN says "short, 3–5 key points, also shown in the list". Choose the representation (recommended: `string[]` of short points, so the list can render it compactly and the agent output format is unambiguous) and document the choice.
  - Tags: English, lowercase; validate (e.g. `^[a-z0-9]+(-[a-z0-9]+)*$`), normalise (trim + lowercase) and dedupe on save.
- **Conversations** (`data/conversations/<slug>.json`): a list of `{date, agent, markdown}` (wrapping it in an object is fine if you prefer; document it).
- **Transcript** (`data/transcripts/<slug>.json`, gitignored, local only): one format for all sources — `source`, `timebase` (`youtube` | `feed`), `audio?: {source, url}` (whisper only), `segments: {speaker?, start (seconds), text}[]`, `chapters: {title, start}[]`, plus whatever header info the markdown export (§4.4, phase 7) will need if it is not on the episode.
- Every entity has `extra` (free record) so the data can grow without losing validation.

### 2. Storage — `src/core/` (Node only)

- Data root defaults to `<repo>/data` and public dir to `<repo>/public`; both overridable by env (e.g. `E_PODCASTS_DATA_DIR`, `E_PODCASTS_PUBLIC_DIR`) so tests and dry runs use temp dirs.
- Read/list/write for shows, episodes, conversations, transcripts. Validate on read and on write. Slugs validated before building paths.
- **Atomic writes** (temp file + rename) and **stable, readable JSON** (2-space indent, trailing newline, stable key order) so git diffs stay readable. Make sure `pnpm format:check` won't fight the data files (simplest: add `data/` to oxfmt `ignorePatterns`).
- Every write to an episode file sets `updatedAt` (it doubles as the version check, §5).
- Helpers later phases need (design them now, test them):
  - `createEpisode(...)` (phase 4 ingest): generates the slug per §13 (`<show>-<title-in-kebab-case>`, truncated, unique, regex-valid), sets `addedAt` (now, or a given date for `--added-at`), validates, writes; plus `findEpisodeByUrlOrYoutubeId(...)` for duplicate detection.
  - Show creation + `saveShowImage(slug, sourceUrlOrBuffer)`: download once, convert to webp with `sharp` (e.g. square 512 px), write `public/shows/<slug>.webp`.
  - `writeTranscript(slug, transcript)` + updating the episode's `transcriptSource`/`transcriptTimebase` (phases 4 and 8).
  - Speaker correction on a local transcript: rename/swap speakers (phase 7 UI).
- Keep Node-only modules separate from `schema.ts` so `src/web` never pulls `node:fs`.

### 3. Save semantics — DESIGN §5

`saveEpisode(slug, input, {expectedUpdatedAt?})` and the CLI `pnpm episode save <slug> --input <file> [--expected-updated-at <ts>]`:

- Input (JSON file): optional `summary`, `notes`, `tags`, `guests`, `conversations` (`[{date?, agent, markdown}]`). Validated with Zod; unknown keys rejected with a clear message.
- Fields **present** overwrite; fields **absent** stay unchanged (never emptied).
- Conversations are **appended**, skipping any whose markdown hash equals one already stored (re-running the same input does not duplicate).
- If `expectedUpdatedAt` is given and differs from the file's `updatedAt` → **rejected** (conflict error, distinct type/exit code).
- Transcript guard (below) runs on every save.
- CLI prints a short human summary (fields changed, conversations added/skipped, excerpts removed) and uses distinct exit codes for validation error / conflict / guard rejection. Also support `--input -` (stdin) — handy for agents.

### 4. Transcript guard — DESIGN §5.1 (`src/core/transcript-guard.ts`)

- Compare text against the episode's local transcript, looking for runs of **≥ 20 consecutive identical words** after normalising case and punctuation.
- **Conversations**: replace each matched run (merge overlapping/adjacent windows into maximal spans, map back to original character offsets) with `[estratto della trascrizione rimosso]`; report how many spans were removed.
- **Summary and notes**: any match → save rejected with an error saying where (first words of the run) so the agent can paraphrase.
- Make it robust to the markdown export format of §4.4 (`**Lex** [01:23:45] paragraph…`): e.g. treat timestamp tokens and markdown markup as transparent, so a pasted export is caught. Must be fast on a 5-hour transcript (~60k words) × a 200 KB conversation (hash the 20-word shingles).
- **No local transcript**: per-conversation size limit (start with 200 KB, constant in one place) above which the save is rejected.

### 5. `pnpm tags`

Lists existing tags with counts (desc), read-only, plain text output (one `tag<TAB>count` per line is fine; add `--json` if cheap).

### 6. Shows entered by hand

- `data/shows/lex-fridman.json` and `data/shows/huberman-lab.json` with real website, YouTube channel, `youtubeAuthorUrl` (verify by calling YouTube oEmbed on one video of each channel: `https://www.youtube.com/oembed?url=<video>&format=json`) and RSS feed URLs (verify by fetching: Lex is on Blubrry/lexfridman.com, Huberman on Megaphone).
- Images: the cover from each feed (`<itunes:image>`), saved via your `saveShowImage` → `public/shows/<slug>.webp`. Create them through core (a small script or a CLI subcommand), not by hand.

### 7. Tests (Vitest), fixtures reduced or synthetic

Cover at least: valid input saved / invalid rejected with a clear error; present fields overwrite, absent unchanged; same input twice → no duplicate conversations; stale `updatedAt` rejected; a transcript excerpt (≥ 20 words, also inside a §4.4-style export) removed from a conversation and rejected in notes; a 19-word quote allowed; size limit without transcript; slug validation and generation (uniqueness, truncation); tag normalisation; atomic write leaves no temp files. Use temp data dirs — never write to the real `data/` in tests.

## Done when (record evidence in your report)

- Valid input saved, invalid rejected with a clear error; present fields overwritten and absent unchanged; same input twice doesn't duplicate conversations; old `updatedAt` rejected; transcript excerpt removed from a conversation and rejected in notes — all covered by passing tests **and** demonstrated once end-to-end through the CLI against a temp data dir.
- `pnpm tags` works; the two shows + images exist; `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` pass.

Do not commit. Final message: concise summary + the "API for later phases" (function names, signatures, file formats, env vars, exit codes) — phases 4, 5, 7, 8 will be briefed from it.
