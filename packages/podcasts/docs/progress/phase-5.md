# Phase 5 — Read-only frontend

Status: done (nothing committed)

## Checklist

- [x] data layer (`src/web/data.ts`: `import.meta.glob` eager shows/episodes, lazy conversations; pure `src/web/lib/catalog.ts`; context `src/web/site-data.tsx`)
- [x] routing (`src/web/App.tsx` `BrowserRouter` + basename + `useTransitions={false}`; `src/web/routes.tsx` home / `episode/:slug` / `*`)
- [x] lib: `lib/filters.ts` (URL params), `lib/search.ts` (MiniSearch + facets), `lib/timestamps.ts` (timestamp links + remark plugins), `lib/images.ts` (thumbnail fallback chain), `lib/format.ts` (Italian dates), `lib/paths.ts`
- [x] components written: `episode-image`, `markdown`, `filter-picker`, `episode-row`, `site-layout` (header, scroll restoration, document title), `conversations`
- [x] pages: `pages/home.tsx`, `pages/episode.tsx`, `pages/not-found.tsx`
- [x] dev slot seam (`src/web/dev-slot.tsx` + placeholder `src/web/dev/slots.tsx`)
- [x] first typecheck/lint pass on the new code
- [x] post-build step: `scripts/static-pages.ts` (Vite plugin `staticPages()`, `closeBundle`, wired in `vite.config.ts`)
- [x] tests: `src/web/lib/timestamps.test.ts`, `src/web/components/markdown.test.tsx` (timestamp linking + timebase rule), `src/web/lib/search.test.ts` (catalog, search, filters, facets, URL params), `src/web/components/episode-image.test.tsx` (fallback chain), `src/web/pages/pages.test.tsx` (home + detail + not found + conversations on demand), `src/web/dev-slot.test.tsx`, `tests/static-pages.test.ts` (post-build) — 46 tests; typechecked via new `tsconfig.web-test.json`
- [x] demo content created (through core) — dev check below
- [x] build served under `/e-podcasts/` verified (home, direct link 200, unknown URL 404) — see Verification
- [x] conversation chunks separate + on demand; no `src/web/dev/` code and no `/api/` in `dist/`
- [x] browser check: light, dark, phone width
- [x] typecheck / lint / format:check (own files) / test
- [x] demo content removed (6 episodes, 1 conversations file, 2 local transcripts); rebuilt with 0 episodes; servers stopped

## Demo content

None left. While working, 6 `demo-*` episodes (1 with conversations, 2 with local synthetic transcripts) were created through core (`createEpisode` + `saveEpisode`, script in the session scratchpad) and deleted at the end:
`rm data/{episodes,conversations,transcripts}/demo-*.json` (only files with those exact names). `find data -name 'demo-*'` → nothing.

## Dev check (pnpm dev on port 5195, built-in browser)

- Home: dense rows, month groups, thumbnails; `?q=dopamne` (typo) finds the 2 dopamine episodes (fuzzy); typing in the search box updates `?q=` live; tag picker (type "sle", Enter) → `?tag=sleep`, chip + "2 episodi su 6".
- Fallbacks: `jNQXAC9IVRw` (no maxres) → detail shows `hqdefault` (480 px); id `AAAAAAAAAAA` → show cover letterboxed on blurred copy; no youtubeId → show cover.
- Detail: timestamps linked as chips with `transcriptTimebase: youtube` (also inside tables, `[2:31:07]`, `[12:30]`), `[99:99:99]` and an already-linked label untouched; feed timebase → plain text + note; conversations chunk `data/conversations/<slug>.json?import` requested only after opening the section; redaction placeholder rendered as a muted chip.
- Phone (375×812) light + dark: no horizontal scroll (`scrollWidth === clientWidth === 375` on home and detail).

## Verification

- `pnpm build` (with the 6 demo episodes):
  ```
  dist/index.html                                              0.47 kB
  dist/assets/index-DFJ0zjzJ.css                              69.84 kB │ gzip:  11.82 kB
  dist/assets/demo-lex-scaling-interpretability-CAsQAHQl.js    0.93 kB │ gzip:   0.59 kB   ← conversations chunk
  dist/assets/markdown-FirvUcwu.js                           164.52 kB │ gzip:  49.41 kB   ← react-markdown + gfm (lazy)
  dist/assets/index-BdkJ5hfD.js                              442.65 kB │ gzip: 142.05 kB
  static pages: 6 episode page(s) + 404.html
  ```
  `find dist -type f`: `404.html`, `index.html`, `episode/<slug>/index.html` ×6, `assets/` (4 files above), `shows/*.webp`.
- Pages-like static server (scratchpad `pages-server.mjs`: `dist/` at `/e-podcasts/`, dir → `index.html` with 301 to trailing slash, missing → `404.html` + status 404), `curl -w '%{http_code}'`:
  `/e-podcasts/` 200 · `/e-podcasts/episode/demo-lex-scaling-interpretability/` 200 · same without slash 301 → slash · `/e-podcasts/episode/nope/` 404 · `/e-podcasts/whatever` 404 · `/e-podcasts/shows/lex-fridman.webp` 200.
  Episode copy has `<title>#999 – Ada Example &amp; Grace Sample: … · e-podcasts</title>` + description/og tags.
- Browser on the static server: direct link renders the episode (requests: `index-*.js`, `index-*.css`, `markdown-*.js`; the conversations chunk `demo-lex-scaling-interpretability-*.js` only after clicking "Conversazioni", then 2 conversations shown); `/e-podcasts/does/not/exist` (served 404) shows "Pagina non trovata"; home renders; no dev badge, `data-dev-features` absent; scrolled home to 600 px → episode → "Tutti gli episodi" → back at 596 px.
- `grep -rl` over `dist/`: `/api/` 0 files, `e-podcasts-dev-only` 0, `devFeatures` 0, dev-only UI strings ("Nessuna trascrizione", "Aggiungi il primo episodio", "pnpm episode add") 0, no `slots-*.js` chunk, demo transcript text 0. Control: `vite build --mode development` (scratch outDir, deleted) **does** emit `assets/slots-*.js` containing `e-podcasts-dev-only`, so the marker check is effective.

## Files

- `src/web/App.tsx` (router), `routes.tsx`, `data.ts` (globs), `site-data.tsx` (context: catalog, MiniSearch index, conversation loader), `dev-slot.tsx` (seam), `dev/slots.tsx` (placeholder, phase 7 replaces), `index.css` (+ `--brand` accent, `.markdown` typography).
- `lib/`: `catalog.ts`, `filters.ts`, `search.ts`, `timestamps.ts`, `images.ts`, `format.ts`, `paths.ts`.
- `components/`: `episode-row.tsx`, `episode-image.tsx`, `filter-picker.tsx`, `markdown.tsx` (+ `lazy-markdown.tsx`), `conversations.tsx`, `site-layout.tsx`.
- `pages/`: `home.tsx`, `episode.tsx`, `not-found.tsx`. Tests next to the code (`*.test.ts[x]`) + `testing/fixtures.ts`.
- `scripts/static-pages.ts` (post-build plugin), `tests/static-pages.test.ts`, `tsconfig.web-test.json`.
- Shared files, minimal edits: `vite.config.ts` (+ `staticPages()`), `package.json` (`typecheck` also runs `tsconfig.web-test.json`), `tsconfig.json` (reference to it).

## Design

- Visual: neutral shadcn palette + one warm accent (`--brand`, orange-red; lighter in dark mode) for the logo, summary bullets, timestamp chips. System fonts, antialiased, `text-balance` titles, tabular numbers. Max width 4xl for the list, 3xl reading column for the detail.
- Home: "Podcast ascoltati" + counts; toolbar (sticky from `sm`) with search (`/` focuses it, Esc clears, × button) and two multi-select pickers (popover + command: searchable, checkmarks, faceted counts, zero-count options disabled); active filters as removable chips + "N episodi su M" + "Azzera filtri". List grouped by month of `addedAt` (no grouping while searching: results by relevance). Row: 16:9 thumbnail, big title (whole row is the link, stretched-link pattern), guests · show #n · date, summary points inline (2-line clamp), tags as toggle buttons.
- Detail: back link (returns to the same filtered list and scroll position), show avatar + episode number, big title, "con <guests>" (link to a search), tags (links to the tag filter), dates, buttons "Guarda su YouTube" / "Episodio originale <host>" (only one if the original _is_ the YouTube video), large image (link to the video, play overlay on hover), "In breve" card, "Appunti" (markdown), "Conversazioni" collapsible (count after load; each chat as a card with agent + date).
- Empty states: no episodes (dev: invitation + `pnpm episode add <url>` + `home-empty` slot; prod: neutral message), no results (message + "Azzera filtri"), episode without notes, unknown episode / page (404 page with link home).

## Decisions and deviations

- **Search results are ordered by relevance**, not by `addedAt` (DESIGN §8.3 sorts the list by `addedAt`; that stays the order whenever there is no query). Words combine with AND, prefix + fuzzy 0.2, diacritics ignored; boosts title/guests ×3, tags ×2, summary ×1.5.
- **Filter semantics**: shows = any of the selected; tags = all of the selected. URL: `?q=…&show=<slug>&show=…&tag=<tag>&tag=…` (`replace` navigation, so typing doesn't spam history).
- `BrowserRouter useTransitions={false}`: React Router 7 wraps navigations in `startTransition` by default, which makes a URL-driven controlled input lag; synchronous updates keep the search box simple (no local state to reconcile).
- No runtime zod validation in the browser (bundle size): records are written by core and validated by `tests/data.test.ts`; `lib/catalog.ts` only fills defaults and drops records missing slug/title/show/url/addedAt. The **post-build step does validate** with the schema and fails the build on an invalid file.
- Conversation dates stored at midnight UTC (input `YYYY-MM-DD`) are shown as a calendar date; other times as date + time.
- Timestamps also link inside conversations (same timebase rule). In notes with `transcriptTimebase: "feed"` a one-line note says timestamps refer to the feed audio.
- Custom scroll restoration (positions per history entry) because `BrowserRouter` has no `<ScrollRestoration>`.
- `react-markdown` + `remark-gfm` are lazy-loaded (`components/lazy-markdown.tsx`): the main chunk went from 610 kB to 443 kB (no more >500 kB warning).
- Removed the unused `TooltipProvider` from `App.tsx` (nothing uses tooltips; phase 7 can wrap its own tooltips in a provider inside its slot components).
- Per-episode HTML copies get the episode `<title>`, `meta description` and `og:*` tags (link previews), all HTML-escaped.
- Web tests live next to the code (`src/web/**/*.test.ts[x]`) and are typechecked by a new `tsconfig.web-test.json` (web settings, test files included).
- Vite prints a warning on start: `configLoader: 'native'` (future default) would need explicit extensions for `./scripts/static-pages` and `../src/core/schema`. Harmless now; adding `.ts` would need `allowImportingTsExtensions` in `tsconfig.node.json` (phase 1's file) — left for the final review.

## Notes for phase 6 (bundle check)

Grep the built `dist/` (all files; JS is minified, strings stay literal) and fail if any of these appear:

- `e-podcasts-dev-only` — `DEV_ONLY_MARKER` exported by `src/web/dev/slots.tsx` (phase 7 must keep it); present only if the dev module got bundled (verified: a `--mode development` build contains it in `assets/slots-*.js`).
- a chunk named `assets/slots-*.js` (the dev module's chunk name).
- `/api/` as the **start of a string literal**: regex `["'\x60]/api/` — the local server's routes. Prefer this over a bare `/api/`: episode notes and summaries are bundled as data (and conversations as chunks), and a note may legitimately mention a URL path containing `/api/`. Today `grep -r "/api/" dist` is 0 anyway.
- `devFeatures` (the `data-dev-features` attribute set by the dev loader).
- Not a marker: the slot _names_ (`header-actions`, `episode-notes`, …) do appear in prod — `<DevSlot name=…>` stays and renders its default children.
- Also useful: `data/transcripts/`, `data/cache/` content can't be bundled (the globs only cover `data/shows/*.json`, `data/episodes/*.json`, `data/conversations/*.json`).
- Build output for Pages: `dist/` (with `index.html`, `404.html`, `episode/<slug>/index.html`); base `/e-podcasts/`.

## Notes for phase 7 (slot API)

- Seam: `src/web/dev-slot.tsx`. Pages render `<DevSlot name="…" {...props}>{defaultContent}</DevSlot>`. In production it renders `defaultContent` (or nothing) and never imports `src/web/dev/`. In dev it lazily `import("./dev/slots")` once; until loaded, or if the module has no component for a name, it renders `defaultContent`; a slot that throws falls back to `defaultContent` (error boundary, logged).
- Contract of `src/web/dev/slots.tsx`: `export const DEV_ONLY_MARKER = "e-podcasts-dev-only"` (keep it) and `export const slots: DevSlots = { … }` — a component per slot name, typed by `DevSlotPropsMap`. Each component gets the slot's props **plus `children` = the default (read-only) content**, and decides: render it and add something, wrap it, or replace it (e.g. an editor instead of the notes). Put real components in separate files (`src/web/dev/*.tsx`) so Fast Refresh works; `slots.tsx` just maps names to them.
- Slots (props besides `children`):

  | name                    | where                                                                                          | props                                                                           | default children                                                        |
  | ----------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
  | `header-actions`        | site header, right, every page                                                                 | —                                                                               | none                                                                    |
  | `layout`                | once at the end of the layout, every page (e.g. sonner `<Toaster />`)                          | —                                                                               | none                                                                    |
  | `home-toolbar`          | home filter bar, after the Show/Tag pickers                                                    | `episodes`, `shows`                                                             | none                                                                    |
  | `home-empty`            | home empty state (no episodes, dev text above it)                                              | `shows`                                                                         | none                                                                    |
  | `episode-actions`       | detail, after "Guarda su YouTube" / "Episodio originale"                                       | `episode`, `show`                                                               | none                                                                    |
  | `episode-transcript`    | detail, dates row (an `<li>` context: render `<li>`s)                                          | `episode`                                                                       | dev-only "Nessuna trascrizione" badge when `transcriptSource` is absent |
  | `episode-meta`          | detail header                                                                                  | `episode`                                                                       | guests ("con …") + tag links                                            |
  | `episode-summary`       | detail                                                                                         | `episode`                                                                       | "In breve" card (`null` when empty)                                     |
  | `episode-notes`         | detail                                                                                         | `episode`                                                                       | "Appunti" markdown (`null` when empty)                                  |
  | `episode-conversations` | conversations section header, right; always visible (section shown in dev even without a file) | `episode`, `conversations` (`undefined` until the section is opened and loaded) | none                                                                    |

- Data in dev components: `useSiteData()` from `@/site-data` gives `{catalog, index, conversations}` (e.g. all tags for suggestions: `countTags(catalog.episodes)` from `@core/tags`). After the server writes a data file Vite reloads the module graph, so the pages re-render from the files.
- Not yet in prod/dev: `<Toaster />` and `TooltipProvider` (mount them from `layout` / inside slot components). The "empty notes" message (`Ancora nessun appunto…`) is rendered outside the slots when both summary and notes are empty.
- `src/web/dev-slot.test.tsx` shows how to test a slot with `vi.mock("./dev/slots", …)`.

## Log

- 2026-11-10 — Started. Read brief, PROGRESS rules, phase 1/3 reports, DESIGN §1, §4.2, §4.5, §6.2, §8, §11, §13, §15.
- 2026-11-10 — Wrote data layer, lib, components, pages, dev slot seam. Interrupted by the usage limit before compiling; resumed.
- 2026-11-10 — Dev check in the browser (light/dark/phone), tests (46 web + post-build), build served Pages-style, bundle greps; main chunk split (markdown lazy).
- 2026-11-10 — Final: demo content removed; `pnpm build` with 0 episodes → `static pages: 0 episode page(s) + 404.html`, prod home shows "Ancora nessun episodio"; `pnpm typecheck` OK, `pnpm lint` OK, `pnpm test` 18 files / 187 tests OK, `pnpm format:check` clean for every file of this phase (the 15 files it still lists belong to phases 4/8 and the orchestrator). Vite dev server (port 5195) and the static server (4599) killed by PID.
