"""Session log: one JSON object per line in ``%APPDATA%\\vtol-gcs\\logs\\session-<UTC>.jsonl``.

Every record has ``t`` (ISO-8601 UTC, ms), ``mono_s`` (seconds since the
session started, monotonic) and ``type``.  The record types and their fields
are documented in ``gcs/README.md`` ("Session log schema"); WP11 builds a viewer for it.

Writing happens in a background thread fed by a bounded queue, so the RC
sender never waits for the disk.  If the queue is full a record is dropped and
counted (``dropped`` in the ``session_end`` record).
"""

from __future__ import annotations

import json
import logging
import math
import queue
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .alarms import iso_utc

log = logging.getLogger("vtolgcs.session_log")

SCHEMA = "vtol-gcs-session/1"
QUEUE_MAX = 10000


def clean(value: Any) -> Any:
    """JSON-safe copy: non-finite floats -> None, tuples -> lists, enums -> value."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if hasattr(value, "value") and not isinstance(value, (int, str, bool)):
        return clean(value.value)
    if isinstance(value, (int, str, bool)) or value is None:
        return value
    return str(value)


def session_filename(when: datetime) -> str:
    return "session-" + when.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".jsonl"


class SessionLog:
    """Thread-safe JSONL writer. ``write(type, **fields)`` never blocks."""

    def __init__(self, directory: Path, clock: Callable[[], float] = time.perf_counter,
                 wall: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
        self._clock = clock
        self._wall = wall
        self._t0 = clock()
        directory.mkdir(parents=True, exist_ok=True)
        name = session_filename(wall())
        path = directory / name
        n = 1
        while path.exists():
            path = directory / name.replace(".jsonl", f"-{n}.jsonl")
            n += 1
        self.path = path
        self._file = open(path, "w", encoding="utf-8", newline="\n")
        self._queue: queue.Queue[str | None] = queue.Queue(QUEUE_MAX)
        self.dropped = 0
        self.written = 0
        self._closed = False
        self._thread = threading.Thread(target=self._run, name="session-log", daemon=True)
        self._thread.start()

    def write(self, rtype: str, **fields: Any) -> None:
        if self._closed:
            return
        rec = {"t": iso_utc(self._wall()), "mono_s": round(self._clock() - self._t0, 4), "type": rtype}
        rec.update(clean(fields))
        try:
            self._queue.put_nowait(json.dumps(rec, separators=(",", ":"), allow_nan=False))
        except queue.Full:
            self.dropped += 1
        except (TypeError, ValueError) as exc:  # pragma: no cover - clean() makes this unreachable
            log.warning("unloggable %s record: %s", rtype, exc)

    def _run(self) -> None:
        last_flush = time.monotonic()
        while True:
            try:
                line = self._queue.get(timeout=0.5)
            except queue.Empty:
                line = ""
            if line is None:
                break
            if line:
                self._file.write(line + "\n")
                self.written += 1
            if time.monotonic() - last_flush >= 1.0:
                self._file.flush()
                last_flush = time.monotonic()
        self._file.flush()

    def close(self, **fields: Any) -> None:
        """Write ``session_end`` (with counters) and close the file."""
        if self._closed:
            return
        self.write("session_end", dropped=self.dropped, **fields)
        self._closed = True
        self._queue.put(None)
        self._thread.join(timeout=5)
        self._file.close()
