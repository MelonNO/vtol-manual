"""Relay UDP protocol v1 (contract C3) — reference implementation.

PROPOSAL v1 — agree with G0 firmware before flight.  The normative text is
``protocol/README.md``; byte-exact examples are in ``protocol/test-vectors.json``.

Messages (all multi-byte fields little-endian, packed, no padding)::

    rc_up      GCS -> bridge  36 B   'R','C' ver flags seq t_gcs_us ch[22] crc16
    status     bridge -> GCS  42 B   'R','S' ver state flags rsvd fw_ver seq ... crc16
    crsf_fwd   bridge -> GCS  6+len  'R','F' ver len frame[len] crc16
    crsf_pass  GCS -> bridge  6+len  'R','P' ver len frame[len] crc16   (Q7a, future)

Receivers check, in this order: length >= 3, magic, ``ver``, exact length,
CRC-16.  Each failure raises a specific :class:`ProtocolError` subclass so the
caller can count it.

Run ``python -m vtolgcs.protocol --selftest`` to print the CRC check values.
"""

from __future__ import annotations

import argparse
import math
import struct
import sys
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Sequence

PROTOCOL_VERSION = 1

#: UDP port the bridge (W5500) listens on for ``rc_up`` / ``crsf_pass``.
BRIDGE_PORT = 5770
#: UDP port where client video RTP arrives at the GCS.
VIDEO_PORT = 5600
#: Local fan-out ports for the standalone viewer and the Mission Planner HUD.
VIDEO_FANOUT_PORTS = (5601, 5602)

RC_UP_MAGIC = b"RC"
STATUS_MAGIC = b"RS"
CRSF_FWD_MAGIC = b"RF"
CRSF_PASS_MAGIC = b"RP"

RC_UP_SIZE = 36
STATUS_SIZE = 42
#: Raw CRSF frame size limits (sync + len + type + crc ... 64 bytes total).
CRSF_FRAME_MIN = 4
CRSF_FRAME_MAX = 64

NUM_CHANNELS = 16
PACKED_CHANNELS_SIZE = 22
#: CRSF channel values (ExpressLRS src/include/crsf_protocol.h,
#: CRSF_CHANNEL_VALUE_STD_MIN / MID / STD_MAX): 172 = 988 us, 992 = 1500 us,
#: 1811 = 2012 us.
CRSF_CHANNEL_MIN = 172
CRSF_CHANNEL_MID = 992
CRSF_CHANNEL_MAX = 1811

# rc_up.flags
FLAG_CAM_ENABLE = 0x01

# status.flags
STATUS_FLAG_CAMERA_ON = 0x01
STATUS_FLAG_TIMING_LOCKED = 0x02
STATUS_FLAG_P2_LINK_100FD = 0x04
STATUS_FLAG_DECODER_LOCK = 0x08   # future firmware request; treat as unknown
STATUS_FLAG_STD_NTSC = 0x10       # future firmware request; treat as unknown
_STATUS_KNOWN_FLAGS = 0x1F

_RC_UP_HEAD = struct.Struct("<2sBBII")          # magic ver flags seq t_gcs_us (12 B)
_STATUS_BODY = struct.Struct("<2sBBBBHIIIIIIii")  # 40 B before crc16
_U16 = struct.Struct("<H")


# --------------------------------------------------------------------------- errors

class ProtocolError(ValueError):
    """Base class for every validation failure in this module."""


class LengthError(ProtocolError):
    """Datagram too short / wrong size for its message type."""


class MagicError(ProtocolError):
    """First two bytes are not the expected magic."""


class VersionError(ProtocolError):
    """``ver`` byte is not :data:`PROTOCOL_VERSION` (ignore and count)."""


class CrcError(ProtocolError):
    """CRC-16 mismatch."""


class FieldError(ProtocolError):
    """A field value is out of range (on pack) or not defined in v1 (on unpack)."""


# --------------------------------------------------------------------------- CRC

def crc16_ccitt_false(data: bytes | bytearray | memoryview, init: int = 0xFFFF) -> int:
    """CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, xorout 0.

    Check value: ``crc16_ccitt_false(b"123456789") == 0x29B1``.
    """
    crc = init
    for byte in bytes(data):
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def _append_crc(body: bytes) -> bytes:
    return body + _U16.pack(crc16_ccitt_false(body))


def _check_crc(data: bytes) -> None:
    (rx,) = _U16.unpack_from(data, len(data) - 2)
    calc = crc16_ccitt_false(data[:-2])
    if rx != calc:
        raise CrcError(f"crc16 mismatch: got 0x{rx:04X}, expected 0x{calc:04X}")


def _check_head(data: bytes, magic: bytes) -> None:
    if len(data) < 3:
        raise LengthError(f"datagram too short ({len(data)} B)")
    if data[:2] != magic:
        raise MagicError(f"bad magic {data[:2]!r}, expected {magic!r}")
    if data[2] != PROTOCOL_VERSION:
        raise VersionError(f"unsupported ver={data[2]} (this code speaks ver={PROTOCOL_VERSION})")


# --------------------------------------------------------------------------- channels

#: Endpoint-exact scaling (contract C3, PM decision in WP03 rework round 1): the
#: 1639 CRSF counts between 172 and 1811 span the 1024 us between 988 and 2012,
#: like ExpressLRS ``fmap(172..1811 -> 988..2012)`` (crsf_protocol.h ``CRSF_to_US``).
US_MIN = 988
US_MAX = 2012
_CRSF_SPAN = CRSF_CHANNEL_MAX - CRSF_CHANNEL_MIN   # 1639
_US_SPAN = US_MAX - US_MIN                         # 1024


def _round_half_up(x: float) -> int:
    return math.floor(x + 0.5)


def us_to_crsf(us: float) -> int:
    """Pulse width in microseconds -> CRSF channel value (sending side, contract C3).

    ``crsf = 172 + round((us - 988) * 1639 / 1024)``, clamped to 172..1811.
    Anchors: 988 -> 172, 1000 -> 191, 1500 -> 992, 2000 -> 1792, 2012 -> 1811
    (the ExpressLRS ``CRSF_CHANNEL_VALUE_*`` constants).  Rounding is half-up
    (``floor(x + 0.5)``); the only exact tie for integer us is 1500 us (819.5),
    which half-up maps to 992.  1639/1024 is exact in binary floating point.
    """
    if not math.isfinite(us):
        raise FieldError(f"pulse width must be finite, got {us!r}")
    value = CRSF_CHANNEL_MIN + _round_half_up((us - US_MIN) * _CRSF_SPAN / _US_SPAN)
    return max(CRSF_CHANNEL_MIN, min(CRSF_CHANNEL_MAX, value))


def crsf_to_us(value: int) -> int:
    """CRSF channel value -> pulse width in microseconds (receiving side, contract C3).

    ``us = 988 + round((crsf - 172) * 1024 / 1639)``.  Accepts any 11-bit value
    0..2047 (no clamping: receivers report what was sent).  For integer inputs
    there are no rounding ties.
    """
    return US_MIN + _round_half_up((value - CRSF_CHANNEL_MIN) * _US_SPAN / _CRSF_SPAN)


def pack_channels(channels: Sequence[int], strict: bool = True) -> bytes:
    """Pack 16 channel values into 22 bytes, 11 bits each, LSB first.

    Same bit order as the CRSF RC_CHANNELS_PACKED payload (Betaflight
    src/main/rx/crsf.c ``crsfPayloadRcChannelsPacked_s`` / EdgeTX
    radio/src/pulses/crossfire.cpp ``createCrossfireChannelsFrame``).

    ``strict=True`` (the GCS sending side) only allows 172..1811.  ``strict=False``
    allows any 11-bit value 0..2047 — legal CRSF (ELRS extended limits use 0..1984)
    — for receivers, simulators and tests that must pass values through unjudged.
    """
    if len(channels) != NUM_CHANNELS:
        raise FieldError(f"need {NUM_CHANNELS} channels, got {len(channels)}")
    lo, hi = (CRSF_CHANNEL_MIN, CRSF_CHANNEL_MAX) if strict else (0, 0x7FF)
    acc = 0
    for i, ch in enumerate(channels):
        if not isinstance(ch, int) or isinstance(ch, bool):
            raise FieldError(f"channel {i + 1} is not an int: {ch!r}")
        if not lo <= ch <= hi:
            raise FieldError(f"channel {i + 1} = {ch} outside {lo}..{hi}")
        acc |= ch << (11 * i)
    return acc.to_bytes(PACKED_CHANNELS_SIZE, "little")


def unpack_channels(data: bytes | bytearray | memoryview) -> tuple[int, ...]:
    """Inverse of :func:`pack_channels`. Returns the raw 11-bit values (0..2047)."""
    if len(data) != PACKED_CHANNELS_SIZE:
        raise LengthError(f"packed channels must be {PACKED_CHANNELS_SIZE} B, got {len(data)}")
    acc = int.from_bytes(bytes(data), "little")
    return tuple((acc >> (11 * i)) & 0x7FF for i in range(NUM_CHANNELS))


def centred_channels() -> list[int]:
    """16 channels at 1500 us (992)."""
    return [CRSF_CHANNEL_MID] * NUM_CHANNELS


def u32_diff(now: int, then: int) -> int:
    """``(now - then) mod 2**32`` — elapsed time between two wrapping u32 counters.

    Use it for RTT: ``u32_diff(t_gcs_us_now, status.t_gcs_us_echo)``.
    """
    return (now - then) & 0xFFFFFFFF


def seq_newer(seq: int, last: int) -> bool:
    """Bridge sequence rule from the relay design: ``(int32_t)(seq - last) > 0``."""
    delta = (seq - last) & 0xFFFFFFFF
    return 0 < delta < 0x80000000


def _check_u(name: str, value: int, bits: int) -> None:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value < (1 << bits):
        raise FieldError(f"{name}={value!r} does not fit u{bits}")


def _check_i32(name: str, value: int) -> None:
    if not isinstance(value, int) or isinstance(value, bool) or not -(1 << 31) <= value < (1 << 31):
        raise FieldError(f"{name}={value!r} does not fit i32")


# --------------------------------------------------------------------------- rc_up

@dataclass(frozen=True)
class RcUp:
    """``rc_up`` — GCS -> bridge, 36 bytes, sent every 4-5 ms."""

    seq: int
    t_gcs_us: int
    channels: tuple[int, ...]
    cam_enable: bool = False
    #: flags bits 1..7; reserved in v1, must be sent as 0. Kept so a receiver
    #: can report them; :meth:`pack` refuses a value with bit 0 set.
    reserved_flags: int = 0

    @property
    def flags(self) -> int:
        return (FLAG_CAM_ENABLE if self.cam_enable else 0) | self.reserved_flags

    def pack(self, strict: bool = True) -> bytes:
        """Encode. ``strict=True`` (default, the GCS sender) limits channels to
        172..1811; ``strict=False`` allows any 11-bit value (test tools only)."""
        _check_u("seq", self.seq, 32)
        _check_u("t_gcs_us", self.t_gcs_us, 32)
        _check_u("reserved_flags", self.reserved_flags, 8)
        if self.reserved_flags & FLAG_CAM_ENABLE:
            raise FieldError("reserved_flags must not contain bit 0 (use cam_enable)")
        head = _RC_UP_HEAD.pack(RC_UP_MAGIC, PROTOCOL_VERSION, self.flags, self.seq, self.t_gcs_us)
        return _append_crc(head + pack_channels(self.channels, strict))

    @classmethod
    def unpack(cls, data: bytes | bytearray | memoryview) -> "RcUp":
        data = bytes(data)
        _check_head(data, RC_UP_MAGIC)
        if len(data) != RC_UP_SIZE:
            raise LengthError(f"rc_up must be {RC_UP_SIZE} B, got {len(data)}")
        _check_crc(data)
        _, _, flags, seq, t_gcs_us = _RC_UP_HEAD.unpack_from(data, 0)
        return cls(seq=seq, t_gcs_us=t_gcs_us, channels=unpack_channels(data[12:34]),
                   cam_enable=bool(flags & FLAG_CAM_ENABLE),
                   reserved_flags=flags & ~FLAG_CAM_ENABLE & 0xFF)


# --------------------------------------------------------------------------- status

class BridgeState(IntEnum):
    """G0 bridge states (relay design, "Firmware architecture")."""

    BOOT = 0
    WAIT_GCS = 1
    START = 2
    RUN = 3
    FAILSAFE = 4


def fw_ver_encode(major: int, minor: int) -> int:
    """Proposed ``fw_ver`` encoding: ``(major << 8) | minor``."""
    _check_u("major", major, 8)
    _check_u("minor", minor, 8)
    return (major << 8) | minor


def fw_ver_str(fw_ver: int) -> str:
    return f"{fw_ver >> 8}.{fw_ver & 0xFF}"


@dataclass(frozen=True)
class Status:
    """``status`` — bridge -> GCS, 42 bytes, 10 Hz (plus one on every state change)."""

    state: BridgeState
    seq: int
    t_gcs_us_echo: int
    camera_on_readback: bool = False
    timing_locked: bool = False
    p2_link_100fd: bool = False
    #: Bits 3/4 need the N6 to report through the bridge (future firmware
    #: request). Consumers treat them as unknown unless ``fw_ver`` says otherwise.
    decoder_lock: bool = False
    std_ntsc: bool = False
    fw_ver: int = 0
    rx_ok: int = 0
    rx_bad_crc: int = 0
    rx_bad_seq: int = 0
    crsf_tx: int = 0
    #: Sync period / offset in units of 0.1 us (us x 10), same unit as the
    #: ELRS 0x3A timing frame. 0 = no timing frame seen.
    sync_period_x10us: int = 0
    sync_offset_x10us: int = 0
    reserved: int = 0
    #: flags bits 5..7, reserved in v1 (sent as 0, ignored and preserved on receive).
    reserved_flags: int = 0

    @property
    def flags(self) -> int:
        return (self.reserved_flags
                | (STATUS_FLAG_CAMERA_ON if self.camera_on_readback else 0)
                | (STATUS_FLAG_TIMING_LOCKED if self.timing_locked else 0)
                | (STATUS_FLAG_P2_LINK_100FD if self.p2_link_100fd else 0)
                | (STATUS_FLAG_DECODER_LOCK if self.decoder_lock else 0)
                | (STATUS_FLAG_STD_NTSC if self.std_ntsc else 0))

    def pack(self) -> bytes:
        try:
            state = BridgeState(self.state)
        except ValueError as exc:
            raise FieldError(f"unknown state {self.state!r}") from exc
        _check_u("reserved", self.reserved, 8)
        _check_u("reserved_flags", self.reserved_flags, 8)
        if self.reserved_flags & _STATUS_KNOWN_FLAGS:
            raise FieldError("reserved_flags must only use bits 5..7")
        _check_u("fw_ver", self.fw_ver, 16)
        for name in ("seq", "t_gcs_us_echo", "rx_ok", "rx_bad_crc", "rx_bad_seq", "crsf_tx"):
            _check_u(name, getattr(self, name), 32)
        _check_i32("sync_period_x10us", self.sync_period_x10us)
        _check_i32("sync_offset_x10us", self.sync_offset_x10us)
        body = _STATUS_BODY.pack(
            STATUS_MAGIC, PROTOCOL_VERSION, int(state), self.flags, self.reserved, self.fw_ver,
            self.seq, self.t_gcs_us_echo, self.rx_ok, self.rx_bad_crc, self.rx_bad_seq,
            self.crsf_tx, self.sync_period_x10us, self.sync_offset_x10us)
        return _append_crc(body)

    @classmethod
    def unpack(cls, data: bytes | bytearray | memoryview) -> "Status":
        data = bytes(data)
        _check_head(data, STATUS_MAGIC)
        if len(data) != STATUS_SIZE:
            raise LengthError(f"status must be {STATUS_SIZE} B, got {len(data)}")
        _check_crc(data)
        (_, _, state, flags, reserved, fw_ver, seq, echo, rx_ok, bad_crc, bad_seq, crsf_tx,
         period, offset) = _STATUS_BODY.unpack_from(data, 0)
        try:
            state_e = BridgeState(state)
        except ValueError as exc:
            raise FieldError(f"state {state} not defined in v1") from exc
        return cls(state=state_e, seq=seq, t_gcs_us_echo=echo,
                   camera_on_readback=bool(flags & STATUS_FLAG_CAMERA_ON),
                   timing_locked=bool(flags & STATUS_FLAG_TIMING_LOCKED),
                   p2_link_100fd=bool(flags & STATUS_FLAG_P2_LINK_100FD),
                   decoder_lock=bool(flags & STATUS_FLAG_DECODER_LOCK),
                   std_ntsc=bool(flags & STATUS_FLAG_STD_NTSC),
                   fw_ver=fw_ver, rx_ok=rx_ok, rx_bad_crc=bad_crc, rx_bad_seq=bad_seq,
                   crsf_tx=crsf_tx, sync_period_x10us=period, sync_offset_x10us=offset,
                   reserved=reserved, reserved_flags=flags & ~_STATUS_KNOWN_FLAGS & 0xFF)


# --------------------------------------------------------------------------- crsf_fwd / crsf_pass

def _pack_crsf_carrier(magic: bytes, frame: bytes) -> bytes:
    frame = bytes(frame)
    if not CRSF_FRAME_MIN <= len(frame) <= CRSF_FRAME_MAX:
        raise FieldError(f"CRSF frame must be {CRSF_FRAME_MIN}..{CRSF_FRAME_MAX} B, got {len(frame)}")
    if frame[1] + 2 != len(frame):
        raise FieldError(f"CRSF length byte {frame[1]} does not match frame size {len(frame)}")
    return _append_crc(magic + bytes((PROTOCOL_VERSION, len(frame))) + frame)


def _unpack_crsf_carrier(magic: bytes, data: bytes | bytearray | memoryview) -> bytes:
    data = bytes(data)
    _check_head(data, magic)
    if len(data) < 4:
        raise LengthError(f"datagram too short ({len(data)} B)")
    flen = data[3]
    if not CRSF_FRAME_MIN <= flen <= CRSF_FRAME_MAX:
        raise LengthError(f"len={flen} outside {CRSF_FRAME_MIN}..{CRSF_FRAME_MAX}")
    if len(data) != 6 + flen:
        raise LengthError(f"datagram is {len(data)} B, len field says {6 + flen}")
    _check_crc(data)
    frame = data[4:4 + flen]
    if frame[1] + 2 != flen:
        raise FieldError(f"inner CRSF length byte {frame[1]} does not match len={flen}")
    return frame


@dataclass(frozen=True)
class CrsfFwd:
    """``crsf_fwd`` — bridge -> GCS: one raw CRSF frame (sync ... crc8) from the TX module.

    The inner CRSF CRC-8 is *not* checked here; feed :attr:`frame` to
    :class:`vtolgcs.crsf.CrsfParser` or :func:`vtolgcs.crsf.parse_frame`.
    """

    frame: bytes = field(repr=False)

    def pack(self) -> bytes:
        return _pack_crsf_carrier(CRSF_FWD_MAGIC, self.frame)

    @classmethod
    def unpack(cls, data: bytes | bytearray | memoryview) -> "CrsfFwd":
        return cls(_unpack_crsf_carrier(CRSF_FWD_MAGIC, data))


@dataclass(frozen=True)
class CrsfPass:
    """``crsf_pass`` — GCS -> bridge (Q7a, future firmware): a raw CRSF frame for the module."""

    frame: bytes = field(repr=False)

    def pack(self) -> bytes:
        return _pack_crsf_carrier(CRSF_PASS_MAGIC, self.frame)

    @classmethod
    def unpack(cls, data: bytes | bytearray | memoryview) -> "CrsfPass":
        return cls(_unpack_crsf_carrier(CRSF_PASS_MAGIC, data))


Message = RcUp | Status | CrsfFwd | CrsfPass

_BY_MAGIC: dict[bytes, type] = {
    RC_UP_MAGIC: RcUp, STATUS_MAGIC: Status, CRSF_FWD_MAGIC: CrsfFwd, CRSF_PASS_MAGIC: CrsfPass,
}


def decode(data: bytes | bytearray | memoryview) -> Message:
    """Decode any v1 datagram by its magic. Raises :class:`ProtocolError`."""
    data = bytes(data)
    if len(data) < 3:
        raise LengthError(f"datagram too short ({len(data)} B)")
    cls = _BY_MAGIC.get(data[:2])
    if cls is None:
        raise MagicError(f"unknown magic {data[:2]!r}")
    return cls.unpack(data)


# --------------------------------------------------------------------------- self-test

def _selftest() -> int:
    crsf_check = None
    try:
        from . import crsf as _crsf
        crsf_check = (_crsf.crc8_d5(b"123456789"), _crsf.crc8_ba(b"123456789"))
    except ImportError:  # pragma: no cover - run as a loose file
        pass
    c16 = crc16_ccitt_false(b"123456789")
    print(f"CRC-16/CCITT-FALSE('123456789') = 0x{c16:04X}  (expected 0x29B1)")
    ok = c16 == 0x29B1
    if crsf_check:
        print(f"CRSF CRC-8 poly 0xD5 ('123456789') = 0x{crsf_check[0]:02X}  (CRC-8/DVB-S2, expected 0xBC)")
        print(f"CRSF CRC-8 poly 0xBA ('123456789') = 0x{crsf_check[1]:02X}  (inner CRC of 0x32 commands)")
        ok = ok and crsf_check[0] == 0xBC
    sample = RcUp(seq=1, t_gcs_us=0, channels=tuple(centred_channels())).pack()
    print(f"rc_up centred, seq=1: {sample.hex(' ').upper()}")
    print("SELFTEST", "OK" if ok else "FAILED")
    return 0 if ok else 1


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m vtolgcs.protocol",
                                     description="Relay UDP protocol v1 reference code")
    parser.add_argument("--selftest", action="store_true", help="print the CRC check values")
    args = parser.parse_args(argv)
    if args.selftest:
        return _selftest()
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
