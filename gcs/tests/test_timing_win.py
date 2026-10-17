"""Waiter, single-instance lock and Windows power helpers (brief R3/R4)."""

from __future__ import annotations

import sys
import time
import uuid

import pytest

from vtolgcs import timing_win as T


@pytest.mark.parametrize("prefer_high_res", [True, False])
def test_waiter_never_returns_early(prefer_high_res: bool) -> None:
    with T.Waiter(prefer_high_res) as w:
        if sys.platform == "win32":
            assert w.kind == ("high-res-timer" if prefer_high_res else "timeBeginPeriod")
        late = []
        deadline = time.perf_counter()
        for _ in range(50):
            deadline += 0.004
            w.wait_until(deadline)
            now = time.perf_counter()
            assert now >= deadline
            late.append(now - deadline)
        # loose bound only (no flaky timing; WP10 R10b: CI runners are shared VMs): "never early" above is the
        # property; a gross failure (a wait that ignores the deadline) would be far beyond 250 ms
        assert max(late) < 0.25, f"worst {max(late) * 1000:.1f} ms late, {w.kind}, late ms {[round(x * 1000, 1) for x in late]}"


def test_waiter_past_deadline_returns_at_once() -> None:
    with T.Waiter() as w:
        t0 = time.perf_counter()
        w.wait_until(t0 - 1.0)
        took = time.perf_counter() - t0
        assert took < 0.25, f"a past deadline still waited {took * 1000:.1f} ms ({w.kind})"   # it would wait ~1 s


def test_single_instance_lock() -> None:
    name = f"vtol-gcs-test-{uuid.uuid4().hex}"
    first = T.SingleInstance(name).acquire()
    try:
        with pytest.raises(T.AlreadyRunning):
            T.SingleInstance(name).acquire()
    finally:
        first.release()
    with T.SingleInstance(name):                       # free again after release
        pass


@pytest.mark.skipif(sys.platform != "win32", reason="Windows API")
def test_power_status_and_keep_awake() -> None:
    ps = T.power_status()
    assert ps.on_battery in (True, False, None) and ps.battery_saver in (True, False, None)
    assert T.keep_awake(True) is True
    assert T.keep_awake(False) is True
    assert T.set_thread_priority_high() is True
