"""RC sender: builds ``rc_up`` at 200-250 Hz on absolute deadlines, with safety interlocks.

**Flight-safety path.** The rules (plan §7.3, brief R4/R5) are deliberately few:

* Modes: ``idle`` (nothing sent), ``fpv`` (controller -> client), ``carrier_only``
  (arm channel forced safe, throttle low, everything else centred; no controller
  needed; lets the carrier camera run without a client, plan §3.4-3 interim).
* **Start interlock** — entering ``fpv`` (from ``idle`` or ``carrier_only``) and
  entering ``carrier_only`` from ``fpv`` need: controller connected, its data
  fresh, the arm channel inside the safe range **and** throttle low.
* **Controller lost** (disconnected, or no fresh data for ``controller.stale_ms``)
  while in ``fpv`` -> the very next tick sends **nothing**.  The last values are
  never repeated.  The sender stays *suspended* (mode still ``fpv``) and does
  not restart by itself when the controller comes back; the bridge's T_hold
  then fires and the client goes to its own failsafe.
* **Two start paths** for ``fpv`` (PM amendment to R4):

  - **normal** (:meth:`Sender.request_mode`) -- the start interlock above.
  - **resume (client airborne)** (:meth:`Sender.prepare_resume` then
    :meth:`Sender.confirm_resume`) -- for a client that may be flying (in
    failsafe / GPS Rescue after the bridge went silent, the app crashed or was
    restarted).  Forcing the pilot to put the arm switch to DISARM first would
    make the first packet *disarm the airborne client*.  The resume path needs
    the arm switch **ARMED**, shows the live arm and throttle values in a
    preview *before any packet*, and starts only on an explicit confirmation of
    that preview (single-use token, valid :data:`RESUME_CONFIRM_S`).  With the
    throttle at minimum (<= ``throttle_low_max_us``) a second, separate
    confirmation is required.  It is allowed only while nothing is being sent.

* **Never auto-resume.**  The sender starts ``idle``; a stopped stream stays
  stopped until the pilot picks *normal* or *resume*.
* ``idle`` is always allowed and is the operator's explicit stop.
* Any unexpected exception while building a packet suspends the stream
  (``internal_error``): silence is the fail-safe output.

The thread is independent of any UI (window focus cannot pause it), runs at
``THREAD_PRIORITY_HIGHEST`` and holds ``ES_SYSTEM_REQUIRED`` while streaming.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Sequence

from . import protocol, timing_win
from .config import Config, InterlockConfig
from .controller import CENTRED_US, Controller, ControllerSnapshot, channels_to_crsf

log = logging.getLogger("vtolgcs.sender")


class Mode(str, Enum):
    IDLE = "idle"
    FPV = "fpv"
    CARRIER_ONLY = "carrier_only"


#: How the current stream was started.
START_NORMAL = "normal"
START_RESUME = "resume"
#: A resume preview must be confirmed within this many seconds (app default).
RESUME_CONFIRM_S = 15.0

#: Why a stream was suspended (mode kept, nothing sent).
SUSPEND_CONTROLLER = "controller_disconnected"
SUSPEND_INTERNAL = "internal_error"


@dataclass(frozen=True)
class ModeResult:
    ok: bool
    mode: Mode
    reasons: tuple[str, ...] = ()


@dataclass(frozen=True)
class ResumePreview:
    """What the pilot must see before confirming a RESUME (client airborne) start."""

    token: int
    created: float
    controller: str | None
    arm_channel: int
    arm_us: int | None
    throttle_channel: int
    throttle_us: int | None
    arm_armed: bool | None              # arm switch outside the safe range
    throttle_at_min: bool | None        # throttle <= throttle_low_max_us
    problems: tuple[str, ...]           # anything that blocks the resume

    @property
    def ok(self) -> bool:
        return not self.problems

    @property
    def needs_throttle_confirm(self) -> bool:
        return bool(self.throttle_at_min)

    def text(self) -> str:
        arm = "--" if self.arm_us is None else f"{self.arm_us} us ({'ARMED' if self.arm_armed else 'SAFE'})"
        thr = "--" if self.throttle_us is None else \
            f"{self.throttle_us} us{' (AT MINIMUM)' if self.throttle_at_min else ''}"
        return f"CH{self.arm_channel} arm = {arm}, CH{self.throttle_channel} throttle = {thr}"


@dataclass(frozen=True)
class Packet:
    seq: int
    t_gcs_us: int
    data: bytes
    deadline: float


@dataclass(frozen=True)
class SenderStats:
    """One stats window (about 1 s). Jitter = actual send time minus the scheduled deadline."""

    t: float
    window_s: float
    sent: int
    send_errors: int
    skipped_slots: int
    p50_ms: float | None
    p99_ms: float | None
    max_ms: float | None

    @property
    def rate_hz(self) -> float:
        return self.sent / self.window_s if self.window_s > 0 else 0.0


@dataclass(frozen=True)
class SenderState:
    mode: Mode
    streaming: bool                 # packets are going out
    suspended: str | None           # SUSPEND_* while the mode is kept but nothing is sent
    start_path: str | None          # START_NORMAL / START_RESUME of the current stream; None when idle
    camera_requested: bool
    seq: int
    packets_sent: int
    send_errors: int
    stats: SenderStats | None
    waiter: str


# --------------------------------------------------------------------------- interlock helpers

def controller_problems(snap: ControllerSnapshot, now: float, stale_s: float) -> list[str]:
    if not snap.connected:
        return ["controller not connected"]
    age = now - snap.t
    if age > stale_s:
        return [f"controller data stale ({age * 1000:.0f} ms old)"]
    return []


def arm_switch_safe(snap: ControllerSnapshot, il: InterlockConfig) -> bool:
    return il.arm_safe_min_us <= snap.channel_us(il.arm_channel) <= il.arm_safe_max_us


def throttle_low(snap: ControllerSnapshot, il: InterlockConfig) -> bool:
    return snap.channel_us(il.throttle_channel) <= il.throttle_low_max_us


def interlock_problems(snap: ControllerSnapshot, il: InterlockConfig) -> list[str]:
    """Arm switch in the safe range and throttle low (plan §7.3, like EdgeTX switch warnings)."""
    problems = []
    if not arm_switch_safe(snap, il):
        problems.append(f"arm switch not safe: CH{il.arm_channel} = {snap.channel_us(il.arm_channel)} us "
                        f"(safe {il.arm_safe_min_us}..{il.arm_safe_max_us} us)")
    if not throttle_low(snap, il):
        problems.append(f"throttle not low: CH{il.throttle_channel} = {snap.channel_us(il.throttle_channel)} us "
                        f"(must be <= {il.throttle_low_max_us} us)")
    return problems


def carrier_only_channels(il: InterlockConfig) -> tuple[int, ...]:
    """Carrier-only output: arm channel at the bottom of the safe range, throttle at 988 us, rest centred."""
    ch = list(CENTRED_US)
    ch[il.throttle_channel - 1] = protocol.US_MIN
    ch[il.arm_channel - 1] = il.arm_safe_min_us
    return tuple(ch)


def percentile(sorted_values: Sequence[float], p: float) -> float:
    """Nearest-rank percentile of an already sorted, non-empty sequence."""
    n = len(sorted_values)
    return sorted_values[min(n - 1, max(0, math.ceil(p * n) - 1))]


class JitterWindow:
    """Collects per-packet lateness and closes a :class:`SenderStats` about once a second."""

    def __init__(self, now: float, window_s: float = 1.0) -> None:
        self.window_s = window_s
        self._start = now
        self._late: list[float] = []
        self._errors = 0
        self._skipped = 0

    def record(self, late_s: float) -> None:
        self._late.append(late_s)

    def error(self) -> None:
        self._errors += 1

    def skipped(self, n: int) -> None:
        self._skipped += n

    def roll(self, now: float) -> SenderStats | None:
        """Return the closed window when it is due, else ``None``."""
        span = now - self._start
        if span < self.window_s:
            return None
        late = sorted(self._late)
        ms = [v * 1000 for v in late]
        stats = SenderStats(t=now, window_s=span, sent=len(late), send_errors=self._errors,
                            skipped_slots=self._skipped,
                            p50_ms=percentile(ms, 0.50) if ms else None,
                            p99_ms=percentile(ms, 0.99) if ms else None,
                            max_ms=ms[-1] if ms else None)
        self._start, self._late, self._errors, self._skipped = now, [], 0, 0
        return stats


def gcs_time_us() -> int:
    """GCS clock for ``t_gcs_us`` (wrapping u32 microseconds of ``perf_counter``)."""
    return (time.perf_counter_ns() // 1000) & 0xFFFFFFFF


# --------------------------------------------------------------------------- sender

EventCallback = Callable[[str, dict], None]


class Sender:
    """The RC sender. :meth:`tick` is the whole per-packet decision; :meth:`start` runs it in a thread.

    ``transmit(data)`` sends one datagram (the runtime passes ``sock.sendto`` to the bridge).
    ``on_packet(packet)`` is called after each successful send (RTT bookkeeping);
    ``on_event(kind, data)`` for mode/suspend/refusal events; ``on_stats(stats)`` once a second.
    Callbacks run outside the internal lock.
    """

    def __init__(self, cfg: Config, controller: Controller, transmit: Callable[[bytes], object],
                 clock: Callable[[], float] = time.perf_counter,
                 us_clock: Callable[[], int] = gcs_time_us,
                 waiter_factory: Callable[[], timing_win.Waiter] = timing_win.Waiter,
                 on_packet: Callable[[Packet], None] | None = None,
                 on_event: EventCallback | None = None,
                 on_stats: Callable[[SenderStats], None] | None = None) -> None:
        self.cfg = cfg
        self.il = cfg.interlock
        self.controller = controller
        self.period = 1.0 / cfg.sender.rate_hz
        self.stale_s = cfg.controller.stale_ms / 1000
        self._transmit = transmit
        self._clock = clock
        self._us_clock = us_clock
        self._waiter_factory = waiter_factory
        self._on_packet = on_packet
        self._on_event = on_event
        self._on_stats = on_stats
        self._carrier_only_us = carrier_only_channels(self.il)

        self._lock = threading.Lock()
        self._mode = Mode.IDLE
        self._suspended: str | None = None
        self._start_path: str | None = None
        self._resume_token = 0
        self._resume_preview: ResumePreview | None = None
        self._camera = cfg.camera.default_on
        self._seq = 0
        self._sent = 0
        self._errors = 0
        self._stats: SenderStats | None = None
        self._window = JitterWindow(clock())
        self._waiter_kind = "not started"
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # ------------------------------------------------------------------ commands (any thread)
    def request_mode(self, mode: Mode | str, *, client_armed: bool | None = None) -> ModeResult:
        """Normal start / mode change, enforcing the start interlock. Returns why a request was refused.

        ``client_armed``: what fresh client telemetry says (None = unknown); used
        to refuse ``fpv -> carrier_only`` while the client reports ARMED.
        """
        mode = Mode(mode)
        events: list[tuple[str, dict]] = []
        with self._lock:
            result = self._request_locked(mode, client_armed, events)
        self._emit(events)
        return result

    def _refuse(self, requested: str, reasons: list[str], events: list[tuple[str, dict]]) -> ModeResult:
        events.append(("interlock_refused", {"requested": requested, "from": self._mode.value,
                                             "reasons": reasons}))
        log.warning("refused %s: %s", requested, "; ".join(reasons))
        return ModeResult(False, self._mode, tuple(reasons))

    def _accept(self, mode: Mode, path: str | None, events: list[tuple[str, dict]],
                snap: ControllerSnapshot | None = None) -> ModeResult:
        cur, was_suspended = self._mode, self._suspended
        self._mode, self._suspended, self._start_path = mode, None, path
        self._resume_preview = None
        data: dict = {"mode": mode.value, "from": cur.value, "resumed": was_suspended is not None,
                      "start_path": path}
        if snap is not None:
            data["arm_us"] = snap.channel_us(self.il.arm_channel)
            data["throttle_us"] = snap.channel_us(self.il.throttle_channel)
        events.append(("mode", data))
        log.info("mode %s -> %s (%s start)", cur.value, mode.value, path or "-")
        return ModeResult(True, mode)

    def _request_locked(self, mode: Mode, client_armed: bool | None,
                        events: list[tuple[str, dict]]) -> ModeResult:
        cur, suspended = self._mode, self._suspended
        if mode is Mode.IDLE:
            return self._accept(mode, None, events) if (cur is not Mode.IDLE or suspended) \
                else ModeResult(True, mode)
        if mode is cur and suspended is None:
            return ModeResult(True, mode)                       # already running
        if mode is Mode.CARRIER_ONLY and cur is not Mode.FPV:
            return self._accept(mode, START_NORMAL, events)     # no controller needed, no client flying

        # From here: needs the controller (starting fpv, or fpv -> carrier_only).
        snap = self.controller.snapshot()
        problems = controller_problems(snap, self._clock(), self.stale_s)
        if problems:
            return self._refuse(mode.value, problems, events)
        problems = interlock_problems(snap, self.il)
        if mode is Mode.CARRIER_ONLY and client_armed:
            problems.append("client telemetry reports ARMED")
        if problems:
            if mode is Mode.FPV and not arm_switch_safe(snap, self.il):
                problems.append("if the client is airborne use RESUME (client airborne)")
            return self._refuse(mode.value, problems, events)
        return self._accept(mode, START_NORMAL, events, snap)

    # ------------------------------------------------------------------ RESUME (client airborne)
    def prepare_resume(self) -> ResumePreview:
        """Step 1: read the live arm/throttle values; nothing is sent. Show :meth:`ResumePreview.text`."""
        events: list[tuple[str, dict]] = []
        with self._lock:
            now = self._clock()
            snap = self.controller.snapshot()
            problems = controller_problems(snap, now, self.stale_s)
            connected = not problems
            if self._mode is not Mode.IDLE and self._suspended is None:
                problems.append("already streaming: RESUME only starts a stopped stream")
            armed = not arm_switch_safe(snap, self.il) if connected else None
            at_min = throttle_low(snap, self.il) if connected else None
            if armed is False:
                problems.append(f"arm switch is SAFE (CH{self.il.arm_channel} = "
                                f"{snap.channel_us(self.il.arm_channel)} us): RESUME would disarm the "
                                "client; use a normal start if it is on the ground")
            self._resume_token += 1
            preview = ResumePreview(
                token=self._resume_token, created=now, controller=snap.name if connected else None,
                arm_channel=self.il.arm_channel,
                arm_us=snap.channel_us(self.il.arm_channel) if connected else None,
                throttle_channel=self.il.throttle_channel,
                throttle_us=snap.channel_us(self.il.throttle_channel) if connected else None,
                arm_armed=armed, throttle_at_min=at_min, problems=tuple(problems))
            self._resume_preview = preview if preview.ok else None
            events.append(("resume_preview", {"ok": preview.ok, "arm_us": preview.arm_us,
                                              "throttle_us": preview.throttle_us,
                                              "throttle_at_min": preview.throttle_at_min,
                                              "problems": list(preview.problems)}))
        self._emit(events)
        return preview

    def confirm_resume(self, token: int, *, throttle_min_confirmed: bool = False) -> ModeResult:
        """Step 2: start ``fpv`` on the RESUME path. Needs the token of the latest valid preview.

        The live values are checked again; with the throttle at minimum the pilot
        must have confirmed that separately (``throttle_min_confirmed``).
        """
        events: list[tuple[str, dict]] = []
        with self._lock:
            result = self._confirm_locked(token, throttle_min_confirmed, events)
        self._emit(events)
        return result

    def _confirm_locked(self, token: int, throttle_min_confirmed: bool,
                        events: list[tuple[str, dict]]) -> ModeResult:
        preview, now = self._resume_preview, self._clock()
        if preview is None or preview.token != token:
            return self._refuse("resume", ["no valid RESUME preview: show the live values first"], events)
        if now - preview.created > RESUME_CONFIRM_S:
            self._resume_preview = None
            return self._refuse("resume", [f"RESUME preview expired (> {RESUME_CONFIRM_S:.0f} s): show it again"],
                                events)
        if self._mode is not Mode.IDLE and self._suspended is None:
            return self._refuse("resume", ["already streaming"], events)
        snap = self.controller.snapshot()
        problems = controller_problems(snap, now, self.stale_s)
        if problems:
            return self._refuse("resume", problems, events)
        if arm_switch_safe(snap, self.il):
            return self._refuse("resume", ["arm switch moved to SAFE: RESUME would disarm the client"], events)
        if throttle_low(snap, self.il) and not throttle_min_confirmed:
            return self._refuse("resume", [f"throttle at minimum (CH{self.il.throttle_channel} = "
                                           f"{snap.channel_us(self.il.throttle_channel)} us): confirm again"],
                                events)
        self._resume_preview = None                               # single use
        return self._accept(Mode.FPV, START_RESUME, events, snap)

    def set_camera_requested(self, on: bool) -> None:
        """Set ``CAM_ENABLE`` for the following packets (the runtime applies the camera interlock)."""
        with self._lock:
            changed = self._camera != bool(on)
            self._camera = bool(on)
        if changed:
            self._emit([("camera", {"requested": bool(on)})])

    def state(self) -> SenderState:
        with self._lock:
            return SenderState(mode=self._mode, streaming=self._mode is not Mode.IDLE and self._suspended is None,
                               suspended=self._suspended, start_path=self._start_path,
                               camera_requested=self._camera, seq=self._seq,
                               packets_sent=self._sent, send_errors=self._errors, stats=self._stats,
                               waiter=self._waiter_kind)

    # ------------------------------------------------------------------ per-packet decision
    def tick(self, now: float, deadline: float | None = None) -> Packet | None:
        """Decide and build the packet for one slot. Returns ``None`` when nothing may be sent."""
        events: list[tuple[str, dict]] = []
        with self._lock:
            pkt = self._tick_locked(now, now if deadline is None else deadline, events)
        self._emit(events)
        return pkt

    def _tick_locked(self, now: float, deadline: float, events: list[tuple[str, dict]]) -> Packet | None:
        if self._mode is Mode.IDLE or self._suspended is not None:
            return None
        if self._mode is Mode.FPV:
            snap = self.controller.snapshot()
            problems = controller_problems(snap, now, self.stale_s)
            if problems:
                self._suspend_locked(SUSPEND_CONTROLLER, problems[0], events)
                return None
            channels_us = snap.channels_us
        else:
            channels_us = self._carrier_only_us
        seq = (self._seq + 1) & 0xFFFFFFFF
        t_us = self._us_clock() & 0xFFFFFFFF
        data = protocol.RcUp(seq, t_us, channels_to_crsf(channels_us), cam_enable=self._camera).pack()
        self._seq = seq
        return Packet(seq, t_us, data, deadline)

    def _suspend_locked(self, reason: str, detail: str, events: list[tuple[str, dict]]) -> None:
        self._suspended = reason
        events.append(("suspended", {"reason": reason, "detail": detail, "mode": self._mode.value}))
        log.error("RC stream STOPPED (%s: %s) - nothing is sent until an explicit resume", reason, detail)

    def fault(self, detail: str) -> None:
        """Stop sending because of an internal error (keeps the mode; needs an explicit resume)."""
        events: list[tuple[str, dict]] = []
        with self._lock:
            if self._mode is not Mode.IDLE and self._suspended is None:
                self._suspend_locked(SUSPEND_INTERNAL, detail, events)
        self._emit(events)

    def _emit(self, events: list[tuple[str, dict]]) -> None:
        if self._on_event is None:
            return
        for kind, data in events:
            try:
                self._on_event(kind, data)
            except Exception:  # a logging/UI bug must never break the sender
                log.exception("sender event callback failed")

    # ------------------------------------------------------------------ one slot incl. sending
    def send_slot(self, now: float, deadline: float) -> Packet | None:
        """Tick, transmit and record jitter for one slot (used by the thread and by tests)."""
        try:
            pkt = self.tick(now, deadline)
        except Exception as exc:
            log.exception("building rc_up failed")
            self.fault(f"{type(exc).__name__}: {exc}")
            return None
        if pkt is None:
            return None
        t_tx = self._clock()
        try:
            self._transmit(pkt.data)
        except OSError as exc:              # e.g. cable unplugged: keep the schedule, count it
            with self._lock:
                self._errors += 1
            self._window.error()
            log.debug("sendto failed: %s", exc)
            return None
        with self._lock:
            self._sent += 1
        self._window.record(max(0.0, t_tx - deadline))
        if self._on_packet is not None:
            try:
                self._on_packet(pkt)
            except Exception:
                log.exception("on_packet callback failed")
        return pkt

    def _roll_stats(self, now: float) -> None:
        stats = self._window.roll(now)
        if stats is None:
            return
        with self._lock:
            self._stats = stats
        if self._on_stats is not None:
            try:
                self._on_stats(stats)
            except Exception:
                log.exception("on_stats callback failed")

    # ------------------------------------------------------------------ thread
    def start(self) -> "Sender":
        if self._thread is None:
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name="rc-sender", daemon=True)
            self._thread.start()
        return self

    def stop(self) -> None:
        """Stop the thread (sending stops at once; the bridge then reaches FAILSAFE after T_hold)."""
        with self._lock:
            self._mode, self._suspended, self._start_path = Mode.IDLE, None, None
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    def _run(self) -> None:
        timing_win.set_thread_priority_high()
        waiter = self._waiter_factory()
        with self._lock:
            self._waiter_kind = waiter.kind
        log.info("RC sender thread: %.0f Hz, wait method %s", 1 / self.period, waiter.kind)
        awake = False
        deadline = self._clock()
        try:
            while not self._stop.is_set():
                waiter.wait_until(deadline)
                now = self._clock()
                self.send_slot(now, deadline)
                streaming = self.state().streaming
                if streaming != awake:      # ES_SYSTEM_REQUIRED belongs to this thread
                    timing_win.keep_awake(streaming)
                    awake = streaming
                self._roll_stats(now)
                deadline += self.period
                behind = self._clock() - deadline
                if behind > 2 * self.period:  # stalled (e.g. system pause): skip, never burst a backlog
                    skip = int(behind / self.period)
                    deadline += skip * self.period
                    self._window.skipped(skip)
        finally:
            if awake:
                timing_win.keep_awake(False)
            waiter.close()


__all__ = ["Mode", "ModeResult", "Packet", "ResumePreview", "RESUME_CONFIRM_S", "START_NORMAL", "START_RESUME",
           "Sender", "SenderState", "SenderStats", "arm_switch_safe",
           "carrier_only_channels", "throttle_low",
           "controller_problems", "gcs_time_us", "interlock_problems", "percentile",
           "SUSPEND_CONTROLLER", "SUSPEND_INTERNAL"]
