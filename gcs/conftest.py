"""pytest bootstrap: make ``vtolgcs`` and ``gcs/tools`` importable without installing the package.

Works for ``python -m pytest gcs`` (and ``gcs protocol``) from the repository root.

WP17/WP18 guards, so that the suite can never hang a CI job silently, and one failing test can neither hide its
failure text nor slow down the tests after it.  What each layer covers:

1. **Per-test watchdog** (a Python thread; ``VTOLGCS_TEST_TIMEOUT`` s, default 120; ``@pytest.mark.timeout(s)``
   sets a test's own value).  When it expires it prints ``+++ TIMEOUT [time] <test id>`` and the stacks of all
   threads to the real stdout (and to ``pytest-timeouts.txt`` in ``VTOLGCS_TEST_DUMP_DIR`` if set), kills the
   processes the tests started (this unblocks a wait on a child), raises :class:`TestTimeout` in the main thread
   and reports the test FAILED; the run goes on.  **WP18 R5:** ``TestTimeout`` is raised only while the main
   thread runs the test itself (inside its setup, call or teardown hook, where pytest turns any exception into
   that phase's report).  If the main thread is in pytest's own code instead (e.g. formatting a failure report),
   an exception there would end the session with ``INTERNALERROR`` and skip every teardown: the watchdog then
   waits for the test's next phase and otherwise takes the hard-exit path.  A **teardown is never interrupted at
   once** (round 2): it gets its own budget ``TEARDOWN_BUDGET_S`` (``VTOLGCS_TEST_TEARDOWN_BUDGET``, 30 s) from
   the later of its start and the timeout, because pytest stops running the remaining finalisers when one raises
   the ``BaseException`` ``TestTimeout``; only a teardown still running after its budget gets it.  **WP19 R2:**
   pytest then skips that test's remaining finalisers and would hand their never torn down fixtures (module or
   session scope, and function-scoped ones such as ``monkeypatch``, which pytest caches too) to later tests; the
   conftest runs the skipped finalisers and finishes the teardown pytest broke off, so later tests get fresh
   fixtures (on a pytest release not in ``PYTEST_VERIFIED``, or with its internals missing: the hard exit
   instead).  If the test is still running ``GRACE_S`` (``VTOLGCS_TEST_GRACE``) after the timeout (or after the
   teardown's budget), it dumps again and exits with status 1 (the faulthandler backstop moves with it).  Covers
   every hang that releases the GIL: sleeps, waits on locks, threads, processes, sockets and pipes, polling loops.
   **It cannot run while native code holds the GIL** (a C extension blocking without releasing it).
2. **Per-test faulthandler backstop** (``faulthandler.dump_traceback_later(exit=True)``: a C thread that needs no
   GIL), armed at timeout + grace + ``BACKSTOP_MARGIN_S`` (``VTOLGCS_TEST_BACKSTOP_MARGIN``), moved to the hard
   exit + margin when a teardown gets its budget.  Covers a test that
   hangs with the GIL held: it prints ``Timeout (h:mm:ss)!`` and the stacks of all threads to the real stdout
   (the CI log and its uploaded copy) and exits with status 1.  The test is the last ``START`` line before it.

   **Worst case per hanging test (WP19 R3)**, from its start: setup or call interrupted at the timeout (120 s), hard
   exit at timeout + grace (140 s).  A teardown can start as late as the hard exit (the timeout fired while pytest
   formatted the report for almost the grace) and then gets its budget: ``TestTimeout`` at timeout + grace + budget
   (170 s), hard exit at timeout + grace + budget + grace = **190 s**, faulthandler backstop at **200 s** (a hang
   with the GIL held).  The pytest header prints these values with the settings in force.  A hang that the
   watchdog interrupts does not end the run, so a run with k hanging tests can take up to k times as long.
3. **Exit guards**, armed when the session ends:
   a. a Python thread: if the interpreter has not exited ``EXIT_GRACE_S`` (``VTOLGCS_EXIT_GRACE``) later
      (a leaked non-daemon thread, a slow atexit handler), ``+++ EXIT GUARD`` + stacks, exit status (or 1);
   b. faulthandler again, ``BACKSTOP_MARGIN_S`` later: the same with the GIL held (Python atexit handlers, thread
      shutdown).  The interpreter stops faulthandler before its last C-level exit hooks (``Py_AtExit``, e.g.
      pygame's SDL quit), so:
   c. a watcher process (Windows), ``2 * BACKSTOP_MARGIN_S`` after a: if this process still runs, it prints
      ``+++ EXIT WATCHDOG`` and terminates it with status 1 (no stacks: it is another process).
4. **Processes**: on Windows this test process puts itself into a job object at start, so every process it
   starts, and every process those start (orphans included), is in the job.  After each test every job member
   still alive (except this process, the exit watcher and kept processes) is killed by PID and listed; when this
   process ends, the job kills whatever is left (``JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE``).  Before a kill the
   process handle is checked to still be in the job (``IsProcessInJob``: a PID reused by an unrelated process is
   never touched).  If the job cannot be set up, the fallback kills processes started through :mod:`subprocess`
   and their live descendants (an orphan whose parent chain is gone escapes it).  A process started by a module-
   or session-scoped fixture is killed after the first test too: a fixture that must keep one alive across tests
   registers it with ``CHILDREN.keep(pid)``, which also keeps that process's descendants (e.g. the interpreter a
   venv launcher starts).  If ``pytest.main()`` runs inside a long-lived host process, that host joins the job
   for good: run pytest as its own process (``python -m pytest``), as CI and IDEs do.
5. **Threads (WP18 R2)**: after each test's teardown (also when a finaliser raised), every thread started during the
   test that is still alive
   after ``THREAD_GRACE_S`` (``VTOLGCS_TEST_THREAD_GRACE``, default 2 s) is a leak: ``+++ LEAKED THREADS`` with
   each thread's name, target and stack is printed at once (and to ``pytest-leaks.txt``), and the test gets a
   teardown ERROR naming it.  Then the leaked threads' owners are asked to stop (``stop()`` or ``close()`` of
   the object whose method the thread runs: a ``Runtime``, ``ControlServer``, ``BridgeSim``, ...), so a leaked
   runtime cannot starve the tests after it.  A module- or session-scoped fixture whose threads must outlive one
   test starts them inside ``with THREADS.keep_started():``.
6. **Failures are never lost (WP18 R4)**: every failed phase is written when it happens, not only in the final
   summary: ``+++ FAILED [time] <id> (call)`` (``ERROR`` for setup/teardown) plus the full failure text, to the
   real stdout and to ``pytest-failures.txt``; ids are relative to the current directory (``gcs/tests/...``).
7. **Interactive-desktop tests** (``@pytest.mark.interactive_desktop``: consoles driven with
   ``WriteConsoleInput`` / ``GenerateConsoleCtrlEvent``, foreground-window checks, windows) are skipped where there
   is no interactive session: ``GITHUB_ACTIONS`` / ``CI`` set, session 0, or a window station that is not
   interactive.  ``VTOLGCS_INTERACTIVE_TESTS=1`` forces them on, ``=0`` off.
8. **Live test names**: with ``GITHUB_ACTIONS=true`` or ``VTOLGCS_LIVE_TEST_NAMES=1`` each test start is printed
   on its own line (pytest ``-v`` leaves the running test's line unfinished, and a piped log shows whole lines),
   and the end of the session as ``END of session``.
9. **Reproducing a CI failure locally (WP18 R8)**: ``VTOLGCS_TEST_CPUS=N`` restricts this process (and the
   processes it starts) to N logical CPUs, like a small runner VM; ``VTOLGCS_TEST_FORCE_FAIL=<text>`` makes every
   test whose id contains ``<text>`` fail after its body ran (its fixtures are live, as in a real failure).

Not covered: a hang during collection or in pytest's own start-up (before the first test).
"""

from __future__ import annotations

import contextlib
import faulthandler
import os
import subprocess
import sys
import threading
import time
import traceback
from typing import Any, Iterator

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
for _path in (_HERE, os.path.join(_HERE, "tools")):
    if _path not in sys.path:
        sys.path.insert(0, _path)

DEFAULT_TIMEOUT_S = 120.0
GRACE_S = 20.0
BACKSTOP_MARGIN_S = 10.0
EXIT_GRACE_S = 60.0
THREAD_GRACE_S = 2.0
TEARDOWN_BUDGET_S = 30.0
TIMEOUT_ENV = "VTOLGCS_TEST_TIMEOUT"
GRACE_ENV = "VTOLGCS_TEST_GRACE"
MARGIN_ENV = "VTOLGCS_TEST_BACKSTOP_MARGIN"
EXIT_GRACE_ENV = "VTOLGCS_EXIT_GRACE"
THREAD_GRACE_ENV = "VTOLGCS_TEST_THREAD_GRACE"
TEARDOWN_BUDGET_ENV = "VTOLGCS_TEST_TEARDOWN_BUDGET"
NO_FAULTHANDLER_ENV = "VTOLGCS_TEST_NO_FAULTHANDLER"       # self-tests only: proves the exit watcher alone
DUMP_DIR_ENV = "VTOLGCS_TEST_DUMP_DIR"
INTERACTIVE_ENV = "VTOLGCS_INTERACTIVE_TESTS"
LIVE_ENV = "VTOLGCS_LIVE_TEST_NAMES"
FORCE_FAIL_ENV = "VTOLGCS_TEST_FORCE_FAIL"
CPUS_ENV = "VTOLGCS_TEST_CPUS"


class TestTimeout(BaseException):
    """Raised in the main thread when a test exceeds its timeout (a BaseException, so ``except Exception`` in
    the code under test cannot swallow it)."""

    __test__ = False


class LeakedThreads(Exception):
    """A test left threads running after its teardown (reported as that test's teardown ERROR)."""


def _truthy(value: str | None) -> bool:
    return bool(value) and value.strip().lower() not in ("0", "false", "no", "off")


def _env_seconds(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name) or default)
    except ValueError:
        return default
    return value if value > 0 else default


# --------------------------------------------------------------------------- interactive session

def _window_station() -> tuple[str, bool, int]:
    """(window station name, interactive (``WSF_VISIBLE``), session id) of this process (Windows only)."""
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32.GetProcessWindowStation.restype = wintypes.HANDLE
    user32.GetUserObjectInformationW.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
                                                 ctypes.POINTER(wintypes.DWORD)]

    class _Flags(ctypes.Structure):
        _fields_ = [("fInherit", wintypes.BOOL), ("fReserved", wintypes.BOOL), ("dwFlags", wintypes.DWORD)]
    session = wintypes.DWORD(0xFFFFFFFF)
    kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(session))
    winsta = user32.GetProcessWindowStation()
    need = wintypes.DWORD()
    name = ctypes.create_unicode_buffer(256)
    flags = _Flags()
    if not winsta or not user32.GetUserObjectInformationW(winsta, 2, name, ctypes.sizeof(name), ctypes.byref(need)):
        return "", False, int(session.value)                                 # UOI_NAME
    if not user32.GetUserObjectInformationW(winsta, 1, ctypes.byref(flags), ctypes.sizeof(flags), ctypes.byref(need)):
        return name.value, False, int(session.value)                         # UOI_FLAGS
    return name.value, bool(flags.dwFlags & 1), int(session.value)          # WSF_VISIBLE


def interactive_session() -> tuple[bool, str]:
    """Whether tests that need an interactive console/desktop can run here, and why (or why not)."""
    force = os.environ.get(INTERACTIVE_ENV, "").strip()
    if force in ("0", "1"):
        return force == "1", f"{INTERACTIVE_ENV}={force}"
    if sys.platform != "win32":
        return False, "not Windows"
    for name in ("GITHUB_ACTIONS", "CI"):
        if _truthy(os.environ.get(name)):
            return False, (f"{name}={os.environ[name]}: a CI runner, where an interactive console and desktop are "
                           "not guaranteed (run these on a desktop before a release: docs/relay/OPEN-ITEMS.md)")
    try:
        station, visible, session = _window_station()
    except OSError as exc:
        return False, f"window station unknown ({exc})"
    if session == 0:
        return False, "session 0 (services): no interactive desktop"
    if not visible:
        return False, f"window station {station!r} is not interactive (no WSF_VISIBLE): no desktop"
    return True, f"interactive window station {station}, session {session}"


# --------------------------------------------------------------------------- child processes

def _kernel32() -> tuple[Any, Any]:
    import ctypes
    from ctypes import wintypes
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.OpenProcess.restype = wintypes.HANDLE
    k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    k.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    k.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(ctypes.c_ulonglong)] * 4
    k.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    k.CloseHandle.argtypes = [wintypes.HANDLE]
    k.CreateJobObjectW.restype = wintypes.HANDLE
    k.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    k.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    k.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
                                            ctypes.c_void_p]
    k.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    k.IsProcessInJob.argtypes = [wintypes.HANDLE, wintypes.HANDLE, ctypes.POINTER(wintypes.BOOL)]
    k.GetCurrentProcess.restype = wintypes.HANDLE
    k.SetProcessAffinityMask.argtypes = [wintypes.HANDLE, ctypes.c_size_t]
    return ctypes, k


class _Children:
    """The processes the tests start, and their kill (by PID) after each test.  Windows only.

    Primary: a job object that holds this process, so every process it starts and their descendants (orphans
    included) are members.  Fallback (no job): processes started through :class:`subprocess.Popen` and their live
    descendants, PIDs checked against creation times so that a reused PID is never touched."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.roots: dict[int, int] = {}            # fallback: pid -> creation time (FILETIME ticks)
        self.kept: set[int] = set()
        self.enabled = sys.platform == "win32"
        self.job: int | None = None
        self.job_error = ""

    def start_job(self) -> None:
        """Put this process into a new job object (kill on close); on failure keep the fallback."""
        if not self.enabled or self.job is not None:
            return
        ctypes, k = _kernel32()

        class BASIC(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", ctypes.c_uint32), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", ctypes.c_uint32),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", ctypes.c_uint32),
                        ("SchedulingClass", ctypes.c_uint32)]

        class EXTENDED(ctypes.Structure):
            _fields_ = [("Basic", BASIC), ("Io", ctypes.c_uint64 * 6), ("ProcessMemoryLimit", ctypes.c_size_t),
                        ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                        ("PeakJobMemoryUsed", ctypes.c_size_t)]
        job = k.CreateJobObjectW(None, None)
        if not job:
            self.job_error = f"CreateJobObject failed ({ctypes.get_last_error()})"
            return
        info = EXTENDED()
        info.Basic.LimitFlags = 0x2000                                          # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not k.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)) \
                or not k.AssignProcessToJobObject(job, k.GetCurrentProcess()):
            self.job_error = f"job object not usable ({ctypes.get_last_error()})"
            k.CloseHandle(job)
            return
        self.job = job                             # never closed: closing it would kill this process

    def describe(self) -> str:
        if not self.enabled:
            return "not tracked (not Windows)"
        if self.job is not None:
            return "job object (every process the tests start and their descendants, orphans included)"
        return f"processes started through subprocess and their live descendants ({self.job_error})"

    def keep(self, pid: int) -> None:
        """Exempt ``pid`` and its descendants (e.g. a process owned by a module-scoped fixture, and the interpreter
        its venv launcher starts) from the kill after each test."""
        with self.lock:
            self.kept.add(pid)

    @classmethod
    def created(cls, pid: int) -> int | None:
        """Creation time of a live process, or None (gone or not accessible)."""
        ctypes, k = _kernel32()
        h = k.OpenProcess(0x1000, False, pid)              # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return None
        try:
            c, e, kt, ut = (ctypes.c_ulonglong() for _ in range(4))
            if not k.GetProcessTimes(h, ctypes.byref(c), ctypes.byref(e), ctypes.byref(kt), ctypes.byref(ut)):
                return None
            return c.value
        finally:
            k.CloseHandle(h)

    @classmethod
    def snapshot(cls) -> list[tuple[int, int, str]]:
        """(pid, parent pid, exe name) of every process."""
        ctypes, k = _kernel32()
        from ctypes import wintypes

        class PE(ctypes.Structure):
            _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("pid", wintypes.DWORD),
                        ("heap", ctypes.c_size_t), ("module", wintypes.DWORD), ("threads", wintypes.DWORD),
                        ("ppid", wintypes.DWORD), ("pri", ctypes.c_long), ("flags", wintypes.DWORD),
                        ("exe", ctypes.c_wchar * 260)]
        h = k.CreateToolhelp32Snapshot(2, 0)                 # TH32CS_SNAPPROCESS
        if not h or h == wintypes.HANDLE(-1).value:
            return []
        out = []
        try:
            pe = PE()
            pe.dwSize = ctypes.sizeof(PE)
            ok = k.Process32FirstW(h, ctypes.byref(pe))
            while ok:
                out.append((int(pe.pid), int(pe.ppid), pe.exe))
                ok = k.Process32NextW(h, ctypes.byref(pe))
        finally:
            k.CloseHandle(h)
        return out

    def record(self, pid: int) -> None:
        if not self.enabled or self.job is not None:
            return
        t = self.created(pid)
        if t is not None:
            with self.lock:
                self.roots[pid] = t

    def _job_members(self) -> list[int]:
        ctypes, k = _kernel32()
        n = 1024
        buf = (ctypes.c_size_t * (n + 1))()                                    # 2 DWORDs, then the ids
        if not k.QueryInformationJobObject(self.job, 3, buf, ctypes.sizeof(buf), None):   # BasicProcessIdList
            return []
        count = ctypes.c_uint32.from_buffer(buf, 4).value                      # NumberOfProcessIdsInList
        return [int(buf[1 + i]) for i in range(min(count, n))]

    @classmethod
    def _descendants(cls, roots: set[int], procs: list[tuple[int, int, str]]) -> set[int]:
        """``roots`` and their live descendants (a child is never older than its parent: reused PIDs are skipped)."""
        children: dict[int, list[int]] = {}
        for pid, ppid, _ in procs:
            children.setdefault(ppid, []).append(pid)
        out: set[int] = set()
        todo = [(pid, cls.created(pid)) for pid in roots]
        while todo:
            pid, t = todo.pop()
            if pid in out or t is None:
                continue
            out.add(pid)
            for child in children.get(pid, []):
                tc = cls.created(child)
                if tc is not None and tc >= t:
                    todo.append((child, tc))
        return out

    def alive(self) -> list[tuple[int, str]]:
        """(pid, exe) of every tracked process that is still alive (never this process, a kept one or a kept
        process's descendant)."""
        me = os.getpid()
        with self.lock:
            kept = set(self.kept)
        if self.job is not None:
            pids = [p for p in self._job_members() if p != me and p not in kept]
            if not pids:
                return []
            procs = self.snapshot()
            names = {pid: name for pid, _, name in procs}
            if kept:
                kept |= self._descendants(kept, procs)
            return sorted((p, names.get(p, "?")) for p in pids if p not in kept)
        found = self._alive_fallback()
        if kept and found:
            kept |= self._descendants(kept, self.snapshot())
        return [x for x in found if x[0] not in kept]

    def _alive_fallback(self) -> list[tuple[int, str]]:
        with self.lock:
            roots = dict(self.roots)
        if not roots:
            return []
        children: dict[int, list[tuple[int, str]]] = {}
        exe: dict[int, str] = {}
        for pid, ppid, name in self.snapshot():
            children.setdefault(ppid, []).append((pid, name))
            exe[pid] = name
        me = os.getpid()
        found: dict[int, str] = {}
        todo: list[tuple[int, int]] = []           # (pid, creation time its children cannot predate)
        gone = []
        for pid, t in roots.items():
            if pid in exe:
                if self.created(pid) != t:
                    gone.append(pid)               # exited, and the PID now belongs to another process
                    continue
                found[pid] = exe[pid]
            elif pid not in children:
                gone.append(pid)                   # exited, no orphan left behind
                continue
            todo.append((pid, t))
        while todo:
            parent, t_parent = todo.pop()
            for pid, name in children.get(parent, []):
                if pid == me or pid in found:
                    continue
                t = self.created(pid)
                if t is None or t < t_parent:      # a child is never older than its parent: a reused PID
                    continue
                found[pid] = name
                todo.append((pid, t))
        with self.lock:
            for pid in gone:
                if self.roots.get(pid) == roots[pid]:
                    del self.roots[pid]
        return sorted(found.items())

    def kill_all(self) -> list[tuple[int, str]]:
        """Kill (by PID) every tracked process still alive; returns what was killed."""
        if not self.enabled:
            return []
        victims = self.alive()
        if not victims:
            return []
        ctypes, k = _kernel32()
        from ctypes import wintypes
        killed = []
        for pid, name in victims:
            h = k.OpenProcess(0x0001 | 0x1000, False, pid)  # PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION
            if h:
                try:
                    if self.job is not None:        # WP17 verify F-C: the PID may have been reused meanwhile
                        member = wintypes.BOOL(False)
                        if not k.IsProcessInJob(h, self.job, ctypes.byref(member)) or not member.value:
                            continue
                    if k.TerminateProcess(h, 1):
                        killed.append((pid, name))
                finally:
                    k.CloseHandle(h)
        return killed


CHILDREN = _Children()
_popen_init = subprocess.Popen.__init__


def _tracking_init(self: subprocess.Popen, *args: Any, **kwargs: Any) -> None:
    _popen_init(self, *args, **kwargs)
    CHILDREN.record(self.pid)


subprocess.Popen.__init__ = _tracking_init        # type: ignore[method-assign]


# --------------------------------------------------------------------------- output that bypasses capture

_STATE: dict[str, Any] = {"fd": None, "config": None, "deadline": None}


def _out_fd() -> int:
    return _STATE["fd"] if _STATE["fd"] is not None else 2


def _emit(text: str, dump: bool = False, file: str = "pytest-timeouts.txt") -> None:
    """Write to the real stdout (pytest's capture redirects fd 1 during a test) and to the dump file."""
    targets: list[Any] = [_out_fd()]
    f = None
    if os.environ.get(DUMP_DIR_ENV):
        try:
            os.makedirs(os.environ[DUMP_DIR_ENV], exist_ok=True)
            f = open(os.path.join(os.environ[DUMP_DIR_ENV], file), "a", encoding="utf-8")
            targets.append(f)
        except OSError:
            f = None
    try:
        for t in targets:
            try:
                if isinstance(t, int):
                    os.write(t, text.encode("utf-8", "replace"))
                else:
                    t.write(text)
                    t.flush()
                if dump:
                    faulthandler.dump_traceback(file=t, all_threads=True)
            except (OSError, ValueError):
                pass
    finally:
        if f is not None:
            f.close()


def _display_id(nodeid: str) -> str:
    """The test id relative to the current directory with ``/`` (``gcs/tests/test_x.py::test_y`` from the repo
    root): what the CI log lines and the annotations show, and what reruns the test from there."""
    config = _STATE["config"]
    try:
        rel = config.cwd_relative_nodeid(nodeid) if config is not None else nodeid
    except Exception:  # pragma: no cover - best effort
        rel = nodeid
    path, sep, rest = rel.partition("::")
    return path.replace("\\", "/") + sep + rest


# --------------------------------------------------------------------------- faulthandler backstop (no GIL)

def _arm_backstop(seconds: float) -> None:
    """Dump all stacks and ``_exit(1)`` after ``seconds`` from faulthandler's C thread, unless cancelled."""
    if _truthy(os.environ.get(NO_FAULTHANDLER_ENV)):
        return
    faulthandler.dump_traceback_later(max(1.0, seconds), repeat=False, file=_out_fd(), exit=True)


def _cancel_backstop() -> None:
    faulthandler.cancel_dump_traceback_later()


# --------------------------------------------------------------------------- per-test watchdog

def _async_raise(thread_id: int, exc: type[BaseException] | None) -> None:
    """Raise ``exc`` in thread ``thread_id`` at its next bytecode; ``None`` withdraws a pending one."""
    import ctypes
    ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(thread_id),
                                               ctypes.py_object(exc) if exc else ctypes.c_void_p(0))


#: Guards the main thread's phase (WP18 R5) against the watchdog's decision to raise.
_PHASE_LOCK = threading.Lock()
_PHASE: dict[str, Any] = {"when": None, "wd": None, "since": 0.0}


class _Watchdog:
    """The per-test timeout (module docstring, item 1).

    After the timeout: ``TestTimeout`` goes into the test's setup or call when the main thread is in one of them.
    A **teardown is never interrupted at once** (round 2, verify F1): it gets its own budget
    (``VTOLGCS_TEST_TEARDOWN_BUDGET``, from the later of its start and the timeout), because ``TestTimeout`` is a
    ``BaseException`` and pytest stops running the remaining finalisers when one raises it, which would leave
    the test's runtimes running.  Only a teardown still running after its budget gets ``TestTimeout`` (then
    :func:`_finish_teardown` runs the finalisers pytest skipped: WP19 R2).  While the main thread is in pytest's own
    code nothing is raised.  The hard exit comes ``GRACE_S`` after the timeout, or after the teardown's budget,
    whichever is later: at most timeout + grace + budget + grace after the test started (:func:`worst_case_s`)."""

    def __init__(self, nodeid: str, timeout: float) -> None:
        self.nodeid, self.timeout = nodeid, timeout
        self.main = threading.main_thread().ident or 0
        self.done = threading.Event()
        self.lock = _PHASE_LOCK
        self.fired = False
        self.raised_in: list[str] = []
        self.reported = False
        self.killed: list[tuple[int, str]] = []
        self.grace = _env_seconds(GRACE_ENV, GRACE_S)
        self.teardown_budget = _env_seconds(TEARDOWN_BUDGET_ENV, TEARDOWN_BUDGET_S)
        self.thread = threading.Thread(target=self._run, name="test-watchdog", daemon=True)

    @property
    def raised(self) -> bool:
        return bool(self.raised_in)

    def start(self) -> "_Watchdog":
        self.thread.start()
        return self

    def finish(self) -> None:
        with self.lock:
            self.done.set()
            if self.fired:
                _async_raise(self.main, None)          # a TestTimeout not delivered yet must not hit pytest

    def _run(self) -> None:
        if self.done.wait(self.timeout):
            return
        with self.lock:
            if self.done.is_set():
                return
            self.fired = True
        shown = _display_id(self.nodeid)
        _emit(f"\n+++ TIMEOUT [{time.strftime('%H:%M:%S')}] {shown} still running after "
              f"{self.timeout:.0f} s ({TIMEOUT_ENV} / @pytest.mark.timeout). Stacks of all threads:\n", dump=True)
        self.killed = CHILDREN.kill_all()
        _emit(f"+++ TIMEOUT: killed {len(self.killed)} process(es) started by the tests: {self.killed}\n")
        fired_at = time.monotonic()
        end = fired_at + self.grace                    # the hard exit, unless the test ends first
        td_since: float | None = None                  # start of the teardown that has a budget
        td_raise_at = 0.0
        said_outside = False
        while True:
            note = ""
            with self.lock:
                if self.done.is_set():
                    if not self.raised:
                        note = "+++ TIMEOUT: the test ended meanwhile; it is reported FAILED\n"
                    break
                now = time.monotonic()
                when = _PHASE["when"] if _PHASE["wd"] is self else None
                if when == "teardown":
                    if td_since != _PHASE["since"]:
                        td_since = _PHASE["since"]
                        td_raise_at = max(td_since, fired_at) + self.teardown_budget
                        end = max(end, td_raise_at + self.grace)
                        _STATE["deadline"] = end + _env_seconds(MARGIN_ENV, BACKSTOP_MARGIN_S)
                        _arm_backstop(_STATE["deadline"] - now)
                        note = (f"+++ TIMEOUT: {shown} is in its teardown: not interrupted (its finalisers must run); "
                                f"TestTimeout only if it is still running in {td_raise_at - now:.0f} s "
                                f"({TEARDOWN_BUDGET_ENV}), hard exit {self.grace:.0f} s after that\n")
                    elif now >= td_raise_at and "teardown" not in self.raised_in:
                        _async_raise(self.main, TestTimeout)
                        self.raised_in.append("teardown")
                        note = (f"+++ TIMEOUT: TestTimeout raised in the main thread (teardown, still running after its "
                                f"{self.teardown_budget:.0f} s budget); hard exit in {end - now:.0f} s if the test is "
                                "still running\n")
                elif when in ("setup", "call") and not self.raised:
                    _async_raise(self.main, TestTimeout)   # inside the test's own hook: becomes its report
                    self.raised_in.append(when)
                    note = (f"+++ TIMEOUT: TestTimeout raised in the main thread ({when}); hard exit in "
                            f"{end - now:.0f} s if the test is still running (its teardown gets its own budget)\n")
                elif when is None and not self.raised and not said_outside:
                    said_outside = True
                    note = ("+++ TIMEOUT: the main thread is in pytest's own code, not in the test (an exception there "
                            "would end the session with INTERNALERROR and skip every teardown): TestTimeout is not "
                            f"raised there; waiting up to {end - now:.0f} s for the test's next phase\n")
            if note:
                _emit(note)
            if self.done.is_set() or time.monotonic() >= end:
                break
            self.done.wait(0.05)
        if self.done.is_set():
            return
        _hard_exit(f"\n+++ TIMEOUT: {shown} is still running {time.monotonic() - fired_at:.0f} s later: hard exit "
                   "(status 1). Stacks of all threads:\n")


def _hard_exit(text: str) -> None:
    """Print ``text`` and the stacks of all threads, kill the processes the tests started, exit with status 1."""
    _emit(text, dump=True)
    CHILDREN.kill_all()
    os._exit(1)


def _in_phase(item: pytest.Item, when: str, after: Any = None, always: bool = False,
              on_timeout: Any = None) -> Iterator[Any]:
    """Run one of the item's own hooks (setup / call / teardown) with the phase marked (WP18 R5).

    ``after()`` runs after the hook, still inside the phase (its exception becomes that phase's report); with
    ``always`` also when the hook raised (round 2, verify F2: the leak check must run when a finaliser raised),
    chained to the hook's exception.  ``on_timeout(exc)`` runs first when the hook raised after the watchdog
    raised ``TestTimeout`` in this phase (WP19 R2)."""
    wd = item.stash.get(_WATCHDOG, None)
    with _PHASE_LOCK:
        _PHASE["when"], _PHASE["wd"], _PHASE["since"] = when, wd, time.monotonic()
    try:
        try:
            result = yield
        except BaseException as exc:
            if on_timeout is not None and wd is not None and when in wd.raised_in:
                on_timeout(exc)
            if after is not None and always:
                try:
                    after()
                except Exception as extra:
                    raise extra from exc
            raise
        if after is not None:
            after()
        return result
    finally:
        with _PHASE_LOCK:
            _PHASE["when"], _PHASE["wd"] = None, None
            if wd is not None and wd.fired:
                _async_raise(wd.main, None)            # not delivered inside the phase: never in pytest's code


_WATCHDOG = pytest.StashKey[_Watchdog]()
_THREADS_BEFORE = pytest.StashKey[set]()
_SESSION = pytest.StashKey[tuple[bool, str]]()
_LEFTOVERS: list[tuple[str, list[tuple[int, str]]]] = []
_LEAKS: list[tuple[str, list[str]]] = []


def _default_timeout() -> float:
    return _env_seconds(TIMEOUT_ENV, DEFAULT_TIMEOUT_S)


def worst_case_s(timeout: float | None = None) -> tuple[float, float]:
    """WP19 R3: the longest a hanging test can run, from its start, with the settings in force: (hang the watchdog
    sees: its hard exit, timeout + grace + teardown budget + grace; hang with the GIL held: + the backstop margin).
    The teardown can start as late as timeout + grace (pytest's own report code after the timeout gets the grace)."""
    t = _default_timeout() if timeout is None else timeout
    grace, budget = _env_seconds(GRACE_ENV, GRACE_S), _env_seconds(TEARDOWN_BUDGET_ENV, TEARDOWN_BUDGET_S)
    worst = t + grace + budget + grace
    return worst, worst + _env_seconds(MARGIN_ENV, BACKSTOP_MARGIN_S)


def _timeout_for(item: pytest.Item) -> float:
    marker = item.get_closest_marker("timeout")
    if marker is not None and marker.args:
        return float(marker.args[0])
    return _default_timeout()


def _live_names() -> bool:
    return _truthy(os.environ.get(LIVE_ENV)) or os.environ.get("GITHUB_ACTIONS") == "true"


# --------------------------------------------------------------------------- leaked threads (WP18 R2)

_OWN_THREADS = ("test-watchdog", "exit-guard", "leak-reaper")


class _Threads:
    """Threads a fixture keeps across tests on purpose (``with THREADS.keep_started(): ...``)."""

    def __init__(self) -> None:
        self.kept: set[threading.Thread] = set()

    @contextlib.contextmanager
    def keep_started(self) -> Iterator[None]:
        before = set(threading.enumerate())
        try:
            yield
        finally:
            self.kept |= set(threading.enumerate()) - before

    def started_since(self, before: set[threading.Thread]) -> list[threading.Thread]:
        self.kept = {t for t in self.kept if t.is_alive()}
        return [t for t in threading.enumerate()
                if t not in before and t not in self.kept and t.name not in _OWN_THREADS
                and not isinstance(t, threading._DummyThread) and t is not threading.main_thread()]


THREADS = _Threads()


def _describe_thread(t: threading.Thread, frames: dict[int, Any]) -> str:
    target = getattr(t, "_target", None)
    owner = getattr(target, "__self__", None)
    what = getattr(target, "__qualname__", None) or repr(target)
    head = f"thread {t.name!r} (daemon={t.daemon}, target {what}" + (f", owner {type(owner).__name__}" if owner is not None else "") + ")"
    frame = frames.get(t.ident or -1)
    stack = "".join(traceback.format_stack(frame)) if frame is not None else "  (no Python frame)\n"
    return head + "\n" + stack


def _stop_owners(threads: list[threading.Thread], budget_s: float) -> list[str]:
    """Ask the objects that own leaked threads to stop (their own shutdown path), in a helper thread with a time
    budget; returns what was done."""
    owners: list[Any] = []
    for t in threads:
        owner = getattr(getattr(t, "_target", None), "__self__", None)
        if owner is not None and all(owner is not o for o in owners):
            owners.append(owner)
    owners.sort(key=lambda o: type(o).__name__ not in ("Runtime", "ControlServer", "BridgeSim"))  # whole runtimes first
    done: list[str] = []

    def reap() -> None:
        for owner in owners:
            fn = getattr(owner, "stop", None) or getattr(owner, "close", None)
            if not callable(fn):
                done.append(f"{type(owner).__name__}: no stop()/close()")
                continue
            try:
                fn()
                done.append(f"{type(owner).__name__}.{fn.__name__}()")
            except Exception as exc:                     # best effort: report and go on
                done.append(f"{type(owner).__name__}.{fn.__name__}() failed: {exc!r}")
    reaper = threading.Thread(target=reap, name="leak-reaper", daemon=True)
    reaper.start()
    reaper.join(budget_s)
    if reaper.is_alive():
        done.append(f"(stopping did not finish within {budget_s:.0f} s)")
    return done


def _check_threads(item: pytest.Item) -> None:
    """After the item's teardown: report, stop and fail on threads it left running."""
    before = item.stash.get(_THREADS_BEFORE, None)
    if before is None:
        return
    grace = _env_seconds(THREAD_GRACE_ENV, THREAD_GRACE_S)
    end = time.monotonic() + grace
    for t in THREADS.started_since(before):
        t.join(max(0.0, end - time.monotonic()))
    leaked = [t for t in THREADS.started_since(before) if t.is_alive()]
    if not leaked:
        return
    shown = _display_id(item.nodeid)
    frames = sys._current_frames()
    text = "".join(_describe_thread(t, frames) for t in leaked)
    actions = _stop_owners(leaked, 10.0)
    end = time.monotonic() + grace
    for t in leaked:
        t.join(max(0.0, end - time.monotonic()))
    still = [t.name for t in leaked if t.is_alive()]
    summary = (f"{shown} left {len(leaked)} thread(s) running {grace:g} s after its teardown: "
               f"{[t.name for t in leaked]}; stopped their owners: {actions or 'none found'}"
               + (f"; STILL RUNNING: {still}" if still else ""))
    _LEAKS.append((shown, [t.name for t in leaked]))
    _emit(f"\n+++ LEAKED THREADS [{time.strftime('%H:%M:%S')}] {summary}\n{text}", file="pytest-leaks.txt")
    raise LeakedThreads(f"{summary}\n\n{text}\nEvery runtime, sender, receiver, control server, session log or "
                        "bridge_sim a test starts must be stopped in a fixture finaliser or a context manager "
                        "(gcs/README.md, Tests).")


# --------------------------------------------------------------------------- an interrupted teardown (WP19 R2)

#: pytest releases (major, minor) whose internals :func:`_finish_teardown` was checked against (WP19 round 2, verify
#: F2).  It relies on ``SetupState.teardown_exact`` popping each finaliser from its node's list before calling it (a
#: list then holds only what has not run) and on ``FixtureDef.finish`` clearing ``cached_result`` (pytest 9.1.1:
#: ``runner.py`` ``teardown_exact``, ``fixtures.py`` ``finish``).  pytest is not pinned (CI installs the latest), so on
#: any other release the recovery is not trusted: it takes the hard exit instead, the header says so, and the
#: self-test ``test_the_teardown_recovery_was_verified_for_this_pytest`` fails until it is re-checked and listed here.
PYTEST_VERIFIED = ((9, 1),)


def teardown_recovery_verified() -> bool:
    """Whether this pytest is one :func:`_finish_teardown` was checked against."""
    return tuple(pytest.version_tuple[:2]) in PYTEST_VERIFIED


def _finaliser_lists(item: pytest.Item) -> dict[Any, list] | None:
    """pytest's set-up nodes and their finaliser lists (the lists themselves, not copies) before ``item``'s teardown;
    None if pytest's internals are not as expected."""
    try:
        return {node: entry[0] for node, entry in item.session._setupstate.stack.items()}
    except (AttributeError, TypeError, IndexError, KeyError):
        return None


def _scope_node(item: pytest.Item, scope: str) -> Any:
    """The node a fixture of ``scope`` used by ``item`` belongs to (as pytest's fixture requests find it)."""
    if scope == "session":
        return item.session
    if scope == "package":
        return item.getparent(pytest.Package) or item.session
    if scope == "module":
        return item.getparent(pytest.Module)
    if scope == "class":
        return item.getparent(pytest.Class) or item
    return item


def _finish_teardown(item: pytest.Item, nextitem: pytest.Item | None, lists: dict[Any, list] | None,
                     exc: BaseException) -> None:
    """The watchdog raised ``TestTimeout`` in a teardown still running after its budget.  It is a ``BaseException``,
    so pytest's ``teardown_exact`` stopped there: the remaining finalisers of the node it was tearing down (other
    fixtures, pytest's own ``monkeypatch`` / ``tmp_path``, the module's teardown) were skipped, and so were the nodes
    the next test does not need.  Those fixtures keep their cached value, and pytest would hand the never torn
    down object to every later test that asks for it (WP18 verify round 2, finding 1).

    So: run the skipped finalisers (in pytest's order, each error collected), let ``teardown_exact`` finish the
    nodes it did not reach, and reset any fixture of this test that is still cached although its node is gone (its
    object is dropped without a teardown, named in the log); later tests get fresh fixtures.  All of this runs
    under the watchdog's hard exit (the grace after the budget).  On a pytest release not in :data:`PYTEST_VERIFIED`,
    or if the attributes it reads are missing, the run ends with the hard exit instead.  A semantic change on a
    verified release cannot be detected here; the R2 self-test (fresh fixtures, each finaliser exactly once) covers
    that for the release CI installs."""
    shown = _display_id(item.nodeid)
    try:
        if not teardown_recovery_verified():
            raise AttributeError(f"pytest {pytest.__version__} is not a release this recovery was verified for "
                                 f"(PYTEST_VERIFIED {PYTEST_VERIFIED})")
        if lists is None:
            raise AttributeError("the finaliser lists were not readable before the teardown")
        state = item.session._setupstate
        stack = state.stack
        chains = list(getattr(getattr(item, "_fixtureinfo", None), "name2fixturedefs", {}).values())
    except AttributeError as e:
        _hard_exit(f"\n+++ TIMEOUT: {shown}: its teardown was interrupted after its budget, and the finalisers pytest "
                   f"skipped cannot be run safely ({e}): hard exit (status 1), so that no later test gets a fixture "
                   "that was never torn down. Stacks of all threads:\n")
        return
    ran, errors = 0, []
    for node, fins in reversed(list(lists.items())):          # innermost first, like pytest
        if node in stack:
            continue                                            # not torn down yet: teardown_exact below decides
        while fins:
            fin = fins.pop()
            ran += 1
            try:
                fin()
            except (KeyboardInterrupt, SystemExit):
                raise
            except BaseException as e:                          # like pytest: report it and go on with the rest
                errors.append(e)
    try:
        state.teardown_exact(nextitem)                          # the nodes pytest did not reach
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException as e:
        errors.append(e)
    reset = []
    for chain in chains:
        for fd in chain:
            if getattr(fd, "cached_result", None) is not None and _scope_node(item, fd.scope) not in stack:
                fd.cached_result = None                         # never torn down: the next request makes a new one
                fd._finalizers.clear()
                reset.append(f"{fd.argname} ({fd.scope})")
    text = (f"+++ TIMEOUT: {shown}: its teardown was interrupted after its budget: ran the {ran} finaliser(s) pytest "
            "skipped and finished its teardown"
            + (f"; their errors: {[f'{type(e).__name__}: {e}' for e in errors]}" if errors else "")
            + (f"; reset without a teardown: {reset}" if reset else "")
            + "; later tests get fresh fixtures\n")
    _emit(text)
    try:
        exc.add_note(text.strip())
    except AttributeError:  # pragma: no cover - Python < 3.11
        pass


# --------------------------------------------------------------------------- hooks

def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "interactive_desktop: needs a real interactive console/desktop "
                                       "(skipped on CI runners; see gcs/conftest.py)")
    config.addinivalue_line("markers", "timeout(seconds): this test's own timeout instead of the default")
    if _STATE["fd"] is None:
        try:
            _STATE["fd"] = os.dup(sys.stdout.fileno())   # capture is suspended here: this is the real stdout
        except (OSError, ValueError, AttributeError):
            _STATE["fd"] = None
    _STATE["config"] = config
    cpus = os.environ.get(CPUS_ENV, "").strip()
    _STATE["cpus"] = ""
    if cpus.isdigit() and int(cpus) > 0 and sys.platform == "win32":
        ctypes, k = _kernel32()
        ok = k.SetProcessAffinityMask(k.GetCurrentProcess(), (1 << int(cpus)) - 1)
        _STATE["cpus"] = (f"restricted to {cpus} logical CPU(s) ({CPUS_ENV})" if ok
                          else f"{CPUS_ENV}={cpus} not applied ({ctypes.get_last_error()})")
    CHILDREN.start_job()
    config.stash[_SESSION] = interactive_session()


def pytest_report_header(config: pytest.Config) -> list[str]:
    ok, why = config.stash[_SESSION]
    grace, margin = _env_seconds(GRACE_ENV, GRACE_S), _env_seconds(MARGIN_ENV, BACKSTOP_MARGIN_S)
    worst, worst_gil = worst_case_s()
    lines = [f"vtolgcs: interactive_desktop tests {'RUN' if ok else 'SKIPPED'} ({why})",
             f"vtolgcs: per-test timeout {_default_timeout():.0f} s (setup/call interrupted then), a teardown gets "
             f"{_env_seconds(TEARDOWN_BUDGET_ENV, TEARDOWN_BUDGET_S):.0f} s more, hard exit {grace:.0f} s after the "
             f"timeout or that budget, faulthandler backstop {margin:.0f} s after the hard exit; worst case per hanging "
             f"test {worst:.0f} s ({worst_gil:.0f} s with the GIL held); stack dumps to stdout"
             f"{' and ' + os.environ[DUMP_DIR_ENV] if os.environ.get(DUMP_DIR_ENV) else ''}",
             (f"vtolgcs: a teardown interrupted after its budget: the finalisers pytest skipped are run (pytest "
              f"{pytest.__version__}, verified)" if teardown_recovery_verified() else
              f"vtolgcs: WARNING pytest {pytest.__version__} is not verified for the teardown recovery "
              f"(PYTEST_VERIFIED {PYTEST_VERIFIED}): a teardown interrupted after its budget takes the hard exit"),
             f"vtolgcs: process cleanup after each test: {CHILDREN.describe()}",
             f"vtolgcs: threads still running {_env_seconds(THREAD_GRACE_ENV, THREAD_GRACE_S):g} s after a test's "
             "teardown are reported, stopped and fail that test"]
    if _STATE.get("cpus"):
        lines.append(f"vtolgcs: this process is {_STATE['cpus']}")
    if os.environ.get(FORCE_FAIL_ENV):
        lines.append(f"vtolgcs: tests whose id contains {os.environ[FORCE_FAIL_ENV]!r} are FORCED to fail "
                     f"({FORCE_FAIL_ENV})")
    return lines


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    ok, why = config.stash[_SESSION]
    if ok:
        return
    skip = pytest.mark.skip(reason=f"needs an interactive desktop: {why}")
    for item in items:
        if item.get_closest_marker("interactive_desktop"):
            item.add_marker(skip)


def _live_line(text: str) -> None:
    config = _STATE["config"]
    tr = config.pluginmanager.get_plugin("terminalreporter") if config is not None else None
    if tr is not None:
        tr.ensure_newline()
        tr.write_line(f"[{time.strftime('%H:%M:%S')}] {text}", flush=True)


@pytest.hookimpl(tryfirst=True)
def pytest_runtest_logstart(nodeid: str, location: tuple) -> None:
    if _live_names():
        _live_line(f"START {_display_id(nodeid)}")


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item: pytest.Item, nextitem: pytest.Item | None):
    timeout = _timeout_for(item)
    wd = _Watchdog(item.nodeid, timeout).start()
    item.stash[_WATCHDOG] = wd
    item.stash[_THREADS_BEFORE] = set(threading.enumerate())
    backstop = timeout + wd.grace + _env_seconds(MARGIN_ENV, BACKSTOP_MARGIN_S)
    _STATE["deadline"] = time.monotonic() + backstop
    _arm_backstop(backstop)
    try:
        yield
    finally:
        _cancel_backstop()
        _STATE["deadline"] = None
        wd.finish()
        leftovers = CHILDREN.kill_all()
        if leftovers:
            _LEFTOVERS.append((item.nodeid, leftovers))
            _emit(f"\n+++ {_display_id(item.nodeid)}: killed process(es) still running after the test: {leftovers}\n")


@pytest.hookimpl(wrapper=True, tryfirst=True)
def pytest_runtest_setup(item: pytest.Item):
    return (yield from _in_phase(item, "setup"))


@pytest.hookimpl(wrapper=True, tryfirst=True)
def pytest_runtest_call(item: pytest.Item):
    def forced() -> None:
        text = os.environ.get(FORCE_FAIL_ENV, "")
        if text and text in item.nodeid:
            raise AssertionError(f"forced failure ({FORCE_FAIL_ENV}={text!r}): the test body ran, its fixtures are "
                                 "live")
    return (yield from _in_phase(item, "call", forced))


@pytest.hookimpl(wrapper=True, tryfirst=True)
def pytest_runtest_teardown(item: pytest.Item, nextitem: pytest.Item | None):
    lists = _finaliser_lists(item)
    return (yield from _in_phase(item, "teardown", lambda: _check_threads(item), always=True,   # after the finalisers
                                 on_timeout=lambda exc: _finish_teardown(item, nextitem, lists, exc)))


@pytest.hookimpl(trylast=True)
def pytest_exception_interact() -> None:
    """pytest's faulthandler plugin cancels any ``dump_traceback_later`` when a test fails: arm ours again for the
    rest of the test (its teardown can hang too)."""
    if _STATE["deadline"] is not None:
        _arm_backstop(_STATE["deadline"] - time.monotonic())


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo):
    outcome = yield
    wd = item.stash.get(_WATCHDOG, None)
    if wd is None or not wd.fired or wd.reported:
        return
    rep = outcome.get_result()
    wd.reported = True
    if not rep.failed:                              # it ended once its processes were killed: still a failure
        rep.outcome = "failed"
        rep.longrepr = (f"TestTimeout: exceeded {wd.timeout:.0f} s; it ended only after the watchdog killed the "
                        f"processes {wd.killed} (stack dump: '+++ TIMEOUT' above)")


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    """WP18 R4: a failure's full text goes out when that phase ends, not only in the end-of-session summary."""
    if report.failed:
        _emit_failure("FAILED" if report.when == "call" else "ERROR", report, report.when)


def pytest_collectreport(report: pytest.CollectReport) -> None:
    """The same for a file that cannot be collected (its id is the path: ``+++ ERROR [time] <path> (collect)``)."""
    if report.failed:
        _emit_failure("ERROR", report, "collect")


def _emit_failure(kind: str, report: Any, when: str) -> None:
    try:
        text = report.longreprtext
    except Exception as exc:  # pragma: no cover - best effort
        text = f"(failure text unavailable: {exc!r})"
    shown = _display_id(report.nodeid)
    _emit(f"\n+++ {kind} [{time.strftime('%H:%M:%S')}] {shown} ({when})\n{text}\n+++ END {kind} {shown}\n",
          file="pytest-failures.txt")


def pytest_terminal_summary(terminalreporter: Any) -> None:
    if _LEFTOVERS:
        terminalreporter.section("processes killed after their test (WP17)")
        for nodeid, procs in _LEFTOVERS:
            terminalreporter.write_line(f"{nodeid}: {procs}")
    if _LEAKS:
        terminalreporter.section("threads leaked by a test, stopped after it (WP18)")
        for nodeid, names in _LEAKS:
            terminalreporter.write_line(f"{nodeid}: {names}")


_EXIT_WATCHER = r'''
import ctypes, sys
from ctypes import wintypes
k = ctypes.WinDLL("kernel32", use_last_error=True)
k.OpenProcess.restype = wintypes.HANDLE
k.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
k.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
pid, seconds = int(sys.argv[1]), float(sys.argv[2])
h = k.OpenProcess(0x00100000 | 0x0001, False, pid)                  # SYNCHRONIZE | PROCESS_TERMINATE
if h and k.WaitForSingleObject(h, int(seconds * 1000)) == 0x102:     # WAIT_TIMEOUT: still running
    sys.stdout.write("\n+++ EXIT WATCHDOG: the test process %d still runs %.0f s after its session ended (hung in "
                     "native exit code, e.g. a C-level atexit hook): terminated with status 1\n" % (pid, seconds))
    sys.stdout.flush()
    k.TerminateProcess(h, 1)
'''


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    CHILDREN.kill_all()
    status = int(exitstatus)
    grace, margin = _env_seconds(EXIT_GRACE_ENV, EXIT_GRACE_S), _env_seconds(MARGIN_ENV, BACKSTOP_MARGIN_S)
    if _live_names():
        _live_line(f"END of session (exit guards armed: {grace:.0f} / {grace + margin:.0f} / "
                   f"{grace + 2 * margin:.0f} s)")

    def guard() -> None:
        time.sleep(grace)
        others = [t.name for t in threading.enumerate() if not t.daemon and t is not threading.main_thread()]
        _emit(f"\n+++ EXIT GUARD: the test process has not exited {grace:.0f} s after the session ended "
              f"(non-daemon threads: {others}). Stacks of all threads:\n", dump=True)
        CHILDREN.kill_all()
        os._exit(status or 1)
    threading.Thread(target=guard, name="exit-guard", daemon=True).start()
    _arm_backstop(grace + margin)
    if sys.platform == "win32":
        try:
            fd = _out_fd()
            watcher = subprocess.Popen([sys.executable, "-c", _EXIT_WATCHER, str(os.getpid()),
                                        str(grace + 2 * margin)], stdin=subprocess.DEVNULL, stdout=fd, stderr=fd)
            CHILDREN.keep(watcher.pid)
        except OSError:
            pass
