# W2c — Site data, Vite data plugin, 404.html, validate:data

Status: done (started 2026-11-10)

## Checklist

- [x] 1. src/shared/site-urls.ts
- [x] 2. src/node/site-data/ (build.ts, markdown.ts, validate.ts, validate-cli.ts, index.ts)
- [x] 3. src/node/vite/ plugin + wiring in vite.config.ts
- [x] 4. Tests: site-data, validate, vite build integration
- [x] 5. PROGRESS.md "Site data" subsection
- [x] 6. typecheck / lint / format / tests / validate:data / build

## Decisions

- Raw HTML inside Markdown is escaped (not passed through) so published HTML cannot carry scripts/handlers.
- Tests: test/node/site-data (build, validate, urls), test/node/vite (real programmatic `build()` + dev server middleware). All pass.
- Only repo-wide failures left are in W2a files (covers lint no-control-regex, covers test sharp namespace type).
- Dist output of `pnpm build` verified: data/index.json, 404.html identical to index.html.
