"""Windows console helpers for the WP15/WP16 tests: type keys into another process's console, press Ctrl+C
or Ctrl+Break on it, read its screen, find its windows.

Keys are written with ``WriteConsoleInputW`` from a helper process that attaches to the target's console,
exactly as if they were typed on it.  The target is started with ``CREATE_NO_WINDOW`` (a real console
without a window), so nothing appears on the desktop and no window can take the focus.

WP16 R4: a process inherits "ignore Ctrl+C" from its parent (any ancestor started with
``CREATE_NEW_PROCESS_GROUP``, e.g. some shells and CI runners), and then a Ctrl+C never reaches it.
:func:`vtolgcs_command` starts ``python -m vtolgcs`` with that flag cleared, so Ctrl+C is delivered for
real, as on an operator's console.
"""

from __future__ import annotations

import subprocess
import sys

#: argv: pid, text.  Key-down and key-up records per character; "\r" is Enter.
_TYPE_HELPER = r'''
import ctypes, sys
from ctypes import wintypes
k = ctypes.WinDLL("kernel32", use_last_error=True)
pid, text = int(sys.argv[1]), sys.argv[2]
k.FreeConsole()
if not k.AttachConsole(pid):
    sys.exit("AttachConsole failed: %d" % ctypes.get_last_error())
k.SetConsoleCtrlHandler(None, True)
k.CreateFileW.restype = wintypes.HANDLE
h = k.CreateFileW("CONIN$", 0xC0000000, 3, None, 3, 0, None)
class KER(ctypes.Structure):
    _fields_ = [("bKeyDown", wintypes.BOOL), ("wRepeatCount", wintypes.WORD), ("wVirtualKeyCode", wintypes.WORD),
                ("wVirtualScanCode", wintypes.WORD), ("uChar", wintypes.WCHAR), ("dwControlKeyState", wintypes.DWORD)]
class IR(ctypes.Structure):
    _fields_ = [("EventType", wintypes.WORD), ("Event", KER)]
recs = [IR(1, KER(down, 1, 0x0D if ch == "\r" else 0, 0, ch, 0)) for ch in text for down in (1, 0)]
n = wintypes.DWORD()
if not k.WriteConsoleInputW(h, (IR * len(recs))(*recs), len(recs), ctypes.byref(n)) or n.value != len(recs):
    sys.exit("WriteConsoleInputW failed: %d" % ctypes.get_last_error())
print("ok")
'''

_CTRL_C_HELPER = r'''
import ctypes, sys
from ctypes import wintypes
k = ctypes.WinDLL("kernel32", use_last_error=True)
k.FreeConsole()
if not k.AttachConsole(int(sys.argv[1])):
    sys.exit("AttachConsole failed: %d" % ctypes.get_last_error())
k.SetConsoleCtrlHandler(None, True)
keep = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)(lambda event: True)   # this helper survives Ctrl+Break
k.SetConsoleCtrlHandler(keep, True)
if not k.GenerateConsoleCtrlEvent(int(sys.argv[2]), 0):
    sys.exit("GenerateConsoleCtrlEvent failed: %d" % ctypes.get_last_error())
print("ok")
'''


#: argv: pid.  Prints the console's screen buffer up to the cursor row (UTF-8).
_SCREEN_HELPER = r'''
import ctypes, sys
from ctypes import wintypes
k = ctypes.WinDLL("kernel32", use_last_error=True)
k.FreeConsole()
if not k.AttachConsole(int(sys.argv[1])):
    sys.exit("AttachConsole failed: %d" % ctypes.get_last_error())
k.CreateFileW.restype = wintypes.HANDLE
h = k.CreateFileW("CONOUT$", 0xC0000000, 3, None, 3, 0, None)
class COORD(ctypes.Structure): _fields_ = [("X", ctypes.c_short), ("Y", ctypes.c_short)]
class SR(ctypes.Structure): _fields_ = [("L", ctypes.c_short), ("T", ctypes.c_short), ("R", ctypes.c_short), ("B", ctypes.c_short)]
class CSBI(ctypes.Structure): _fields_ = [("size", COORD), ("cur", COORD), ("attr", wintypes.WORD), ("win", SR), ("max", COORD)]
info = CSBI()
if not k.GetConsoleScreenBufferInfo(h, ctypes.byref(info)):
    sys.exit("GetConsoleScreenBufferInfo failed: %d" % ctypes.get_last_error())
w, rows = info.size.X, info.cur.Y + 1
buf = ctypes.create_unicode_buffer(w * rows)
n = wintypes.DWORD()
k.ReadConsoleOutputCharacterW(h, buf, w * rows, COORD(0, 0), ctypes.byref(n))
text = buf[: n.value]
sys.stdout.buffer.write("\n".join(text[i:i + w].rstrip() for i in range(0, len(text), w)).encode("utf-8"))
'''

#: ``python -c`` code that clears the inherited "ignore Ctrl+C" flag, then runs ``python -m vtolgcs``.
_RUN_WITH_CTRL_C = ("import ctypes, runpy; ctypes.WinDLL('kernel32').SetConsoleCtrlHandler(None, False); "
                    "runpy.run_module('vtolgcs', run_name='__main__', alter_sys=True)")

CTRL_C_EVENT, CTRL_BREAK_EVENT = 0, 1


def vtolgcs_command(*args: str) -> list[str]:
    """``python -m vtolgcs *args`` with Ctrl+C processing switched on in the target (WP16 R4)."""
    return [sys.executable, "-c", _RUN_WITH_CTRL_C, *args]


def type_keys(pid: int, text: str) -> None:
    """Type ``text`` ("\\r" = Enter) into the console of process ``pid``."""
    r = subprocess.run([sys.executable, "-c", _TYPE_HELPER, str(pid), text], capture_output=True, text=True,
                       timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
    assert r.returncode == 0 and r.stdout.strip() == "ok", r.stdout + r.stderr


def ctrl_c(pid: int, event: int = CTRL_C_EVENT) -> None:
    """Press Ctrl+C (or ``CTRL_BREAK_EVENT``: Ctrl+Break) on the console of process ``pid``."""
    r = subprocess.run([sys.executable, "-c", _CTRL_C_HELPER, str(pid), str(event)], capture_output=True,
                       text=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
    assert r.returncode == 0 and r.stdout.strip() == "ok", r.stdout + r.stderr


def ctrl_break(pid: int) -> None:
    ctrl_c(pid, CTRL_BREAK_EVENT)


def screen(pid: int) -> list[str]:
    """The lines of the console screen buffer of process ``pid``, up to the cursor row."""
    r = subprocess.run([sys.executable, "-c", _SCREEN_HELPER, str(pid)], capture_output=True, timeout=30,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
    return r.stdout.decode("utf-8", "replace").splitlines()


def visible_windows(pids: set[int]) -> list[str]:
    """Titles of the visible top-level windows owned by ``pids``."""
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.WinDLL("user32")
    found: list[str] = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def each(hwnd, _lparam):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids and user32.IsWindowVisible(hwnd):
            buf = ctypes.create_unicode_buffer(200)
            user32.GetWindowTextW(hwnd, buf, 200)
            found.append(f"{pid.value}: {buf.value!r}")
        return True
    user32.EnumWindows(each, 0)
    return found


def foreground_pid() -> int:
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.WinDLL("user32")
    user32.GetForegroundWindow.restype = wintypes.HWND
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), ctypes.byref(pid))
    return pid.value
