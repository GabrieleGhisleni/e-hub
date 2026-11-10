# e-podcasts — Implementation progress

Live tracker for implementing [DESIGN.md](DESIGN.md) with subagents. **If a session breaks, start here.**

## How to resume

1. Read this file top to bottom, then the per-phase reports in [`docs/progress/`](progress/). The exact brief each subagent got (or will get) is in [`docs/progress/briefs/`](progress/briefs/) — reuse it verbatim when restarting a phase.
2. Find the first wave that is not `done`. For each phase in it:
   - `done` → skip.
   - `in progress` → open `docs/progress/phase-N.md`: its checklist says what is finished and what is left. Restart a subagent for that phase with the brief below, telling it to continue from the checklist (not to redo finished items).
   - `pending` → start it once every phase it depends on is `done`.
3. Phases in the same wave run in parallel and touch disjoint files (see "Owns").
4. Nothing is committed yet (no commits without the user's OK). `git status` shows everything as untracked; the phase reports are the source of truth for what exists.

## Model policy

| Model  | Used for                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------- |
| opus   | Hard, judgment-heavy work: core data/save semantics, scrapers/ingest, frontend design, Python transcriber |
| sonnet | Well-specified but sizeable work: project scaffolding, transcriber trial, local server + dev UI           |
| haiku  | Small, mechanical work: CI workflow + check scripts, skills and AGENTS.md                                 |

Final review: done by the orchestrating session (opus) itself.

## Phases

| Phase | Name                      | Model  | Wave | Depends on | Owns (files)                                                                                                                                  | Status |
| ----- | ------------------------- | ------ | ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Foundations               | sonnet | 1    | —          | root configs, `package.json`, `vite.config.ts`, skeleton dirs, `src/server/index.ts` stub                                                     | done   |
| 2     | Transcriber trial         | sonnet | 1    | —          | `transcriber/` (trial), DESIGN.md §7 numbers                                                                                                  | done   |
| 3     | Core and data             | opus   | 2    | 1          | `src/core/` (schema, store, save, transcript check), `src/cli/episode.ts` (save), `src/cli/tags.ts`, `data/shows/`, `public/shows/`, `tests/` | done   |
| 4     | Ingest                    | opus   | 3    | 3          | `src/core/ingest/`, `src/cli/episode.ts` (add), `data/cache/`                                                                                 | done   |
| 5     | Frontend (read-only)      | opus   | 3    | 3          | `src/web/` (except `src/web/dev/`), build post-step script                                                                                    | done   |
| 8     | Transcriber               | opus   | 3    | 2, 3       | `transcriber/`, `src/cli/transcribe.ts`                                                                                                       | done   |
| 6     | Deploy / CI               | haiku  | 4    | 5          | `.github/workflows/`, `scripts/check-*`                                                                                                       | done   |
| 7     | Server and local features | sonnet | 4    | 4, 5       | `src/server/`, `src/web/dev/`, `src/cli/transcript.ts`                                                                                        | done   |
| 9     | Skills and AGENTS.md      | haiku  | 5    | 4, 7, 8    | `.claude/skills/`, `AGENTS.md`                                                                                                                | done   |
| R     | Final review              | (self) | 6    | all        | fixes anywhere                                                                                                                                | done   |

Phase numbers follow DESIGN.md §15; waves reorder them for parallelism.

## Rules every subagent gets

- Read `docs/DESIGN.md` (it is in Italian; the sections relevant to your phase are listed in your brief) and this file.
- Other agents may be working in parallel in this same checkout. Touch only the files your phase owns; if you must change a shared file (e.g. `package.json`), make a minimal, surgical edit.
- Never `git commit`, `git push`, `git reset`, `git checkout`/`git stash`, or delete files you did not create.
- Dependencies were pre-installed in phase 1. Add a new one only if essential, with `pnpm add`, and record it in your report.
- Keep `docs/progress/phase-N.md` up to date **as you work** (not only at the end): a checklist of done / remaining items, how each "done when" criterion was verified (commands + results), deviations from DESIGN.md with reasons, and notes for later phases. This is what lets a broken session resume.
- Code, identifiers and comments in English; user-facing UI strings in Italian.
- Never put more than ~20 consecutive words of any third-party transcript into a tracked file (fixtures must be reduced or synthetic, DESIGN.md §3.1).
- Format **only your own files** (`pnpm exec oxfmt <paths>`), never the whole repo while other agents run. Before finishing: `pnpm typecheck`, `pnpm lint`, `pnpm test` must pass, and `pnpm format:check` must be clean for your files (or the report must say exactly what fails and why).

## Decisions and deviations log

Decisions taken during implementation that DESIGN.md does not settle, or deviations from it. One line each, newest last.

- 2026-11-09 — Progress tracked here + `docs/progress/phase-N.md`; no commits until the user asks.
- 2026-11-09 — Phase 1: TypeScript 7 (native compiler, no `baseUrl`), Vite 8, Vitest 5, zod 4, react-router pinned to ^7 (v8 is latest), dark mode via `prefers-color-scheme` media query (no `.dark` class, no next-themes). Two tsconfigs: `tsconfig.web.json` (DOM, no Node types) and `tsconfig.node.json`. Orchestrator removed a stray `cn` npm package the shadcn CLI pulled in.
- 2026-11-10 — Phase 2 measurements → transcription is **sequential** (`WhisperModel.transcribe` + VAD), not `BatchedInferencePipeline` (it dropped whole 30 s windows). DESIGN §7.3 annotated _(rivista)_. `small.en` remains the default; bigger models are opt-in via `--model`.

- 2026-11-10 — Phase 3: `summary` is `string[]` (0–10 points); conversations file is a plain array `[{date, agent, markdown}]`; dedupe by sha256 of normalised markdown; entities reject unknown keys (free data in `extra`); `data/` excluded from oxfmt; CLI exit codes 0 ok / 1 unexpected / 2 usage / 3 validation / 4 not found / 5 conflict / 6 guard / 7 duplicate / 8 already exists. Full API in `docs/progress/phase-3.md`.
- 2026-11-10 — Fact update for DESIGN §7.2/§14: the Lex RSS feed now has ~503 items back to 2018 (DESIGN says ~38). To annotate in DESIGN during the final review.
- 2026-11-10 — Parallel agents format only their own files (`pnpm exec oxfmt <paths>`), never the whole repo, to avoid touching files another agent is editing.

- 2026-11-10 — Phase 5: no zod validation in the browser (the build step validates episode files instead); search results ordered by relevance when there is a query, otherwise newest `addedAt` first; multiple shows = OR, multiple tags = AND; markdown renderer lazy-loaded on the detail page; per-episode HTML gets its own title/description/OG tags. Dev seam: `<DevSlot name=…>` + `src/web/dev/slots.tsx` exporting `DEV_ONLY_MARKER` and `slots` (table in `docs/progress/phase-5.md`).
- 2026-11-10 — To fix in final review: Vite warns that a future config loader needs explicit `.ts` extensions in `./scripts/static-pages` and `../src/core/schema` imports (needs `allowImportingTsExtensions` in `tsconfig.node.json`).

- 2026-11-10 — Phase 4: the Huberman wiki often has `## [HH:MM:SS]` chapter headings and `**Name:**` speaker labels (DESIGN §4.3 says neither) → parsed as chapters/speakers; untimed paragraphs get interpolated starts (`extra.estimatedStarts`); 12/453 wiki files have no timestamps → episode saved without transcript. Wiki numbering differs from official → match by `youtube_id`, then title (not number). Stored `url` = show-site page when known, else YouTube. No feed decision without a TTY → exit 2 naming the flags. hubermanlab.com is never fetched (metadata via Megaphone feed).
- 2026-11-10 — Known gap (phase 4): no way to re-fetch a transcript for an existing episode (e.g. Lex publishes it days later); re-adding reports a duplicate. Candidate follow-up, discuss in final review.

- 2026-11-10 — Phase 7: local API returns 422 for validation (core's `httpStatusFor` says 400); one "Modifica" dialog edits summary/notes/tags/guests; drafts in `sessionStorage`, reopened after Vite reloads, touched fields kept on top of the new version; the UI never preselects an iTunes feed (the "exact" match was wrong in testing); Vite's own host check runs before Hono, the Hono middleware checks Host/Origin/Content-Type anyway. Endpoints listed in `docs/progress/phase-7.md`.

## Final review (orchestrator)

Checked so far (2026-11-10, while phases 8 and 9 finish):

- [x] `src/server/security.ts` + `app.ts`: loopback Host check, JSON-only writes, exact Origin match, slug validation (middleware + core), 8 MB body cap, `addedAt` never accepted from the UI.
- [x] `src/core/save.ts`: §5 semantics (absent fields unchanged, dedupe, conflict, nothing written on error).
- [x] `src/core/transcript-guard.ts`: export format transparent (labels, timestamps, headings), hashed shingles.
- [x] Production build served under `/e-podcasts/` in the browser pane: home (phone + desktop width) and a direct episode link render with the 3 real episodes.
- [x] CI action versions are the latest releases.
- [x] Phase 9 output read: both skills and AGENTS.md match the real CLI (feed never auto-picked, Whisper only on a yes, save only after OK with `--expected-updated-at`).
- [x] Fixed an ingest bug found by phase 9: in "Channel - Title Cased Topic" titles the topic became a guest (exclusion ran before the name-vs-topic decision). `guestsFromTitle` now decides on the raw ends; regression test added.
- [x] Added `.claude/launch.json` (`dev` on 5199, `preview` on 4199) for the browser pane.

To do:

- [x] Fixed the Vite native-config-loader warning: `.ts` extensions in `vite.config.ts` and `scripts/static-pages.ts` imports + `allowImportingTsExtensions` in `tsconfig.node.json`.
- [x] DESIGN.md annotated: Lex feed now ~503 items (§7.2, §14); Huberman wiki chapters/speakers/interpolated starts (§4.3); wiki numbering ≠ official, match by `youtube_id` then title (§6.1). Phase 8 added its 2 h measurements to §7.7.
- [x] Phase 8 checked: no processes left, `data/audio/` empty, Python tests 38/38; `/add-episode` skill updated with its operational notes (lock file, how to stop, ~20 min, check speakers after). Closing run: typecheck, lint, format:check, test (286), build, check:bundle, check:tracked all pass. Commit candidate: 222 files, no venv/caches/audio/transcripts; fixtures verified synthetic.
- [ ] Discuss with the user: re-fetching a transcript for an existing episode (gap from phase 4).

## Waiting on the user

Items only the user can do or decide; collected here as they come up.

- Phase 6: creating the public GitHub repo, pushing and enabling Pages (outward-facing; not done without explicit OK). Steps: (1) public repo named `e-podcasts` (name must match the `/e-podcasts/` base); (2) check `git status` shows nothing under `data/transcripts|audio|cache`, first commit on `main`, add remote, push; (3) GitHub → Settings → Pages → Source: GitHub Actions; (4) the push runs the Deploy workflow → `https://<user>.github.io/e-podcasts/`.
- Test episodes added by phase 4 to the real `data/` (keep or delete): `lex-fridman-503-ai-crisis-in-math-navier-stokes-riemann-hypothesis-complexity`, `huberman-lab-access-the-sublime-live-your-best-life-robert-greene`, `dwarkesh-patel-sarah-paine-why-wars-are-so-difficult-to-end` (+ new show `dwarkesh-patel`; its iTunes feed candidate is a one-item proxy feed, left unconfirmed).
- Phase 9 "done when": a full add → discuss → save → paste-conversation cycle on a real episode needs the user in the loop.

## Session log

- 2026-11-09 — Tracker created. Wave 1 started: phase 1 (sonnet) and phase 2 (sonnet) running in parallel as background subagents.
- 2026-11-09 — Phase 1 done and re-verified by orchestrator (typecheck, lint, format, test, build). Phase 3 (opus) started while phase 2 still runs.
- 2026-11-10 — Usage limit hit: phase 2 and phase 3 agents stopped mid-work (phase 3: schema/store/guard/slug files written, no tests yet; phase 2: uv project + reference parser + 20-min audio downloaded to `data/audio/trial.webm`). Resumed both agents with SendMessage after the reset.
- 2026-11-10 — Phase 2 done: ~16 min estimated for a 2 h episode (budget 30). Batched faster-whisper drops text (WER 17.8% vs 11.3% sequential) → DESIGN §7.3 revised by orchestrator to sequential transcription; `small.en` stays default. Python 3.12 + `av<17` pinned. Phase 8 brief written (starts after phase 3).
- 2026-11-10 — Phase 3 done (92 tests), re-verified by orchestrator. Wave 3 started: phases 4 (ingest), 5 (frontend), 8 (transcriber), all opus, in parallel.
- 2026-11-10 — Usage limit hit again during wave 3. State at the stop: phase 4 had research done + `src/core/ingest/{text,cache,http,recognize,git}.ts`; phase 5 had data layer, routing, components, pages in progress; phase 8 had the Python package `transcriber/src/epod_transcriber/` + tests, CLI entry next. No processes left running, no demo data, `data/audio/` empty. All three resumed with SendMessage after the reset.
- 2026-11-10 — Phase 5 done (187 tests total), re-verified by orchestrator (build, no dev markers in dist, demo data removed). Phase 6 (haiku) started; phase 7 waits for phase 4.
- 2026-11-10 — Phase 6 done: `.github/workflows/deploy.yml` + `check:tracked` / `check:bundle`; both checks shown failing on realistic cases; action versions confirmed latest by orchestrator via `gh api`.
- 2026-11-10 — Phase 4 done (226 tests), real data has 3 episodes. Usage limit stopped phase 8 a third time (short e2e + feed fallback already done); resumed it for the 2 h run. Phase 7 (sonnet) started in parallel.
- 2026-11-10 — Phase 7 done (286 tests), re-verified (real data untouched, build + check:bundle clean). Phase 9 (haiku) started while phase 8 runs its 2 h transcription.
- 2026-11-10 — Phase 9 done (skills + AGENTS.md + CLAUDE.md), reviewed by orchestrator. Only phase 8 (2 h run) remains before the closing checks.
- 2026-11-10 — Phase 8 done: real 2 h episode in 19 min 48 s (budget 30), WER 7.1%, speaker accuracy 99.4%, resume verified. Final review done. **All phases complete**; remaining items are the user's (see "Waiting on the user").
