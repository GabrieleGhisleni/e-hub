# Phase 9 — Claude Code skills and AGENTS.md

Status: in progress (nothing committed)

## Checklist

- [x] read brief, PROGRESS rules, phase 3/4/7/8 reports, DESIGN §1, §4, §5, §5.1, §10, §15
- [x] verified CLI flags/exit codes against a temp data dir (`E_PODCASTS_DATA_DIR`, `E_PODCASTS_PUBLIC_DIR`); real `data/` untouched
- [x] `.claude/skills/add-episode/SKILL.md`
- [x] `.claude/skills/podcast-notes/SKILL.md`
- [x] `AGENTS.md`
- [x] `CLAUDE.md` (`@AGENTS.md`)
- [x] dry run of the `/podcast-notes` save path (valid stdin input, stale value rejected)
- [x] every command/flag in the three files run once (table in the report)
- [x] `pnpm format:check` clean for own files

## Verification log

Temp dir: `<scratchpad>/p9` (copy of `data/{shows,episodes,conversations,transcripts}` and `public/shows`).

- `pnpm tags`, `pnpm tags --json` → exit 0, `[]` (no tags yet)
- `pnpm transcript export <lex-slug>` → exit 0, header with `Timebase: youtube`
- `pnpm transcript export <dwarkesh-slug>` → exit 4 (no local transcript, hint `pnpm transcribe`)
- `pnpm transcript export <huberman-slug> --out <file>` → exit 0, "Wrote …"; `transcript export` (no slug) → exit 2
- `pnpm episode save <slug> --input <file> --expected-updated-at <current>` → exit 0, `fields changed: summary, notes, tags`
- same command with the old `updatedAt` → exit 5 conflict
- same input with the new `updatedAt`, `--json` → `written:false`, exit 0
- notes with a 32-word transcript run → exit 6 (guard)
- conversation with a transcript run → exit 0, `transcript excerpts removed: 1`
- `--input -` (stdin), no `--expected-updated-at` → exit 0
- unknown key `title` → exit 3; no `--input` → exit 2; unknown slug → exit 4
- `pnpm episode add <youtube url of existing episode>` → exit 7 (duplicate)
- `pnpm episode add <new YouTube video>` without TTY and without flags → exit 2, names `--feed <url>` / `--no-feed` and lists candidates
- `pnpm episode add <url> --no-feed --added-at 2026-11-01 --json` → exit 0, `addedAt` = 2026-11-01
- `pnpm episode add <url> --feed <url>` → exit 0 (created show with the given feed)
- `pnpm episode add <url> --yes` → exit 0 (no feed)
- `pnpm episode add <url> --feed x --no-feed` → exit 2 (mutually exclusive)
- `pnpm episode add <bad url> --no-feed` → exit 3
- `pnpm episode add <url> --added-at 2026-13-40` → exit 3
- `pnpm transcribe --help` read only; **not run** (phase 8 transcription is in progress)

## Notes

- Observed while testing: a generic YouTube title with a colon (`Rick Astley - Never Gonna Give You Up (...)`) produced a guest entry `Never Gonna Give You Up`. Ingest heuristic, not a phase 9 issue; the skill tells the user to check guests when they add episodes.

## Repo checks (after writing)

- `pnpm exec oxfmt --check` on own files: clean
- `pnpm lint`: exit 0. `pnpm typecheck`: exit 0
- `pnpm test`: 26 files, 286 tests pass
- `pnpm build`: 3 episode pages + 404. `pnpm check:bundle`: ok. `pnpm check:tracked`: ok
- `pnpm dev`: Vite starts (5173 was in use, used 5174); stopped by timeout
- `pnpm format:check` (repo): fails only on `docs/progress/phase-8.md` and `transcriber/pyproject.toml` (phase 8, not owned here)
- Not run: `pnpm format` and `pnpm lint:fix` (they rewrite files repo-wide while other agents work). `pnpm transcribe <slug>` (phase 8 transcription is running; flags taken from `--help`)
- Real `data/` checked afterwards: episode `updatedAt` values unchanged, no conversations written

## Waiting on the user

- Full cycle on a real episode: `/add-episode` → discuss with `/podcast-notes` → save after OK → export the chat (`/export`) and paste it into the local UI.
- `docs/PROGRESS.md` phase 9 row: the orchestrator flips it to `done`.
