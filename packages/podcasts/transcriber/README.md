# transcriber

Python side (uv, Python 3.12 pinned) of `pnpm transcribe <slug>`: audio → diarized transcript in the unified
format (DESIGN.md §4.3, §7). Normally you never call it directly: the TS wrapper `src/cli/transcribe.ts` reads
the episode/show, resolves the audio plan (YouTube id, feed MP3 fallback), writes a JSON job on stdin of
`uv run --project transcriber python -m epod_transcriber -`, then validates the result and saves it through core.

## Pipeline (`src/epod_transcriber/`)

1. **Audio** (`audio.py`): `yt-dlp` on the YouTube video (original-language track, node as JS runtime) →
   `timebase: youtube`; if that fails, ffmpeg streams the feed MP3 → `timebase: feed`; else a clear error.
   Everything becomes `data/audio/<slug>.wav` (16 kHz mono), deleted at the end unless `--keep-audio`.
2. **Diarization** (`diarization.py`) on the whole WAV with `diarize` (`--diarizer pyannote` = optional plan B),
   cached in the work dir, so a resume never redoes it.
3. **ASR** (`asr.py`, `chunks.py`): sequential faster-whisper (`small.en`, int8, VAD, word timestamps,
   `initial_prompt` with show/host/guests/title) on ~10-minute chunks read from the WAV. Cuts sit at the quietest
   0.5 s near each boundary; each chunk gets 30 s of audio before it (faster-whisper can skip the first window
   of a chunk that starts mid-speech) and 2 s after, and keeps only the words whose midpoint is in its own range.
   Each finished chunk is cached.
4. **Merge** (`speakers.py`): every word takes the diarization turn it overlaps most; Whisper segments are split
   where the speaker changes; the host is the first speaker, unless in the first 10 minutes someone says a
   guest's surname (cold open with a guest clip: the one introducing the guest is the host); guests follow in
   order of appearance, then `Speaker N`.

Work dir `data/cache/transcribe/<slug>/` (`state.json`, `diarization.json`, `asr/chunk-NNN.json`, `lock` with the
Python pid). Each cache stores the parameters it was made with and is reused only if they match. The TS wrapper
removes the work dir after saving (with `--keep-audio` it keeps `diarization.json` + `state.json` beside the WAV,
so a re-run with another `--model` skips diarization).

Stopping a run: `kill $(cat data/cache/transcribe/<slug>/lock)` (or Ctrl-C in the foreground). Killing the
background `pnpm` process does not stop its children. Relaunching the same command resumes.

## Commands

```sh
# tests (offline, < 1 s)
cd transcriber && uv run pytest
# direct run of a job file (what pnpm transcribe does)
uv run --project transcriber python -m epod_transcriber job.json
# compare a transcript with an official Lex transcript parsed by trial/reference.py (numbers only)
uv run --project transcriber python transcriber/tools/evaluate.py <transcript.json> <reference.json>
# optional plan B diarizer (not installed by default; ~100 min per 2 h on CPU)
uv sync --project transcriber --extra pyannote && export HF_TOKEN=…
```

Exit codes of `python -m epod_transcriber`: 0 ok, 1 unexpected, 2 bad job, 3 audio unavailable,
4 missing dependency (ffmpeg, pyannote, HF_TOKEN), 5 already running, 130 interrupted.

## Phase-2 trial

`trial/` is the original measurement trial (kept as-is): `trial/reference.py` parses an official
lexfridman.com transcript page; `trial/run.py {asr|diarize|merge|eval}` with outputs in `data/cache/trial/`.
