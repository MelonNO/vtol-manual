"""Client drone in Mission Planner: client CRSF telemetry -> a small MAVLink v2 stream (plan §14.4).

Runs in the **UI process** (brief R0) and is fed with C2 status objects (about 5 Hz).  Mission
Planner opens the stream as a *second* connection (UDP, port ``mp_output.port``, default 14560) and
shows the client as its own vehicle, or, in ``adsb`` mode, as a traffic icon (brief R4).

Safety (plan S-02b):

* the system id is never 1 (the carrier) or 255 (Mission Planner, the primary GCS):
  :func:`encode_frame` itself refuses them, and so do the config and :class:`MpOutput`;
* the destination is a loopback address only (the stream is for Mission Planner on this laptop);
* the HEARTBEAT is a *quadrotor / generic autopilot* (``adsb`` mode: an ADS-B "vehicle" with an
  invalid autopilot), never a GCS heartbeat, so it can never stand in for Mission Planner;
* **inbound packets are ignored**: whatever Mission Planner sends back (its own heartbeats,
  requests, commands) is read and dropped by :meth:`SendOnlyUdp.discard_inbound` without being
  parsed, and nothing here can reach the bridge or the carrier.

Hand-written encoding of MAVLink 2 frames (``0xFD``), payload fields in wire order (sorted by type
size, extensions after), trailing zero bytes truncated, CRC-16/MCRF4XX ("X.25") over the frame
after the magic byte plus the message's CRC_EXTRA.  CRC_EXTRA values are those of MAVLink
``common.xml`` as generated into the C headers (``MAVLINK_MSG_ID_<NAME>_CRC``); the tests recompute
every one of them from the field definitions with the generator's rule.
"""

from __future__ import annotations

import ipaddress
import logging
import math
import socket
import struct
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable

from .config import FORBIDDEN_SYSIDS, MpOutputConfig, mp_sysid_problems
from .mavlink_ro import x25_crc

log = logging.getLogger("vtolgcs.mp_output")

MAVLINK_V2 = 0xFD
MSG_HEARTBEAT, MSG_SYS_STATUS, MSG_ATTITUDE, MSG_GLOBAL_POSITION_INT = 0, 1, 30, 33
MSG_ADSB_VEHICLE, MSG_STATUSTEXT = 246, 253
#: CRC_EXTRA (MAVLink common.xml, ``MAVLINK_MSG_ID_*_CRC`` in the generated C headers).
CRC_EXTRA = {MSG_HEARTBEAT: 50, MSG_SYS_STATUS: 124, MSG_ATTITUDE: 39, MSG_GLOBAL_POSITION_INT: 104,
             MSG_ADSB_VEHICLE: 184, MSG_STATUSTEXT: 83}

# common.xml enum values
MAV_TYPE_QUADROTOR = 2
MAV_TYPE_ADSB = 27
MAV_AUTOPILOT_GENERIC = 0
MAV_AUTOPILOT_INVALID = 8
MAV_MODE_FLAG_SAFETY_ARMED = 128
MAV_STATE_UNINIT, MAV_STATE_STANDBY, MAV_STATE_ACTIVE, MAV_STATE_CRITICAL = 0, 3, 4, 5
MAV_SEVERITY_CRITICAL, MAV_SEVERITY_WARNING, MAV_SEVERITY_INFO = 2, 4, 6
ADSB_ALTITUDE_TYPE_GEOMETRIC = 1
ADSB_EMITTER_TYPE_UAV = 14
ADSB_FLAGS_VALID_COORDS, ADSB_FLAGS_VALID_ALTITUDE, ADSB_FLAGS_VALID_HEADING = 1, 2, 4
ADSB_FLAGS_VALID_VELOCITY, ADSB_FLAGS_VALID_CALLSIGN = 8, 16
UINT16_MAX = 0xFFFF

#: Position/attitude older than this is not sent (app default; the C2 telemetry age decides).
FRESH_S = 3.0
HEARTBEAT_PERIOD_S = 1.0

_HEARTBEAT = struct.Struct("<IBBBBB")                      # custom_mode, type, autopilot, base_mode, status, ver
_SYS_STATUS = struct.Struct("<IIIHHhHHHHHHb")
_ATTITUDE = struct.Struct("<Iffffff")
_GPI = struct.Struct("<IiiiihhhH")
_ADSB = struct.Struct("<IiiiHHhHHB9sBB")
_STATUSTEXT = struct.Struct("<B50s")


class SysidError(ValueError):
    """A forbidden MAVLink system id (S-02b)."""


def encode_frame(msgid: int, payload: bytes, sysid: int, compid: int, seq: int) -> bytes:
    """One MAVLink 2 frame. Refuses sysid 1 and 255 (plan S-02b) whatever the caller's config says."""
    if sysid in FORBIDDEN_SYSIDS or mp_sysid_problems(sysid):
        raise SysidError(f"refusing to send MAVLink as sysid {sysid} (plan S-02b)")
    payload = payload.rstrip(b"\0") or payload[:1]          # MAVLink 2 truncation (keep >= 1 byte)
    header = bytes((len(payload), 0, 0, seq & 0xFF, sysid, compid)) + msgid.to_bytes(3, "little")
    crc = x25_crc(header + payload + bytes((CRC_EXTRA[msgid],)))
    return bytes((MAVLINK_V2,)) + header + payload + struct.pack("<H", crc)


# --------------------------------------------------------------------------- payloads from C2

def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _clamp(v: float, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(round(v))))


def heartbeat_payload(armed: bool | None, failsafe: bool | None, adsb: bool = False) -> bytes:
    if adsb:
        return _HEARTBEAT.pack(0, MAV_TYPE_ADSB, MAV_AUTOPILOT_INVALID, 0, MAV_STATE_ACTIVE, 3)
    state = (MAV_STATE_CRITICAL if failsafe else MAV_STATE_ACTIVE if armed else
             MAV_STATE_STANDBY if armed is False else MAV_STATE_UNINIT)
    return _HEARTBEAT.pack(0, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_GENERIC,
                           MAV_MODE_FLAG_SAFETY_ARMED if armed else 0, state, 3)


def sys_status_payload(voltage_v: float | None, current_a: float | None, remaining_pct: float | None) -> bytes:
    mv = _clamp(voltage_v * 1000, 0, UINT16_MAX - 1) if _num(voltage_v) else UINT16_MAX
    ca = _clamp(current_a * 100, -32768, 32767) if _num(current_a) else -1
    rem = _clamp(remaining_pct, 0, 100) if _num(remaining_pct) else -1
    return _SYS_STATUS.pack(0, 0, 0, 0, mv, ca, 0, 0, 0, 0, 0, 0, rem)


def attitude_payload(time_boot_ms: int, roll: float, pitch: float, yaw: float) -> bytes:
    return _ATTITUDE.pack(time_boot_ms & 0xFFFFFFFF, roll, pitch, yaw, 0.0, 0.0, 0.0)


def global_position_payload(time_boot_ms: int, lat: float, lon: float, alt_m: float | None,
                            gspd_kmh: float | None, hdg_deg: float | None) -> bytes:
    """CRSF GPS altitude is the client's GPS altitude (no home reference): used for ``alt`` and
    ``relative_alt``.  Velocity from ground speed and course; vertical speed unknown (0)."""
    alt_mm = _clamp(alt_m * 1000, -2**31, 2**31 - 1) if _num(alt_m) else 0
    vx = vy = 0
    if _num(gspd_kmh) and _num(hdg_deg):
        v = gspd_kmh / 3.6 * 100
        vx = _clamp(v * math.cos(math.radians(hdg_deg)), -32768, 32767)
        vy = _clamp(v * math.sin(math.radians(hdg_deg)), -32768, 32767)
    hdg = _clamp((hdg_deg % 360) * 100, 0, 35999) if _num(hdg_deg) else UINT16_MAX
    return _GPI.pack(time_boot_ms & 0xFFFFFFFF, round(lat * 1e7), round(lon * 1e7), alt_mm, alt_mm, vx, vy, 0, hdg)


def adsb_payload(icao: int, lat: float, lon: float, alt_m: float | None, hdg_deg: float | None,
                 gspd_kmh: float | None, callsign: str, tslc_s: float | None) -> bytes:
    flags = ADSB_FLAGS_VALID_COORDS | ADSB_FLAGS_VALID_CALLSIGN
    alt_mm = 0
    if _num(alt_m):
        alt_mm, flags = _clamp(alt_m * 1000, -2**31, 2**31 - 1), flags | ADSB_FLAGS_VALID_ALTITUDE
    hdg = 0
    if _num(hdg_deg):
        hdg, flags = _clamp((hdg_deg % 360) * 100, 0, 35999), flags | ADSB_FLAGS_VALID_HEADING
    hv = 0
    if _num(gspd_kmh):
        hv, flags = _clamp(gspd_kmh / 3.6 * 100, 0, UINT16_MAX), flags | ADSB_FLAGS_VALID_VELOCITY
    tslc = _clamp(tslc_s, 0, 255) if _num(tslc_s) else 255
    cs = callsign.encode("ascii", "replace")[:8].ljust(9, b"\0")
    return _ADSB.pack(icao, round(lat * 1e7), round(lon * 1e7), alt_mm, hdg, hv, 0, flags, 0,
                      ADSB_ALTITUDE_TYPE_GEOMETRIC, cs, ADSB_EMITTER_TYPE_UAV, tslc)


def statustext_payload(severity: int, text: str) -> bytes:
    return _STATUSTEXT.pack(severity, text.encode("ascii", "replace")[:50])


# --------------------------------------------------------------------------- socket

class SendOnlyUdp:
    """A UDP socket that sends to one loopback destination and drops everything it receives.

    There is deliberately no method that returns received data: inbound datagrams are counted and
    discarded unparsed, so nothing from Mission Planner can be forwarded anywhere (S-02b).
    """

    def __init__(self, host: str, port: int, factory: Callable[..., socket.socket] = socket.socket) -> None:
        if not ipaddress.IPv4Address(host).is_loopback:
            raise ValueError(f"MAVLink output must go to a loopback address, not {host}")
        self._dest = (host, port)
        self._sock = factory(socket.AF_INET, socket.SOCK_DGRAM)
        ioctl = getattr(socket, "SIO_UDP_CONNRESET", None)
        if ioctl is not None and hasattr(self._sock, "ioctl"):
            try:
                self._sock.ioctl(ioctl, False)           # MP not listening: no recv errors
            except OSError:
                pass
        self._sock.bind(("127.0.0.1", 0))
        self._sock.setblocking(False)
        self.inbound_ignored = 0
        self.send_errors = 0

    @property
    def local_port(self) -> int:
        return self._sock.getsockname()[1]

    @property
    def dest(self) -> tuple[str, int]:
        return self._dest

    def send(self, data: bytes) -> None:
        try:
            self._sock.sendto(data, self._dest)
        except OSError:
            self.send_errors += 1

    def discard_inbound(self) -> int:
        """Read and drop pending inbound datagrams (never parsed, never forwarded)."""
        n = 0
        while True:
            try:
                self._sock.recv(4096)
            except (BlockingIOError, InterruptedError):
                break
            except OSError:                              # e.g. ICMP reset on old Windows: ignore
                break
            n += 1
        self.inbound_ignored += n
        return n

    def close(self) -> None:
        self._sock.close()


# --------------------------------------------------------------------------- output

@dataclass
class MpStats:
    frames_sent: int = 0
    inbound_ignored: int = 0
    last_mode: str | None = None


class MpOutput:
    """C2 status objects in, MAVLink frames out. Call :meth:`on_status` from one thread (~5 Hz)."""

    def __init__(self, cfg: MpOutputConfig, clock: Callable[[], float] = time.monotonic,
                 sock: SendOnlyUdp | None = None) -> None:
        problems = mp_sysid_problems(cfg.sysid, "mp_output.sysid")
        if problems:
            raise SysidError("; ".join(problems))
        if cfg.mode not in ("vehicle", "adsb"):
            raise ValueError(f"mp_output.mode {cfg.mode!r}")
        self.cfg = cfg
        self._clock = clock
        self._t0 = clock()
        self.sock = sock or SendOnlyUdp(cfg.host, cfg.port)
        self._seq = 0
        self._last_hb: float | None = None
        self._last_mode: str | None = None
        self._lock = threading.Lock()
        self.stats = MpStats()

    @property
    def callsign(self) -> str:
        return self.cfg.callsign or f"FPV{self.cfg.sysid}"

    def _send(self, msgid: int, payload: bytes) -> None:
        frame = encode_frame(msgid, payload, self.cfg.sysid, self.cfg.compid, self._seq)
        self._seq = (self._seq + 1) & 0xFF
        self.sock.send(frame)
        self.stats.frames_sent += 1

    def frames_for(self, status: dict, now: float) -> list[tuple[int, bytes]]:
        """The (msgid, payload) list for one status object (pure; used by :meth:`on_status` and tests)."""
        client = status.get("client") or {}
        age_ms = client.get("telemetry_age_ms")
        if age_ms is None:
            return []                                    # no client heard yet: no vehicle in MP
        fresh = age_ms <= FRESH_S * 1000
        fm, gps = client.get("flight_mode") or {}, client.get("gps") or {}
        att, batt = client.get("attitude") or {}, client.get("battery") or {}
        boot_ms = int((now - self._t0) * 1000)
        out: list[tuple[int, bytes]] = []
        adsb = self.cfg.mode == "adsb"
        if self._last_hb is None or now - self._last_hb >= HEARTBEAT_PERIOD_S:
            self._last_hb = now
            out.append((MSG_HEARTBEAT, heartbeat_payload(fm.get("armed"), fm.get("failsafe"), adsb)))
        has_pos = fresh and _num(gps.get("lat")) and _num(gps.get("lon"))
        if adsb:
            if has_pos:
                icao = self.cfg.adsb_icao or self.cfg.sysid
                out.append((MSG_ADSB_VEHICLE, adsb_payload(icao, gps["lat"], gps["lon"], gps.get("alt_m"),
                                                           gps.get("hdg_deg"), gps.get("gspd_kmh"), self.callsign,
                                                           age_ms / 1000)))
            return out
        if has_pos:
            out.append((MSG_GLOBAL_POSITION_INT, global_position_payload(
                boot_ms, gps["lat"], gps["lon"], gps.get("alt_m"), gps.get("gspd_kmh"), gps.get("hdg_deg"))))
        if fresh and all(_num(att.get(k)) for k in ("roll_rad", "pitch_rad", "yaw_rad")):
            out.append((MSG_ATTITUDE, attitude_payload(boot_ms, att["roll_rad"], att["pitch_rad"], att["yaw_rad"])))
        if fresh and _num(batt.get("voltage_v")):
            out.append((MSG_SYS_STATUS, sys_status_payload(batt.get("voltage_v"), batt.get("current_a"),
                                                           batt.get("remaining_pct"))))
        raw = fm.get("raw")
        if raw and raw != self._last_mode:
            if self._last_mode is not None or fm.get("failsafe"):
                sev = (MAV_SEVERITY_CRITICAL if fm.get("failsafe") else
                       MAV_SEVERITY_WARNING if raw.startswith("RTH") else MAV_SEVERITY_INFO)
                out.append((MSG_STATUSTEXT, statustext_payload(sev, f"FPV mode {raw}")))
            self._last_mode = raw
            self.stats.last_mode = raw
        return out

    def on_status(self, status: dict) -> int:
        """Send the frames for one status object; drop whatever came in. Returns frames sent."""
        with self._lock:
            self.stats.inbound_ignored += self.sock.discard_inbound()
            frames = self.frames_for(status, self._clock())
            for msgid, payload in frames:
                self._send(msgid, payload)
            return len(frames)

    def close(self) -> None:
        self.sock.close()


__all__ = ["CRC_EXTRA", "MpOutput", "MpStats", "SendOnlyUdp", "SysidError", "adsb_payload", "attitude_payload",
           "encode_frame", "global_position_payload", "heartbeat_payload", "statustext_payload", "sys_status_payload"]
