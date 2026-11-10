"""e-podcasts transcriber: audio -> diarized transcript (DESIGN.md §7).

Entry point: ``python -m epod_transcriber <job.json|->`` (normally launched by
``pnpm transcribe <slug>``). Heavy dependencies (faster-whisper, diarize,
yt-dlp, pyannote) are imported lazily, so the pure modules (chunks, speakers,
cache) load and test fast.
"""

__version__ = "0.1.0"
