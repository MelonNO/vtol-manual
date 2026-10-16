"""Mission Planner client output (brief R3/R4/R9): byte-exact MAVLink 2, sysid guard, inbound ignored.

The reference side of these tests is independent of ``vtolgcs.mp_output``: message definitions are
written down in **common.xml order**, the generator's rules are applied here (stable sort of the base
fields by type size, extensions after; CRC_EXTRA over "NAME type name ..." plus array lengths), and
frames are assembled by a separate builder.
"""

from __future__ import annotations

import math
import socket
import struct

import pytest

from vtolgcs import mp_output as M
from vtolgcs.config import MpOutputConfig
from vtolgcs.mavlink_ro import parse_datagram, x25_crc

SIZES = {"uint8_t": 1, "int8_t": 1, "char": 1, "uint16_t": 2, "int16_t": 2, "uint32_t": 4, "int32_t": 4,
         "float": 4, "uint64_t": 8}
FMT = {"uint8_t": "B", "int8_t": "b", "char": "s", "uint16_t": "H", "int16_t": "h", "uint32_t": "I",
       "int32_t": "i", "float": "f"}

# (type, name, array_length) in common.xml order; extensions omitted (they are not part of CRC_EXTRA).
DEFS = {
    "HEARTBEAT": (0, [("uint8_t", "type", 0), ("uint8_t", "autopilot", 0), ("uint8_t", "base_mode", 0),
                      ("uint32_t", "custom_mode", 0), ("uint8_t", "system_status", 0),
                      ("uint8_t", "mavlink_version", 0)]),
    "SYS_STATUS": (1, [("uint32_t", "onboard_control_sensors_present", 0),
                       ("uint32_t", "onboard_control_sensors_enabled", 0),
                       ("uint32_t", "onboard_control_sensors_health", 0), ("uint16_t", "load", 0),
                       ("uint16_t", "voltage_battery", 0), ("int16_t", "current_battery", 0),
                       ("int8_t", "battery_remaining", 0), ("uint16_t", "drop_rate_comm", 0),
                       ("uint16_t", "errors_comm", 0), ("uint16_t", "errors_count1", 0),
                       ("uint16_t", "errors_count2", 0), ("uint16_t", "errors_count3", 0),
                       ("uint16_t", "errors_count4", 0)]),
    "ATTITUDE": (30, [("uint32_t", "time_boot_ms", 0), ("float", "roll", 0), ("float", "pitch", 0),
                      ("float", "yaw", 0), ("float", "rollspeed", 0), ("float", "pitchspeed", 0),
                      ("float", "yawspeed", 0)]),
    "GLOBAL_POSITION_INT": (33, [("uint32_t", "time_boot_ms", 0), ("int32_t", "lat", 0), ("int32_t", "lon", 0),
                                 ("int32_t", "alt", 0), ("int32_t", "relative_alt", 0), ("int16_t", "vx", 0),
                                 ("int16_t", "vy", 0), ("int16_t", "vz", 0), ("uint16_t", "hdg", 0)]),
    "ADSB_VEHICLE": (246, [("uint32_t", "ICAO_address", 0), ("int32_t", "lat", 0), ("int32_t", "lon", 0),
                           ("uint8_t", "altitude_type", 0), ("int32_t", "altitude", 0), ("uint16_t", "heading", 0),
                           ("uint16_t", "hor_velocity", 0), ("int16_t", "ver_velocity", 0),
                           ("char", "callsign", 9), ("uint8_t", "emitter_type", 0), ("uint8_t", "tslc", 0),
                           ("uint16_t", "flags", 0), ("uint16_t", "squawk", 0)]),
    "STATUSTEXT": (253, [("uint8_t", "severity", 0), ("char", "text", 50)]),
}


def wire_order(fields):
    return sorted(fields, key=lambda f: -SIZES[f[0]])          # Python's sort is stable, like mavgen's


def crc_extra(name: str) -> int:
    crc = x25_crc((name + " ").encode())
    for ftype, fname, alen in wire_order(DEFS[name][1]):
        crc = x25_crc((ftype + " ").encode(), crc)
        crc = x25_crc((fname + " ").encode(), crc)
        if alen:
            crc = x25_crc(bytes((alen,)), crc)
    return (crc & 0xFF) ^ (crc >> 8)


def ref_payload(name: str, **values) -> bytes:
    out = b""
    for ftype, fname, alen in wire_order(DEFS[name][1]):
        v = values.get(fname, b"" if ftype == "char" else 0)
        out += struct.pack("<" + (f"{alen}s" if alen else FMT[ftype]), v)
    return out


def ref_frame(name: str, payload: bytes, sysid: int, compid: int, seq: int) -> bytes:
    msgid = DEFS[name][0]
    trimmed = payload.rstrip(b"\0") or payload[:1]
    hdr = bytes((len(trimmed), 0, 0, seq, sysid, compid)) + msgid.to_bytes(3, "little")
    crc = x25_crc(hdr + trimmed + bytes((crc_extra(name),)))
    return b"\xFD" + hdr + trimmed + crc.to_bytes(2, "little")


# --------------------------------------------------------------------------- encoding

@pytest.mark.parametrize("name, expected", [("HEARTBEAT", 50), ("SYS_STATUS", 124), ("ATTITUDE", 39),
                                            ("GLOBAL_POSITION_INT", 104), ("ADSB_VEHICLE", 184),
                                            ("STATUSTEXT", 83)])
def test_crc_extra_from_definitions(name: str, expected: int) -> None:
    assert crc_extra(name) == expected == M.CRC_EXTRA[DEFS[name][0]]


def test_payload_lengths() -> None:
    assert [len(ref_payload(n)) for n in DEFS] == [9, 31, 28, 28, 38, 51]


def test_heartbeat_frame_byte_exact() -> None:
    payload = M.heartbeat_payload(armed=True, failsafe=False)
    assert payload == ref_payload("HEARTBEAT", type=2, autopilot=0, base_mode=128, custom_mode=0,
                                  system_status=4, mavlink_version=3)
    frame = M.encode_frame(0, payload, sysid=2, compid=1, seq=7)
    assert frame == ref_frame("HEARTBEAT", payload, 2, 1, 7)
    # payload truncation: custom_mode 0 is at the front, so nothing is trimmed here
    assert frame[:10].hex() == "fd09000007020100" + "0000"
    assert frame.hex() == ("fd090000070201000000" "00000000" "02" "00" "80" "04" "03"
                           + frame[-2:].hex())


def test_all_messages_byte_exact_against_the_reference() -> None:
    cases = [
        ("SYS_STATUS", M.sys_status_payload(23.4, 12.5, 57),
         dict(voltage_battery=23400, current_battery=1250, battery_remaining=57)),
        ("SYS_STATUS", M.sys_status_payload(None, None, None),
         dict(voltage_battery=0xFFFF, current_battery=-1, battery_remaining=-1)),
        ("ATTITUDE", M.attitude_payload(1234, 0.1, -0.2, 3.0),
         dict(time_boot_ms=1234, roll=0.1, pitch=-0.2, yaw=3.0)),
        ("GLOBAL_POSITION_INT", M.global_position_payload(5000, 59.9123456, 10.7654321, 51.2, 36.0, 90.0),
         dict(time_boot_ms=5000, lat=599123456, lon=107654321, alt=51200, relative_alt=51200, vx=0, vy=1000,
              vz=0, hdg=9000)),
        ("GLOBAL_POSITION_INT", M.global_position_payload(1, -33.5, 151.25, None, None, None),
         dict(time_boot_ms=1, lat=-335000000, lon=1512500000, hdg=0xFFFF)),
        ("ADSB_VEHICLE", M.adsb_payload(2, 59.9, 10.75, 50.0, 180.0, 54.0, "FPV2", 0.4),
         dict(ICAO_address=2, lat=599000000, lon=107500000, altitude_type=1, altitude=50000, heading=18000,
              hor_velocity=1500, ver_velocity=0, callsign=b"FPV2", emitter_type=14, tslc=0, flags=31, squawk=0)),
        ("STATUSTEXT", M.statustext_payload(2, "FPV mode !FS!"), dict(severity=2, text=b"FPV mode !FS!")),
    ]
    for name, payload, values in cases:
        assert payload == ref_payload(name, **values), name
        assert M.encode_frame(DEFS[name][0], payload, 2, 1, 3) == ref_frame(name, payload, 2, 1, 3), name


def test_frames_parse_with_the_independent_reader() -> None:
    hb = M.encode_frame(0, M.heartbeat_payload(False, False), 2, 1, 0)
    gpi = M.encode_frame(33, M.global_position_payload(1, 59.9, 10.75, 50.0, None, None), 2, 1, 1)
    msgs = parse_datagram(hb + gpi)
    assert [(m.msgid, m.sysid, m.compid) for m in msgs] == [(0, 2, 1), (33, 2, 1)]


# --------------------------------------------------------------------------- sysid guard (S-02b)

@pytest.mark.parametrize("sysid", [1, 255, 0, 256])
def test_encoder_refuses_forbidden_sysids(sysid: int) -> None:
    with pytest.raises(M.SysidError):
        M.encode_frame(0, M.heartbeat_payload(True, False), sysid, 1, 0)


@pytest.mark.parametrize("sysid", [1, 255])
def test_output_refuses_forbidden_sysids(sysid: int) -> None:
    with pytest.raises(M.SysidError):
        M.MpOutput(MpOutputConfig(sysid=sysid))


def test_output_destination_is_loopback_only() -> None:
    with pytest.raises(ValueError):
        M.SendOnlyUdp("192.168.144.20", 14560)


# --------------------------------------------------------------------------- the stream, inbound ignored

def _status(**client) -> dict:
    base = {"telemetry_age_ms": 100,
            "gps": {"lat": 59.9, "lon": 10.75, "alt_m": 50.0, "gspd_kmh": 36.0, "hdg_deg": 90.0, "sats": 12},
            "attitude": {"roll_rad": 0.1, "pitch_rad": 0.0, "yaw_rad": 1.0},
            "battery": {"voltage_v": 23.0, "current_a": 10.0, "used_mah": 100, "remaining_pct": 80},
            "flight_mode": {"raw": "ANGL", "failsafe": False, "armed": True, "rescue_not_ready": False}}
    base.update(client)
    return {"client": base}


class _Peer:
    """Stands in for Mission Planner's UDP link (and for the carrier / bridge to check nothing arrives)."""

    def __init__(self) -> None:
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.settimeout(0.3)
        self.port = self.sock.getsockname()[1]

    def recv_all(self) -> list[tuple[bytes, tuple]]:
        out = []
        while True:
            try:
                out.append(self.sock.recvfrom(4096))
            except (socket.timeout, ConnectionResetError):
                return out


def test_stream_to_mission_planner_and_inbound_ignored() -> None:
    mp, carrier = _Peer(), _Peer()
    t = [100.0]
    out = M.MpOutput(MpOutputConfig(port=mp.port), clock=lambda: t[0])
    try:
        assert out.on_status(_status()) == 4                   # heartbeat, position, attitude, sys_status
        got = mp.recv_all()
        msgs = [m for data, _ in got for m in parse_datagram(data)]
        assert [m.msgid for m in msgs] == [0, 33] and all(m.sysid == 2 for m in msgs)  # reader knows 0 and 33
        src = got[0][1]
        # Mission Planner talks back: its GCS heartbeat (sysid 255) and a command to our vehicle.
        gcs_hb = M.encode_frame(0, M.heartbeat_payload(None, None), 254, 190, 0)  # any frame will do
        for _ in range(5):
            mp.sock.sendto(gcs_hb, src)
            mp.sock.sendto(b"\xfe\x21\x00\xff\xbe\x4c" + bytes(35), src)          # COMMAND_LONG-ish junk
        t[0] += 0.2
        out.on_status(_status())
        assert out.stats.inbound_ignored == 10
        assert carrier.recv_all() == []                         # nothing forwarded anywhere else
        t[0] += 0.3
        out.on_status(_status(flight_mode={"raw": "!FS!", "failsafe": True, "armed": True}))
        frames = b"".join(d for d, _ in mp.recv_all())
        assert b"FPV mode !FS!" in frames                        # STATUSTEXT on the mode change
    finally:
        out.close()
        mp.sock.close()
        carrier.sock.close()


def test_no_vehicle_before_telemetry_and_stale_positions_dropped() -> None:
    out = M.MpOutput(MpOutputConfig(port=9), clock=lambda: 0.0)
    try:
        assert out.frames_for({"client": {"telemetry_age_ms": None}}, 0.0) == []
        stale = out.frames_for(_status(telemetry_age_ms=10_000), 0.0)
        assert [m for m, _ in stale] == [M.MSG_HEARTBEAT]        # still alive, but no old position
        assert out.frames_for(_status(), 0.5)[0][0] == M.MSG_GLOBAL_POSITION_INT  # heartbeat only at 1 Hz
    finally:
        out.close()


def test_adsb_mode() -> None:
    out = M.MpOutput(MpOutputConfig(port=9, mode="adsb", callsign="CLIENT1"), clock=lambda: 0.0)
    try:
        frames = out.frames_for(_status(), 0.0)
        assert [m for m, _ in frames] == [M.MSG_HEARTBEAT, M.MSG_ADSB_VEHICLE]
        hb = struct.unpack("<IBBBBB", frames[0][1])
        assert hb[1] == M.MAV_TYPE_ADSB and hb[2] == M.MAV_AUTOPILOT_INVALID
        assert b"CLIENT1" in frames[1][1]
    finally:
        out.close()


def test_no_nan_leaks() -> None:
    assert M.sys_status_payload(math.nan, None, None) == M.sys_status_payload(None, None, None)
