"""Alarm engine (raise/clear, severity, since, hysteresis) and every rule (brief R8)."""

from __future__ import annotations

import dataclasses
from datetime import datetime, timezone
from pathlib import Path

import pytest

from vtolgcs.alarms import (ALARM_DEFS, ALARMS, AlarmDef, AlarmEngine, RttRiseDetector, RuleInputs, alarm_defs,
                            evaluate_rules)
from vtolgcs.config import AlarmConfig

CFG = AlarmConfig()
README = Path(__file__).resolve().parents[1] / "README.md"

#: A healthy FPV stream: no alarm condition true.
OK = RuleInputs(
    mode="fpv", streaming=True, suspended=False, sender_dead=False, controller_connected=True,
    status_silence_s=0.05, bridge_state="RUN", rtt_ms=40.0, late_max_ms=0.6, skipped_slots=0, camera_requested=False, camera_reported=False,
    telemetry_silence_s=0.1, telemetry_relevant=True, lq_pct=99, cell_v=3.9, sats=12, client_failsafe=False,
    client_rth=False, client_rescue_not_ready=False, rtt_rising=False, on_battery=False, battery_saver=False)


def active(inp: RuleInputs, cfg: AlarmConfig = CFG) -> set[str]:
    return {k for k, v in evaluate_rules(inp, cfg).items() if v}


def test_healthy_inputs_raise_nothing() -> None:
    assert active(OK) == set()
    assert set(evaluate_rules(OK, CFG)) == set(ALARMS)          # every rule is evaluated


@pytest.mark.parametrize("change, alarm", [
    ({"suspended": True, "streaming": False}, "rc_stream_stopped"),
    ({"controller_connected": False}, "controller_disconnected"),
    ({"status_silence_s": 0.301}, "bridge_no_status"),
    ({"bridge_state": "FAILSAFE"}, "bridge_not_run"),
    ({"bridge_state": "WAIT_GCS"}, "bridge_not_run"),
    ({"client_failsafe": True}, "client_failsafe"),
    ({"client_rth": True}, "client_rth"),
    ({"telemetry_silence_s": 2.01}, "client_telemetry_stale"),
    ({"lq_pct": 69}, "client_link_weak"),
    ({"cell_v": 3.49}, "client_batt_low"),
    ({"sats": 7}, "client_sats_low"),
    ({"client_rescue_not_ready": True}, "client_rescue_not_ready"),
    ({"late_max_ms": 2.01}, "send_jitter_high"),
    ({"skipped_slots": 1}, "send_jitter_high"),
    ({"sender_dead": True}, "rc_sender_dead"),
    ({"camera_requested": True}, "camera_mismatch"),
    ({"rtt_rising": True}, "rtt_rising_camera"),
    ({"on_battery": True}, "gcs_on_battery"),
    ({"battery_saver": True}, "gcs_battery_saver"),
])
def test_each_rule(change: dict, alarm: str) -> None:
    assert active(dataclasses.replace(OK, **change)) == {alarm}


def test_thresholds_are_strict() -> None:
    assert active(dataclasses.replace(OK, status_silence_s=0.300, lq_pct=70, cell_v=3.50, sats=8,
                                      telemetry_silence_s=2.0, late_max_ms=2.0)) == set()


def test_rtt_rule_needs_a_configured_threshold() -> None:
    slow = dataclasses.replace(OK, rtt_ms=500.0)
    assert active(slow) == set()                                 # rtt_max_ms is TBD (null) by default
    assert active(slow, AlarmConfig(rtt_max_ms=250)) == {"rtt_high"}


def test_stream_rules_inactive_when_idle() -> None:
    idle = dataclasses.replace(OK, mode="idle", streaming=False, status_silence_s=None, bridge_state=None,
                               late_max_ms=9.0, skipped_slots=3, camera_requested=True, telemetry_silence_s=None,
                               telemetry_relevant=False, lq_pct=10, client_failsafe=True)
    assert active(idle) == set()


def test_unknown_values_raise_nothing() -> None:
    unknown = dataclasses.replace(OK, lq_pct=None, cell_v=None, sats=None, camera_reported=None, rtt_ms=None,
                                  late_max_ms=None, on_battery=None, battery_saver=None)
    assert active(unknown) == set()


def test_controller_not_needed_in_carrier_only() -> None:
    co = dataclasses.replace(OK, mode="carrier_only", controller_connected=False, telemetry_silence_s=None)
    assert active(co) == set()


def test_camera_mismatch_only_while_bridge_streams() -> None:
    assert active(dataclasses.replace(OK, camera_requested=True, bridge_state="WAIT_GCS")) == {"bridge_not_run"}


# --------------------------------------------------------------------------- engine

class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def engine(defs: tuple[AlarmDef, ...]) -> tuple[AlarmEngine, Clock, list[dict]]:
    clock = Clock()
    wall = datetime(2026, 10, 16, 12, 0, 0, tzinfo=timezone.utc)
    eng = AlarmEngine(defs, clock, lambda: wall)
    events: list[dict] = []
    eng.add_listener(events.append)
    return eng, clock, events


def test_raise_and_clear_with_hysteresis() -> None:
    eng, clock, events = engine((AlarmDef("x", "warn", "X", raise_after_s=1.0, clear_after_s=2.0),))
    eng.update({"x": True})
    clock.t = 0.9
    eng.update({"x": True})
    assert eng.active() == []                                  # not long enough yet
    clock.t = 1.0
    eng.update({"x": True})
    assert eng.active() == [{"id": "x", "severity": "warn", "text": "X", "since": "2026-10-16T12:00:00.000Z"}]
    assert events == [{"id": "x", "severity": "warn", "text": "X", "since": "2026-10-16T12:00:00.000Z",
                       "active": True}]
    clock.t = 1.5
    eng.update({"x": False})
    clock.t = 3.0
    eng.update({"x": True})                                    # flicker back: stays active, no new event
    clock.t = 3.4
    eng.update({"x": False})
    clock.t = 5.3
    eng.update({"x": False})
    assert eng.is_active("x")
    clock.t = 5.4
    eng.update({"x": False})
    assert not eng.is_active("x") and events[-1]["active"] is False and len(events) == 2


def test_condition_flicker_does_not_raise() -> None:
    eng, clock, events = engine((AlarmDef("x", "warn", "X", raise_after_s=1.0),))
    for i in range(20):
        clock.t = i * 0.3
        eng.update({"x": i % 3 != 2})                          # never true for a full second
    assert events == []


def test_active_sorted_crit_first() -> None:
    eng, clock, _ = engine(ALARM_DEFS)
    eng.update({"gcs_on_battery": True, "client_failsafe": True, "rc_stream_stopped": True})
    assert [a["id"] for a in eng.active()] == ["rc_stream_stopped", "client_failsafe", "gcs_on_battery"]
    assert all(set(a) == {"id", "severity", "text", "since"} for a in eng.active())


def test_camera_mismatch_delay_from_config() -> None:
    eng, clock, events = engine(alarm_defs(AlarmConfig(camera_mismatch_s=1.0)))
    eng.update({"camera_mismatch": True})
    clock.t = 0.99
    eng.update({"camera_mismatch": True})
    assert not eng.is_active("camera_mismatch")
    clock.t = 1.0
    eng.update({"camera_mismatch": True})
    assert eng.is_active("camera_mismatch")


def test_alarm_ids_and_texts_are_documented() -> None:
    text = README.read_text(encoding="utf-8")
    for d in ALARM_DEFS:
        assert f"`{d.id}`" in text and d.text in text, d.id


def test_plan_callouts_used_as_texts() -> None:
    assert ALARMS["client_failsafe"].text == "FPV FAILSAFE" and ALARMS["client_rth"].text == "FPV RTH"
    assert ALARMS["client_link_weak"].text == "FPV LINK WEAK" and ALARMS["client_batt_low"].text == "FPV BATT LOW"
    assert ALARMS["client_sats_low"].text == "FPV SATS LOW"
    assert ALARMS["client_telemetry_stale"].text == "FPV TELEMETRY LOST"


# --------------------------------------------------------------------------- RTT rising after camera on

def feed(det: RttRiseDetector, t0: float, values: list[float], step: float = 0.1) -> float:
    t = t0
    for v in values:
        det.add_sample(t, v)
        t += step
    return t


def test_rtt_rise_default_criterion() -> None:
    det = RttRiseDetector(window_s=5.0)
    t = feed(det, 0.0, [40 + (i % 5) for i in range(50)])      # baseline 40..44 ms, p99 = 44
    assert det.evaluate(t, False) is False
    assert det.evaluate(t, True) is False                      # edge: baseline captured
    t = feed(det, t, [43] * 10)
    assert det.evaluate(t, True) is False                      # median 43 <= 44
    t = feed(det, t, [60] * 20)
    assert det.evaluate(t, True) is True
    assert det.evaluate(t, False) is False                     # camera off: rule resets


def test_rtt_rise_configured_delta() -> None:
    det = RttRiseDetector(window_s=5.0, rise_ms=10.0)
    t = feed(det, 0.0, [40.0] * 30)
    det.evaluate(t, True)
    t = feed(det, t, [49.0] * 10)
    assert det.evaluate(t, True) is False
    t = feed(det, t, [51.0] * 20)
    assert det.evaluate(t, True) is True


def test_rtt_rise_needs_samples_on_both_sides() -> None:
    det = RttRiseDetector(window_s=5.0)
    t = feed(det, 0.0, [40.0] * 3)                             # too few before the edge
    det.evaluate(t, True)
    t = feed(det, t, [90.0] * 20)
    assert det.evaluate(t, True) is False
