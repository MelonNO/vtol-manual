"""Tests for vtolgcs.crsf (CRSF parser, builders, decoders, parameter protocol)."""

from __future__ import annotations

import random
from typing import Any

import pytest

from _vectors import ids, vectors
from vtolgcs import crsf as C
from vtolgcs import protocol as P

V = vectors()
HEX = bytes.fromhex


# --------------------------------------------------------------------------- CRC-8

def test_crc8_d5_check_value() -> None:
    assert C.crc8_d5(b"123456789") == 0xBC          # CRC-8/DVB-S2


@pytest.mark.parametrize("item", [c for c in V["crc"] if c["algo"].startswith("crc8")],
                         ids=lambda c: f"{c['algo']}-{c.get('input_ascii', c.get('input_hex'))[:12]}")
def test_crc8_vectors(item: dict) -> None:
    data = item["input_ascii"].encode() if "input_ascii" in item else HEX(item["input_hex"])
    fn = C.crc8_d5 if item["algo"] == "crc8_d5" else C.crc8_ba
    assert fn(data) == int(item["value"], 16)


def test_crc8_tables_match_edgetx_source() -> None:
    """Rows copied from EdgeTX radio/src/crc.cpp @65db64b (crc8tab line 125, crc8tab_BA lines 157/184)."""
    t_d5 = [C.crc8_d5(bytes((i,))) for i in range(256)]
    t_ba = [C.crc8_ba(bytes((i,))) for i in range(256)]
    assert t_d5[0:8] == [0x00, 0xD5, 0x7F, 0xAA, 0xFE, 0x2B, 0x81, 0x54]
    assert t_d5[104:112] == [0x10, 0xC5, 0x6F, 0xBA, 0xEE, 0x3B, 0x91, 0x44]
    assert t_ba[0:8] == [0x00, 0xBA, 0xCE, 0x74, 0x26, 0x9C, 0xE8, 0x52]
    assert t_ba[216:224] == [0x9C, 0x26, 0x52, 0xE8, 0xBA, 0x00, 0x74, 0xCE]


# --------------------------------------------------------------------------- frames / parser

def test_build_and_parse_frame() -> None:
    raw = C.build_frame(0x14, bytes(10), 0xEA)
    assert raw[:3] == HEX("EA0C14") and len(raw) == 14
    f = C.parse_frame(raw)
    assert f.type == 0x14 and f.address == 0xEA and f.payload == bytes(10) and not f.is_extended


def test_extended_frame_fields() -> None:
    f = C.parse_frame(C.build_param_read(7, 2))
    assert f.is_extended and f.dest == 0xEE and f.origin == 0xEA and f.body == b"\x07\x02"
    with pytest.raises(C.CrsfError):
        C.build_ext_frame(0x14, 0, 0)


@pytest.mark.parametrize("item", V["crsf_malformed"], ids=ids(V["crsf_malformed"]))
def test_crsf_malformed_vectors(item: dict) -> None:
    with pytest.raises(C.CrsfError):
        frame = C.parse_frame(HEX(item["hex"]))
        if item.get("decode"):
            C.decode_frame(frame)


def _feed_all(parser: C.CrsfParser, data: bytes, splits: list[int] | None = None) -> list[bytes]:
    out: list[bytes] = []
    if splits is None:
        return [f.raw for f in parser.feed(data)]
    pos = 0
    for n in splits:
        out += [f.raw for f in parser.feed(data[pos:pos + n])]
        pos += n
    out += [f.raw for f in parser.feed(data[pos:])]
    return out


@pytest.mark.parametrize("item", V["crsf_streams"], ids=ids(V["crsf_streams"]))
def test_parser_stream_vectors(item: dict) -> None:
    stream = HEX(item["stream"])
    expected = [HEX(x) for x in item["frames"]] if "frames" in item else None
    rng = random.Random(item["name"])
    variants = [None, [1] * len(stream), item.get("chunks")]
    variants += [[rng.randint(1, 9) for _ in range(len(stream))] for _ in range(5)]
    for splits in variants:
        parser = C.CrsfParser()
        got = _feed_all(parser, stream, splits)
        if expected is not None:
            assert got == expected, f"splits={splits}"
        assert len(got) == item.get("frame_count", len(got))
        if "pending" in item:
            assert parser.pending == item["pending"]


def test_parser_resyncs_on_random_garbage() -> None:
    rng = random.Random(42)
    frames = [C.build_frame(0x14, bytes(rng.getrandbits(8) for _ in range(10)), 0xEA) for _ in range(50)]
    stream = b""
    for fr in frames:
        # garbage without sync bytes, so it cannot form a false frame
        stream += bytes(rng.choice([b for b in range(256) if b not in C.SYNC_BYTES]) for _ in range(rng.randint(0, 20)))
        stream += fr
    parser = C.CrsfParser()
    got = _feed_all(parser, stream, [rng.randint(1, 40) for _ in range(200)])
    assert got == frames
    assert parser.frames_ok == 50 and parser.bytes_discarded > 0


def test_parser_does_not_lose_frame_after_corrupt_one() -> None:
    good = C.build_frame(0x21, b"ANGL*\0", 0xEA)
    bad = bytearray(C.build_frame(0x14, bytes(10), 0xEA))
    bad[-1] ^= 0x55
    parser = C.CrsfParser()
    assert [f.raw for f in parser.feed(bytes(bad) + good)] == [good]
    assert parser.crc_errors >= 1


def test_parser_buffer_stays_bounded() -> None:
    parser = C.CrsfParser()
    rng = random.Random(3)
    for _ in range(2000):
        parser.feed(bytes(rng.getrandbits(8) for _ in range(rng.randint(1, 30))))
        assert parser.pending < C.MAX_FRAME_SIZE


def test_parser_accepts_all_three_sync_bytes() -> None:
    frames = [C.build_frame(0x07, b"\x00\x10", a) for a in (0xC8, 0xEA, 0xEE)]
    assert [f.raw for f in C.CrsfParser().feed(b"".join(frames))] == frames


# --------------------------------------------------------------------------- decoders

def _approx(decoded: dict[str, Any], expected: dict[str, Any]) -> None:
    for key, value in expected.items():
        got = decoded[key]
        if isinstance(value, float):
            assert got == pytest.approx(value, abs=1e-6), key
        else:
            assert got == value, key


def _as_dict(obj: Any) -> dict[str, Any]:
    d = {k: getattr(obj, k) for k in obj.__dataclass_fields__}
    for prop in ("tx_power_mw", "interval_us", "is_elrs", "software_version_str"):
        if hasattr(type(obj), prop):
            d[prop] = getattr(obj, prop)
    if isinstance(obj, C.FlightMode):
        s = obj.status
        d.update(mode=s.mode, suffix=s.suffix, failsafe=s.failsafe, armed=s.armed, ready_to_arm=s.ready_to_arm,
                 arming_disabled=s.arming_disabled, rescue_not_ready=s.rescue_not_ready, rth=s.rth)
    for k, v in list(d.items()):
        if isinstance(v, bytes):
            d[k] = v.hex().upper()
    return d


@pytest.mark.parametrize("item", V["crsf_frames"], ids=ids(V["crsf_frames"]))
def test_decoder_vectors(item: dict) -> None:
    frame = C.parse_frame(HEX(item["hex"]))
    assert frame.type == item["type"]
    obj = C.decode_frame(frame)
    assert type(obj).__name__ == item["decoder"]
    _approx(_as_dict(obj), item["decoded"])


@pytest.mark.parametrize("item", [i for i in V["crsf_frames"] if not i.get("external")
                                  and i["decoder"] not in ("ParameterChunk",)], ids=lambda i: i["name"])
def test_decoder_reencode_round_trip(item: dict) -> None:
    obj = C.decode_frame(C.parse_frame(HEX(item["hex"])))
    raw = obj.to_frame() if hasattr(obj, "to_frame") else C.telemetry_frame(obj)
    assert raw.hex().upper() == item["hex"]


def test_vectors_cover_every_decoder() -> None:
    names = {i["decoder"] for i in V["crsf_frames"]}
    assert names >= {"LinkStatistics", "Gps", "Battery", "Attitude", "FlightMode", "Vario", "BaroAltitude",
                     "RadioTiming", "DeviceInfo", "ParameterChunk"}


def test_link_statistics_signs_and_power() -> None:
    raw = C.build_frame(0x14, bytes([60, 62, 100, 0xF8, 1, 6, 7, 70, 99, 0xFA]), 0xEA)
    ls = C.decode_frame(C.parse_frame(raw))
    assert (ls.rssi1_dbm, ls.rssi2_dbm, ls.snr_db, ls.dl_snr_db) == (-60, -62, -8, -6)
    assert ls.tx_power_mw == 250 and ls.dl_rssi2_dbm is None
    assert C.LinkStatistics(0, 0, 0, 0, 0, 0, 99, 0, 0, 0).tx_power_mw is None


def test_gps_big_endian_and_offsets() -> None:
    payload = (591234567).to_bytes(4, "big", signed=True) + (-107654321).to_bytes(4, "big", signed=True) \
        + (543).to_bytes(2, "big") + (27150).to_bytes(2, "big") + (1087).to_bytes(2, "big") + b"\x0e"
    g = C.Gps.decode(payload)
    assert g.lat_deg == pytest.approx(59.1234567) and g.lon_deg == pytest.approx(-10.7654321)
    assert (g.gspd_kmh, g.hdg_deg, g.alt_m, g.sats) == (54.3, 271.5, 87, 14)


def test_battery_u24_capacity() -> None:
    b = C.Battery.decode(HEX("00EA00BB") + (0x012345).to_bytes(3, "big") + b"\x50")
    assert (b.voltage_v, b.current_a, b.used_mah, b.remaining_pct) == (23.4, 18.7, 0x012345, 80)


def test_attitude_signed() -> None:
    a = C.Attitude.decode((-15708).to_bytes(2, "big", signed=True) + (5000).to_bytes(2, "big") + bytes(2))
    assert a.pitch_rad == pytest.approx(-1.5708) and a.roll_rad == 0.5 and a.yaw_rad == 0.0


def test_baro_altitude_both_encodings() -> None:
    assert C.BaroAltitude.unpack_altitude(10000) == 0.0
    assert C.BaroAltitude.unpack_altitude(10123) == pytest.approx(12.3)
    assert C.BaroAltitude.unpack_altitude(0x8000 | 2500) == 2500.0
    bf = C.BaroAltitude.decode(HEX("2710") + bytes([C.BaroAltitude.pack_vspd_bf(-3.0) & 0xFF]))
    assert bf.vspd_format == "betaflight" and bf.vspd_ms == pytest.approx(-3.0, rel=0.03)
    el = C.BaroAltitude.decode(HEX("2710") + (-250).to_bytes(2, "big", signed=True))
    assert el.vspd_format == "elrs" and el.vspd_ms == -2.5


def test_vario() -> None:
    assert C.Vario.decode((-125).to_bytes(2, "big", signed=True)).vspd_ms == -1.25


def test_radio_timing_matches_edgetx_stream_and_relay_design_units() -> None:
    t = C.decode_frame(C.parse_frame(HEX("C80D3AEAEE1000009C400000001CD7")))
    assert (t.rate_x10us, t.offset_x10us, t.interval_us, t.rate_hz) == (40000, 28, 4000.0, 250.0)
    # relay design: "at 200 Hz the rate should read about 50000"
    t200 = C.RadioTiming(0xEA, 0xEE, 50000, -500)
    assert t200.rate_hz == 200.0
    assert C.decode_frame(C.parse_frame(t200.to_frame())).offset_x10us == -500


def test_device_info() -> None:
    info = C.DeviceInfo(0xEA, 0xEE, "TX", C.ELRS_SERIAL, 0, 0x00030502, 17, 0)
    back = C.decode_frame(C.parse_frame(info.to_frame()))
    assert back == info and back.is_elrs and back.software_version_str == "3.5.2"


def test_device_info_matches_elrs_unit_test_body() -> None:
    """Body bytes from ExpressLRS src/test/test_crsf/test_crsf.cpp test_device_info (name 'testing')."""
    body = bytes([ord(c) for c in "testing"] + [0, 0x45, 0x4C, 0x52, 0x53, 0, 0, 0, 0, 0, 1, 2, 3, 0, 0])
    raw = C.build_ext_frame(C.FrameType.DEVICE_INFO, 0xC8, 0xEC, body, 0xC8)
    info = C.decode_frame(C.parse_frame(raw))
    assert info.name == "testing" and info.is_elrs and info.software_ver == 0x00010203 and info.field_count == 0


def test_unknown_type_decodes_to_none() -> None:
    assert C.decode_frame(C.parse_frame(C.build_frame(0x0B, b"\x00\xc8"))) is None


def test_decode_rc_channels() -> None:
    chans = [172 + 100 * i for i in range(16)]
    assert list(C.decode_rc_channels(C.parse_frame(C.build_rc_channels_frame(chans)))) == chans


# --------------------------------------------------------------------------- builders

_BUILD = {
    "build_rc_channels_frame": lambda a: C.build_rc_channels_frame(a["channels"]),
    "build_rc_channels_frame_raw": lambda a: C.build_rc_channels_frame_raw(HEX(a["packed"])),
    "build_model_id_frame": lambda a: C.build_model_id_frame(a["model_id"]),
    "build_device_ping": lambda a: C.build_device_ping(),
    "build_param_read": lambda a: C.build_param_read(a["param"], a["chunk"]),
    "build_param_write": lambda a: C.build_param_write(a["param"], C.encode_param_value(a["type"], a["value"])),
}


@pytest.mark.parametrize("item", V["crsf_builders"], ids=ids(V["crsf_builders"]))
def test_builder_vectors(item: dict) -> None:
    raw = _BUILD[item["builder"]](item["args"])
    assert raw.hex().upper() == item["hex"]
    C.parse_frame(raw)   # every built frame is a valid CRSF frame


def test_rc_frame_matches_relay_design_header() -> None:
    raw = C.build_rc_channels_frame(P.centred_channels())
    assert raw[:3] == HEX("EE1816") and len(raw) == 26
    assert raw[3:25] == P.pack_channels(P.centred_channels())


def test_model_id_frame_matches_relay_design_and_edgetx() -> None:
    raw = C.build_model_id_frame(9)
    # relay design: EE 08 32 EE EA 10 05 <id> <crc8_BA> <crc8_D5>
    assert raw[:8] == HEX("EE0832EEEA100509") and len(raw) == 10
    assert raw[8] == C.crc8_ba(raw[2:8])        # EdgeTX: crc8_BA(frame + 2, 6)
    assert raw[9] == C.crc8_d5(raw[2:9])        # EdgeTX: crc8(frame + 2, 7)
    with pytest.raises(C.CrsfError):
        C.build_model_id_frame(256)


def test_device_ping_matches_elrs_lua() -> None:
    # elrs.lua: crossfireTelemetryPush(0x28, { 0x00, 0xEA })
    assert C.build_device_ping()[2:5] == HEX("2800EA")


@pytest.mark.parametrize("ptype,value,expected", [
    (C.ParamType.UINT8, 200, "C8"), (C.ParamType.INT8, -2, "FE"), (C.ParamType.UINT16, 0x1234, "1234"),
    (C.ParamType.INT16, -300, "FED4"), (C.ParamType.TEXT_SELECTION, 3, "03"), (C.ParamType.COMMAND, 1, "01"),
    (C.ParamType.UINT32, 1, "00000001"), (C.ParamType.FLOAT, -1, "FFFFFFFF")])
def test_encode_param_value_big_endian(ptype: int, value: int, expected: str) -> None:
    assert C.encode_param_value(ptype, value).hex().upper() == expected


def test_encode_param_value_rejects_folder() -> None:
    with pytest.raises(C.CrsfError):
        C.encode_param_value(C.ParamType.FOLDER, 0)


# --------------------------------------------------------------------------- flight mode

@pytest.mark.parametrize("item", V["flight_modes"], ids=lambda i: i["raw"] or "<empty>")
def test_flight_mode_vectors(item: dict) -> None:
    s = C.interpret_flight_mode(item["raw"])
    for key in ("mode", "suffix", "failsafe", "armed", "ready_to_arm", "arming_disabled", "rescue_not_ready", "rth"):
        assert getattr(s, key) == item[key], key


@pytest.mark.parametrize("raw,failsafe,armed,rnr,mode", [
    ("!FS!", True, False, False, "!FS!"), ("ANGL*", False, False, False, "ANGL"),
    ("ANGL!", False, False, False, "ANGL"), ("ANGL?", False, False, True, "ANGL"),
    ("ANGL", False, True, False, "ANGL"), ("RTH", False, True, False, "RTH"),
    ("ACRO\0junk", False, True, False, "ACRO"), ("", False, None, False, "")])
def test_flight_mode_rules(raw: str, failsafe: bool, armed: bool | None, rnr: bool, mode: str) -> None:
    s = C.interpret_flight_mode(raw)
    assert (s.failsafe, s.armed, s.rescue_not_ready, s.mode) == (failsafe, armed, rnr, mode)


def test_flight_mode_failsafe_is_contains() -> None:
    """plan §14.2: 'flight-mode string contains !FS!'."""
    s = C.interpret_flight_mode("X!FS!")
    assert s.failsafe and s.mode == "!FS!" and s.armed is False
    assert C.interpret_flight_mode("!FS!*").suffix == "*"


def test_rc_raw_builder_passes_any_value() -> None:
    packed = P.pack_channels([0, 2047] * 8, strict=False)
    raw = C.build_rc_channels_frame_raw(packed)
    assert raw[:3] == HEX("EE1816") and raw[3:25] == packed
    assert list(C.decode_rc_channels(C.parse_frame(raw))) == [0, 2047] * 8
    assert C.build_rc_channels_frame([0, 2047] * 8, strict=False) == raw
    with pytest.raises(P.FieldError):
        C.build_rc_channels_frame([0, 2047] * 8)
    with pytest.raises(C.CrsfError):
        C.build_rc_channels_frame_raw(packed[:21])


def test_flight_mode_frame_is_null_terminated() -> None:
    raw = C.telemetry_frame(C.FlightMode("ANGL*"))
    assert raw[3:-1] == b"ANGL*\0"
    assert C.decode_frame(C.parse_frame(raw)).status.ready_to_arm


# --------------------------------------------------------------------------- parameters

@pytest.mark.parametrize("item", V["parameter_entries"], ids=ids(V["parameter_entries"]))
def test_parameter_entry_vectors(item: dict) -> None:
    asm = C.ParameterAssembler()
    entry = None
    for i, hx in enumerate(item["frames"]):
        assert asm.next_chunk == i
        chunk = C.decode_frame(C.parse_frame(HEX(hx)))
        assert isinstance(chunk, C.ParameterChunk)
        assert chunk.chunks_remaining == len(item["frames"]) - 1 - i
        entry = asm.feed(chunk)
        assert (entry is None) == (i < len(item["frames"]) - 1)
    assert entry is not None
    d = {k: getattr(entry, k) for k in entry.__dataclass_fields__}
    d["raw"] = entry.raw.hex().upper()
    _approx(d, item["decoded"])


def test_parameter_vectors_cover_common_types_and_chunking() -> None:
    types = {i["decoded"]["type"] for i in V["parameter_entries"]}
    P_ = C.ParamType
    assert types >= {P_.UINT8, P_.INT8, P_.UINT16, P_.INT16, P_.FLOAT, P_.TEXT_SELECTION, P_.STRING,
                     P_.FOLDER, P_.INFO, P_.COMMAND}
    assert any(len(i["frames"]) > 1 for i in V["parameter_entries"])
    assert all(len(HEX(f)) <= 64 for i in V["parameter_entries"] for f in i["frames"])


def test_parameter_selection_label_and_hidden() -> None:
    (item,) = [i for i in V["parameter_entries"] if i["decoded"]["name"] == "Max Power"]
    data = HEX(item["decoded"]["raw"])
    e = C.parse_parameter_entry(4, data)
    assert e.hidden and e.value_label == "25mW" and e.parent == 3


def test_parameter_assembler_discards_mismatched_chunk() -> None:
    entry = C.ParameterEntry(15, 0, C.ParamType.TEXT_SELECTION, False, "x" * 40, value=1, min=0, max=3,
                             options=["option-a" * 3, "option-b" * 3, "c", "d"])
    frames = C.build_parameter_entry_frames(15, C.encode_parameter_entry(entry))
    assert len(frames) >= 2
    chunks = [C.decode_frame(C.parse_frame(f)) for f in frames]
    asm = C.ParameterAssembler()
    assert asm.feed(chunks[0]) is None and asm.next_chunk == 1
    other = C.ParameterChunk(0xEA, 0xEE, 3, 0, b"")
    assert asm.feed(other) is None and asm.next_chunk == 0       # reset: request chunk 0 again
    results = [asm.feed(c) for c in chunks]
    assert results[-1] is not None and results[-1].options == entry.options


def test_parameter_chunking_matches_elrs_header_rule() -> None:
    data = bytes(range(130))
    frames = C.build_parameter_entry_frames(5, data)
    assert [f[6] for f in frames] == [2, 1, 0]             # chunks remaining
    assert all(f[5] == 5 for f in frames)                   # param number
    assert b"".join(f[7:-1] for f in frames) == data


def test_parse_parameter_entry_errors() -> None:
    with pytest.raises(C.CrsfError):
        C.parse_parameter_entry(1, b"\x00")
    with pytest.raises(C.CrsfError):
        C.parse_parameter_entry(1, b"\x00\x0bFolder\x00\x01\x02")   # folder without 0xFF
    with pytest.raises(C.CrsfError):
        C.parse_parameter_entry(1, b"\x00\x02Name\x00\x01")        # uint16 truncated
