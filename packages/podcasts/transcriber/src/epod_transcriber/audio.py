"""Audio chain (DESIGN.md §7.2): yt-dlp on the YouTube video → feed MP3 → clear error.

Everything ends up as a 16 kHz mono 16-bit WAV in the audio dir
(`data/audio/<slug>.wav`, gitignored); the yt-dlp download sits beside it as
`<slug>.youtube.<ext>` until cleanup.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
import wave
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .util import AudioUnavailableError, DependencyError, TranscriberError, fmt_time, log

SAMPLE_RATE = 16000
# Original-language track first (videos can carry dubbed tracks), small bitrate is plenty for 16 kHz mono.
YOUTUBE_FORMAT = "ba[language_preference>=10][abr<=96]/ba[abr<=96]/ba"


@dataclass(frozen=True)
class AudioSource:
    source: str  # "youtube" | "feed"
    url: str


def wav_path(audio_dir: Path, slug: str) -> Path:
    return audio_dir / f"{slug}.wav"


def episode_audio_files(audio_dir: Path, slug: str) -> list[Path]:
    """Every file of this episode in the audio dir (WAV, yt-dlp download, partial/temp files)."""
    if not audio_dir.is_dir():
        return []
    return sorted(p for p in audio_dir.iterdir() if p.name.startswith(f"{slug}.") or p.name.startswith(f".{slug}."))


def delete_episode_audio(audio_dir: Path, slug: str) -> list[Path]:
    removed = []
    for p in episode_audio_files(audio_dir, slug):
        if p.is_file():
            p.unlink()
            removed.append(p)
    return removed


def require_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise DependencyError("ffmpeg not found on PATH (needed to convert the audio to 16 kHz mono WAV)")
    return path


def run_ffmpeg(input_args: list[str], output: Path, limit_seconds: float | None, expected_seconds: float | None, label: str) -> None:
    """Decodes `input_args` to a 16 kHz mono WAV at `output` (atomic), logging progress every ~10 min of audio."""
    ffmpeg = require_ffmpeg()
    tmp = output.with_name(f".{output.name}.tmp")
    cmd = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y", *input_args]
    if limit_seconds:
        cmd += ["-t", f"{limit_seconds:.3f}"]
    cmd += ["-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", "-f", "wav", str(tmp)]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    next_report = 600.0
    assert proc.stdout is not None
    for line in proc.stdout:
        if line.startswith("out_time_us="):
            try:
                t = int(line.split("=", 1)[1]) / 1e6
            except ValueError:
                continue
            if t >= next_report:
                total = f" / {fmt_time(expected_seconds)}" if expected_seconds else ""
                log(f"{label}: {fmt_time(t)}{total}")
                next_report += 600.0
    stderr = proc.stderr.read() if proc.stderr else ""
    if proc.wait() != 0:
        tmp.unlink(missing_ok=True)
        raise TranscriberError(f"{label}: ffmpeg failed: {stderr.strip()[-500:]}")
    os.replace(tmp, output)


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


def read_wav(path: Path, start: float, end: float) -> np.ndarray:
    """float32 samples of `[start, end)` seconds (16 kHz mono 16-bit WAV)."""
    with wave.open(str(path), "rb") as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != SAMPLE_RATE:
            raise TranscriberError(f"{path} is not a 16 kHz mono 16-bit WAV")
        first = max(0, int(round(start * SAMPLE_RATE)))
        count = max(0, int(round(end * SAMPLE_RATE)) - first)
        w.setpos(min(first, w.getnframes()))
        frames = w.readframes(count)
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def _youtube_download(video_url: str, audio_dir: Path, slug: str) -> Path:
    try:
        import yt_dlp
    except ImportError as error:  # pragma: no cover - it is a hard dependency
        raise DependencyError(f"yt-dlp is not installed in the transcriber environment: {error}") from error

    argv = ["-f", YOUTUBE_FORMAT, "--no-playlist", "-o", str(audio_dir / f"{slug}.youtube.%(ext)s")]
    if shutil.which("node"):
        # YouTube's JS challenges need a runtime; node is always there (we are launched by pnpm).
        argv += ["--js-runtimes", "node"]
    # No --download-sections for --limit-minutes: a section download went through ffmpeg at ~20 KB/s
    # (91 s for 3 min), the whole file takes ~20 s; the limit is applied when converting.
    opts = yt_dlp.parse_options(argv).ydl_opts
    state = {"t": 0.0}

    def hook(d: dict) -> None:
        now = time.monotonic()
        if d.get("status") == "downloading" and now - state["t"] >= 15:
            state["t"] = now
            done = d.get("downloaded_bytes") or 0
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            pct = f" ({100 * done / total:.0f}%)" if total else ""
            log(f"download: {done / 1e6:.1f} MB{pct}")

    opts.update(quiet=True, no_warnings=True, noprogress=True, progress_hooks=[hook])
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(video_url, download=True)
    downloads = (info or {}).get("requested_downloads") or []
    path = Path(downloads[0]["filepath"]) if downloads and downloads[0].get("filepath") else None
    if path is None or not path.exists():
        raise TranscriberError("yt-dlp reported success but produced no file")
    return path


def fetch_audio(
    youtube_url: str | None,
    feed_url: str | None,
    audio_dir: Path,
    slug: str,
    limit_seconds: float | None,
    *,
    youtube: Callable[[str, Path, str], Path] = _youtube_download,
    convert: Callable[..., None] = run_ffmpeg,
) -> AudioSource:
    """Produces `<audio_dir>/<slug>.wav` from the first source that works; returns which one."""
    audio_dir.mkdir(parents=True, exist_ok=True)
    wav = wav_path(audio_dir, slug)
    failures = []
    if youtube_url:
        log(f"audio: downloading from YouTube ({youtube_url})")
        try:
            t0 = time.perf_counter()
            original = youtube(youtube_url, audio_dir, slug)
            log(f"audio: downloaded {original.name} ({original.stat().st_size / 1e6:.1f} MB) in {time.perf_counter() - t0:.1f}s")
            t1 = time.perf_counter()
            convert(["-i", str(original)], wav, limit_seconds, None, "convert")
            log(f"audio: converted to 16 kHz mono WAV in {time.perf_counter() - t1:.1f}s")
            original.unlink(missing_ok=True)
            return AudioSource("youtube", youtube_url)
        except DependencyError:
            raise
        except Exception as error:  # yt-dlp raises many types; any failure → next source
            message = str(error).strip().splitlines()[-1] if str(error).strip() else type(error).__name__
            failures.append(f"YouTube: {message}")
            log(f"audio: YouTube failed ({message}); trying the feed")
    if feed_url:
        log(f"audio: streaming the feed MP3 into WAV ({feed_url})")
        try:
            t0 = time.perf_counter()
            reconnect = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "10"]
            convert([*reconnect, "-i", feed_url], wav, limit_seconds, None, "feed")
            log(f"audio: feed audio downloaded and converted in {time.perf_counter() - t0:.1f}s")
            return AudioSource("feed", feed_url)
        except DependencyError:
            raise
        except Exception as error:
            failures.append(f"feed: {error}")
            log(f"audio: feed failed ({error})")
    if not youtube_url and not feed_url:
        raise AudioUnavailableError("no audio source: the episode has no youtubeId and no matching feed item")
    raise AudioUnavailableError("could not get the audio: " + "; ".join(failures))
