# Phase 7 — Local server and dev-only features

Status: done (nothing committed)

## Checklist

- [x] `src/core/transcript-export.ts` + `src/cli/transcript.ts` (`pnpm transcript export <slug> [--out f]`)
- [x] export tests (`tests/core/transcript-export.test.ts`, `tests/transcript-cli.test.ts`)
- [x] Hono app: security middleware (host / origin / content-type), error mapping (`src/server/{app,security,errors,index}.ts`)
- [x] endpoints (preview/add, save, conversations, speakers, export, tags)
- [x] server tests (`tests/server/{security,api}.test.ts`)
- [x] dev UI: api client, drafts, flash toasts, layout (Toaster)
- [x] dev UI: add-from-URL dialog (feed confirmation, never preselected)
- [x] dev UI: editor (summary/notes/tags/guests) + conflict/draft handling
- [x] dev UI: add conversation
- [x] dev UI: copy for agent
- [x] dev UI: speaker correction
- [x] dev UI: no-transcript badge + copyable command
- [x] web tests (`src/web/dev/dev.test.tsx`)
- [x] browser/curl verification on a temp copy of the project
- [x] build / check:bundle
- [x] typecheck / lint / format (own files) / test

## Files

- Core/CLI: `src/core/transcript-export.ts` (`renderTranscriptMarkdown`, `exportTranscriptMarkdown`, `formatExportTimestamp`, `PARAGRAPH_SECONDS = 75`), `src/cli/transcript.ts`.
- Server: `src/server/app.ts` (`createApp({ingest?})`, routes), `security.ts` (`localOnly`, `isLoopbackHost`), `errors.ts` (`toErrorResponse`, `BadRequestError`), `index.ts` (`export default createApp()`).
- Dev UI (`src/web/dev/`): `slots.tsx` (map only, keeps `DEV_ONLY_MARKER`), `dev-layout.tsx`, `add-episode.tsx`, `episode-tools.tsx`, `episode-editor.tsx`, `chip-input.tsx` (tags + guests), `conversation-dialog.tsx`, `copy-for-agent.tsx`, `speakers-dialog.tsx`, `transcript-status.tsx`, `clipboard.ts`, `api.ts`, `drafts.ts`, `storage.ts`.
- Tests: `tests/core/transcript-export.test.ts`, `tests/transcript-cli.test.ts`, `tests/server/security.test.ts`, `tests/server/api.test.ts`, `src/web/dev/dev.test.tsx`. No dependency added; no edit outside owned files.

## Endpoints (all under `/api`, JSON; errors `{error, code, details?}`)

| Method + path                                  | Body                                                                     | Result                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                              | —                                                                        | `{ok:true}`                                                                                                   |
| `GET /api/tags`                                | —                                                                        | `[{tag,count}]`                                                                                               |
| `POST /api/episodes/preview`                   | `{url}`                                                                  | `previewAdd` result (no writes)                                                                               |
| `POST /api/episodes`                           | `{url, feed?: string\|null}` (no `addedAt`: CLI-only)                    | 201 `addEpisode` result; 422 `code: "feed-decision-required"` + `candidates` when a new show needs a feed     |
| `PUT /api/episodes/:slug`                      | `{expectedUpdatedAt (required), summary?, notes?, tags?, guests?}`       | `{slug, written, updatedAt, changedFields, episode}`; 409 `conflict` (+`expectedUpdatedAt`,`actualUpdatedAt`) |
| `POST /api/episodes/:slug/conversations`       | `{agent, markdown, date?, expectedUpdatedAt?}`                           | `{slug, updatedAt, conversations:{added,skipped,excerptsRemoved}, transcriptChecked}`                         |
| `GET /api/episodes/:slug/transcript/speakers`  | —                                                                        | `{available, source?, timebase?, speakers:[{speaker,segments,firstStart}]}`                                   |
| `POST /api/episodes/:slug/transcript/speakers` | `{mapping:{old:new}, from?, to?}` (simultaneous: swap = `{A:"B",B:"A"}`) | same shape as GET                                                                                             |
| `GET /api/episodes/:slug/transcript.md`        | —                                                                        | `text/markdown` compact export; 404 `not-found` without a local transcript                                    |

Status mapping: 400 bad request / invalid slug / unknown field (`bad-request`), 403 foreign Host/Origin, 404 not found, 409 conflict/duplicate/already-exists, 413 body > 8 MB, 415 non-JSON write, 422 validation **and** transcript guard (differs from core's `httpStatusFor`, which maps validation to 400), 502 `HttpError` (`network`, "riprova più tardi"), 500 `internal` (generic message, stack only logged server-side).

## Verification

- Vite's own host check **does** run before the Hono middleware: `curl -H 'Host: evil.example' /api/health` → `403` plain text "Blocked request. This host ("evil.example") is not allowed" (Vite). My middleware also checks (unit-tested with `app.request`), so the protection does not depend on that Vite default.
- Against the dev server (port 5174, copy of the project, see below):
  - `curl -i -X POST /api/episodes/preview -H 'Content-Type: application/json' -H 'Origin: http://evil.example' -d '{"url":"https://example.com"}'` → `403 {"error":"Origin non consentito per le scritture.","code":"forbidden-origin"}`
  - same without `Origin` → 403 `forbidden-origin`
  - `-H 'Content-Type: text/plain' -H 'Origin: http://localhost:5174'` → `415 {"code":"unsupported-media-type"}`
  - same-origin JSON, bad URL → `422 {"error":"unsupported URL: 'nope'","code":"validation",...}`
  - stale save: `PUT /api/episodes/<slug>` with `expectedUpdatedAt: 2020-01-01…` → `409 {"code":"conflict","expectedUpdatedAt":"2020-01-01…","actualUpdatedAt":"2026-11-10T11:42:45.647Z"}`
  - notes containing a transcript excerpt → `422 transcript-guard` ("notes: 292 consecutive words from the transcript…"); conversation with an excerpt → `{"conversations":{"added":1,"skipped":0,"excerptsRemoved":1}}`.
- Real UI (built-in browser pane, which is only ~270 px wide, so effectively phone width) against a **copy of the whole project** in the session scratchpad (`e2e/`, `node_modules` symlinked) so that both the frontend glob and the writes hit the copy; the real `data/` was never written (3 episodes, no conversations, `grep "Steve Brunton"` in the real Lex transcript: 0):
  - Add from URL: pasted `youtube.com/watch?v=jNQXAC9IVRw` → preview (title, show "nuovo", transcript "nessuna", 5 iTunes candidates; "Aggiungi episodio" disabled until a feed is chosen; the "exact" candidate was clearly the wrong podcast, hence no preselection) → "Nessun feed" → added → page navigated to `/e-podcasts/episode/jawed-me-at-the-zoo/`, toast "Episodio aggiunto…", badge "Nessuna trascrizione" + button `pnpm transcribe jawed-me-at-the-zoo`.
  - Editor: typed notes → draft in `sessionStorage`; while the editor was open a skill-like `pnpm episode save` changed summary/tags in the copy → Vite reloaded, the editor reopened with the typed notes and the new summary (untouched fields follow the new version), banner "Bozza basata su una versione precedente" with "Mostra la versione salvata"; "Salva" wrote only the changed field (`fields: notes`), toast "Salvato", draft cleared, notes rendered.
  - 409 in the UI is covered by a jsdom test (alert "Conflitto di versione", button "Ricarica la versione aggiornata (tieni la bozza)", text and draft intact, request carries `expectedUpdatedAt`); in the browser it cannot be forced because Vite reloads the page faster than a human can save.
  - Add conversation (pasted markdown with a 30-word transcript excerpt) → toast "Conversazione aggiunta / 1 estratto della trascrizione rimosso".
  - Copia per l'agente → toast "Copiato negli appunti … circa 38.863 parole" (the pane denies the async Clipboard API; the `execCommand` fallback worked with a real click). Speaker dialog on the Lex transcript (4 speakers) → renamed one → toast; the CLI export of the copy shows the new name.
- `pnpm transcript export <lex slug>` (real transcript, first lines only): header `# #503 – …`, `- Show: Lex Fridman Podcast`, guests, Original/YouTube links, `- Transcript source: lex-official`, `- Timebase: youtube`, then `## Introduction` and `**Lex Fridman** [00:00:00] …`. Huberman (wiki, no speakers): `[00:00:00] …` paragraphs of ~75 s. Dwarkesh (no transcript): exit 4 `error (not-found): … has no local transcript (run: pnpm transcribe <slug>)`. Piping into `head` no longer crashes (EPIPE handled).
- `pnpm build`: 3 episode pages + 404; `pnpm check:bundle` → ok; `grep -r "/api/" dist` and `grep -r "e-podcasts-dev-only|Aggiungi da URL|Copia per l'agente" dist` → nothing.
- `pnpm typecheck`, `pnpm lint` clean; `pnpm test`: 26 files, 286 tests pass; `pnpm format:check` clean for every file of this phase (only `docs/progress/phase-8.md` and `transcriber/pyproject.toml`, owned by phase 8, are listed). The dev server I started (PID 580729, port 5174) was killed by PID; other servers on the machine untouched.

## Decisions and deviations

- **Export format** (`§4.4`): header lines `- Show`, `- Guests`, `- Original`, `- YouTube`, `- Transcript source`, `- Timebase` (+ a `> Note:` blockquote when `timebase: feed`); chapters `##`; same-speaker runs merged (also across segments much longer than a paragraph: no cap); without speakers paragraphs of ~75 s. The transcript guard treats labels/timestamps/headings as transparent (tested: pasting the export into a conversation is redacted).
- **Origin = `http://<Host>`**: the dev server's own origin is taken from the (already validated) `Host`, so `http://localhost:3000` against `localhost:5173` is rejected too.
- **Validation → 422** (not 400) for the local API, as the brief asks.
- **One "Modifica" dialog** for summary/notes/tags/guests instead of inline editors in three slots (single draft, single save, one `expectedUpdatedAt`). Slots used: `header-actions`, `layout`, `home-empty`, `episode-actions`, `episode-transcript` (renders `<li>`), `episode-conversations`. Unused: `home-toolbar`, `episode-meta/summary/notes`.
- **Draft semantics**: draft = `{summary, notes, tags, guests, baseUpdatedAt, base}` in `sessionStorage` (`e-podcasts-dev:draft:<slug>`); the editor reopens by itself after a reload if a draft exists. When the episode changed since the draft started (also live, via HMR), fields the user touched are kept and the others take the new version, so saving never reverts a skill's changes. `expectedUpdatedAt` sent is always the page's current `updatedAt`; a real 409 (save racing the reload) shows the conflict alert and keeps the text.
- **Vite reload vs toasts**: writes to `data/*.json` trigger a Vite reload, which would swallow toasts; messages are parked in `sessionStorage` and shown by the freshly loaded page (or after 1.5 s if the page survived). After "add" the UI does a hard navigation to the new episode for the same reason.
- Transcript writes (speakers) don't reload the page (not imported by the app).
- Conversation add does bump the episode's `updatedAt` (core behaviour); the editor re-merges when that happens.
- `import.meta.glob` data reading: dev server started from a project copy (not env vars) so reading and writing hit the same data. With `E_PODCASTS_DATA_DIR` pointing elsewhere the UI would not see the writes.

## Notes for phase 9 (skills)

- `pnpm transcript export <slug> [--out file]` is the way to get the transcript for a discussion (stdout by default; exit 4 + hint `pnpm transcribe <slug>` when missing). Output is also what "Copia per l'agente" copies; pasting it back into a conversation gets redacted by the guard (placeholder `[estratto della trascrizione rimosso]`).
- `pnpm dev` UI and skills write through the same core: both use `updatedAt`; a skill should pass `--expected-updated-at` read at the start. If the dev UI is open, a skill save reloads the page; typed text survives as a draft.
- The server is only for the UI; skills must use the CLI (`episode add/save`, `tags`, `transcript export`), never the HTTP endpoints.
- Dev server: Vite picks the next free port (5173 may be taken); never `--host`.
