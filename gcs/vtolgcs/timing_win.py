"""Precise waits and Windows system helpers for the RC sender (plan §7.3).

Waiting (absolute deadlines on ``time.perf_counter()``):

1. **High-resolution waitable timer** — ``CreateWaitableTimerExW`` with
   ``CREATE_WAITABLE_TIMER_HIGH_RESOLUTION`` (Windows 10 1803+): sleep until
   :data:`HR_SPIN_S` before the deadline, then spin.
2. **Fallback** — ``timeBeginPeriod(1)`` plus ``time.sleep`` until
   :data:`FALLBACK_SPIN_S` (~0.5 ms, plan §7.3) before the deadline, then spin.
3. Off Windows (tests on other systems): ``time.sleep`` plus the same spin.

Windows helpers used by the runtime:

* :func:`set_thread_priority_high` — the RC thread runs at ``THREAD_PRIORITY_HIGHEST``.
* :func:`keep_awake` — ``SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)``
  while streaming (the request belongs to the calling thread, so the sender
  thread calls it), cleared with ``ES_CONTINUOUS`` when it stops.
* :func:`power_status` — ``GetSystemPowerStatus``: on battery / battery saver.
* :class:`SingleInstance` — a named mutex, so two senders can never fight.
"""

from __future__ import annotations

import ctypes
import functools
import logging
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("vtolgcs.timing")

IS_WINDOWS = sys.platform == "win32"

CREATE_WAITABLE_TIMER_HIGH_RESOLUTION = 0x00000002
TIMER_ALL_ACCESS = 0x001F0003
INFINITE = 0xFFFFFFFF
WAIT_OBJECT_0 = 0
ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
THREAD_PRIORITY_HIGHEST = 2
ERROR_ALREADY_EXISTS = 183
ERROR_ACCESS_DENIED = 5

#: Spin margins before the deadline.
HR_SPIN_S = 0.0003
FALLBACK_SPIN_S = 0.0005


@functools.lru_cache(maxsize=1)
def _kernel32():
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateWaitableTimerExW.restype = wintypes.HANDLE
    k32.CreateWaitableTimerExW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD)
    k32.SetWaitableTimer.restype = wintypes.BOOL
    k32.SetWaitableTimer.argtypes = (wintypes.HANDLE, ctypes.POINTER(ctypes.c_longlong), wintypes.LONG,
                                     ctypes.c_void_p, ctypes.c_void_p, wintypes.BOOL)
    k32.WaitForSingleObject.restype = wintypes.DWORD
    k32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    k32.CloseHandle.restype = wintypes.BOOL
    k32.CloseHandle.argtypes = (wintypes.HANDLE,)
    k32.CreateMutexW.restype = wintypes.HANDLE
    k32.CreateMutexW.argtypes = (ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR)
    k32.SetThreadExecutionState.restype = wintypes.DWORD
    k32.SetThreadExecutionState.argtypes = (wintypes.DWORD,)
    k32.GetCurrentThread.restype = wintypes.HANDLE
    k32.SetThreadPriority.restype = wintypes.BOOL
    k32.SetThreadPriority.argtypes = (wintypes.HANDLE, ctypes.c_int)
    return k32


# --------------------------------------------------------------------------- waiting

class Waiter:
    """Wait until an absolute ``time.perf_counter()`` deadline. Create one per thread."""

    def __init__(self, prefer_high_res: bool = True) -> None:
        self.kind = "sleep"
        self._k32 = None
        self._winmm = None
        self._timer = None
        if not IS_WINDOWS:
            return
        try:
            self._k32 = _kernel32()
        except OSError as exc:  # pragma: no cover - kernel32 always exists on Windows
            log.warning("kernel32 unavailable: %s", exc)
            return
        if prefer_high_res:
            handle = self._k32.CreateWaitableTimerExW(None, None, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                                                      TIMER_ALL_ACCESS)
            if handle:
                self._timer = handle
                self.kind = "high-res-timer"
                return
            log.info("high-resolution waitable timer unavailable (error %d); using timeBeginPeriod(1)",
                     ctypes.get_last_error())
        try:
            self._winmm = ctypes.WinDLL("winmm")
            self._winmm.timeBeginPeriod(1)
            self.kind = "timeBeginPeriod"
        except (OSError, AttributeError) as exc:  # pragma: no cover
            log.warning("timeBeginPeriod unavailable: %s", exc)

    def wait_until(self, deadline: float) -> None:
        """Return at (or just after) ``deadline``; returns at once if it has passed."""
        remaining = deadline - time.perf_counter()
        if self._timer is not None:
            coarse = remaining - HR_SPIN_S
            if coarse > 0:
                due = ctypes.c_longlong(-int(coarse * 1e7))       # relative, 100 ns units
                if self._k32.SetWaitableTimer(self._timer, ctypes.byref(due), 0, None, None, False):
                    self._k32.WaitForSingleObject(self._timer, INFINITE)
                else:  # pragma: no cover - only if the handle went bad
                    time.sleep(coarse)
        else:
            coarse = remaining - FALLBACK_SPIN_S
            if coarse > 0:
                time.sleep(coarse)
        while time.perf_counter() < deadline:
            pass

    def close(self) -> None:
        if self._timer is not None:
            self._k32.CloseHandle(self._timer)
            self._timer = None
        if self._winmm is not None:
            self._winmm.timeEndPeriod(1)
            self._winmm = None

    def __enter__(self) -> "Waiter":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


# --------------------------------------------------------------------------- thread / power

def set_thread_priority_high() -> bool:
    """Raise the calling thread to ``THREAD_PRIORITY_HIGHEST`` (Windows only)."""
    if not IS_WINDOWS:
        return False
    k32 = _kernel32()
    return bool(k32.SetThreadPriority(k32.GetCurrentThread(), THREAD_PRIORITY_HIGHEST))


def keep_awake(on: bool) -> bool:
    """Prevent (``on``) or allow system sleep for the calling thread's lifetime.

    ``SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)``; ``on=False``
    sends ``ES_CONTINUOUS`` alone, which clears the request.  Returns success.
    """
    if not IS_WINDOWS:
        return False
    flags = ES_CONTINUOUS | (ES_SYSTEM_REQUIRED if on else 0)
    return _kernel32().SetThreadExecutionState(flags) != 0


@dataclass(frozen=True)
class PowerStatus:
    on_battery: bool | None          # None = unknown
    battery_saver: bool | None
    battery_pct: int | None


def power_status() -> PowerStatus:
    """``GetSystemPowerStatus``: AC line status, battery saver flag, charge."""
    if not IS_WINDOWS:
        return PowerStatus(None, None, None)
    from ctypes import wintypes

    class SYSTEM_POWER_STATUS(ctypes.Structure):
        _fields_ = [("ACLineStatus", wintypes.BYTE), ("BatteryFlag", wintypes.BYTE),
                    ("BatteryLifePercent", wintypes.BYTE), ("SystemStatusFlag", wintypes.BYTE),
                    ("BatteryLifeTime", wintypes.DWORD), ("BatteryFullLifeTime", wintypes.DWORD)]

    sps = SYSTEM_POWER_STATUS()
    if not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(sps)):
        return PowerStatus(None, None, None)
    ac = sps.ACLineStatus & 0xFF
    pct = sps.BatteryLifePercent & 0xFF
    return PowerStatus(on_battery=None if ac == 255 else ac == 0,
                       battery_saver=bool(sps.SystemStatusFlag & 1),
                       battery_pct=None if pct == 255 else pct)


# --------------------------------------------------------------------------- single instance

class AlreadyRunning(RuntimeError):
    """Another GCS runtime holds the single-instance lock."""


class SingleInstance:
    """Named mutex (Windows) or lock file (elsewhere). :meth:`acquire` raises :class:`AlreadyRunning`."""

    def __init__(self, name: str = "vtol-gcs-sender", lock_dir: Path | None = None) -> None:
        self.name = name
        self._handle = None
        self._file = None
        self._lock_dir = lock_dir

    def acquire(self) -> "SingleInstance":
        if IS_WINDOWS:
            k32 = _kernel32()
            for prefix in ("Global\\", "Local\\"):
                handle = k32.CreateMutexW(None, False, prefix + self.name)
                err = ctypes.get_last_error()
                if not handle:
                    if err == ERROR_ACCESS_DENIED:       # held in another session, or no rights
                        if prefix == "Global\\":
                            raise AlreadyRunning(f"another GCS runtime is running ({prefix}{self.name})")
                    continue
                if err == ERROR_ALREADY_EXISTS:
                    k32.CloseHandle(handle)
                    raise AlreadyRunning(f"another GCS runtime is running ({prefix}{self.name})")
                self._handle = handle
                return self
            raise AlreadyRunning(f"cannot create the single-instance mutex {self.name}")  # pragma: no cover
        import fcntl  # pragma: no cover - non-Windows only
        lock_dir = self._lock_dir or Path(os.environ.get("TMPDIR", "/tmp"))
        self._file = open(lock_dir / f"{self.name}.lock", "w")
        try:
            fcntl.flock(self._file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self._file.close()
            self._file = None
            raise AlreadyRunning(f"another GCS runtime is running ({self.name})") from exc
        return self

    def release(self) -> None:
        if self._handle is not None:
            _kernel32().CloseHandle(self._handle)
            self._handle = None
        if self._file is not None:  # pragma: no cover - non-Windows only
            self._file.close()
            self._file = None

    def __enter__(self) -> "SingleInstance":
        return self.acquire()

    def __exit__(self, *exc: object) -> None:
        self.release()
