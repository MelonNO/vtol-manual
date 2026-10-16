"""Session log writer (brief R11). The record types written by the runtime are checked in test_runtime_e2e."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from vtolgcs.sender import Mode
from vtolgcs.session_log import SessionLog, clean, session_filename

WALL = datetime(2026, 10, 16, 12, 34, 56, 789000, tzinfo=timezone.utc)


def test_filename_is_utc() -> None:
    assert session_filename(WALL) == "session-20261016T123456Z.jsonl"


def test_clean_makes_json_safe() -> None:
    assert clean({"a": float("nan"), "b": (1, 2), "m": Mode.FPV, "x": float("inf"), 3: None}) == \
        {"a": None, "b": [1, 2], "m": "fpv", "x": None, "3": None}


def test_records_and_end(tmp_path: Path) -> None:
    t = [100.0]
    log = SessionLog(tmp_path, clock=lambda: t[0], wall=lambda: WALL)
    t[0] = 100.5
    log.write("mode", mode="fpv", reasons=("a", "b"))
    log.close(packets_sent=7)
    recs = [json.loads(x) for x in log.path.read_text(encoding="utf-8").splitlines()]
    assert recs[0] == {"t": "2026-10-16T12:34:56.789Z", "mono_s": 0.5, "type": "mode", "mode": "fpv",
                       "reasons": ["a", "b"]}
    assert recs[1]["type"] == "session_end" and recs[1]["dropped"] == 0 and recs[1]["packets_sent"] == 7
    log.write("late", x=1)                              # after close: ignored, no exception


def test_same_second_gets_a_new_file(tmp_path: Path) -> None:
    a = SessionLog(tmp_path, wall=lambda: WALL)
    b = SessionLog(tmp_path, wall=lambda: WALL)
    a.close()
    b.close()
    assert a.path != b.path and b.path.name == "session-20261016T123456Z-1.jsonl"
