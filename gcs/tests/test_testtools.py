"""Test tools (brief R7): RTT test, failsafe timer, camera on/off test, CSV, g2g clock - with fake clocks."""

from __future__ import annotations

import csv
import io
import socket
import sys
from pathlib import Path

import pytest

from vtolgcs import testtools as T


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t

    def sleep(self, dt: float) -> None:
        self.t += dt


def test_rtt_summary() -> None:
    s = T.rtt_summary([5.0, 3.0, 4.0, 10.0])
    assert s == {"n": 4, "min_ms": 3.0, "mean_ms": 5.5, "p99_ms": 10.0, "max_ms": 10.0}
    assert T.rtt_summary([])["mean_ms"] is None


def test_rtt_test_collects_the_window() -> None:
    clk = Clock()
    stream = [(1000.0 + i * 0.1, 2.0 + (i % 5)) for i in range(200)]     # 10 Hz samples, 20 s

    def samples(since):
        return clk.t, [(t, v) for t, v in stream if (since is None or t > since) and t <= clk.t]
    row = T.RttTest(samples, "off", duration_s=5.0, video_kbps=lambda: 0.0, sleep=clk.sleep).run()
    assert row["test"] == "rtt" and row["video"] == "off" and row["n"] == 50
    assert row["min_ms"] == 2.0 and row["max_ms"] == 6.0 and row["video_kbps_mean"] == 0.0
    empty = T.RttTest(lambda since: (clk.t, []), "full", duration_s=1.0, sleep=clk.sleep).run()
    assert "no RTT samples" in empty["note"]


def test_failsafe_timer_app_stop() -> None:
    ft = T.FailsafeTimer()
    ft.arm_stop()
    assert ft.on_event({"event": "mode", "t": 10.0, "data": {"mode": "idle"}}) is None
    ft.on_event({"event": "bridge_state", "t": 10.252, "data": {"to": "FAILSAFE"}})
    ft.on_event({"event": "client_flight_mode", "t": 11.0, "data": {"raw": "ANGL", "failsafe": False, "t": 11.0}})
    row = ft.on_event({"event": "client_flight_mode", "t": 11.9, "data": {"raw": "!FS!", "failsafe": True, "t": 11.8}})
    assert row["client_failsafe_ms"] == 1800 and row["bridge_failsafe_ms"] == 252
    assert row["cause"] == T.FAILSAFE_CAUSES[0] and row["end"] == "client telemetry !FS!"
    assert not ft.running


def test_failsafe_timer_other_cause_manual_stop() -> None:
    ft = T.FailsafeTimer()
    ft.start("HM30 unplugged", 50.0)
    assert ft.running and ft.manual_stop(52.5)["client_failsafe_ms"] == 2500
    assert ft.manual_stop(53.0) is None                                     # already finished


def test_camera_test_measures_reported_and_traffic_stop() -> None:
    clk = Clock()
    cam = {"cmd": False, "cmd_t": 0.0}
    total = [0.0]
    last = [clk.t]

    def rate_kbps(t: float) -> float:
        on = cam["cmd"] or t < cam["cmd_t"] + 0.15                  # camera traffic stops 150 ms after OFF
        return 1000.0 + (4000.0 if on and cam["cmd_t"] else 0.0)

    def iface() -> int:
        # integrate the rate in 1 ms steps up to now
        while last[0] < clk.t:
            total[0] += rate_kbps(last[0]) * 1000 / 8 * 0.001
            last[0] += 0.001
        return int(total[0])

    def set_camera(on: bool):
        cam["cmd"], cam["cmd_t"] = on, clk.t if not on and cam["cmd"] else (clk.t if on else cam["cmd_t"])
        return True, []

    def reported():
        return cam["cmd"] if clk.t - cam["cmd_t"] > 0.03 else (not cam["cmd"])

    io_ = T.CameraTestIO(set_camera=set_camera, camera_reported=reported,
                         rtt_samples=lambda since: (clk.t, [(clk.t, 3.0)]), iface_bytes=iface,
                         video_stats=lambda: {"pps": 250.0, "max_gap_ms": 12.0}, clock=clk, sleep=clk.sleep)
    row = T.CameraTest(io_, phase_s=1.0, timeout_s=1.0).run()
    assert row["off_iface_kbps"] == pytest.approx(1000, rel=0.05)
    assert row["on_iface_kbps"] == pytest.approx(5000, rel=0.05)
    assert 20 <= row["on_reported_ms"] <= 60 and 20 <= row["off_reported_ms"] <= 60
    assert 150 <= row["traffic_stop_ms"] <= 150 + 100            # + up to one rate window
    assert row["on_video_pps"] == 250.0 and "baseline" in row["note"]


def test_camera_test_refused_and_without_counters() -> None:
    clk = Clock()
    io_ = T.CameraTestIO(set_camera=lambda on: (not on, ["client may be armed"]), camera_reported=lambda: False,
                         rtt_samples=lambda since: (clk.t, []), clock=clk, sleep=clk.sleep)
    assert "camera ON refused" in T.CameraTest(io_, phase_s=0.2).run()["note"]
    io_.set_camera = lambda on: (True, [])
    io_.camera_reported = lambda: None
    assert "TBD" in T.CameraTest(io_, phase_s=0.2, timeout_s=0.2).run()["note"]


def test_results_csv(tmp_path: Path) -> None:
    res = T.Results()
    res.add({"test": "rtt", "mean_ms": 3.2})
    res.add({"test": "failsafe", "client_failsafe_ms": 1800, "cause": "HM30 unplugged"})
    path = res.export_csv(tmp_path / "r.csv")
    rows = list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8"))))
    assert rows[0]["mean_ms"] == "3.2" and rows[1]["cause"] == "HM30 unplugged" and rows[0]["cause"] == ""


def test_g2g_clock_text() -> None:
    text = T.g2g_text(1_700_000_000.123)
    assert text.endswith(".123") and len(text) == 12


@pytest.mark.skipif(sys.platform != "win32", reason="Windows interface counters")
def test_interface_counter_reads_loopback_route() -> None:
    c = T.InterfaceCounter("127.0.0.1")
    if not c.available:
        pytest.skip("no interface counters on this machine")
    a = c.read()
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.sendto(b"x", ("127.0.0.1", 9))
    s.close()
    assert c.read() >= a >= 0
