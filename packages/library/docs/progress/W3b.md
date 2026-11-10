# W3b — Public SPA (layout, theme, grid, filters, search, book page, routing, admin extension points)

Status: done (started 2026-11-10; resumed after an API-limit cut the same day; finished 2026-11-10)

## Checklist

- [x] 1. Progress file + read contracts/spec (PROGRESS.md contracts, PLAN §1/3/4/5/9/10/17, site-urls, schema, labels, vite plugin)
- [x] 2. `scripts/demo-data.ts` + `pnpm demo-data [dir]` (writes outside the repo; run OK → `/tmp/elib-demo-data`, 20 books, 17 covers, 11 Markdown files; covers checked visually)
- [x] 3. Pure logic modules + tests: `src/web/lib/library-query.ts` (search normalization, filters, facets, sort, URL state), `src/web/lib/format.ts` (it-IT dates, authors, language names, counts, paragraphs, placeholder tone, book href); `test/web/library-query.test.ts`, `test/web/format.test.ts` — green (see 13)
- [x] 4. CSS foundation in `src/web/index.css`: paper/ink palette (light/dark tokens incl. `--brand`, status colours, cover shadows), base layer (focus-visible, selection, reduced motion), `.book-cover`, `.cover-placeholder` (6 tones), `.prose-book`
- [x] 5. `demoteHeadings` (`src/web/lib/html.ts`, `test/web/html.test.ts`)
- [x] 6. Data layer `src/web/data/site-data.ts` (index once, details on demand + cache, retry, HMR refetch, `refreshSiteData()` for W4a)
- [x] 7. Theme (`src/web/theme/theme.ts`, `components/theme-toggle.tsx`, inline script + bg style in index.html) (system default, toggle persisted, no-flash inline script in index.html)
- [x] 8. Routing (`App.tsx`, `routes/root-layout.tsx`, `routes/not-found-page.tsx`) (basename, `/`, `/book/:id/:slug?`, not found, scroll restoration, error element)
- [x] 9. Library page (`routes/library-page.tsx`, `components/library/*`) (grid, placeholder covers, filters, search, sort, count, clear, mobile sheet)
- [x] 10. Book page (`routes/book-page.tsx`) (cover, metadata, prose sections, canonical slug, back link with filters)
- [x] 11. Admin extension points (`src/web/admin/`, lazy, behind `__ELIB_ADMIN__`) + selection context
- [x] 12. Browser check (built-in browser, dev server on demo data): 375px light + dark, 768px, 1440px light + dark; grid, sheet, filters/facets, chips, search (accents, AND), sort, book pages (prose, table, blockquote, hr, recall card, section nav), back with filters + scroll restore (y=1800 restored), slug/case redirect, missing slug, unknown id/route 404s, theme toggle persisted + `theme-color`, admin bar + selection mode. No horizontal overflow at 375px.
- [x] 13. `tsc -b` 0, `oxlint` 0, own paths formatted (`oxfmt --check` clean), `pnpm test` 28 files / 259 tests green (42 in `test/web`), `pnpm build` OK; `elib-admin-bundle-7f3a9c` and other admin strings absent from `dist/` (no admin chunk at all). Demo-data build (to scratchpad) validates and emits 17 covers. Contrast computed: all text/background pairs ≥ 5.3:1 in both themes.

## Decisions

- Pure modules live in `src/web/lib/` and use relative imports (`../../shared/…`) so vitest resolves them without aliases.
  They import only zod-free shared modules (`labels.ts`, `slug.ts`, `text.ts`, types from `schema.ts`): zod stays out of the bundle.
- Search: `foldToAscii` (NFKD + strip marks + ß/æ/œ… folds) after NFD, lowercase, non-letters/digits → spaces; every word
  must be a substring of title + authors (AND, prefixes match while typing). Tags are not searched.
- Filters: topic single; statuses OR (a book has one status); tags AND, compared folded (case/accent-insensitive), shown with
  the most frequent spelling. Facet counts: each facet counts books matching every _other_ filter (tags: current result).
- URL: `?q=…&topic=…&tag=…&tag=…&status=…&sort=…`; canonical form omits empties and the default sort; statuses in enum order.
- Sort: `title` (it collator, default), `author` (surname via `authorSurname`), `recent` ("Letture recenti":
  `finishedAt ?? startedAt` desc, undated last by title).
- Demo data: deterministic IDs (seeded mulberry32 + `generateBookId`), written through the repo store (`writeBook`,
  `writeTopics`); refuses any target inside the repo; only replaces its own `books/<id>/` folders. Extra topics: `poesia`,
  `storia-politica`. One cover is 600×780 (tests object-fit), three books have no cover.
- Design: warm paper light theme / deep ink (blue-black) dark theme, single accent `--brand` (oxblood light, amber dark);
  covers get a spine gradient + hairline edge; placeholders are CSS cloth-bound volumes (6 tones by ID hash, container-query
  font sizes); notes in a serif `.prose-book` at ~66ch.

- Fixed during the 375px review: placeholder `container-type` moved to `.book-cover` (a container cannot query itself, cqi fell back to viewport units); sort trigger no min-width on phones; count `whitespace-nowrap`; masthead stats follow the selected topic; cached covers skip the fade-in; "Tutti gli argomenti" aligned with topic rows.
- Desktop review fixes: sidebar scroll box no longer overflows horizontally (thin scrollbar); `demoteHeadings` now maps the highest heading present to h3 (notes starting at `##` get h3/h4 instead of h4/h5).
- Filter rows are `aria-pressed` buttons (topic included), so the panel works the same in the sidebar and in the sheet.

- Bundle: one JS chunk, 513 kB min / 162 kB gzip (react-dom + react-router + Radix; no zod, no HMR code). Vite prints
  its >500 kB warning; not split (a manual vendor chunk would only move bytes around for a single-page app).
- Book page section order: "Da ricordare" (recall, as a tinted card) first, then "Appunti", then "Studio"; an
  "In questa pagina" nav appears when ≥ 2 sections exist. Rating is never shown (PLAN §17).
- Grid cards: cover `alt=""` (the link text already has title + author); book page cover has `alt="Copertina di …"`.
  "In lettura" pill on covers of books being read. Hover/focus prefetches the book detail.
- Back link: when the history state says we came from the grid, it does `navigate(-1)` (restores filters and scroll);
  otherwise it is a plain link to `/` + the saved query. Search text updates the URL debounced (250 ms), first keystroke
  pushes, the rest replace; filters push.
- JSON is fetched with `cache: "no-cache"` (revalidate via ETag) so a new Pages deploy shows up without waiting for max-age.

## Deviations

- `tsconfig.node.json`: added `"src/web/lib"` to `include` (one line). Without it `tsc -b` fails with TS6307 because
  `test/` (node project) imports the pure web modules. Those modules must therefore stay DOM-free and alias-free.
- `src/web/components/ui/sheet.tsx`, `dialog.tsx`: sr-only "Close" → "Chiudi" (Italian UI).

## Admin extension-point interface (for W4a)

Contract: `src/web/admin/types.ts` (type-only; public code never imports admin values).

- **Loading**: `src/web/admin-slots.tsx` does `if (__ELIB_ADMIN__) { lazy(() => import("./admin/index.tsx")) … }`. The
  module must satisfy `AdminModule` (checked by TS in `admin-slots.tsx`):
  - `adminRoutes: RouteObject[]` — relative to `/admin` (`index`, `upload`, `topics` stubs). Rendered by `AdminApp`.
  - `AdminApp()` — `useRoutes([...adminRoutes, admin 404])`; mounted by the public router at `admin/*` (only registered
    when `__ELIB_ADMIN__`, in `App.tsx`).
  - `LibraryAdminBar(props: { index: SiteIndex; visibleBooks: readonly BookCard[] })` — rendered on `/` between the
    count/chips row and the grid (`visibleBooks` = current filtered + sorted list, display order).
  - `BookAdminActions(props: { book: BookDetail; index: SiteIndex | undefined })` — rendered in the book page header,
    right of the title (stacked under it on phones), once the detail is loaded.
- **Marker**: `src/web/admin/marker.ts` `ADMIN_BUNDLE_MARKER = "elib-admin-bundle-7f3a9c"`, set as `data-elib-admin` on
  every admin root element. Keep it; check with `pnpm build && ! grep -r elib-admin-bundle-7f3a9c dist/`.
- **Selection** (`src/web/selection.tsx`): `useLibrarySelection()` → `{ enabled, selecting, selectedIds, setSelecting(on),
  toggle(id), setSelected(ids), clear() }`. `SelectionProvider` wraps the whole app only when `__ELIB_ADMIN__`
  (`routes/root-layout.tsx`), so selection survives navigation; public mode gets the inert default. `BookGrid` passes
  `selectable={selecting}`, `selected`, `onToggleSelect={toggle}` to each `BookCard`; a selectable card is a
  `<button aria-pressed>` with a check badge instead of a link. `setSelecting(false)` also clears the selection.
- **Data hooks** (`src/web/data/site-data.ts`): `useSiteIndex()` / `useBookDetail(id)` → `{ state, data, retry }`
  (`state.status`: idle | loading | ready (+`refreshing`) | not-found | error); `refreshSiteData()` refetches the index and
  every detail already requested, keeping current data on screen — **call it after every successful write** (the dev HMR
  event also triggers it when data/ changes, so it is mostly a belt-and-braces call); `loadIndex(force)`, `loadBook(id,
  force)`, `prefetchBook(id)`, `findCard(index, id)`, `topicLabel(index, topicId)`.
- Other reusable bits: `useDocumentTitle(title)`, `BookCover` (image or CSS placeholder), `StatusBadge`/`StatusDot`,
  `MessageState`/`ErrorState`, `useLibraryQuery()`; `bookHref(book)`, `formatAuthors`, `formatDate` in `@/lib/format`.
- Not provided: `TooltipProvider` and `<Toaster />` (sonner) are not mounted; W4a should mount them inside its own
  components or add them to `RootLayout` under `__ELIB_ADMIN__`.

## Log

- 2026-11-10: contracts read; pure modules + 37 tests green; demo-data script written and run; index.css palette/components written.
- 2026-11-10: cut off by API usage limit while writing CSS; resumed, progress file brought up to date.
- 2026-11-10: data layer, theme, routing, library/book/not-found pages, admin stubs + slots, selection context written; `tsc -b` clean. Next: browser check on demo data (port 5199).
- 2026-11-10: dev server `ELIB_DATA_DIR=/tmp/elib-demo-data pnpm exec vite --port 5199`; mobile light review done, fixes applied.
- 2026-11-10: dark + tablet + desktop review, fixes applied; all gates green; marker absent; dev server stopped. Done.
