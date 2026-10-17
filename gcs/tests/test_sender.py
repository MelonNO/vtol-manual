"""RC sender: interlocks, modes, stop-on-disconnect, packets, jitter stats (brief R3-R5).

All tests drive :meth:`Sender.tick` / :meth:`Sender.send_slot` with a fake clock,
except one short real-thread test of the absolute-deadline loop.
"""

from __future__ import annotations

import time

import pytest

from vtolgcs import protocol
from vtolgcs.config import Config
from vtolgcs.controller import FakeController, safe_channels
from vtolgcs.protocol import RcUp
from vtolgcs.sender import (SUSPEND_CONTROLLER, SUSPEND_INTERNAL, SUSPEND_THREAD, JitterWindow, Mode, Sender,
                            carrier_only_channels, percentile)


class Clock:
    def __init__(self, t: float = 100.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


@pytest.fixture
def rig():
    clock = Clock()
    cfg = Config()
    ctl = FakeController(clock=clock)
    sent: list[bytes] = []
    events: list[tuple[str, dict]] = []
    us = [1000]
    heard: list[float | None] = [None]               # seconds since client telemetry (None = never)

    def us_clock() -> int:
        us[0] += 4000
        return us[0]

    sender = Sender(cfg, ctl, sent.append, clock=clock, us_clock=us_clock,
                    on_event=lambda k, d: events.append((k, d)), client_heard_s=lambda: heard[0])

    class Rig:
        pass
    r = Rig()
    r.clock, r.cfg, r.ctl, r.sent, r.events, r.sender, r.heard = clock, cfg, ctl, sent, events, sender, heard

    def slot(n: int = 1) -> list[RcUp | None]:
        out = []
        for _ in range(n):
            pkt = sender.send_slot(clock(), clock())
            out.append(RcUp.unpack(pkt.data) if pkt else None)
            clock.advance(0.004)
        return out
    r.slot = slot
    return r


# --------------------------------------------------------------------------- start interlock

def test_idle_sends_nothing(rig) -> None:
    assert rig.slot(5) == [None] * 5 and rig.sent == []
    assert rig.sender.state().mode is Mode.IDLE and not rig.sender.state().streaming


def test_fpv_start_allowed_with_arm_safe_and_throttle_low(rig) -> None:
    res = rig.sender.request_mode("fpv")
    assert res.ok and res.mode is Mode.FPV
    pkts = rig.slot(3)
    assert all(p is not None for p in pkts)
    assert [p.seq for p in pkts] == [1, 2, 3]                   # monotonic seq
    assert pkts[0].channels[2] == 172 and pkts[0].channels[4] == 172 and pkts[0].channels[0] == 992
    assert pkts[1].t_gcs_us - pkts[0].t_gcs_us == 4000           # t_gcs_us from the injected us clock


@pytest.mark.parametrize("channel, us, fragment", [
    (5, 2000, "arm switch not safe: CH5 = 2000"),
    (5, 1700, "arm switch not safe"),                          # 1700 is inside the client's ARM range
    (3, 1200, "throttle not low: CH3 = 1200"),
    (3, 1051, "throttle not low"),
])
def test_fpv_start_refused_by_interlock(rig, channel: int, us: int, fragment: str) -> None:
    rig.ctl.set_channel_us(channel, us)
    res = rig.sender.request_mode(Mode.FPV)
    assert not res.ok and res.mode is Mode.IDLE
    assert any(fragment in r for r in res.reasons), res.reasons
    assert rig.slot(3) == [None] * 3 and rig.sent == []
    assert rig.events[-1][0] == "interlock_refused"


def test_interlock_edges_pass(rig) -> None:
    rig.ctl.set_channel_us(5, 1699)
    rig.ctl.set_channel_us(3, 1050)
    assert rig.sender.request_mode(Mode.FPV).ok


def test_fpv_start_refused_without_controller(rig) -> None:
    rig.ctl.disconnect()
    res = rig.sender.request_mode(Mode.FPV)
    assert not res.ok and res.reasons == ("controller not connected",)


def test_fpv_start_refused_with_stale_controller(rig) -> None:
    rig.ctl.freeze()
    rig.clock.advance(0.150)
    res = rig.sender.request_mode(Mode.FPV)
    assert not res.ok and "stale" in res.reasons[0]


# --------------------------------------------------------------------------- disconnect -> stop immediately

def test_disconnect_stops_sending_at_once_and_never_repeats(rig) -> None:
    rig.sender.request_mode(Mode.FPV)
    rig.ctl.set_channel_us(1, 1700)
    assert rig.slot(2)[-1].channels[0] == protocol.us_to_crsf(1700)
    n = len(rig.sent)
    rig.ctl.disconnect()
    assert rig.slot(50) == [None] * 50                    # the very next slot sends nothing
    assert len(rig.sent) == n
    st = rig.sender.state()
    assert st.mode is Mode.FPV and st.suspended == SUSPEND_CONTROLLER and not st.streaming
    assert ("suspended", {"reason": SUSPEND_CONTROLLER, "detail": "controller not connected",
                          "mode": "fpv"}) in rig.events
    rig.ctl.connect()                                     # comes back: still nothing without a resume
    assert rig.slot(10) == [None] * 10 and len(rig.sent) == n


def test_stale_controller_counts_as_disconnect(rig) -> None:
    rig.sender.request_mode(Mode.FPV)
    rig.slot(1)
    rig.ctl.freeze()                                      # hung input thread: data stops updating
    out = rig.slot(30)                                    # 30 x 4 ms = 120 ms
    first_none = out.index(None)
    assert all(p is not None for p in out[:first_none]) and all(p is None for p in out[first_none:])
    assert first_none * 0.004 <= 0.100 + 0.004           # stopped within the 100 ms budget
    assert rig.sender.state().suspended == SUSPEND_CONTROLLER


def test_normal_restart_with_switch_safe(rig) -> None:
    rig.sender.request_mode(Mode.FPV)
    rig.slot(1)
    rig.ctl.disconnect()
    rig.slot(1)
    rig.ctl.connect()
    res = rig.sender.request_mode(Mode.FPV)
    assert res.ok
    assert rig.slot(1)[0] is not None
    assert rig.events[-1] == ("mode", {"mode": "fpv", "from": "fpv", "resumed": True, "start_path": "normal",
                                       "arm_us": 988, "throttle_us": 988})
    assert rig.sender.state().start_path == "normal"


# --------------------------------------------------------------------------- RESUME (client airborne) path

def airborne(rig, throttle_us: int = 1400) -> None:
    rig.ctl.set_channel_us(5, 2000)                       # arm switch ARMED
    rig.ctl.set_channel_us(3, throttle_us)


def test_normal_start_refused_with_arm_armed_points_to_resume(rig) -> None:
    airborne(rig)
    res = rig.sender.request_mode(Mode.FPV)
    assert not res.ok and any("arm switch not safe" in r for r in res.reasons)
    assert any("RESUME (client airborne)" in r for r in res.reasons)
    assert rig.slot(3) == [None] * 3 and rig.sent == []


def test_resume_needs_preview_and_confirmation_and_sends_nothing_before(rig) -> None:
    airborne(rig)
    assert not rig.sender.confirm_resume(1).ok             # no preview yet
    preview = rig.sender.prepare_resume()
    assert preview.ok and preview.arm_us == 2000 and preview.throttle_us == 1400
    assert preview.arm_armed is True and preview.throttle_at_min is False and not preview.needs_throttle_confirm
    assert "CH5 arm = 2000 us (ARMED)" in preview.text() and "CH3 throttle = 1400 us" in preview.text()
    assert rig.slot(5) == [None] * 5 and rig.sent == []    # preview alone sends nothing
    assert rig.sender.state().mode is Mode.IDLE
    assert not rig.sender.confirm_resume(preview.token + 1).ok      # wrong token
    res = rig.sender.confirm_resume(preview.token)
    assert res.ok and rig.sender.state().start_path == "resume"
    pkt = rig.slot(1)[0]
    assert pkt.channels[4] == protocol.us_to_crsf(2000)    # armed as the pilot holds it: no mid-air disarm
    assert pkt.channels[2] == protocol.us_to_crsf(1400)
    assert ("mode", {"mode": "fpv", "from": "idle", "resumed": False, "start_path": "resume",
                     "arm_us": 2000, "throttle_us": 1400}) in rig.events
    assert any(k == "resume_preview" for k, _ in rig.events)
    assert not rig.sender.confirm_resume(preview.token).ok     # single use (and already streaming)


def test_resume_token_is_single_use_and_expires(rig) -> None:
    airborne(rig)
    p1 = rig.sender.prepare_resume()
    p2 = rig.sender.prepare_resume()
    assert not rig.sender.confirm_resume(p1.token).ok     # superseded by the newer preview
    rig.clock.advance(16.0)
    res = rig.sender.confirm_resume(p2.token)
    assert not res.ok and "expired" in res.reasons[0]
    assert rig.sent == []


def test_resume_with_throttle_at_minimum_needs_second_confirmation(rig) -> None:
    airborne(rig, throttle_us=988)
    preview = rig.sender.prepare_resume()
    assert preview.ok and preview.throttle_at_min and preview.needs_throttle_confirm
    assert "(AT MINIMUM)" in preview.text()
    res = rig.sender.confirm_resume(preview.token)
    assert not res.ok and "throttle at minimum" in res.reasons[0]
    assert rig.slot(2) == [None, None]
    res = rig.sender.confirm_resume(preview.token, throttle_min_confirmed=True)
    assert res.ok and rig.slot(1)[0] is not None


def test_resume_refused_with_arm_switch_safe(rig) -> None:
    preview = rig.sender.prepare_resume()                 # default fake: arm switch SAFE
    assert not preview.ok and "would disarm" in preview.problems[0]
    assert not rig.sender.confirm_resume(preview.token).ok
    airborne(rig)
    preview = rig.sender.prepare_resume()
    rig.ctl.set_channel_us(5, 988)                        # switch moved to SAFE after the preview
    res = rig.sender.confirm_resume(preview.token)
    assert not res.ok and "moved to SAFE" in res.reasons[0] and rig.sent == []


def test_resume_refused_without_controller_or_while_streaming(rig) -> None:
    rig.ctl.disconnect()
    preview = rig.sender.prepare_resume()
    assert not preview.ok and preview.arm_us is None and "controller not connected" in preview.problems
    rig.ctl.connect()
    enter_carrier_only(rig)
    airborne(rig)
    preview = rig.sender.prepare_resume()
    assert not preview.ok and any("already streaming" in p for p in preview.problems)


def test_resume_after_controller_loss(rig) -> None:
    rig.sender.request_mode(Mode.FPV)
    airborne(rig)                                         # pilot arms, client flies
    rig.slot(1)
    rig.ctl.disconnect()
    rig.slot(1)
    rig.ctl.connect()
    assert not rig.sender.request_mode(Mode.FPV).ok        # normal path refused: switch is armed
    assert rig.slot(3) == [None] * 3                      # never auto-resume
    preview = rig.sender.prepare_resume()
    assert preview.ok
    res = rig.sender.confirm_resume(preview.token)
    assert res.ok and rig.slot(1)[0].channels[4] == protocol.us_to_crsf(2000)
    assert rig.events[-1][1]["resumed"] is True and rig.events[-1][1]["start_path"] == "resume"


def test_fresh_sender_never_auto_resumes(rig) -> None:
    """A restarted app comes up idle whatever the controller shows."""
    airborne(rig)
    fresh = Sender(rig.cfg, rig.ctl, rig.sent.append, clock=rig.clock)
    st = fresh.state()
    assert st.mode is Mode.IDLE and st.start_path is None and not st.streaming
    for _ in range(50):
        assert fresh.send_slot(rig.clock(), rig.clock()) is None
        rig.clock.advance(0.004)
    assert rig.sent == []


def test_idle_always_allowed_and_clears_suspension(rig) -> None:
    rig.sender.request_mode(Mode.FPV)
    rig.ctl.disconnect()
    rig.slot(1)
    assert rig.sender.request_mode(Mode.IDLE).ok
    st = rig.sender.state()
    assert st.mode is Mode.IDLE and st.suspended is None and st.start_path is None


# --------------------------------------------------------------------------- carrier-only guard (F1)

def enter_carrier_only(rig, landed: bool = False) -> None:
    preview = rig.sender.prepare_carrier_only()
    assert preview.ok, preview.problems
    res = rig.sender.confirm_carrier_only(preview.token, no_client_confirmed=True, landed_confirmed=landed)
    assert res.ok, res.reasons


def test_carrier_only_forces_safe_channels(rig) -> None:
    rig.ctl.disconnect()                                  # no controller needed
    enter_carrier_only(rig)
    pkt = rig.slot(1)[0]
    il = rig.cfg.interlock
    assert pkt.channels[il.arm_channel - 1] == protocol.us_to_crsf(il.arm_safe_min_us) == 172
    assert pkt.channels[il.throttle_channel - 1] == 172
    others = [c for i, c in enumerate(pkt.channels) if i not in (il.arm_channel - 1, il.throttle_channel - 1)]
    assert set(others) == {992}
    assert carrier_only_channels(il)[4] == 988
    assert rig.sender.state().start_path == "normal"


def test_carrier_only_ignores_the_controller(rig) -> None:
    enter_carrier_only(rig)
    rig.ctl.set_channel_us(5, 2000)
    rig.ctl.set_channel_us(3, 2000)
    pkt = rig.slot(1)[0]
    assert pkt.channels[4] == 172 and pkt.channels[2] == 172


def test_request_mode_never_enters_carrier_only(rig) -> None:
    res = rig.sender.request_mode(Mode.CARRIER_ONLY)       # from idle, no confirmation
    assert not res.ok and "NOCLIENT" in res.reasons[0]
    assert rig.slot(3) == [None] * 3 and rig.sent == []


def test_carrier_only_needs_preview_and_confirmation(rig) -> None:
    assert not rig.sender.confirm_carrier_only(1, no_client_confirmed=True).ok      # no preview
    preview = rig.sender.prepare_carrier_only()
    assert preview.ok and not preview.needs_landed_confirm and "DISARM" in preview.text()
    assert rig.slot(3) == [None] * 3 and rig.sent == []                              # preview sends nothing
    res = rig.sender.confirm_carrier_only(preview.token, no_client_confirmed=False)
    assert not res.ok and "NOCLIENT" in res.reasons[0]
    res = rig.sender.confirm_carrier_only(preview.token, no_client_confirmed=True)   # single use: gone
    assert not res.ok and "no valid carrier-only preview" in res.reasons[0]
    preview = rig.sender.prepare_carrier_only()
    rig.clock.advance(16.0)
    res = rig.sender.confirm_carrier_only(preview.token, no_client_confirmed=True)
    assert not res.ok and "expired" in res.reasons[0]
    assert rig.sent == []


def test_carrier_only_refused_while_client_heard(rig) -> None:
    rig.heard[0] = 12.0
    preview = rig.sender.prepare_carrier_only()
    assert not preview.ok and "heard 12 s ago" in preview.problems[0]
    rig.heard[0] = 31.0
    preview = rig.sender.prepare_carrier_only()
    assert preview.ok
    rig.heard[0] = 0.5                                     # a client appeared between preview and confirm
    res = rig.sender.confirm_carrier_only(preview.token, no_client_confirmed=True)
    assert not res.ok and "client telemetry heard" in res.reasons[0] and rig.sent == []


def test_idle_then_carrier_only_bypass_is_closed(rig) -> None:
    """Verifier F1 sequence: fpv (client armed and flying) -> idle -> carrier_only."""
    rig.sender.request_mode(Mode.FPV)
    rig.ctl.set_channel_us(5, 2000)
    rig.ctl.set_channel_us(3, 1400)
    rig.slot(2)
    assert rig.sender.request_mode(Mode.IDLE).ok
    n = len(rig.sent)
    assert not rig.sender.request_mode(Mode.CARRIER_ONLY).ok          # the old one-key route
    preview = rig.sender.prepare_carrier_only()
    assert not preview.ok and "arm switch is ARMED" in preview.problems[0]   # m1: radio still ARMED
    rig.ctl.set_channel_us(5, 1000)                                   # pilot sets the switch SAFE
    preview = rig.sender.prepare_carrier_only()
    assert preview.ok and preview.needs_landed_confirm
    res = rig.sender.confirm_carrier_only(preview.token, no_client_confirmed=True)
    assert not res.ok and "LANDED" in res.reasons[0]
    assert rig.slot(5) == [None] * 5 and len(rig.sent) == n          # no DISARM packet went out
    preview = rig.sender.prepare_carrier_only()
    assert rig.sender.confirm_carrier_only(preview.token, no_client_confirmed=True, landed_confirmed=True).ok
    assert rig.slot(1)[0].channels[4] == 172


def test_suspended_fpv_to_carrier_only_needs_landed(rig) -> None:
    rig.sender.request_mode(Mode.FPV)
    rig.slot(1)
    rig.ctl.disconnect()
    rig.slot(1)
    preview = rig.sender.prepare_carrier_only()
    assert preview.ok and preview.needs_landed_confirm
    assert not rig.sender.confirm_carrier_only(preview.token, no_client_confirmed=True).ok


def test_carrier_only_refused_while_streaming(rig) -> None:
    rig.sender.request_mode(Mode.FPV)
    preview = rig.sender.prepare_carrier_only()
    assert not preview.ok and any("idle" in p for p in preview.problems)
    assert rig.sender.state().mode is Mode.FPV


def test_carrier_only_to_fpv_needs_idle_first(rig) -> None:
    enter_carrier_only(rig)
    res = rig.sender.request_mode(Mode.FPV)
    assert not res.ok and "idle" in res.reasons[0]
    assert rig.sender.state().mode is Mode.CARRIER_ONLY
    assert rig.slot(1)[0] is not None                     # carrier-only keeps streaming


# --------------------------------------------------------------------------- unmapped arm/throttle (F7)

def test_unmapped_arm_or_throttle_refuses_every_start(rig) -> None:
    rig.ctl.unmap(5)                                      # arm channel has no input: reads centred
    res = rig.sender.request_mode(Mode.FPV)
    assert not res.ok and "arm channel CH5 has no input" in res.reasons[0]
    preview = rig.sender.prepare_resume()                 # 1500 us would otherwise look "not safe" = armed
    assert not preview.ok and any("CH5 has no input" in p for p in preview.problems)
    ctl2 = FakeController(clock=rig.clock)
    ctl2.unmap(3)                                         # throttle has no input
    s2 = Sender(rig.cfg, ctl2, rig.sent.append, clock=rig.clock)
    assert not s2.request_mode(Mode.FPV).ok
    assert rig.sent == []


def test_losing_the_arm_input_while_streaming_stops(rig) -> None:
    rig.sender.request_mode(Mode.FPV)
    assert rig.slot(1)[0] is not None
    rig.ctl.unmap(5)
    assert rig.slot(3) == [None] * 3
    assert rig.sender.state().suspended == SUSPEND_CONTROLLER


# --------------------------------------------------------------------------- RESUME value band (F9)

def test_resume_refused_when_values_moved_since_preview(rig) -> None:
    rig.ctl.set_channel_us(5, 2000)
    rig.ctl.set_channel_us(3, 1500)
    preview = rig.sender.prepare_resume()
    rig.ctl.set_channel_us(3, 1100)
    res = rig.sender.confirm_resume(preview.token)
    assert not res.ok and "values changed since the preview" in res.reasons[0] and rig.sent == []
    preview = rig.sender.prepare_resume()
    rig.ctl.set_channel_us(3, 1140)                       # within the 50 us band
    assert rig.sender.confirm_resume(preview.token).ok


# --------------------------------------------------------------------------- dead sender thread (F5)

def test_dead_sender_thread_is_detected() -> None:
    class BrokenWaiter:
        kind = "broken"

        def wait_until(self, deadline: float) -> None:
            raise RuntimeError("timer failed")

        def close(self) -> None:
            pass

    events: list[tuple[str, dict]] = []
    sender = Sender(Config(), FakeController(safe_channels()), lambda d: None, waiter_factory=BrokenWaiter,
                    on_event=lambda k, d: events.append((k, d)))
    assert sender.request_mode(Mode.FPV).ok
    sender.start()
    try:                                                  # WP18 R1: the thread is stopped whatever fails
        deadline = time.time() + 2
        while not sender.state().thread_dead and time.time() < deadline:
            time.sleep(0.01)
        st = sender.state()
        assert st.thread_dead and not st.streaming and st.suspended == SUSPEND_THREAD
        assert any(k == "suspended" and d["reason"] == SUSPEND_THREAD for k, d in events)
        assert not sender.request_mode(Mode.FPV).ok       # nothing can start any more
        assert not sender.check_alive()
    finally:
        sender.stop()


# --------------------------------------------------------------------------- camera flag, errors

def test_camera_flag(rig) -> None:
    enter_carrier_only(rig)
    assert rig.slot(1)[0].cam_enable is False             # default off
    rig.sender.set_camera_requested(True)
    assert rig.slot(1)[0].cam_enable is True
    assert ("camera", {"requested": True}) in rig.events


def test_send_error_keeps_running(rig) -> None:
    calls = []

    def flaky(data: bytes) -> None:
        calls.append(data)
        if len(calls) == 2:
            raise OSError("network unreachable")
    rig.sender._transmit = flaky
    rig.sender.request_mode(Mode.FPV)
    rig.slot(4)
    st = rig.sender.state()
    assert len(calls) == 4 and st.send_errors == 1 and st.packets_sent == 3 and st.streaming


def test_internal_error_suspends(rig) -> None:
    rig.sender.request_mode(Mode.FPV)
    rig.ctl.set_channels_us([1500] * 15)                  # broken snapshot: 15 channels
    assert rig.slot(3) == [None] * 3
    st = rig.sender.state()
    assert st.suspended == SUSPEND_INTERNAL and rig.sent == []


def test_seq_wraps(rig) -> None:
    rig.sender._seq = 0xFFFFFFFF
    rig.sender.request_mode(Mode.FPV)
    assert rig.slot(1)[0].seq == 0


# --------------------------------------------------------------------------- jitter statistics

def test_percentile_nearest_rank() -> None:
    v = sorted(range(1, 101))
    assert percentile(v, 0.5) == 50 and percentile(v, 0.99) == 99 and percentile(v, 1.0) == 100
    assert percentile([7], 0.99) == 7


def test_jitter_window() -> None:
    w = JitterWindow(0.0)
    for i in range(100):
        w.record(i / 1e5)                                # 0 .. 0.99 ms
    w.error()
    w.skipped(2)
    assert w.roll(0.5) is None
    st = w.roll(1.0)
    assert st.sent == 100 and st.send_errors == 1 and st.skipped_slots == 2
    assert st.p50_ms == pytest.approx(0.49) and st.p99_ms == pytest.approx(0.98) and st.max_ms == pytest.approx(0.99)
    assert st.rate_hz == pytest.approx(100)
    empty = w.roll(2.0)
    assert empty.sent == 0 and empty.p99_ms is None


def test_lateness_is_recorded_against_the_deadline(rig) -> None:
    rig.sender.request_mode(Mode.FPV)
    rig.clock.t = 200.0
    rig.sender.send_slot(200.0, 199.999)                 # sent 1 ms after its deadline
    st = rig.sender._window.roll(201.5)
    assert st.max_ms == pytest.approx(1.0)


# --------------------------------------------------------------------------- the real thread

def test_thread_rate_absolute_deadlines_and_stop() -> None:
    cfg = Config()
    sent: list[float] = []
    sender = Sender(cfg, FakeController(safe_channels()), lambda d: sent.append(time.perf_counter()))
    sender.start()
    try:
        t_req = time.perf_counter()
        assert sender.request_mode(Mode.FPV).ok
        time.sleep(1.2)
        n = len(sent)
        span_s = time.perf_counter() - t_req
        st = sender.state().stats
        diag = (f"{n} packets in {span_s:.3f} s; stats sent {st and st.sent}, skipped {st and st.skipped_slots}, "
                f"p99 {st and st.p99_ms} ms, max {st and st.max_ms} ms, waiter {sender.state().waiter}")
        assert n >= 200, diag                            # ~250 Hz (generous for a loaded CI box: ~400 ms of stalls)
        # WP19: the upper bound is exact for the time that really passed (it was "n <= 320" after a 1.2 s sleep:
        # 80 ms of late wake-up of this thread failed it).  Absolute deadlines never exceed the rate; after a stall
        # the loop catches up at most 2 slots (more are skipped), +1 for the slot in progress.
        assert n <= 250 * span_s + 3, diag
        # absolute deadlines: the long-run rate does not drift below the configured rate. 15 %: a shared CI VM
        # can deschedule the thread for tens of ms (WP10 R10b); a drifting (relative-sleep) loop shows up as a
        # rate well below 250 Hz over the whole span, and skipped slots are counted in the stats.
        span = sent[-1] - sent[0]
        assert (len(sent) - 1) / span == pytest.approx(250, rel=0.15), diag
        stats = sender.state().stats
        assert stats is not None and stats.p99_ms is not None and stats.sent > 0
        assert sender.state().waiter in ("high-res-timer", "timeBeginPeriod", "sleep")
    finally:
        sender.stop()
    n = len(sent)
    time.sleep(0.05)
    assert len(sent) == n                                # stop() means silence at once


# --------------------------------------------------------------------------- WP08a verification m1

def test_carrier_only_preview_says_unknown_since_app_start(rig) -> None:
    preview = rig.sender.prepare_carrier_only()
    assert preview.client_heard_s is None
    assert "UNKNOWN since app start" in preview.text() and "never" not in preview.text()
    rig.heard[0] = 42.0
    assert "42 s ago" in rig.sender.prepare_carrier_only().text()


def test_carrier_only_refused_while_connected_radio_is_armed(rig) -> None:
    rig.ctl.set_channel_us(5, 2000)                                   # arm switch ARMED, fresh app
    preview = rig.sender.prepare_carrier_only()
    assert not preview.ok and "arm switch is ARMED (CH5 = 2000 us)" in preview.problems[0]
    assert not rig.sender.confirm_carrier_only(preview.token, no_client_confirmed=True).ok
    assert rig.slot(3) == [None] * 3 and not rig.sent


def test_carrier_only_arm_switch_moved_to_armed_before_confirmation(rig) -> None:
    preview = rig.sender.prepare_carrier_only()
    assert preview.ok
    rig.ctl.set_channel_us(5, 2000)
    res = rig.sender.confirm_carrier_only(preview.token, no_client_confirmed=True)
    assert not res.ok and "ARMED" in res.reasons[0] and not rig.sent


def test_carrier_only_without_a_radio_still_possible(rig) -> None:
    rig.ctl.disconnect()                                              # carrier-only needs no controller
    preview = rig.sender.prepare_carrier_only()
    assert preview.ok
    assert rig.sender.confirm_carrier_only(preview.token, no_client_confirmed=True).ok


def test_late_count_in_stats(rig) -> None:
    """m2: the stats window counts packets later than alarms.send_late_max_ms."""
    from vtolgcs.sender import JitterWindow
    w = JitterWindow(0.0, late_threshold_s=0.002)
    for late in (0.0001, 0.0021, 0.005, 0.002):
        w.record(late)
    stats = w.roll(1.0)
    assert stats.late_count == 2 and stats.max_ms == 5.0


# --------------------------------------------------------------------------- stop gate (WP13 R4)

def test_begin_stop_refused_while_streaming_unless_confirmed(rig) -> None:
    assert rig.sender.request_mode(Mode.FPV).ok
    assert not rig.sender.begin_stop(stream_stop_confirmed=False)
    assert not rig.sender.stopping and rig.sender.state().streaming
    assert rig.sender.begin_stop(stream_stop_confirmed=True) and rig.sender.stopping


def test_no_start_of_any_kind_after_an_accepted_stop(rig) -> None:
    """The verifier's race: a RESUME prepared before the stop must not execute after it."""
    airborne(rig)
    preview = rig.sender.prepare_resume()
    assert preview.ok
    assert rig.sender.begin_stop(stream_stop_confirmed=False)                # idle: no word needed
    res = rig.sender.confirm_resume(preview.token)
    assert not res.ok and "stop was accepted" in res.reasons[0]
    assert "stop was accepted" in " ".join(rig.sender.prepare_resume().problems)
    rig.ctl.set_channel_us(5, 1000)
    rig.ctl.set_channel_us(3, 988)
    res = rig.sender.request_mode(Mode.FPV)
    assert not res.ok and "stop was accepted" in res.reasons[0]
    co = rig.sender.prepare_carrier_only()
    assert not co.ok and not rig.sender.confirm_carrier_only(co.token, no_client_confirmed=True).ok
    assert rig.sender.request_mode(Mode.IDLE).ok                             # stopping is always allowed
    assert rig.slot(5) == [None] * 5 and rig.sent == []


def test_stop_and_resume_race_never_both_succeed() -> None:
    """Concurrent stop (no word) and RESUME confirmation: exactly one wins, never both (R4)."""
    import threading
    for _ in range(200):
        cfg = Config()
        ctl = FakeController()
        ctl.set_channel_us(5, 2000)
        ctl.set_channel_us(3, 1400)
        sender = Sender(cfg, ctl, lambda data: None)
        preview = sender.prepare_resume()
        assert preview.ok
        go = threading.Barrier(2)
        out: dict[str, bool] = {}

        def resume() -> None:
            go.wait()
            out["resume"] = sender.confirm_resume(preview.token).ok

        def stop() -> None:
            go.wait()
            out["stop"] = sender.begin_stop(stream_stop_confirmed=False)
        threads = [threading.Thread(target=resume), threading.Thread(target=stop)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(5)
        assert out["resume"] != out["stop"], out
        assert sender.state().streaming == out["resume"]


def test_accepted_seq_is_taken_at_the_accept(rig) -> None:
    """start_timing counts packets from the accept, even if one is sent before the mode callback runs."""
    rig.slot(1)
    seq0 = rig.sender.state().seq
    assert rig.sender.request_mode(Mode.FPV).ok and rig.sender.accepted_seq() == seq0
    rig.slot(3)
    assert rig.sender.accepted_seq() == seq0 and rig.sender.state().seq == seq0 + 3
