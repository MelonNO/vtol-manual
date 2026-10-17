"""pytest bootstrap: make ``vtolgcs`` and ``gcs/tools`` importable without installing the package.

Works for ``python -m pytest gcs`` (and ``gcs protocol``) from the repository root.

WP17 guards, so that the suite can never hang a CI job silently:

* **Per-test hard timeout** (``VTOLGCS_TEST_TIMEOUT`` seconds, default 120; ``@pytest.mark.timeout(s)`` for a
  test that needs longer).  When it expires, a watchdog thread prints ``+++ TIMEOUT <test id>`` and the stacks
  of all threads (``faulthandler``) to the real stdout, and to ``pytest-timeouts.txt`` in
  ``VTOLGCS_TEST_DUMP_DIR`` if that is set.  It then kills every process the tests started (this unblocks a
  wait on a child), raises :class:`TestTimeout` in the main thread, and the test is reported FAILED.  If the main
  thread is still blocked ``GRACE_S`` (``VTOLGCS_TEST_GRACE``) later, the stacks are dumped again and the process
  exits with status 1.
* **No process outlives its test**: every process started through :mod:`subprocess` is recorded; after each
  test it and its descendants (by PID, checked against their creation times) are killed and reported.
* **Interactive-desktop tests** (``@pytest.mark.interactive_desktop``: consoles driven with
  ``WriteConsoleInput`` / ``GenerateConsoleCtrlEvent``, foreground-window checks, windows, SDL video) are skipped
  where there is no interactive session: ``GITHUB_ACTIONS`` / ``CI`` set, session 0, or a window station that is
  not interactive.  ``VTOLGCS_INTERACTIVE_TESTS=1`` forces them on, ``=0`` off.
* **Live test names**: with ``GITHUB_ACTIONS=true`` or ``VTOLGCS_LIVE_TEST_NAMES=1`` each test start is printed
  on its own line (pytest ``-v`` leaves the running test's line unfinished, and a piped log shows whole lines).
* **Exit guard**: if the interpreter has not exited ``EXIT_GRACE_S`` after the session ended (for example a
  leaked non-daemon thread), the stacks are dumped and the process exits.
"""

from __future__ import annotations

import faulthandler
import os
import subprocess
import sys
import threading
import time
from typing import Any

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
for _path in (_HERE, os.path.join(_HERE, "tools")):
    if _path not in sys.path:
        sys.path.insert(0, _path)

DEFAULT_TIMEOUT_S = 120.0
GRACE_S = 20.0
EXIT_GRACE_S = 60.0
TIMEOUT_ENV = "VTOLGCS_TEST_TIMEOUT"
GRACE_ENV = "VTOLGCS_TEST_GRACE"          # seconds before the hard exit (default GRACE_S; the self-test shortens it)
DUMP_DIR_ENV = "VTOLGCS_TEST_DUMP_DIR"
INTERACTIVE_ENV = "VTOLGCS_INTERACTIVE_TESTS"
LIVE_ENV = "VTOLGCS_LIVE_TEST_NAMES"


class TestTimeout(BaseException):
    """Raised in the main thread when a test exceeds its timeout (a BaseException, so ``except Exception`` in
    the code under test cannot swallow it)."""

    __test__ = False


# --------------------------------------------------------------------------- interactive session

def _truthy(value: str | None) -> bool:
    return bool(value) and value.strip().lower() not in ("0", "false", "no", "off")


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

class _Children:
    """Every process started through :class:`subprocess.Popen` during the session, and the kill (by PID) of
    whatever of them, and of their descendants, is still alive.  Windows only.  PIDs are checked against
    creation times, so a reused PID is never touched."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.roots: dict[int, int] = {}            # pid -> creation time (FILETIME ticks)
        self.enabled = sys.platform == "win32"

    @staticmethod
    def _api() -> tuple[Any, Any]:
        import ctypes
        from ctypes import wintypes
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.OpenProcess.restype = wintypes.HANDLE
        k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        k.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        k.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(ctypes.c_ulonglong)] * 4
        k.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
        k.CloseHandle.argtypes = [wintypes.HANDLE]
        return ctypes, k

    @classmethod
    def created(cls, pid: int) -> int | None:
        """Creation time of a live process, or None (gone or not accessible)."""
        ctypes, k = cls._api()
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
        ctypes, k = cls._api()
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
        if not self.enabled:
            return
        t = self.created(pid)
        if t is not None:
            with self.lock:
                self.roots[pid] = t

    def alive(self) -> list[tuple[int, str]]:
        """(pid, exe) of every recorded process and descendant that is still alive."""
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
        """Kill (by PID) every recorded process and descendant still alive; returns what was killed."""
        if not self.enabled:
            return []
        victims = self.alive()
        if not victims:
            return []
        ctypes, k = self._api()
        killed = []
        for pid, name in victims:
            h = k.OpenProcess(0x0001 | 0x1000, False, pid)  # PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION
            if h:
                try:
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

_STATE: dict[str, Any] = {"fd": None, "config": None}


def _emit(text: str, dump: bool = False) -> None:
    """Write to the real stdout (pytest's capture redirects fd 1 during a test) and to the dump file."""
    targets: list[Any] = []
    if _STATE["fd"] is not None:
        targets.append(_STATE["fd"])
    f = None
    if os.environ.get(DUMP_DIR_ENV):
        try:
            os.makedirs(os.environ[DUMP_DIR_ENV], exist_ok=True)
            f = open(os.path.join(os.environ[DUMP_DIR_ENV], "pytest-timeouts.txt"), "a", encoding="utf-8")
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


# --------------------------------------------------------------------------- per-test watchdog

def _async_raise(thread_id: int, exc: type[BaseException] | None) -> None:
    """Raise ``exc`` in thread ``thread_id`` at its next bytecode; ``None`` withdraws a pending one."""
    import ctypes
    ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(thread_id),
                                               ctypes.py_object(exc) if exc else ctypes.c_void_p(0))


class _Watchdog:
    def __init__(self, nodeid: str, timeout: float) -> None:
        self.nodeid, self.timeout = nodeid, timeout
        self.main = threading.main_thread().ident or 0
        self.done = threading.Event()
        self.lock = threading.Lock()
        self.fired = False
        self.reported = False
        self.killed: list[tuple[int, str]] = []
        self.grace = _env_seconds(GRACE_ENV, GRACE_S)
        self.thread = threading.Thread(target=self._run, name="test-watchdog", daemon=True)

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
        _emit(f"\n+++ TIMEOUT [{time.strftime('%H:%M:%S')}] {self.nodeid} still running after "
              f"{self.timeout:.0f} s ({TIMEOUT_ENV} / @pytest.mark.timeout). Stacks of all threads:\n", dump=True)
        self.killed = CHILDREN.kill_all()
        _emit(f"+++ TIMEOUT: killed {len(self.killed)} process(es) started by the tests: {self.killed}\n"
              f"+++ TIMEOUT: TestTimeout raised in the main thread; hard exit in {self.grace:.0f} s if it stays "
              "blocked\n")
        with self.lock:
            if self.done.is_set():
                return
            _async_raise(self.main, TestTimeout)
        if self.done.wait(self.grace):
            return
        _emit(f"\n+++ TIMEOUT: {self.nodeid} is still blocked {self.grace:.0f} s later: hard exit (status 1). "
              "Stacks of all threads:\n", dump=True)
        CHILDREN.kill_all()
        os._exit(1)


_WATCHDOG = pytest.StashKey[_Watchdog]()
_SESSION = pytest.StashKey[tuple[bool, str]]()
_LEFTOVERS: list[tuple[str, list[tuple[int, str]]]] = []


def _env_seconds(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name) or default)
    except ValueError:
        return default
    return value if value > 0 else default


def _default_timeout() -> float:
    return _env_seconds(TIMEOUT_ENV, DEFAULT_TIMEOUT_S)


def _timeout_for(item: pytest.Item) -> float:
    timeout = _default_timeout()
    marker = item.get_closest_marker("timeout")
    if marker is not None and marker.args:
        timeout = max(timeout, float(marker.args[0]))
    return timeout


# --------------------------------------------------------------------------- hooks

def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "interactive_desktop: needs a real interactive console/desktop "
                                       "(skipped on CI runners; see gcs/conftest.py)")
    config.addinivalue_line("markers", "timeout(seconds): a per-test timeout longer than the default")
    if _STATE["fd"] is None:
        try:
            _STATE["fd"] = os.dup(sys.stdout.fileno())   # capture is suspended here: this is the real stdout
        except (OSError, ValueError, AttributeError):
            _STATE["fd"] = None
    _STATE["config"] = config
    config.stash[_SESSION] = interactive_session()


def pytest_report_header(config: pytest.Config) -> list[str]:
    ok, why = config.stash[_SESSION]
    return [f"vtolgcs: interactive_desktop tests {'RUN' if ok else 'SKIPPED'} ({why})",
            f"vtolgcs: per-test timeout {_default_timeout():.0f} s, hard exit {_env_seconds(GRACE_ENV, GRACE_S):.0f} s "
            f"later; stack dumps to stdout{' and ' + os.environ[DUMP_DIR_ENV] if os.environ.get(DUMP_DIR_ENV) else ''}"]


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    ok, why = config.stash[_SESSION]
    if ok:
        return
    skip = pytest.mark.skip(reason=f"needs an interactive desktop: {why}")
    for item in items:
        if item.get_closest_marker("interactive_desktop"):
            item.add_marker(skip)


@pytest.hookimpl(tryfirst=True)
def pytest_runtest_logstart(nodeid: str, location: tuple) -> None:
    if not (_truthy(os.environ.get(LIVE_ENV)) or os.environ.get("GITHUB_ACTIONS") == "true"):
        return
    config = _STATE["config"]
    tr = config.pluginmanager.get_plugin("terminalreporter") if config is not None else None
    if tr is not None:
        tr.ensure_newline()
        tr.write_line(f"[{time.strftime('%H:%M:%S')}] START {nodeid}", flush=True)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item: pytest.Item, nextitem: pytest.Item | None):
    wd = _Watchdog(item.nodeid, _timeout_for(item)).start()
    item.stash[_WATCHDOG] = wd
    try:
        yield
    finally:
        wd.finish()
        leftovers = CHILDREN.kill_all()
        if leftovers:
            _LEFTOVERS.append((item.nodeid, leftovers))
            _emit(f"\n+++ {item.nodeid}: killed process(es) still running after the test: {leftovers}\n")


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


def pytest_terminal_summary(terminalreporter: Any) -> None:
    if _LEFTOVERS:
        terminalreporter.section("processes killed after their test (WP17)")
        for nodeid, procs in _LEFTOVERS:
            terminalreporter.write_line(f"{nodeid}: {procs}")


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    CHILDREN.kill_all()
    status = int(exitstatus)

    def guard() -> None:
        time.sleep(EXIT_GRACE_S)
        others = [t.name for t in threading.enumerate() if not t.daemon and t is not threading.main_thread()]
        _emit(f"\n+++ EXIT GUARD: the test process has not exited {EXIT_GRACE_S:.0f} s after the session ended "
              f"(non-daemon threads: {others}). Stacks of all threads:\n", dump=True)
        CHILDREN.kill_all()
        os._exit(status or 1)
    threading.Thread(target=guard, name="exit-guard", daemon=True).start()
