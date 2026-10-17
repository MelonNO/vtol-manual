"""Windows console helpers for the WP15 tests: type keys into another process's console, find its windows.

Keys are written with ``WriteConsoleInputW`` from a helper process that attaches to the target's console,
exactly as if they were typed on it.  The target is started with ``CREATE_NO_WINDOW`` (a real console
without a window), so nothing appears on the desktop and no window can take the focus.
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
k = ctypes.WinDLL("kernel32", use_last_error=True)
k.FreeConsole()
if not k.AttachConsole(int(sys.argv[1])):
    sys.exit("AttachConsole failed: %d" % ctypes.get_last_error())
k.SetConsoleCtrlHandler(None, True)
if not k.GenerateConsoleCtrlEvent(0, 0):
    sys.exit("GenerateConsoleCtrlEvent failed: %d" % ctypes.get_last_error())
print("ok")
'''


def type_keys(pid: int, text: str) -> None:
    """Type ``text`` ("\\r" = Enter) into the console of process ``pid``."""
    r = subprocess.run([sys.executable, "-c", _TYPE_HELPER, str(pid), text], capture_output=True, text=True,
                       timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
    assert r.returncode == 0 and r.stdout.strip() == "ok", r.stdout + r.stderr


def ctrl_c(pid: int) -> None:
    """Press Ctrl+C on the console of process ``pid``."""
    r = subprocess.run([sys.executable, "-c", _CTRL_C_HELPER, str(pid)], capture_output=True, text=True,
                       timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
    assert r.returncode == 0 and r.stdout.strip() == "ok", r.stdout + r.stderr


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
