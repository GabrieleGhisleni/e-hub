# Brief — phase 6 (Deploy / CI) — model: haiku

You are implementing **phase 6 (Deploy / CI)** of the e-podcasts project in /home/ggabry/projects/e-podcasts. Small, well-defined task: a GitHub Actions workflow plus two check scripts.

First read `docs/PROGRESS.md` ("Rules every subagent gets" — follow them strictly), `docs/progress/phase-1.md` and `docs/progress/phase-5.md` (build output, post-build step, and **what the bundle check should grep for**), and `docs/DESIGN.md` §2.3, §2.4, §11 and §15 phase 6.

Keep `docs/progress/phase-6.md` updated as you go. If it exists, continue from its checklist.

## You own

`.github/workflows/deploy.yml`, `scripts/check-tracked.ts` (or `.sh`), `scripts/check-bundle.ts` (or `.sh`), and two new `package.json` scripts: `check:tracked`, `check:bundle` (minimal edit to `package.json`).

## What to build

1. **`check:tracked`**: fails (exit 1, clear message listing the files) if `git ls-files` returns any file under `data/transcripts/`, `data/audio/` or `data/cache/`. Accept an optional repo path/cwd so it can be tested.
2. **`check:bundle`**: after `pnpm build`, fails if `dist/` contains code of the local-only features: grep the built files for markers such as `/api/` calls and the other markers phase 5's report lists (e.g. strings unique to `src/web/dev/`). Accept the dist path as an argument so it can be tested on a fake dir.
3. **Workflow** `.github/workflows/deploy.yml`, on push to `main` (+ `workflow_dispatch`):
   - checkout; `pnpm/action-setup` (pnpm version from `package.json`); `actions/setup-node` with `node-version-file: .node-version` and pnpm cache; `pnpm install --frozen-lockfile`;
   - `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm check:tracked`, `pnpm build`, `pnpm check:bundle`;
   - `actions/configure-pages`, `actions/upload-pages-artifact` (path `dist`), `actions/deploy-pages` in a separate `deploy` job with `environment: github-pages`; permissions `contents: read`, `pages: write`, `id-token: write`; a `concurrency` group for pages.
   - Use current major versions of the actions.
   - No Python, no network-dependent tests.

## Done when (record evidence)

- `pnpm check:tracked` passes on this repo, and **fails** on a throwaway git repo created in a temp dir (outside this project) that tracks a file in `data/transcripts/` — show both outputs. Do not stage or commit anything in this project's repo.
- `pnpm build && pnpm check:bundle` passes, and `check:bundle` **fails** on a temp copy of `dist/` with a marker injected — show both outputs.
- The workflow YAML parses (e.g. `node -e` with the `yaml` package) and every step it runs works locally in the same order.
- Creating the GitHub repo, pushing and enabling Pages are **not** your job (they need the user's OK): just write in your report the exact steps the user must do (repo must be public; Settings → Pages → Source: GitHub Actions).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` pass.

Do not commit. Final message: concise summary + the user's manual steps.
