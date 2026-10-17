"""System-wide hotkey (Windows ``RegisterHotKey``) for the camera toggle (brief R1, default F9).

The pilot's focus is usually on the video viewer, so a window-only key binding is not enough.  The
hotkey thread owns a Windows message loop; a press calls ``callback`` on that thread (the UI hands it
to Tk with a queue).  Elsewhere, or if the key is taken by another program, :meth:`start` returns False
and the UI falls back to a window binding.
"""

from __future__ import annotations

import sys
import threading
from typing import Callable

WM_HOTKEY = 0x0312
WM_QUIT = 0x0012
MOD_NOREPEAT = 0x4000


def vk_code(name: str) -> int | None:
    """``F1``..``F24`` -> virtual-key code (0x70..0x87)."""
    name = name.strip().upper()
    if name.startswith("F") and name[1:].isdigit() and 1 <= int(name[1:]) <= 24:
        return 0x70 + int(name[1:]) - 1
    return None


class GlobalHotkey:
    def __init__(self, key: str, callback: Callable[[], None]) -> None:
        self.key = key
        self.callback = callback
        self._thread: threading.Thread | None = None
        self._thread_id: int | None = None
        self._ready = threading.Event()
        self.ok = False

    def start(self) -> bool:
        vk = vk_code(self.key)
        if sys.platform != "win32" or vk is None:
            return False
        self._thread = threading.Thread(target=self._run, args=(vk,), name="hotkey", daemon=True)
        self._thread.start()
        self._ready.wait(2.0)
        return self.ok

    def _run(self, vk: int) -> None:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32")
        self._thread_id = kernel32.GetCurrentThreadId()
        self.ok = bool(user32.RegisterHotKey(None, 1, MOD_NOREPEAT, vk))
        self._ready.set()
        if not self.ok:
            return
        msg = wintypes.MSG()
        try:
            while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                if msg.message == WM_HOTKEY:
                    try:
                        self.callback()
                    except Exception:
                        pass
        finally:
            user32.UnregisterHotKey(None, 1)

    def stop(self) -> None:
        if self._thread_id is not None and sys.platform == "win32":
            import ctypes
            ctypes.WinDLL("user32").PostThreadMessageW(self._thread_id, WM_QUIT, 0, 0)


__all__ = ["GlobalHotkey", "vk_code"]
