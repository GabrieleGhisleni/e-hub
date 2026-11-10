"""Small shared helpers: logging, atomic JSON files, the per-episode run lock."""

from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class TranscriberError(Exception):
    """An expected failure with a clear message; `exit_code` is the process exit code."""

    exit_code = 1


class JobError(TranscriberError):
    exit_code = 2


class AudioUnavailableError(TranscriberError):
    exit_code = 3


class DependencyError(TranscriberError):
    exit_code = 4


class AlreadyRunningError(TranscriberError):
    exit_code = 5


def log(message: str) -> None:
    """Progress line on stderr: wall-clock time, 1-min load average, message."""
    load = os.getloadavg()[0]
    print(f"[{time.strftime('%H:%M:%S')} load {load:4.1f}] {message}", file=sys.stderr, flush=True)


def fmt_time(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def read_json(path: Path) -> Any | None:
    """Parsed JSON, or None if the file is missing or unreadable (a torn cache counts as missing)."""
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def write_json_atomic(path: Path, value: Any) -> None:
    """Writes via a temp file + rename, so an interrupted run never leaves a half-written cache."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False))
    os.replace(tmp, path)


def load_cached(path: Path, params: dict[str, Any]) -> dict[str, Any] | None:
    """A cache entry is valid only if it was produced with exactly the same params."""
    data = read_json(path)
    if isinstance(data, dict) and data.get("params") == params:
        return data
    return None


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


@dataclass
class RunLock:
    """`<work dir>/lock` holding our pid; a lock left by a dead process is taken over."""

    path: Path

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            other = int(self.path.read_text().strip() or "0")
        except (FileNotFoundError, ValueError):
            other = 0
        if other and other != os.getpid() and _pid_alive(other):
            raise AlreadyRunningError(
                f"another transcription of this episode is running (pid {other}); "
                f"stop it first or wait for it to finish (lock: {self.path})"
            )
        self.path.write_text(str(os.getpid()))

    def release(self) -> None:
        try:
            if self.path.read_text().strip() == str(os.getpid()):
                self.path.unlink()
        except FileNotFoundError:
            pass
