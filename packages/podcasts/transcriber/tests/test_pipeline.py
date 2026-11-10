"""Resume logic of the pipeline with fake audio/ASR/diarization backends (offline, fast)."""

import json
import wave
from pathlib import Path

import numpy as np
import pytest

from epod_transcriber import pipeline
from epod_transcriber.audio import SAMPLE_RATE, AudioSource, read_wav, wav_duration
from epod_transcriber.job import parse_job
from epod_transcriber.util import AlreadyRunningError, AudioUnavailableError, DependencyError, RunLock

DURATION = 100.0  # seconds of fake audio; chunks of 30 s -> 3 chunks


def write_ramp_wav(path: Path, seconds: float) -> None:
    """A WAV whose sample values encode absolute time (a ramp), so the fake ASR knows where its slice starts."""
    n = int(seconds * SAMPLE_RATE)
    full = DURATION * SAMPLE_RATE  # same scale for any length, so a limited WAV is a prefix
    ramp = np.round(-32768 + 65535 * np.arange(n) / full).astype(np.int16)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(ramp.tobytes())


class FakeAsr:
    """Emits one word per absolute second ("w<n>", 0.4 s long) inside the slice it receives."""

    calls: list[float] = []
    fail_on_call: int | None = None

    def __init__(self, model: str, threads: int) -> None:
        self.model = model

    def transcribe(self, samples, prompt):
        t0 = (float(samples[0]) * 32768 + 32768) / 65535 * DURATION
        FakeAsr.calls.append(round(t0))
        if FakeAsr.fail_on_call is not None and len(FakeAsr.calls) == FakeAsr.fail_on_call:
            raise KeyboardInterrupt
        span = len(samples) / SAMPLE_RATE
        words = []
        for n in range(int(np.ceil(t0 - 0.01)), int(t0 + span) + 1):  # the ramp encodes t0 to ~2 ms
            rel = max(0.0, n - t0)
            if rel + 0.4 <= span:
                words.append({"start": rel, "end": rel + 0.4, "word": f" w{n}"})
        # Whisper-like segments of 5 words
        return [
            {"start": ws[0]["start"], "end": ws[-1]["end"], "text": "".join(x["word"] for x in ws).strip(), "words": ws}
            for ws in (words[i : i + 5] for i in range(0, len(words), 5))
        ]


class Counter:
    def __init__(self):
        self.fetch = 0
        self.diarize = 0


@pytest.fixture
def env(tmp_path):
    FakeAsr.calls = []
    FakeAsr.fail_on_call = None
    counts = Counter()

    def fetch_audio(youtube_url, feed_url, audio_dir, slug, limit):
        counts.fetch += 1
        if not youtube_url and not feed_url:
            raise AudioUnavailableError("no audio")
        write_ramp_wav(audio_dir / f"{slug}.wav", limit or DURATION)
        (audio_dir / f"{slug}.youtube.webm").write_bytes(b"x")  # leftover original, must be cleaned up
        return AudioSource("youtube", youtube_url) if youtube_url else AudioSource("feed", feed_url)

    def diarize(diarizer, wav, num):
        counts.diarize += 1
        # host speaks 0-20 s and 50-100 s, guest 20-50 s
        return [
            {"start": 0.0, "end": 20.0, "speaker": "SPEAKER_01"},
            {"start": 20.0, "end": 50.0, "speaker": "SPEAKER_00"},
            {"start": 50.0, "end": 100.0, "speaker": "SPEAKER_01"},
        ]

    backends = pipeline.Backends(
        fetch_audio=fetch_audio,
        check_diarizer=lambda d: None,
        diarize=diarize,
        make_transcriber=FakeAsr,
        read_wav=read_wav,
        wav_duration=wav_duration,
    )

    def job(**over):
        data = {
            "version": 1,
            "slug": "demo-ep",
            "workDir": str(tmp_path / "work"),
            "audioDir": str(tmp_path / "audio"),
            "outputPath": str(tmp_path / "work" / "transcript.json"),
            "prompt": "Demo Show. Host Person and Guest Person.",
            "hostName": "Host Person",
            "guestNames": ["Guest Person"],
            "youtubeId": "abcdefghijk",
            "feed": {"url": "https://example.com/ep.mp3", "matchedBy": "number"},
            "numSpeakers": 2,
            "model": "small.en",
            "chunkSeconds": 30,
            **over,
        }
        return parse_job(data)

    return tmp_path, backends, counts, job


def words_of(transcript):
    return [w for s in transcript["segments"] for w in s["text"].split()]


def test_full_run_produces_every_word_once_with_speakers_and_cleans_audio(env):
    tmp, backends, counts, job = env
    t = pipeline.run(job(), backends)
    assert words_of(t) == [f"w{n}" for n in range(100)]
    assert t["timebase"] == "youtube" and t["audio"] == {"source": "youtube", "url": "https://www.youtube.com/watch?v=abcdefghijk"}
    speakers = {s["speaker"] for s in t["segments"] if s["start"] < 20} | {s["speaker"] for s in t["segments"] if s["start"] >= 50}
    assert speakers == {"Host Person"}
    assert {s["speaker"] for s in t["segments"] if 20 <= s["start"] < 50} == {"Guest Person"}
    assert t["chapters"] == [] and t["extra"]["transcriber"]["hostDetection"] == "first-speaker"
    assert json.loads((tmp / "work" / "transcript.json").read_text()) == t
    assert list((tmp / "audio").iterdir()) == []  # WAV + original deleted
    assert not (tmp / "work" / "lock").exists()
    assert len(FakeAsr.calls) == 3


def test_interrupted_run_resumes_from_the_next_chunk_without_redoing_diarization(env):
    tmp, backends, counts, job = env
    FakeAsr.fail_on_call = 2  # killed while transcribing chunk 2
    with pytest.raises(KeyboardInterrupt):
        pipeline.run(job(), backends)
    assert counts.diarize == 1 and len(FakeAsr.calls) == 2
    assert (tmp / "work" / "asr" / "chunk-000.json").exists() and not (tmp / "work" / "asr" / "chunk-001.json").exists()
    assert not (tmp / "work" / "lock").exists()

    FakeAsr.calls = []
    FakeAsr.fail_on_call = None
    t = pipeline.run(job(), backends)
    assert counts.diarize == 1  # cached
    assert counts.fetch == 1  # the WAV was still there
    assert len(FakeAsr.calls) == 2  # chunks 2 and 3 only
    assert t["extra"]["transcriber"]["timings"]["chunksCached"] == 1
    assert t["extra"]["transcriber"]["timings"]["diarizationCached"] is True
    assert words_of(t) == [f"w{n}" for n in range(100)]


def test_fully_cached_run_needs_no_audio(env):
    tmp, backends, counts, job = env
    pipeline.run(job(keepAudio=False), backends)
    (tmp / "work" / "transcript.json").unlink()
    FakeAsr.calls = []
    t = pipeline.run(job(), backends)
    assert counts.fetch == 1 and counts.diarize == 1 and FakeAsr.calls == []
    assert words_of(t) == [f"w{n}" for n in range(100)]


def test_changing_the_model_redoes_asr_but_not_diarization(env):
    tmp, backends, counts, job = env
    pipeline.run(job(keepAudio=True), backends)
    assert (tmp / "audio" / "demo-ep.wav").exists()  # kept
    FakeAsr.calls = []
    pipeline.run(job(model="medium.en"), backends)
    assert counts.diarize == 1 and counts.fetch == 1 and len(FakeAsr.calls) == 3


def test_changing_the_limit_starts_over(env):
    tmp, backends, counts, job = env
    pipeline.run(job(limitSeconds=40), backends)
    t = pipeline.run(job(limitSeconds=60), backends)
    assert counts.fetch == 2 and counts.diarize == 2
    assert words_of(t) == [f"w{n}" for n in range(60)]


def test_feed_only_job_has_feed_timebase(env):
    tmp, backends, counts, job = env
    t = pipeline.run(job(youtubeId=None), backends)
    assert t["timebase"] == "feed" and t["audio"] == {"source": "feed", "url": "https://example.com/ep.mp3"}


def test_no_audio_source_is_a_clear_error(env):
    tmp, backends, counts, job = env
    with pytest.raises(AudioUnavailableError):
        pipeline.run(job(youtubeId=None, feed=None), backends)


def test_missing_diarizer_fails_before_downloading(env):
    tmp, backends, counts, job = env

    def check(d):
        raise DependencyError("pyannote missing")

    backends.check_diarizer = check
    with pytest.raises(DependencyError):
        pipeline.run(job(diarizer="pyannote"), backends)
    assert counts.fetch == 0


def test_lock_blocks_a_second_live_run_but_takes_over_a_stale_one(tmp_path):
    lock_path = tmp_path / "lock"
    lock_path.write_text("1")  # pid 1 (init) is alive
    with pytest.raises(AlreadyRunningError):
        RunLock(lock_path).acquire()
    lock_path.write_text("999999999")  # no such process
    lock = RunLock(lock_path)
    lock.acquire()
    lock.release()
    assert not lock_path.exists()
