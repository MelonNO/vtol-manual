"""WP17: the guards in ``gcs/conftest.py`` that keep the suite from hanging a CI job.

A throw-away tree gets a copy of the real ``conftest.py`` and tests that hang in the ways a CI job can:
- waiting on a child forever, polling forever (Python watchdog: named, dumped, FAILED, the run goes on);
- sleeping in a call no exception interrupts (``time.sleep``: the watchdog's hard exit, status 1);
- **native code holding the GIL** (``ctypes.PyDLL`` -> ``kernel32.Sleep``), in a test and in an atexit handler: the
  Python threads cannot run, the faulthandler backstop (a C thread) dumps and exits 1; with faulthandler off, the
  exit watcher process ends the hung process with status 1;
- a leaked child and an orphaned grandchild (killed by PID after the test through the job object).
Plus the interactive-session detection and a static rule: every subprocess call in the tests has a timeout.
"""

from __future__ import annotations

import ast
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

GCS_DIR = Path(__file__).resolve().parents[1]
TESTS_DIR = Path(__file__).resolve().parent

HANGS = '''
import subprocess, sys, time

import pytest

SLEEPER = [sys.executable, "-c", "import time; time.sleep(600)"]
ORPHANER = ("import subprocess, sys; p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(600)']); "
            "open('orphan.pid', 'w').write(str(p.pid))")


def test_waits_on_a_child_forever():
    subprocess.Popen(SLEEPER).wait()


def test_polls_forever():
    while True:
        time.sleep(0.05)


def test_leaks_a_child():
    proc = subprocess.Popen(SLEEPER)
    with open("leaked.pid", "w") as f:
        f.write(str(proc.pid))


def test_orphans_a_grandchild():
    subprocess.run([sys.executable, "-c", ORPHANER], timeout=30)          # the child exits, its child stays


@pytest.mark.interactive_desktop
def test_needs_a_desktop():
    pass


def test_still_runs_after_them():
    pass
'''

BLOCKED = '''
import time


def test_sleeps_in_a_call_no_exception_interrupts():
    time.sleep(600)          # releases the GIL; an asynchronous exception waits for it: the watchdog's hard exit


def test_never_reached():
    pass
'''

NATIVE = '''
import ctypes


def test_holds_the_gil_in_native_code():
    ctypes.PyDLL("kernel32").Sleep(600000)        # PyDLL: the GIL stays held - no Python thread can run


def test_never_reached():
    pass
'''

AT_EXIT = '''
import atexit, ctypes


def test_registers_a_native_hang_at_exit():
    atexit.register(lambda: ctypes.PyDLL("kernel32").Sleep(600000))     # holds the GIL at interpreter exit
'''

FAST = {"VTOLGCS_TEST_TIMEOUT": "2", "VTOLGCS_TEST_GRACE": "1", "VTOLGCS_TEST_BACKSTOP_MARGIN": "2",
        "VTOLGCS_EXIT_GRACE": "2"}


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


def _run_tree(tmp_path: Path, name: str, source: str, **env: str) -> tuple[subprocess.CompletedProcess, Path, float]:
    root = tmp_path / name / "gcs"
    (root / "tests").mkdir(parents=True)
    shutil.copy(GCS_DIR / "conftest.py", root / "conftest.py")
    (root / "tests" / f"test_{name}.py").write_text(source, encoding="utf-8")
    full = {k: v for k, v in os.environ.items() if k not in ("CI", "GITHUB_ACTIONS", "VTOLGCS_INTERACTIVE_TESTS")}
    full.update({"PYTHONUNBUFFERED": "1", "VTOLGCS_TEST_TIMEOUT": "3", "VTOLGCS_TEST_GRACE": "4",
                 "VTOLGCS_TEST_DUMP_DIR": str(root / "dumps"), "VTOLGCS_LIVE_TEST_NAMES": "1"}, **env)
    t0 = time.monotonic()
    proc = subprocess.run([sys.executable, "-m", "pytest", "-v", "-rfEs", "-p", "no:cacheprovider", "tests"],
                          cwd=root, env=full, capture_output=True, text=True, timeout=120)
    return proc, root, time.monotonic() - t0


@pytest.mark.skipif(sys.platform != "win32", reason="the process guard is Windows only (the suite's platform)")
def test_a_hanging_test_is_named_dumped_killed_and_failed_and_the_run_goes_on(tmp_path: Path) -> None:
    proc, root, _ = _run_tree(tmp_path, "hangs", HANGS, CI="true")
    out = proc.stdout + proc.stderr
    assert proc.returncode == 1, out
    assert "interactive_desktop tests SKIPPED (CI=true" in out                     # the header says why
    assert "process cleanup after each test: job object" in out
    for test in ("test_waits_on_a_child_forever", "test_polls_forever"):
        assert f"+++ TIMEOUT [" in out and f"tests/test_hangs.py::{test} still running after 3 s" in out, out
        assert f"FAILED tests/test_hangs.py::{test}" in out, out                  # the short summary
        assert f"in {test}" in out, out                          # the faulthandler stack names the test function
    assert "TestTimeout raised in the main thread" in out
    assert "Thread 0x" in out or "Current thread 0x" in out                         # faulthandler: all threads
    for test, pidfile in (("test_leaks_a_child", "leaked.pid"), ("test_orphans_a_grandchild", "orphan.pid")):
        assert f"test_hangs.py::{test} PASSED" in out, out
        pid = int((root / pidfile).read_text())
        killed = [x for x in out.splitlines() if f"{test}: killed process(es) still running after" in x]
        assert len(killed) == 1 and f"({pid}, " in killed[0], out
        assert not _alive(pid), f"{test}: process {pid} outlived its test"
    assert "test_hangs.py::test_needs_a_desktop SKIPPED" in out and "needs an interactive desktop: CI=true" in out
    assert "test_hangs.py::test_still_runs_after_them PASSED" in out, out
    assert "] START tests/test_hangs.py::test_still_runs_after_them" in out                 # live test names
    assert "2 failed, 3 passed, 1 skipped" in out, out
    dump = (root / "dumps" / "pytest-timeouts.txt").read_text(encoding="utf-8")
    assert "test_waits_on_a_child_forever still running" in dump and "in test_polls_forever" in dump


@pytest.mark.skipif(sys.platform != "win32", reason="the process guard is Windows only (the suite's platform)")
def test_a_test_still_running_after_the_grace_period_ends_the_run_with_status_1(tmp_path: Path) -> None:
    proc, root, _ = _run_tree(tmp_path, "blocked", BLOCKED, **FAST)
    out = proc.stdout + proc.stderr
    assert proc.returncode == 1, out
    test = "test_blocked.py::test_sleeps_in_a_call_no_exception_interrupts"
    assert f"{test} still running after 2 s" in out, out
    assert f"{test} is still running 1 s later: hard exit (status 1)" in out, out
    assert "in test_sleeps_in_a_call_no_exception_interrupts" in out                 # the stack of the main thread
    assert "test_never_reached PASSED" not in out


@pytest.mark.skipif(sys.platform != "win32", reason="kernel32.Sleep: Windows")
def test_a_native_hang_holding_the_gil_is_dumped_and_exits_1(tmp_path: Path) -> None:
    """F1 (WP17 round 2): the Python watchdog cannot run; faulthandler's C thread dumps and exits at
    timeout 2 + grace 1 + margin 2 = 5 s."""
    proc, root, took = _run_tree(tmp_path, "native", NATIVE, **FAST)
    out = proc.stdout + proc.stderr
    assert proc.returncode == 1, out
    assert took < 30, took
    assert "] START tests/test_native.py::test_holds_the_gil_in_native_code" in out, out      # the test is named
    assert "Timeout (0:00:05)!" in out, out                                       # faulthandler's backstop
    assert "in test_holds_the_gil_in_native_code" in out, out                     # the hanging frame
    assert "+++ TIMEOUT [" not in out                                             # the Python thread never ran
    assert "test_never_reached" not in out.split("Timeout (0:00:05)!")[1]


@pytest.mark.skipif(sys.platform != "win32", reason="kernel32.Sleep: Windows")
@pytest.mark.parametrize("faulthandler_on", [True, False], ids=["faulthandler", "exit-watcher"])
def test_a_native_hang_at_interpreter_exit_ends_with_status_1(tmp_path: Path, faulthandler_on: bool) -> None:
    """F1: an atexit handler holds the GIL.  The Python exit guard (2 s) cannot run; faulthandler (2 + 2 s) dumps and
    exits 1.  With faulthandler off (as for the C-level exit hooks it does not cover), the exit watcher process
    (2 + 4 s) terminates the process with status 1."""
    env = dict(FAST, **({} if faulthandler_on else {"VTOLGCS_TEST_NO_FAULTHANDLER": "1"}))
    proc, root, took = _run_tree(tmp_path, "at_exit", AT_EXIT, **env)
    out = proc.stdout + proc.stderr
    assert "1 passed" in out and "] END of session" in out, out
    assert proc.returncode == 1, out
    assert took < 30, took
    assert "+++ EXIT GUARD" not in out                                            # the Python thread never ran
    if faulthandler_on:
        assert "Timeout (0:00:04)!" in out and "+++ EXIT WATCHDOG" not in out, out
        assert "in <lambda>" in out, out                                          # the hanging atexit handler
    else:
        assert "Timeout (" not in out and "+++ EXIT WATCHDOG: the test process" in out, out


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



# =========================================================================== WP18

LEAKS = '''
import threading, time

import pytest


class FakeRuntime:
    """Stands in for a Runtime / BridgeSim: a busy thread that only its stop() ends."""

    def __init__(self):
        self._stop = threading.Event()
        self.thread = threading.Thread(target=self._run, name="rc-sender", daemon=True)

    def _run(self):
        while not self._stop.is_set():
            sum(range(2000))                                  # busy, like a leaked sender + simulator

    def stop(self):
        self._stop.set()
        self.thread.join(2)


def test_leaks_a_runtime():
    FakeRuntime().thread.start()                              # never stopped: the leak


def test_a_thread_that_ends_within_the_grace_is_no_leak():
    threading.Thread(target=time.sleep, args=(0.5,), name="short-lived").start()


def test_after_the_leak_nothing_is_left_running():
    assert [t.name for t in threading.enumerate() if t.name == "rc-sender"] == []


def test_forced_to_fail():
    pass


def test_last():
    pass
'''

SLOW_REPORT = '''
import os, time

import pytest


class SlowToFormat(Exception):
    def __str__(self):                                        # pytest formats the failure in its own hook
        time.sleep(float(os.environ.get("SLOW_S", "30")))
        return "slow"


@pytest.fixture
def stuck_teardown():
    yield
    if os.environ.get("STUCK_TEARDOWN"):
        while True:                                           # the next phase of the same test hangs
            time.sleep(0.05)


def test_fails_and_its_report_is_slow(stuck_teardown):
    raise SlowToFormat()


def test_runs_after_it():
    pass
'''

FAIL_THEN_HANG = '''
import ctypes


def test_fails_first():
    assert 1 == 2, "the text that must not be lost"


def test_then_hangs_holding_the_gil():
    ctypes.PyDLL("kernel32").Sleep(600000)
'''

KEPT_TREE = '''
import os, subprocess, sys, time

import conftest

PARENT = ("import subprocess, sys; p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(600)']); "
          "open('grandchild.pid', 'w').write(str(p.pid)); p.wait()")


def test_keeps_a_process_tree():
    p = subprocess.Popen([sys.executable, "-c", PARENT])
    conftest.CHILDREN.keep(p.pid)                             # e.g. a venv launcher: its interpreter is a child
    open("parent.pid", "w").write(str(p.pid))
    end = time.monotonic() + 20
    while not os.path.exists("grandchild.pid") and time.monotonic() < end:
        time.sleep(0.05)


def test_the_kept_tree_survives_the_sweep():
    time.sleep(0.2)
'''


@pytest.mark.skipif(sys.platform != "win32", reason="the suite's platform")
def test_a_leaked_thread_is_named_with_its_stack_fails_its_test_and_is_stopped(tmp_path: Path) -> None:
    """WP18 R2 (+ R8's forced failure): the leaking test gets a teardown ERROR naming the thread and its stack; the
    owner is stopped, so nothing is left running for the next test; a short-lived thread is no leak."""
    proc, root, took = _run_tree(tmp_path, "leaks", LEAKS, VTOLGCS_TEST_FORCE_FAIL="test_forced_to_fail")
    out = proc.stdout + proc.stderr
    assert proc.returncode == 1, out
    assert "are FORCED to fail" in out
    assert "+++ LEAKED THREADS [" in out and "tests/test_leaks.py::test_leaks_a_runtime left 1 thread(s) running" in out
    assert "'rc-sender'" in out and "target FakeRuntime._run, owner FakeRuntime" in out, out
    assert "in _run" in out and "sum(range(2000))" in out, out                       # its stack
    assert "stopped their owners: ['FakeRuntime.stop()']" in out, out
    assert "ERROR at teardown of test_leaks_a_runtime" in out, out
    assert "test_a_thread_that_ends_within_the_grace_is_no_leak PASSED" in out, out
    assert "test_after_the_leak_nothing_is_left_running PASSED" in out, out
    assert "forced failure (VTOLGCS_TEST_FORCE_FAIL='test_forced_to_fail')" in out, out
    assert "1 failed, 4 passed, 1 error" in out, out
    leaks = (root / "dumps" / "pytest-leaks.txt").read_text(encoding="utf-8")
    assert "test_leaks_a_runtime left 1 thread(s)" in leaks and "sum(range(2000))" in leaks


@pytest.mark.skipif(sys.platform != "win32", reason="the suite's platform")
def test_a_timeout_in_pytests_own_report_code_is_no_internalerror(tmp_path: Path) -> None:
    """WP18 R5: the timeout expires while pytest formats the failure (CI: GIL starvation made it take minutes).
    No TestTimeout is raised there (it became INTERNALERROR and skipped every teardown): with no further phase of the
    test the run takes the hard-exit path (status 1); with a hanging teardown TestTimeout is raised in the teardown,
    the test is reported and the run goes on."""
    proc, root, took = _run_tree(tmp_path, "slow1", SLOW_REPORT, VTOLGCS_TEST_TIMEOUT="2", VTOLGCS_TEST_GRACE="3",
                                 SLOW_S="60")
    out = proc.stdout + proc.stderr
    assert "INTERNALERROR>" not in out, out
    assert "the main thread is in pytest's own code, not in the test" in out, out
    assert "test_fails_and_its_report_is_slow is still running 3 s later: hard exit (status 1)" in out, out
    assert "in __str__" in out, out                                               # where the main thread was
    assert proc.returncode == 1 and took < 40, (took, out)
    proc, root, took = _run_tree(tmp_path, "slow2", SLOW_REPORT, VTOLGCS_TEST_TIMEOUT="2", VTOLGCS_TEST_GRACE="6",
                                 SLOW_S="3", STUCK_TEARDOWN="1")
    out = proc.stdout + proc.stderr
    assert "INTERNALERROR>" not in out, out
    assert "the main thread is in pytest's own code, not in the test" in out, out
    assert "TestTimeout raised in the main thread (teardown)" in out, out
    assert "ERROR at teardown of test_fails_and_its_report_is_slow" in out, out
    assert "test_runs_after_it PASSED" in out, out
    assert "1 failed, 1 passed, 1 error" in out and proc.returncode == 1, out


@pytest.mark.skipif(sys.platform != "win32", reason="kernel32.Sleep: Windows")
def test_a_failure_is_written_when_it_happens_even_if_the_session_dies_later(tmp_path: Path) -> None:
    """WP18 R4: the failure text is out before the next test hangs and faulthandler ends the run (no summary)."""
    proc, root, took = _run_tree(tmp_path, "lost", FAIL_THEN_HANG, **FAST)
    out = proc.stdout + proc.stderr
    assert proc.returncode == 1 and "short test summary" not in out, out           # the session died
    head = out.split("Timeout (0:00:05)!")[0]
    assert "+++ FAILED [" in head and "] tests/test_lost.py::test_fails_first (call)" in head, out
    assert "the text that must not be lost" in head and "assert 1 == 2" in head, out
    failures = (root / "dumps" / "pytest-failures.txt").read_text(encoding="utf-8")
    assert "tests/test_lost.py::test_fails_first (call)" in failures and "the text that must not be lost" in failures


@pytest.mark.skipif(sys.platform != "win32", reason="the process guard is Windows only (the suite's platform)")
def test_a_kept_process_keeps_its_descendants(tmp_path: Path) -> None:
    """WP17 verify F-B: ``CHILDREN.keep(pid)`` also keeps that process's children (a venv launcher's interpreter)."""
    proc, root, _ = _run_tree(tmp_path, "kept", KEPT_TREE)
    out = proc.stdout + proc.stderr
    assert proc.returncode == 0, out
    assert "killed process(es) still running after the test" not in out, out
    assert "2 passed" in out
    for name in ("parent.pid", "grandchild.pid"):                                 # the job killed them at exit
        assert not _alive(int((root / name).read_text())), name


@pytest.mark.skipif(sys.platform != "win32", reason="job objects: Windows")
def test_the_kill_path_skips_a_pid_that_is_no_longer_in_the_job() -> None:
    """WP17 verify F-C: a listed PID whose process is not (or no longer) in the job is never terminated."""
    g = _guards()
    ctypes, k = g._kernel32()
    other = g._Children()
    other.job = k.CreateJobObjectW(None, None)              # a job nothing is in
    sleeper = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    try:
        other.alive = lambda: [(sleeper.pid, "python.exe")]   # as if the PID had been listed, then reused
        assert other.kill_all() == []
        assert sleeper.poll() is None
    finally:
        sleeper.kill()
        sleeper.wait(10)
        k.CloseHandle(other.job)


def test_the_runtime_switch_interval_is_at_least_1_ms() -> None:
    """WP18 R6: Windows waits for the GIL in whole milliseconds; below 1 ms the waiters force a switch at once and
    poll, which starved the RC thread on 2-4 CPUs (131-222 Hz instead of 250 Hz)."""
    from vtolgcs import runtime
    assert runtime.GIL_SWITCH_INTERVAL_S >= 0.001
