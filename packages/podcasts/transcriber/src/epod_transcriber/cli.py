"""`python -m epod_transcriber <job.json|->` — run one transcription job.

Progress goes to stderr; the transcript is written to the job's `outputPath`.
Exit codes: 0 ok, 1 unexpected, 2 bad job, 3 audio unavailable, 4 missing
dependency (ffmpeg, pyannote, HF_TOKEN), 5 already running, 130 interrupted
(SIGINT or SIGTERM: finished chunks stay cached, the same job resumes).
"""

from __future__ import annotations

import json
import signal
import sys
import traceback
import warnings
from pathlib import Path

from .job import parse_job
from .util import JobError, TranscriberError, log


def _interrupt(signum: int, _frame: object) -> None:
    raise KeyboardInterrupt(f"signal {signum}")


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1 or args[0] in ("-h", "--help"):
        print(__doc__.strip(), file=sys.stderr)
        return 0 if args and args[0] in ("-h", "--help") else 2
    # torchaudio/diarize deprecation chatter would drown the progress lines
    warnings.filterwarnings("ignore", category=UserWarning)
    warnings.filterwarnings("ignore", category=DeprecationWarning)
    warnings.filterwarnings("ignore", category=FutureWarning)
    # `kill <pid in the lock file>` (SIGTERM) or SIGINT stop cleanly: caches stay, lock released, exit 130.
    # SIGINT is re-armed explicitly: a job started in the background inherits it ignored.
    signal.signal(signal.SIGTERM, _interrupt)
    signal.signal(signal.SIGINT, _interrupt)
    try:
        text = sys.stdin.read() if args[0] == "-" else Path(args[0]).read_text()
        try:
            data = json.loads(text)
        except json.JSONDecodeError as error:
            raise JobError(f"job is not valid JSON: {error}") from error
        job = parse_job(data)
        from .pipeline import run

        run(job)
        return 0
    except KeyboardInterrupt:
        # a second Ctrl-C (or a forwarded signal) must not break the clean exit
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        log("interrupted: finished chunks and the diarization are cached; run the same command again to resume")
        return 130
    except TranscriberError as error:
        log(f"error: {error}")
        return error.exit_code
    except OSError as error:
        log(f"error: {error}")
        return 1
    except Exception:
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
