"""Compare a whisper-local transcript with an official reference (dev tool, phase 8 evidence).

Usage (from the repo root):
  uv run --project transcriber python transcriber/tools/evaluate.py <transcript.json> <reference.json> [--window 600]

`reference.json` is the output of `transcriber/trial/reference.py` (official
Lex transcript: segments with speaker, start, text). Prints WER on normalised
text and speaker accuracy on the aligned (identical) words: overall, by name as
written in both files (so it also checks the host/guest naming), and per time
window (labels flipping mid-episode would show up as a bad window).
Outputs numbers only — no transcript text.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path


def norm(text: str) -> list[str]:
    text = text.lower().replace("’", "'").replace("-", " ")
    text = re.sub(r"[^a-z0-9' ]+", " ", text)
    return text.split()


def timed_words(segments: list[dict], end: float) -> list[dict]:
    """Words with a time interpolated linearly inside each segment, and the segment's speaker."""
    out = []
    for i, seg in enumerate(segments):
        stop = segments[i + 1]["start"] if i + 1 < len(segments) else end
        tokens = norm(seg["text"])
        for k, tok in enumerate(tokens):
            t = seg["start"] + (max(stop, seg["start"]) - seg["start"]) * (k + 0.5) / max(len(tokens), 1)
            out.append({"w": tok, "t": t, "speaker": seg.get("speaker")})
    return out


def main() -> None:
    import jiwer

    p = argparse.ArgumentParser()
    p.add_argument("transcript")
    p.add_argument("reference")
    p.add_argument("--window", type=float, default=600.0)
    a = p.parse_args()
    hyp_t = json.loads(Path(a.transcript).read_text())
    ref_t = json.loads(Path(a.reference).read_text())
    duration = hyp_t.get("extra", {}).get("transcriber", {}).get("audioDuration") or hyp_t["segments"][-1]["start"] + 10
    ref = timed_words([s for s in ref_t["segments"] if s["start"] < duration], duration)
    hyp = timed_words(hyp_t["segments"], duration)
    ref_text = " ".join(x["w"] for x in ref)
    hyp_text = " ".join(x["w"] for x in hyp)
    out = jiwer.process_words(ref_text, hyp_text)
    total = ok = 0
    by_window: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    confusion: dict[tuple[str, str], int] = defaultdict(int)
    for chunk in out.alignments[0]:
        if chunk.type != "equal":
            continue
        for k in range(chunk.ref_end_idx - chunk.ref_start_idx):
            r = ref[chunk.ref_start_idx + k]
            h = hyp[chunk.hyp_start_idx + k]
            same = r["speaker"] == h["speaker"]
            total += 1
            ok += same
            w = by_window[int(r["t"] // a.window)]
            w[0] += same
            w[1] += 1
            confusion[(r["speaker"], h["speaker"])] += 1
    # long runs of missing words (e.g. text lost at a chunk boundary or by VAD): (minute mark, words)
    deletion_runs = [
        (round(ref[c.ref_start_idx]["t"] / 60, 1), c.ref_end_idx - c.ref_start_idx)
        for c in out.alignments[0]
        if c.type == "delete" and c.ref_end_idx - c.ref_start_idx >= 5
    ]
    result = {
        "audio_seconds": duration,
        "ref_words": len(ref),
        "hyp_words": len(hyp),
        "wer": round(out.wer, 4),
        "substitutions": out.substitutions,
        "deletions": out.deletions,
        "insertions": out.insertions,
        "deletion_runs_min_words": deletion_runs,
        "aligned_words": total,
        "speaker_accuracy_by_name": round(ok / max(total, 1), 4),
        "confusion_ref_to_hyp": {f"{r} -> {h}": n for (r, h), n in sorted(confusion.items(), key=lambda x: -x[1])},
        "per_window": {
            f"{int(k * a.window // 60)}-{int((k + 1) * a.window // 60)} min": f"{v[0] / v[1]:.3f} ({v[1]} words)"
            for k, v in sorted(by_window.items())
        },
    }
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
