"""CRSF (Crossfire / ExpressLRS serial protocol) — parser, builders, decoders.

Every field layout in this module is taken from primary sources, read at these
commits (all URLs are ``https://github.com/<repo>/blob/<commit>/<path>``):

* **[BF-TLM]** Betaflight ``src/main/telemetry/crsf.c`` @ 41a5b43379f0176c838c181e7c735c1e9e8767ab
  — frame builders the client FC uses (GPS, battery, attitude, flight mode,
  vario, baro altitude, device info).
* **[BF-PROTO]** Betaflight ``src/main/rx/crsf_protocol.h`` @ same commit — payload sizes, types, addresses.
* **[BF-RX]** Betaflight ``src/main/rx/crsf.c`` @ same commit — link-statistics struct, TX power table.
* **[ELRS-PROTO]** ExpressLRS ``src/include/crsf_protocol.h`` @ dd96654519249798707f011b7c79236350f246f8
  — structs (link stats, GPS, battery, attitude, vario, baro, sync packet), addresses,
  parameter value types.
* **[ELRS-HANDSET]** ExpressLRS ``src/lib/Handset/CRSFHandset.cpp`` @ same commit — 0x3A
  timing frame (``sendSyncPacketToTX``), accepted sync bytes (``alignBufferToSync``).
* **[ELRS-TXEP]** ExpressLRS ``src/lib/tx-crsf/TXModuleEndpoint.cpp`` @ same commit — ModelID
  command, RC frame handling (24/25-byte forms), ping/read/write dispatch.
* **[ELRS-EP]** ExpressLRS ``src/lib/CrsfProtocol/CRSFEndpoint.cpp`` and ``CRSFParameters.h``
  @ same commit — device info and parameter-entry (0x2B) serialisation and chunking.
* **[ELRS-LUA]** ExpressLRS ``src/lua/elrs.lua`` @ same commit — reference *reader* of 0x29/0x2B and
  writer of 0x28/0x2C/0x2D (the handset Lua this app replaces).
* **[ETX]** EdgeTX ``radio/src/pulses/crossfire.cpp``, ``radio/src/crc.cpp``,
  ``radio/src/tests/crossfire.cpp`` @ 65db64b4890c399b8fcc9cc6a3d002c2b86e4706 — ModelID frame
  with the poly-0xBA inner CRC, channel-packing test vector, parser test streams.

Byte order: CRSF payload fields are **big-endian** (Betaflight writes them with
``sbufWriteU16BigEndian`` / ``sbufWriteU32BigEndian``; ELRS uses ``htobe32``), except
the 11-bit RC channel packing, which is LSB-first.

Frame layout: ``<sync/address> <len> <type> <payload...> <crc8>``; ``len`` counts
type + payload + crc; CRC-8 poly 0xD5 covers type + payload.  Extended frames
(type 0x28..0x96) start the payload with ``<dest> <origin>``.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Callable, Sequence

from .protocol import pack_channels, unpack_channels

# --------------------------------------------------------------------------- constants

#: Sync / device-address bytes accepted at the start of a frame: 0xC8 (FC, the
#: classic "sync" byte), 0xEA (radio/handset — module->handset frames), 0xEE
#: (TX module).  [ELRS-HANDSET] alignBufferToSync accepts 0xEE and 0xC8; [ETX]
#: tests show module->handset frames starting with 0xEA and 0xC8.
SYNC_BYTES = frozenset((0xC8, 0xEA, 0xEE))

#: ``len`` byte limits: type + crc (2) .. 62 (64-byte frame). [ELRS-PROTO] CRSF_MAX_PACKET_LEN 64.
MIN_LEN_BYTE = 2
MAX_LEN_BYTE = 62
MAX_FRAME_SIZE = 64


class Addr(IntEnum):
    """Device addresses ([ELRS-PROTO] crsf_addr_e, [BF-PROTO] crsfAddress_e)."""

    BROADCAST = 0x00
    USB = 0x10
    BLUETOOTH_WIFI = 0x12
    FLIGHT_CONTROLLER = 0xC8
    RADIO_TRANSMITTER = 0xEA   # the handset — the G0 bridge plays this role
    CRSF_RECEIVER = 0xEC
    CRSF_TRANSMITTER = 0xEE    # the ELRS TX module
    ELRS_LUA = 0xEF


class FrameType(IntEnum):
    """Frame types ([ELRS-PROTO] crsf_frame_type_e, [BF-PROTO] crsfFrameType_e)."""

    GPS = 0x02
    GPS_TIME = 0x03
    VARIO = 0x07
    BATTERY_SENSOR = 0x08
    BARO_ALTITUDE = 0x09
    HEARTBEAT = 0x0B
    LINK_STATISTICS = 0x14
    RC_CHANNELS_PACKED = 0x16
    ATTITUDE = 0x1E
    FLIGHT_MODE = 0x21
    DEVICE_PING = 0x28
    DEVICE_INFO = 0x29
    PARAMETER_SETTINGS_ENTRY = 0x2B
    PARAMETER_READ = 0x2C
    PARAMETER_WRITE = 0x2D
    ELRS_STATUS = 0x2E
    COMMAND = 0x32
    RADIO_ID = 0x3A            # "HANDSET" in ELRS; sub-type 0x10 = timing


#: 0x32 COMMAND sub-command and its 0x10 sub-commands ([ELRS-PROTO] crsf_command_e / crsf_subcommand_e).
COMMAND_SUBCMD_RX = 0x10
COMMAND_SUBCMD_RX_BIND = 0x01
COMMAND_MODEL_SELECT_ID = 0x05
#: 0x3A sub-type for the timing (sync) packet ([ELRS-PROTO] CRSF_HANDSET_SUBCMD_TIMING).
RADIO_SUBCMD_TIMING = 0x10

#: Uplink TX power enum -> mW ([BF-RX] uplinkTXPowerStatesMw).
TX_POWER_MW = (0, 10, 25, 100, 500, 1000, 2000, 250, 50)

#: ELRS DeviceInfo serial number 'E','L','R','S' ([ELRS-EP] sendDeviceInformationPacket).
ELRS_SERIAL = 0x454C5253


def is_extended_type(frame_type: int) -> bool:
    """Types 0x28..0x96 carry ``dest`` and ``origin`` after the type byte ([ELRS-PROTO])."""
    return 0x28 <= frame_type <= 0x96


class CrsfError(ValueError):
    """Malformed CRSF frame or payload."""


# --------------------------------------------------------------------------- CRC-8

def _make_table(poly: int) -> tuple[int, ...]:
    table = []
    for i in range(256):
        crc = i
        for _ in range(8):
            crc = ((crc << 1) ^ poly) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
        table.append(crc)
    return tuple(table)


_TABLE_D5 = _make_table(0xD5)
_TABLE_BA = _make_table(0xBA)


def _crc8(table: tuple[int, ...], data: bytes | bytearray | memoryview) -> int:
    crc = 0
    for byte in bytes(data):
        crc = table[crc ^ byte]
    return crc


def crc8_d5(data: bytes | bytearray | memoryview) -> int:
    """CRSF frame CRC: poly 0xD5, init 0, no reflection (= CRC-8/DVB-S2; check 0xBC).

    [ETX] crc.cpp ``crc8`` (table "polynom = 0xD5"); [ELRS-PROTO] CRSF_CRC_POLY 0xd5.
    """
    return _crc8(_TABLE_D5, data)


def crc8_ba(data: bytes | bytearray | memoryview) -> int:
    """Inner CRC of 0x32 COMMAND frames: poly 0xBA, init 0 ([ETX] crc.cpp ``crc8_BA``)."""
    return _crc8(_TABLE_BA, data)


# --------------------------------------------------------------------------- frames

@dataclass(frozen=True)
class CrsfFrame:
    """One CRC-valid CRSF frame."""

    raw: bytes = field(repr=False)

    @property
    def address(self) -> int:
        return self.raw[0]

    @property
    def type(self) -> int:
        return self.raw[2]

    @property
    def payload(self) -> bytes:
        """Bytes between type and CRC (for extended frames this includes dest/origin)."""
        return self.raw[3:-1]

    @property
    def is_extended(self) -> bool:
        return is_extended_type(self.type)

    @property
    def dest(self) -> int | None:
        return self.raw[3] if self.is_extended and len(self.raw) >= 6 else None

    @property
    def origin(self) -> int | None:
        return self.raw[4] if self.is_extended and len(self.raw) >= 6 else None

    @property
    def body(self) -> bytes:
        """Payload after dest/origin for extended frames; the whole payload otherwise."""
        return self.raw[5:-1] if self.is_extended else self.raw[3:-1]

    def __repr__(self) -> str:
        try:
            name = FrameType(self.type).name
        except ValueError:
            name = f"0x{self.type:02X}"
        return f"CrsfFrame({name}, {self.raw.hex(' ').upper()})"


def build_frame(frame_type: int, payload: bytes = b"", address: int = 0xC8) -> bytes:
    """``<address> <len> <type> <payload> <crc8>`` with ``len = len(payload) + 2``."""
    payload = bytes(payload)
    if len(payload) + 2 > MAX_LEN_BYTE:
        raise CrsfError(f"payload too long ({len(payload)} B)")
    body = bytes((frame_type,)) + payload
    return bytes((address, len(body) + 1)) + body + bytes((crc8_d5(body),))


def build_ext_frame(frame_type: int, dest: int, origin: int, payload: bytes = b"",
                    address: int = Addr.CRSF_TRANSMITTER) -> bytes:
    """Extended frame: ``<address> <len> <type> <dest> <origin> <payload> <crc8>``."""
    if not is_extended_type(frame_type):
        raise CrsfError(f"type 0x{frame_type:02X} is not an extended type")
    return build_frame(frame_type, bytes((dest, origin)) + bytes(payload), address)


def parse_frame(raw: bytes | bytearray | memoryview) -> CrsfFrame:
    """Validate exactly one frame (sync, length, CRC). Raises :class:`CrsfError`."""
    raw = bytes(raw)
    if len(raw) < MIN_LEN_BYTE + 2:
        raise CrsfError(f"frame too short ({len(raw)} B)")
    if raw[0] not in SYNC_BYTES:
        raise CrsfError(f"bad sync byte 0x{raw[0]:02X}")
    if not MIN_LEN_BYTE <= raw[1] <= MAX_LEN_BYTE or raw[1] + 2 != len(raw):
        raise CrsfError(f"length byte {raw[1]} does not match frame size {len(raw)}")
    calc = crc8_d5(raw[2:-1])
    if calc != raw[-1]:
        raise CrsfError(f"crc8 mismatch: got 0x{raw[-1]:02X}, expected 0x{calc:02X}")
    return CrsfFrame(raw)


class CrsfParser:
    """Streaming CRSF parser: feed arbitrary byte chunks, get complete CRC-valid frames.

    Resync strategy: skip bytes until a sync byte (0xC8/0xEA/0xEE); reject an
    impossible ``len`` (< 2 or > 62) by dropping that one sync byte; on a CRC
    mismatch drop only the first byte and rescan, so a frame hidden behind a
    corrupt or truncated one is not lost (behaviour checked against the EdgeTX
    ``frameParser_*`` test streams, [ETX] tests/crossfire.cpp).
    """

    def __init__(self) -> None:
        self._buf = bytearray()
        self.frames_ok = 0
        self.crc_errors = 0
        self.bytes_discarded = 0

    def reset(self) -> None:
        self._buf.clear()

    @property
    def pending(self) -> int:
        """Bytes buffered while waiting for the rest of a frame (always < 64)."""
        return len(self._buf)

    def feed(self, data: bytes | bytearray | memoryview) -> list[CrsfFrame]:
        buf = self._buf
        buf.extend(data)
        out: list[CrsfFrame] = []
        while buf:
            if buf[0] not in SYNC_BYTES:
                skip = next((i for i, b in enumerate(buf) if b in SYNC_BYTES), len(buf))
                del buf[:skip]
                self.bytes_discarded += skip
                continue
            if len(buf) < 2:
                break
            length = buf[1]
            if not MIN_LEN_BYTE <= length <= MAX_LEN_BYTE:
                del buf[0]
                self.bytes_discarded += 1
                continue
            total = length + 2
            if len(buf) < total:
                break
            if crc8_d5(buf[2:total - 1]) == buf[total - 1]:
                out.append(CrsfFrame(bytes(buf[:total])))
                del buf[:total]
                self.frames_ok += 1
            else:
                self.crc_errors += 1
                del buf[0]
                self.bytes_discarded += 1
        return out


# --------------------------------------------------------------------------- outbound builders

def build_rc_channels_frame(channels: Sequence[int], address: int = Addr.CRSF_TRANSMITTER,
                            strict: bool = True) -> bytes:
    """RC frame from the relay design: ``EE 18 16 <22 B channels> CRC``.

    The 24-byte form (no ELRS status byte) makes ELRS take the arm state from
    CH5 ([ELRS-TXEP] RcPacketToChannelsData: "frame len 24 -> arming mode CH5").
    ``strict`` as in :func:`vtolgcs.protocol.pack_channels` (False = any 11-bit value).
    """
    return build_frame(FrameType.RC_CHANNELS_PACKED, pack_channels(channels, strict), address)


def build_rc_channels_frame_raw(packed: bytes, address: int = Addr.CRSF_TRANSMITTER) -> bytes:
    """RC frame from 22 already-packed channel bytes, copied unchanged.

    This is what the G0 does with ``rc_up.ch`` (protocol README §2): no value is
    judged, so every 11-bit value 0..2047 passes through.
    """
    packed = bytes(packed)
    if len(packed) != 22:
        raise CrsfError(f"packed channels must be 22 B, got {len(packed)}")
    return build_frame(FrameType.RC_CHANNELS_PACKED, packed, address)


def build_model_id_frame(model_id: int, address: int = Addr.CRSF_TRANSMITTER) -> bytes:
    """ModelID command from the relay design: ``EE 08 32 EE EA 10 05 <id> <crc8_BA> <crc8_D5>``.

    Confirmed against [ETX] createCrossfireModelIDFrame (inner ``crc8_BA`` over
    type..id, outer ``crc8`` over type..crc8_BA).  EdgeTX starts the frame with
    0xC8; the relay design uses 0xEE; ELRS accepts both ([ELRS-HANDSET]
    alignBufferToSync) and reads only ``payload[2]`` as the id ([ELRS-TXEP]).
    """
    if not 0 <= model_id <= 255:
        raise CrsfError(f"model id {model_id} outside 0..255")
    inner = bytes((FrameType.COMMAND, Addr.CRSF_TRANSMITTER, Addr.RADIO_TRANSMITTER,
                   COMMAND_SUBCMD_RX, COMMAND_MODEL_SELECT_ID, model_id))
    payload = inner[1:] + bytes((crc8_ba(inner),))
    return build_frame(FrameType.COMMAND, payload, address)


def build_device_ping(dest: int = Addr.BROADCAST, origin: int = Addr.RADIO_TRANSMITTER,
                      address: int = Addr.CRSF_TRANSMITTER) -> bytes:
    """0x28 device ping (no body). [ELRS-LUA] ``crossfireTelemetryPush(0x28, {0x00, 0xEA})``."""
    return build_ext_frame(FrameType.DEVICE_PING, dest, origin, b"", address)


def build_param_read(param: int, chunk: int = 0, dest: int = Addr.CRSF_TRANSMITTER,
                     origin: int = Addr.RADIO_TRANSMITTER, address: int = Addr.CRSF_TRANSMITTER) -> bytes:
    """0x2C parameter read: body ``<param> <chunk>`` ([ELRS-LUA] ``{deviceId, handsetId, id, fieldChunk}``)."""
    return build_ext_frame(FrameType.PARAMETER_READ, dest, origin, bytes((param, chunk)), address)


def build_param_write(param: int, value: bytes, dest: int = Addr.CRSF_TRANSMITTER,
                      origin: int = Addr.RADIO_TRANSMITTER, address: int = Addr.CRSF_TRANSMITTER) -> bytes:
    """0x2D parameter write: body ``<param> <value bytes, big-endian>``.

    Use :func:`encode_param_value` for ``value``.  Special cases in ELRS
    ([ELRS-TXEP]): param 0 = ELRS status (0x2E) request; for COMMAND params the
    value is a :class:`CommandStep`.
    """
    return build_ext_frame(FrameType.PARAMETER_WRITE, dest, origin, bytes((param,)) + bytes(value), address)


# --------------------------------------------------------------------------- telemetry decoders

def _be(fmt: str, data: bytes, offset: int = 0) -> tuple:
    try:
        return struct.unpack_from(">" + fmt, data, offset)
    except struct.error as exc:
        raise CrsfError(f"payload too short for '{fmt}' ({len(data)} B)") from exc


def _need(payload: bytes, size: int, what: str) -> None:
    if len(payload) < size:
        raise CrsfError(f"{what} payload needs {size} B, got {len(payload)}")


@dataclass(frozen=True)
class LinkStatistics:
    """0x14 link statistics ([ELRS-PROTO] crsfPayloadLinkstatistics_s, [BF-RX] crsfLinkStatistics_t).

    RSSI bytes are sent as ``dBm * -1`` (u8); SNR is i8 dB; TX power is an enum
    (see :data:`TX_POWER_MW`).  ELRS may append ``downlink_RSSI_2`` (11th byte).
    """

    rssi1_dbm: int
    rssi2_dbm: int
    lq_pct: int
    snr_db: int
    active_antenna: int
    rf_mode: int
    tx_power_index: int
    dl_rssi_dbm: int
    dl_lq_pct: int
    dl_snr_db: int
    dl_rssi2_dbm: int | None = None

    @property
    def tx_power_mw(self) -> int | None:
        idx = self.tx_power_index
        return TX_POWER_MW[idx] if 0 <= idx < len(TX_POWER_MW) else None

    @classmethod
    def decode(cls, payload: bytes) -> "LinkStatistics":
        _need(payload, 10, "link statistics")
        r1, r2, lq, snr, ant, mode, pwr, dr, dlq, dsnr = _be("BBBbBBBBBb", payload)
        dr2 = -payload[10] if len(payload) >= 11 else None
        return cls(-r1, -r2, lq, snr, ant, mode, pwr, -dr, dlq, dsnr, dr2)

    def encode(self) -> bytes:
        out = struct.pack(">BBBbBBBBBb", -self.rssi1_dbm, -self.rssi2_dbm, self.lq_pct, self.snr_db,
                          self.active_antenna, self.rf_mode, self.tx_power_index,
                          -self.dl_rssi_dbm, self.dl_lq_pct, self.dl_snr_db)
        if self.dl_rssi2_dbm is not None:
            out += struct.pack(">B", -self.dl_rssi2_dbm)
        return out


@dataclass(frozen=True)
class Gps:
    """0x02 GPS ([BF-TLM] crsfFrameGps, [ELRS-PROTO] crsf_sensor_gps_s), 15 B big-endian.

    i32 lat, lon (deg x 1e7) · u16 ground speed (km/h x 10) · u16 heading
    (deg x 100) · u16 altitude (m + 1000) · u8 satellites.
    """

    lat_deg: float
    lon_deg: float
    gspd_kmh: float
    hdg_deg: float
    alt_m: int
    sats: int

    @classmethod
    def decode(cls, payload: bytes) -> "Gps":
        _need(payload, 15, "GPS")
        lat, lon, gspd, hdg, alt, sats = _be("iiHHHB", payload)
        return cls(lat / 1e7, lon / 1e7, gspd / 10, hdg / 100, alt - 1000, sats)

    def encode(self) -> bytes:
        return struct.pack(">iiHHHB", round(self.lat_deg * 1e7), round(self.lon_deg * 1e7),
                           round(self.gspd_kmh * 10), round(self.hdg_deg * 100) % 36000,
                           max(0, min(0xFFFF, round(self.alt_m) + 1000)), self.sats)


@dataclass(frozen=True)
class Battery:
    """0x08 battery ([BF-TLM] crsfFrameBatterySensor, [ELRS-PROTO] crsf_sensor_battery_s), 8 B BE.

    u16 voltage (0.1 V) · u16 current (0.1 A) · u24 used mAh · u8 remaining %.
    With Betaflight ``report_cell_voltage`` on, voltage is the *average cell* voltage.
    """

    voltage_v: float
    current_a: float
    used_mah: int
    remaining_pct: int

    @classmethod
    def decode(cls, payload: bytes) -> "Battery":
        _need(payload, 8, "battery")
        volt, curr = _be("HH", payload)
        used = int.from_bytes(payload[4:7], "big")
        return cls(volt / 10, curr / 10, used, payload[7])

    def encode(self) -> bytes:
        return (struct.pack(">HH", round(self.voltage_v * 10), round(self.current_a * 10))
                + int(self.used_mah).to_bytes(3, "big") + bytes((self.remaining_pct,)))


@dataclass(frozen=True)
class Attitude:
    """0x1E attitude ([BF-TLM] crsfFrameAttitude, [ELRS-PROTO]): i16 pitch, roll, yaw in rad x 10000, BE."""

    pitch_rad: float
    roll_rad: float
    yaw_rad: float

    @classmethod
    def decode(cls, payload: bytes) -> "Attitude":
        _need(payload, 6, "attitude")
        p, r, y = _be("hhh", payload)
        return cls(p / 10000, r / 10000, y / 10000)

    def encode(self) -> bytes:
        return struct.pack(">hhh", round(self.pitch_rad * 10000), round(self.roll_rad * 10000),
                           round(self.yaw_rad * 10000))


@dataclass(frozen=True)
class Vario:
    """0x07 vario ([BF-TLM] crsfFrameVarioSensor, [ELRS-PROTO]): i16 vertical speed cm/s, BE."""

    vspd_ms: float

    @classmethod
    def decode(cls, payload: bytes) -> "Vario":
        _need(payload, 2, "vario")
        return cls(_be("h", payload)[0] / 100)

    def encode(self) -> bytes:
        return struct.pack(">h", round(self.vspd_ms * 100))


# Betaflight vertical-speed packing constants ([BF-TLM] calcVerticalSpeedPacked).
_VSPD_KL = 100.0
_VSPD_KR = 0.026


@dataclass(frozen=True)
class BaroAltitude:
    """0x09 barometric altitude.

    Altitude u16 BE ([BF-TLM] calcAltitudePacked, [ELRS-PROTO] crsf_sensor_baro_vario_s):
    MSB = 0 -> decimetres + 10000 dm offset; MSB = 1 -> metres (low 15 bits).

    Vertical speed has **two encodings in the primary sources**:

    * Betaflight (3-byte payload): i8, log-packed —
      ``cm/s = sign * (exp(|v| * 0.026) - 1) * 100``;
    * ExpressLRS struct (4-byte payload): i16 cm/s, BE.

    The decoder picks by payload length; :attr:`vspd_format` records which.
    """

    alt_m: float
    vspd_ms: float | None
    vspd_format: str = "betaflight"   # 'betaflight' (3 B) | 'elrs' (4 B) | 'none' (2 B)

    @staticmethod
    def unpack_altitude(value: int) -> float:
        if value & 0x8000:
            return float(value & 0x7FFF)
        return (value - 10000) / 10

    @staticmethod
    def pack_altitude(alt_m: float) -> int:
        dm = round(alt_m * 10)
        val = dm + 10000
        if val < 0:
            return 0
        if val < 0x8000:
            return val
        return min((dm + 5) // 10, 0x7FFE) | 0x8000

    @staticmethod
    def unpack_vspd_bf(packed: int) -> float:
        """Betaflight i8 log-packed vertical speed -> m/s."""
        sign = -1 if packed < 0 else 1
        return sign * (math.exp(abs(packed) * _VSPD_KR) - 1) * _VSPD_KL / 100

    @staticmethod
    def pack_vspd_bf(vspd_ms: float) -> int:
        cms = vspd_ms * 100
        sign = -1 if cms < 0 else 1
        val = round(math.log(abs(cms) / _VSPD_KL + 1) / _VSPD_KR) * sign
        return max(-128, min(127, val))

    @classmethod
    def decode(cls, payload: bytes) -> "BaroAltitude":
        _need(payload, 2, "baro altitude")
        alt = cls.unpack_altitude(_be("H", payload)[0])
        if len(payload) >= 4:
            return cls(alt, _be("h", payload, 2)[0] / 100, "elrs")
        if len(payload) == 3:
            return cls(alt, cls.unpack_vspd_bf(_be("b", payload, 2)[0]), "betaflight")
        return cls(alt, None, "none")

    def encode(self) -> bytes:
        head = struct.pack(">H", self.pack_altitude(self.alt_m))
        if self.vspd_format == "elrs":
            return head + struct.pack(">h", round((self.vspd_ms or 0.0) * 100))
        if self.vspd_format == "betaflight":
            return head + struct.pack(">b", self.pack_vspd_bf(self.vspd_ms or 0.0))
        return head


@dataclass(frozen=True)
class FlightModeStatus:
    """Interpretation of the 0x21 flight-mode string (plan §14.2, Betaflight telemetry docs).

    ``armed`` is ``None`` when the string is empty (unknown).
    """

    raw: str
    mode: str
    suffix: str | None
    failsafe: bool
    armed: bool | None
    ready_to_arm: bool
    arming_disabled: bool
    rescue_not_ready: bool

    @property
    def rth(self) -> bool:
        return self.mode == "RTH"


def interpret_flight_mode(raw: str) -> FlightModeStatus:
    """Interpret a Betaflight CRSF flight-mode string.

    [BF-TLM] crsfFrameFlightMode: base mode ``!FS!`` / ``RTH`` / ``ANGL`` / ...;
    *while disarmed and not in failsafe* one suffix is appended: ``*`` ready to
    arm, ``!`` arming disabled, ``?`` GPS Rescue configured but no fix/sats.
    So: ``failsafe`` = string *contains* ``!FS!`` (plan §14.2 wording; Betaflight
    always sends it as the whole base mode); ``armed`` = no suffix and not failsafe.
    """
    text = raw.split("\0", 1)[0].strip()
    if not text:
        return FlightModeStatus(raw, "", None, False, None, False, False, False)
    failsafe = "!FS!" in text
    if failsafe:
        mode, rest = "!FS!", text.replace("!FS!", "", 1)
        suffix = rest[-1] if rest and rest[-1] in "*!?" else None
    elif text[-1] in "*!?":
        mode, suffix = text[:-1], text[-1]
    else:
        mode, suffix = text, None
    return FlightModeStatus(
        raw=raw, mode=mode, suffix=suffix, failsafe=failsafe,
        armed=(suffix is None and not failsafe),
        ready_to_arm=suffix == "*", arming_disabled=suffix == "!", rescue_not_ready=suffix == "?")


@dataclass(frozen=True)
class FlightMode:
    """0x21 flight mode: null-terminated ASCII string ([BF-TLM] crsfFrameFlightMode)."""

    text: str

    @property
    def status(self) -> FlightModeStatus:
        return interpret_flight_mode(self.text)

    @classmethod
    def decode(cls, payload: bytes) -> "FlightMode":
        return cls(bytes(payload).split(b"\0", 1)[0].decode("ascii", errors="replace"))

    def encode(self) -> bytes:
        return self.text.encode("ascii") + b"\0"


@dataclass(frozen=True)
class RadioTiming:
    """0x3A radio-ID frame, sub-type 0x10 = timing ([ELRS-HANDSET] sendSyncPacketToTX).

    Extended frame ``EA 0D 3A EA EE 10 <rate i32 BE> <offset i32 BE> crc``.
    ``rate`` = packet interval in 0.1 us (``RequestedRCpacketInterval * 10``;
    250 Hz -> 40000, 200 Hz -> 50000); ``offset`` = signed, 0.1 us ("10ths of us
    (OpenTX sync unit)"), already minus ELRS's 100 us safety margin.  The ELRS
    struct declares both ``uint32_t ... // Big-Endian``; the offset is used as a
    signed value, so both are decoded as signed i32 here.
    """

    dest: int
    origin: int
    rate_x10us: int
    offset_x10us: int

    @property
    def interval_us(self) -> float:
        return self.rate_x10us / 10

    @property
    def rate_hz(self) -> float | None:
        return 1e7 / self.rate_x10us if self.rate_x10us > 0 else None

    @classmethod
    def decode_frame(cls, frame: CrsfFrame) -> "RadioTiming":
        body = frame.body
        _need(body, 9, "0x3A timing")
        if body[0] != RADIO_SUBCMD_TIMING:
            raise CrsfError(f"0x3A sub-type 0x{body[0]:02X} is not timing (0x10)")
        rate, offset = _be("ii", body, 1)
        return cls(frame.dest, frame.origin, rate, offset)

    def to_frame(self, address: int = Addr.RADIO_TRANSMITTER) -> bytes:
        return build_ext_frame(FrameType.RADIO_ID, self.dest, self.origin,
                               bytes((RADIO_SUBCMD_TIMING,)) + struct.pack(">ii", self.rate_x10us,
                                                                            self.offset_x10us), address)


# --------------------------------------------------------------------------- device info / parameters

def _cstr(data: bytes, offset: int) -> tuple[str, int]:
    """Read a NUL-terminated string (latin-1: ELRS uses 0xC0/0xC1 arrow glyphs)."""
    end = data.find(b"\0", offset)
    if end < 0:
        raise CrsfError(f"unterminated string at offset {offset}")
    return data[offset:end].decode("latin-1"), end + 1


@dataclass(frozen=True)
class DeviceInfo:
    """0x29 device info ([ELRS-PROTO] deviceInformationPacket_s, [ELRS-EP], [ELRS-LUA] parseDeviceInfoMessage).

    Body: name\\0 · u32 serial · u32 hardware ver · u32 software ver · u8 field
    count · u8 parameter version (all BE).
    """

    dest: int
    origin: int
    name: str
    serial_no: int
    hardware_ver: int
    software_ver: int
    field_count: int
    parameter_version: int

    @property
    def is_elrs(self) -> bool:
        return self.serial_no == ELRS_SERIAL

    @property
    def software_version_str(self) -> str:
        v = self.software_ver
        return f"{(v >> 16) & 0xFF}.{(v >> 8) & 0xFF}.{v & 0xFF}"

    @classmethod
    def decode_frame(cls, frame: CrsfFrame) -> "DeviceInfo":
        body = frame.body
        name, off = _cstr(body, 0)
        _need(body[off:], 14, "device info")
        serial, hw, sw, cnt, pver = _be("IIIBB", body, off)
        return cls(frame.dest, frame.origin, name, serial, hw, sw, cnt, pver)

    def to_frame(self, address: int = Addr.RADIO_TRANSMITTER) -> bytes:
        body = (self.name.encode("latin-1") + b"\0"
                + struct.pack(">IIIBB", self.serial_no, self.hardware_ver, self.software_ver,
                              self.field_count, self.parameter_version))
        return build_ext_frame(FrameType.DEVICE_INFO, self.dest, self.origin, body, address)


class ParamType(IntEnum):
    """Parameter value types ([ELRS-PROTO] crsf_value_type_e). Bit 0x80 = hidden."""

    UINT8 = 0
    INT8 = 1
    UINT16 = 2
    INT16 = 3
    UINT32 = 4
    INT32 = 5
    UINT64 = 6
    INT64 = 7
    FLOAT = 8
    TEXT_SELECTION = 9
    STRING = 10
    FOLDER = 11
    INFO = 12
    COMMAND = 13
    VTX = 15
    OUT_OF_RANGE = 127


PARAM_HIDDEN = 0x80


class CommandStep(IntEnum):
    """COMMAND parameter steps ([ELRS-EP] CRSFParameters.h commandStep_e)."""

    IDLE = 0
    CLICK = 1
    EXECUTING = 2
    ASK_CONFIRM = 3
    CONFIRMED = 4
    CANCEL = 5
    QUERY = 6


@dataclass(frozen=True)
class ParameterChunk:
    """0x2B parameter settings entry, one chunk: body ``<param> <chunks_remaining> <data...>``."""

    dest: int
    origin: int
    param_number: int
    chunks_remaining: int
    data: bytes

    @classmethod
    def decode_frame(cls, frame: CrsfFrame) -> "ParameterChunk":
        body = frame.body
        _need(body, 2, "parameter entry")
        return cls(frame.dest, frame.origin, body[0], body[1], bytes(body[2:]))


@dataclass
class ParameterEntry:
    """A fully assembled parameter (all chunks joined).

    Data layout after the chunk headers ([ELRS-EP] sendParameter, read as in
    [ELRS-LUA] parseParameterInfoMessage): ``<parent> <type|0x80 hidden> <name\\0>``
    then a type-specific part:

    * UINT8/INT8/UINT16/INT16: value, min, max, default (each 1 or 2 B, BE), units\\0
    * FLOAT: value, min, max, default (i32 BE), precision u8, step u32 BE, units\\0
    * TEXT_SELECTION: options\\0 (';'-separated), value, min, max, default (u8), units\\0
    * STRING / INFO: value\\0 (STRING may be followed by a max-length byte)
    * FOLDER: child parameter numbers, terminated by 0xFF
    * COMMAND: step u8, timeout u8 (x 10 ms), info\\0
    """

    number: int
    parent: int
    type: int
    hidden: bool
    name: str
    value: int | float | str | None = None
    min: int | float | None = None
    max: int | float | None = None
    default: int | float | None = None
    units: str = ""
    options: list[str] = field(default_factory=list)
    children: list[int] = field(default_factory=list)
    precision: int | None = None
    step: int | None = None
    timeout_ms: int | None = None
    info: str = ""
    max_length: int | None = None
    raw: bytes = b""

    @property
    def type_name(self) -> str:
        try:
            return ParamType(self.type).name
        except ValueError:
            return f"0x{self.type:02X}"

    @property
    def value_label(self) -> str | None:
        """For TEXT_SELECTION: the selected option text (plus units)."""
        if self.type == ParamType.TEXT_SELECTION and isinstance(self.value, int):
            if 0 <= self.value < len(self.options):
                return self.options[self.value] + self.units
        return None


def _int_at(data: bytes, offset: int, size: int, signed: bool) -> int:
    chunk = data[offset:offset + size]
    if len(chunk) != size:
        raise CrsfError(f"parameter data truncated at offset {offset}")
    return int.from_bytes(chunk, "big", signed=signed)


def parse_parameter_entry(number: int, data: bytes) -> ParameterEntry:
    """Parse assembled 0x2B data (starting at ``parent``). Raises :class:`CrsfError`."""
    data = bytes(data)
    if len(data) < 3:
        raise CrsfError("parameter entry too short")
    parent, type_byte = data[0], data[1]
    ptype = type_byte & 0x7F
    name, off = _cstr(data, 2)
    e = ParameterEntry(number=number, parent=parent, type=ptype,
                       hidden=bool(type_byte & PARAM_HIDDEN), name=name, raw=data)
    if ptype in (ParamType.UINT8, ParamType.INT8, ParamType.UINT16, ParamType.INT16):
        size, signed = ptype // 2 + 1, bool(ptype % 2)
        e.value, e.min, e.max, e.default = (_int_at(data, off + i * size, size, signed) for i in range(4))
        e.units, _ = _cstr(data, off + 4 * size)
    elif ptype == ParamType.FLOAT:
        e.value, e.min, e.max, e.default = (_int_at(data, off + i * 4, 4, True) for i in range(4))
        e.precision = _int_at(data, off + 16, 1, False)
        e.step = _int_at(data, off + 17, 4, False)
        e.units, _ = _cstr(data, off + 21)
    elif ptype == ParamType.TEXT_SELECTION:
        opts, off = _cstr(data, off)
        e.options = opts.split(";")
        e.value, e.min, e.max, e.default = (_int_at(data, off + i, 1, False) for i in range(4))
        e.units, _ = _cstr(data, off + 4)
    elif ptype in (ParamType.STRING, ParamType.INFO):
        e.value, off = _cstr(data, off)
        if ptype == ParamType.STRING and off < len(data):
            e.max_length = data[off]
    elif ptype == ParamType.FOLDER:
        end = data.find(b"\xff", off)
        if end < 0:
            raise CrsfError("folder child list not terminated by 0xFF")
        e.children = list(data[off:end])
    elif ptype == ParamType.COMMAND:
        e.value = _int_at(data, off, 1, False)
        e.timeout_ms = _int_at(data, off + 1, 1, False) * 10
        e.info, _ = _cstr(data, off + 2)
    # other types (32/64-bit ints, VTX, OUT_OF_RANGE): ELRS does not send them; keep raw only
    return e


def encode_parameter_entry(entry: ParameterEntry) -> bytes:
    """Inverse of :func:`parse_parameter_entry` (used by the simulator and test vectors)."""
    t = entry.type
    out = bytes((entry.parent, t | (PARAM_HIDDEN if entry.hidden else 0))) + entry.name.encode("latin-1") + b"\0"
    units = entry.units.encode("latin-1") + b"\0"
    if t in (ParamType.UINT8, ParamType.INT8, ParamType.UINT16, ParamType.INT16):
        size, signed = t // 2 + 1, bool(t % 2)
        for v in (entry.value, entry.min, entry.max, entry.default or 0):
            out += int(v).to_bytes(size, "big", signed=signed)
        return out + units
    if t == ParamType.FLOAT:
        for v in (entry.value, entry.min, entry.max, entry.default or 0):
            out += int(v).to_bytes(4, "big", signed=True)
        return out + bytes((entry.precision or 0,)) + int(entry.step or 0).to_bytes(4, "big") + units
    if t == ParamType.TEXT_SELECTION:
        out += ";".join(entry.options).encode("latin-1") + b"\0"
        return out + bytes((int(entry.value), int(entry.min or 0), int(entry.max or 0), int(entry.default or 0))) + units
    if t in (ParamType.STRING, ParamType.INFO):
        out += str(entry.value).encode("latin-1") + b"\0"
        return out + (bytes((entry.max_length,)) if entry.max_length is not None else b"")
    if t == ParamType.FOLDER:
        return out + bytes(entry.children) + b"\xff"
    if t == ParamType.COMMAND:
        return out + bytes((int(entry.value), (entry.timeout_ms or 0) // 10)) + entry.info.encode("latin-1") + b"\0"
    raise CrsfError(f"cannot encode parameter type {t}")


#: Max data bytes per 0x2B chunk at 64-byte frames: 64 - 6 (addr, len, type, dest, origin, crc)
#: - 2 (param, chunks remaining). [ELRS-EP] sendParameter ``chunkMax``.
PARAM_CHUNK_MAX = 56


def build_parameter_entry_frames(number: int, data: bytes, dest: int = Addr.RADIO_TRANSMITTER,
                                 origin: int = Addr.CRSF_TRANSMITTER, chunk_max: int = PARAM_CHUNK_MAX,
                                 address: int = Addr.RADIO_TRANSMITTER) -> list[bytes]:
    """Split parameter data into 0x2B frames exactly as ELRS does ([ELRS-EP] sendParameter)."""
    count = max(1, -(-len(data) // chunk_max))
    frames = []
    for i in range(count):
        part = data[i * chunk_max:(i + 1) * chunk_max]
        frames.append(build_ext_frame(FrameType.PARAMETER_SETTINGS_ENTRY, dest, origin,
                                      bytes((number, count - i - 1)) + part, address))
    return frames


class ParameterAssembler:
    """Joins 0x2B chunks for one parameter at a time (logic of [ELRS-LUA] parseParameterInfoMessage).

    Request chunk :attr:`next_chunk` of the parameter with :func:`build_param_read`,
    feed every 0x2B chunk to :meth:`feed`; it returns the :class:`ParameterEntry`
    when ``chunks_remaining`` reaches 0.  A chunk for another parameter, or one
    whose ``chunks_remaining`` is not the expected value, discards the partial
    data (``next_chunk`` goes back to 0).
    """

    def __init__(self) -> None:
        self._number: int | None = None
        self._data = bytearray()
        self._expect: int | None = None
        self.next_chunk = 0

    def reset(self) -> None:
        self._number, self._expect, self.next_chunk = None, None, 0
        self._data.clear()

    def feed(self, chunk: ParameterChunk) -> ParameterEntry | None:
        if self._number is not None and (chunk.param_number != self._number
                                         or chunk.chunks_remaining != self._expect):
            self.reset()
            return None
        self._number = chunk.param_number
        self._data.extend(chunk.data)
        if chunk.chunks_remaining > 0:
            self._expect = chunk.chunks_remaining - 1
            self.next_chunk += 1
            return None
        number, data = self._number, bytes(self._data)
        self.reset()
        return parse_parameter_entry(number, data)


def encode_param_value(ptype: int, value: int | float) -> bytes:
    """Value bytes for a 0x2D write, big-endian ([ELRS-LUA] fieldIntSave, [ELRS-EP] parameterUpdateReq)."""
    t = ptype & 0x7F
    if t in (ParamType.UINT8, ParamType.TEXT_SELECTION, ParamType.COMMAND):
        return int(value).to_bytes(1, "big")
    if t == ParamType.INT8:
        return int(value).to_bytes(1, "big", signed=True)
    if t == ParamType.UINT16:
        return int(value).to_bytes(2, "big")
    if t == ParamType.INT16:
        return int(value).to_bytes(2, "big", signed=True)
    if t == ParamType.UINT32:
        return int(value).to_bytes(4, "big")
    if t in (ParamType.INT32, ParamType.FLOAT):
        return int(value).to_bytes(4, "big", signed=True)
    raise CrsfError(f"parameter type {t} is not writable")


# --------------------------------------------------------------------------- dispatch

Telemetry = (LinkStatistics | Gps | Battery | Attitude | Vario | BaroAltitude | FlightMode
             | RadioTiming | DeviceInfo | ParameterChunk)

_PLAIN: dict[int, Callable[[bytes], Telemetry]] = {
    FrameType.LINK_STATISTICS: LinkStatistics.decode,
    FrameType.GPS: Gps.decode,
    FrameType.BATTERY_SENSOR: Battery.decode,
    FrameType.ATTITUDE: Attitude.decode,
    FrameType.VARIO: Vario.decode,
    FrameType.BARO_ALTITUDE: BaroAltitude.decode,
    FrameType.FLIGHT_MODE: FlightMode.decode,
}
_EXTENDED: dict[int, Callable[[CrsfFrame], Telemetry]] = {
    FrameType.RADIO_ID: RadioTiming.decode_frame,
    FrameType.DEVICE_INFO: DeviceInfo.decode_frame,
    FrameType.PARAMETER_SETTINGS_ENTRY: ParameterChunk.decode_frame,
}


def decode_frame(frame: CrsfFrame) -> Telemetry | None:
    """Decode a frame into its dataclass, or ``None`` for types this module does not decode.

    Raises :class:`CrsfError` if a known type has a malformed payload (e.g. a
    0x3A frame whose sub-type is not timing).
    """
    if frame.type in _PLAIN:
        return _PLAIN[frame.type](frame.payload)
    if frame.type in _EXTENDED:
        if len(frame.payload) < 2:
            raise CrsfError("extended frame without dest/origin")
        return _EXTENDED[frame.type](frame)
    return None


def telemetry_frame(obj: LinkStatistics | Gps | Battery | Attitude | Vario | BaroAltitude | FlightMode,
                    address: int = Addr.RADIO_TRANSMITTER) -> bytes:
    """Encode a plain telemetry dataclass as a frame (module -> handset, address 0xEA)."""
    types = {LinkStatistics: FrameType.LINK_STATISTICS, Gps: FrameType.GPS,
             Battery: FrameType.BATTERY_SENSOR, Attitude: FrameType.ATTITUDE, Vario: FrameType.VARIO,
             BaroAltitude: FrameType.BARO_ALTITUDE, FlightMode: FrameType.FLIGHT_MODE}
    return build_frame(types[type(obj)], obj.encode(), address)


def decode_rc_channels(frame: CrsfFrame) -> tuple[int, ...]:
    """Channel values of a 0x16 RC frame (24-byte form, or 25-byte form with the ELRS status byte)."""
    if frame.type != FrameType.RC_CHANNELS_PACKED or len(frame.payload) < 22:
        raise CrsfError("not an RC_CHANNELS_PACKED frame")
    return unpack_channels(frame.payload[:22])
