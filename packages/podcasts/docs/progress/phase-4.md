# Phase 4 — Ingest

Status: done (nothing committed)

## Checklist

- [x] research real sources (Lex episode/transcript/index HTML, oEmbed, YouTube page, wiki repo layout, iTunes Search) — findings below
- [x] `ingest/http.ts` (injectable `FetchLike`, `HttpError`, UA, timeouts, no retries), `git.ts` (injectable `GitRunner`), `cache.ts` (`data/cache/` helpers), `text.ts` (entities, title normalisation, episode number, name/guest heuristics), `recognize.ts` (URL recognition)
- [x] `ingest/youtube.ts` (oEmbed, watch page, channel avatar), `itunes.ts`, `feed.ts` (RSS cover + items; seed script reuses it), `known-shows.ts` (Lex/Huberman definitions moved out of `scripts/seed-shows.ts`, which now imports them + `fetchFeedCover`; verified on a temp dir: output identical to the tracked shows)
- [x] Lex (`lex.ts`): episode page parser, transcript page parser, index page parser, youtubeId → transcript map (`data/cache/lex-transcripts.json`)
- [x] Huberman (`huberman.ts`): wiki clone/pull (injectable git), index (`data/cache/huberman-wiki-index.json`), transcript.md parser (all variants), feed match (`feed.ts` `findFeedItem`)
- [x] generic YouTube: oEmbed + publishedAt from video page, channel avatar, iTunes candidates
- [x] `previewAdd` / `addEpisode` flows (`add.ts`, exports in `index.ts`)
- [x] CLI `pnpm episode add` (logic in new `src/cli/episode-add.ts`, `runAdd(args, io)`; `episode.ts` stub replaced by a delegate + usage text)
- [x] tests (`tests/ingest/`, synthetic fixtures in `tests/fixtures/ingest/`): `fakes.ts` (fake fetch/git), `text-recognize.test.ts` (29), `parsers.test.ts` (16), `add.test.ts` (16 offline flows), `cli-add.test.ts` (7, in-process `runAdd` + one spawn)
- [x] real runs: Lex URL, same Lex as YouTube (temp dir + duplicate in real dir), Huberman, generic YouTube
- [x] typecheck / lint / format (own files) / test

## Files

- New: `src/core/ingest/{index,add,http,git,cache,text,recognize,youtube,itunes,feed,known-shows,lex,huberman}.ts`, `src/cli/episode-add.ts`, `tests/ingest/{fakes.ts,text-recognize.test.ts,parsers.test.ts,add.test.ts,cli-add.test.ts}`, `tests/fixtures/ingest/` (synthetic HTML, RSS, iTunes JSON, 3 wiki `transcript.md`).
- Changed (minimal): `src/cli/episode.ts` (`add` stub → delegate to `episode-add.ts`, usage text, header comment; `save` untouched), `scripts/seed-shows.ts` (imports `KNOWN_SHOWS` + `fetchFeedCover` from ingest instead of defining them).
- No change to core outside `ingest/`; no new dependency (cheerio, fast-xml-parser, yaml, sharp, zod were already installed).
- Real data written: `data/episodes/` (3 episodes), `data/shows/dwarkesh-patel.json`, `public/shows/dwarkesh-patel.webp`, gitignored `data/transcripts/` (2) and `data/cache/{huberman-wiki/, huberman-wiki-index.json}`.

## Verification

- `pnpm typecheck` OK, `pnpm lint` OK (0 warnings/errors), `pnpm test` OK: 21 files, 226 tests (68 of them in `tests/ingest/`, offline, ~2 s). `pnpm exec oxfmt --check` clean on every file this phase owns; repo-wide `pnpm format:check` only reports `docs/PROGRESS.md` (orchestrator) and `transcriber/pyproject.toml` (phase 8).
- Real sites, 2026-11-10 (CLI, stdin not a TTY):
  1. **Lex URL** `pnpm episode add https://lexfridman.com/math-ai-crisis/` (real `data/`) → `lex-fridman-503-ai-crisis-in-math-navier-stokes-riemann-hypothesis-complexity`, title `#503 – AI Crisis in Math: …`, guests Ankur Moitra, Steven Brunton, Alex Kontorovich, number 503, published 2026-10-26, youtube `ZAzWPE9CItg`, transcript `lex-official` / `youtube`, 571 segments, 15 chapters.
  2. **Same episode as YouTube URL** `https://www.youtube.com/watch?v=ZAzWPE9CItg&list=…` on a fresh temp dir (`E_PODCASTS_DATA_DIR`/`E_PODCASTS_PUBLIC_DIR` in the scratchpad) → recognised as Lex via `author_url`, map built from index page 1 → same slug, same metadata, transcript 571 segments / 15 chapters (also checked earlier with #502 `youtu.be/s7d2d8FhevU?si=…&t=120`: episode JSON identical except dates, segments and chapters identical). In the real `data/`: `pnpm episode add https://www.youtube.com/watch?v=ZAzWPE9CItg` → `Already added: lex-fridman-503-… (same YouTube video); nothing changed.`, exit 7.
  3. **Huberman** `pnpm episode add https://www.hubermanlab.com/episode/access-the-sublime-and-live-your-best-life-robert-greene` (real `data/`) → resolved through the Megaphone feed (no hubermanlab.com request) + wiki title match → `huberman-lab-access-the-sublime-live-your-best-life-robert-greene`, guest Robert Greene, official number 305, published 2026-11-02, youtube `y-fRFiTrrg4` (from the wiki; checked with oEmbed: same title, `@hubermanlab`), transcript `patrykwajs-wiki` / `youtube`, 3581 segments (line format, exact timestamps). The YouTube URL of it → duplicate, exit 7. Earlier on a temp dir: YouTube URL `9G2MRFs4vac` → official #270 (wiki says EP-374), 725 segments / 26 chapters with interpolated starts; its hubermanlab.com URL → duplicate.
  4. **Generic YouTube** `https://www.youtube.com/watch?v=f6cjAEr08qk` without flags → exit 2, lists the iTunes candidate (Dwarkesh Podcast, `https://apple.dwarkesh-podcast.workers.dev/feed.rss`, exact match) and the flags; with `--no-feed` (real `data/`) → new show `dwarkesh-patel` (name/host "Dwarkesh Patel", `youtubeAuthorUrl` `https://www.youtube.com/@DwarkeshPatel`, 512×512 avatar checked visually) + `dwarkesh-patel-sarah-paine-why-wars-are-so-difficult-to-end` (guest Sarah Paine, published 2026-09-25), `transcript: nessuna trascrizione` + `pnpm transcribe <slug>` hint. This is also the "URL without transcript → episode with the badge" case.
- `tests/data.test.ts` validates the real data (3 shows, 3 episodes, images exist). `git status --ignored`: `data/transcripts/` and `data/cache/` ignored.
- `scripts/seed-shows.ts` re-run against a temp dir → `lex-fridman.json` / `huberman-lab.json` identical to the tracked ones.
- No full third-party transcript text in tracked files: fixtures are synthetic (made-up sentences, fake ids), structure only.

## Source facts found (2026-11-10)

- **Lex transcript index** `lexfridman.com/category/transcripts/page/N/`: 10 posts per page, 13 pages (page 14 → 404), each page ~2.5–3 MB because it inlines the full transcripts. Each post: `h1.entry-title a` → transcript URL; "Go back to this episode's main page" link → episode page; timestamp links `youtube.com/watch?v=<id>&t=<s>` → YouTube id. Some posts are not transcripts (`khabib-nurmagomedov-files`, no timestamps) → skipped.
- **Lex transcript page**: `.ts-segment` > `.ts-name`, `.ts-timestamp a[href*="t="]`, `.ts-text`; chapters `h2[id^=chapter]` (start = first segment after it). Timestamps are on the YouTube video (TOC times differ from the episode page OUTLINE, which is on the podcast audio).
- **Lex episode page**: `h1.entry-title` = `#502 – Psychiatry, …` (recent titles no longer start with the guest name), `time.entry-date[datetime]` (site-local date), `iframe` `youtube.com/embed/<id>`, link `<slug>-transcript` (old episode pages get the link when a transcript is added later). The transcript intro sentence "…#503 with Math AI Crisis" is generated from the slug → not usable for guests.
- **oEmbed** works without key; Lex `author_url` = `https://www.youtube.com/@lexfridman`, Huberman `…/@hubermanlab`. YouTube watch page has `itemprop="datePublished" content="2026-09-16T17:34:47-07:00"`; channel page has `og:image` (900×900 avatar).
- **Huberman wiki** (PatrykWajs/Huberman-Lab-Wiki, HEAD ccec9f8, 78 MB shallow clone): `docs/Episodes/EP-NNN - <title>/transcript.md`, 453 files. Frontmatter (all valid YAML): `title`, `episode_number`, `episode_date`, `youtube_id`, `speakers` (+ rare variants `video_id`, `youtube_url`, `publish_date`, `date`, `episode_title`). **The body format is heterogeneous** (DESIGN says "lines with `[HH:MM:SS]`, no speakers, no chapters"): ~376 files have `## [HH:MM:SS] <chapter title>` headings with untimed paragraphs, ~57 have `[HH:MM:SS] text` lines, a few have `**Speaker:**` labels and `*[HH:MM:SS]*` / `## 00:00:00 Title` / `## Title (00:00:00)` variants, a dozen have no timestamps at all. Parser over all 453: 92 exact timing, 349 interpolated, 12 without timestamps.
- **Wiki `episode_number` ≠ official episode number**: e.g. Alok Kanojia is wiki EP-374 but `itunes:episode` 270 in the Megaphone feed (the wiki counts Essentials etc.). So matching the wiki "by number" with an official number would pick the wrong episode.
- **Huberman feed** (Megaphone, 4.5 MB, 457 items, 302 with `itunes:episode`): item `<link>` = `https://www.hubermanlab.com/episode/<slug>` → hubermanlab.com URLs can be resolved through the feed without fetching hubermanlab.com at all.
- **iTunes Search** `itunes.apple.com/search?media=podcast&entity=podcast&term=…` works without key (e.g. "Dwarkesh Patel" → Dwarkesh Podcast, feedUrl on a workers.dev proxy with 1 item and no channel cover → good example of why the feed must be confirmed).
- fast-xml-parser needs `htmlEntities: true` to decode `&#038;` etc. in feed titles.

## Decisions and deviations

- **Wiki format** (deviation from DESIGN §4.3/§6.1 "no speakers, no chapters"): the parser maps `##` headings to **chapters**, keeps `**Name:**` labels as speakers when they look like one person's name, and gives untimed paragraphs a start **interpolated by word count** between the surrounding timestamps (the first untimed paragraph starts at 0; after the last timestamp the measured rate is used). Such transcripts carry `extra.estimatedStarts: true` (+ `extra.wikiCommit`, `extra.wikiPath`); `sourceUrl` is the GitHub blob URL at the clone's commit. Files without any timestamp → episode without transcript + warning.
- **Wiki matching by number dropped** (deviation from the brief's "youtube_id, then number, then title"): the wiki numbers episodes its own way; matching is by `youtube_id`, then normalised title (exact, then unique prefix ≥ 20 chars, never contradicting a known id).
- **hubermanlab.com is never fetched**: its URLs are resolved through the show's Megaphone feed (`<link>`), which also gives the **official** `number` (`itunes:episode`) and `publishedAt` for every Huberman episode (feed > wiki date > YouTube date).
- **Stored `url`** = canonical episode page on the show's site when known (Lex page without trailing slash; the hubermanlab.com link from the feed), else `https://www.youtube.com/watch?v=<id>` — so the same episode gets the same record from either URL. Duplicates are matched by YouTube id as well.
- **Known shows** (Lex, Huberman) are built-in definitions in `src/core/ingest/known-shows.ts` (moved from the seed script): recognised by `author_url` even when the show file is missing (temp dirs), then created from the definition with the feed cover. Their feeds are hand-entered, so no confirmation.
- **Feed decision API**: `feed: string | null | undefined`; `undefined` with candidates → `FeedDecisionRequiredError` (a `ValidationError`). Never auto-accepted; CLI `--yes` = no feed. A confirmed feed must be readable RSS (else `ValidationError`); its channel cover (or the iTunes artwork) becomes the image, else the channel avatar.
- **Lex guests**: transcript speakers minus "Lex Fridman" (exact set), ordered like the description; without transcript: description subjects ("A, B and C are…", later "X Y is…" sentences), else title ("Name: …", "… – Name"). **Huberman guests**: wiki `speakers` minus Huberman (honorifics/nicknames stripped), else title ("… | Dr. Name"). **Generic**: title by position ("topic | Guest", "Guest: topic", "Guest — topic"), channel name excluded. Honorifics ("Dr.") are dropped from guest names.
- **Lex `publishedAt`** = the site-local date (`time.entry-date`, e.g. 2026-09-16), which can be one day before the RSS `pubDate` in UTC (2026-09-17).
- **Lex map refresh**: crawl from page 1, stop when the id is found, at the last page (map marked complete), or — once complete — at the first page with nothing new. Cache written after every page. A Lex YouTube video not in the map → oEmbed metadata only ("Title | Lex Fridman Podcast #N" → "#N – Title"), no transcript.
- **Transcript failure policy**: network error on a known transcript → `HttpError`, nothing written (retry later); 404 / not in map / not in wiki / no timestamps → episode without transcript + warning; 0 segments parsed → episode without transcript + warning ("parser may need an update").
- **Duplicate** is a result, not an exception (`{status: "duplicate"}`); `createEpisode`'s `DuplicateEpisodeError` (race) is converted too. CLI: exit 7 with "Already added: <slug> …".
- **Confirmation needed without TTY** → exit 2 (usage) with the candidates and the flags to pass (no new exit code added to core).
- **CLI language**: messages in English like `episode save`, except the badge phrase "nessuna trascrizione" (as the brief asks). `--json` added for agents/skills.
- `git pull --ff-only` runs at most once per 10 minutes per process (a preview followed by an add pulls once); a failed pull keeps the local clone with a warning.

## API for phase 7

Import from `src/core/ingest` (Node only; never from web code):

```ts
import { previewAdd, addEpisode, FeedDecisionRequiredError, HttpError } from "../core/ingest";
```

- `previewAdd(url: string, deps?: IngestDeps): Promise<AddPreview>` — reads the network and syncs caches (Lex map, wiki clone), **writes no data**. Returns:
  - `{status: "duplicate", url, existing: {slug, title, show}, matchedBy: "youtubeId"|"url", warnings}`
  - `{status: "ready", source: "lex"|"huberman"|"youtube", url /* stored URL */, youtubeId?, episode: {title, guests, number?, publishedAt?}, show: ShowPreview, transcript: TranscriptPreview, warnings: string[]}`
  - `ShowPreview` = `{status: "existing", slug, name}` | `{status: "new", slug, name, host, known: boolean /* built-in Lex/Huberman */, youtubeAuthorUrl?, feedUrl? /* built-in only */, avatarUrl?, feedCandidates: FeedCandidate[], needsFeedDecision: boolean}`
  - `FeedCandidate` = `{feedUrl, title, author, artworkUrl?, episodeCount?, itunesUrl?, match: "exact"|"partial"|"weak"}` (best first, ≤ 5)
  - `TranscriptPreview` = `{status: "available", source: "lex-official"|"patrykwajs-wiki", url}` | `{status: "none", reason}`
- `addEpisode(url: string, options?: {addedAt?: string|Date; feed?: string|null}, deps?: IngestDeps): Promise<AddResult>` — re-resolves, fetches the transcript, creates the show if new, then the episode (+ transcript) via `createEpisode`. `feed`: confirmed URL or `null` (none); required when the preview had `needsFeedDecision` (else `FeedDecisionRequiredError` with `.candidates`); ignored with a warning for existing shows. `addedAt` only for the initial import (the UI should not send it, DESIGN §4.2). Returns:
  - `{status: "duplicate", existing: {slug, title, show}, matchedBy, warnings}`
  - `{status: "created", episode: Episode, show: {slug, name, created, feedUrl?, image?}, transcript: {status: "saved", source, timebase: "youtube", segments, chapters, estimatedStarts} | {status: "none", reason}, warnings}`
- Errors: `ValidationError` (unsupported URL, bad `addedAt`, bad/unreadable feed, `FeedDecisionRequiredError`) → 400; `NotFoundError` (Lex page 404, video private/missing, Huberman URL not in the feed) → 404 — both map with `httpStatusFor`. `HttpError` (network; `.status`, `.url`) is not a `CoreError`: map it to 502 with "riprova più tardi"; nothing was written.
- `IngestDeps = {fetch?: FetchLike; git?: GitRunner; now?: () => Date; progress?: (message) => void}` — defaults: global fetch, system git, `new Date()`. `progress` reports slow steps (index crawl, clone).
- Suggested form flow: POST url → `previewAdd` → show title/guests/show/transcript availability; if `show.status === "new" && show.needsFeedDecision`, render the candidates as radio buttons + "nessun feed" (+ optional free URL); on confirm → `addEpisode(url, {feed})` → redirect to the new slug (or to the existing one on `duplicate`).
- Timing: preview of a YouTube URL is ~1–3 s; the **first** Huberman ingest clones ~80 MB (~5–10 s); a Lex YouTube id missing from a cold map can crawl up to 13 index pages (~3 MB each) once. Run them off the request path or show a spinner.
- Also exported: `recognizeUrl(url)` (pure; `{kind: "lex"|"huberman"|"youtube", url, slug|youtubeId}` or `ValidationError`) — usable for instant client-side-ish validation on the server.

## Notes for later phases

- Phase 7: see the API above. The CLI command is in `src/cli/episode-add.ts` (`runAdd(args, io)`), a reference for the flow.
- Phase 8 (Whisper): `publishedAt` for Lex is the site-local date (may be 1 day before the feed's UTC `pubDate`): match feed items with ±1 day tolerance. Huberman `publishedAt` comes from the feed itself. Generic shows confirmed with a feed have `feedUrl`; `dwarkesh-patel` has none (the iTunes candidate was a 1-item proxy feed).
- Phase 9 (`/add-episode` skill): use `pnpm episode add <url> --json` plus `--no-feed`/`--feed <url>` or `--yes` (never interactive); exit 7 = already present (read `slug` from the JSON), exit 2 = a feed decision is needed (ask the user, re-run with the flag). When `transcript.status` is `none`, offer `pnpm transcribe <slug>`.
- Re-fetching a transcript for an existing episode (e.g. Lex publishes it days later) is not implemented: re-adding reports a duplicate. The building blocks are there (`findLexTranscriptByYoutubeId`, `parseLexTranscriptPage`, `readWikiTranscript`) + core `writeTranscript`; a "cerca trascrizione" action could reuse them.

## Known limitations

- Guest extraction is heuristic (editable in the local UI): titles in Title Case with no separator, or descriptions that name other people as sentence subjects, can produce wrong or missing guests.
- Huberman wiki starts are interpolated for ~3/4 of the files (accurate at chapter boundaries, approximate within a chapter); ~12 wiki files have no timestamps → no transcript.
- Lex episodes given as a YouTube URL without an official transcript don't get the Lex page metadata (no guests from the description; URL stays the YouTube one).
- A hubermanlab.com URL that is not in the feed (very old or removed) fails with "not found": use the YouTube URL.
- The YouTube watch/channel pages may be served behind a consent wall in some regions: `publishedAt`/avatar are then missing (warnings), never fatal. No cookie/consent bypass.
- `data/cache/huberman-wiki` is ~80 MB (gitignored).

## Log

- 2026-11-10 — started; read brief, PROGRESS rules, phase-3 API, DESIGN §4, §6, §13–15. Researched sources (above).
- 2026-11-10 — interrupted by usage limit after writing http/git/cache/text/recognize; resumed, checklist refined, design decisions recorded.
- 2026-11-10 — all modules + CLI written; typecheck/lint clean. Parsers sanity-checked on downloaded real pages (scratchpad only, not tracked). First real runs on temp data dirs all OK (Lex site URL, same via `youtu.be`, duplicate, Huberman YouTube + hubermanlab.com duplicate, generic exit 2 then `--no-feed`).
- 2026-11-10 — tests written (68, offline); guests from a transcript ordered like the page description. Real `data/` runs (Lex #503, Huberman Robert Greene, Dwarkesh/Sarah Paine) + duplicates; temp-dir demo of Lex #503 from YouTube. All checks green. Done.
