"""WP17: the guards in ``gcs/conftest.py`` that keep the suite from hanging a CI job.

A throw-away tree gets a copy of the real ``conftest.py`` and tests that hang in the ways a CI job can: waiting on a
child forever, polling forever, blocked in a call that no exception can interrupt, leaking a child.  The run must
name each hanging test, print the stacks of all threads, kill the processes, report the test FAILED and go on (or,
if the main thread stays blocked, exit with status 1).  Plus the interactive-session detection and a static rule:
every subprocess call in the tests has a timeout.
"""

from __future__ import annotations

import ast
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

GCS_DIR = Path(__file__).resolve().parents[1]
TESTS_DIR = Path(__file__).resolve().parent

HANGS = '''
import subprocess, sys, time

import pytest

SLEEPER = [sys.executable, "-c", "import time; time.sleep(600)"]


def test_waits_on_a_child_forever():
    subprocess.Popen(SLEEPER).wait()


def test_polls_forever():
    while True:
        time.sleep(0.05)


def test_leaks_a_child():
    proc = subprocess.Popen(SLEEPER)
    with open("leaked.pid", "w") as f:
        f.write(str(proc.pid))


@pytest.mark.interactive_desktop
def test_needs_a_desktop():
    pass


def test_still_runs_after_them():
    pass
'''

BLOCKED = '''
import time


def test_blocked_in_a_c_call():
    time.sleep(600)          # an asynchronous exception cannot interrupt this: hard exit


def test_never_reached():
    pass
'''


def _alive(pid: int) -> bool:
    import ctypes
    k = ctypes.WinDLL("kernel32")
    k.OpenProcess.restype = ctypes.c_void_p
    h = k.OpenProcess(0x1000, False, pid)                        # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    try:
        code = ctypes.c_ulong()
        k.GetExitCodeProcess(ctypes.c_void_p(h), ctypes.byref(code))
        return code.value == 259                                 # STILL_ACTIVE
    finally:
        k.CloseHandle(ctypes.c_void_p(h))


def _run_tree(tmp_path: Path, name: str, source: str, **env: str) -> tuple[subprocess.CompletedProcess, Path]:
    root = tmp_path / name / "gcs"
    (root / "tests").mkdir(parents=True)
    shutil.copy(GCS_DIR / "conftest.py", root / "conftest.py")
    (root / "tests" / f"test_{name}.py").write_text(source, encoding="utf-8")
    full = {k: v for k, v in os.environ.items() if k not in ("CI", "GITHUB_ACTIONS", "VTOLGCS_INTERACTIVE_TESTS")}
    full.update({"PYTHONUNBUFFERED": "1", "VTOLGCS_TEST_TIMEOUT": "3", "VTOLGCS_TEST_GRACE": "4",
                 "VTOLGCS_TEST_DUMP_DIR": str(root / "dumps"), "VTOLGCS_LIVE_TEST_NAMES": "1"}, **env)
    proc = subprocess.run([sys.executable, "-m", "pytest", "-v", "-rfEs", "-p", "no:cacheprovider", "tests"],
                          cwd=root, env=full, capture_output=True, text=True, timeout=120)
    return proc, root


@pytest.mark.skipif(sys.platform != "win32", reason="the process guard is Windows only (the suite's platform)")
def test_a_hanging_test_is_named_dumped_killed_and_failed_and_the_run_goes_on(tmp_path: Path) -> None:
    proc, root = _run_tree(tmp_path, "hangs", HANGS, CI="true")
    out = proc.stdout + proc.stderr
    assert proc.returncode == 1, out
    assert "interactive_desktop tests SKIPPED (CI=true" in out                     # the header says why
    for test in ("test_waits_on_a_child_forever", "test_polls_forever"):
        assert f"+++ TIMEOUT [" in out and f"tests/test_hangs.py::{test} still running after 3 s" in out, out
        assert f"FAILED tests/test_hangs.py::{test}" in out, out                  # the short summary
        assert f"in {test}" in out, out                          # the faulthandler stack names the test function
    assert "TestTimeout" in out
    assert "Thread 0x" in out or "Current thread 0x" in out                         # faulthandler: all threads
    assert "test_hangs.py::test_leaks_a_child PASSED" in out, out
    pid = int((root / "leaked.pid").read_text())
    killed = [x for x in out.splitlines() if "test_leaks_a_child: killed process(es) still running after" in x]
    assert len(killed) == 1 and f"({pid}, " in killed[0], out
    assert not _alive(pid)
    assert "test_hangs.py::test_needs_a_desktop SKIPPED" in out and "needs an interactive desktop: CI=true" in out
    assert "test_hangs.py::test_still_runs_after_them PASSED" in out, out
    assert "] START tests/test_hangs.py::test_still_runs_after_them" in out                 # live test names
    assert "2 failed, 2 passed, 1 skipped" in out, out
    dump = (root / "dumps" / "pytest-timeouts.txt").read_text(encoding="utf-8")
    assert "test_waits_on_a_child_forever still running" in dump and "in test_polls_forever" in dump


@pytest.mark.skipif(sys.platform != "win32", reason="the process guard is Windows only (the suite's platform)")
def test_a_test_blocked_beyond_the_grace_period_ends_the_run_with_status_1(tmp_path: Path) -> None:
    proc, root = _run_tree(tmp_path, "blocked", BLOCKED)
    out = proc.stdout + proc.stderr
    assert proc.returncode == 1, out
    assert "test_blocked.py::test_blocked_in_a_c_call still running after 3 s" in out, out
    assert "test_blocked.py::test_blocked_in_a_c_call is still blocked 4 s later: hard exit (status 1)" in out, out
    assert "in test_blocked_in_a_c_call" in out                                     # the stack of the main thread
    assert "test_never_reached PASSED" not in out


def _guards():
    """The ``gcs/conftest.py`` module as loaded by this pytest run."""
    import conftest
    assert hasattr(conftest, "interactive_session"), conftest.__file__
    return conftest


def test_interactive_session_detection(monkeypatch) -> None:
    g = _guards()
    for name in ("CI", "GITHUB_ACTIONS", "VTOLGCS_INTERACTIVE_TESTS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    ok, why = g.interactive_session()
    assert not ok and why.startswith("GITHUB_ACTIONS=true: a CI runner")
    monkeypatch.delenv("GITHUB_ACTIONS")
    monkeypatch.setenv("CI", "1")
    assert g.interactive_session()[0] is False
    monkeypatch.setenv("VTOLGCS_INTERACTIVE_TESTS", "1")                       # forced on, even on CI
    assert g.interactive_session() == (True, "VTOLGCS_INTERACTIVE_TESTS=1")
    monkeypatch.setenv("VTOLGCS_INTERACTIVE_TESTS", "0")
    assert g.interactive_session() == (False, "VTOLGCS_INTERACTIVE_TESTS=0")
    monkeypatch.delenv("VTOLGCS_INTERACTIVE_TESTS")
    monkeypatch.setenv("CI", "false")                                           # "false" is not CI
    ok, why = g.interactive_session()
    if sys.platform == "win32":
        station, visible, session = g._window_station()
        print(f"window station {station!r}, visible {visible}, session {session}: {ok} ({why})")
        assert ok == (visible and session != 0), why


SUBPROCESS_CALLS = {"run", "call", "check_call", "check_output"}


def test_every_subprocess_call_in_the_tests_has_a_timeout() -> None:
    """WP17 R1: ``subprocess.run`` / ``call`` / ``check_call`` / ``check_output`` and ``communicate()`` always
    pass ``timeout=``; ``Popen`` children are bounded by ``wait(t)`` and killed by the conftest guard."""
    missing = []
    for path in sorted(TESTS_DIR.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(source)):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            f = node.func
            is_sub = f.attr in SUBPROCESS_CALLS and isinstance(f.value, ast.Name) and f.value.id == "subprocess"
            if (is_sub or f.attr == "communicate") and not any(k.arg == "timeout" for k in node.keywords):
                missing.append(f"{path.name}:{node.lineno}: {ast.get_source_segment(source, node)[:80]}")
    assert missing == []
