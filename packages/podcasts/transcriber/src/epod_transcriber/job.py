"""The JSON job written by `pnpm transcribe` (src/cli/transcribe/job.ts builds it)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .util import JobError

JOB_VERSION = 1
DIARIZERS = ("diarize", "pyannote")


@dataclass(frozen=True)
class FeedAudio:
    url: str
    title: str | None = None
    matched_by: str | None = None


@dataclass(frozen=True)
class Job:
    slug: str
    work_dir: Path
    audio_dir: Path
    output_path: Path
    prompt: str
    host_name: str
    guest_names: tuple[str, ...] = ()
    youtube_id: str | None = None
    feed: FeedAudio | None = None
    num_speakers: int | None = 2
    model: str = "small.en"
    cpu_threads: int = 8
    diarizer: str = "diarize"
    keep_audio: bool = False
    limit_seconds: float | None = None
    chunk_seconds: float = 600.0

    @property
    def youtube_url(self) -> str | None:
        return f"https://www.youtube.com/watch?v={self.youtube_id}" if self.youtube_id else None


def _get(data: dict[str, Any], key: str, kind: type | tuple[type, ...], *, optional: bool = False) -> Any:
    value = data.get(key)
    if value is None:
        if optional:
            return None
        raise JobError(f"job: '{key}' is required")
    kinds = kind if isinstance(kind, tuple) else (kind,)
    # bool is a subclass of int: reject `true` where a number is expected
    if not isinstance(value, kinds) or (isinstance(value, bool) and bool not in kinds):
        raise JobError(f"job: '{key}' has the wrong type ({type(value).__name__})")
    return value


def parse_job(data: Any) -> Job:
    """Validates the job JSON (camelCase keys) into a `Job`; `JobError` with a precise message otherwise."""
    if not isinstance(data, dict):
        raise JobError("job must be a JSON object")
    version = data.get("version")
    if version != JOB_VERSION:
        raise JobError(f"job: unsupported version {version!r} (expected {JOB_VERSION})")
    feed_data = _get(data, "feed", dict, optional=True)
    feed = None
    if feed_data is not None:
        feed = FeedAudio(
            url=_get(feed_data, "url", str),
            title=_get(feed_data, "title", str, optional=True),
            matched_by=_get(feed_data, "matchedBy", str, optional=True),
        )
    diarizer = _get(data, "diarizer", str, optional=True) or "diarize"
    if diarizer not in DIARIZERS:
        raise JobError(f"job: diarizer must be one of {', '.join(DIARIZERS)}")
    num_speakers = _get(data, "numSpeakers", int, optional=True)
    if num_speakers is not None and not 1 <= num_speakers <= 20:
        raise JobError("job: numSpeakers must be between 1 and 20")
    limit = _get(data, "limitSeconds", (int, float), optional=True)
    if limit is not None and limit <= 0:
        raise JobError("job: limitSeconds must be positive")
    chunk = _get(data, "chunkSeconds", (int, float), optional=True) or 600.0
    if chunk < 30:
        raise JobError("job: chunkSeconds must be at least 30")
    threads = _get(data, "cpuThreads", int, optional=True) or 8
    guests = _get(data, "guestNames", list, optional=True) or []
    if not all(isinstance(g, str) for g in guests):
        raise JobError("job: guestNames must be strings")
    return Job(
        slug=_get(data, "slug", str),
        work_dir=Path(_get(data, "workDir", str)),
        audio_dir=Path(_get(data, "audioDir", str)),
        output_path=Path(_get(data, "outputPath", str)),
        prompt=_get(data, "prompt", str, optional=True) or "",
        host_name=_get(data, "hostName", str),
        guest_names=tuple(guests),
        youtube_id=_get(data, "youtubeId", str, optional=True),
        feed=feed,
        num_speakers=num_speakers,
        model=_get(data, "model", str, optional=True) or "small.en",
        cpu_threads=max(1, threads),
        diarizer=diarizer,
        keep_audio=bool(_get(data, "keepAudio", bool, optional=True)),
        limit_seconds=float(limit) if limit is not None else None,
        chunk_seconds=float(chunk),
    )
