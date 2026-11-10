# Phase 1 — Foundations (done)

## Checklist

- [x] package.json (ESM, `engines.node` ">=26 <27", `.node-version` = 26)
- [x] deps installed; esbuild build script approved via `pnpm-workspace.yaml` (`allowBuilds`); sharp loads (vips 8.18.7, webp ok)
- [x] Vite 8 + React 19 + Tailwind 4.3 (`@tailwindcss/vite`) + shadcn (new-york, neutral, 18 requested components + toggle)
- [x] Hono mounted via `@hono/vite-dev-server` (dev only; `/api/*` only; `GET /api/health`)
- [x] tsconfigs (`tsconfig.web.json`, `tsconfig.node.json`, root solution file) + `pnpm typecheck`
- [x] Vitest (node env) + `tests/smoke.test.ts`
- [x] skeleton dirs with `.gitkeep`; CLI stubs (exit 1, "not implemented yet"); pnpm scripts
- [x] oxlint (react, jsx-a11y, import plugins) / oxfmt ignore patterns
- [x] `src/web/App.tsx` (heading + Button)

## Verification

- `pnpm dev` (port 5173/5174 were taken by other processes, Vite picked 5175): `curl /api/health` -> `{"ok":true}`; `/e-podcasts/` -> app HTML; `/e-podcasts/src/web/main.tsx` -> 200 (Vite); `/api/nope` -> 404 from Hono. Vite listens on 127.0.0.1 only. Process killed afterwards.
- `pnpm build` OK; `grep -rliE "hono|/api/health" dist` -> nothing.
- `pnpm episode add foo --added-at 2024-01-01` forwards args (checked with `process.argv` print, then stub cleaned).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` all pass.

## Deviations

- TypeScript 7.0.2 (native compiler) and Vite 8 (rolldown) are what pnpm resolved; works as-is. No `baseUrl` (removed in TS 7): `paths` are relative to the tsconfig.
- react-router pinned to ^7 (v8 is the npm latest).
- `typecheck` = two `tsc --noEmit -p` runs (no `tsc -b`, no composite).
- Server plugin only registered for `vite serve` (not build). Vite `exclude` regex `/^(?!\/api\/).*/` so Hono sees only `/api/*`. `injectClientScript: false`.
- shadcn CLI wrote files to a literal `@/` dir and used `"cn"` import: moved to `src/web/components/ui/` and fixed imports to `@/lib/utils`. `sonner.tsx` no longer uses `next-themes` (removed dep); uses `theme="system"`.
- Dark mode: no `.dark` class; `@custom-variant dark` is a `prefers-color-scheme` media query and the CSS variables are redefined in a media query (`src/web/index.css`).
- `public/shows/.gitkeep` is copied into `dist/shows/` by Vite (harmless).

## Notes for later phases

- Aliases: `@/*` -> `src/web/*`, `@core/*` -> `src/core/*` (tsconfig.web/node `paths`, Vite, Vitest). Node-side code uses relative imports.
- `tsconfig.web.json` includes only `src/web` (DOM libs, `vite/client`, no Node types); `tsconfig.node.json` includes core/server/cli/tests/scripts + root configs (Node types, no DOM). Web code importing `@core/...` gets type-checked under the web config: a core file importing `node:fs` fails the web typecheck, so keep browser-safe modules (schema, types) free of Node imports (e.g. separate `src/core/schema.ts` from `store.ts`).
- Component tests needing DOM types/jest-dom: tests are checked under the node tsconfig (no DOM lib); add a separate tsconfig or `/// <reference lib="dom" />` when the first one lands. Use `// @vitest-environment jsdom`.
- Vitest `include`: `tests/**/*.test.{ts,tsx}` and `src/**/*.test.{ts,tsx}` (the latter is excluded from web typecheck).
- `TooltipProvider` must wrap the app when using tooltips; `<Toaster />` from `@/components/ui/sonner`.
- Router: `<BrowserRouter basename={import.meta.env.BASE_URL}>`.
- Extra deps added for shadcn: radix-ui, cmdk, sonner, lucide-react, class-variance-authority, clsx, tailwind-merge, tw-animate-css.
- Don't use `pkill -f vite`: other agents' dev servers may run; kill by PID.
