# Phase 2 — Transcriber trial

Status: done (DESIGN.md §7.7 written; §7 itself not rewritten, only recommendations)

## Checklist

- [x] uv project in `transcriber/` (Python 3.12 pinned: `.python-version`, `requires-python >=3.12,<3.13`)
- [x] episode: Lex Fridman Podcast #502 (Andrew Scull), https://lexfridman.com/andrew-scull-transcript , YouTube id s7d2d8FhevU, 2 speakers
- [x] official transcript parsed -> `data/cache/trial/reference_full.json` (`transcriber/trial/reference.py`)
- [x] 20 min audio (yt-dlp `-f bestaudio --download-sections "*0:00-20:00"`, no blocking) + 16 kHz mono WAV
- [x] ASR batched and sequential, diarize, merge, eval (`transcriber/trial/run.py`)
- [x] extrapolation + DESIGN.md §7.7
- [x] `transcriber/README.md`
- [x] audio deleted from `data/audio/` (outputs kept in `data/cache/trial/`)

## Commands

See `transcriber/README.md`. Outputs in `data/cache/trial/`: `asr.json` (batched), `asr_seq.json`, `diarize.json`, `merged*.json`, `eval*.json`, logs.

## Measurements (loadavg: ~0.4 idle before ASR; ~1.5 during diarize, other agents active)

- ASR batched (small.en int8, bs8, 8 threads, word ts, initial_prompt): load 1.4 s, 56.7 s / 1200 s, RTF 0.047.
- ASR sequential (`WhisperModel.transcribe`, vad_filter): 89.6 s, RTF 0.075 (loadavg 1.1 before).
- diarize(num_speakers=2): 75.8 s incl. ~7 s one-off model download (RTF ~0.058), 43 turns.
- WER (normalized): batched 17.8% (250 del), sequential 11.3% (77 del, 73 sub, 145 ins; mostly number/contraction formatting).
- Speaker accuracy on aligned words: 99.8% (batched) / 99.9% (sequential), with Lex = first speaker (correct here, no cold open).
- 2 h extrapolation: seq ASR ~9 min + diarize ~7 min (if linear) = ~16 min vs budget 30.

## Decisions / deviations

- Recommend sequential faster-whisper instead of BatchedInferencePipeline (batched dropped text blocks, e.g. 55 words -> 5). See DESIGN.md §7.7.

## Notes for phase 8

- Versions that worked: faster-whisper 1.2.1, ctranslate2 4.8.5, diarize 0.1.2, yt-dlp 2026.10.26, torch 2.8.0, onnxruntime 1.31.1, jiwer 4.0.0, av 16.1.0, Python 3.12.
- **Python 3.14 fails** (torch 2.8 has no cp314 wheel; `diarize` requires torch<2.9). `uv add` first install is slow (~9 GB uv cache with torch + CUDA libs).
- **av 19 breaks faster-whisper 1.2.1** (`decode_audio`: unexpected kwarg `metadata_errors`) -> pin `av>=14,<17`.
- diarize API: `diarize(path, min_speakers=1, max_speakers=20, num_speakers=None)` -> `DiarizeResult` (`.segments` with `.start .end .speaker` "SPEAKER_00"..., `.speakers`, `.num_speakers`, `.to_rttm()`, `.model_dump()` — pydantic, serializable to cache). Downloads the WeSpeaker ONNX model (25 MB, to `~/.wespeaker/`) on first use from a Chinese CDN; noisy torchaudio deprecation warnings. Label order is by cluster, not by appearance (SPEAKER_00 happened to be Lex).
- faster-whisper words: segment `.words` with `.start .end .word` (leading space in `.word`). Sequential run yields shorter segments (181 vs 57 for 20 min); batched gives ~30 s segments.
- Word-speaker assignment = max overlap; words with no overlap inherit previous speaker. Merge/eval code in `trial/run.py` can be reused.
- yt-dlp section download worked directly; output was `.webm` (opus). Run 20 min took ~2 min mostly network.
- Not tested: cold open vs host heuristic, 3+ speakers, `hotwords`, full 2 h diarize scaling, chunked (10 min) transcription, medium/distil models.
- Official transcript is a cleaned version (numbers as words, no fillers), so WER vs Whisper is inflated by formatting; compare with care.
