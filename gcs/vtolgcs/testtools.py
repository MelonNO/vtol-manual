"""Test tools built into the app (plan §7.8, brief R7) for the relay design's system tests.

Everything here runs in the **UI process** and reaches the RC sender only through the control
channel (runtime time stamps, RTT samples, camera and mode requests).  The classes are pure logic
driven by injected functions, so they are tested without a display; the UI runs them in worker threads.

* :class:`RttTest` - UDP RTT min/mean/p99/max over a time window, with the video state noted
  (relay-design "UDP echo round-trip time with video off, then at full bitrate").
* :class:`FailsafeTimer` - stop the stream on a key (or mark the moment of another cause: HM30
  unplugged, G0 reset), then time until client telemetry shows ``!FS!`` or a manual stop key
  (relay-design test 6, one record per cause).
* :class:`CameraTest` - RTT and client-video packet timing before / with the camera, then the time
  from camera OFF until the bridge reports OFF and until camera traffic stops at the GCS network
  interface (relay-design test 9).
* :func:`g2g_text` - the glass-to-glass millisecond clock (relay-design test 2; the window is in the UI).

Results are rows (dicts) kept in :class:`Results`, appended to the session log (``test_*``
records through the control channel) and exported as CSV.
"""

from __future__ import annotations

import csv
import io
import math
import socket
import statistics
import struct
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterable

from .sender import percentile

# --------------------------------------------------------------------------- results


@dataclass
class Results:
    """Test results (one dict per row); thread-safe; CSV export with the union of all columns."""

    rows: list[dict[str, Any]] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def add(self, row: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self.rows.append(dict(row))
        return row

    def to_csv(self) -> str:
        with self._lock:
            rows = list(self.rows)
        cols: list[str] = []
        for r in rows:
            cols.extend(k for k in r if k not in cols)
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=cols, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in cols})
        return buf.getvalue()

    def export_csv(self, path: Path) -> Path:
        path = Path(path)
        path.write_text(self.to_csv(), encoding="utf-8", newline="")
        return path


def _r(v: float | None, nd: int = 2) -> float | None:
    return None if v is None or not math.isfinite(v) else round(v, nd)


def rtt_summary(values: Iterable[float]) -> dict[str, Any]:
    vals = sorted(values)
    if not vals:
        return {"n": 0, "min_ms": None, "mean_ms": None, "p99_ms": None, "max_ms": None}
    return {"n": len(vals), "min_ms": _r(vals[0]), "mean_ms": _r(statistics.fmean(vals)),
            "p99_ms": _r(percentile(vals, 0.99)), "max_ms": _r(vals[-1])}


# --------------------------------------------------------------------------- RTT test

RttSource = Callable[[float | None], "tuple[float, list[tuple[float, float]]]"]


class RttTest:
    """Collect RTT samples for ``duration_s``. ``samples(since)`` -> ``(runtime_now, [(t, ms), ...])``
    (the control command ``rtt_samples``).  ``video`` is the operator's note ("off", "full bitrate", ...)."""

    def __init__(self, samples: RttSource, video: str, duration_s: float = 10.0,
                 video_kbps: Callable[[], float | None] = lambda: None, sleep: Callable[[float], None] = time.sleep) -> None:
        self.samples = samples
        self.video = video
        self.duration_s = duration_s
        self.video_kbps = video_kbps
        self.sleep = sleep
        self.cancelled = threading.Event()

    def run(self) -> dict[str, Any]:
        t0, _ = self.samples(None)
        since, vals, kbps = t0, [], []
        while not self.cancelled.is_set():
            self.sleep(0.5)
            now, new = self.samples(since)
            vals.extend(v for t, v in new if t <= t0 + self.duration_s)
            if new:
                since = max(t for t, _ in new)
            k = self.video_kbps()
            if k is not None:
                kbps.append(k)
            if now >= t0 + self.duration_s:
                break
        row = {"test": "rtt", "time": datetime.now().isoformat(timespec="seconds"), "video": self.video,
               "duration_s": self.duration_s, **rtt_summary(vals),
               "video_kbps_mean": _r(statistics.fmean(kbps), 0) if kbps else None,
               "note": "RTT includes up to one send period of waiting in the bridge (protocol README §3.2)"}
        if self.cancelled.is_set():
            row["note"] = "cancelled"
        if not vals:
            row["note"] = "no RTT samples: is the RC stream running and the bridge answering?"
        return row


# --------------------------------------------------------------------------- failsafe timer

FAILSAFE_CAUSES = ("GCS app: stream stopped", "HM30 unplugged", "G0 bridge reset", "other")


class FailsafeTimer:
    """Relay-design test 6.  Feed control-channel events to :meth:`on_event`.

    ``start(cause, t)``: ``t`` is the runtime time of the cause (the ``mode`` -> idle event when the
    app stops the stream itself, or a ``ping`` time when the operator pulls the HM30 / resets the G0).
    Ends at the first client telemetry with ``!FS!`` (``client_flight_mode`` event, failsafe true) or
    at :meth:`manual_stop` (stopwatch key, e.g. when the client's own OSD shows failsafe).
    """

    def __init__(self) -> None:
        self.cause: str | None = None
        self.t_start: float | None = None
        self.t_bridge_failsafe: float | None = None
        self.t_end: float | None = None
        self.end_reason: str | None = None
        self.waiting_for_stop_event = False

    @property
    def running(self) -> bool:
        return (self.t_start is not None or self.waiting_for_stop_event) and self.t_end is None

    def arm_stop(self, cause: str = FAILSAFE_CAUSES[0]) -> None:
        """The UI is about to request idle: the start time comes from the ``mode`` event."""
        self.__init__()
        self.cause, self.waiting_for_stop_event = cause, True

    def start(self, cause: str, t: float) -> None:
        self.__init__()
        self.cause, self.t_start = cause, t

    def on_event(self, ev: dict) -> dict[str, Any] | None:
        """Returns the result row when the timer finishes."""
        kind, data, t = ev.get("event"), ev.get("data") or {}, ev.get("t")
        if self.waiting_for_stop_event and kind == "mode" and data.get("mode") == "idle":
            self.t_start, self.waiting_for_stop_event = t, False
            return None
        if not self.running or self.t_start is None:
            return None
        if kind == "bridge_state" and data.get("to") == "FAILSAFE" and self.t_bridge_failsafe is None:
            self.t_bridge_failsafe = t
        if kind == "client_flight_mode" and data.get("failsafe"):
            return self._finish(data.get("t", t), "client telemetry !FS!")
        return None

    def manual_stop(self, t: float) -> dict[str, Any] | None:
        if not self.running or self.t_start is None:
            return None
        return self._finish(t, "manual stop key")

    def _finish(self, t: float, reason: str) -> dict[str, Any]:
        self.t_end, self.end_reason = t, reason
        assert self.t_start is not None
        return {"test": "failsafe", "time": datetime.now().isoformat(timespec="seconds"), "cause": self.cause,
                "end": reason, "client_failsafe_ms": _r((t - self.t_start) * 1000, 0),
                "bridge_failsafe_ms": (None if self.t_bridge_failsafe is None
                                       else _r((self.t_bridge_failsafe - self.t_start) * 1000, 0))}


# --------------------------------------------------------------------------- interface counters

class InterfaceCounter:
    """Bytes received on the network interface that routes to ``dest_ip`` (the HM30 side).

    Windows ``GetBestInterface`` + ``GetIfEntry`` (``MIB_IFROW.dwInOctets``, 32-bit, wrap handled).
    ``available`` is False elsewhere or on error; the camera test then reports the stop time as TBD.
    """

    def __init__(self, dest_ip: str) -> None:
        self.available = False
        self._index = None
        self._last: int | None = None
        self._total = 0
        if sys.platform != "win32":
            return
        try:
            import ctypes
            from ctypes import wintypes
            self._ct = ctypes
            self._iphlp = ctypes.WinDLL("iphlpapi")
            idx = wintypes.DWORD()
            addr = struct.unpack("<I", socket.inet_aton(dest_ip))[0]          # IPAddr, network order
            if self._iphlp.GetBestInterface(wintypes.DWORD(addr), ctypes.byref(idx)) != 0:
                return

            class MIB_IFROW(ctypes.Structure):
                _fields_ = [("wszName", ctypes.c_wchar * 256), ("dwIndex", wintypes.DWORD), ("dwType", wintypes.DWORD),
                            ("dwMtu", wintypes.DWORD), ("dwSpeed", wintypes.DWORD), ("dwPhysAddrLen", wintypes.DWORD),
                            ("bPhysAddr", ctypes.c_ubyte * 8), ("dwAdminStatus", wintypes.DWORD),
                            ("dwOperStatus", wintypes.DWORD), ("dwLastChange", wintypes.DWORD),
                            ("dwInOctets", wintypes.DWORD), ("dwInUcastPkts", wintypes.DWORD),
                            ("dwInNUcastPkts", wintypes.DWORD), ("dwInDiscards", wintypes.DWORD),
                            ("dwInErrors", wintypes.DWORD), ("dwInUnknownProtos", wintypes.DWORD),
                            ("dwOutOctets", wintypes.DWORD), ("dwOutUcastPkts", wintypes.DWORD),
                            ("dwOutNUcastPkts", wintypes.DWORD), ("dwOutDiscards", wintypes.DWORD),
                            ("dwOutErrors", wintypes.DWORD), ("dwOutQLen", wintypes.DWORD),
                            ("dwDescrLen", wintypes.DWORD), ("bDescr", ctypes.c_ubyte * 256)]
            self._row = MIB_IFROW()
            self._row.dwIndex = idx.value
            self._index = idx.value
            self.available = self.read() is not None
        except (OSError, AttributeError, ValueError):
            self.available = False

    def read(self) -> int | None:
        """Total received bytes since the first read (monotonic, wrap-corrected), or None."""
        if self._index is None:
            return None
        if self._iphlp.GetIfEntry(self._ct.byref(self._row)) != 0:
            return None
        raw = int(self._row.dwInOctets)
        if self._last is not None:
            self._total += (raw - self._last) & 0xFFFFFFFF
        self._last = raw
        return self._total


# --------------------------------------------------------------------------- camera on/off test

@dataclass
class CameraTestIO:
    """What the camera test needs (the UI wires these to the control channel and the fan-out)."""

    set_camera: Callable[[bool], "tuple[bool, list[str]]"]
    camera_reported: Callable[[], bool | None]                 # C2 bridge.camera.reported
    rtt_samples: RttSource
    iface_bytes: Callable[[], int | None] = lambda: None        # InterfaceCounter.read
    video_stats: Callable[[], dict | None] = lambda: None       # latest fan-out stats line
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = time.sleep


class CameraTest:
    """Relay-design test 9 from the GCS side.

    Phases: ``baseline`` (camera off, ``phase_s``) -> camera ON, wait for the reported ON ->
    ``camera_on`` (``phase_s``) -> camera OFF.  Then: time until the bridge reports OFF, and time
    until the interface receive rate falls back below ``baseline + STOP_FRACTION x (on - baseline)``
    (app default; sampled every ``SAMPLE_S``).  RTT and client-video packet timing per phase.
    """

    STOP_FRACTION = 0.25
    SAMPLE_S = 0.02
    RATE_WINDOW_S = 0.1

    def __init__(self, io_: CameraTestIO, phase_s: float = 5.0, timeout_s: float = 5.0) -> None:
        self.io = io_
        self.phase_s = phase_s
        self.timeout_s = timeout_s
        self.cancelled = threading.Event()
        self.log: list[str] = []

    def _rate_series(self, seconds: float) -> list[tuple[float, float]]:
        """(time, kbps) of the interface over ``seconds``, sampled every SAMPLE_S."""
        out: list[tuple[float, int]] = []
        end = self.io.clock() + seconds
        while self.io.clock() < end and not self.cancelled.is_set():
            b = self.io.iface_bytes()
            if b is not None:
                out.append((self.io.clock(), b))
            self.io.sleep(self.SAMPLE_S)
        return _rates(out, self.RATE_WINDOW_S)

    def _phase(self, name: str) -> dict[str, Any]:
        t0, _ = self.io.rtt_samples(None)
        rates = self._rate_series(self.phase_s)
        _, samples = self.io.rtt_samples(t0)
        vs = self.io.video_stats() or {}
        s = rtt_summary(v for _, v in samples)
        mean_rate = statistics.fmean(r for _, r in rates) if rates else None
        return {f"{name}_rtt_mean_ms": s["mean_ms"], f"{name}_rtt_p99_ms": s["p99_ms"],
                f"{name}_iface_kbps": _r(mean_rate, 0), f"{name}_video_pps": _r(vs.get("pps"), 1),
                f"{name}_video_max_gap_ms": _r(vs.get("max_gap_ms"), 1)}

    def _wait_reported(self, on: bool) -> float | None:
        start = self.io.clock()
        while self.io.clock() - start < self.timeout_s and not self.cancelled.is_set():
            if self.io.camera_reported() is on:
                return (self.io.clock() - start) * 1000
            self.io.sleep(0.01)
        return None

    def run(self) -> dict[str, Any]:
        row: dict[str, Any] = {"test": "camera", "time": datetime.now().isoformat(timespec="seconds")}
        ok, reasons = self.io.set_camera(False)
        if not ok:
            return {**row, "note": "camera OFF refused: " + "; ".join(reasons)}
        self._wait_reported(False)
        row.update(self._phase("off"))
        ok, reasons = self.io.set_camera(True)
        if not ok:
            return {**row, "note": "camera ON refused: " + "; ".join(reasons)}
        row["on_reported_ms"] = _r(self._wait_reported(True), 0)
        row.update(self._phase("on"))
        base, on_rate = row.get("off_iface_kbps"), row.get("on_iface_kbps")
        # Camera OFF: sample the interface and the reported state together from this moment on.
        points: list[tuple[float, int]] = []
        b = self.io.iface_bytes()
        t_off = self.io.clock()
        if b is not None:
            points.append((t_off, b))
        self.io.set_camera(False)
        off_reported = None
        while self.io.clock() - t_off < self.timeout_s and not self.cancelled.is_set():
            self.io.sleep(self.SAMPLE_S)
            now = self.io.clock()
            if off_reported is None and self.io.camera_reported() is False:
                off_reported = (now - t_off) * 1000
            b = self.io.iface_bytes()
            if b is not None:
                points.append((now, b))
        row["off_reported_ms"] = _r(off_reported, 0)
        row["traffic_stop_ms"] = None
        if base is not None and on_rate is not None and on_rate > base:
            limit = base + self.STOP_FRACTION * (on_rate - base)
            series = _rates(points, self.RATE_WINDOW_S)
            stop = next((t for t, r in series if r <= limit), None)
            row["traffic_stop_ms"] = None if stop is None else _r((stop - t_off) * 1000, 0)
            row["note"] = (f"traffic stop = interface rate back below {limit:.0f} kbps (baseline + "
                           f"{self.STOP_FRACTION:.0%} of the camera increment); measured at the GCS, includes HM30 buffering")
        elif base is None:
            row["note"] = "TBD - interface counters unavailable: traffic stop time not measured"
        else:
            row["note"] = "no extra interface traffic with the camera on: traffic stop time not measured"
        return row


def _rates(points: list[tuple[float, int]], window_s: float) -> list[tuple[float, float]]:
    """Byte-counter points -> (time, kbps over the trailing ``window_s``)."""
    out: list[tuple[float, float]] = []
    j = 0
    for i, (t, b) in enumerate(points):
        while j < i and t - points[j][0] > window_s:
            j += 1
        if i > j:
            t0, b0 = points[j]
            if t > t0:
                out.append((t, (b - b0) * 8 / 1000 / (t - t0)))
    return out


# --------------------------------------------------------------------------- glass-to-glass

def g2g_text(t: float | None = None) -> str:
    """``HH:MM:SS.mmm`` local time for the on-screen clock (relay-design test 2)."""
    t = time.time() if t is None else t
    sec, ms = divmod(int(round(t * 1000)), 1000)
    return time.strftime("%H:%M:%S", time.localtime(sec)) + f".{ms:03d}"


__all__ = ["CameraTest", "CameraTestIO", "FAILSAFE_CAUSES", "FailsafeTimer", "InterfaceCounter", "Results",
           "RttTest", "g2g_text", "rtt_summary"]
