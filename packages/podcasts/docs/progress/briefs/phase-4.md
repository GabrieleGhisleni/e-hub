# Brief — phase 4 (Ingest) — model: opus

You are implementing **phase 4 (Ingest)** of the e-podcasts project in /home/ggabry/projects/e-podcasts.

First read `docs/PROGRESS.md` ("Rules every subagent gets" — follow them strictly), `docs/progress/phase-3.md` (**the "API for later phases" section is your contract with core — use those functions; don't write JSON files by hand**), `docs/progress/phase-1.md` (project setup), and `docs/DESIGN.md` §4.1, §4.2, §4.3, §6 (all, incl. §6.1 verified facts and §6.2), §13, §14 and §15 phase 4. The doc is in Italian.

Parallel agents: phase 5 (frontend, `src/web/`) and phase 8 (Python transcriber, `transcriber/`, `src/cli/transcribe.ts`) run at the same time. Don't touch their files. The frontend agent may temporarily create `data/episodes/demo-*.json` files — ignore them.

Keep `docs/progress/phase-4.md` updated as you go (checklist, verification evidence, deviations, notes for phases 7 and 9). If it exists, continue from its checklist.

## You own

`src/core/ingest/` (new), the `add` subcommand in `src/cli/episode.ts` (phase 3 left a spot; don't change `save`'s behaviour), `tests/ingest/` + `tests/fixtures/ingest/`, and the contents of `data/cache/` (gitignored). If you need a small addition to core outside `ingest/` (e.g. a missing helper), make it minimal and record it in your report.

## Design the ingest API in two steps

The CLI (now) and the local UI form (phase 7, via the Hono server) must share the same logic, and a **new show's feed must be confirmed by the user** (§4.1). So expose something like:

1. `previewAdd(url)` → what would happen: duplicate (existing episode slug) | recognised show (existing) | new show proposal (name, host, YouTube channel, image source, **iTunes feed candidates** to confirm).
2. `addEpisode(url, { addedAt?, feedUrl? | noFeed?, ... })` → creates the show if new (with the confirmed feed or none, image saved through core), creates the episode, fetches and writes the transcript when available, and returns a result (slug, show, transcript status, warnings).

Document both in your report's "API for phase 7" section.

## Sources and behaviour (DESIGN §6)

- **URL recognition**: `lexfridman.com/<slug>` (episode page; also accept the `-transcript` page), `hubermanlab.com/...`, YouTube (`youtube.com/watch?v=`, `youtu.be/`, `youtube.com/live/`, `/shorts/`, with or without extra params). For YouTube, call oEmbed (`https://www.youtube.com/oembed?url=…&format=json`) and match `author_url` against the shows' `youtubeAuthorUrl` → Lex or Huberman if it matches, otherwise a **generic show, one per channel** (created if missing).
- **Lex Fridman**: metadata from the episode page (title, guests — possibly several —, episode number, `publishedAt`, `youtubeId`). Official transcript from `lexfridman.com/<slug>-transcript` (WordPress HTML: segments with speaker, timestamp linked to YouTube at the second, text; chapters as `h2`) → unified transcript format, `source: lex-official`, `timebase: youtube`. From a YouTube URL, find the transcript page through a **`youtubeId` → transcript page map** built by reading the "transcripts" category index pages (paginated), cached in `data/cache/` and refreshed when an id is missing. Missing transcript page → episode saved without transcript. No YouTube-captions fallback.
- **Huberman Lab**: transcript from the **PatrykWajs/Huberman-Lab-Wiki** repo: `git clone --depth 1 https://github.com/PatrykWajs/Huberman-Lab-Wiki data/cache/huberman-wiki`, `git pull` on every Huberman ingest, plus a local index (`youtube_id` / episode number / title → file), rebuilt when the clone's HEAD changes. Match by `youtube_id`, then number, then normalised title. Parse `transcript.md` (frontmatter: date, number, youtube_id; lines with `[HH:MM:SS]`, no speakers, no chapters) → `source: patrykwajs-wiki`, `timebase: youtube`. **Never** touch hubermanlab.com Premium/transcript pages (paywall, §6.1) — the Huberman site may be used only for public episode metadata, or skip it and rely on YouTube oEmbed + the wiki frontmatter. Guests: the part of the title before the colon, if it looks like a person's name.
- **Generic YouTube**: metadata via oEmbed; `publishedAt` from the video page if possible (e.g. JSON-LD `uploadDate` / `itemprop="datePublished"`), otherwise empty; no transcript (→ the "no transcript" badge; Whisper later via `pnpm transcribe`).
- Episode number from the title or the source when present; guests from the source when possible, otherwise empty.
- **New show**: name/host from oEmbed `author_name`; image = channel avatar (e.g. `og:image` of the channel page) or the feed cover; feed proposed via the **iTunes Search API** (free, no key) — never accepted automatically. If not found or not confirmed, the show has YouTube only.
- **Duplicates**: same `url` or same `youtubeId` as an existing episode → no new episode; report the existing slug.

## CLI

`pnpm episode add <url> [--added-at <date>] [--feed <url> | --no-feed] [--yes]`

- Interactive by default: when a new show has feed candidates, ask which to use (or none) on the terminal.
- Non-interactive for agents/skills: `--feed`/`--no-feed`, and `--yes` to accept the default answers; if stdin is not a TTY and a confirmation is needed, fail with a clear message telling which flag to pass.
- `--added-at` only for the initial import of already-listened episodes.
- Output: slug, show, transcript status (source/timebase or "nessuna trascrizione" + the `pnpm transcribe <slug>` hint), warnings. Distinct exit codes (duplicate is not an error but says so).

## Engineering

- All network access behind an injectable `fetch`-like function (and `git` runner) so parsers and flows are unit-testable offline. Reasonable timeouts, a generic User-Agent (never the user's name/email), no aggressive retries.
- Tests with **reduced or synthetic fixtures only** (the repo is public; a full transcript page is copyrighted text): trimmed Lex HTML with fake sentences, synthetic wiki `transcript.md`, oEmbed/iTunes JSON, RSS snippet.

## Done when (record evidence in your report)

Run against the real sites:

- A recent **Lex** episode URL (with official transcript) → episode + transcript (unified format, `lex-official`, `youtube`).
- **The same Lex episode given as a YouTube URL** → recognised as Lex via `author_url` and resolved to the same transcript page through the map. Demonstrate this in a temp data dir (`E_PODCASTS_DATA_DIR` or whatever phase 3 provides) so you can show it produces the episode + transcript on its own; then in the real data dir show that it is detected as a duplicate.
- A **Huberman** episode (YouTube or hubermanlab.com URL) → episode + transcript from the wiki clone.
- A **generic YouTube** video (pick an English-language interview-podcast episode) → new generic show (image, feed proposal handled with `--no-feed` or a confirmed candidate) + episode with no transcript.
- Keep exactly these test episodes (Lex, Huberman, generic) in the **real** `data/` so the frontend has real data; list their slugs in your report (the user will decide later whether to keep them). Transcripts stay in gitignored `data/transcripts/`.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` pass.

Do not commit. Final message: concise summary, the slugs created, the "API for phase 7" section, known limitations.
