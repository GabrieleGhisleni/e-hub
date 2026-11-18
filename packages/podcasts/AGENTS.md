# e-podcasts — agent conventions

Personal reading log for podcast episodes: a summary, notes and tags per episode, the transcript and your conversations about it. Full design: `docs/DESIGN.md` (Italian; §4 data, §5 write path, §10 skills). Read the section you touch.

## Data layout

- **In git** (public repo, published to GitHub Pages): `data/shows/`, `data/episodes/`, `data/conversations/`, `public/shows/` (show images).
- **Local only, gitignored**: `data/transcripts/` (third-party transcript text, copyrighted), `data/audio/` (temporary), `data/cache/` (clones and indexes).
- Why: the repo is public and transcripts are not ours to publish. `pnpm check:tracked` fails the CI build if a local path is tracked.
- `data/` is excluded from the formatter. Do not format it.

## Write point

- All writes go through the CLI (`pnpm episode add`, `pnpm episode save`), which the dev UI also uses through the same core.
- Never edit `data/**/*.json` by hand. Validation, slugs, timestamps and the transcript guard live in `src/core`.
- Tests and experiments: set `E_PODCASTS_DATA_DIR` (and `E_PODCASTS_PUBLIC_DIR` for show images) to a temp copy. Never write to the real `data/` for a test.

## Output format for `episode save`

Input is a JSON object (file, or `--input -` for stdin). Every field is optional. Present fields overwrite; absent fields stay unchanged.

```json
{
  "summary": [
    "Machines reportedly solved several long-standing math problems.",
    "Mathematicians react with a mix of awe and worry."
  ],
  "notes": "Markdown notes, paraphrased, with [HH:MM:SS] timestamps for the key moments.",
  "tags": ["mathematics", "ai", "proof-verification"],
  "guests": ["Steven Brunton"]
}
```

- `summary`: 0 to 10 strings, up to 500 characters each. Short key points, typically 3 to 5.
- `notes`: free-form markdown, up to 200 000 characters. Paraphrase; quotes under 20 words.
- `tags`: English, lowercase, kebab-case (`sleep`, `machine-learning`), up to 40 characters, no duplicates. Run `pnpm tags` for the existing ones and reuse them. The list is not copied here, so it cannot go stale.
- `guests`: names, no duplicates. Add only missing ones.
- `conversations` (optional): `[{ "agent": "claude", "markdown": "...", "date": "YYYY-MM-DD" }]`. Appended; the same markdown is never stored twice.

Pass `--expected-updated-at <updatedAt>` with the `updatedAt` you read from the episode file at the start. Exit 5 means someone else saved in the meantime: re-read and ask the user.

## Language

- UI strings: Italian. Code, identifiers, comments, commit messages: English.
- Notes: free (usually English). Tags: English, lowercase.

## Quotations

- Quote the transcript in at most 20 consecutive words. Paraphrase the rest and cite timestamps.
- The transcript guard rejects longer runs in summary and notes (exit 6) and removes them from conversations.

## Commands

| Command                                                                  | Purpose                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `pnpm test`                                                              | Vitest                                                                    |
| `pnpm typecheck`                                                         | TypeScript checks for web, web tests and node code                        |
| `pnpm lint` / `pnpm lint:fix`                                            | oxlint                                                                    |
| `pnpm format` / `pnpm format:check`                                      | oxfmt (format only your own files; never the whole repo when others work) |
| `pnpm check:tracked` / `pnpm check:bundle`                               | CI guards: no local data tracked, no dev-only code in the bundle          |
| `pnpm episode add <url> [--added-at D] [--feed U \| --no-feed] [--json]` | Add an episode (and its show if new)                                      |
| `pnpm episode save <slug> --input <file\|-> [--expected-updated-at T]`   | Apply summary/notes/tags/guests/conversations                             |
| `pnpm tags [--json]`                                                     | Existing tags with episode counts (read-only)                             |
| `pnpm transcript export <slug> [--out f]`                                | Whole transcript as compact markdown for an agent (read-only)             |
| `pnpm transcribe <slug> [--model M] [--force] [--keep-audio]`            | Whisper via Groq (needs `GROQ_API_KEY`, `ffmpeg`, `yt-dlp`); no speakers; resumes if re-run |

Exit codes for `episode` commands: 0 ok, 1 unexpected, 2 usage, 3 validation, 4 not found, 5 conflict, 6 transcript guard, 7 duplicate, 8 already exists. `pnpm episode add` without a TTY and without `--feed` or `--no-feed` exits 2 for a new show: ask the user which feed to confirm, never choose it yourself.

## Skills

- `/add-episode <url>` (`.claude/skills/add-episode/`): add, feed choice, optional local transcription.
- `/podcast-notes <slug>` (`.claude/skills/podcast-notes/`): transcript-based Q&A, then a draft saved only after the user's OK.
