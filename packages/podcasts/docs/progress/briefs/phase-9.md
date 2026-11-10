# Brief — phase 9 (Claude Code skills and AGENTS.md) — model: haiku

You are implementing **phase 9 (Skills and AGENTS.md)** of the e-podcasts project in /home/ggabry/projects/e-podcasts. Mostly writing: two Claude Code skills and the agent conventions file. They must match the real CLI exactly.

First read `docs/PROGRESS.md` ("Rules every subagent gets"), the reports `docs/progress/phase-3.md`, `phase-4.md`, `phase-7.md`, `phase-8.md` (real CLI commands, flags, exit codes, data formats), and `docs/DESIGN.md` §1, §4.4, §4.5, §5, §5.1, §7.6, §10, §15 phase 9. If a `writing-for-agents` skill is available to you, load it first and follow it. **Check every command you document by running it** (`--help` or a harmless invocation against a temp data dir) — never invent flags.

Keep `docs/progress/phase-9.md` updated as you go. If it exists, continue from its checklist.

## You own

`.claude/skills/add-episode/SKILL.md`, `.claude/skills/podcast-notes/SKILL.md`, `AGENTS.md`, and a one-line `CLAUDE.md` that imports it (`@AGENTS.md`) so Claude Code loads it.

## `/add-episode <url>` — §10.1

- Runs `pnpm episode add <url>` (non-interactive flags as documented by phase 4). For the initial import of already-listened episodes, accepts a date and passes `--added-at`.
- New show: show the proposed feed(s) to the user and ask which to confirm (or none) before running the command with the right flag.
- If no transcript is found: **ask** whether to run Whisper; if yes, run `pnpm transcribe <slug>` **in the background** (~25 min) and tell the user when it finishes.
- Report the slug and what was created.

## `/podcast-notes <slug>` — §10.2

- Context: the user has listened to the episode. Load the **whole** transcript with `pnpm transcript export <slug>` (no RAG, no chunked reading); note the `timebase` in its header.
- Read the current episode JSON first and remember its `updatedAt`; run `pnpm tags` to know existing tags.
- Lead a **question-and-answer exploration** to dig into and reflect on what was said, citing timestamps. Quotes from the transcript: **under 20 words**; otherwise paraphrase (the save will reject longer runs, §5.1).
- At the end, prepare the fixed output format (summary, notes, tags reusing existing ones — English, lowercase —, guests if missing), **show the draft**, and save only after the user's explicit OK, with `pnpm episode save <slug> --input <file or -> --expected-updated-at <updatedAt read at the start>`. On a conflict, re-read and ask; on a guard rejection, paraphrase and retry.
- The skill does **not** save the conversation: tell the user to export it (e.g. Claude Code `/export`) and paste it in the local UI ("Aggiungi conversazione"), where transcript excerpts are stripped automatically.

## `AGENTS.md` — §10.3

Concise conventions for any agent: data layout (what is in git and what is local-only, and why), the **single write point** (CLI/core — never edit JSON files by hand), the output format for summary/notes/tags/guests (with a small example input file for `episode save`), language conventions (UI Italian, notes free, tags English lowercase), `pnpm tags` for existing tags (no copied list), the quotation rule (< 20 words), commands overview (`dev`, `build`, `test`, `lint`, `format`, `typecheck`, `episode add/save`, `tags`, `transcript export`, `transcribe`), pointer to `docs/DESIGN.md`.

## Done when (record evidence)

- Every command and flag in the three files has been run successfully (temp data dir where it writes) — list them in the report.
- A dry run of the `/podcast-notes` save path: an input file in the documented format saved against a temp data dir with `--expected-updated-at` works, and a stale value is rejected.
- The full real-episode cycle (add → discuss → save → paste conversation) needs the user; leave it listed under "Waiting on the user" in your report.
- `pnpm format:check` passes.

Do not commit. Final message: concise summary.
