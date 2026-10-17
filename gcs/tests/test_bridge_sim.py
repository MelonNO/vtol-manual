"""Tests for gcs/tools/bridge_sim.py.

Two layers:

* ``BridgeCore`` / ``ClientSim`` driven with an injected (fake) clock — exact,
  deterministic state-machine checks;
* the UDP front-end on localhost with a real test client — integration checks
  with generous time margins (conditions are polled for up to several seconds).
"""

from __future__ import annotations

import contextlib
import ipaddress
import socket
import threading
import time
from typing import Callable

import pytest

import bridge_sim as BS
from vtolgcs import crsf as C
from vtolgcs import protocol as P
from vtolgcs.protocol import BridgeState, RcUp, Status

SRC = ("127.0.0.1", 40000)
CENTRED = tuple(P.centred_channels())
ARMED = tuple([992, 992, 172, 992, 1811] + [172] * 11)


RAW_EXTREMES = tuple([0, 2047] * 8)               # legal 11-bit CRSF, outside the strict sender range


def rc(seq: int, cam: bool = False, chans: tuple[int, ...] = CENTRED, t: int | None = None) -> bytes:
    return RcUp(seq & 0xFFFFFFFF, (seq * 4000) & 0xFFFFFFFF if t is None else t, chans,
                cam_enable=cam).pack(strict=False)


class Feeder:
    """Drives a BridgeCore with a fake clock and a 4 ms rc_up stream."""

    def __init__(self, **cfg: object) -> None:
        self.t = 0.0
        self.core = BS.BridgeCore(BS.BridgeConfig(seed=1, **cfg), self.t)
        self.seq = 0

    def advance(self, dt: float) -> None:
        self.t += dt
        self.core.tick(self.t)

    def boot(self) -> None:
        self.advance(self.core.cfg.boot_s + 0.001)
        assert self.core.state == BridgeState.WAIT_GCS

    def send(self, n: int = 1, cam: bool = False, chans: tuple[int, ...] = CENTRED, dt: float = 0.004) -> None:
        for _ in range(n):
            self.seq += 1
            self.core.on_datagram(rc(self.seq, cam, chans), SRC, self.t)
            self.advance(dt)

    def stream(self, seconds: float, **kw: object) -> None:
        self.send(int(seconds / 0.004), **kw)


# =========================================================================== core: state machine

def test_boot_then_wait_gcs_and_packets_ignored_in_boot() -> None:
    f = Feeder()
    f.core.on_datagram(rc(1), SRC, 0.0)
    assert f.core.state == BridgeState.BOOT and f.core.rx_ok == 0
    f.boot()


def test_four_packets_stay_in_wait_gcs() -> None:
    f = Feeder()
    f.boot()
    f.send(4)
    f.advance(0.05)
    assert f.core.state == BridgeState.WAIT_GCS and not f.core.visited(BridgeState.START)
    assert f.core.crsf_tx == 0                       # no CRSF before START


def test_five_packets_start_modelid_x3_then_run() -> None:
    f = Feeder(model_id=17)
    f.boot()
    f.send(5)
    f.advance(0.02)
    assert [s for _, _, s in f.core.transitions] == [BridgeState.WAIT_GCS, BridgeState.START, BridgeState.RUN]
    assert [fr for _, fr in f.core.model_id_frames] == [C.build_model_id_frame(17)] * 3
    assert f.core.state == BridgeState.RUN


def test_run_sends_rc_frames_of_latest_channels() -> None:
    f = Feeder()
    f.boot()
    f.stream(0.2, chans=ARMED)
    assert f.core.state == BridgeState.RUN
    assert f.core.last_rc_frame == C.build_rc_channels_frame(ARMED)
    # ~250 Hz slots for ~0.2 s, minus the WAIT_GCS part
    assert 30 < f.core.crsf_tx < 60


@pytest.mark.parametrize("chans", [RAW_EXTREMES, tuple([0] * 16), tuple([2047] * 16)],
                         ids=["0_2047", "all_0", "all_2047"])
def test_run_forwards_any_11bit_channel_value_unchanged(chans: tuple[int, ...]) -> None:
    """Verifier F1: CRC-valid rc_up with values outside 172..1811 must not crash; the 22 ch
    bytes go into the CRSF frame unchanged, as the G0 does."""
    f = Feeder()
    f.boot()
    f.stream(0.1, chans=chans)
    assert f.core.state == BridgeState.RUN
    packed = P.pack_channels(chans, strict=False)
    assert f.core.last_rc_frame == C.build_rc_channels_frame_raw(packed)
    assert list(C.decode_rc_channels(C.parse_frame(f.core.last_rc_frame))) == list(chans)
    f.stream(0.1)                                     # back to normal values: still fine
    assert f.core.last_rc_frame == C.build_rc_channels_frame(CENTRED)


def test_failsafe_after_t_hold_not_before() -> None:
    f = Feeder()
    f.boot()
    f.stream(0.1)
    last = f.core.last_valid_time
    f.advance(0.24)
    assert f.core.state == BridgeState.RUN
    f.advance(0.03)
    assert f.core.visited(BridgeState.FAILSAFE) and f.core.state == BridgeState.WAIT_GCS
    t_fs = [t for t, _, s in f.core.transitions if s == BridgeState.FAILSAFE][0]
    assert 0.25 <= t_fs - last <= 0.25 + f.core.crsf_period + 1e-9
    before = f.core.crsf_tx
    f.advance(1.0)
    assert f.core.crsf_tx == before                   # CRSF silent after FAILSAFE


def test_custom_t_hold() -> None:
    f = Feeder(t_hold_s=1.0)
    f.boot()
    f.stream(0.1)
    f.advance(0.9)
    assert f.core.state == BridgeState.RUN
    f.advance(0.2)
    assert f.core.visited(BridgeState.FAILSAFE)


def test_bad_crc_counted_and_breaks_consecutive_count() -> None:
    f = Feeder()
    f.boot()
    f.send(3)
    bad = bytearray(rc(99))
    bad[20] ^= 1
    f.core.on_datagram(bytes(bad), SRC, f.t)
    f.send(2)
    assert f.core.rx_bad_crc == 1 and f.core.state == BridgeState.WAIT_GCS
    f.send(3)
    f.advance(0.02)
    assert f.core.state == BridgeState.RUN


def test_wrong_version_and_magic_counted_as_format_errors() -> None:
    f = Feeder()
    f.boot()
    body = b"RC\x02" + rc(1)[3:-2]
    f.core.on_datagram(body + P.crc16_ccitt_false(body).to_bytes(2, "little"), SRC, f.t)
    f.core.on_datagram(b"XX" + rc(1)[2:], SRC, f.t)
    f.core.on_datagram(rc(1)[:30], SRC, f.t)
    assert f.core.rx_bad_crc == 3 and f.core.rx_ok == 0


def test_seq_must_increase() -> None:
    f = Feeder()
    f.boot()
    f.stream(0.1)
    ok = f.core.rx_ok
    for seq in (f.seq, f.seq - 1, f.seq - 1000):
        f.core.on_datagram(rc(seq), SRC, f.t)
    assert f.core.rx_bad_seq == 3 and f.core.rx_ok == ok
    f.core.on_datagram(rc(f.seq + 10), SRC, f.t)      # gaps (UDP loss) are fine
    assert f.core.rx_ok == ok + 1


def test_seq_wraps_around() -> None:
    f = Feeder()
    f.boot()
    f.seq = 0xFFFFFFFD
    f.send(5)
    f.advance(0.02)
    assert f.core.state == BridgeState.RUN and f.core.rx_bad_seq == 0 and f.core.last_seq < 5


def test_new_gcs_session_rebaselines_seq_after_failsafe() -> None:
    f = Feeder()
    f.boot()
    f.seq = 100000
    f.stream(0.1)
    f.advance(0.5)                                     # FAILSAFE -> WAIT_GCS
    f.seq = 0                                          # GCS app restarted: seq starts again
    f.send(5)
    f.advance(0.02)
    assert f.core.state == BridgeState.RUN
    assert [s for _, _, s in f.core.transitions].count(BridgeState.RUN) == 2


def test_stale_partial_start_sequence_is_reset() -> None:
    f = Feeder()
    f.boot()
    f.send(4)
    f.advance(0.3)                                     # gap > T_hold
    f.send(1)
    assert f.core.state == BridgeState.WAIT_GCS
    f.send(4)
    f.advance(0.02)
    assert f.core.state == BridgeState.RUN


def test_source_ip_filter() -> None:
    f = Feeder(allowed_src=(ipaddress.ip_network("192.168.144.0/24"),))
    f.boot()
    for seq in range(1, 8):
        f.core.on_datagram(rc(seq), ("10.0.0.5", 5000), f.t)
    assert f.core.rx_ok == 0 and f.core.rx_bad_src == 7 and f.core.reply_addr is None
    for seq in range(1, 6):
        f.core.on_datagram(rc(seq), ("192.168.144.100", 5000), f.t)
    f.advance(0.02)
    assert f.core.state == BridgeState.RUN and f.core.reply_addr == ("192.168.144.100", 5000)


def test_reply_address_follows_latest_valid_sender() -> None:
    f = Feeder()
    f.boot()
    f.send(5)
    f.core.on_datagram(rc(f.seq + 1), ("127.0.0.1", 50001), f.t)
    assert f.core.reply_addr == ("127.0.0.1", 50001)
    f.core.on_datagram(b"garbage", ("127.0.0.1", 50002), f.t)
    assert f.core.reply_addr == ("127.0.0.1", 50001)


# =========================================================================== core: camera policies

def test_camera_design_policy() -> None:
    f = Feeder(camera_policy="design")
    assert not f.core.cam_register                    # default off at power-up
    f.boot()
    f.send(4, cam=True)
    assert not f.core.cam_register                    # stream not established yet
    f.send(1, cam=True)
    f.advance(0.02)
    assert f.core.state == BridgeState.RUN and f.core.cam_register
    f.send(1, cam=False)
    assert not f.core.cam_register                    # applied within one packet
    f.send(1, cam=True)
    assert f.core.cam_register
    f.advance(0.3)                                    # stream lost
    assert f.core.visited(BridgeState.FAILSAFE) and not f.core.cam_register


def test_camera_client_gated_policy() -> None:
    f = Feeder(camera_policy="client-gated")
    assert f.core.cam_register                        # no stream since boot: carrier-only -> ON
    f.boot()
    f.send(4, cam=False)
    assert f.core.cam_register                        # still no stream established
    f.send(1, cam=False)
    f.advance(0.02)
    assert f.core.state == BridgeState.RUN and not f.core.cam_register   # follows CAM_ENABLE
    f.send(1, cam=True)
    assert f.core.cam_register
    f.advance(0.3)                                    # loss after having run -> OFF
    assert f.core.state == BridgeState.WAIT_GCS and not f.core.cam_register
    f.send(5, cam=True)
    f.advance(0.02)
    assert f.core.state == BridgeState.RUN and f.core.cam_register     # new stream: follows again


@pytest.mark.parametrize("fault,expected", [("stuck-off", False), ("stuck-on", True)])
def test_camera_readback_reports_register_not_command(fault: str, expected: bool) -> None:
    f = Feeder(cam_fault=fault)
    f.boot()
    f.send(6, cam=not expected)
    f.advance(0.01)
    assert f.core.cam_command is (not expected) and f.core.cam_register is expected
    assert f.core.build_status(f.t).camera_on_readback is expected


# =========================================================================== core: status content

def test_status_fields() -> None:
    f = Feeder(elrs_rate_hz=200.0, timing_lock_s=0.3)
    f.boot()
    assert f.core.build_status(f.t).sync_period_x10us == 0
    f.stream(0.1, cam=True)
    st = f.core.build_status(f.t)
    assert st.state == BridgeState.RUN and st.t_gcs_us_echo == f.seq * 4000
    assert st.rx_ok == f.seq and st.crsf_tx == f.core.crsf_tx and st.p2_link_100fd
    assert st.sync_period_x10us == 50000 and not st.timing_locked
    f.stream(0.4)
    st2 = f.core.build_status(f.t)
    assert st2.timing_locked and abs(st2.sync_offset_x10us) < abs(f.core._offset0)
    assert st2.seq == st.seq + 1
    assert Status.unpack(st2.pack()) == st2


def test_pending_states_include_transient_failsafe() -> None:
    f = Feeder()
    f.boot()
    f.stream(0.1)
    f.core.pending_states.clear()
    f.advance(0.3)
    assert f.core.pending_states == [BridgeState.FAILSAFE, BridgeState.WAIT_GCS]
    assert f.core.build_status(f.t, BridgeState.FAILSAFE).state == BridgeState.FAILSAFE


# =========================================================================== client model

def _client(**kw: object) -> BS.ClientSim:
    cfg = dict(gps_fix_delay_s=0.0, fs_delay_s=1.0, rth_delay_s=2.0, recover_s=0.5, seed=1)
    cfg.update(kw)
    return BS.ClientSim(BS.ClientConfig(**cfg), 0.0)


def _run(c: BS.ClientSim, t0: float, t1: float, rc_ok: bool, chans: tuple[int, ...]) -> float:
    t = t0
    while t < t1:
        t += 0.05
        c.update(t, rc_ok, chans)
    return t


def test_client_flight_mode_sequence() -> None:
    c = _client(gps_fix_delay_s=1.0)
    assert c.flight_mode() == "ANGL?"                 # rescue configured, no fix yet
    t = _run(c, 0, 1.2, True, CENTRED)
    assert c.flight_mode() == "ANGL*"
    t = _run(c, t, t + 0.2, True, ARMED)
    assert c.flight_mode() == "ANGL" and c.armed
    t = _run(c, t, t + 0.9, False, ARMED)
    assert c.flight_mode() == "ANGL"                  # within the failsafe delay
    t = _run(c, t, t + 0.3, False, ARMED)
    assert c.flight_mode() == "!FS!"
    t = _run(c, t, t + 2.1, False, ARMED)
    assert c.flight_mode() == "RTH"
    t = _run(c, t, t + 0.7, True, ARMED)
    assert c.flight_mode() == "ANGL"                  # RC back -> pilot control
    t = _run(c, t, t + 0.2, True, CENTRED)
    assert c.flight_mode() == "ANGL*"


def test_client_disarmed_rx_loss_is_arming_disabled() -> None:
    c = _client()
    t = _run(c, 0, 1.5, False, CENTRED)
    assert c.flight_mode() == "ANGL!"
    assert C.interpret_flight_mode(c.flight_mode()).arming_disabled
    _run(c, t, t + 0.2, True, ARMED)
    assert c.armed is False                           # arm switch high while '!' does not arm
    _run(c, t + 0.2, t + 0.4, True, CENTRED)
    _run(c, t + 0.4, t + 0.6, True, ARMED)
    assert c.armed


def test_client_moves_drains_battery_and_lq_falls_with_distance() -> None:
    c = _client(radius_m=300, carrier_offset_m=300, range_m=1000)
    lat0, lon0 = c.latlon()
    v0 = c.battery().voltage_v
    lqs = []
    t = 0.0
    t = _run(c, t, 0.2, True, CENTRED)               # arm switch low first
    for _ in range(200):                              # 100 s: most of the 300 m circle
        t = _run(c, t, t + 0.5, True, ARMED)
        lqs.append((c.distance_to_carrier(), c.link_stats().lq_pct))
    assert c.latlon() != (lat0, lon0) and c.gps().gspd_kmh == pytest.approx(54, abs=1)
    assert c.battery().voltage_v < v0 and c.battery().used_mah > 0
    near = [lq for d, lq in lqs if d < 200]
    far = [lq for d, lq in lqs if d > 450]
    assert near and far and min(near) > max(far)


def test_client_telemetry_frames_decode() -> None:
    c = _client()
    seen: set[str] = set()
    for _ in range(10):
        for raw in c.telemetry_frames():
            obj = C.decode_frame(C.parse_frame(raw))
            seen.add(type(obj).__name__)
    assert seen == {"LinkStatistics", "FlightMode", "Gps", "Battery", "Attitude", "Vario", "BaroAltitude"}


def test_fake_module_parameter_protocol() -> None:
    m = BS.FakeModule()
    (info_raw,) = m.handle(C.parse_frame(C.build_device_ping()))
    info = C.decode_frame(C.parse_frame(info_raw))
    assert isinstance(info, C.DeviceInfo) and info.is_elrs and info.field_count == len(m.params)
    asm = C.ParameterAssembler()
    entry = None
    while entry is None:
        (raw,) = m.handle(C.parse_frame(C.build_param_read(1, asm.next_chunk)))
        entry = asm.feed(C.decode_frame(C.parse_frame(raw)))
    assert entry.name == "Packet Rate" and entry.value_label == "250Hz"
    m.handle(C.parse_frame(C.build_param_write(1, C.encode_param_value(entry.type, 3))))
    assert m.params[1].value == 3


# =========================================================================== UDP integration

class TestClient:
    """Minimal GCS: sends rc_up, collects status and crsf_fwd in a thread."""

    __test__ = False

    def __init__(self, bridge: tuple[str, int], sim: BS.BridgeSim | None = None) -> None:
        self.bridge = bridge
        self.sim = sim
        self.t0 = time.perf_counter()
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        BS._disable_udp_connreset(self.sock)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.settimeout(0.05)
        self.statuses: list[tuple[float, Status]] = []
        self.frames: list[C.CrsfFrame] = []
        self.parser = C.CrsfParser()
        self.seq = 0
        self.lock = threading.Lock()
        self._stop = threading.Event()
        self._rx = threading.Thread(target=self._loop, name="test-client-rx", daemon=True)
        self._rx.start()
        self._tx: threading.Thread | None = None
        self.streaming = threading.Event()
        self.cam = False
        self.chans = CENTRED

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                data, _ = self.sock.recvfrom(4096)
            except (socket.timeout, OSError):
                continue
            msg = P.decode(data)
            with self.lock:
                if isinstance(msg, Status):
                    self.statuses.append((time.perf_counter(), msg))
                elif isinstance(msg, P.CrsfFwd):
                    self.frames += self.parser.feed(msg.frame)

    def send(self, n: int = 1, gap: float = 0.004) -> None:
        for _ in range(n):
            self.seq += 1
            t_us = int(time.perf_counter() * 1e6) & 0xFFFFFFFF
            self.sock.sendto(RcUp(self.seq, t_us, self.chans, cam_enable=self.cam).pack(strict=False),
                             self.bridge)
            time.sleep(gap)

    def start_stream(self) -> None:
        self.streaming.set()

        def run() -> None:
            while self.streaming.is_set() and not self._stop.is_set():
                self.send(1, 0.005)
        self._tx = threading.Thread(target=run, name="test-client-tx", daemon=True)
        self._tx.start()

    def stop_stream(self) -> None:
        self.streaming.clear()
        if self._tx:
            self._tx.join(timeout=2)

    def wait(self, cond: Callable[[], bool], timeout: float = 5.0) -> bool:
        end = time.perf_counter() + timeout
        while time.perf_counter() < end:
            with self.lock:
                if cond():
                    return True
            time.sleep(0.01)
        return False

    def diagnostics(self) -> str:
        """Everything needed to understand a timed-out wait (verifier F2)."""
        with self.lock:
            seq = [s.state.name for _, s in self.statuses]
            runs = [x for i, x in enumerate(seq) if i == 0 or seq[i - 1] != x]
            last = self.statuses[-1] if self.statuses else None
            modes = [o.text for o in (C.decode_frame(f) for f in self.frames) if isinstance(o, C.FlightMode)]
            mode_runs = [x for i, x in enumerate(modes) if i == 0 or modes[i - 1] != x]
            lines = [f"elapsed {time.perf_counter() - self.t0:.2f}s, sent {self.seq} rc_up, "
                     f"streaming={self.streaming.is_set()}, cam={self.cam}",
                     f"{len(seq)} status: state runs {runs}",
                     f"last status (+{last[0] - self.t0:.2f}s): {last[1]}" if last else "no status received",
                     f"{len(self.frames)} CRSF frames, flight-mode runs {mode_runs}"]
        if self.sim is not None:
            with self.sim.lock:
                core = self.sim.core
                thread = self.sim._thread
                lines.append(f"sim: state {core.state.name}, transitions "
                             f"{[(round(t - self.t0, 3), a.name, b.name) for t, a, b in core.transitions]}, "
                             f"rx_ok {core.rx_ok} bad_crc {core.rx_bad_crc} bad_seq {core.rx_bad_seq} "
                             f"bad_src {core.rx_bad_src}, reply {core.reply_addr}, "
                             f"queued {dict(self.sim.sent_counts)}, "
                             f"thread alive {thread.is_alive() if thread else None}")
        return "\n  ".join(lines)

    def expect(self, cond: Callable[[], bool], what: str = "", timeout: float = 8.0) -> None:
        """Wait for ``cond``; on timeout fail with a full diagnostic dump."""
        if not self.wait(cond, timeout):
            raise AssertionError(f"timed out after {timeout}s waiting for {what or 'condition'}:\n  "
                                 + self.diagnostics())

    def states(self) -> list[BridgeState]:
        return [s.state for _, s in self.statuses]

    def last(self) -> Status:
        return self.statuses[-1][1] if self.statuses else Status(BridgeState.BOOT, 0, 0)

    def close(self) -> None:
        self.stop_stream()
        self._stop.set()
        self._rx.join(timeout=2)
        self.sock.close()


def _sim(**kw: object) -> BS.BridgeSim:
    bridge = kw.pop("bridge", BS.BridgeConfig(boot_s=0.05, seed=1))
    client = BS.ClientConfig(gps_fix_delay_s=0.0, fs_delay_s=0.3, rth_delay_s=0.3, seed=1)
    return BS.BridgeSim(BS.SimConfig(port=0, bridge=bridge, client=client, seed=1, **kw))  # type: ignore[arg-type]


@pytest.fixture
def udp():
    with contextlib.ExitStack() as parts:             # WP18 R1: all stopped, also when a test fails or a stop raises

        def make(**kw: object) -> tuple[BS.BridgeSim, TestClient]:
            sim = _sim(**kw)
            parts.callback(sim.stop)
            sim.start()
            time.sleep(0.1)                           # past BOOT
            cli = TestClient(sim.address, sim)
            parts.callback(cli.close)
            return sim, cli
        yield make


def test_udp_wait_gcs_to_run_and_failsafe(udp) -> None:
    sim, cli = udp()
    cli.start_stream()
    cli.expect(lambda: BridgeState.RUN in cli.states(), "RUN status")
    with sim.lock:
        assert sim.core.visited(BridgeState.START) and len(sim.core.model_id_frames) == 3
    cli.stop_stream()
    cli.expect(lambda: BridgeState.FAILSAFE in cli.states(), "FAILSAFE status")
    cli.expect(lambda: cli.last().state == BridgeState.WAIT_GCS)
    i_run = cli.states().index(BridgeState.RUN)
    i_fs = cli.states().index(BridgeState.FAILSAFE)
    assert i_run < i_fs
    # FAILSAFE is reported no earlier than T_hold after the last packet (generous upper bound)
    t_fs = [t for t, s in cli.statuses if s.state == BridgeState.FAILSAFE][0]
    t_last_run = max(t for t, s in cli.statuses if s.state == BridgeState.RUN)
    assert t_fs - t_last_run < 2.0


def test_udp_four_packets_do_not_start(udp) -> None:
    sim, cli = udp()
    cli.send(4)
    cli.expect(lambda: len(cli.statuses) >= 2)   # status goes to the (valid) sender at 10 Hz
    time.sleep(0.3)
    with cli.lock:
        assert set(cli.states()) == {BridgeState.WAIT_GCS} and cli.last().crsf_tx == 0
    with sim.lock:
        assert not sim.core.visited(BridgeState.START)


def test_udp_camera_design_policy(udp) -> None:
    sim, cli = udp(bridge=BS.BridgeConfig(boot_s=0.05, camera_policy="design", seed=1))
    cli.cam = True
    cli.start_stream()
    cli.expect(lambda: cli.last().state == BridgeState.RUN and cli.last().camera_on_readback)
    cli.cam = False
    cli.expect(lambda: not cli.last().camera_on_readback)
    cli.cam = True
    cli.expect(lambda: cli.last().camera_on_readback)
    cli.stop_stream()
    cli.expect(lambda: cli.last().state == BridgeState.WAIT_GCS)
    assert not cli.last().camera_on_readback


def test_udp_camera_client_gated_policy(udp) -> None:
    sim, cli = udp(bridge=BS.BridgeConfig(boot_s=0.05, camera_policy="client-gated", seed=1))
    cli.send(2)                                       # valid, but no stream established yet
    cli.expect(lambda: len(cli.statuses) >= 1)
    assert cli.last().state == BridgeState.WAIT_GCS and cli.last().camera_on_readback
    cli.start_stream()                                # cam = False
    cli.expect(lambda: cli.last().state == BridgeState.RUN and not cli.last().camera_on_readback)
    cli.stop_stream()
    cli.expect(lambda: cli.last().state == BridgeState.WAIT_GCS)
    assert not cli.last().camera_on_readback          # lost after having run -> OFF


def test_udp_status_rate_and_rtt_echo(udp) -> None:
    sim, cli = udp(latency_ms=100.0)
    cli.start_stream()
    cli.expect(lambda: sum(s.state == BridgeState.RUN for _, s in cli.statuses) >= 10, "10 RUN status", 10)
    with cli.lock:
        run = [(t, s) for t, s in cli.statuses if s.state == BridgeState.RUN]
    rtts = [P.u32_diff(int(t * 1e6) & 0xFFFFFFFF, s.t_gcs_us_echo) / 1000 for t, s in run]
    assert min(rtts) >= 90 and max(rtts) < 1000, rtts
    span = run[-1][0] - run[0][0]
    rate = (len(run) - 1) / span
    assert 5 < rate < 20, rate                        # ~10 Hz


def test_udp_loss_drops_some_status(udp) -> None:
    sim, cli = udp(loss_pct=50.0, telemetry_hz=0)
    cli.start_stream()
    time.sleep(2.0)
    with sim.lock:
        queued = sim.sent_counts["status"]
    with cli.lock:
        got = len(cli.statuses)
    assert 0 < got and queued > 0                     # some got through
    with sim.lock:
        assert sim.core.status_seq > got              # and some were dropped (seq has gaps)


def test_udp_telemetry_flight_mode_after_failsafe(udp) -> None:
    sim, cli = udp()
    cli.start_stream()                                # arm switch low first

    def modes() -> list[str]:
        return [o.text for o in (C.decode_frame(f) for f in cli.frames) if isinstance(o, C.FlightMode)]
    cli.expect(lambda: "ANGL*" in modes())
    cli.chans = ARMED
    cli.expect(lambda: "ANGL" in modes())
    cli.stop_stream()
    cli.expect(lambda: "!FS!" in modes(), timeout=10)
    cli.expect(lambda: "RTH" in modes(), timeout=10)
    with cli.lock:
        m = modes()
    assert m.index("ANGL") < m.index("!FS!") < m.index("RTH")
    with cli.lock:
        kinds = {type(C.decode_frame(f)).__name__ for f in cli.frames}
    assert {"LinkStatistics", "FlightMode", "Gps", "Battery"} <= kinds
    assert all(f.type != C.FrameType.RADIO_ID for f in cli.frames)   # timing frames are not forwarded


def test_udp_crsf_pass_parameter_read(udp) -> None:
    sim, cli = udp(crsf_pass=True)
    cli.send(1)                                       # become the current GCS
    cli.sock.sendto(P.CrsfPass(C.build_device_ping()).pack(), sim.address)
    cli.expect(lambda: any(f.type == C.FrameType.DEVICE_INFO for f in cli.frames))
    cli.sock.sendto(P.CrsfPass(C.build_param_read(4, 0)).pack(), sim.address)
    cli.expect(lambda: any(f.type == C.FrameType.PARAMETER_SETTINGS_ENTRY for f in cli.frames))
    with cli.lock:
        chunk = [C.decode_frame(f) for f in cli.frames if f.type == C.FrameType.PARAMETER_SETTINGS_ENTRY][0]
    entry = C.ParameterAssembler().feed(chunk)
    assert entry is not None and entry.name == "Max Power" and entry.units == "mW"
    with sim.lock:
        assert sim.core.crsf_tx == 2                  # no RC stream: only the 2 passthrough frames


def test_udp_crsf_pass_ignored_by_default(udp) -> None:
    sim, cli = udp()
    cli.send(1)
    cli.sock.sendto(P.CrsfPass(C.build_device_ping()).pack(), sim.address)
    time.sleep(0.4)
    with cli.lock:
        assert not any(f.type == C.FrameType.DEVICE_INFO for f in cli.frames)


def test_udp_fake_video_stream() -> None:
    rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    rx.bind(("127.0.0.1", 0))
    rx.settimeout(0.2)
    sim = _sim(video_kbps=2000.0, video_dest=rx.getsockname(), telemetry_hz=0).start()
    try:
        total, end = 0, time.perf_counter() + 1.0
        while time.perf_counter() < end:
            try:
                data, _ = rx.recvfrom(2048)
            except socket.timeout:
                continue
            assert data[0] == 0x80 and data[1] == 96 and len(data) == 1400
            total += len(data)
        assert 100_000 < total < 500_000              # ~250 kB/s at 2 Mbit/s
    finally:
        sim.stop()
        rx.close()


def test_udp_raw_extreme_channels_keep_bridge_alive(udp) -> None:
    """Verifier F1 over UDP: CH values 0 and 2047 in RUN; the simulator keeps running and forwards them."""
    sim, cli = udp()
    cli.chans = RAW_EXTREMES
    cli.start_stream()
    cli.expect(lambda: cli.last().state == BridgeState.RUN, "RUN with raw 0/2047 channels")
    n = len(cli.statuses)
    cli.expect(lambda: len(cli.statuses) >= n + 5, "status keeps flowing")
    with sim.lock:
        frame = sim.core.last_rc_frame
        assert sim._thread is not None and sim._thread.is_alive()
    assert frame is not None and list(C.decode_rc_channels(C.parse_frame(frame))) == list(RAW_EXTREMES)
    cli.chans = CENTRED
    cli.expect(lambda: sim.core.last_rc_frame == C.build_rc_channels_frame(CENTRED), "normal channels again")


def test_udp_runner_survives_unexpected_exception(udp, monkeypatch) -> None:
    sim, cli = udp()
    calls = {"n": 0}
    real = sim.client.update

    def flaky(*a, **kw):
        calls["n"] += 1
        if calls["n"] == 3:
            raise RuntimeError("injected simulator bug")
        return real(*a, **kw)
    monkeypatch.setattr(sim.client, "update", flaky)
    cli.start_stream()
    cli.expect(lambda: cli.last().state == BridgeState.RUN and calls["n"] > 10, "RUN after injected error")
    assert sim._thread is not None and sim._thread.is_alive()


# =========================================================================== CLI

def test_cli_defaults_and_options() -> None:
    args = BS.build_arg_parser().parse_args([])
    cfg = BS.config_from_args(args)
    assert (cfg.host, cfg.port, cfg.bridge.t_hold_s, cfg.bridge.start_packets) == ("127.0.0.1", 5770, 0.25, 5)
    assert cfg.bridge.camera_policy == "design" and cfg.video_kbps == 0 and not cfg.crsf_pass
    assert cfg.bridge.allowed_src == (ipaddress.ip_network("127.0.0.0/8"),)
    args = BS.build_arg_parser().parse_args(
        ["--camera-policy", "client-gated", "--latency-ms", "80", "--loss-pct", "5", "--allow-src", "any",
         "--t-hold-ms", "500", "--video-kbps", "3000", "--video-dest", "127.0.0.1:5600", "--fw-ver", "1.2"])
    cfg = BS.config_from_args(args)
    assert cfg.bridge.camera_policy == "client-gated" and cfg.latency_ms == 80 and cfg.loss_pct == 5
    assert cfg.bridge.allowed_src == () and cfg.bridge.t_hold_s == 0.5 and cfg.bridge.fw_ver == 0x0102
    assert cfg.video_dest == ("127.0.0.1", 5600)
    with pytest.raises(SystemExit):
        BS.build_arg_parser().parse_args(["--camera-policy", "always"])
