"""ELRS TX-module parameter menu through ``crsf_pass`` (plan §7.7, §14.3; brief R5/R6).

With the relay's bridge acting as the handset, no radio Lua script can reach the TX module, so the
app speaks the CRSF parameter protocol the ELRS Lua script uses (byte layouts and sources in
:mod:`vtolgcs.crsf`):

1. device ping ``0x28`` (broadcast) -> device info ``0x29`` (name, field count);
2. parameter read ``0x2C <param> <chunk>`` -> parameter entry ``0x2B`` chunks, joined by
   :class:`vtolgcs.crsf.ParameterAssembler`; parameters ``1..field_count`` form a folder tree;
3. parameter write ``0x2D <param> <value>``, then the entry is read again; a COMMAND parameter is
   written ``CLICK`` and polled until it is idle again (``ASK_CONFIRM`` is reported to the operator).

Transport: the UI process sends frames with the control command ``crsf_send`` (the RC sender wraps
them in ``crsf_pass``, C3) and gets the module's replies as ``crsf`` events.  ``crsf_pass`` is a
**future bridge firmware feature (Q7a)**: when the ping is sent but nothing answers, the menu says
:data:`NOT_SUPPORTED`.  The RC sender refuses parameter writes while the client may be armed.

VTX Admin quick panel and VRX follow (§14.3): :class:`VtxAdmin` finds the module's VTX folder
(band, channel, power, pit mode, "send") and :class:`VrxFollow` tracks what happens to the video
receiver afterwards.
"""

from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from . import crsf
from .crsf import Addr, CommandStep, FrameType, ParamType

NOT_SUPPORTED = "Not supported by bridge firmware (Q7a)"
#: The menu sends at most one frame per this interval (app default: 25 frames/s, half the RC
#: sender's ``CRSF_PASS_MAX_PER_S``).
MIN_INTERVAL_S = 0.04
VRX_FOLLOW_TEXT = "VRX follow: via backpack (automatic if fitted) / via N6 (firmware TBD)"

#: Send function: ``send(frame) -> (ok, reasons)`` (the control channel's ``crsf_send``).
SendFn = Callable[[bytes], "tuple[bool, list[str]]"]


class MenuError(RuntimeError):
    """A menu operation failed (send refused, no reply, bad data)."""


class NotSupported(MenuError):
    """The bridge sent the ping but no module answered: ``crsf_pass`` (Q7a) is not implemented."""


@dataclass
class MenuTree:
    device: crsf.DeviceInfo
    params: dict[int, crsf.ParameterEntry] = field(default_factory=dict)
    missing: list[int] = field(default_factory=list)          # parameters that never answered

    def children(self, parent: int) -> list[crsf.ParameterEntry]:
        """Entries under folder ``parent`` (0 = root): the folder's child list when it has one."""
        folder = self.params.get(parent)
        if folder is not None and folder.children:
            return [self.params[n] for n in folder.children if n in self.params]
        return [e for n, e in sorted(self.params.items()) if e.parent == parent and n != parent]

    def rows(self) -> list[tuple[int, int, crsf.ParameterEntry]]:
        """Depth-first ``(depth, parent, entry)`` rows for a tree view (hidden entries skipped)."""
        out: list[tuple[int, int, crsf.ParameterEntry]] = []

        def walk(parent: int, depth: int, seen: set[int]) -> None:
            for e in self.children(parent):
                if e.hidden or e.number in seen:
                    continue
                out.append((depth, parent, e))
                if e.type == ParamType.FOLDER:
                    walk(e.number, depth + 1, seen | {e.number})
        walk(0, 0, set())
        return out

    def find(self, name_part: str, parent: int | None = None) -> crsf.ParameterEntry | None:
        key = name_part.lower()
        for n, e in sorted(self.params.items()):
            if key in e.name.lower() and (parent is None or e.parent == parent):
                return e
        return None


def display_value(e: crsf.ParameterEntry) -> str:
    """Short text for a value cell."""
    if e.type == ParamType.TEXT_SELECTION:
        return e.value_label or str(e.value)
    if e.type == ParamType.FOLDER:
        return ""
    if e.type == ParamType.COMMAND:
        try:
            step = CommandStep(int(e.value or 0)).name
        except ValueError:
            step = str(e.value)
        return f"[{step}] {e.info}".strip()
    if e.type == ParamType.FLOAT and isinstance(e.value, int):
        return f"{e.value / 10 ** (e.precision or 0):.{e.precision or 0}f}{e.units}"
    return f"{e.value}{e.units}" if e.value is not None else ""


def editable(e: crsf.ParameterEntry) -> bool:
    return e.type in (ParamType.UINT8, ParamType.INT8, ParamType.UINT16, ParamType.INT16, ParamType.FLOAT,
                      ParamType.TEXT_SELECTION, ParamType.COMMAND)


class CrsfMenu:
    """Request/response logic. Call :meth:`feed` with every received frame (any thread); call the
    other methods from one worker thread (they block up to ``timeout_s * (retries + 1)``)."""

    def __init__(self, send: SendFn, timeout_s: float = 0.5, retries: int = 3,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._send = send
        self.timeout_s = timeout_s
        self.retries = retries
        self._clock = clock
        self._q: queue.Queue[crsf.CrsfFrame] = queue.Queue(maxsize=500)
        self.devices: dict[int, crsf.DeviceInfo] = {}
        self.tree: MenuTree | None = None
        self._lock = threading.Lock()
        self._last_tx = -1e9

    # -- input
    def feed(self, raw: bytes) -> None:
        """A frame forwarded by the bridge (``crsf`` event). Non-menu frames are ignored."""
        try:
            frame = crsf.parse_frame(raw)
        except crsf.CrsfError:
            return
        if frame.type in (FrameType.DEVICE_INFO, FrameType.PARAMETER_SETTINGS_ENTRY) \
                and frame.dest in (Addr.RADIO_TRANSMITTER, Addr.BROADCAST):
            try:
                self._q.put_nowait(frame)
            except queue.Full:
                pass

    def _drain(self) -> None:
        while True:
            try:
                self._q.get_nowait()
            except queue.Empty:
                return

    def _transmit(self, frame: bytes) -> None:
        wait = self._last_tx + MIN_INTERVAL_S - self._clock()
        if wait > 0:                                      # stay well below the sender's crsf_pass limit
            time.sleep(wait)
        self._last_tx = self._clock()
        ok, reasons = self._send(frame)
        if not ok:
            raise MenuError("; ".join(reasons) or "send refused")

    def _wait(self, want: Callable[[crsf.CrsfFrame], bool], timeout: float) -> crsf.CrsfFrame | None:
        end = self._clock() + timeout
        while True:
            left = end - self._clock()
            if left <= 0:
                return None
            try:
                frame = self._q.get(timeout=left)
            except queue.Empty:
                return None
            if frame.type == FrameType.DEVICE_INFO:
                try:
                    info = crsf.DeviceInfo.decode_frame(frame)
                    self.devices[info.origin] = info
                except crsf.CrsfError:
                    continue
            if want(frame):
                return frame

    # -- operations
    def ping(self) -> crsf.DeviceInfo:
        """Ping, return the TX module's device info. :class:`NotSupported` if nothing answers."""
        with self._lock:
            self._drain()
            for _ in range(self.retries + 1):
                self._transmit(crsf.build_device_ping())
                frame = self._wait(lambda f: f.type == FrameType.DEVICE_INFO and f.origin == Addr.CRSF_TRANSMITTER,
                                   self.timeout_s)
                if frame is not None:
                    return self.devices[Addr.CRSF_TRANSMITTER]
            raise NotSupported(NOT_SUPPORTED)

    def read_param(self, number: int) -> crsf.ParameterEntry:
        """All chunks of one parameter (with retries per chunk)."""
        with self._lock:
            return self._read_locked(number)

    def _read_locked(self, number: int) -> crsf.ParameterEntry:
        asm = crsf.ParameterAssembler()
        total: int | None = None                          # chunks of this entry, known after chunk 0
        tries = 0
        while True:
            chunk_no = asm.next_chunk
            expect = None if total is None else total - 1 - chunk_no

            def want(f: crsf.CrsfFrame) -> bool:          # skip late duplicates of earlier chunks
                return (f.type == FrameType.PARAMETER_SETTINGS_ENTRY and len(f.body) >= 2 and f.body[0] == number
                        and (expect is None if chunk_no == 0 else f.body[1] == expect))
            self._transmit(crsf.build_param_read(number, chunk_no))
            frame = self._wait(want, self.timeout_s)
            if frame is None:
                tries += 1
                if tries > self.retries:
                    raise MenuError(f"parameter {number}: no reply to chunk {chunk_no}")
                continue
            try:
                chunk = crsf.ParameterChunk.decode_frame(frame)
                entry = asm.feed(chunk)
            except crsf.CrsfError as exc:
                raise MenuError(f"parameter {number}: {exc}") from exc
            if entry is not None:
                return entry
            if chunk_no == 0:
                total = chunk.chunks_remaining + 1
            tries = 0                                     # retries count per chunk
            if asm.next_chunk == 0:                       # out of order: start over
                total = None

    def load_tree(self, progress: Callable[[int, int], None] | None = None) -> MenuTree:
        """Ping, then read parameters ``1..field_count``."""
        device = self.ping()
        tree = MenuTree(device)
        with self._lock:
            for n in range(1, device.field_count + 1):
                try:
                    tree.params[n] = self._read_locked(n)
                except MenuError:
                    tree.missing.append(n)
                if progress:
                    progress(n, device.field_count)
        self.tree = tree
        return tree

    def write(self, number: int, value: int) -> crsf.ParameterEntry:
        """Write a value and read the parameter back. The RC sender may refuse (client armed)."""
        entry = self._entry(number)
        if not editable(entry) or entry.type == ParamType.COMMAND:
            raise MenuError(f"{entry.name}: not a writable value")
        if isinstance(entry.min, int) and isinstance(entry.max, int) and not entry.min <= value <= entry.max:
            raise MenuError(f"{entry.name}: {value} outside {entry.min}..{entry.max}")
        with self._lock:
            self._drain()
            self._transmit(crsf.build_param_write(number, crsf.encode_param_value(entry.type, value)))
            fresh = self._read_locked(number)
        if self.tree is not None:
            self.tree.params[number] = fresh
        return fresh

    def command(self, number: int, step: int = CommandStep.CLICK, max_wait_s: float = 5.0) -> crsf.ParameterEntry:
        """Run a COMMAND parameter: write ``step``, poll until IDLE or ASK_CONFIRM (or ``max_wait_s``)."""
        entry = self._entry(number)
        if entry.type != ParamType.COMMAND:
            raise MenuError(f"{entry.name}: not a command")
        with self._lock:
            self._drain()
            self._transmit(crsf.build_param_write(number, crsf.encode_param_value(entry.type, step)))
            end = self._clock() + max_wait_s
            while True:
                fresh = self._read_locked(number)
                if fresh.value in (CommandStep.IDLE, CommandStep.ASK_CONFIRM) or self._clock() >= end:
                    break
                time.sleep(max(0.05, min(0.5, (fresh.timeout_ms or 100) / 1000)))
        if self.tree is not None:
            self.tree.params[number] = fresh
        return fresh

    def _entry(self, number: int) -> crsf.ParameterEntry:
        if self.tree is None or number not in self.tree.params:
            return self.read_param(number)
        return self.tree.params[number]


# --------------------------------------------------------------------------- VTX Admin quick panel

@dataclass
class VtxFields:
    folder: crsf.ParameterEntry
    band: crsf.ParameterEntry | None
    channel: crsf.ParameterEntry | None
    power: crsf.ParameterEntry | None
    pitmode: crsf.ParameterEntry | None
    send: crsf.ParameterEntry | None

    def values(self) -> dict[str, int | None]:
        return {k: (getattr(self, k).value if getattr(self, k) is not None else None)
                for k in ("band", "channel", "power", "pitmode")}


class VtxAdmin:
    """The module's VTX Administrator folder (names as in the ELRS TX Lua menu: "VTX Administrator",
    "Band", "Channel", "Pwr Lvl", "Pitmode", "Send VTx"; matched by part of the name)."""

    def __init__(self, menu: CrsfMenu) -> None:
        self.menu = menu

    def fields(self) -> VtxFields | None:
        tree = self.menu.tree
        if tree is None:
            return None
        folder = next((e for e in tree.params.values() if e.type == ParamType.FOLDER and "vtx" in e.name.lower()), None)
        if folder is None:
            return None
        kids = [tree.params[n] for n in folder.children if n in tree.params] or tree.children(folder.number)

        def pick(*keys: str, ptype: int | None = None) -> crsf.ParameterEntry | None:
            for e in kids:
                if any(k in e.name.lower() for k in keys) and (ptype is None or e.type == ptype):
                    return e
            return None
        return VtxFields(folder, pick("band"), pick("channel"), pick("pwr", "power"), pick("pit"),
                         pick("send", ptype=ParamType.COMMAND))

    def apply(self, band: int | None, channel: int | None, power: int | None = None) -> dict[str, int | None]:
        """Write the given values, then run "Send VTx". Returns the values before (for a revert)."""
        f = self.fields()
        if f is None:
            raise MenuError("no VTX Administrator folder in the module menu (load the menu first)")
        before = f.values()
        for entry, value in ((f.band, band), (f.channel, channel), (f.power, power)):
            if value is not None:
                if entry is None:
                    raise MenuError("VTX Administrator: field missing")
                self.menu.write(entry.number, value)
        if f.send is not None:
            self.menu.command(f.send.number)
        return before


# --------------------------------------------------------------------------- VRX follow (R6)

class VrxFollow:
    """What happens to the video receiver after a VTX Admin change (plan §14.3).

    Without decoder-lock reporting (C2 ``video.decoder_lock`` null) only :data:`VRX_FOLLOW_TEXT` is
    shown.  With it, the state goes ``waiting`` -> ``locked``, or ``no_lock`` after
    ``lock_timeout_s`` (the UI then offers to revert to the previous values).  A revert goes
    ``reverting`` -> ``reverted`` or ``revert_failed`` only when its outcome is known (WP13 R5).
    """

    def __init__(self, lock_timeout_s: float, clock: Callable[[], float] = time.monotonic) -> None:
        self.lock_timeout_s = lock_timeout_s
        self._clock = clock
        self.state = "idle"
        self.previous: dict[str, int | None] | None = None
        self.error: str | None = None
        self._since: float | None = None

    def start(self, previous: dict[str, int | None]) -> None:
        self.previous, self._since, self.state = previous, self._clock(), "waiting"

    def begin_revert(self) -> dict[str, int | None]:
        """The revert writes are being sent; returns the values to write back."""
        self.state, self.error = "reverting", None
        return dict(self.previous or {})

    def revert_done(self, error: str | None) -> None:
        """The outcome of the revert writes: ``None`` = all written, else why they failed."""
        if error is None:
            self.state = "reverted"
        else:
            self.state, self.error = "revert_failed", error

    def update(self, decoder_lock: bool | None) -> str:
        if self.state in ("idle", "locked", "reverting", "reverted", "revert_failed"):
            return self.state
        if decoder_lock is None:
            self.state = "unknown"
        elif decoder_lock:
            self.state = "locked"
        elif self._since is not None and self._clock() - self._since >= self.lock_timeout_s:
            self.state = "no_lock"
        else:
            self.state = "waiting"
        return self.state

    @property
    def offer_revert(self) -> bool:
        return self.state in ("no_lock", "revert_failed") and self.previous is not None

    def text(self) -> str:
        extra = {"idle": "", "unknown": " - decoder lock not reported: check the picture",
                 "waiting": " - waiting for decoder lock", "locked": " - decoder LOCKED",
                 "no_lock": f" - NO decoder lock after {self.lock_timeout_s:.0f} s: revert?",
                 "reverting": " - reverting...", "reverted": " - reverted",
                 "revert_failed": f" - revert FAILED ({self.error}): the VTX may still be on the new "
                                  "channel; retry?"}[self.state]
        return VRX_FOLLOW_TEXT + extra


__all__ = ["CrsfMenu", "MenuError", "MenuTree", "NOT_SUPPORTED", "NotSupported", "VRX_FOLLOW_TEXT", "VrxFollow",
           "VtxAdmin", "VtxFields", "display_value", "editable"]


def control_send(client: object) -> SendFn:
    """A :data:`SendFn` over the control channel (``crsf_send``); channel errors become refusals."""
    from .control import ControlError

    def send(frame: bytes) -> tuple[bool, list[str]]:
        try:
            reply = client.request("crsf_send", frame=frame.hex())      # type: ignore[attr-defined]
        except ControlError as exc:
            return False, [f"RC sender not reachable: {exc}"]
        if reply.get("error"):
            return False, [reply["error"]]
        return bool(reply.get("ok")), list(reply.get("reasons") or [])
    return send
