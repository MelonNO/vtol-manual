#!/usr/bin/env python3
"""Regenerate ``protocol/test-vectors.json`` from the reference implementation.

Usage (from the repository root)::

    python gcs/tools/gen_test_vectors.py            # write protocol/test-vectors.json
    python gcs/tools/gen_test_vectors.py --check    # exit 1 if the file is out of date

Items marked ``"external": true`` are NOT produced by this code: they are copied
from third-party test suites (EdgeTX) and are what the reference code is checked
against.  Everything else is generated, then verified by ``gcs/tests``.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import struct
import sys
from typing import Any

try:
    from vtolgcs import crsf, protocol
except ImportError:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from vtolgcs import crsf, protocol

from vtolgcs.crsf import Addr, FrameType, ParamType
from vtolgcs.protocol import BridgeState, CrsfFwd, CrsfPass, RcUp, Status

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, "protocol", "test-vectors.json")

ETX = "https://github.com/EdgeTX/edgetx/blob/65db64b4890c399b8fcc9cc6a3d002c2b86e4706/radio/src/tests/crossfire.cpp"
CRC_CAT = "https://reveng.sourceforge.io/crc-catalogue/all.htm"


def h(data: bytes) -> str:
    return bytes(data).hex().upper()


def asdict(obj: Any) -> dict[str, Any]:
    d = dataclasses.asdict(obj)
    for k, v in list(d.items()):
        if isinstance(v, bytes):
            d[k] = h(v)
        elif isinstance(v, BridgeState):
            d[k] = int(v)
    return d


def _ver_patch(packet: bytes, ver: int) -> bytes:
    """Same packet with another ver byte and a *correct* CRC (so only the version is wrong)."""
    body = packet[:2] + bytes((ver,)) + packet[3:-2]
    return body + struct.pack("<H", protocol.crc16_ccitt_false(body))


def gen() -> dict[str, Any]:
    v: dict[str, Any] = {
        "meta": {
            "title": "Relay UDP protocol v1 + CRSF test vectors",
            "status": "PROPOSAL v1 — agree with G0 firmware before flight",
            "protocol_version": protocol.PROTOCOL_VERSION,
            "hex": "uppercase, no separators, bytes in wire order",
            "generator": "gcs/tools/gen_test_vectors.py (reference code: gcs/vtolgcs/protocol.py, crsf.py)",
            "spec": "protocol/README.md",
            "external_items": "items with \"external\": true come from the cited source, not from this code",
        }
    }

    # ---------------------------------------------------------------- CRCs
    check = b"123456789"
    v["crc"] = [
        {"algo": "crc16_ccitt_false", "input_ascii": "123456789", "value": "29B1",
         "external": True, "source": CRC_CAT + " (CRC-16/IBM-3740 a.k.a. CCITT-FALSE, check=0x29b1)"},
        {"algo": "crc16_ccitt_false", "input_hex": "", "value": "FFFF"},
        {"algo": "crc8_d5", "input_ascii": "123456789", "value": "BC",
         "external": True, "source": CRC_CAT + " (CRC-8/DVB-S2, poly 0xd5, check=0xbc)"},
        {"algo": "crc8_d5", "input_hex": "1400000000FF0103000000", "value": "F4", "external": True,
         "source": ETX + " TEST(Crossfire, crc8)"},
        {"algo": "crc8_d5", "input_hex": "3AEAEE1000009C400000001C", "value": "D7", "external": True,
         "source": ETX + " droppedBytes2 (first frame with its length byte restored)"},
        {"algo": "crc8_ba", "input_ascii": "123456789", "value": f"{crsf.crc8_ba(check):02X}",
         "note": "generated; poly 0xBA is not a catalogued CRC — cross-checked via the EdgeTX table in tests"},
    ]

    # ---------------------------------------------------------------- channel scaling / packing
    v["us_to_crsf"] = [{"us": us, "crsf": protocol.us_to_crsf(us)}
                       for us in (880, 987.5, 988, 1000, 1250, 1500, 1750, 2000, 2012, 2100)]
    lo, mid, hi = protocol.CRSF_CHANNEL_MIN, protocol.CRSF_CHANNEL_MID, protocol.CRSF_CHANNEL_MAX
    channel_sets = {
        "centred": [mid] * 16,
        "full_scale_min": [lo] * 16,
        "full_scale_max": [hi] * 16,
        "alternating_min_max": [lo if i % 2 == 0 else hi for i in range(16)],
        "ch1_max_rest_min": [hi] + [lo] * 15,
        "ch16_max_rest_min": [lo] * 15 + [hi],
        "aetr_arm_high": [mid, mid, lo, mid, hi] + [lo] * 11,
    }
    v["channels"] = [{"name": n, "channels": c, "packed": h(protocol.pack_channels(c))}
                     for n, c in channel_sets.items()]
    etx_vals = [min(max(0, 992 + int((-1024 + 128 * i) * 4 / 5)), 1984) for i in range(16)]
    v["channels"].append({
        "name": "edgetx_ramp", "external": True,
        "source": ETX + " TEST(Crossfire, createCrossfireChannelsFrame): pulses[i] = -1024 + 128*i, "
                        "value = 992 + pulses*4/5 (C truncation)",
        "channels": etx_vals, "packed": "ADA0885EC073A456514C6FE033222B279A57F01A99D5"})

    # ---------------------------------------------------------------- rc_up
    rc_cases = [
        ("centred_cam_off_seq1", RcUp(1, 0, tuple(channel_sets["centred"]))),
        ("centred_cam_on", RcUp(2, 4000, tuple(channel_sets["centred"]), cam_enable=True)),
        ("full_scale_min", RcUp(1000, 123456789, tuple(channel_sets["full_scale_min"]))),
        ("full_scale_max_cam_on", RcUp(1001, 123460789, tuple(channel_sets["full_scale_max"]), cam_enable=True)),
        ("arm_high", RcUp(0x00010203, 0x0A0B0C0D, tuple(channel_sets["aetr_arm_high"]))),
        ("seq_and_time_max", RcUp(0xFFFFFFFF, 0xFFFFFFFF, tuple(channel_sets["alternating_min_max"]))),
        ("reserved_flag_bits_set", RcUp(7, 7, tuple(channel_sets["centred"]), cam_enable=True,
                                        reserved_flags=0xFE)),
    ]
    v["rc_up"] = []
    for name, pkt in rc_cases:
        f = asdict(pkt)
        f["channels"] = list(pkt.channels)
        item = {"name": name, "fields": f, "hex": h(pkt.pack())}
        if name == "reserved_flag_bits_set":
            item["note"] = "senders must send reserved bits as 0; receivers ignore them (bridge still accepts)"
        v["rc_up"].append(item)

    # ---------------------------------------------------------------- status
    fw = protocol.fw_ver_encode(0, 1)
    st_cases = [
        ("boot", Status(BridgeState.BOOT, 1, 0, fw_ver=fw)),
        ("wait_gcs_p2_up", Status(BridgeState.WAIT_GCS, 2, 0, p2_link_100fd=True, fw_ver=fw)),
        ("start", Status(BridgeState.START, 3, 4000, p2_link_100fd=True, fw_ver=fw, rx_ok=5,
                         crsf_tx=1, sync_period_x10us=40000, sync_offset_x10us=1200)),
        ("run_locked_cam_on", Status(BridgeState.RUN, 1000, 123456789, camera_on_readback=True,
                                     timing_locked=True, p2_link_100fd=True, fw_ver=fw, rx_ok=25000,
                                     rx_bad_crc=3, rx_bad_seq=1, crsf_tx=24990,
                                     sync_period_x10us=50000, sync_offset_x10us=-15)),
        ("failsafe", Status(BridgeState.FAILSAFE, 1001, 123456789, p2_link_100fd=True, fw_ver=fw,
                            rx_ok=25000, rx_bad_crc=3, rx_bad_seq=1, crsf_tx=25050)),
        ("all_flags_counters_max", Status(BridgeState.RUN, 0xFFFFFFFF, 0xFFFFFFFF, True, True, True, True, True,
                                          fw_ver=0xFFFF, rx_ok=0xFFFFFFFF, rx_bad_crc=0xFFFFFFFF,
                                          rx_bad_seq=0xFFFFFFFF, crsf_tx=0xFFFFFFFF,
                                          sync_period_x10us=0x7FFFFFFF, sync_offset_x10us=-0x80000000)),
    ]
    v["status"] = [{"name": n, "fields": asdict(s), "hex": h(s.pack())} for n, s in st_cases]

    # ---------------------------------------------------------------- CRSF frames (decoders)
    frames: list[dict[str, Any]] = []

    def add(name: str, raw: bytes, decoder: str, decoded: dict[str, Any], **extra: Any) -> None:
        frames.append({"name": name, "hex": h(raw), "type": raw[2], "decoder": decoder,
                       "decoded": decoded, **extra})

    ls = crsf.LinkStatistics(-60, -62, 100, 8, 0, 6, 7, -70, 100, 6)
    add("link_statistics", crsf.telemetry_frame(ls), "LinkStatistics", {**asdict(ls), "tx_power_mw": 250})
    ls11 = crsf.LinkStatistics(-95, -101, 42, -3, 1, 4, 3, -99, 38, -5, -103)
    add("link_statistics_elrs_11b", crsf.telemetry_frame(ls11), "LinkStatistics",
        {**asdict(ls11), "tx_power_mw": 100})
    add("link_statistics_edgetx", bytes.fromhex("000C1400000000FF0103000000F4"), "LinkStatistics",
        {**asdict(crsf.LinkStatistics(0, 0, 0, 0, 255, 1, 3, 0, 0, 0)), "tx_power_mw": 100},
        external=True, source=ETX + " TEST(Crossfire, crc8) (address byte 0x00 replaced by 0xC8)",
        hex_original="000C1400000000FF0103000000F4")
    frames[-1]["hex"] = "C80C1400000000FF0103000000F4"
    gps = crsf.Gps(59.9123456, 10.7654321, 54.3, 271.5, 87, 14)
    add("gps", crsf.telemetry_frame(gps), "Gps", asdict(gps))
    gps_s = crsf.Gps(-33.8688197, -151.2092955, 0.0, 0.0, -12, 5)
    add("gps_southern_western_negative_alt", crsf.telemetry_frame(gps_s), "Gps", asdict(gps_s))
    bat = crsf.Battery(23.4, 18.7, 845, 35)
    add("battery", crsf.telemetry_frame(bat), "Battery", asdict(bat))
    att = crsf.Attitude(-0.0523, 0.4636, -3.1415)
    add("attitude", crsf.telemetry_frame(att), "Attitude", asdict(att))
    for text in ("ANGL*", "ANGL", "!FS!", "RTH", "ACRO!", "HOR?", "AIR"):
        fm = crsf.FlightMode(text)
        add(f"flight_mode_{text}", crsf.telemetry_frame(fm), "FlightMode",
            {"text": text, **_fm_dict(crsf.interpret_flight_mode(text))})
    var = crsf.Vario(-1.25)
    add("vario", crsf.telemetry_frame(var), "Vario", asdict(var))
    baro_bf = crsf.BaroAltitude(123.4, crsf.BaroAltitude.unpack_vspd_bf(crsf.BaroAltitude.pack_vspd_bf(2.0)),
                                "betaflight")
    add("baro_altitude_betaflight_3b", crsf.telemetry_frame(baro_bf), "BaroAltitude", asdict(baro_bf))
    baro_el = crsf.BaroAltitude(-12.3, -0.5, "elrs")
    add("baro_altitude_elrs_4b", crsf.telemetry_frame(baro_el), "BaroAltitude", asdict(baro_el))
    baro_hi = crsf.BaroAltitude(3000.0, None, "none")
    add("baro_altitude_metres_mode", crsf.telemetry_frame(baro_hi), "BaroAltitude", asdict(baro_hi))
    tim = crsf.RadioTiming(Addr.RADIO_TRANSMITTER, Addr.CRSF_TRANSMITTER, 50000, -1234)
    add("radio_timing_200hz_negative_offset", tim.to_frame(), "RadioTiming",
        {**asdict(tim), "interval_us": 5000.0})
    add("radio_timing_edgetx", bytes.fromhex("C80D3AEAEE1000009C400000001CD7"), "RadioTiming",
        {"dest": 0xEA, "origin": 0xEE, "rate_x10us": 40000, "offset_x10us": 28, "interval_us": 4000.0},
        external=True, source=ETX + " droppedBytes2 (frame with its length byte 0x0D restored)")
    di = crsf.DeviceInfo(Addr.RADIO_TRANSMITTER, Addr.CRSF_TRANSMITTER, "RM Nomad", crsf.ELRS_SERIAL,
                         0, 0x00030500, 42, 0)
    add("device_info_elrs", di.to_frame(), "DeviceInfo", {**asdict(di), "is_elrs": True,
                                                          "software_version_str": "3.5.0"})
    chunk = crsf.build_parameter_entry_frames(1, b"\x00\x09Packet Rate\x0050Hz;150Hz\x00\x01\x00\x01\x00\x00")[0]
    add("parameter_chunk", chunk, "ParameterChunk",
        {"dest": 0xEA, "origin": 0xEE, "param_number": 1, "chunks_remaining": 0,
         "data": "0009" + h(b"Packet Rate\x0050Hz;150Hz\x00") + "0100010000"})
    v["crsf_frames"] = frames

    # ---------------------------------------------------------------- parameter entries (assembled)
    P = ParamType
    entries = [
        crsf.ParameterEntry(1, 0, P.TEXT_SELECTION, False, "Packet Rate", value=2, min=0, max=3, default=0,
                            options=["50Hz", "150Hz", "250Hz", "500Hz"], units=""),
        crsf.ParameterEntry(4, 3, P.TEXT_SELECTION, True, "Max Power", value=1, min=0, max=3, default=0,
                            options=["10", "25", "100", "250"], units="mW"),
        crsf.ParameterEntry(3, 0, P.FOLDER, False, "TX Power", children=[4, 5, 6]),
        crsf.ParameterEntry(7, 0, P.UINT8, False, "Model Id", value=12, min=0, max=63, default=0, units=""),
        crsf.ParameterEntry(8, 0, P.INT8, False, "Trim", value=-5, min=-20, max=20, default=0, units="pts"),
        crsf.ParameterEntry(9, 0, P.UINT16, False, "Period", value=4000, min=1000, max=20000, default=0, units="us"),
        crsf.ParameterEntry(10, 0, P.INT16, False, "Offset", value=-300, min=-1000, max=1000, default=0, units="us"),
        crsf.ParameterEntry(11, 0, P.FLOAT, False, "Gain", value=-125, min=-1000, max=1000, default=0,
                            precision=2, step=5, units="x"),
        crsf.ParameterEntry(12, 0, P.INFO, False, "Version", value="3.5.0 ISM2G4"),
        crsf.ParameterEntry(13, 0, P.STRING, False, "Name", value="relay", max_length=16),
        crsf.ParameterEntry(14, 0, P.COMMAND, False, "Bind", value=0, timeout_ms=2000, info=""),
        crsf.ParameterEntry(15, 0, P.TEXT_SELECTION, False,
                            "Long option list that needs more than one chunk",
                            value=5, min=0, max=9, default=0,
                            options=[f"Option number {i}" for i in range(10)], units=""),
    ]
    v["parameter_entries"] = []
    for e in entries:
        data = crsf.encode_parameter_entry(e)
        decoded = asdict(e)
        decoded["raw"] = h(data)
        v["parameter_entries"].append({
            "name": f"{e.type_name.lower()}_{e.number}",
            "frames": [h(f) for f in crsf.build_parameter_entry_frames(e.number, data)],
            "decoded": decoded})

    # ---------------------------------------------------------------- builders
    v["crsf_builders"] = [
        {"name": "rc_centred", "builder": "build_rc_channels_frame", "args": {"channels": channel_sets["centred"]},
         "hex": h(crsf.build_rc_channels_frame(channel_sets["centred"]))},
        {"name": "rc_arm_high", "builder": "build_rc_channels_frame",
         "args": {"channels": channel_sets["aetr_arm_high"]},
         "hex": h(crsf.build_rc_channels_frame(channel_sets["aetr_arm_high"]))},
        {"name": "model_id_0", "builder": "build_model_id_frame", "args": {"model_id": 0},
         "hex": h(crsf.build_model_id_frame(0))},
        {"name": "model_id_17", "builder": "build_model_id_frame", "args": {"model_id": 17},
         "hex": h(crsf.build_model_id_frame(17))},
        {"name": "device_ping_broadcast", "builder": "build_device_ping", "args": {},
         "hex": h(crsf.build_device_ping())},
        {"name": "param_read_1_chunk0", "builder": "build_param_read", "args": {"param": 1, "chunk": 0},
         "hex": h(crsf.build_param_read(1, 0))},
        {"name": "param_read_15_chunk1", "builder": "build_param_read", "args": {"param": 15, "chunk": 1},
         "hex": h(crsf.build_param_read(15, 1))},
        {"name": "param_write_select", "builder": "build_param_write",
         "args": {"param": 1, "type": int(P.TEXT_SELECTION), "value": 3},
         "hex": h(crsf.build_param_write(1, crsf.encode_param_value(P.TEXT_SELECTION, 3)))},
        {"name": "param_write_int16", "builder": "build_param_write",
         "args": {"param": 10, "type": int(P.INT16), "value": -300},
         "hex": h(crsf.build_param_write(10, crsf.encode_param_value(P.INT16, -300)))},
        {"name": "param_write_command_click", "builder": "build_param_write",
         "args": {"param": 14, "type": int(P.COMMAND), "value": int(crsf.CommandStep.CLICK)},
         "hex": h(crsf.build_param_write(14, crsf.encode_param_value(P.COMMAND, crsf.CommandStep.CLICK)))},
    ]

    # ---------------------------------------------------------------- crsf_fwd / crsf_pass
    fwd_frames = [("link_statistics", crsf.telemetry_frame(ls)),
                  ("flight_mode_fs", crsf.telemetry_frame(crsf.FlightMode("!FS!"))),
                  ("gps", crsf.telemetry_frame(gps)),
                  ("max_size_64", crsf.build_parameter_entry_frames(15, crsf.encode_parameter_entry(entries[-1]))[0])]
    v["crsf_fwd"] = [{"name": n, "frame": h(f), "hex": h(CrsfFwd(f).pack())} for n, f in fwd_frames]
    pass_frames = [("device_ping", crsf.build_device_ping()), ("param_read", crsf.build_param_read(1, 0)),
                   ("param_write", crsf.build_param_write(1, b"\x03"))]
    v["crsf_pass"] = [{"name": n, "frame": h(f), "hex": h(CrsfPass(f).pack())} for n, f in pass_frames]

    # ---------------------------------------------------------------- malformed UDP
    rc = RcUp(1, 0, tuple(channel_sets["centred"])).pack()
    st = st_cases[3][1].pack()
    fwd = CrsfFwd(crsf.telemetry_frame(ls)).pack()
    psp = CrsfPass(crsf.build_device_ping()).pack()
    bad = lambda b, i: b[:i] + bytes((b[i] ^ 0x01,)) + b[i + 1:]  # noqa: E731
    fwd_lenmis = b"RF\x01" + bytes((fwd[3] + 1,)) + fwd[4:-2]
    fwd_lenmis += struct.pack("<H", protocol.crc16_ccitt_false(fwd_lenmis))
    fwd_inner = bytearray(fwd[:-2])
    fwd_inner[5] = 0x0B      # inner CRSF length byte no longer matches len
    fwd_inner = bytes(fwd_inner) + struct.pack("<H", protocol.crc16_ccitt_false(bytes(fwd_inner)))
    fwd_short = b"RF\x01\x03\xC8\x01\x14"
    fwd_short += struct.pack("<H", protocol.crc16_ccitt_false(fwd_short))
    v["malformed"] = [
        {"name": "rc_up_bad_crc", "message": "rc_up", "hex": h(bad(rc, 34)), "error": "CrcError"},
        {"name": "rc_up_payload_bit_flip", "message": "rc_up", "hex": h(bad(rc, 20)), "error": "CrcError"},
        {"name": "rc_up_ver_2", "message": "rc_up", "hex": h(_ver_patch(rc, 2)), "error": "VersionError"},
        {"name": "rc_up_ver_0", "message": "rc_up", "hex": h(_ver_patch(rc, 0)), "error": "VersionError"},
        {"name": "rc_up_truncated_35", "message": "rc_up", "hex": h(rc[:35]), "error": "LengthError"},
        {"name": "rc_up_too_long_37", "message": "rc_up", "hex": h(rc + b"\x00"), "error": "LengthError"},
        {"name": "rc_up_bad_magic", "message": "rc_up", "hex": h(b"RX" + rc[2:]), "error": "MagicError"},
        {"name": "rc_up_two_bytes", "message": "rc_up", "hex": h(rc[:2]), "error": "LengthError"},
        {"name": "empty", "message": "rc_up", "hex": "", "error": "LengthError"},
        {"name": "status_bad_crc", "message": "status", "hex": h(bad(st, 41)), "error": "CrcError"},
        {"name": "status_ver_2", "message": "status", "hex": h(_ver_patch(st, 2)), "error": "VersionError"},
        {"name": "status_truncated_41", "message": "status", "hex": h(st[:41]), "error": "LengthError"},
        {"name": "status_unknown_state_5", "message": "status",
         "hex": h(_state_patch(st, 5)), "error": "FieldError"},
        {"name": "crsf_fwd_bad_crc", "message": "crsf_fwd", "hex": h(bad(fwd, len(fwd) - 1)), "error": "CrcError"},
        {"name": "crsf_fwd_ver_2", "message": "crsf_fwd", "hex": h(_ver_patch(fwd, 2)), "error": "VersionError"},
        {"name": "crsf_fwd_truncated", "message": "crsf_fwd", "hex": h(fwd[:-3]), "error": "LengthError"},
        {"name": "crsf_fwd_len_field_mismatch", "message": "crsf_fwd", "hex": h(fwd_lenmis), "error": "LengthError"},
        {"name": "crsf_fwd_inner_length_mismatch", "message": "crsf_fwd", "hex": h(fwd_inner), "error": "FieldError"},
        {"name": "crsf_fwd_len_below_4", "message": "crsf_fwd", "hex": h(fwd_short), "error": "LengthError"},
        {"name": "crsf_pass_bad_crc", "message": "crsf_pass", "hex": h(bad(psp, 6)), "error": "CrcError"},
        {"name": "crsf_pass_ver_2", "message": "crsf_pass", "hex": h(_ver_patch(psp, 2)), "error": "VersionError"},
        {"name": "status_magic_as_rc_up", "message": "rc_up", "hex": h(st), "error": "MagicError"},
    ]

    # ---------------------------------------------------------------- CRSF streams / malformed frames
    good = [crsf.telemetry_frame(ls), crsf.telemetry_frame(crsf.FlightMode("ANGL*")), tim.to_frame()]
    garbage = bytes.fromhex("00FF1234C8FFEE01EA00")
    corrupt = bytearray(good[0])
    corrupt[5] ^= 0xFF
    v["crsf_streams"] = [
        {"name": "garbage_between_frames", "stream": h(garbage + good[0] + garbage + good[1] + good[2] + b"\xC8"),
         "frames": [h(f) for f in good]},
        {"name": "corrupt_frame_then_good", "stream": h(bytes(corrupt) + good[1] + good[2]),
         "frames": [h(good[1]), h(good[2])]},
        {"name": "truncated_frame_then_good", "stream": h(good[0][:7] + good[1]), "frames": [h(good[1])]},
        _etx_stream("edgetx_invalid_frames",
                    "EA14FF11FD0500001301012A000000000000015D98B40035A4EA21FF1EFD1200001401014A0000000000000000"
                    "00008FC2353FFDC7D13C4C01923F31EA020001EA1FFF1CFD100000150101240000357DF240E803E803DC05DC05"
                    "E105E1052AFE5F",
                    3, "TEST(Crossfire, frameParser_badFrames) invalid_frames[]: frames of len 0x14, 0x21, 0x1F "
                       "survive random bytes and a bad-CRC frame"),
        _etx_stream("edgetx_dropped_bytes",
                    "C80C14D0006409001DC9640879C80DFFEAEE1000004E200000004AF3",
                    1, "TEST(Crossfire, frameParser_droppedBytes) droppedBytes[]: first frame is missing a "
                       "payload byte; only the second (13-byte) frame is valid"),
        _etx_stream("edgetx_dropped_length_byte",
                    "C83AEAEE1000009C400000001CD7C80DF0EAEE1000009C40000000385CC80CF1D700640C001B01D2640BFE"
                    "C80DF2EAEE1000009C4000000041DBC80CF3D600640C001B01D1640B64",
                    4, "TEST(Crossfire, frameParser_droppedBytes) droppedBytes2[]: first frame lost its length "
                       "byte; the 4 frames after it are recovered"),
        _etx_stream("edgetx_length_error3",
                    "EA09FF11FD05000013018C2A095F00EA09FF11FD05000013018C",
                    2, "TEST(Crossfire, frameParser_length) length_error3[]: two valid frames around an "
                       "invalid frame start"),
        _etx_stream("edgetx_split_incomplete_then_cont",
                    "EA14FF11FD0500001301012A000000000000015D98B4EA21FF1EFD1200001401014A000000000000000000008F"
                    "C2353FFDC7D13C4C01923F31EA1FFF1CFD1000"
                    "00150101240000357DF240E803E803DC05DC05E105E1052AFE5FEA0A0B",
                    3, "TEST(Crossfire, frameParser_incompleteFrames) incomplete_frame[] + cont_frame[]: 3 frames, "
                       "3 bytes (EA 0A 0B) left pending",
                    chunks=[64, 29], pending=3),
    ]
    v["crsf_malformed"] = [
        {"name": "bad_crc", "hex": h(bytes(corrupt)), "error": "CrsfError"},
        {"name": "length_byte_too_big", "hex": "C83F1400", "error": "CrsfError"},
        {"name": "length_byte_too_small", "hex": "C8011400", "error": "CrsfError"},
        {"name": "bad_sync", "hex": h(b"\x2A" + good[0][1:]), "error": "CrsfError"},
        {"name": "timing_wrong_subtype", "hex": h(crsf.build_ext_frame(FrameType.RADIO_ID, 0xEA, 0xEE,
                                                                       b"\x11" + bytes(8), 0xEA)),
         "error": "CrsfError", "decode": True},
        {"name": "gps_short_payload", "hex": h(crsf.build_frame(FrameType.GPS, bytes(14), 0xEA)),
         "error": "CrsfError", "decode": True},
    ]

    v["flight_modes"] = [_fm_dict(crsf.interpret_flight_mode(t)) | {"raw": t}
                         for t in ("ANGL*", "ANGL!", "ANGL?", "ANGL", "ACRO", "AIR*", "HOR", "RTH", "RTH*",
                                   "!FS!", "!FS!*", "POSH?", "ALTH!", "")]
    return v


def _fm_dict(s: crsf.FlightModeStatus) -> dict[str, Any]:
    return {"mode": s.mode, "suffix": s.suffix, "failsafe": s.failsafe, "armed": s.armed,
            "ready_to_arm": s.ready_to_arm, "arming_disabled": s.arming_disabled,
            "rescue_not_ready": s.rescue_not_ready, "rth": s.rth}


def _state_patch(packet: bytes, state: int) -> bytes:
    body = packet[:3] + bytes((state,)) + packet[4:-2]
    return body + struct.pack("<H", protocol.crc16_ccitt_false(body))


def _etx_stream(name: str, hexstr: str, count: int, note: str, **extra: Any) -> dict[str, Any]:
    stream = bytes.fromhex(hexstr)
    if "chunks" in extra:
        assert sum(extra["chunks"]) == len(stream)
    return {"name": name, "stream": h(stream), "frame_count": count, "external": True,
            "source": ETX + " " + note, **extra}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="fail if the file is out of date")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()
    text = json.dumps(gen(), indent=1, ensure_ascii=False) + "\n"
    if args.check:
        with open(args.out, encoding="utf-8") as f:
            same = f.read() == text
        print("up to date" if same else "OUT OF DATE")
        return 0 if same else 1
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
