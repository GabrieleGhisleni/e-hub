"""Chunking for transcription and resume (DESIGN.md §7.3).

The WAV is split into ~10-minute chunks only so that finished chunks can be
cached and a relaunch resumes from the next one. To avoid cutting words:

1. each cut is moved to the quietest half-second within ±`search` seconds of
   its nominal position (a pause between words or sentences);
2. each chunk is transcribed with extra audio on both sides, and only the
   words whose midpoint falls inside the chunk's own (core) range are kept, so
   a word straddling a cut is kept exactly once. The left padding is a whole
   Whisper window (30 s): starting a chunk mid-speech with an initial_prompt,
   faster-whisper sometimes skips its entire first 30 s window (seen in phase 8:
   87 words lost at a cut); with the padding, a skipped first window only loses
   audio the previous chunk already covers.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np

Segment = dict[str, Any]  # {"start", "end", "text", "words": [{"start", "end", "word"}]}


def nominal_cuts(duration: float, chunk_seconds: float) -> list[float]:
    """Interior cut positions splitting `duration` into equal chunks of about `chunk_seconds`."""
    n = max(1, round(duration / chunk_seconds))
    return [duration * k / n for k in range(1, n)]


def plan_chunks(
    duration: float,
    chunk_seconds: float,
    find_cut: Callable[[float, float], float] | None = None,
    search: float = 30.0,
) -> list[tuple[float, float]]:
    """Core ranges `[(start, end), …]` covering `[0, duration]` without gaps.

    `find_cut(lo, hi)` returns the best cut time inside `[lo, hi]` (e.g. the
    quietest point); without it the nominal positions are used.
    """
    if duration <= 0:
        return []
    cuts: list[float] = []
    for target in nominal_cuts(duration, chunk_seconds):
        lo = max(target - search, (cuts[-1] if cuts else 0.0) + 1.0)
        hi = min(target + search, duration - 1.0)
        cut = find_cut(lo, hi) if find_cut and lo < hi else target
        cuts.append(min(max(cut, lo), hi) if lo < hi else target)
    bounds = [0.0, *cuts, duration]
    return [(round(a, 3), round(b, 3)) for a, b in zip(bounds, bounds[1:])]


def quietest_time(samples: np.ndarray, sample_rate: int, offset: float, window: float = 0.5, hop: float = 0.05) -> float:
    """Centre time (absolute: `offset` + position) of the lowest-energy `window` in `samples`."""
    x = samples.astype(np.float64)
    win = max(1, int(window * sample_rate))
    step = max(1, int(hop * sample_rate))
    if len(x) <= win:
        return offset + len(x) / sample_rate / 2
    energy = np.concatenate(([0.0], np.cumsum(x * x)))
    starts = np.arange(0, len(x) - win + 1, step)
    sums = energy[starts + win] - energy[starts]
    best = int(starts[int(np.argmin(sums))])
    return offset + (best + win / 2) / sample_rate


def padded_range(core: tuple[float, float], duration: float, left: float, right: float) -> tuple[float, float]:
    """The audio actually fed to Whisper for a chunk: its core range plus `left`/`right` padding."""
    return max(0.0, core[0] - left), min(duration, core[1] + right)


def offset_segments(segments: list[Segment], offset: float) -> list[Segment]:
    """Shifts chunk-relative times to absolute episode times."""
    out = []
    for seg in segments:
        out.append(
            {
                **seg,
                "start": seg["start"] + offset,
                "end": seg["end"] + offset,
                "words": [{**w, "start": w["start"] + offset, "end": w["end"] + offset} for w in seg.get("words", [])],
            }
        )
    return out


def _inside(t: float, core: tuple[float, float], first: bool, last: bool) -> bool:
    return (first or t >= core[0]) and (last or t < core[1])


def keep_core(segments: list[Segment], core: tuple[float, float], *, first: bool, last: bool) -> list[Segment]:
    """Keeps only what belongs to this chunk's core range (absolute times).

    Words are kept iff their midpoint is in `[core.start, core.end)` (the first
    chunk has no lower bound, the last no upper bound), so adjacent chunks never
    both keep — or both drop — the same word. Segments lose the words outside;
    empty ones are dropped. A segment without word timings is kept iff its
    midpoint is inside.
    """
    out = []
    for seg in segments:
        words = seg.get("words") or []
        if not words:
            if _inside((seg["start"] + seg["end"]) / 2, core, first, last):
                out.append(seg)
            continue
        kept = [w for w in words if _inside((w["start"] + w["end"]) / 2, core, first, last)]
        if not kept:
            continue
        if len(kept) == len(words):
            out.append(seg)
        else:
            out.append(
                {
                    **seg,
                    "start": kept[0]["start"],
                    "end": kept[-1]["end"],
                    "text": "".join(w["word"] for w in kept).strip(),
                    "words": kept,
                }
            )
    return out
