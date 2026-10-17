"""Read-only MAVLink mirror input: decoding, carrier filter, and *no send ever* (brief R9, S-02b)."""

from __future__ import annotations

import socket
import struct
import time

import pytest

from vtolgcs import mavlink_ro as M
from vtolgcs.config import MavlinkConfig

# --------------------------------------------------------------------------- independent reference helpers

# MAVLink common.xml field lists in wire order (sorted by type size, extensions excluded).
HEARTBEAT_FIELDS = [("uint32_t", "custom_mode"), ("uint8_t", "type"), ("uint8_t", "autopilot"),
                    ("uint8_t", "base_mode"), ("uint8_t", "system_status"), ("uint8_t", "mavlink_version")]
GPI_FIELDS = [("uint32_t", "time_boot_ms"), ("int32_t", "lat"), ("int32_t", "lon"), ("int32_t", "alt"),
              ("int32_t", "relative_alt"), ("int16_t", "vx"), ("int16_t", "vy"), ("int16_t", "vz"),
              ("uint16_t", "hdg")]


def crc_extra(name: str, fields: list[tuple[str, str]]) -> int:
    """MAVLink generator rule (pymavlink mavparse ``message_checksum``)."""
    crc = M.x25_crc((name + " ").encode())
    for ftype, fname in fields:
        crc = M.x25_crc((ftype + " ").encode(), crc)
        crc = M.x25_crc((fname + " ").encode(), crc)
    return (crc & 0xFF) ^ (crc >> 8)


def frame_v1(msgid: int, payload: bytes, sysid: int = 1, compid: int = 1, seq: int = 0) -> bytes:
    body = bytes((len(payload), seq, sysid, compid, msgid)) + payload
    crc = M.x25_crc(body + bytes((M.CRC_EXTRA[msgid],)))
    return b"\xFE" + body + struct.pack("<H", crc)


def frame_v2(msgid: int, payload: bytes, sysid: int = 1, compid: int = 1, seq: int = 0, signed: bool = False,
             truncate: bool = True) -> bytes:
    if truncate:
        payload = payload.rstrip(b"\0") or payload[:1]
    body = bytes((len(payload), 0x01 if signed else 0, 0, seq, sysid, compid)) + msgid.to_bytes(3, "little") + payload
    crc = M.x25_crc(body + bytes((M.CRC_EXTRA[msgid],)))
    return b"\xFD" + body + struct.pack("<H", crc) + (bytes(13) if signed else b"")


def heartbeat(autopilot: int = 3, mav_type: int = 1) -> bytes:
    return struct.pack("<IBBBBB", 0, mav_type, autopilot, 0x81, 4, 3)


def gpi(lat: float = 59.9123456, lon: float = 10.7654321, rel_alt_m: float = 120.5, hdg_deg: float | None = 271.25) -> bytes:
    hdg = 0xFFFF if hdg_deg is None else round(hdg_deg * 100)
    return struct.pack("<IiiiihhhH", 123456, round(lat * 1e7), round(lon * 1e7), 210_000,
                       round(rel_alt_m * 1000), 100, -50, 0, hdg)


# --------------------------------------------------------------------------- checks

def test_checksum_and_crc_extra_values() -> None:
    assert M.x25_crc(b"123456789") == 0x6F91                       # CRC-16/MCRF4XX catalogue check
    assert crc_extra("HEARTBEAT", HEARTBEAT_FIELDS) == M.CRC_EXTRA[0] == 50
    assert crc_extra("GLOBAL_POSITION_INT", GPI_FIELDS) == M.CRC_EXTRA[33] == 104


@pytest.mark.parametrize("builder", [frame_v1, frame_v2,
                                     lambda i, p, **k: frame_v2(i, p, signed=True, **k),
                                     lambda i, p, **k: frame_v2(i, p, truncate=False, **k)])
def test_decode_synthetic_global_position_int(builder) -> None:
    carrier = M.CarrierPosition(MavlinkConfig(), clock=lambda: 5.0)
    data = builder(0, heartbeat(), sysid=1) + builder(33, gpi(), sysid=1)
    for msg in M.parse_datagram(data):
        carrier.on_message(msg)
    assert carrier.to_c2() == {"lat": pytest.approx(59.9123456), "lon": pytest.approx(10.7654321),
                               "alt_rel_m": pytest.approx(120.5), "hdg_deg": pytest.approx(271.25),
                               "source": "mavlink-readonly"}


def test_v2_truncated_zero_payload_is_restored() -> None:
    raw = frame_v2(33, gpi(lat=0.0, lon=0.0, rel_alt_m=0.0, hdg_deg=0.0))
    (msg,) = M.parse_datagram(raw)
    assert len(msg.payload) == 28
    gp = M.GlobalPositionInt.decode(msg.payload)
    assert gp.time_boot_ms == 123456 and gp.hdg == 0


def test_only_autopilot_heartbeats_lock_the_carrier() -> None:
    carrier = M.CarrierPosition(MavlinkConfig(), clock=lambda: 1.0)
    msgs = M.parse_datagram(frame_v2(0, heartbeat(autopilot=8, mav_type=6), sysid=255)   # Mission Planner (GCS)
                            + frame_v2(0, heartbeat(autopilot=0, mav_type=2), sysid=2)   # app's client (WP08b)
                            + frame_v2(33, gpi(), sysid=2))
    for m in msgs:
        carrier.on_message(m)
    assert carrier.sysid is None and carrier.to_c2()["source"] is None
    assert carrier.counters["ignored_heartbeat"] == 2 and carrier.counters["ignored_position"] == 1
    for m in M.parse_datagram(frame_v2(0, heartbeat(), sysid=1) + frame_v2(33, gpi(lat=1.0), sysid=1)
                              + frame_v2(33, gpi(lat=2.0), sysid=2)):
        carrier.on_message(m)
    assert carrier.sysid == 1 and carrier.to_c2()["lat"] == pytest.approx(1.0)


def test_configured_carrier_sysid() -> None:
    carrier = M.CarrierPosition(MavlinkConfig(carrier_sysid=7), clock=lambda: 1.0)
    for m in M.parse_datagram(frame_v1(0, heartbeat(), sysid=1) + frame_v1(33, gpi(), sysid=1)
                              + frame_v1(33, gpi(lat=3.0), sysid=7)):
        carrier.on_message(m)
    assert carrier.to_c2()["lat"] == pytest.approx(3.0)


def test_bad_crc_and_garbage_are_dropped() -> None:
    good = frame_v2(33, gpi())
    bad = bytearray(good)
    bad[12] ^= 0x01
    counters: dict[str, int] = {}
    assert M.parse_datagram(b"\x00\x13garbage" + bytes(bad), counters) == []
    assert counters["bad_crc"] == 1
    assert len(M.parse_datagram(b"junk" + good + good[:10], counters)) == 1
    other = b"\xFD\x05\x00\x00\x00\x01\x01" + (30).to_bytes(3, "little") + bytes(5) + b"\x00\x00"  # ATTITUDE
    assert M.parse_datagram(other, counters) == [] and counters["other_msg"] == 1


def test_position_goes_stale() -> None:
    t = [0.0]
    carrier = M.CarrierPosition(MavlinkConfig(stale_s=5.0), clock=lambda: t[0])
    for m in M.parse_datagram(frame_v2(0, heartbeat()) + frame_v2(33, gpi(hdg_deg=None))):
        carrier.on_message(m)
    assert carrier.to_c2()["hdg_deg"] is None and carrier.to_c2()["source"] == "mavlink-readonly"
    t[0] = 5.1
    assert carrier.to_c2() == {"lat": None, "lon": None, "alt_rel_m": None, "hdg_deg": None, "source": None}


# --------------------------------------------------------------------------- never sends

class RecordingSocket:
    """Stands in for socket.socket; records every call, delivers queued datagrams."""

    instances: list["RecordingSocket"] = []

    def __init__(self, *args) -> None:
        self.calls: list[str] = []
        self.inbox: list[bytes] = []
        RecordingSocket.instances.append(self)

    def __getattr__(self, name: str):
        def method(*a, **k):
            self.calls.append(name)
            if name == "recvfrom":
                if self.inbox:
                    return self.inbox.pop(0), ("127.0.0.1", 50000)
                time.sleep(0.01)
                raise socket.timeout()
            if name == "getsockname":
                return ("127.0.0.1", 14551)
            return None
        return method


def test_listener_never_sends_with_recording_socket() -> None:
    RecordingSocket.instances.clear()
    carrier = M.CarrierPosition(MavlinkConfig())
    ro = M.MavlinkReadOnly(MavlinkConfig(), carrier, socket_factory=RecordingSocket).start()
    try:                                                     # WP18 R1: the listener thread stops whatever fails
        sock = RecordingSocket.instances[0]
        sock.inbox += [frame_v2(0, heartbeat()), frame_v2(33, gpi())]
        deadline = time.time() + 3
        while carrier.to_c2()["source"] is None and time.time() < deadline:
            time.sleep(0.01)
    finally:
        ro.stop()
    assert carrier.to_c2()["source"] == "mavlink-readonly"
    assert not [c for c in sock.calls if c.startswith("send") or c.startswith("connect")]
    assert set(sock.calls) <= {"bind", "settimeout", "recvfrom", "close", "getsockname"}


def test_wrapper_has_no_send_methods() -> None:
    real = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    ro = M.ReceiveOnlySocket(real)
    try:
        for name in ("send", "sendto", "sendall", "sendmsg", "connect"):
            with pytest.raises(PermissionError):
                getattr(ro, name)
        with pytest.raises(AttributeError):
            ro._sock = None  # type: ignore[misc]   # cannot swap the socket in
    finally:
        ro.close()


def test_real_udp_listener_decodes_and_never_calls_sendto(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[tuple] = []
    orig_sendto = socket.socket.sendto
    listener_fds: list[int] = []

    def guarded_sendto(self, *args):                     # record any send from the listener socket
        if self.fileno() in listener_fds:
            sent.append(args)
        return orig_sendto(self, *args)
    monkeypatch.setattr(socket.socket, "sendto", guarded_sendto)
    for name in ("send", "sendall", "connect"):
        orig = getattr(socket.socket, name)
        monkeypatch.setattr(socket.socket, name, lambda self, *a, _o=orig, _n=name:
                            (sent.append((_n,)) if self.fileno() in listener_fds else None) or _o(self, *a))

    carrier = M.CarrierPosition(MavlinkConfig())
    ro = M.MavlinkReadOnly(MavlinkConfig(listen_port=0), carrier).start()
    listener_fds.append(ro.sock.fileno())
    mp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)               # plays Mission Planner's mirror
    try:
        for _ in range(3):
            mp.sendto(frame_v1(0, heartbeat()) + frame_v1(33, gpi()), ro.address)
            deadline = time.time() + 1
            while carrier.to_c2()["source"] is None and time.time() < deadline:
                time.sleep(0.01)
            if carrier.to_c2()["source"]:
                break
        assert carrier.to_c2()["lat"] == pytest.approx(59.9123456)
    finally:
        mp.close()
        ro.stop()
    assert sent == []
