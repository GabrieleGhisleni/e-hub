# R2b progress

- [x] R1-01 (isSafeUrl + link/image renderers; test/node/site-data/markdown.test.ts; CSP skipped unless time) markdown URL sanitising + tests
- [x] R1-06 (try/catch→next; test in dev.test.ts) dev middleware malformed URL + test
- [x] R1-09 (frozen baseline, notice, bookChangedSince + tests) edit form frozen baseline + notice + test
- [x] Bundle 1 (before 512.92 kB min/161.54 gzip single chunk; after first-load 399 kB min/127.7 gzip: react 218.75, router 98.39, ui 31.38, app 49.91, runtime 0.59; lazy filter-sheet 39.43/13.28): vendor chunks + chunkSizeWarningLimit
- [x] Bundle 2 (native select, segmented theme toggle, lazy filter sheet): native select, theme toggle, lazy filter sheet
- [x] Admin nits (proxy 500 also maps to network; proxy observed answering 502 here) (unsorted label, 2 comments, proxy 500)
- [ ] Verification (typecheck, lint, test, build, dist admin-free, browser)
