"""Who said each word, segment splitting and speaker names (DESIGN.md §7.4)."""

from __future__ import annotations

import re
import unicodedata
from typing import Any

Word = dict[str, Any]  # {"start", "end", "word"}
Turn = dict[str, Any]  # {"start", "end", "speaker"}
Piece = dict[str, Any]  # {"label", "start", "end", "text"}

# Titles/suffixes that are not useful to recognise a name in speech.
_NAME_NOISE = {"dr", "prof", "professor", "mr", "mrs", "ms", "sir", "jr", "sr", "ii", "iii", "iv", "phd", "md"}


def _distance(t: Turn, start: float, end: float) -> float:
    return max(0.0, t["start"] - end, start - t["end"])


def assign_speakers(words: list[Word], turns: list[Turn]) -> list[str | None]:
    """Diarization label for each word: the turn it overlaps most in time.

    A word overlapping no turn (diarization VAD gap, zero-length word) takes the
    nearest turn; on a tie the previous word's speaker wins. Linear sweep, so a
    2-hour episode (~25k words, ~1-2k turns) takes milliseconds.
    """
    turns = sorted(turns, key=lambda t: (t["start"], t["end"]))
    order = sorted(range(len(words)), key=lambda i: (words[i]["start"], words[i]["end"]))
    labels: list[str | None] = [None] * len(words)
    active: list[Turn] = []
    last_ended: Turn | None = None
    p = 0
    prev: str | None = None
    for i in order:
        ws, we = words[i]["start"], words[i]["end"]
        while p < len(turns) and turns[p]["start"] < we:
            active.append(turns[p])
            p += 1
        still = []
        for t in active:
            if t["end"] < ws:
                if last_ended is None or t["end"] > last_ended["end"]:
                    last_ended = t
            else:
                still.append(t)
        active = still
        best, best_overlap = None, 0.0
        for t in active:
            overlap = min(we, t["end"]) - max(ws, t["start"])
            if overlap > best_overlap:
                best, best_overlap = t["speaker"], overlap
        if best is None:
            candidates = [*active, *([last_ended] if last_ended else []), *([turns[p]] if p < len(turns) else [])]
            if candidates:
                dmin = min(_distance(t, ws, we) for t in candidates)
                nearest = [t["speaker"] for t in candidates if _distance(t, ws, we) == dmin]
                best = prev if prev in nearest else nearest[0]
            else:
                best = prev
        labels[i] = best
        prev = best
    return labels


def smooth_islands(labels: list[str | None], words: list[Word], max_words: int = 1, max_seconds: float = 1.0) -> list[str | None]:
    """Relabels short A-B-A islands inside one Whisper segment (diarization flicker at turn edges).

    Only interior runs of at most `max_words` words lasting at most
    `max_seconds` are changed; runs at a segment's edges are left alone (a
    speaker change often falls exactly there).
    """
    out = list(labels)
    i = 0
    n = len(out)
    while i < n:
        j = i
        while j + 1 < n and out[j + 1] == out[i]:
            j += 1
        if 0 < i and j < n - 1 and out[i - 1] == out[j + 1] != out[i]:
            length = j - i + 1
            seconds = words[j]["end"] - words[i]["start"]
            if length <= max_words and seconds <= max_seconds:
                for k in range(i, j + 1):
                    out[k] = out[i - 1]
        i = j + 1
    return out


def split_segments(segments: list[dict[str, Any]], turns: list[Turn], smooth: bool = True) -> list[Piece]:
    """Whisper segments → pieces with one speaker each, split where the speaker changes."""
    words = [w for seg in segments for w in seg.get("words") or []]
    labels = assign_speakers(words, turns)
    pieces: list[Piece] = []
    k = 0
    for seg in segments:
        seg_words = seg.get("words") or []
        if not seg_words:
            label = assign_speakers([{"start": seg["start"], "end": seg["end"], "word": ""}], turns)[0]
            if seg.get("text", "").strip():
                pieces.append({"label": label, "start": seg["start"], "end": seg["end"], "text": seg["text"].strip()})
            continue
        seg_labels = labels[k : k + len(seg_words)]
        k += len(seg_words)
        if smooth:
            seg_labels = smooth_islands(seg_labels, seg_words)
        current: Piece | None = None
        for w, label in zip(seg_words, seg_labels):
            if current is None or label != current["label"]:
                current = {"label": label, "start": w["start"], "end": w["end"], "text": ""}
                pieces.append(current)
            current["text"] += w["word"]
            current["end"] = w["end"]
    for piece in pieces:
        piece["text"] = re.sub(r"\s+", " ", piece["text"]).strip()
    return [p for p in pieces if p["text"]]


def appearance_order(pieces: list[Piece]) -> list[str]:
    order: list[str] = []
    for piece in pieces:
        if piece["label"] is not None and piece["label"] not in order:
            order.append(piece["label"])
    return order


def _normalize(text: str) -> list[str]:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"['’]s\b", "", text)
    return re.findall(r"[a-z0-9]+", text)


def surname_keys(names: list[str] | tuple[str, ...]) -> set[str]:
    """Last meaningful token of each name ("Dr. Jane Q. Doe Jr." → "doe"), at least 3 letters."""
    keys = set()
    for name in names:
        tokens = [t for t in _normalize(name) if t not in _NAME_NOISE]
        if tokens and len(tokens[-1]) >= 3:
            keys.add(tokens[-1])
    return keys


def detect_host(pieces: list[Piece], guest_names: list[str] | tuple[str, ...], window: float = 600.0) -> tuple[str | None, str]:
    """Diarization label of the host and how it was chosen.

    Heuristic "first speaker = host", refined for cold opens (an episode that
    starts with a clip of the guest): if within the first `window` seconds
    someone says a guest's surname, the first such speaker is the host
    introducing the guest ("…a conversation with Jane Doe"). Returns
    `(label, "intro-mention" | "first-speaker")`.
    """
    order = appearance_order(pieces)
    if not order:
        return None, "first-speaker"
    keys = surname_keys(guest_names)
    if keys:
        for piece in pieces:
            if piece["start"] >= window:
                break
            if piece["label"] is not None and keys.intersection(_normalize(piece["text"])):
                return piece["label"], "intro-mention"
    return order[0], "first-speaker"


def name_speakers(order: list[str], host_label: str | None, host_name: str, guest_names: list[str] | tuple[str, ...]) -> dict[str, str]:
    """Host label → host name; the others → guests in order of appearance, then "Speaker N"."""
    names: dict[str, str] = {}
    if host_label is not None:
        names[host_label] = host_name
    guests = [g for g in guest_names if g != host_name]
    gi = 0
    for position, label in enumerate(order, start=1):
        if label in names:
            continue
        if gi < len(guests):
            names[label] = guests[gi]
            gi += 1
        else:
            names[label] = f"Speaker {position}"
    return names


def to_transcript_segments(pieces: list[Piece], names: dict[str, str]) -> list[dict[str, Any]]:
    """Unified-format segments `{speaker?, start, text}` (DESIGN.md §4.3), start rounded to 0.01 s."""
    out = []
    for piece in pieces:
        seg: dict[str, Any] = {}
        name = names.get(piece["label"]) if piece["label"] is not None else None
        if name:
            seg["speaker"] = name
        seg["start"] = round(max(0.0, piece["start"]), 2)
        seg["text"] = piece["text"]
        out.append(seg)
    return out
