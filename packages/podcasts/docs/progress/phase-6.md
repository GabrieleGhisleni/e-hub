# Phase 6 — Deploy / CI

Status: done (nothing committed; publishing to GitHub is a manual step, see the end)

## Checklist

- [x] `scripts/check-tracked.ts`: fails (exit 1, lists files) if `git ls-files` has anything under `data/transcripts/`, `data/audio/`, `data/cache/`; optional repo dir argument; exit 2 if git fails
- [x] `scripts/check-bundle.ts`: fails (exit 1) if `dist/` has a `assets/slots-*.js` chunk, or any file contains `e-podcasts-dev-only`, `devFeatures`, or a `/api/` string literal (`["'\x60]/api/`); also fails if the dir is missing or has no `index.html`; optional dist dir argument
- [x] `package.json`: `check:tracked` and `check:bundle` scripts (minimal edit)
- [x] `.github/workflows/deploy.yml`: push to `main` + `workflow_dispatch`; build job (checkout, pnpm/action-setup, setup-node with `.node-version` and pnpm cache, `pnpm install --frozen-lockfile`, lint, format:check, typecheck, test, check:tracked, build, check:bundle, configure-pages, upload-pages-artifact `dist`); deploy job (`environment: github-pages`, deploy-pages); permissions `contents: read` (workflow), `pages: write`, `id-token: write` (deploy job); `concurrency` group `pages`
- [x] Action versions (latest releases checked with `gh api`): checkout v7, setup-node v7, pnpm/action-setup v6, configure-pages v6, upload-pages-artifact v5, deploy-pages v5
- [x] pnpm version: not set in the workflow; `pnpm/action-setup@v6` reads `devEngines.packageManager` (`^11.18.0`) from `package.json`, as the brief asks
- [x] Workflow YAML parses (`yaml` package); the run steps are the same commands, in the same order, as run locally below
- [x] Own files formatted with `oxfmt`
- [ ] Publishing (repo public, push, Pages source = GitHub Actions): manual, needs the user's OK

## Evidence

### `pnpm check:tracked` on this repo

Nothing is committed yet, so the index is empty and the check passes with 0 files:

```
$ tsx scripts/check-tracked.ts
check:tracked: ok (0 tracked file(s) checked, none under data/transcripts/, data/audio/, data/cache/)
exit=0
```

### `check:tracked` fails on a throwaway repo

A temp repo in the session scratchpad (outside the project) with `data/transcripts/lex.json` staged (`git add`, no commit, nothing in this project's repo touched):

```
$ tsx scripts/check-tracked.ts <scratchpad>/tracked-demo
check:tracked: 1 local-only file(s) are tracked by git (must never be in the repo, DESIGN.md §2.4):
  - data/transcripts/lex.json
Remove them from the index with: git rm --cached <file>
exit=1
```

Not a repo (exit 2): `check:tracked: git ls-files failed in <scratchpad> ... fatal: not a git repository`.

### `pnpm build && pnpm check:bundle` on the real build

```
$ pnpm build        -> exit 0 (dist/index.html, assets/index-*.js, markdown-*.js, index-*.css; 404.html)
$ pnpm check:bundle
check:bundle: ok (8 file(s) in .../dist, no local-only markers)
exit=0
```

### `check:bundle` fails on a bad bundle

1. Copy of `dist/` with `e-podcasts-dev-only` and `fetch("/api/notes")` appended to the main JS, plus a new `assets/extra.js` with `` `/api/episodes` ``:

```
$ pnpm check:bundle <scratchpad>/dist-injected
check:bundle: local-only code found in <scratchpad>/dist-injected (DESIGN.md §11):
  - assets/extra.js: contains a "/api/" string literal (local server)
  - assets/index-BpzM4QZY.js: contains dev-only marker "e-podcasts-dev-only"
  - assets/index-BpzM4QZY.js: contains a "/api/" string literal (local server)
exit=1
```

2. Realistic case from phase 5: a development-mode build (`NODE_ENV=development pnpm exec vite build --mode development --outDir <scratchpad>/dist-dev2`). Without `NODE_ENV=development` the dev chunk is not emitted (Vite drops the `import.meta.env.DEV` branch), so that variant passes; with it, the output contains `assets/slots-*.js`:

```
$ pnpm check:bundle <scratchpad>/dist-dev2
check:bundle: local-only code found in <scratchpad>/dist-dev2 (DESIGN.md §11):
  - assets/index-D88gizVJ.js: contains identifier "devFeatures"
  - assets/slots-CzDyj8pL.js: dev-only chunk (assets/slots-*.js)
  - assets/slots-CzDyj8pL.js: contains dev-only marker "e-podcasts-dev-only"
exit=1
```

Also `check:bundle` on a missing dir exits 1 (`... is not a directory (run pnpm build first)`).

### Workflow steps run locally, in order

Run in this project, and also in a clean copy without `dist/`, `node_modules/`, `data/transcripts`, `data/audio`, `data/cache` (simulates CI):

| Step                             | This project                 | Clean copy (CI simulation) |
| -------------------------------- | ---------------------------- | -------------------------- |
| `pnpm install --frozen-lockfile` | exit 0                       | exit 0                     |
| `pnpm lint`                      | exit 0                       | exit 0                     |
| `pnpm format:check`              | **exit 1** (see below)       | **exit 1** (same files)    |
| `pnpm typecheck`                 | exit 0                       | exit 0                     |
| `pnpm test`                      | exit 0 (21 files, 226 tests) | exit 0                     |
| `pnpm check:tracked`             | exit 0                       | exit 0                     |
| `pnpm build`                     | exit 0                       | exit 0                     |
| `pnpm check:bundle`              | exit 0                       | exit 0                     |

`pnpm format:check` fails on two files that are not owned by this phase, so the workflow would stop at that step today:

- `docs/PROGRESS.md` (orchestrator file)
- `transcriber/pyproject.toml` (phase 8 file)

Fix with `pnpm exec oxfmt docs/PROGRESS.md transcriber/pyproject.toml` once those owners are done (not touched here). Every file of phase 6 passes `oxfmt --check`.

YAML: `node -e` with the `yaml` package parses `.github/workflows/deploy.yml`; jobs `build` and `deploy`, `concurrency.group: pages`, `deploy.environment.name: github-pages`. actionlint is not installed here, so no further workflow lint.

## Deviations and notes

- Action versions are the latest majors (`gh api repos/<action>/releases/latest` on the date of the run). pnpm/action-setup v6 reads the pnpm version from `devEngines.packageManager`, so no `version` input is needed.
- The `check:bundle` markers come from the phase 5 report. The `/api/` check is a string-literal regex, not a bare `/api/`, as phase 5 recommends.
- `check:bundle` reads files as latin1 so binary files (webp) do not break the scan.
- `check:tracked` lists paths with `git ls-files --full-name` (repo-relative), so it works when the repo dir is passed explicitly.
- Nothing was committed. Nothing in this project's git state was touched (the throwaway repo is in the session scratchpad).

## Manual steps for the user (publishing)

Not done here: needs the user's OK. In order:

1. On GitHub, create a **public** repository named `e-podcasts` (the site base is `/e-podcasts/`, so the name must match). Public is required for Pages on the free plan (DESIGN.md §2.3).
2. Locally, after checking `git status` (no `data/transcripts/`, `data/audio/`, `data/cache/` in the list), make the first commit on `main`, add the GitHub remote, and push.
3. On GitHub: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
4. The push to `main` starts the "Deploy" workflow (or run it from Actions → Deploy → Run workflow). The site will be at `https://<your-user>.github.io/e-podcasts/`.
5. Before step 4 succeeds, `pnpm format:check` must pass (see the two files above).

## Notes for later phases

- Phase 7 must keep `DEV_ONLY_MARKER` (`e-podcasts-dev-only`) in `src/web/dev/slots.tsx` and the `import.meta.env.DEV` guard in `src/web/dev-slot.tsx`; the check depends on them.
- `docs/PROGRESS.md` still lists phase 6 as "in progress" and the waiting-on-user item; the orchestrator should update it.
