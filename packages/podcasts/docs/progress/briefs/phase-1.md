# Brief — phase 1 (Foundations) — model: sonnet

You are implementing **phase 1 (Foundations)** of the e-podcasts project in /home/ggabry/projects/e-podcasts.

First read `docs/PROGRESS.md` (especially "Rules every subagent gets" — follow them strictly) and `docs/DESIGN.md` §3, §3.1, §8.1, §8.2, §9, §13 and §15 phase 1 (the design doc is in Italian). Another agent may be working in parallel on `transcriber/` (Python, phase 2) — do not touch `transcriber/` or `docs/DESIGN.md`.

Keep `docs/progress/phase-1.md` updated as you go (checklist of done/remaining, verification commands and results, deviations, notes for later phases). If it already exists, continue from its checklist instead of redoing finished items.

## What to build

1. Single pnpm package, TypeScript, ESM. `engines.node` pinned to the current LTS major (26). Add `.node-version`.
2. Vite + React + Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui, SPA. `index.html` at the repo root, entry `src/web/main.tsx`. Vite `base: '/e-podcasts/'`. Light/dark theme follows the system, shadcn CSS variables.
   - Aliases (tsconfig + Vite + Vitest): `@/*` → `src/web/*`, `@core/*` → `src/core/*`. Node-side code uses relative imports.
   - shadcn init (`components.json`, `src/web/lib/utils.ts`, `src/web/components/ui/`) with: button, input, textarea, label, badge, separator, collapsible, dialog, select, popover, command, tooltip, sonner, skeleton, toggle-group, scroll-area, alert, tabs.
3. Hono app in `src/server/index.ts`, mounted in the Vite dev server with `@hono/vite-dev-server` (one process, `pnpm dev` = `vite`). Handles only `/api/*`; `GET /api/health` → `{ ok: true }`. Never in the production build. Localhost only.
4. Pre-install deps for later phases: zod, minisearch, hono, react-router v7, react-markdown, remark-gfm, cheerio, yaml, fast-xml-parser, sharp, tsx, vitest, jsdom, @testing-library/react, @testing-library/jest-dom, @types/node. Approve pnpm 11 build scripts (sharp, esbuild) properly and verify sharp loads.
5. TS configs: web with DOM libs, node code with Node types; `pnpm typecheck` covers everything.
6. Vitest (node env by default, jsdom per file). One smoke test.
7. Skeleton dirs (`.gitkeep`): `src/core/`, `src/server/`, `src/cli/`, `src/web/`, `data/shows/`, `data/episodes/`, `data/conversations/`, `public/shows/`, `tests/fixtures/`, `scripts/`.
8. Scripts: `dev`, `build`, `preview`, `test`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `episode`/`tags`/`transcript`/`transcribe` → `tsx src/cli/<name>.ts` (stubs: print "not implemented yet", exit 1; args must pass through).
9. oxlint `react` plugin; oxfmt/oxlint ignore patterns for generated output.
10. Minimal `src/web/App.tsx` (heading + shadcn Button).

## Done when

- `pnpm dev` serves `/api/health` → `{"ok":true}` and `/e-podcasts/` → app HTML (start in background, verify with curl, kill it).
- `pnpm build` succeeds, no server code in `dist/`.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` pass.

Do not commit. Final message: concise summary, key versions, alias/tsconfig layout, deviations, notes for later phases.
