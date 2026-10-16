"""Tests for vtolgcs.protocol (relay UDP protocol v1, contract C3)."""

from __future__ import annotations

import random
import struct

import pytest

from _vectors import ids, vectors
from vtolgcs import protocol as P
from vtolgcs.protocol import BridgeState, CrsfFwd, CrsfPass, RcUp, Status

V = vectors()
HEX = bytes.fromhex


# --------------------------------------------------------------------------- CRC

def test_crc16_check_value() -> None:
    assert P.crc16_ccitt_false(b"123456789") == 0x29B1


def test_crc16_empty_is_init() -> None:
    assert P.crc16_ccitt_false(b"") == 0xFFFF


@pytest.mark.parametrize("item", [c for c in V["crc"] if c["algo"] == "crc16_ccitt_false"])
def test_crc16_vectors(item: dict) -> None:
    data = item["input_ascii"].encode() if "input_ascii" in item else HEX(item["input_hex"])
    assert P.crc16_ccitt_false(data) == int(item["value"], 16)


def test_crc16_detects_every_single_bit_flip() -> None:
    pkt = RcUp(5, 6, tuple(P.centred_channels())).pack()
    for i in range(len(pkt) * 8):
        broken = bytearray(pkt)
        broken[i // 8] ^= 1 << (i % 8)
        with pytest.raises(P.ProtocolError):
            RcUp.unpack(bytes(broken))


# --------------------------------------------------------------------------- channel scaling

@pytest.mark.parametrize("us,expected", [(988, 173), (1500, 992), (2012, 1811), (1000, 192), (2000, 1792),
                                         (987.5, 172), (500, 172), (2500, 1811)])
def test_us_to_crsf_anchor_points(us: float, expected: int) -> None:
    assert P.us_to_crsf(us) == expected


@pytest.mark.parametrize("item", V["us_to_crsf"], ids=lambda i: str(i["us"]))
def test_us_to_crsf_vectors(item: dict) -> None:
    assert P.us_to_crsf(item["us"]) == item["crsf"]


def test_crsf_to_us_inverts_within_one_count() -> None:
    assert P.crsf_to_us(992) == 1500
    for value in range(P.CRSF_CHANNEL_MIN, P.CRSF_CHANNEL_MAX + 1):
        assert P.us_to_crsf(P.crsf_to_us(value)) == value


def test_us_to_crsf_rejects_nan() -> None:
    with pytest.raises(P.FieldError):
        P.us_to_crsf(float("nan"))


# --------------------------------------------------------------------------- channel packing

@pytest.mark.parametrize("item", V["channels"], ids=ids(V["channels"]))
def test_channel_vectors(item: dict) -> None:
    assert P.pack_channels(item["channels"]).hex().upper() == item["packed"]
    assert list(P.unpack_channels(HEX(item["packed"]))) == item["channels"]


def test_channel_packing_matches_edgetx_external_vector() -> None:
    """Independent cross-check: EdgeTX's own gtest expected bytes (see test-vectors.json source)."""
    (item,) = [c for c in V["channels"] if c.get("external")]
    assert "EdgeTX" in item["source"]
    assert P.pack_channels(item["channels"]) == HEX("ADA0885EC073A456514C6FE033222B279A57F01A99D5")


def test_channel_bit_order_lsb_first() -> None:
    chans = [P.CRSF_CHANNEL_MIN] * 16
    chans[0] = 0x7FF & P.CRSF_CHANNEL_MAX     # 1811 = 0x713
    packed = P.pack_channels(chans)
    assert packed[0] == 0x13 and packed[1] & 0x07 == 0x07   # low 8 bits first, then the top 3


@pytest.mark.parametrize("value", [P.CRSF_CHANNEL_MIN, P.CRSF_CHANNEL_MID, P.CRSF_CHANNEL_MAX])
def test_channel_edge_values_each_position(value: int) -> None:
    for pos in range(16):
        chans = [P.CRSF_CHANNEL_MID] * 16
        chans[pos] = value
        assert list(P.unpack_channels(P.pack_channels(chans))) == chans


def test_channel_random_round_trip() -> None:
    rng = random.Random(1234)
    for _ in range(500):
        chans = [rng.randint(P.CRSF_CHANNEL_MIN, P.CRSF_CHANNEL_MAX) for _ in range(16)]
        assert list(P.unpack_channels(P.pack_channels(chans))) == chans


@pytest.mark.parametrize("bad", [[992] * 15, [992] * 17, [171] + [992] * 15, [992] * 15 + [1812],
                                 [992.0] * 16, [True] * 16])
def test_pack_channels_rejects(bad: list) -> None:
    with pytest.raises(P.FieldError):
        P.pack_channels(bad)


def test_unpack_channels_wrong_size() -> None:
    with pytest.raises(P.LengthError):
        P.unpack_channels(bytes(21))


def test_unpack_channels_returns_raw_11bit() -> None:
    assert P.unpack_channels(b"\xff" * 22) == (2047,) * 16


# --------------------------------------------------------------------------- rc_up

def test_rc_up_layout() -> None:
    pkt = RcUp(0x11223344, 0x55667788, tuple(P.centred_channels()), cam_enable=True).pack()
    assert len(pkt) == P.RC_UP_SIZE == 36
    assert pkt[0:2] == b"RC" and pkt[2] == 1 and pkt[3] == 0x01
    assert pkt[4:8] == HEX("44332211") and pkt[8:12] == HEX("88776655")   # little-endian
    assert pkt[12:34] == P.pack_channels(P.centred_channels())
    assert struct.unpack("<H", pkt[34:])[0] == P.crc16_ccitt_false(pkt[:34])


@pytest.mark.parametrize("item", V["rc_up"], ids=ids(V["rc_up"]))
def test_rc_up_vectors(item: dict) -> None:
    f = item["fields"]
    pkt = RcUp(seq=f["seq"], t_gcs_us=f["t_gcs_us"], channels=tuple(f["channels"]),
               cam_enable=f["cam_enable"], reserved_flags=f["reserved_flags"])
    assert pkt.pack().hex().upper() == item["hex"]
    assert RcUp.unpack(HEX(item["hex"])) == pkt


def test_rc_up_round_trip() -> None:
    rng = random.Random(7)
    for _ in range(200):
        pkt = RcUp(rng.getrandbits(32), rng.getrandbits(32),
                   tuple(rng.randint(172, 1811) for _ in range(16)), cam_enable=rng.random() < 0.5)
        assert RcUp.unpack(pkt.pack()) == pkt


@pytest.mark.parametrize("kwargs", [dict(seq=-1), dict(seq=1 << 32), dict(t_gcs_us=1 << 32),
                                    dict(reserved_flags=0x01), dict(reserved_flags=0x100)])
def test_rc_up_pack_rejects(kwargs: dict) -> None:
    base = dict(seq=1, t_gcs_us=1, channels=tuple(P.centred_channels()))
    with pytest.raises(P.FieldError):
        RcUp(**{**base, **kwargs}).pack()


# --------------------------------------------------------------------------- status

def test_status_layout() -> None:
    st = Status(BridgeState.RUN, 0x01020304, 0xA0B0C0D0, camera_on_readback=True, timing_locked=True,
                fw_ver=0x0102, rx_ok=1, rx_bad_crc=2, rx_bad_seq=3, crsf_tx=4,
                sync_period_x10us=50000, sync_offset_x10us=-2)
    pkt = st.pack()
    assert len(pkt) == P.STATUS_SIZE == 42
    assert pkt[0:2] == b"RS" and pkt[2] == 1 and pkt[3] == 3 and pkt[4] == 0x03 and pkt[5] == 0
    assert pkt[6:8] == HEX("0201") and pkt[8:12] == HEX("04030201") and pkt[12:16] == HEX("D0C0B0A0")
    assert struct.unpack("<IIIIii", pkt[16:40]) == (1, 2, 3, 4, 50000, -2)
    assert struct.unpack("<H", pkt[40:])[0] == P.crc16_ccitt_false(pkt[:40])


@pytest.mark.parametrize("item", V["status"], ids=ids(V["status"]))
def test_status_vectors(item: dict) -> None:
    f = dict(item["fields"])
    f["state"] = BridgeState(f["state"])
    st = Status(**f)
    assert st.pack().hex().upper() == item["hex"]
    assert Status.unpack(HEX(item["hex"])) == st


def test_status_flag_bits() -> None:
    names = ["camera_on_readback", "timing_locked", "p2_link_100fd", "decoder_lock", "std_ntsc"]
    for bit, name in enumerate(names):
        pkt = Status(BridgeState.RUN, 1, 1, **{name: True}).pack()
        assert pkt[4] == 1 << bit
        assert getattr(Status.unpack(pkt), name) is True


def test_status_reserved_flag_bits_are_preserved_not_rejected() -> None:
    st = Status(BridgeState.WAIT_GCS, 1, 1, reserved_flags=0xE0)
    back = Status.unpack(st.pack())
    assert back.reserved_flags == 0xE0 and not back.camera_on_readback


@pytest.mark.parametrize("kwargs", [dict(state=7), dict(sync_offset_x10us=1 << 31), dict(fw_ver=0x10000),
                                    dict(rx_ok=-1), dict(reserved_flags=0x01)])
def test_status_pack_rejects(kwargs: dict) -> None:
    with pytest.raises(P.FieldError):
        Status(**{**dict(state=BridgeState.RUN, seq=1, t_gcs_us_echo=1), **kwargs}).pack()


def test_status_round_trip_all_states() -> None:
    for state in BridgeState:
        st = Status(state, 9, 10, p2_link_100fd=True, sync_offset_x10us=-123456)
        assert Status.unpack(st.pack()) == st


def test_fw_ver_encoding() -> None:
    assert P.fw_ver_encode(1, 2) == 0x0102 and P.fw_ver_str(0x0102) == "1.2"


# --------------------------------------------------------------------------- crsf_fwd / crsf_pass

@pytest.mark.parametrize("item", V["crsf_fwd"], ids=ids(V["crsf_fwd"]))
def test_crsf_fwd_vectors(item: dict) -> None:
    assert CrsfFwd(HEX(item["frame"])).pack().hex().upper() == item["hex"]
    assert CrsfFwd.unpack(HEX(item["hex"])).frame == HEX(item["frame"])
    assert len(HEX(item["hex"])) == 6 + len(HEX(item["frame"]))


@pytest.mark.parametrize("item", V["crsf_pass"], ids=ids(V["crsf_pass"]))
def test_crsf_pass_vectors(item: dict) -> None:
    assert CrsfPass(HEX(item["frame"])).pack().hex().upper() == item["hex"]
    assert CrsfPass.unpack(HEX(item["hex"])).frame == HEX(item["frame"])


def test_crsf_fwd_max_frame_is_covered() -> None:
    assert any(len(HEX(i["frame"])) == 64 for i in V["crsf_fwd"])


@pytest.mark.parametrize("frame", [b"\xC8\x02\x14", bytes([0xC8, 63]) + bytes(63), b"\xC8\x05\x14\x00\x00"])
def test_crsf_carrier_pack_rejects(frame: bytes) -> None:
    with pytest.raises(P.FieldError):
        CrsfFwd(frame).pack()


# --------------------------------------------------------------------------- malformed / dispatch

_UNPACK = {"rc_up": RcUp.unpack, "status": Status.unpack, "crsf_fwd": CrsfFwd.unpack,
           "crsf_pass": CrsfPass.unpack}


@pytest.mark.parametrize("item", V["malformed"], ids=ids(V["malformed"]))
def test_malformed_vectors(item: dict) -> None:
    err = getattr(P, item["error"])
    with pytest.raises(err):
        _UNPACK[item["message"]](HEX(item["hex"]))


def test_malformed_vectors_cover_every_message_and_error() -> None:
    seen = {(i["message"], i["error"]) for i in V["malformed"]}
    for msg in _UNPACK:
        assert (msg, "CrcError") in seen and (msg, "VersionError") in seen
    assert {"LengthError", "MagicError", "FieldError"} <= {e for _, e in seen}


def test_version_error_is_checked_before_length() -> None:
    """A future ver=2 packet may have another size: it must count as a version mismatch."""
    with pytest.raises(P.VersionError):
        RcUp.unpack(b"RC\x02" + bytes(50))


def test_decode_dispatch() -> None:
    for group, cls in (("rc_up", RcUp), ("status", Status), ("crsf_fwd", CrsfFwd), ("crsf_pass", CrsfPass)):
        for item in V[group]:
            assert isinstance(P.decode(HEX(item["hex"])), cls)
    with pytest.raises(P.MagicError):
        P.decode(b"XX\x01\x00")
    with pytest.raises(P.LengthError):
        P.decode(b"RC")


def test_errors_are_value_errors() -> None:
    for name in ("LengthError", "MagicError", "VersionError", "CrcError", "FieldError"):
        assert issubclass(getattr(P, name), P.ProtocolError)
    assert issubclass(P.ProtocolError, ValueError)


# --------------------------------------------------------------------------- helpers

@pytest.mark.parametrize("seq,last,newer", [(2, 1, True), (1, 1, False), (0, 1, False), (0, 0xFFFFFFFF, True),
                                            (0x80000000, 0, False), (0x7FFFFFFF, 0, True), (5, 0xFFFFFFF0, True)])
def test_seq_newer_wraps_like_int32(seq: int, last: int, newer: bool) -> None:
    assert P.seq_newer(seq, last) is newer


def test_u32_diff_wraps() -> None:
    assert P.u32_diff(10, 0xFFFFFFF0) == 26 and P.u32_diff(100, 40) == 60


def test_selftest_prints_check_values(capsys: pytest.CaptureFixture[str]) -> None:
    assert P.main(["--selftest"]) == 0
    out = capsys.readouterr().out
    assert "0x29B1" in out and "0xBC" in out and "SELFTEST OK" in out


def test_ports() -> None:
    assert (P.BRIDGE_PORT, P.VIDEO_PORT, P.VIDEO_FANOUT_PORTS) == (5770, 5600, (5601, 5602))


def test_readme_documents_proposal_and_check_values() -> None:
    import os
    path = os.path.join(os.path.dirname(__file__), "..", "..", "protocol", "README.md")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    assert "PROPOSAL v1 — agree with G0 firmware before flight" in text
    assert "0x29B1" in text and "0xBC" in text and "0xD5" in text
    tail = RcUp(1, 0, tuple(P.centred_channels())).pack()[-2:]
    assert tail.hex(" ").upper() in text                       # "91 9B" example stays true
    for word in ("T_hold", "WAIT_GCS", "FAILSAFE", "client-gated", "Changelog", "little-endian"):
        assert word in text
