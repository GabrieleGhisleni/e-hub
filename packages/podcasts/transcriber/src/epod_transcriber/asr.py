"""faster-whisper, sequential decoding with VAD and word timestamps (DESIGN.md §7.3, revised after phase 2)."""

from __future__ import annotations

import time
from typing import Any

import numpy as np

from .util import log


class Transcriber:
    """Loads the Whisper model on first use (a fully cached resume never loads it)."""

    def __init__(self, model: str, cpu_threads: int) -> None:
        self.model_name = model
        self.cpu_threads = cpu_threads
        self._model: Any = None

    def _load(self) -> Any:
        if self._model is None:
            from faster_whisper import WhisperModel

            t0 = time.perf_counter()
            self._model = WhisperModel(self.model_name, device="cpu", compute_type="int8", cpu_threads=self.cpu_threads)
            log(f"asr: model {self.model_name} loaded in {time.perf_counter() - t0:.1f}s ({self.cpu_threads} threads)")
        return self._model

    def transcribe(self, samples: np.ndarray, prompt: str) -> list[dict[str, Any]]:
        """Segments with words, times relative to the start of `samples` (16 kHz float32)."""
        model = self._load()
        # Sequential `WhisperModel.transcribe`, not BatchedInferencePipeline: the batched one dropped
        # whole 30 s windows in the phase-2 trial (WER 17.8% vs 11.3%).
        segments, _info = model.transcribe(
            samples,
            language="en",
            word_timestamps=True,
            vad_filter=True,
            initial_prompt=prompt or None,
        )
        out = []
        for s in segments:
            out.append(
                {
                    "start": float(s.start),
                    "end": float(s.end),
                    "text": s.text.strip(),
                    "words": [{"start": float(w.start), "end": float(w.end), "word": w.word} for w in (s.words or [])],
                }
            )
        return out
