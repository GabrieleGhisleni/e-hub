# Brief — phase 8 (Transcriber) — model: opus

You are implementing **phase 8 (Transcriber)** of the e-podcasts project in /home/ggabry/projects/e-podcasts: the real audio → transcript pipeline, growing the phase-2 trial into a robust tool.

First read `docs/PROGRESS.md` ("Rules every subagent gets" — follow them strictly), `docs/progress/phase-2.md` (**measured numbers, working versions, API quirks**), `docs/progress/phase-3.md` (core API: transcript schema, `writeTranscript`, episode transcript fields, env vars), and `docs/DESIGN.md` §4.3, §7 (all, including §7.7 measurements and the revised §7.3), §14, §15 phase 8. The doc is in Italian.

Parallel agents: phase 4 (ingest: `src/core/ingest/`, `src/cli/episode.ts`) and phase 5 (frontend: `src/web/`) run at the same time and write to the real `data/`. Don't touch their files; do your end-to-end runs in a **temp data dir** (see below).

Keep `docs/progress/phase-8.md` updated as you go — especially during long runs (start time, what is running, where its output goes), so an interrupted session can resume. If it exists, continue from its checklist.

## You own

`transcriber/` (Python, uv; keep `trial/` as-is or move it under `transcriber/trial/` unchanged), `src/cli/transcribe.ts` (replace the stub), tests for both. A small helper in core (e.g. RSS enclosure matching) is fine if minimal and recorded.

## Decisions already taken (from the trial)

- Python **3.12** pinned; `av>=14,<17` (av 19 breaks faster-whisper 1.2.1). Versions that worked are in phase-2.md.
- **Sequential** `WhisperModel.transcribe` with VAD — **not** `BatchedInferencePipeline` (it dropped whole 30 s windows). `small.en`, `compute_type=int8`, CPU threads 8 by default, `--model` flag to choose another.
- `word_timestamps=True`; `initial_prompt` (and `hotwords` if it helps) with show name, host, guests.
- `diarize` on the **whole audio** (not per chunk), result cached so a resume doesn't redo it.

## Pipeline (DESIGN §7)

**TypeScript wrapper `pnpm transcribe <slug> [flags]`** (`src/cli/transcribe.ts`):

- Reads episode + show via core. Resolves the audio plan: the episode `youtubeId` (if any) and, as fallback, a **feed MP3** from the show's `feedUrl` (`<enclosure>`), matched by episode **number** if known, otherwise normalised title + `publishedAt` (±3 days). Unit-test the matching with a small synthetic RSS fixture.
- Calls the Python transcriber (`uv run --project transcriber …`) with a JSON job (paths, youtubeId, feed URL, names for the prompt, num speakers, flags), streams its progress to the terminal.
- Validates the produced transcript with the core Zod schema, writes it with core (`writeTranscript`), sets `transcriptSource: whisper-local` and `transcriptTimebase` on the episode.
- Flags: `--model`, `--num-speakers` (default 1 + number of guests, 2 if none), `--keep-audio`, `--diarizer diarize|pyannote`, plus a testing aid such as `--limit-minutes <n>` (transcribe only the first n minutes).

**Python (`transcriber/`)**:

1. **Audio chain**: `yt-dlp` audio-only on the `youtubeId` → `timebase: youtube`; if it fails or there's no id → feed MP3 → `timebase: feed`; else a clear error. Record `audio: {source, url}` in the transcript. yt-dlp is a uv dependency (not system). Audio in `data/audio/` (gitignored), converted to 16 kHz mono WAV with ffmpeg.
2. **Chunks of ~10 min** (ffmpeg) **only for transcription and resume**: finished chunks cached in a per-episode work dir (e.g. `data/cache/transcribe/<slug>/`); on relaunch, skip completed chunks. Offsets added back to the timestamps; handle words cut at chunk boundaries sensibly (e.g. small overlap + de-dup, or cut on VAD silence).
3. **Diarization** with `diarize` on the whole WAV, cached in the work dir. `--num-speakers`. Optional `--diarizer pyannote` as plan B: an optional dependency group/extra, needs `HF_TOKEN`; implement it but if it's not installed/configured, fail with a clear message (don't install pyannote by default).
4. **Speaker assignment**: each word gets the speaker it overlaps most; split Whisper segments where the speaker changes. Names: "first speaker = host" (host name from the show), others = guests in order of appearance, generic labels if more speakers than names.
5. **Output** in the unified format (§4.3; exact schema in phase-3.md): segments `{speaker, start, text}`, no chapters, `timebase`, `audio`.
6. **Delete the audio** (and the chunk WAVs) at the end unless `--keep-audio`; keep the small JSON caches until success, then clean up the work dir (keep the diarization cache only if `--keep-audio`, or document your choice).

## Done when (record evidence, with load averages next to timings)

- A **real ~2 h English podcast episode** with 2–3 speakers (on YouTube) is transcribed end-to-end **within ~30 min**; record the measured times (download, ASR, diarization, total) in your report **and** in DESIGN.md §7.7 (append a short "fase 8" line/table in Italian — only that subsection). Run it in a temp data dir: create the show/episode there through core (e.g. `E_PODCASTS_DATA_DIR=<tmp> pnpm episode add <url> --no-feed --yes` if phase 4 has landed, otherwise via core functions in a small script), so you don't collide with the parallel agents. Run long jobs in the background and log to a file.
- **Interrupt and relaunch**: kill the run mid-transcription; relaunching resumes from the next chunk **without redoing diarization** (show the log lines).
- **Speakers stay consistent** for the whole episode (spot-check several points across the 2 h, e.g. compare with the video or with an official transcript if you pick a Lex episode that has one — that also gives a WER).
- Feed fallback path exercised once (e.g. an episode without youtubeId, with `--limit-minutes 3`), producing `timebase: feed`.
- Tests: TS (feed matching, job building, validation/writing via core with a fake Python output) and Python (speaker assignment, segment splitting, chunk offset/boundary handling, resume logic) — fast, offline.
- Audio deleted after the runs (`data/audio/` empty).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` pass; Python tests pass with one documented command.

Do not commit. Final message: concise summary, measured numbers, flags, known limitations, notes for phase 9 (how the skill should launch it in the background).
