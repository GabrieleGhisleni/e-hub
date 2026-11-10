# Phase 8 — Transcriber

Status: done (nothing committed)

## Checklist

- [x] uv project made a package: `transcriber/pyproject.toml` (uv_build, module `epod_transcriber`), deps `yt-dlp[default]` (adds `yt-dlp-ejs` for YouTube JS challenges), dev `pytest`, optional extra `pyannote` (locked, not installed); `uv.lock` updated, pinned versions unchanged (torch 2.8.0, av 16.1.0, faster-whisper 1.2.1, diarize 0.1.2)
- [x] Python package `transcriber/src/epod_transcriber/`: `job.py` (job JSON), `audio.py` (yt-dlp → feed → error, 16 kHz WAV), `chunks.py` (plan, quietest-point cuts, pad + midpoint dedup), `asr.py` (sequential faster-whisper + VAD), `diarization.py` (diarize; pyannote plan B with clear error), `speakers.py` (word → speaker, split, host heuristic + cold-open refinement, names), `pipeline.py` (resume via param-keyed caches), `util.py` (log, atomic JSON, run lock), `cli.py` + `__main__.py` (entry, exit codes)
- [x] Python tests (`transcriber/tests/`: chunks, speakers, pipeline resume with fakes, job/CLI): 38 passing, `cd transcriber && uv run pytest` (0.3 s)
- [x] Python smoke run, 3 min of the test episode (scratch dir): download 91 s (section download, slow → changed to full download + `-t`), diarize 13 s, ASR 15.5 s (RTF 0.086); cold open detected (`intro-mention`), audio deleted
- [x] TS wrapper `src/cli/transcribe.ts` + `src/cli/transcribe/{feed-audio,job,finish,run}.ts` (reuses ingest's `parseFeed`/`fetchFeed`/`createHttp`/`normalizeTitle`/`episodeNumberFromTitle`; no core change)
- [x] TS tests `tests/transcribe/{feed-audio,run,cli}.test.ts` (20): feed matching on a synthetic RSS, job building, validation/writing via core with a fake Python output, failure/resume/force/no-audio paths, CLI usage exit codes
- [x] short end-to-end run via `pnpm transcribe` (temp data dir seeded through core by a small tsx script): `--limit-minutes 4 --keep-audio` → 58 s total (YouTube full download 73.8 MB in 16 s, diarize 16 s, ASR 21 s RTF 0.088), cold open → `intro-mention`, WAV + `diarization.json`/`state.json` kept; re-run without `--force` → exit 8; with `--force` → "audio: reusing … / diarization: cached, skipping", ASR redone, audio deleted
- [x] feed fallback run: episode #479 (Dave Plummer) created **without** youtubeId and number → feed item matched by **title-date**, ffmpeg streamed 3 min of the MP3 in 9.7 s, `timebase: feed`, `audio.source: feed`, episode `transcriptTimebase: feed`, audio deleted
- [x] full ~2 h run (Lex #495, 2:03:23 of audio), uninterrupted, started 12:33:50, finished 12:53:38 → **19 min 48 s** end-to-end (`pnpm transcribe` wall time; log `<scratch>/phase8/full-run.log`):

  | Step                                                            | Time                                                | RTF   | Load average (1 min)         |
  | --------------------------------------------------------------- | --------------------------------------------------- | ----- | ---------------------------- |
  | YouTube download (73.8 MB, opus 80 kbps)                        | 114.6 s (16–20 s in earlier runs: network variance) | —     | 0.5–0.7                      |
  | Conversion to 16 kHz mono WAV                                   | 7.9 s                                               | —     | 0.7                          |
  | Chunk plan (12 chunks of ~10:16)                                | < 1 s                                               | —     | 0.7                          |
  | `diarize`, whole file, 2 speakers (624 turns)                   | 401.8 s (6.7 min)                                   | 0.054 | 0.7 → 3.2                    |
  | ASR `small.en` int8, 8 threads, 12 chunks (+30 s left pad each) | 660.9 s (11.0 min), 47.8–63.7 s per chunk           | 0.089 | 7.9–11.1 (other agents busy) |
  | Merge (speaker per word, split, names)                          | 0.03 s                                              | —     | 11.0                         |
  | **Total** (Python 1185 s + TS/feed/uv overhead 3 s)             | **19 min 48 s**                                     |       |                              |

  Result: 1630 segments, 18 864 words (Lars Brownworth 12 136, Lex Fridman 6 728), host detection `intro-mention` (cold open handled), audio deleted, work dir removed.

- [x] quality vs the official transcript (`transcriber/tools/evaluate.py`, output `<scratch>/phase8/full-run-eval.json`): **WER 7.1%** (19 565 ref words; 452 sub, 806 del, 138 ins); longest run of missing words 15 (at 103.6 min, not at a cut; all chunk boundaries clean after the left-pad fix); **speaker accuracy by name 99.37%** on 18 307 aligned words (Lars→Lex 62, Lex→Lars 54).
- [x] speakers consistent for the whole episode: per-10-min accuracy 0.999, 0.996, 0.997, 0.992, 0.992, 0.997, 0.994, 0.990, 0.992, 0.990, 0.994, 0.989, 0.996 (no window flips). Spot checks at 1:20, 2:20, 15:20, 33:20, 47:20, 62:20, 78:20, 104:20, 117:20, 122:20 match the official speaker; 91:20 differs only because the official turn starts at 91:19 and ours at 91:20.4.
- [x] graceful stop: `kill -TERM <pid in lock>` during ASR → "interrupted: finished chunks and the diarization are cached…", lock released, `pnpm transcribe` exit 130 in ~1 s; relaunch: `resume: found cached work` / `audio: reusing …` / `diarization: cached (77 turns), skipping` → finished (logs `<scratch>/phase8/sigterm-run{1,2}.log`).
- [x] interrupt + resume, on `--limit-minutes 30` (3 chunks; logs `<scratch>/phase8/interrupt-run{1,2}.log`): killed the Python process (`kill -TERM $(cat <work dir>/lock)`) during chunk 2 → TS printed "transcriber failed (exit 143); progress is cached in … run the same command again to resume". Relaunch:
      `resume: found cached work, continuing` / `audio: reusing …wav (30:00)` / `diarization: cached (114 turns), skipping` / `asr: chunk 1/3 [0:00–9:46] cached, skipping` / `asr: chunk 2/3 … 54.9s` / `asr: chunk 3/3 … 54.2s` → saved, audio deleted, work dir removed. Finding: `kill` of the background **pnpm** pid (SIGTERM or SIGINT) does **not** reach the children (pnpm runs the script in its own process group and does not forward); the Python pid in the lock file is the handle to stop a run.
- [x] **bug found and analysed** on that 30-min output (WER 7.5%, speaker accuracy 99.7%): an 87-word deletion run exactly at the chunk-3 start (19:42). Reproduced in isolation: starting a chunk mid-speech **with the initial_prompt** makes faster-whisper skip the whole first 30 s window (no prompt: fine; start 5–30 s earlier: fine; prompt + previous chunk's text: fine). Fix: 30 s left padding per chunk (one Whisper window; the midpoint rule still drops the overlap). Cost ≈ +5% ASR.
- [x] DESIGN §7.7: "Fase 8 — episodio intero" paragraph + table appended (only that subsection)
- [x] `data/audio/` empty (repo and temp dir; no `data/cache/transcribe/` left); `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (179 files clean), `pnpm test` (26 files, 286 tests) pass; Python: `cd transcriber && uv run pytest` → 38 passed; `uv lock --check` OK

## Long run (2 h) — done; kept for reference

- Scratch dir: `/tmp/claude-1000/-home-ggabry-projects-e-podcasts/cdeb34be-7334-4319-a078-4f5c03d0ed2d/scratchpad/phase8` (= `<scratch>/phase8`); temp data dir `<scratch>/phase8/data` seeded by `<scratch>/phase8/seed.mts` (show lex-fridman + episodes #495 and #479 via core).
- Command (started 2026-11-10 12:33, load average before: 0.61 0.44 0.32):
  `cd /home/ggabry/projects/e-podcasts && E_PODCASTS_DATA_DIR=<scratch>/phase8/data nohup pnpm transcribe lex-fridman-495-vikings-ragnar-berserkers-valhalla-the-warriors-of-the-viking --force > <scratch>/phase8/full-run.log 2>&1 &`
- Log: `<scratch>/phase8/full-run.log`. Work dir: `<scratch>/phase8/data/cache/transcribe/lex-fridman-495-…/` (lock = Python pid).
- If interrupted: run the same command again (it resumes); the timing evidence then has to be summed from both logs.
- Afterwards: `uv run --project transcriber python transcriber/tools/evaluate.py <scratch>/phase8/data/transcripts/lex-fridman-495-….json <scratch>/phase8/feed/lars-brownworth-ref.json` (reference = official transcript parsed by `trial/reference.py`).

## Test episode

Lex Fridman Podcast #495 (Lars Brownworth, Vikings), YouTube `iKx3gAODybU` (7403 s = 2 h 03 min), official transcript
https://lexfridman.com/lars-brownworth-transcript (2 speakers; **opens with a cold-open clip of the guest**, so it also
exercises the host heuristic). Reference parsed with `transcriber/trial/reference.py` into the scratch/temp dir only.

## Decisions and deviations

- yt-dlp format `ba[language_preference>=10][abr<=96]/ba[abr<=96]/ba`: the test video also carries a Russian **dubbed** audio track; this picks the original language. `--js-runtimes node` when node is on PATH (always, under pnpm) + `yt-dlp-ejs`: full 74 MB download in 20 s.
- Chunks are read in memory from the 16 kHz WAV (exact sample offsets) instead of separate ffmpeg chunk WAVs: same resume semantics, no chunk files to clean up. Cuts are moved to the quietest 0.5 s within ±30 s of each nominal ~10 min boundary; each chunk is transcribed with **30 s before / 2 s after** of padding and only words whose midpoint is in the chunk's own range are kept (no duplicates; the 30 s guards against faster-whisper skipping the first window of a chunk that starts mid-speech, see checklist).
- Order: audio → diarization (whole file, cached) → ASR chunks (cached) → merge, so killing during ASR never loses the diarization.
- Host heuristic: "first speaker = host", refined: if within the first 10 min someone says a guest's surname, the first such speaker is the host (cold opens with a guest clip). Recorded in `extra.transcriber.hostDetection`.
- Feed audio is streamed by ffmpeg straight into the WAV (with `-t` for `--limit-minutes`), no MP3 kept. YouTube audio is always downloaded whole (a `--download-sections` download ran at ~20 KB/s) and `-t` applied at conversion.
- Diarization is labelled by appearance after speaker assignment; interior 1-word speaker islands (≤ 1 s) inside one Whisper segment are smoothed (diarization flicker).
- `pnpm transcribe` refuses to replace an existing transcript (e.g. `lex-official`) unless `--force` (exit 8). Extra flags beyond the brief: `--threads`, `--force`.
- Python output carries `extra.transcriber` = `{model, diarizer, numSpeakers, speakerLabels, hostDetection, audioDuration, limitSeconds, timings}`.
- Signals: Python turns SIGTERM/SIGINT into a clean stop (exit 130, lock released, caches kept); the TS wrapper forwards SIGINT/SIGTERM/SIGHUP it receives to `uv`. **pnpm does not forward** signals to the script's process group, so the handle to stop a background run is the Python pid in `data/cache/transcribe/<slug>/lock`.
- Feed matching reuses ingest's `parseFeed`/`fetchFeed`/`createHttp`/`normalizeTitle`/`episodeNumberFromTitle` (`src/core/ingest/`); the matcher itself (`src/cli/transcribe/feed-audio.ts`) uses the overlap coefficient of title words within ±3 days (≥ 0.5, unique best) and the Dice coefficient (≥ 0.75) when there is no date. No change to core.
- Dependencies: `yt-dlp[default]` (adds `yt-dlp-ejs`), dev `pytest`, optional extra `pyannote` (`pyannote-audio` 4.0.7 locked, not installed). No npm dependency added.
- `hotwords` not used (no A/B done; `initial_prompt` gets the names right most of the time: "Lex Friedman" was the one recurring miss seen).

## Files

- `transcriber/pyproject.toml`, `uv.lock`, `.gitignore`, `README.md`; `transcriber/src/epod_transcriber/{__init__,__main__,cli,job,audio,chunks,asr,diarization,speakers,pipeline,util}.py`; `transcriber/tests/test_{chunks,speakers,pipeline,job}.py`; `transcriber/tools/evaluate.py` (dev, numbers only). `transcriber/trial/` unchanged.
- `src/cli/transcribe.ts` (CLI), `src/cli/transcribe/{feed-audio,job,finish,run}.ts`; `tests/transcribe/{feed-audio,run,cli}.test.ts`.
- `docs/DESIGN.md` §7.7 (fase 8 paragraph), this file.

## Known limitations

- Host heuristic is still a heuristic: a cold open where the guest says his own surname, or multi-guest cold opens, can swap names → fix in the local UI (phase 7).
- Fast exchanges: a few words at turn edges go to the wrong speaker (~0.6% of words); short interjections may be merged into the other speaker's segment.
- Not tested: 3+ speakers, `--diarizer pyannote` (only the "not installed" path), models other than `small.en`, YouTube blocking yt-dlp (feed fallback tested on its own).
- Download time depends on the network (16–115 s for the same 74 MB).
- A run killed with SIGKILL leaves a stale `lock` (taken over automatically when its pid is dead) and possibly `data/audio/<slug>.*`; the next run reuses or overwrites them.

## Notes for phase 9 (`/add-episode` launching Whisper in the background)

- Launch from the repo root, detached, with a log:
  `nohup pnpm transcribe <slug> > data/cache/transcribe-<slug>.log 2>&1 &` (add `--force` only if the user wants to replace an existing transcript; exit 8 otherwise).
- ~20 min for 2 h of audio (download 0.3–2 min, diarization ~7 min, ASR ~11 min). Progress lines look like `[HH:MM:SS load X] asr: chunk 4/12 [30:25–41:14] 63.7s …`; the last stdout block starts with `Transcribed <slug>`; failures end with `error…` and a non-zero exit (1 failed, 4 no audio source/not found, 8 transcript exists, 130 interrupted).
- Running? `data/cache/transcribe/<slug>/lock` exists and its pid is alive. Stop: `kill $(cat data/cache/transcribe/<slug>/lock)` (graceful; killing the pnpm pid does nothing). Resume: run the same command again (finished chunks and diarization are reused).
- A second launch on the same slug while one runs fails fast (Python exit 5 "another transcription … is running").
- Afterwards the episode has `transcriptSource: whisper-local` and `transcriptTimebase: youtube|feed`; remind the user to check the speaker names (the output line says which host heuristic was used).

## Log

- 2026-11-10 02:50 — started; read brief/docs. yt-dlp without a JS runtime warns "n challenge solving failed" and the video has a Russian dubbed audio track besides the original.
- 2026-11-10 03:01 — Python package + tests written; usage limit hit.
- 2026-11-10 07:32 — resumed; no background jobs, `data/audio/` empty.
- 2026-11-10 07:39 — TS wrapper + tests done; next: short e2e run through `pnpm transcribe` in a temp data dir.
- 2026-11-10 12:33–12:54 — full 2 h run done (19 min 48 s), evaluated; 12:55–12:59 graceful SIGTERM test.
- 2026-11-10 07:42–07:48 — e2e, feed fallback, interrupt/resume (30 min) done; chunk-boundary text loss found (see checklist). Usage limit hit while testing mitigations; resumed — implementing the 30 s left pad, then the 2 h run.
- Coordinator note (phase 4 done): Lex `publishedAt` is the site's local date, can be 1 day before the feed's UTC pubDate → covered by the ±3-day window (unit test matches at 3 days' distance).
