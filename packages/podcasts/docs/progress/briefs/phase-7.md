# Brief — phase 7 (Local server and dev-only features) — model: sonnet

You are implementing **phase 7 (Server and local features)** of the e-podcasts project in /home/ggabry/projects/e-podcasts.

First read `docs/PROGRESS.md` ("Rules every subagent gets" — follow them strictly), then the reports `docs/progress/phase-1.md`, `phase-3.md` (core API: save, guard, speakers, errors/exit codes), `phase-4.md` (ingest API: preview/add, feed confirmation), `phase-5.md` (frontend + **the dev slot API you plug into**), and `docs/DESIGN.md` §4.3, §4.4, §5, §5.1, §7.6, §8.1, §8.5, §9, §11, §15 phase 7. The doc is in Italian.

Parallel agents may be running (phase 6 CI in `.github/` and `scripts/`, phase 8 transcriber in `transcriber/` and `src/cli/transcribe.ts`). Don't touch their files.

Keep `docs/progress/phase-7.md` updated as you go. If it exists, continue from its checklist.

## You own

`src/server/`, `src/web/dev/` (replace phase 5's placeholder slots), `src/cli/transcript.ts`, a new `src/core/transcript-export.ts` (shared by CLI and server), and tests for all of them. Minimal edits elsewhere only if the slot API truly lacks something (record it).

## 1. Compact markdown export — §4.4

`exportTranscriptMarkdown(slug)` in core + `pnpm transcript export <slug> [--out <file>]` (stdout by default, read-only):

- Header: title, show, guests, links (original, YouTube), `timebase` (and a one-line note that with `feed` timestamps don't match the video).
- Chapters as `##`. Consecutive segments of the same speaker merged into one paragraph with a timestamp at its start: `**Lex** [01:23:45] …`. Without speakers (PatrykWajs), group segments into paragraphs of reasonable size (e.g. ~60–90 s or by chapter), each starting with its timestamp.
- Clear error when the episode has no local transcript.

## 2. Hono endpoints — §9 (thin layer over core and ingest)

Suggested (adapt to the core/ingest APIs): add-episode preview + add (with feed confirmation for a new show), save notes/tags/guests/summary with `expectedUpdatedAt` (409 on conflict, 422 on validation/guard rejection with the message), add conversation (returns how many transcript excerpts were removed), speaker correction, transcript speakers list, transcript export (markdown, for "Copia per l'agente"), existing tags list.

**Security** (the server writes files that end up in a public repo):

- Localhost only (Vite default; never `--host`).
- Every `/api` request: reject a `Host` header that is not `localhost`/`127.0.0.1`/`[::1]` (+ port) — DNS-rebinding protection; check whether Vite's own host check already runs before the Hono middleware and record the finding, but keep your own check regardless.
- Write requests (POST/PUT/PATCH/DELETE): require `Content-Type: application/json` and an `Origin` equal to the dev server's own origin; otherwise 403/415.
- Slugs validated with the core regex before any file path is built.
- Errors as JSON `{error, code}`; never leak stack traces.

## 3. Dev-only UI — §8.5 (in `src/web/dev/`, via the phase 5 slots; never in the prod bundle)

- **"Aggiungi da URL"** form: preview → if new show, choose/confirm the iTunes feed (or none) → add; then navigate to the new episode. Optional "data di aggiunta" is **not** in the UI (CLI-only `--added-at`).
- **Editor** for summary / notes / tags / guests. Tags: input with suggestions from existing tags (shadcn `command`/`popover`), lowercase English enforced.
- **"Aggiungi conversazione"**: agent name + pasted markdown; after saving, tell how many transcript excerpts were removed.
- **"Copia per l'agente"**: fetch the export and copy it to the clipboard (with a toast).
- **Speaker correction**: list speakers of the local transcript; swap host/guest, or assign a name to each speaker.
- **"Nessuna trascrizione"** badge + copyable `pnpm transcribe <slug>` command.
- **Conflicts and reloads**: Vite reloads the page when a data file changes (e.g. a skill saved from the CLI while you type). Persist editor drafts per episode (e.g. `sessionStorage`, wrapped in try/catch) so a reload never loses typed text; on a 409, say so in Italian and offer to reload the fresh version while keeping the draft. Clear the draft after a successful save.
- All UI strings in Italian; consistent with the phase 5 design (shadcn, Tailwind).

## Done when (record evidence)

- From the UI (`pnpm dev`), an episode can be added and its notes edited without touching files by hand (drive it via the server endpoints with curl at least; if you have a browser tool, also click through it).
- A conflicting save (stale `expectedUpdatedAt`) is reported and the typed text survives.
- A POST with a foreign `Origin` (e.g. `Origin: http://evil.example`) is rejected; a foreign `Host` is rejected; a non-JSON write is rejected — show the curl commands and responses.
- `pnpm transcript export <slug>` works on an episode with a local transcript (don't paste its content into tracked files or your report beyond a few lines).
- `pnpm build`: no `src/web/dev/` code and no `/api/` strings in `dist/` (run `pnpm check:bundle` if phase 6 added it).
- Tests for the export format, the security middleware (origin/host/content-type) and the endpoints' error mapping.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` pass. Kill any dev server you started (by PID — other unrelated Vite servers are running on this machine).

Do not commit. Final message: concise summary, endpoint list, notes for phase 9 (skills).

## Addendum (orchestrator, after phase 5)

- Plug into the slot API documented in `docs/progress/phase-5.md`: `src/web/dev/slots.tsx` must keep exporting `DEV_ONLY_MARKER` (the CI bundle check greps for it) and export `slots: DevSlots` typed by `DevSlotPropsMap`. Put the real components in separate files under `src/web/dev/` (Fast Refresh). Mount `<Toaster/>` in the `layout` slot. Use `useSiteData()` from `@/site-data`. `src/web/dev-slot.test.tsx` shows how to mock the module in tests.
- The `episode-transcript` slot renders inside a `<ul>`: render `<li>` elements.
- `pnpm check:bundle` (phase 6) fails on `e-podcasts-dev-only`, `assets/slots-*.js`, `devFeatures`, and string literals starting with `/api/`: never reference those from non-dev code.
