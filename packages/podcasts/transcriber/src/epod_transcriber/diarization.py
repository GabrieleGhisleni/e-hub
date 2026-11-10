"""Diarization on the whole WAV (DESIGN.md §7.4): `diarize` by default, pyannote as opt-in plan B."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from typing import Any

from .util import DependencyError

PYANNOTE_PIPELINE = "pyannote/speaker-diarization-community-1"
PYANNOTE_HELP = (
    "pyannote is an optional plan B and is not installed by default. To use it:\n"
    "  uv sync --project transcriber --extra pyannote\n"
    f"  accept the model terms on https://huggingface.co/{PYANNOTE_PIPELINE}\n"
    "  export HF_TOKEN=<your Hugging Face token>\n"
    "Note: it is ~100 min for 2 h of audio on this CPU (DESIGN.md §7.4)."
)


def check_diarizer(diarizer: str) -> None:
    """Fails early (before any download) when the chosen diarizer cannot run."""
    if diarizer == "pyannote":
        if importlib.util.find_spec("pyannote") is None or importlib.util.find_spec("pyannote.audio") is None:
            raise DependencyError("--diarizer pyannote: pyannote.audio is not installed.\n" + PYANNOTE_HELP)
        if not os.environ.get("HF_TOKEN"):
            raise DependencyError("--diarizer pyannote: HF_TOKEN is not set.\n" + PYANNOTE_HELP)
    elif importlib.util.find_spec("diarize") is None:  # pragma: no cover - hard dependency
        raise DependencyError("diarize is not installed in the transcriber environment (run `uv sync --project transcriber`)")


def _diarize(wav: Path, num_speakers: int | None) -> list[dict[str, Any]]:
    from diarize import diarize

    result = diarize(str(wav), num_speakers=num_speakers) if num_speakers else diarize(str(wav))
    return [{"start": float(s.start), "end": float(s.end), "speaker": str(s.speaker)} for s in result.segments]


def _pyannote(wav: Path, num_speakers: int | None) -> list[dict[str, Any]]:  # pragma: no cover - optional, needs a token
    import torch
    from pyannote.audio import Pipeline

    from .audio import SAMPLE_RATE, read_wav, wav_duration

    pipeline = Pipeline.from_pretrained(PYANNOTE_PIPELINE, token=os.environ["HF_TOKEN"])
    samples = read_wav(wav, 0.0, wav_duration(wav))
    audio = {"waveform": torch.from_numpy(samples)[None, :], "sample_rate": SAMPLE_RATE}
    output = pipeline(audio, num_speakers=num_speakers) if num_speakers else pipeline(audio)
    # pyannote 4 returns an object with (exclusive_)speaker_diarization; 3.x returns the Annotation itself.
    annotation = getattr(output, "exclusive_speaker_diarization", None) or getattr(output, "speaker_diarization", output)
    return [
        {"start": float(turn.start), "end": float(turn.end), "speaker": str(speaker)}
        for turn, _, speaker in annotation.itertracks(yield_label=True)
    ]


def run_diarization(diarizer: str, wav: Path, num_speakers: int | None) -> list[dict[str, Any]]:
    """Speaker turns `[{start, end, speaker}]` for the whole file, sorted by start."""
    turns = _pyannote(wav, num_speakers) if diarizer == "pyannote" else _diarize(wav, num_speakers)
    return sorted(turns, key=lambda t: (t["start"], t["end"]))
