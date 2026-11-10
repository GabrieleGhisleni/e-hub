# Brief — phase 5 (Read-only frontend) — model: opus

You are implementing **phase 5 (Read-only frontend)** of the e-podcasts project in /home/ggabry/projects/e-podcasts. This is the public face of the project: it must be genuinely pleasant to use, not a scaffold.

First read `docs/PROGRESS.md` ("Rules every subagent gets" — follow them strictly), `docs/progress/phase-1.md` (setup: aliases, tsconfigs, shadcn, theme), `docs/progress/phase-3.md` (**data formats and the browser-safe schema module**), and `docs/DESIGN.md` §1, §4.2, §4.5, §6.2, §8 (all), §11, §13 and §15 phase 5. The doc is in Italian.

Parallel agents: phase 4 (ingest: `src/core/ingest/`, `src/cli/episode.ts`) and phase 8 (Python transcriber) run at the same time. Phase 4 will add a few real episodes to `data/` while you work. Don't touch their files.

Keep `docs/progress/phase-5.md` updated as you go (checklist, verification evidence, deviations, notes for phases 6 and 7). If it exists, continue from its checklist.

## You own

`src/web/` (except the contents of `src/web/dev/`, which phase 7 will fill — you only create the mount point described below), the post-build step (a Vite plugin in `vite.config.ts` or `scripts/postbuild.ts` wired into `pnpm build`), and web tests.

## Data (§8.1)

- Shows and episodes: `import.meta.glob` **eager** over `data/shows/*.json` and `data/episodes/*.json` only — never `data/transcripts/` or `data/cache/`.
- Conversations: `import.meta.glob` **non-eager** over `data/conversations/*.json` → one chunk per episode, loaded only when the detail page's conversations section is opened.
- Import types (and schemas if you validate) from the browser-safe core module phase 3 documented; never import Node-only core modules.
- In dev, when the server writes a data file, Vite reloads: the frontend always reads from the files.

## Routing (§8.2)

`BrowserRouter` with `basename={import.meta.env.BASE_URL}` (base `/e-podcasts/`). Routes: home `/`, detail `/episode/:slug`, a not-found page. Post-build: copy `dist/index.html` to `dist/episode/<slug>/index.html` for every episode and to `dist/404.html`.

## Home — dense list (§8.3)

- Single column, dense rows (not cards), visually pleasant. Per row: YouTube thumbnail (`https://i.ytimg.com/vi/<id>/hqdefault.jpg`; fallback: show image from `public/shows/`), **big readable title**, then guests, show, date, tags; summary visible (compact).
- Sorted by `addedAt`, newest first.
- Top: filters by **show** and by **tag** (multi-select is a nice touch), **full-text search** with MiniSearch over title, guests, tags, summary, notes (index built in memory on load; prefix + fuzzy). Filters and query reflected in the URL search params so links are shareable.
- Empty states: no episodes (in dev, an invitation to add the first episode — the add form itself is phase 7), no results.

## Detail (§8.4)

- Metadata and links (original episode, YouTube), large image (`maxresdefault.jpg` falling back to `hqdefault.jpg` on error, then the show image).
- Summary prominent, then notes rendered as markdown (react-markdown + remark-gfm). Timestamps `[HH:MM:SS]` (and `[MM:SS]`) in notes become links to `https://www.youtube.com/watch?v=<id>&t=<seconds>s` **only if** `transcriptTimebase === 'youtube'` and there is a `youtubeId`; otherwise plain text.
- Conversations in a collapsible section, loaded on demand (each: date, agent, markdown).
- **No transcript** anywhere on the site.
- A "nessuna trascrizione" badge can appear only in dev (it's a local-workflow hint; phase 7 adds the copyable command).

## Dev-only mount point for phase 7 (§8.5)

Phase 7 will add local features (add-from-URL form, editors, add conversation, copy for agent, speaker correction, transcribe badge). Create the seam now so phase 7 doesn't need to rework your pages:

- e.g. `src/web/dev-slot.tsx`: a component that, only when `import.meta.env.DEV`, lazy-loads `./dev/slots` via a dynamic `import()` inside that check and renders named slots (`home-toolbar`, `episode-actions`, `episode-notes-editor`, …) with the needed props; in production it renders nothing and the `dev/` code must not end up in the bundle.
- `src/web/dev/slots.tsx`: a placeholder exporting empty slot components (phase 7 replaces it). Verify after `pnpm build` that no code from `src/web/dev/` is in `dist/`.

## Look and feel

- UI strings in Italian. Light/dark follows the system (already set up). Use the shadcn components installed in phase 1 and Tailwind; good typography, spacing, hover/focus states, keyboard accessible, responsive down to phone width (no horizontal scroll). Dates formatted in Italian.
- Keep it fast: < 100 episodes, everything in memory.

## Demo data while you work

Phase 4 adds real episodes, but they will have empty summary/notes. To check layout with realistic content you may create **temporary** demo episodes/conversations named `demo-*` **through core functions** (so they are valid), list them in your report while they exist, and **delete them before you finish**. Never edit or delete non-demo files in `data/`.

## Done when (record evidence)

- `pnpm build` works; the production build served under `/e-podcasts/` (e.g. a static server rooted so that `dist/` is at `/e-podcasts/`, mimicking GitHub Pages) loads the home; a **direct link** to `/e-podcasts/episode/<slug>/` answers **200** and renders the episode; an unknown URL gets `404.html`.
- Conversations are in **separate chunks** (show the `dist/assets` listing) and load on demand.
- No `src/web/dev/` code and no `/api/` strings in `dist/`.
- Component/unit tests for the non-trivial logic (timestamp linking incl. the timebase rule, search/filter, thumbnail fallback).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` pass. Kill any server you started.

Do not commit. Final message: concise summary, screenshots or a description of the design, notes for phases 6 (what the bundle checks should grep for) and 7 (the slot API).
