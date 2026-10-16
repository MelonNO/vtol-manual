"""Receiver: status/crsf_fwd parsing, counters, RTT, loss; telemetry -> C2 client (brief R7)."""

from __future__ import annotations

import pytest

from vtolgcs import crsf, protocol
from vtolgcs.config import ClientConfig, Config
from vtolgcs.protocol import BridgeState, CrsfFwd, Status
from vtolgcs.receiver import BridgeLink, Receiver
from vtolgcs.sender import Packet
from vtolgcs.telemetry import ClientTelemetry, describe

BRIDGE = ("192.168.144.21", 5770)


class Clock:
    def __init__(self) -> None:
        self.t = 10.0
        self.us = 1_000_000

    def __call__(self) -> float:
        return self.t

    def us_clock(self) -> int:
        return self.us


@pytest.fixture
def rx():
    clock = Clock()
    link = BridgeLink(clock, clock.us_clock)
    tl = ClientTelemetry(ClientConfig(profile_id="client-1", cells=6), clock)
    changes = []
    telem = []
    r = Receiver(Config(), sock=None, link=link, telemetry=tl, clock=clock,  # type: ignore[arg-type]
                 on_state_change=lambda a, b, s: changes.append((a, b)), on_telemetry=telem.append)
    return clock, link, tl, r, changes, telem


def status(**kw) -> bytes:
    base = dict(state=BridgeState.RUN, seq=1, t_gcs_us_echo=0)
    base.update(kw)
    return Status(**base).pack()


def fwd(obj) -> bytes:
    return CrsfFwd(crsf.telemetry_frame(obj)).pack()


def test_status_counters_and_source_filter(rx) -> None:
    clock, link, tl, r, changes, _ = rx
    r.handle_datagram(status(), ("10.0.0.9", 5770))
    r.handle_datagram(status(), (BRIDGE[0], 5771))
    assert r.counters["bad_src"] == 2 and link.status_count == 0
    good = status()
    r.handle_datagram(good, BRIDGE)
    r.handle_datagram(good[:-1] + bytes([good[-1] ^ 1]), BRIDGE)
    r.handle_datagram(b"RS\x02" + good[3:], BRIDGE)
    r.handle_datagram(b"XX\x01" + good[3:], BRIDGE)
    r.handle_datagram(good[:20], BRIDGE)
    bad_state = bytearray(Status(BridgeState.RUN, 1, 0).pack())
    bad_state[3] = 9
    body = bytes(bad_state[:-2])
    r.handle_datagram(body + protocol.crc16_ccitt_false(body).to_bytes(2, "little"), BRIDGE)
    r.handle_datagram(protocol.RcUp(1, 0, tuple(protocol.centred_channels())).pack(), BRIDGE)
    c = r.counters
    assert (c["status"], c["bad_crc"], c["bad_ver"], c["bad_magic"], c["bad_len"], c["bad_field"], c["unexpected"]) \
        == (1, 1, 1, 1, 1, 1, 1)
    assert changes == [(None, BridgeState.RUN)]


def test_state_change_callback(rx) -> None:
    clock, link, tl, r, changes, _ = rx
    for st in (BridgeState.WAIT_GCS, BridgeState.WAIT_GCS, BridgeState.START, BridgeState.RUN,
               BridgeState.FAILSAFE, BridgeState.WAIT_GCS):
        r.handle_datagram(status(state=st), BRIDGE)
    assert [b for _, b in changes] == [BridgeState.WAIT_GCS, BridgeState.START, BridgeState.RUN,
                                       BridgeState.FAILSAFE, BridgeState.WAIT_GCS]


def test_rtt_from_echo_of_our_packet(rx) -> None:
    clock, link, tl, r, *_ = rx
    link.note_sent(Packet(seq=41, t_gcs_us=500_000, data=b"", deadline=0))
    clock.us = 512_345
    r.handle_datagram(status(t_gcs_us_echo=500_000), BRIDGE)
    v = link.view(clock(), streaming=True)
    assert v.rtt_ms == pytest.approx(12.345)
    assert link.view(clock(), streaming=False).rtt_ms is None
    # an echo that is not one of our packets (e.g. a previous app instance) gives no RTT
    clock.us = 900_000
    r.handle_datagram(status(t_gcs_us_echo=123), BRIDGE)
    assert link.view(clock(), streaming=True).rtt_ms == pytest.approx(12.345)
    # a repeated (or older) echo means no newer packet was accepted: not a new sample
    r.handle_datagram(status(t_gcs_us_echo=500_000), BRIDGE)
    assert len(link.rtt_samples()) == 1


def test_rtt_wraps_u32(rx) -> None:
    clock, link, tl, r, *_ = rx
    link.note_sent(Packet(1, 0xFFFFFF00, b"", 0))
    clock.us = 0x00000100
    r.handle_datagram(status(t_gcs_us_echo=0xFFFFFF00), BRIDGE)
    assert link.view(clock()).rtt_ms == pytest.approx(0.512)


def test_uplink_loss_from_counters(rx) -> None:
    clock, link, tl, r, *_ = rx
    for seq in range(1, 201):
        link.note_sent(Packet(seq, seq * 4000, b"", 0))
    r.handle_datagram(status(t_gcs_us_echo=100 * 4000, rx_ok=1000), BRIDGE)
    clock.t += 0.4
    r.handle_datagram(status(t_gcs_us_echo=200 * 4000, rx_ok=1090), BRIDGE)   # 90 of 100 arrived
    assert link.view(clock()).uplink_loss_pct == pytest.approx(10.0)
    # bridge restart (counters went down): the window restarts
    clock.t += 0.1
    r.handle_datagram(status(t_gcs_us_echo=200 * 4000, rx_ok=5), BRIDGE)
    assert link.view(clock()).uplink_loss_pct is None


def test_status_age(rx) -> None:
    clock, link, tl, r, *_ = rx
    assert link.view(clock()).status_age_s is None
    r.handle_datagram(status(), BRIDGE)
    clock.t += 0.25
    assert link.view(clock()).status_age_s == pytest.approx(0.25)


def test_telemetry_decoded_into_c2_client(rx) -> None:
    clock, link, tl, r, _, telem = rx
    r.handle_datagram(fwd(crsf.LinkStatistics(-60, -62, 95, 8, 0, 6, 7, -70, 99, 6)), BRIDGE)
    r.handle_datagram(fwd(crsf.Gps(59.91, 10.76, 36.0, 270.5, 120, 11)), BRIDGE)
    r.handle_datagram(fwd(crsf.Battery(22.8, 12.3, 456, 71)), BRIDGE)
    r.handle_datagram(fwd(crsf.Attitude(0.1, -0.2, 1.5)), BRIDGE)
    r.handle_datagram(fwd(crsf.FlightMode("ANGL?")), BRIDGE)
    clock.t += 0.05
    c = tl.to_c2()
    assert c["profile_id"] == "client-1" and c["telemetry_age_ms"] == 50
    assert c["link"] == {"rssi1_dbm": -60, "rssi2_dbm": -62, "lq_pct": 95, "snr_db": 8, "rf_mode": 6,
                         "tx_power_mw": 250, "dl_rssi_dbm": -70, "dl_lq_pct": 99, "dl_snr_db": 6}
    assert c["gps"] == {"lat": pytest.approx(59.91), "lon": pytest.approx(10.76), "alt_m": 120,
                        "gspd_kmh": 36.0, "hdg_deg": 270.5, "sats": 11}
    assert c["battery"] == {"voltage_v": 22.8, "current_a": 12.3, "used_mah": 456, "remaining_pct": 71}
    assert c["attitude"] == {"pitch_rad": 0.1, "roll_rad": -0.2, "yaw_rad": 1.5}
    assert c["flight_mode"] == {"raw": "ANGL?", "failsafe": False, "armed": False, "rescue_not_ready": True}
    v = tl.view()
    assert v.cell_v == pytest.approx(3.8) and v.sats == 11 and v.lq_pct == 95 and v.rescue_not_ready
    assert r.counters["crsf_fwd"] == 5 and len(telem) == 5
    assert describe(telem[0])["kind"] == "link" and describe(telem[-1]) == {
        "kind": "flight_mode", "raw": "ANGL?", "failsafe": False, "armed": False, "rescue_not_ready": True}


def test_link_stats_alone_do_not_refresh_client_age(rx) -> None:
    clock, link, tl, r, *_ = rx
    r.handle_datagram(fwd(crsf.LinkStatistics(-60, -62, 0, 0, 0, 6, 7, -70, 0, 0)), BRIDGE)
    assert tl.age_s() is None                     # the TX module talks, the client is not heard
    r.handle_datagram(fwd(crsf.FlightMode("!FS!")), BRIDGE)
    assert tl.age_s() == 0 and tl.view().failsafe


def test_unknown_telemetry_values_are_null(rx) -> None:
    _, _, tl, *_ = rx
    c = tl.to_c2()
    assert c["telemetry_age_ms"] is None and c["link"]["lq_pct"] is None and c["gps"]["lat"] is None
    assert c["flight_mode"] == {"raw": None, "failsafe": None, "armed": None, "rescue_not_ready": None}


def test_bad_crsf_inside_good_datagram(rx) -> None:
    _, _, tl, r, *_ = rx
    frame = bytearray(crsf.telemetry_frame(crsf.FlightMode("ANGL")))
    frame[-1] ^= 0xFF
    r.handle_datagram(CrsfFwd(bytes(frame)).pack(), BRIDGE)
    assert r.counters["bad_crsf"] == 1 and tl.age_s() is None


def test_crsf_listeners_get_every_frame(rx) -> None:
    _, _, _, r, *_ = rx
    got = []
    r.crsf_listeners.append(got.append)
    info = crsf.DeviceInfo(0xEA, 0xEE, "Nomad", crsf.ELRS_SERIAL, 0, 0x030500, 30, 0).to_frame()
    r.handle_datagram(CrsfFwd(info).pack(), BRIDGE)
    assert len(got) == 1 and got[0].type == crsf.FrameType.DEVICE_INFO


def test_per_cell_voltage_modes() -> None:
    tl = ClientTelemetry(ClientConfig(cells=4))
    tl.on_frame(crsf.parse_frame(crsf.telemetry_frame(crsf.Battery(15.2, 1, 0, 50))))
    assert tl.cell_voltage() == pytest.approx(3.8)
    tl2 = ClientTelemetry(ClientConfig(report_cell_voltage=True))
    tl2.on_frame(crsf.parse_frame(crsf.telemetry_frame(crsf.Battery(3.7, 1, 0, 50))))
    assert tl2.cell_voltage() == pytest.approx(3.7)
    tl3 = ClientTelemetry(ClientConfig())
    tl3.on_frame(crsf.parse_frame(crsf.telemetry_frame(crsf.Battery(0.0, 0, 0, 0))))
    assert tl3.cell_voltage() is None              # no voltage sensor
