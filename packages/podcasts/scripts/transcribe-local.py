"""Produce a private upload for the podcast transcript form using local Whisper."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video_id")
    parser.add_argument("--model", default="base")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", args.video_id):
        parser.error("ID YouTube non valido")

    import whisper

    output = Path.home() / f"trascrizione-{args.video_id}.json"
    if output.exists():
        parser.error(f"Il risultato esiste già: {output}. Caricalo o rinominalo per rifare la trascrizione.")
    with TemporaryDirectory(prefix="ehub-whisper-") as directory:
        audio = Path(directory) / "audio"
        subprocess.run(
            ["yt-dlp", "--no-playlist", "-f", "bestaudio/best", "-o", str(audio),
             f"https://www.youtube.com/watch?v={args.video_id}"],
            check=True,
        )
        model = whisper.load_model(args.model)
        result = model.transcribe(str(audio), verbose=False)
        segments = [
            {key: segment[key] for key in ("start", "end", "text")}
            for segment in result["segments"] if segment["text"].strip()
        ]
        with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as file:
            json.dump({"videoId": args.video_id, "model": args.model, "result": {"segments": segments}},
                      file, ensure_ascii=False)
    print(f"Carica questo file nell'app: {output}")


if __name__ == "__main__":
    main()
