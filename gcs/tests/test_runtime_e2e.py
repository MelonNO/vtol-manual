"""End-to-end against ``gcs/tools/bridge_sim.py`` on localhost (brief R13).

WAIT_GCS -> RUN, RTT, telemetry decoded into C2, camera read-back, failsafe when
sending stops, controller-disconnect stop-sending, interlock refusal, alarms,
the C2 API over HTTP and the session log.  Waits poll with generous timeouts
and print diagnostics on failure; no test depends on tight timing.
"""

from __future__ import annotations

import contextlib
import http.client
import json
import time
import uuid
from pathlib import Path
from typing import Callable

import pytest

import bridge_sim as BS
from _c2 import assert_c2_status
from vtolgcs import protocol
from vtolgcs.__main__ import Console, carrier_only_dialog, resume_dialog
from vtolgcs.config import Config
from vtolgcs.controller import FakeController
from vtolgcs.protocol import BridgeState
from vtolgcs.runtime import Runtime
from vtolgcs.sender import SUSPEND_CONTROLLER, Mode


class Harness:
    def __init__(self, tmp: Path, **sim_kw: object) -> None:
        self._parts = contextlib.ExitStack()           # WP18 R1: stop what was started, also after a failure
        try:
            bridge = sim_kw.pop("bridge", BS.BridgeConfig(boot_s=0.05, seed=1))
            client = BS.ClientConfig(gps_fix_delay_s=0.0, fs_delay_s=0.3, rth_delay_s=0.3, seed=1)
            self.sim = BS.BridgeSim(BS.SimConfig(port=0, bridge=bridge, client=client, seed=1, **sim_kw))
            self._parts.callback(self.sim.stop)
            self.sim.start()
            time.sleep(0.1)
            cfg = Config()
            cfg.bridge.ip, cfg.bridge.port = self.sim.address
            cfg.api.port = 0
            cfg.mavlink.listen_port = 0
            self.cfg = cfg
            self.fake = FakeController()
            self.events: list[tuple[str, dict]] = []
            self.rt = Runtime(cfg, self.fake, instance_name=f"vtol-gcs-test-{uuid.uuid4().hex}", log_dir=tmp)
            self.rt.add_listener(lambda k, d: self.events.append((k, d)))
            self._parts.callback(self.rt.stop)
            self.rt.start()
            self.t0 = time.perf_counter()
        except BaseException:
            self.close()
            raise

    def diagnostics(self) -> str:
        with self.sim.lock:
            core = self.sim.core
            sim = (f"sim state {core.state.name}, transitions "
                   f"{[(round(t - self.t0, 3), a.name, b.name) for t, a, b in core.transitions]}, rx_ok {core.rx_ok}, "
                   f"bad_crc {core.rx_bad_crc}, bad_seq {core.rx_bad_seq}, reply {core.reply_addr}")
        st = self.rt.sender.state()
        return (f"elapsed {time.perf_counter() - self.t0:.2f}s; sender {st}; rx {dict(self.rt.receiver.counters)}; "
                f"{sim}; status {json.dumps(self.rt.status())[:1500]}; events {self.events[-15:]}")

    def expect(self, cond: Callable[[], bool], what: str, timeout: float = 8.0) -> None:
        end = time.perf_counter() + timeout
        while time.perf_counter() < end:
            if cond():
                return
            time.sleep(0.01)
        raise AssertionError(f"timed out after {timeout}s waiting for {what}:\n  {self.diagnostics()}")

    def status(self) -> dict:
        return self.rt.status()

    def sim_rx_ok(self) -> int:
        with self.sim.lock:
            return self.sim.core.rx_ok

    def sim_visited(self, state: BridgeState) -> bool:
        with self.sim.lock:
            return self.sim.core.visited(state)

    def alarm_ids(self) -> set[str]:
        return {a["id"] for a in self.rt.status()["alarms"]}

    def close(self) -> None:
        self._parts.close()


@pytest.fixture
def harness(tmp_path: Path):
    with contextlib.ExitStack() as made:              # WP18 R1: every harness closed, also when a test fails

        def make(**kw: object) -> Harness:
            h = Harness(tmp_path, **kw)
            made.callback(h.close)
            return h
        yield make


def test_run_rtt_telemetry_camera_and_failsafe(harness) -> None:
    h = harness()
    assert h.status()["bridge"]["state"] == "UNREACHABLE"
    assert h.sim_rx_ok() == 0                                  # idle: nothing sent
    assert h.rt.request_mode(Mode.FPV).ok
    h.expect(lambda: h.status()["bridge"]["state"] == "RUN", "bridge RUN")
    assert h.sim_visited(BridgeState.START)
    seen = [d["to"] for k, d in h.events if k == "bridge_state"]
    assert "RUN" in seen

    h.expect(lambda: (h.status()["bridge"]["rtt_ms"] or 0) > 0, "RTT computed")
    h.expect(lambda: h.status()["bridge"]["uplink_loss_pct"] is not None, "uplink loss computed")
    h.expect(lambda: h.status()["bridge"]["send_jitter_ms_p99"] is not None, "jitter stats")
    s = h.status()
    assert s["bridge"]["rtt_ms"] < 1000 and s["bridge"]["uplink_loss_pct"] <= 5, s["bridge"]
    assert s["bridge"]["fw_version"] == "0.1"
    # status arrives at 10 Hz; a single sample may be old when this thread was descheduled (WP10 R10b): poll instead
    h.expect(lambda: h.status()["bridge"]["status_age_ms"] < 300, "status age < 300 ms")

    h.expect(lambda: all(h.status()["client"][g][k] is not None for g, k in
                         (("link", "lq_pct"), ("gps", "lat"), ("battery", "voltage_v"), ("attitude", "roll_rad"),
                          ("flight_mode", "raw"))), "client telemetry decoded into C2")
    c = h.status()["client"]
    assert c["flight_mode"]["raw"].startswith("ANGL") and c["gps"]["lat"] == pytest.approx(59.9, abs=0.01)
    assert c["telemetry_age_ms"] < 2000 and c["gps"]["sats"] >= 8
    assert_c2_status(h.status())

    # camera: requested -> rc_up flag -> bridge read-back in status
    assert h.status()["bridge"]["camera"] == {"requested": False, "reported": False}
    assert h.rt.set_camera(True).ok                            # client disarmed ('ANGL*'): allowed
    h.expect(lambda: h.status()["bridge"]["camera"]["reported"] is True, "camera read-back ON")
    with h.sim.lock:
        assert h.sim.core.cam_register is True
    assert h.rt.set_camera(False).ok
    h.expect(lambda: h.status()["bridge"]["camera"]["reported"] is False, "camera read-back OFF")
    assert "camera_mismatch" not in h.alarm_ids()

    # the API serves the same object
    host, port = h.rt.api.address
    conn = http.client.HTTPConnection(host, port, timeout=5)
    conn.request("GET", "/api/v1/status")
    api = json.loads(conn.getresponse().read())
    conn.close()
    assert_c2_status(api)
    assert api["bridge"]["state"] == "RUN" and api["app"] == {"version": api["app"]["version"], "mode": "fpv",
                                                              "streaming": True, "start_path": "normal"}

    # stop sending -> the bridge reaches FAILSAFE after T_hold
    t_stop = time.perf_counter()
    assert h.rt.request_mode(Mode.IDLE).ok
    h.expect(lambda: h.sim_visited(BridgeState.FAILSAFE), "bridge FAILSAFE after the stream stops")
    h.expect(lambda: "FAILSAFE" in [d["to"] for k, d in h.events if k == "bridge_state"],
             "FAILSAFE status received by the GCS")
    with h.sim.lock:
        t_fs = [t for t, _, new in h.sim.core.transitions if new == BridgeState.FAILSAFE][0]
    assert t_fs - t_stop >= 0.25 - 0.01                       # not before T_hold (250 ms)
    # the observed stop -> FAILSAFE time is compared with the configured T_hold expectation
    h.expect(lambda: any(k == "failsafe_timing" for k, _ in h.events), "failsafe_timing event")
    ft = [d for k, d in h.events if k == "failsafe_timing"][0]
    assert ft["expected_t_hold_ms"] == 250 and 240 <= ft["observed_ms"] < 2000
    st = [d for k, d in h.events if k == "start_timing"][0]
    assert st["expected_start_packets"] == 5 and st["packets_sent"] >= 5


def test_controller_disconnect_stops_sending(harness) -> None:
    h = harness()
    assert h.rt.request_mode(Mode.FPV).ok
    h.expect(lambda: h.status()["bridge"]["state"] == "RUN", "bridge RUN")
    sent_before = h.rt.sender.state().packets_sent
    h.fake.disconnect()
    t_disc = time.perf_counter()
    h.expect(lambda: h.rt.sender.state().suspended == SUSPEND_CONTROLLER, "sender suspended", timeout=5)
    # The sender sees the loss on its next 4 ms tick; the bounds below are generous for a loaded CI runner
    # (WP10 R10b). The deterministic part: once suspended, not one more packet goes out (no repeated values).
    detect_s = time.perf_counter() - t_disc
    sent_after = h.rt.sender.state().packets_sent
    assert detect_s < 2.0, f"suspension seen {detect_s:.3f} s after the disconnect:\n  {h.diagnostics()}"
    assert sent_after - sent_before <= 500, f"{sent_after - sent_before} packets after the disconnect"
    time.sleep(0.3)
    assert h.rt.sender.state().packets_sent == sent_after, "packets sent after the suspension"
    h.expect(lambda: h.sim_visited(BridgeState.FAILSAFE), "bridge FAILSAFE after controller loss")
    h.expect(lambda: {"controller_disconnected", "rc_stream_stopped"} <= h.alarm_ids(), "alarms raised")
    assert h.rt.sender.state().packets_sent == sent_after      # never repeats the last values

    rx_ok = h.sim_rx_ok()
    h.fake.connect()                                           # controller back: still silent
    time.sleep(0.3)
    assert h.sim_rx_ok() == rx_ok and h.rt.sender.state().packets_sent == sent_after
    h.expect(lambda: "controller_disconnected" not in h.alarm_ids(), "controller alarm cleared")
    assert "rc_stream_stopped" in h.alarm_ids()
    s = h.status()
    assert s["app"] == {"version": s["app"]["version"], "mode": "fpv", "streaming": False, "start_path": "normal"}

    assert h.rt.request_mode(Mode.FPV).ok                      # explicit resume (switch safe)
    h.expect(lambda: h.sim_rx_ok() > rx_ok + 5, "stream resumed")
    h.expect(lambda: h.status()["bridge"]["state"] == "RUN", "bridge RUN again")
    h.expect(lambda: "rc_stream_stopped" not in h.alarm_ids(), "stream alarm cleared")


def test_interlock_refusal_sends_nothing(harness) -> None:
    h = harness()
    h.fake.set_channel_us(5, 2000)
    res = h.rt.request_mode(Mode.FPV)
    assert not res.ok and "arm switch not safe" in res.reasons[0]
    h.fake.set_channel_us(5, 988)
    h.fake.set_channel_us(3, 1500)
    res = h.rt.request_mode(Mode.FPV)
    assert not res.ok and "throttle not low" in res.reasons[0]
    time.sleep(0.3)
    assert h.sim_rx_ok() == 0 and h.status()["app"]["streaming"] is False
    s = h.status()["controller"]
    assert s["arm_switch_safe"] is True and s["throttle_low"] is False
    assert any(k == "interlock_refused" for k, _ in h.events)


def test_client_failsafe_alarm_and_camera_interlock(harness) -> None:
    h = harness()
    assert h.rt.request_mode(Mode.FPV).ok
    h.expect(lambda: h.status()["bridge"]["state"] == "RUN", "bridge RUN")
    h.expect(lambda: (h.status()["client"]["flight_mode"]["raw"] or "").endswith("*"), "client ready to arm")
    h.fake.set_channel_us(5, 2000)                             # pilot arms the client
    h.fake.set_channel_us(3, 1300)
    h.expect(lambda: h.status()["client"]["flight_mode"]["armed"] is True, "client armed (telemetry)")
    res = h.rt.set_camera(True)                                # plan Q13: camera off while the client is armed
    assert not res.ok and any("ARMED" in r for r in res.reasons)
    assert h.status()["bridge"]["camera"]["requested"] is False
    res = h.rt.request_mode(Mode.CARRIER_ONLY)                 # would disarm a flying client
    assert not res.ok
    assert h.rt.request_mode(Mode.IDLE).ok                     # operator stops the stream
    # verifier F1 bypass (fpv -> idle -> carrier-only): refused, the client was heard < 30 s ago
    assert not h.rt.prepare_carrier_only().ok
    assert not h.rt.request_mode(Mode.CARRIER_ONLY).ok
    h.expect(lambda: "client_failsafe" in h.alarm_ids(), "FPV FAILSAFE alarm from telemetry '!FS!'")
    h.expect(lambda: "client_rth" in h.alarm_ids(), "FPV RTH alarm")
    alarms = [d for k, d in h.events if k == "alarm" and d["active"]]
    fs = [a for a in alarms if a["id"] == "client_failsafe"][0]
    assert fs["severity"] == "crit" and fs["text"] == "FPV FAILSAFE" and fs["since"].endswith("Z")


def test_resume_client_airborne_after_restart(harness) -> None:
    """App restarted while the client flies: comes up idle; RESUME starts only after preview + confirmation."""
    h = harness()
    h.fake.set_channel_us(5, 2000)                             # pilot holds the arm switch ARMED
    h.fake.set_channel_us(3, 1400)
    time.sleep(0.3)
    assert h.sim_rx_ok() == 0 and h.status()["app"]["start_path"] is None   # never auto-resume
    assert not h.rt.request_mode(Mode.FPV).ok                  # normal start refused: switch armed
    h.rt.set_camera(False)
    preview = h.rt.prepare_resume()
    assert preview.ok and preview.arm_us == 2000 and preview.throttle_us == 1400
    time.sleep(0.3)
    assert h.sim_rx_ok() == 0                                  # nothing before the confirmation
    assert h.rt.confirm_resume(preview.token).ok
    h.expect(lambda: h.status()["bridge"]["state"] == "RUN", "bridge RUN after RESUME")
    s = h.status()
    assert s["app"]["start_path"] == "resume" and s["app"]["mode"] == "fpv"
    with h.sim.lock:
        assert h.sim.core.last_rc.channels[4] == protocol.us_to_crsf(2000)
    path = h.rt.session.path
    h.close()
    recs = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines()]
    modes = [r for r in recs if r["type"] == "mode"]
    assert modes[0]["start_path"] == "resume" and modes[0]["arm_us"] == 2000
    assert any(r["type"] == "resume_preview" for r in recs)
    assert any(r["type"] == "interlock_refused" and r["requested"] == "fpv" for r in recs)


def enter_carrier_only(h: Harness) -> None:
    preview = h.rt.prepare_carrier_only()
    assert preview.ok, preview.problems
    assert h.rt.confirm_carrier_only(preview.token, no_client_confirmed=True).ok


def test_carrier_only_streams_without_controller_and_enables_camera(harness) -> None:
    h = harness()
    h.fake.disconnect()
    assert not h.rt.request_mode(Mode.CARRIER_ONLY).ok          # never without the NOCLIENT confirmation
    time.sleep(0.2)
    assert h.sim_rx_ok() == 0
    enter_carrier_only(h)
    h.expect(lambda: h.status()["bridge"]["state"] == "RUN", "bridge RUN in carrier-only")
    h.expect(lambda: h.status()["bridge"]["camera"]["reported"] is True, "camera ON in carrier-only")
    with h.sim.lock:
        ch = h.sim.core.last_rc.channels
    assert ch[4] == 172 and ch[2] == 172 and ch[0] == ch[1] == ch[3] == protocol.CRSF_CHANNEL_MID
    # raised while idle without a controller; carrier-only does not need one, so it clears (0.5 s hysteresis)
    h.expect(lambda: "controller_disconnected" not in h.alarm_ids(), "no controller alarm in carrier-only")
    assert h.status()["app"]["mode"] == "carrier_only"


def test_camera_mismatch_alarm(harness) -> None:
    h = harness(bridge=BS.BridgeConfig(boot_s=0.05, seed=1, cam_fault="stuck-off"))
    h.fake.disconnect()
    enter_carrier_only(h)                                       # requests camera ON
    h.expect(lambda: "camera_mismatch" in h.alarm_ids(), "camera mismatch alarm (> 1 s)")


def test_session_log_records(harness, tmp_path: Path) -> None:
    h = harness()
    written: list[str] = []
    write = h.rt.session.write

    def spy(rtype: str, **fields: object) -> None:
        written.append(rtype)
        write(rtype, **fields)
    h.rt.session.write = spy                                   # type: ignore[method-assign]
    assert h.rt.request_mode(Mode.FPV).ok
    h.expect(lambda: h.status()["client"]["flight_mode"]["raw"] is not None, "telemetry")
    h.rt.set_camera(True)
    # at least one per-second sender record: wait for it rather than a fixed 1.3 s (WP10 R10b)
    h.expect(lambda: "sender" in written, "a per-second sender record")
    h.fake.disconnect()
    h.expect(lambda: "controller_disconnected" in h.alarm_ids(), "alarm")
    path = h.rt.session.path
    h.close()
    lines = path.read_text(encoding="utf-8").splitlines()
    recs = [json.loads(line) for line in lines]
    assert path.name.startswith("session-") and path.suffix == ".jsonl"
    assert all({"t", "mono_s", "type"} <= set(r) for r in recs)
    types = {r["type"] for r in recs}
    assert {"session_start", "mode", "status", "sender", "telemetry", "bridge_state", "camera", "camera_readback",
            "alarm", "suspended", "session_end"} <= types
    assert recs[0]["type"] == "session_start" and recs[-1]["type"] == "session_end"
    status = [r for r in recs if r["type"] == "status"]
    assert_c2_status(status[-1]["status"])
    sender = [r for r in recs if r["type"] == "sender"][0]
    assert {"sent", "rate_hz", "jitter_p50_ms", "jitter_p99_ms", "jitter_max_ms", "send_errors"} <= set(sender)


# --------------------------------------------------------------------------- console dialogs (typed confirmations)

class Typed:
    def __init__(self, *lines: str) -> None:
        self.lines = list(lines)
        self.out: list[str] = []

    def read(self) -> str:
        return self.lines.pop(0) + "\n" if self.lines else ""


def test_carrier_only_dialog_paths(harness) -> None:
    h = harness()
    t = Typed("NOCLIENT")
    assert carrier_only_dialog(h.rt, t.out.append, t.read, interactive=False) is None   # piped: refused
    assert any("interactive console" in x for x in t.out) and t.lines == ["NOCLIENT"]
    t = Typed("noclient")
    assert carrier_only_dialog(h.rt, t.out.append, t.read, interactive=True) is None    # wrong word
    assert any("cancelled - nothing sent" in x for x in t.out)
    time.sleep(0.2)
    assert h.sim_rx_ok() == 0
    t = Typed("NOCLIENT")
    res = carrier_only_dialog(h.rt, t.out.append, t.read, interactive=True)
    assert res is not None and res.ok and "DISARM" in t.out[0]
    h.expect(lambda: h.status()["bridge"]["state"] == "RUN", "carrier-only RUN")


def test_carrier_only_after_fpv_needs_landed_and_quiet_telemetry(harness) -> None:
    h = harness(telemetry_hz=0.0)                                # no client telemetry at all
    assert h.rt.request_mode(Mode.FPV).ok
    h.expect(lambda: h.status()["bridge"]["state"] == "RUN", "bridge RUN")
    assert h.rt.request_mode(Mode.IDLE).ok
    t = Typed("NOCLIENT", "yes")
    assert carrier_only_dialog(h.rt, t.out.append, t.read, interactive=True) is None
    assert any("LANDED" in x for x in t.out)
    assert h.status()["app"]["mode"] == "idle"
    t = Typed("NOCLIENT", "LANDED")
    res = carrier_only_dialog(h.rt, t.out.append, t.read, interactive=True)
    assert res is not None and res.ok and h.status()["app"]["mode"] == "carrier_only"


def test_resume_dialog_paths(harness) -> None:
    h = harness()
    h.fake.set_channel_us(5, 2000)
    h.fake.set_channel_us(3, 1500)
    t = Typed("RESUME")
    assert resume_dialog(h.rt, t.out.append, t.read, interactive=False) is None
    assert any("interactive console" in x for x in t.out)
    t = Typed("yes")
    assert resume_dialog(h.rt, t.out.append, t.read, interactive=True) is None
    time.sleep(0.2)
    assert h.sim_rx_ok() == 0
    t = Typed("RESUME")
    res = resume_dialog(h.rt, t.out.append, t.read, interactive=True)
    assert res is not None and res.ok
    assert "CH5 arm = 2000 us (ARMED), CH3 throttle = 1500 us" in t.out[0]   # live values before any packet
    h.expect(lambda: h.status()["app"]["start_path"] == "resume", "resume start path")
    h.fake.set_channel_us(3, 988)                                # throttle at minimum: second confirmation
    assert h.rt.request_mode(Mode.IDLE).ok
    t = Typed("RESUME", "no")
    assert resume_dialog(h.rt, t.out.append, t.read, interactive=True) is None
    assert any("THROTTLE AT MINIMUM" in x for x in t.out)
    t = Typed("RESUME", "THROTTLE")
    assert resume_dialog(h.rt, t.out.append, t.read, interactive=True).ok


def test_api_status_is_cached_briefly(harness, monkeypatch) -> None:
    """The cache rule, deterministic (WP10 R10b, rework F3). This flaked once under load (WP14 round 3): the
    runtime's own 1 Hz session-log ``status()`` (monitor loop) builds a fresh object and replaces the cache, so it
    could land between two calls of the test. The only other callers in this process are the local API and SSE,
    which no client uses here. Both reach ``self.status`` through the instance, so an instance attribute redirects
    them to a plain build that never touches the cache. The test calls the real method directly: from then on
    nothing but the test reads or writes the cache, and it counts its own builds."""
    import threading
    from vtolgcs.runtime import Runtime
    h = harness()
    rt = h.rt
    me, mine = threading.get_ident(), []
    build = rt._build_status

    def counting(now: float) -> dict:
        status = build(now)
        if threading.get_ident() == me:
            mine.append(status)
        return status
    monkeypatch.setattr(rt, "_build_status", counting)
    # background callers (monitor / session log, API): fresh build, cache untouched
    monkeypatch.setattr(rt, "status", lambda max_age_s=0.0: rt._build_status(rt._clock()))
    status = lambda max_age_s=0.0: Runtime.status(rt, max_age_s)    # noqa: E731 - the real method, for the test

    a = status()                                                 # max_age 0: always a fresh build, cached
    assert mine == [a]
    assert status(60.0) is a and len(mine) == 1                  # within max_age: the cached object, no build
    time.sleep(0.02)
    c = status(0.001)                                            # 20 ms old > 1 ms: rebuilt and cached
    assert len(mine) == 2 and c is mine[1] and c is not a
    assert status(60.0) is c and len(mine) == 2
    assert status() is not c and len(mine) == 3                  # fresh build by default


# --------------------------------------------------------------------------- console keys (WP15 R2/R3)

def _console(h: Harness, *lines: str, interactive: bool = True) -> tuple[Console, Typed]:
    t = Typed(*lines)
    c = Console(h.rt, h.fake, tty=False, interactive=interactive, read_line=t.read)
    c.print_line = t.out.append                                  # type: ignore[method-assign]
    return c, t


def _streaming_fpv(h: Harness) -> None:
    st = h.rt.sender.state()
    assert st.mode is Mode.FPV and st.streaming, st


def test_single_console_keys_change_nothing_while_streaming(harness) -> None:
    h = harness()
    assert h.rt.request_mode(Mode.FPV).ok
    h.expect(lambda: h.status()["bridge"]["state"] == "RUN", "bridge RUN")
    arm0 = h.fake.snapshot().channel_us(5)
    for interactive in (True, False):
        for ch in "qiafrkdcR":
            # a stray key, then Enter / a wrong word / nothing at all (EOF)
            for answer in ("", "stop", "yes"):
                c, t = _console(h, answer, interactive=interactive)
                assert c.key(ch) is True, (ch, t.out)               # never quits
                _streaming_fpv(h)
                assert not h.rt.sender.stopping
                assert h.rt.sender.state().camera_requested is False
                assert h.fake.snapshot().connected and h.fake.snapshot().channel_us(5) == arm0
                if not interactive:
                    assert t.lines == [answer], (ch, t.out)          # nothing read from piped input
    n = h.sim_rx_ok()
    time.sleep(0.3)
    assert h.sim_rx_ok() - n > 40                                # still streaming at ~250 Hz
    assert [e for e in h.events if e[0] == "mode"][-1][1]["mode"] == "fpv"
    assert h.status()["bridge"]["state"] == "RUN"


def test_console_typed_confirmations_still_work(harness) -> None:
    h = harness()
    c, t = _console(h, "START")
    assert c.key("f") and h.rt.sender.state().streaming          # f + START: normal start
    h.expect(lambda: h.status()["bridge"]["state"] == "RUN", "bridge RUN")
    c, t = _console(h, "CAMERA")
    assert c.key("k") and h.rt.sender.state().camera_requested   # k + CAMERA
    c, t = _console(h, "CAMERA")
    assert c.key("k") and not h.rt.sender.state().camera_requested
    c, t = _console(h, "STOP")
    assert c.key("i") and h.rt.sender.state().mode is Mode.IDLE  # i + STOP: idle
    c, t = _console(h)
    assert c.key("i") and any("already idle" in x for x in t.out)
    c, t = _console(h, "ARM")
    assert c.key("a") and h.fake.snapshot().channel_us(5) == protocol.US_MAX     # sim a + ARM
    c, t = _console(h, "SAFE")
    assert c.key("a") and h.fake.snapshot().channel_us(5) == h.cfg.interlock.arm_safe_min_us
    c, t = _console(h, "START")
    assert c.key("f") and h.rt.sender.state().streaming
    c, t = _console(h, "UNPLUG")
    assert c.key("d") and not h.fake.snapshot().connected       # sim d + UNPLUG: controller lost
    h.expect(lambda: not h.rt.sender.state().streaming, "stream stopped (controller lost)")
    c, t = _console(h, "PLUG")
    assert c.key("d") and h.fake.snapshot().connected
    assert not h.rt.sender.state().streaming                    # never auto-resumes
    c, t = _console(h, "START")
    assert c.key("r") and h.rt.sender.state().streaming          # r + START: restart
    c, t = _console(h, "STOP")
    assert c.key("q") is False and h.rt.sender.stopping          # q + STOP while streaming: quit
    c, t = _console(h, "START")                                  # the process exits next; nothing restarts
    c.key("f")
    assert any("stop was accepted" in r for r in
               [r for k, d in h.events if k == "interlock_refused" for r in d["reasons"]])


def test_console_quit_and_harmless_keys_when_not_streaming(harness) -> None:
    h = harness()
    c, t = _console(h, "never read")
    assert c.key("s") and c.key("h") and c.key("?")             # act at once, read nothing
    assert t.lines == ["never read"] and any("bridge" in x for x in t.out) and any("START" in x for x in t.out)
    assert c.key("q") is False and t.lines == ["never read"]     # idle: q quits at once (nothing streams)
    assert h.rt.sender.stopping
    assert not h.rt.request_mode(Mode.FPV).ok                    # ...and nothing can start any more
