"""Read-only carrier position from a Mission Planner "MAVLink Mirror" stream (S-02b).

**This module never sends anything.**  The UDP socket is wrapped in
:class:`ReceiveOnlySocket`, which exposes no send method at all, so no code
path can emit carrier-bound MAVLink (plan §4 S-02b: the companion app must not
send heartbeats as the primary GCS).  In Mission Planner set the mirror's
*write access* **off** (see ``gcs/README.md``).

Parsed messages (MAVLink common.xml), v1 (``0xFE``) and v2 (``0xFD``, incl.
zero-truncated payloads and signed frames):

* ``HEARTBEAT`` (id 0, CRC_EXTRA 50): only **autopilot** heartbeats count —
  ``autopilot == MAV_AUTOPILOT_ARDUPILOTMEGA`` (3), or any autopilot other
  than ``MAV_AUTOPILOT_INVALID`` (8) from ``mavlink.carrier_sysid`` when set.
  GCS heartbeats (autopilot 8) and the app's own client vehicle (generic
  autopilot, WP08b) are ignored.  The first matching sysid is locked in.
* ``GLOBAL_POSITION_INT`` (id 33, CRC_EXTRA 104): lat/lon (degE7),
  ``relative_alt`` (mm above home) and ``hdg`` (cdeg, 65535 = unknown), only
  from the locked carrier sysid.

Frame checksum: CRC-16/MCRF4XX ("X.25" in MAVLink) over everything after the
magic byte, then the message's CRC_EXTRA byte.
"""

from __future__ import annotations

import logging
import socket
import struct
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable

from .config import MavlinkConfig

log = logging.getLogger("vtolgcs.mavlink_ro")

MAVLINK_V1 = 0xFE
MAVLINK_V2 = 0xFD
MAVLINK_IFLAG_SIGNED = 0x01
MSG_HEARTBEAT = 0
MSG_GLOBAL_POSITION_INT = 33
#: CRC_EXTRA per message id (MAVLink common.xml; checked in the tests from the field lists).
CRC_EXTRA = {MSG_HEARTBEAT: 50, MSG_GLOBAL_POSITION_INT: 104}
#: Full (untruncated) payload lengths.
PAYLOAD_LEN = {MSG_HEARTBEAT: 9, MSG_GLOBAL_POSITION_INT: 28}
MAV_AUTOPILOT_ARDUPILOTMEGA = 3
MAV_AUTOPILOT_INVALID = 8
HDG_UNKNOWN = 0xFFFF

_HEARTBEAT = struct.Struct("<IBBBBB")
_GPI = struct.Struct("<IiiiihhhH")


def x25_crc(data: bytes | bytearray, crc: int = 0xFFFF) -> int:
    """MAVLink checksum (CRC-16/MCRF4XX): ``x25_crc(b"123456789") == 0x6F91``."""
    for byte in data:
        tmp = byte ^ (crc & 0xFF)
        tmp = (tmp ^ (tmp << 4)) & 0xFF
        crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xFFFF
    return crc


@dataclass(frozen=True)
class MavMessage:
    msgid: int
    sysid: int
    compid: int
    payload: bytes          # zero-extended to the full length for known messages


@dataclass(frozen=True)
class Heartbeat:
    custom_mode: int
    type: int
    autopilot: int
    base_mode: int
    system_status: int
    mavlink_version: int

    @classmethod
    def decode(cls, payload: bytes) -> "Heartbeat":
        return cls(*_HEARTBEAT.unpack_from(payload))


@dataclass(frozen=True)
class GlobalPositionInt:
    time_boot_ms: int
    lat: int                # degE7
    lon: int                # degE7
    alt: int                # mm, MSL
    relative_alt: int       # mm above home
    vx: int
    vy: int
    vz: int
    hdg: int                # cdeg, 65535 = unknown

    @classmethod
    def decode(cls, payload: bytes) -> "GlobalPositionInt":
        return cls(*_GPI.unpack_from(payload))


def parse_datagram(data: bytes, counters: dict[str, int] | None = None) -> list[MavMessage]:
    """Parse every MAVLink v1/v2 frame of a known message id in one UDP datagram.

    Frames of other ids are skipped (their CRC_EXTRA is not needed here);
    frames with a bad checksum, unknown incompatibility flags or truncation are dropped.
    """
    counters = counters if counters is not None else {}
    out: list[MavMessage] = []
    i, n = 0, len(data)
    while i < n:
        magic = data[i]
        if magic == MAVLINK_V1:
            hdr = 6
            if i + hdr + 2 > n:
                break
            plen = data[i + 1]
            total = hdr + plen + 2
            if i + total > n:
                counters["truncated"] = counters.get("truncated", 0) + 1
                break
            sysid, compid, msgid = data[i + 3], data[i + 4], data[i + 5]
        elif magic == MAVLINK_V2:
            hdr = 10
            if i + hdr + 2 > n:
                break
            plen, iflags = data[i + 1], data[i + 2]
            if iflags & ~MAVLINK_IFLAG_SIGNED:
                counters["bad_flags"] = counters.get("bad_flags", 0) + 1
                i += 1
                continue
            total = hdr + plen + 2 + (13 if iflags & MAVLINK_IFLAG_SIGNED else 0)
            if i + total > n:
                counters["truncated"] = counters.get("truncated", 0) + 1
                break
            sysid, compid = data[i + 5], data[i + 6]
            msgid = int.from_bytes(data[i + 7:i + 10], "little")
        else:
            i += 1                    # resync on the next magic byte
            continue
        extra = CRC_EXTRA.get(msgid)
        if extra is None:
            counters["other_msg"] = counters.get("other_msg", 0) + 1
            i += total
            continue
        body = data[i + 1:i + hdr + plen]
        (crc_rx,) = struct.unpack_from("<H", data, i + hdr + plen)
        if x25_crc(bytes(body) + bytes((extra,))) != crc_rx:
            counters["bad_crc"] = counters.get("bad_crc", 0) + 1
            i += 1
            continue
        payload = bytes(data[i + hdr:i + hdr + plen])
        full = PAYLOAD_LEN[msgid]
        if len(payload) > full and magic == MAVLINK_V1:
            counters["bad_len"] = counters.get("bad_len", 0) + 1
            i += total
            continue
        out.append(MavMessage(msgid, sysid, compid, payload[:full].ljust(full, b"\0")))
        i += total
    return out


class CarrierPosition:
    """Carrier position for C2 ``carrier``. Thread-safe."""

    def __init__(self, cfg: MavlinkConfig, clock: Callable[[], float] = time.perf_counter) -> None:
        self.cfg = cfg
        self._clock = clock
        self._lock = threading.Lock()
        self.sysid: int | None = cfg.carrier_sysid
        self._locked = cfg.carrier_sysid is not None
        self.heartbeat: Heartbeat | None = None
        self.heartbeat_t: float | None = None
        self.position: GlobalPositionInt | None = None
        self.position_t: float | None = None
        self.counters: dict[str, int] = {}

    def _count(self, key: str) -> None:
        self.counters[key] = self.counters.get(key, 0) + 1

    def on_message(self, msg: MavMessage, now: float | None = None) -> None:
        now = self._clock() if now is None else now
        with self._lock:
            if msg.msgid == MSG_HEARTBEAT:
                hb = Heartbeat.decode(msg.payload)
                if self._locked:
                    ok = msg.sysid == self.sysid and hb.autopilot != MAV_AUTOPILOT_INVALID
                else:
                    ok = hb.autopilot == MAV_AUTOPILOT_ARDUPILOTMEGA
                    if ok:
                        self.sysid, self._locked = msg.sysid, True
                        log.info("carrier: ArduPilot heartbeat from sysid %d", msg.sysid)
                if ok:
                    self.heartbeat, self.heartbeat_t = hb, now
                    self._count("heartbeat")
                else:
                    self._count("ignored_heartbeat")
            elif msg.msgid == MSG_GLOBAL_POSITION_INT:
                if self._locked and msg.sysid == self.sysid:
                    self.position, self.position_t = GlobalPositionInt.decode(msg.payload), now
                    self._count("position")
                else:
                    self._count("ignored_position")

    def to_c2(self, now: float | None = None) -> dict[str, Any]:
        now = self._clock() if now is None else now
        with self._lock:
            pos, t = self.position, self.position_t
        if pos is None or t is None or now - t > self.cfg.stale_s:
            return {"lat": None, "lon": None, "alt_rel_m": None, "hdg_deg": None, "source": None}
        return {"lat": pos.lat / 1e7, "lon": pos.lon / 1e7, "alt_rel_m": pos.relative_alt / 1000,
                "hdg_deg": None if pos.hdg == HDG_UNKNOWN else pos.hdg / 100, "source": "mavlink-readonly"}


class ReceiveOnlySocket:
    """A UDP socket with **no send capability** (S-02b). Only receive-side methods exist."""

    __slots__ = ("_sock",)
    _FORBIDDEN = frozenset(("send", "sendto", "sendall", "sendmsg", "sendfile", "connect", "connect_ex"))

    def __init__(self, sock: socket.socket) -> None:
        object.__setattr__(self, "_sock", sock)

    def recvfrom(self, bufsize: int) -> tuple[bytes, Any]:
        return self._sock.recvfrom(bufsize)

    def settimeout(self, value: float | None) -> None:
        self._sock.settimeout(value)

    def getsockname(self) -> Any:
        return self._sock.getsockname()

    def fileno(self) -> int:
        return self._sock.fileno()

    def close(self) -> None:
        self._sock.close()

    def __setattr__(self, name: str, value: Any) -> None:
        raise AttributeError("ReceiveOnlySocket is immutable")

    def __getattr__(self, name: str) -> Any:
        if name in self._FORBIDDEN:
            raise PermissionError(f"mavlink_ro is read-only: socket.{name} is not available (S-02b)")
        raise AttributeError(name)


def open_listen_socket(cfg: MavlinkConfig,
                       factory: Callable[..., socket.socket] = socket.socket) -> ReceiveOnlySocket:
    sock = factory(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind((cfg.listen_ip, cfg.listen_port))
    except OSError:
        sock.close()
        raise
    return ReceiveOnlySocket(sock)


class MavlinkReadOnly:
    """Listener thread: receive, parse, update :class:`CarrierPosition`. Never sends."""

    def __init__(self, cfg: MavlinkConfig, carrier: CarrierPosition,
                 socket_factory: Callable[..., socket.socket] = socket.socket) -> None:
        self.cfg = cfg
        self.carrier = carrier
        self._factory = socket_factory
        self.sock: ReceiveOnlySocket | None = None
        self.error: str | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def address(self) -> tuple[str, int] | None:
        return self.sock.getsockname()[:2] if self.sock else None

    def start(self) -> "MavlinkReadOnly":
        try:
            self.sock = open_listen_socket(self.cfg, self._factory)
        except OSError as exc:
            self.error = f"cannot listen on {self.cfg.listen_ip}:{self.cfg.listen_port}: {exc}"
            log.error("MAVLink mirror input disabled: %s", self.error)
            return self
        self.sock.settimeout(0.2)
        self._thread = threading.Thread(target=self._run, name="mavlink-ro", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None
        if self.sock is not None:
            self.sock.close()
            self.sock = None

    def _run(self) -> None:
        assert self.sock is not None
        while not self._stop.is_set():
            try:
                data, _src = self.sock.recvfrom(4096)
            except (socket.timeout, BlockingIOError, InterruptedError, ConnectionResetError):
                continue
            except OSError:
                if self._stop.is_set():
                    break
                time.sleep(0.05)
                continue
            try:
                for msg in parse_datagram(data, self.carrier.counters):
                    self.carrier.on_message(msg)
            except Exception:
                log.exception("MAVLink datagram handler failed")
