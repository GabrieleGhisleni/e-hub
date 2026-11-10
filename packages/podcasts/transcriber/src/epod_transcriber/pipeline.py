"""The resumable pipeline: audio → diarization (whole file, cached) → ASR per chunk (cached) → merge → output.

Work dir (`data/cache/transcribe/<slug>/`, made by the TS wrapper):

- `lock`               pid of the running process (a stale one is taken over)
- `state.json`         which audio is being transcribed (+ its duration) and the chunk plan
- `diarization.json`   speaker turns for the whole file
- `asr/chunk-NNN.json` finished chunks (absolute times, already trimmed to the chunk's core range)
- `transcript.json`    the result, read by `pnpm transcribe` (default output path)

Every cache file stores the parameters it was made with (audio identity and
duration, model, prompt, chunk range, diarizer, speaker count) and is reused
only if they match, so a relaunch skips exactly the work that is still valid.
The TS wrapper deletes the work dir once the transcript is saved.
"""

from __future__ import annotations

import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from . import asr, audio, chunks, diarization, speakers
from .job import Job
from .util import RunLock, fmt_time, load_cached, log, read_json, write_json_atomic

STATE_VERSION = 1
# Before each chunk: one whole Whisper window (see chunks.py); after: enough for a word cut at the boundary.
LEFT_PAD_SECONDS = 30.0
RIGHT_PAD_SECONDS = 2.0
CUT_SEARCH_SECONDS = 30.0


class SpeechToText(Protocol):
    def transcribe(self, samples: Any, prompt: str) -> list[dict[str, Any]]: ...


@dataclass
class Backends:
    """The heavy parts, injectable so the resume logic is testable offline."""

    fetch_audio: Callable[..., audio.AudioSource] = audio.fetch_audio
    check_diarizer: Callable[[str], None] = diarization.check_diarizer
    diarize: Callable[[str, Path, int | None], list[dict[str, Any]]] = diarization.run_diarization
    make_transcriber: Callable[[str, int], SpeechToText] = asr.Transcriber
    read_wav: Callable[[Path, float, float], Any] = audio.read_wav
    wav_duration: Callable[[Path], float] = audio.wav_duration


@dataclass
class WorkDir:
    root: Path

    @property
    def state(self) -> Path:
        return self.root / "state.json"

    @property
    def diarization(self) -> Path:
        return self.root / "diarization.json"

    def chunk(self, index: int) -> Path:
        return self.root / "asr" / f"chunk-{index:03d}.json"


def _range(core: tuple[float, float] | list[float]) -> str:
    return f"{fmt_time(core[0])}–{fmt_time(core[1])}"


def diarization_params(job: Job, audio_key: dict[str, Any]) -> dict[str, Any]:
    return {"diarizer": job.diarizer, "numSpeakers": job.num_speakers, "audio": audio_key}


def chunk_params(job: Job, audio_key: dict[str, Any], core: list[float]) -> dict[str, Any]:
    return {"model": job.model, "prompt": job.prompt, "core": list(core), "pad": [LEFT_PAD_SECONDS, RIGHT_PAD_SECONDS], "audio": audio_key}


def _compatible_state(job: Job, state: Any) -> bool:
    """A previous run's state is reusable if it used one of this job's audio sources with the same limit."""
    if not isinstance(state, dict) or state.get("version") != STATE_VERSION:
        return False
    a = state.get("audio") or {}
    allowed = {("youtube", job.youtube_url), ("feed", job.feed.url if job.feed else None)}
    return bool(a.get("url")) and (a.get("source"), a.get("url")) in allowed and a.get("limitSeconds") == job.limit_seconds


def _caches_complete(job: Job, work: WorkDir, state: dict[str, Any]) -> bool:
    plan = state.get("plan")
    if not plan or plan.get("chunkSeconds") != job.chunk_seconds:
        return False
    key = state["audio"]
    if load_cached(work.diarization, diarization_params(job, key)) is None:
        return False
    return all(load_cached(work.chunk(i), chunk_params(job, key, core)) is not None for i, core in enumerate(plan["chunks"]))


def _acquire_audio(job: Job, work: WorkDir, state: dict[str, Any] | None, backends: Backends, timings: dict[str, float]) -> dict[str, Any]:
    """Makes sure the WAV exists and `state` describes it (with a chunk plan); returns the state."""
    wav = audio.wav_path(job.audio_dir, job.slug)
    if state is not None and wav.exists() and abs(backends.wav_duration(wav) - state["audio"]["duration"]) < 0.01:
        log(f"audio: reusing {wav} ({fmt_time(state['audio']['duration'])})")
    else:
        t0 = time.perf_counter()
        src = backends.fetch_audio(job.youtube_url, job.feed.url if job.feed else None, job.audio_dir, job.slug, job.limit_seconds)
        timings["audioSeconds"] = round(time.perf_counter() - t0, 1)
        duration = backends.wav_duration(wav)
        audio_key = {"source": src.source, "url": src.url, "limitSeconds": job.limit_seconds, "duration": round(duration, 3)}
        if state is not None and state["audio"] == audio_key:
            log("audio: same audio as the cached run, keeping its caches")
        else:
            state = {"version": STATE_VERSION, "audio": audio_key}
        log(f"audio: {src.source}, {fmt_time(duration)} of audio")
    plan = state.get("plan")
    if not plan or plan.get("chunkSeconds") != job.chunk_seconds:
        duration = state["audio"]["duration"]

        def find_cut(lo: float, hi: float) -> float:
            return chunks.quietest_time(backends.read_wav(wav, lo, hi), audio.SAMPLE_RATE, lo)

        cores = chunks.plan_chunks(duration, job.chunk_seconds, find_cut, CUT_SEARCH_SECONDS)
        state["plan"] = {"chunkSeconds": job.chunk_seconds, "chunks": [list(c) for c in cores]}
        log(f"chunks: {len(cores)} of ~{fmt_time(duration / max(1, len(cores)))} (cuts at the quietest point near each boundary)")
    write_json_atomic(work.state, state)
    return state


def run(job: Job, backends: Backends | None = None, now: Callable[[], datetime] | None = None) -> dict[str, Any]:
    """Runs (or resumes) the whole pipeline; writes and returns the transcript dict."""
    backends = backends or Backends()
    work = WorkDir(job.work_dir)
    lock = RunLock(work.root / "lock")
    lock.acquire()
    try:
        return _run(job, work, backends, now or (lambda: datetime.now(UTC)))
    finally:
        lock.release()


def _run(job: Job, work: WorkDir, backends: Backends, now: Callable[[], datetime]) -> dict[str, Any]:
    t_start = time.perf_counter()
    timings: dict[str, Any] = {}
    backends.check_diarizer(job.diarizer)

    state = read_json(work.state)
    if state is not None and not _compatible_state(job, state):
        log("resume: cached work is for a different audio/limit; starting over")
        state = None
    if state is not None and _caches_complete(job, work, state):
        log("resume: diarization and all chunks are cached; no audio needed")
    else:
        if state is not None:
            log("resume: found cached work, continuing")
        state = _acquire_audio(job, work, state, backends, timings)
    audio_key = state["audio"]
    cores = state["plan"]["chunks"]
    wav = audio.wav_path(job.audio_dir, job.slug)

    # 1. diarization, on the whole file (labels stay consistent across chunks)
    d_params = diarization_params(job, audio_key)
    cached = load_cached(work.diarization, d_params)
    if cached is not None:
        turns = cached["turns"]
        timings["diarizationCached"] = True
        log(f"diarization: cached ({len(turns)} turns), skipping")
    else:
        log(f"diarization: {job.diarizer} on the whole audio ({job.num_speakers or 'auto'} speakers)…")
        t0 = time.perf_counter()
        turns = backends.diarize(job.diarizer, wav, job.num_speakers)
        elapsed = time.perf_counter() - t0
        timings["diarizationSeconds"] = round(elapsed, 1)
        write_json_atomic(work.diarization, {"params": d_params, "turns": turns, "seconds": round(elapsed, 1)})
        labels = sorted({t["speaker"] for t in turns})
        log(f"diarization: done in {elapsed:.1f}s, {len(turns)} turns, {len(labels)} speakers")

    # 2. ASR, chunk by chunk (each finished chunk is cached)
    transcriber: SpeechToText | None = None
    segments: list[dict[str, Any]] = []
    asr_now = 0.0
    asr_total = 0.0
    cached_chunks = 0
    for i, core in enumerate(cores):
        path = work.chunk(i)
        params = chunk_params(job, audio_key, core)
        hit = load_cached(path, params)
        if hit is not None:
            cached_chunks += 1
            asr_total += hit.get("seconds", 0.0)
            segments.extend(hit["segments"])
            log(f"asr: chunk {i + 1}/{len(cores)} [{_range(core)}] cached, skipping")
            continue
        if transcriber is None:
            transcriber = backends.make_transcriber(job.model, job.cpu_threads)
        lo, hi = chunks.padded_range((core[0], core[1]), audio_key["duration"], LEFT_PAD_SECONDS, RIGHT_PAD_SECONDS)
        t0 = time.perf_counter()
        raw = transcriber.transcribe(backends.read_wav(wav, lo, hi), job.prompt)
        kept = chunks.keep_core(chunks.offset_segments(raw, lo), (core[0], core[1]), first=i == 0, last=i == len(cores) - 1)
        elapsed = time.perf_counter() - t0
        asr_now += elapsed
        asr_total += elapsed
        write_json_atomic(path, {"params": params, "segments": kept, "seconds": round(elapsed, 1)})
        words = sum(len(s.get("words") or []) for s in kept)
        log(f"asr: chunk {i + 1}/{len(cores)} [{_range(core)}] {elapsed:.1f}s (RTF {elapsed / max(hi - lo, 1e-6):.3f}), {words} words")
        segments.extend(kept)
    timings["asrSeconds"] = round(asr_now, 1)
    timings["asrSecondsAllRuns"] = round(asr_total, 1)
    timings["chunksCached"] = cached_chunks

    # 3. merge: speaker per word, split segments, names
    t0 = time.perf_counter()
    pieces = speakers.split_segments(segments, turns)
    host_label, host_method = speakers.detect_host(pieces, job.guest_names)
    order = speakers.appearance_order(pieces)
    names = speakers.name_speakers(order, host_label, job.host_name, job.guest_names)
    out_segments = speakers.to_transcript_segments(pieces, names)
    word_counts = Counter()
    for piece in pieces:
        word_counts[names.get(piece["label"], "?")] += len(piece["text"].split())
    timings["mergeSeconds"] = round(time.perf_counter() - t0, 2)
    timings["totalSeconds"] = round(time.perf_counter() - t_start, 1)
    log(f"merge: {len(out_segments)} segments; host = {host_label} ({host_method}); words per speaker: {dict(word_counts)}")

    transcript = {
        "source": "whisper-local",
        "timebase": audio_key["source"],
        "audio": {"source": audio_key["source"], "url": audio_key["url"]},
        "createdAt": now().isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "segments": out_segments,
        "chapters": [],
        "extra": {
            "transcriber": {
                "model": job.model,
                "diarizer": job.diarizer,
                "numSpeakers": job.num_speakers,
                "speakerLabels": names,
                "hostDetection": host_method,
                "audioDuration": audio_key["duration"],
                "limitSeconds": job.limit_seconds,
                "timings": timings,
            }
        },
    }
    write_json_atomic(job.output_path, transcript)

    # 4. audio is not needed any more (the JSON caches suffice to rebuild the transcript)
    if job.keep_audio:
        log(f"audio: kept (--keep-audio): {wav}")
    else:
        removed = audio.delete_episode_audio(job.audio_dir, job.slug)
        if removed:
            log(f"audio: deleted {', '.join(p.name for p in removed)}")
    log(f"done in {fmt_time(timings['totalSeconds'])} → {job.output_path}")
    return transcript
