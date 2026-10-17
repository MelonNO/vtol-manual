"""Alarm engine and rules (plan §7.5, §14.2). Ids and texts are documented in ``gcs/README.md``.

* :class:`AlarmEngine` — raise/clear with severity, ``since`` time and time
  hysteresis: a condition must hold for ``raise_after_s`` to raise and be
  false for ``clear_after_s`` to clear.
* :func:`evaluate_rules` — a pure function from :class:`RuleInputs` (filled
  by the runtime) to ``{alarm_id: condition}``; tests drive it directly.
* :class:`RttRiseDetector` — "RTT rising after camera on" (relay-design test 9).

Thresholds are in :class:`vtolgcs.config.AlarmConfig`; the hysteresis times
below are app defaults (not from the plan) chosen to stop flicker.
"""

from __future__ import annotations

import collections
import statistics
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

from .config import AlarmConfig
from .sender import percentile

WARN = "warn"
CRIT = "crit"


@dataclass(frozen=True)
class AlarmDef:
    id: str
    severity: str
    text: str
    raise_after_s: float = 0.0
    clear_after_s: float = 1.0


#: Every alarm the runtime can raise. The order is the display order for equal severity.
ALARM_DEFS: tuple[AlarmDef, ...] = (
    AlarmDef("rc_sender_dead", CRIT, "RC SENDER THREAD DEAD", 0.0, 0.0),
    AlarmDef("rc_stream_stopped", CRIT, "RC STREAM STOPPED", 0.0, 0.0),
    AlarmDef("controller_disconnected", CRIT, "CONTROLLER DISCONNECTED", 0.0, 0.5),
    AlarmDef("bridge_no_status", CRIT, "NO BRIDGE STATUS", 0.0, 1.0),
    AlarmDef("bridge_not_run", CRIT, "BRIDGE NOT RUN", 0.5, 1.0),
    AlarmDef("client_failsafe", CRIT, "FPV FAILSAFE", 0.0, 1.0),
    AlarmDef("client_rth", CRIT, "FPV RTH", 0.0, 1.0),
    AlarmDef("client_telemetry_stale", CRIT, "FPV TELEMETRY LOST", 0.0, 1.0),
    AlarmDef("client_link_weak", WARN, "FPV LINK WEAK", 1.0, 2.0),
    AlarmDef("client_batt_low", WARN, "FPV BATT LOW", 2.0, 5.0),
    AlarmDef("client_sats_low", WARN, "FPV SATS LOW", 1.0, 2.0),
    AlarmDef("client_rescue_not_ready", WARN, "FPV RESCUE NOT READY", 0.0, 1.0),
    AlarmDef("rtt_high", WARN, "RC RTT HIGH", 1.0, 2.0),
    AlarmDef("rtt_rising_camera", WARN, "RTT RISING - CAMERA ON", 0.0, 2.0),
    AlarmDef("camera_mismatch", WARN, "CAMERA STATE MISMATCH", 0.0, 0.5),
    AlarmDef("send_jitter_high", WARN, "SEND JITTER HIGH", 0.0, 2.0),
    AlarmDef("gcs_on_battery", WARN, "GCS LAPTOP ON BATTERY", 0.0, 5.0),
    AlarmDef("gcs_battery_saver", WARN, "GCS BATTERY SAVER ON", 0.0, 5.0),
)
ALARMS: dict[str, AlarmDef] = {d.id: d for d in ALARM_DEFS}


def iso_utc(dt: datetime | None = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class _AlarmState:
    active: bool = False
    since: str | None = None
    cond_since: float | None = None
    ok_since: float | None = None


class AlarmEngine:
    """Raise/clear bookkeeping for a fixed set of alarms. Thread-safe.

    Listeners get the C2 Alarm object plus ``"active": true|false`` on every raise and clear.
    """

    def __init__(self, defs: tuple[AlarmDef, ...] = ALARM_DEFS,
                 clock: Callable[[], float] = time.perf_counter,
                 wall: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
        self.defs = {d.id: d for d in defs}
        self._order = {d.id: i for i, d in enumerate(defs)}
        self._clock = clock
        self._wall = wall
        self._lock = threading.Lock()
        self._state = {d.id: _AlarmState() for d in defs}
        self._listeners: list[Callable[[dict], None]] = []

    def add_listener(self, fn: Callable[[dict], None]) -> None:
        self._listeners.append(fn)

    def update(self, conditions: dict[str, bool], now: float | None = None) -> list[dict]:
        """Apply the current conditions. Returns the raise/clear events (also sent to listeners)."""
        now = self._clock() if now is None else now
        events: list[dict] = []
        with self._lock:
            for alarm_id, cond in conditions.items():
                d, st = self.defs[alarm_id], self._state[alarm_id]
                if cond:
                    st.ok_since = None
                    if st.cond_since is None:
                        st.cond_since = now
                    if not st.active and now - st.cond_since >= d.raise_after_s:
                        st.active, st.since = True, iso_utc(self._wall())
                        events.append(self._obj(d, st, True))
                else:
                    st.cond_since = None
                    if st.active:
                        if st.ok_since is None:
                            st.ok_since = now
                        if now - st.ok_since >= d.clear_after_s:
                            events.append(self._obj(d, st, False))
                            st.active, st.since, st.ok_since = False, None, None
        for ev in events:
            for fn in list(self._listeners):
                try:
                    fn(ev)
                except Exception:  # pragma: no cover - a listener bug must not stop alarms
                    pass
        return events

    @staticmethod
    def _obj(d: AlarmDef, st: _AlarmState, active: bool) -> dict:
        return {"id": d.id, "severity": d.severity, "text": d.text, "since": st.since, "active": active}

    def active(self) -> list[dict]:
        """Active alarms as C2 Alarm objects, critical first."""
        with self._lock:
            items = [(d, self._state[i]) for i, d in self.defs.items() if self._state[i].active]
        items.sort(key=lambda x: (x[0].severity != CRIT, self._order[x[0].id]))
        return [{"id": d.id, "severity": d.severity, "text": d.text, "since": st.since} for d, st in items]

    def is_active(self, alarm_id: str) -> bool:
        with self._lock:
            return self._state[alarm_id].active


# --------------------------------------------------------------------------- rules

@dataclass(frozen=True)
class RuleInputs:
    """Snapshot of everything the rules look at. ``None`` = unknown."""

    mode: str                                  # 'idle' | 'fpv' | 'carrier_only'
    streaming: bool                            # packets are going out
    suspended: bool                            # mode kept but the stream was stopped by a fault
    sender_dead: bool                          # the RC sender thread died
    controller_connected: bool
    #: seconds since max(last status, stream start); None when not streaming
    status_silence_s: float | None
    bridge_state: str | None                   # state of the latest status, None if none / stale
    rtt_ms: float | None
    late_max_ms: float | None                  # worst packet lateness in the last 1 s window
    skipped_slots: int                         # slots skipped in the last 1 s window
    camera_requested: bool
    camera_reported: bool | None
    #: seconds since max(last client telemetry, fpv start); None outside fpv
    telemetry_silence_s: float | None
    #: telemetry values are current (fresh, or fpv where the last values stay latched)
    telemetry_relevant: bool
    lq_pct: float | None
    cell_v: float | None
    sats: int | None
    client_failsafe: bool
    client_rth: bool
    client_rescue_not_ready: bool
    rtt_rising: bool
    on_battery: bool | None
    battery_saver: bool | None
    #: packets later than ``send_late_max_ms`` in the last 1 s window (WP08a verification m2)
    late_count: int = 0


def evaluate_rules(inp: RuleInputs, cfg: AlarmConfig) -> dict[str, bool]:
    """Every alarm condition for the current inputs (before hysteresis)."""
    streaming = inp.streaming
    status_ok = streaming and inp.bridge_state is not None
    tl = inp.telemetry_relevant
    return {
        "rc_sender_dead": inp.sender_dead,
        "rc_stream_stopped": inp.suspended,
        "controller_disconnected": not inp.controller_connected and inp.mode != "carrier_only",
        "bridge_no_status": streaming and inp.status_silence_s is not None
                            and inp.status_silence_s * 1000 > cfg.status_timeout_ms,
        "bridge_not_run": status_ok and inp.bridge_state != "RUN",
        "client_failsafe": tl and inp.client_failsafe,
        "client_rth": tl and inp.client_rth,
        "client_telemetry_stale": inp.mode == "fpv" and inp.telemetry_silence_s is not None
                                  and inp.telemetry_silence_s > cfg.telemetry_stale_s,
        "client_link_weak": tl and inp.lq_pct is not None and inp.lq_pct < cfg.lq_min_pct,
        "client_batt_low": tl and inp.cell_v is not None and inp.cell_v < cfg.cell_min_v,
        "client_sats_low": tl and inp.sats is not None and inp.sats < cfg.min_sats,
        "client_rescue_not_ready": tl and inp.client_rescue_not_ready,
        "rtt_high": streaming and cfg.rtt_max_ms is not None and inp.rtt_ms is not None
                    and inp.rtt_ms > cfg.rtt_max_ms,
        "rtt_rising_camera": streaming and inp.rtt_rising,
        "camera_mismatch": status_ok and inp.bridge_state in ("START", "RUN") and inp.camera_reported is not None
                           and inp.camera_reported != inp.camera_requested,
        # m2: one packet a few ms late only adds latency; N late packets per second, or any skipped
        # slot (every stall longer than two send periods skips slots), is a real problem.
        "send_jitter_high": streaming and (inp.skipped_slots > 0 or inp.late_count >= cfg.send_late_count),
        "gcs_on_battery": bool(inp.on_battery),
        "gcs_battery_saver": bool(inp.battery_saver),
    }


def camera_mismatch_def(cfg: AlarmConfig) -> AlarmDef:
    """The camera-mismatch alarm with the configured delay (plan §7.1: > 1 s)."""
    d = ALARMS["camera_mismatch"]
    return AlarmDef(d.id, d.severity, d.text, cfg.camera_mismatch_s, d.clear_after_s)


def alarm_defs(cfg: AlarmConfig) -> tuple[AlarmDef, ...]:
    return tuple(camera_mismatch_def(cfg) if d.id == "camera_mismatch" else d for d in ALARM_DEFS)


class RttRiseDetector:
    """RTT rising after the camera was switched on (warns that the HM30 is saturating).

    At the reported OFF -> ON edge the RTT samples of the previous ``window_s``
    become the baseline.  While the camera stays on, the median of the samples
    of the last ``window_s`` (after the edge) is compared with:

    * ``rise_ms is None``: the baseline's 99th percentile (parameter-free default), or
    * the baseline median + ``rise_ms``.

    At least ``min_samples`` on both sides are needed.
    """

    def __init__(self, window_s: float = 5.0, rise_ms: float | None = None, min_samples: int = 5) -> None:
        self.window_s = window_s
        self.rise_ms = rise_ms
        self.min_samples = min_samples
        self._samples: collections.deque[tuple[float, float]] = collections.deque()
        self._camera: bool | None = None
        self._baseline: list[float] | None = None
        self._on_since: float | None = None

    def add_sample(self, t: float, rtt_ms: float) -> None:
        """One RTT measurement (call once per new status-derived sample)."""
        self._samples.append((t, rtt_ms))

    def evaluate(self, now: float, camera_on: bool | None) -> bool:
        """Condition for ``rtt_rising_camera`` given the reported camera state at ``now``."""
        while self._samples and now - self._samples[0][0] > 2 * self.window_s:
            self._samples.popleft()
        if camera_on and not self._camera:
            before = sorted(v for t, v in self._samples if now - self.window_s <= t < now)
            self._baseline = before if len(before) >= self.min_samples else None
            self._on_since = now
        elif not camera_on:
            self._baseline, self._on_since = None, None
        self._camera = camera_on
        if not self._baseline or self._on_since is None:
            return False
        after = [v for t, v in self._samples if t >= self._on_since and now - t <= self.window_s]
        if len(after) < self.min_samples:
            return False
        base = self._baseline
        if self.rise_ms is None:
            limit = percentile(base, 0.99)
        else:
            limit = statistics.median(base) + self.rise_ms
        return statistics.median(after) > limit
