"""FPV controller input: a USB joystick (RadioMaster EdgeTX radio) mapped to 16 RC channels.

The sender only ever sees :class:`ControllerSnapshot` objects through the
:class:`Controller` interface, so tests use :class:`FakeController`.

* :class:`PygameController` polls pygame-ce in its **own thread** (default
  500 Hz), with ``SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS=1`` so input keeps
  flowing whatever window has focus (plan §7.3).  A ``JOYDEVICEREMOVED``
  event marks the device disconnected at once; the snapshot time ``t`` also
  stops advancing, so the sender treats data older than
  ``controller.stale_ms`` (<= 100 ms) as a disconnect even if the poll thread hangs.
* Mapping (plan §7.3, EdgeTX *Classic* joystick mode): axes -> CH1-8,
  buttons -> CH9+.  Axis ``min``..``max`` maps linearly to 988..2012 us
  (EdgeTX -100 %..+100 %); a button is 2012 us pressed, 988 us released;
  unmapped channels are centred (1500 us).
* CRSF values use the C3 endpoint-exact scaling via :func:`vtolgcs.protocol.us_to_crsf`.
"""

from __future__ import annotations

import logging
import math
import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Protocol, Sequence

from . import protocol
from .config import ChannelSource, ControllerConfig

log = logging.getLogger("vtolgcs.controller")

US_CENTRE = 1500
NUM_CHANNELS = protocol.NUM_CHANNELS
CENTRED_US: tuple[int, ...] = (US_CENTRE,) * NUM_CHANNELS


@dataclass(frozen=True)
class ControllerSnapshot:
    """One consistent read of the controller. Immutable, so it can be handed between threads."""

    connected: bool
    name: str | None
    #: 16 channel values in microseconds (centred when disconnected; never sent then).
    channels_us: tuple[int, ...]
    #: ``time.perf_counter()`` of the read (or the injected clock).
    t: float

    def channel_us(self, number: int) -> int:
        """Channel value by 1-based channel number."""
        return self.channels_us[number - 1]


class Controller(Protocol):
    """What the sender needs from a controller."""

    def start(self) -> None: ...
    def stop(self) -> None: ...
    def snapshot(self) -> ControllerSnapshot: ...


# --------------------------------------------------------------------------- mapping

def axis_to_us(value: float, src: ChannelSource) -> int:
    """Raw joystick axis value -> pulse width, 988..2012 us (``src.min`` -> 988, ``src.max`` -> 2012)."""
    if not math.isfinite(value):
        return US_CENTRE
    frac = (value - src.min) / (src.max - src.min)
    if src.reverse:
        frac = 1.0 - frac
    frac = max(0.0, min(1.0, frac))
    return protocol.US_MIN + round(frac * (protocol.US_MAX - protocol.US_MIN))


def button_to_us(pressed: bool, src: ChannelSource) -> int:
    on = bool(pressed) != src.reverse
    return protocol.US_MAX if on else protocol.US_MIN


def map_inputs(axes: Sequence[float], buttons: Sequence[bool],
               channel_map: Sequence[ChannelSource]) -> tuple[int, ...]:
    """Map raw axes/buttons to 16 channel values (us). Missing inputs and unmapped channels are centred."""
    out = list(CENTRED_US)
    for i, src in enumerate(channel_map[:NUM_CHANNELS]):
        if src.src == "axis" and src.index < len(axes):
            out[i] = axis_to_us(axes[src.index], src)
        elif src.src == "button" and src.index < len(buttons):
            out[i] = button_to_us(buttons[src.index], src)
    return tuple(out)


def channels_to_crsf(channels_us: Sequence[int]) -> tuple[int, ...]:
    """Pulse widths -> CRSF channel values (contract C3 scaling, clamped 172..1811)."""
    return tuple(protocol.us_to_crsf(us) for us in channels_us)


def choose_device(names: Sequence[str], cfg: ControllerConfig) -> int | None:
    """Pick a joystick index.

    ``device_name`` set: that exact name only.  Otherwise the first device whose
    name contains the first matching ``prefer_names`` entry (case-insensitive),
    else the first device.
    """
    if not names:
        return None
    if cfg.device_name:
        return next((i for i, n in enumerate(names) if n == cfg.device_name), None)
    for want in cfg.prefer_names:
        for i, name in enumerate(names):
            if want.lower() in name.lower():
                return i
    return 0


# --------------------------------------------------------------------------- fake (tests, --sim)

class FakeController:
    """A controller for tests and ``--sim``. Thread-safe; the snapshot time follows ``clock``.

    ``freeze()`` simulates a hung input thread: the snapshot keeps its last time.
    """

    def __init__(self, channels_us: Sequence[int] | None = None, name: str = "Fake EdgeTX Joystick",
                 clock: Callable[[], float] = time.perf_counter, connected: bool = True) -> None:
        self._lock = threading.Lock()
        self._clock = clock
        self.name = name
        self._connected = connected
        self._frozen_t: float | None = None
        self._channels = list(channels_us) if channels_us is not None else safe_channels()

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass

    def set_channel_us(self, number: int, us: int) -> None:
        with self._lock:
            self._channels[number - 1] = int(us)

    def set_channels_us(self, channels_us: Sequence[int]) -> None:
        with self._lock:
            self._channels = list(channels_us)

    def disconnect(self) -> None:
        with self._lock:
            self._connected = False

    def connect(self) -> None:
        with self._lock:
            self._connected = True
            self._frozen_t = None

    def freeze(self) -> None:
        with self._lock:
            self._frozen_t = self._clock()

    def snapshot(self) -> ControllerSnapshot:
        with self._lock:
            t = self._frozen_t if self._frozen_t is not None else self._clock()
            if not self._connected:
                return ControllerSnapshot(False, None, CENTRED_US, t)
            return ControllerSnapshot(True, self.name, tuple(self._channels), t)


def safe_channels(arm_channel: int = 5, arm_us: int = protocol.US_MIN,
                  throttle_channel: int = 3, throttle_us: int = protocol.US_MIN) -> list[int]:
    """Centred sticks, throttle low, arm switch low: passes the start interlock with the default config."""
    ch = list(CENTRED_US)
    ch[throttle_channel - 1] = throttle_us
    ch[arm_channel - 1] = arm_us
    return ch


# --------------------------------------------------------------------------- pygame-ce

class PygameController:
    """pygame-ce joystick reader running in its own thread.

    ``pygame_module`` lets tests inject a fake pygame; by default the real one is
    imported inside the thread (SDL wants init and event pumping on one thread).
    """

    RESCAN_S = 0.5

    def __init__(self, cfg: ControllerConfig, clock: Callable[[], float] = time.perf_counter,
                 pygame_module: Any = None) -> None:
        self.cfg = cfg
        self._clock = clock
        self._pg = pygame_module
        self._snap = ControllerSnapshot(False, None, CENTRED_US, clock())
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._joy: Any = None
        self._next_scan = 0.0
        self.devices: list[str] = []
        self.error: str | None = None

    # -- public
    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="controller", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    def snapshot(self) -> ControllerSnapshot:
        return self._snap            # attribute read is atomic; the object is immutable

    # -- thread
    def _init(self) -> bool:
        os.environ.setdefault("SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS", "1")
        os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
        try:
            if self._pg is None:
                import pygame  # noqa: PLC0415 - optional dependency, imported in the input thread
                self._pg = pygame
            self._pg.display.init()      # the event queue needs the video subsystem (no window opened)
            self._pg.joystick.init()
            return True
        except Exception as exc:         # missing pygame-ce or SDL failure: report, stay disconnected
            self.error = f"joystick input unavailable: {exc}"
            log.error("%s", self.error)
            return False

    def _run(self) -> None:
        if not self._init():
            return
        period = 1.0 / self.cfg.poll_hz
        while not self._stop.is_set():
            try:
                self.poll_once()
            except Exception as exc:     # never let the input thread die silently
                log.warning("controller poll failed: %s", exc)
                self._drop("poll error")
            time.sleep(period)
        try:
            self._pg.joystick.quit()
        except Exception:  # pragma: no cover - shutdown best effort
            pass

    def _drop(self, why: str) -> None:
        if self._joy is not None:
            log.warning("controller disconnected (%s)", why)
        self._joy = None
        self._snap = ControllerSnapshot(False, None, CENTRED_US, self._clock())

    def _scan(self) -> None:
        pg = self._pg
        count = pg.joystick.get_count()
        joys = [pg.joystick.Joystick(i) for i in range(count)]
        self.devices = [j.get_name() for j in joys]
        idx = choose_device(self.devices, self.cfg)
        if idx is not None:
            joy = joys[idx]
            if hasattr(joy, "init"):
                joy.init()
            self._joy = joy
            log.info("controller: using %r (%d axes, %d buttons)", self.devices[idx],
                     joy.get_numaxes(), joy.get_numbuttons())

    def poll_once(self) -> None:
        """One poll: handle hot-plug events, read the device, publish a snapshot."""
        pg = self._pg
        now = self._clock()
        for ev in pg.event.get():
            if ev.type == pg.JOYDEVICEREMOVED and self._joy is not None \
                    and getattr(ev, "instance_id", None) == self._joy.get_instance_id():
                self._drop("device removed")
            elif ev.type == pg.JOYDEVICEADDED and self._joy is None:
                self._next_scan = 0.0
        if self._joy is None:
            if now >= self._next_scan:
                self._next_scan = now + self.RESCAN_S
                self._scan()
            if self._joy is None:
                self._snap = ControllerSnapshot(False, None, CENTRED_US, now)
                return
        joy = self._joy
        axes = [joy.get_axis(i) for i in range(joy.get_numaxes())]
        buttons = [bool(joy.get_button(i)) for i in range(joy.get_numbuttons())]
        channels = map_inputs(axes, buttons, self.cfg.channel_map)
        self._snap = ControllerSnapshot(True, joy.get_name(), channels, self._clock())
