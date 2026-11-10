# Brief — phase 2 (Transcriber trial) — model: sonnet

You are implementing **phase 2 (Transcriber trial)** of the e-podcasts project in /home/ggabry/projects/e-podcasts. It is a measurement experiment: the biggest unknown of the plan, to be measured before anything is built on it.

First read `docs/PROGRESS.md` ("Rules every subagent gets") and `docs/DESIGN.md` §4.3, §6.1 (Lex), §7, §14, §15 phase 2. You own `transcriber/` and may edit only §7 (and the phase-2 line of §15) of `docs/DESIGN.md`. Do not touch the TypeScript project files.

Keep `docs/progress/phase-2.md` updated as you go; if it exists, continue from its checklist.

Machine: Ryzen AI 7 350 (8C/16T), no NVIDIA GPU, 30 GB RAM, CPU only. uv 0.12, ffmpeg 9, system Python 3.14 (pin e.g. 3.12 in the uv project if wheels need it). Record load (`uptime`) next to every timing — other agents may be building concurrently.

## Steps

1. uv project in `transcriber/` (faster-whisper, diarize, yt-dlp; jiwer in a dev group if used). Trial script under `transcriber/trial/`.
2. Pick a recent Lex Fridman episode with an official transcript page (`lexfridman.com/<slug>-transcript`); parse the first ~20 minutes as reference (speaker, timestamp, text). Keep reference/output text only in `data/cache/trial/` (gitignored).
3. Download only ~20 minutes of audio with yt-dlp (`--download-sections "*0:00-20:00"`, audio only) into `data/audio/`; convert to 16 kHz mono WAV. Fallback: Lex RSS MP3 (compare text only then).
4. faster-whisper `small.en`, int8, `BatchedInferencePipeline` (batch ~8, 8 threads), `word_timestamps=True`, initial_prompt/hotwords with show/host/guest names. Measure model load, transcription time, RTF.
5. `diarize` (PyPI, no HF token; learn the real API from the installed package) on the whole audio, right number of speakers. Measure time.
6. Per-word speaker assignment by max overlap, split segments at speaker changes, "first speaker = host" heuristic.
7. Compare to the official transcript: WER (normalized), speaker-attribution accuracy, notes on proper nouns and the host heuristic.
8. Extrapolate to 2 h vs. the ~30 min budget (§7.3/§7.4).
9. Delete the audio from `data/audio/`; keep outputs in `data/cache/trial/`.

## Deliverables

- Trial runnable with one documented command (`transcriber/README.md`).
- DESIGN.md: new subsection "### 7.7 Misure della prova (fase 2)" (Italian): episode (title + link, no transcript text), load, times, RTF, WER, speaker accuracy, 2 h extrapolation, recommendation on whether §7 must change. Do not rewrite existing decisions.
- `docs/progress/phase-2.md` complete with notes for phase 8 (API quirks, working versions, Python pin).

Do not commit. Final message: numbers, recommendation, notes for phase 8.
