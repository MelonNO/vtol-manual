#!/usr/bin/env python3
"""Relay RC-bridge simulator (G0 + W5500 + ELRS TX module + client drone).

Implements relay UDP protocol v1 (PROPOSAL — see protocol/README.md) on a UDP
port so the GCS app can be developed and tested without hardware:

* state machine BOOT -> WAIT_GCS -> (5 consecutive valid rc_up) -> START
  (ModelID x3) -> RUN -> (no valid packet for T_hold) -> FAILSAFE -> WAIT_GCS;
* rc_up validation: magic, ver, length, CRC-16, source IP, ``(int32)(seq - last) > 0``;
* CAM_ENABLE with switch read-back, ``--camera-policy design|client-gated``;
* 10 Hz ``status`` (+ one on every state change) to the last valid sender,
  echoing ``t_gcs_us``; optional ``--latency-ms/--jitter-ms/--loss-pct``;
* a simulated client: GPS circle, battery sag, LQ falling with distance,
  flight-mode string (``ANGL*`` -> ``ANGL`` on CH5 high -> ``!FS!`` after bridge
  FAILSAFE -> ``RTH``; CH5 must be seen low before arming), sent as ``crsf_fwd`` at ``--telemetry-hz``;
* optional fake "video" (RTP header + filler, not H.264) at ``--video-kbps``;
* optional ``--crsf-pass``: accept ``crsf_pass`` (future firmware feature Q7a)
  and answer device ping / parameter read / write from a small fake module;
  ``--module elrs`` (WP08b) uses a larger ELRS-like tree with nested folders, a
  multi-chunk entry, hidden entries, commands and a VTX Administrator folder;
  ``--no-vrx-follow`` makes a VTX change drop the reported decoder lock (status
  bit 3, with ``--report-video``) until the old band/channel is restored.

All simulated values are for software testing only — never use them as
operational figures.

Usage::

    python gcs/tools/bridge_sim.py -v
    python gcs/tools/bridge_sim.py --camera-policy client-gated --latency-ms 80 --loss-pct 2
"""

from __future__ import annotations

import argparse
import collections
import heapq
import ipaddress
import logging
import math
import os
import random
import select
import socket
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Iterable

try:
    from vtolgcs import crsf, protocol
except ImportError:  # running from a source checkout: add gcs/ to the path
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from vtolgcs import crsf, protocol

from vtolgcs.protocol import BridgeState, ProtocolError, RcUp, Status

log = logging.getLogger("bridge_sim")

CAMERA_POLICIES = ("design", "client-gated")
CAM_FAULTS = ("none", "stuck-on", "stuck-off")


# =========================================================================== bridge core

@dataclass
class BridgeConfig:
    """G0 bridge behaviour. Defaults follow the relay design where it gives a value."""

    t_hold_s: float = 0.25                 # relay design: "start at 250 ms"
    start_packets: int = 5                 # relay design: 5 consecutive valid packets
    model_id_repeats: int = 3              # relay design: START sends ModelID x 3
    model_id: int = 0
    camera_policy: str = "design"
    #: Allowed rc_up source networks; empty = accept any source.
    allowed_src: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...] = ()
    elrs_rate_hz: float = 250.0            # sim: CRSF slot rate / reported sync period
    boot_s: float = 0.2                    # sim: time spent in BOOT
    fw_ver: int = protocol.fw_ver_encode(0, 1)
    cam_fault: str = "none"                # 'none' | 'stuck-on' | 'stuck-off' (read-back fault)
    p2_link_100fd: bool = True
    timing_lock_s: float = 0.3             # sim: RUN time until timing_locked
    report_video: str | None = None        # None | 'PAL' | 'NTSC' -> status bits 3/4 (future)
    seed: int | None = None


class BridgeCore:
    """The G0 firmware logic, without sockets. Drive it with :meth:`on_datagram` and :meth:`tick`.

    Time is always passed in (seconds, any monotonic origin), so tests can use a fake clock.
    """

    def __init__(self, cfg: BridgeConfig, now: float) -> None:
        if cfg.camera_policy not in CAMERA_POLICIES:
            raise ValueError(f"camera_policy must be one of {CAMERA_POLICIES}")
        if cfg.cam_fault not in CAM_FAULTS:
            raise ValueError(f"cam_fault must be one of {CAM_FAULTS}")
        self.cfg = cfg
        self._rng = random.Random(cfg.seed)
        self.state = BridgeState.BOOT
        self.boot_time = now
        self.state_since = now
        self.transitions: list[tuple[float, BridgeState, BridgeState]] = []
        #: states entered since the runner last looked; one immediate status is sent per entry
        self.pending_states: list[BridgeState] = []
        # rc_up bookkeeping
        self.last_seq: int | None = None
        self.consecutive_valid = 0
        self.last_valid_time: float | None = None
        self.last_rc: RcUp | None = None
        self.reply_addr: tuple[str, int] | None = None
        self.has_run = False                # entered START at least once since boot
        # counters reported in status
        self.rx_ok = 0
        self.rx_bad_crc = 0                 # every packet rejected by format checks (see README)
        self.rx_bad_seq = 0
        self.crsf_tx = 0
        self.rx_bad_src = 0                 # not in status v1; logged only
        self.status_seq = 0
        # CRSF output
        self.crsf_period = 1.0 / cfg.elrs_rate_hz
        self._next_slot = now
        self._model_id_sent = 0
        self.model_id_frames: list[tuple[float, bytes]] = []
        self.last_rc_frame: bytes | None = None
        #: the 22 ``ch`` bytes of the latest valid rc_up, forwarded unchanged (any 11-bit value)
        self.last_ch_raw: bytes | None = None
        # camera
        self.cam_command = self._camera_command()
        self.cam_register = self._apply_fault(self.cam_command)
        #: WP08b: None = decoder lock as configured; False = lost (simulated VRX not following a VTX change)
        self.decoder_lock_override: bool | None = None
        # timing lock simulation
        self._offset0 = self._rng.randint(800, 2000) * self._rng.choice((-1, 1))

    # ------------------------------------------------------------------ helpers
    def _set_state(self, new: BridgeState, now: float) -> None:
        if new == self.state:
            return
        log.info("bridge %s -> %s", self.state.name, new.name)
        self.transitions.append((now, self.state, new))
        self.state, self.state_since = new, now
        self.pending_states.append(new)
        if new == BridgeState.START:
            self.has_run = True
            self._model_id_sent = 0
        if new in (BridgeState.WAIT_GCS, BridgeState.FAILSAFE):
            self.consecutive_valid = 0
        self._update_camera()

    def _camera_command(self) -> bool:
        streaming = self.state in (BridgeState.START, BridgeState.RUN)
        requested = bool(self.last_rc and self.last_rc.cam_enable)
        if self.cfg.camera_policy == "client-gated" and not self.has_run:
            return True                      # no GCS stream since boot: carrier-only flight
        return streaming and requested       # design: off unless the stream runs and asks for it

    def _apply_fault(self, command: bool) -> bool:
        return {"none": command, "stuck-on": True, "stuck-off": False}[self.cfg.cam_fault]

    def _update_camera(self) -> None:
        cmd = self._camera_command()
        if cmd != self.cam_command:
            log.info("camera command %s", "ON" if cmd else "OFF")
        self.cam_command = cmd
        reg = self._apply_fault(cmd)
        if reg != self.cam_register:
            log.info("camera read-back %s", "ON" if reg else "OFF")
        self.cam_register = reg

    def _src_allowed(self, ip: str) -> bool:
        if not self.cfg.allowed_src:
            return True
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return False
        return any(addr in net for net in self.cfg.allowed_src)

    # ------------------------------------------------------------------ inputs
    def on_datagram(self, data: bytes, src: tuple[str, int], now: float) -> RcUp | None:
        """Process one received rc_up datagram. Returns the packet if it was accepted."""
        self.tick(now)
        if self.state == BridgeState.BOOT:
            return None                      # W5500 socket not open yet
        if not self._src_allowed(src[0]):
            self.rx_bad_src += 1
            log.debug("drop rc_up from %s (source not allowed)", src[0])
            return None
        try:
            pkt = RcUp.unpack(data)
        except ProtocolError as exc:
            self.rx_bad_crc += 1
            self.consecutive_valid = 0
            log.debug("reject rc_up: %s: %s", type(exc).__name__, exc)
            return None
        rebaseline = self.state == BridgeState.WAIT_GCS and self.consecutive_valid == 0
        if self.last_seq is not None and not rebaseline and not protocol.seq_newer(pkt.seq, self.last_seq):
            self.rx_bad_seq += 1
            self.consecutive_valid = 0 if self.state == BridgeState.WAIT_GCS else self.consecutive_valid
            log.debug("reject rc_up: seq %d not newer than %d", pkt.seq, self.last_seq)
            return None
        self.rx_ok += 1
        self.last_seq, self.last_valid_time, self.last_rc = pkt.seq, now, pkt
        self.last_ch_raw = bytes(data[12:34])
        self.reply_addr = (src[0], src[1])
        if self.state == BridgeState.WAIT_GCS:
            self.consecutive_valid += 1
            if self.consecutive_valid >= self.cfg.start_packets:
                self._set_state(BridgeState.START, now)
                self._next_slot = now
        self._update_camera()
        return pkt

    def tick(self, now: float) -> None:
        """Advance time: BOOT delay, CRSF slots (START/RUN), T_hold supervision."""
        if self.state == BridgeState.BOOT:
            if now - self.boot_time >= self.cfg.boot_s:
                self._set_state(BridgeState.WAIT_GCS, now)
            return
        if self.state == BridgeState.WAIT_GCS:
            if (self.consecutive_valid and self.last_valid_time is not None
                    and now - self.last_valid_time > self.cfg.t_hold_s):
                self.consecutive_valid = 0   # a gap breaks "consecutive"
            self._next_slot = now
            return
        if now - self._next_slot > 1.0:       # runner was paused: do not replay a backlog
            self._next_slot = now
        while self._next_slot <= now and self.state in (BridgeState.START, BridgeState.RUN):
            self._crsf_slot(self._next_slot)
            self._next_slot += self.crsf_period

    def _crsf_slot(self, t: float) -> None:
        if self.state == BridgeState.START:
            frame = crsf.build_model_id_frame(self.cfg.model_id)
            self.model_id_frames.append((t, frame))
            self.crsf_tx += 1
            self._model_id_sent += 1
            log.info("CRSF ModelID %d/%d: %s", self._model_id_sent, self.cfg.model_id_repeats,
                     frame.hex(" ").upper())
            if self._model_id_sent >= self.cfg.model_id_repeats:
                self._set_state(BridgeState.RUN, t)
            return
        # RUN
        assert self.last_valid_time is not None and self.last_rc is not None
        if t - self.last_valid_time > self.cfg.t_hold_s:
            log.warning("no valid rc_up for %.0f ms > T_hold: FAILSAFE (CRSF silent)",
                        (t - self.last_valid_time) * 1000)
            self._set_state(BridgeState.FAILSAFE, t)
            self._set_state(BridgeState.WAIT_GCS, t)   # relay design: "Immediately -> WAIT_GCS"
            return
        # Like the G0: copy rc_up.ch into the CRSF frame unchanged (no range judgement).
        assert self.last_ch_raw is not None
        self.last_rc_frame = crsf.build_rc_channels_frame_raw(self.last_ch_raw)
        self.crsf_tx += 1

    # ------------------------------------------------------------------ outputs
    def run_age(self, now: float) -> float:
        """Seconds spent in RUN at ``now`` (0 outside RUN)."""
        return max(0.0, now - self.state_since) if self.state == BridgeState.RUN else 0.0

    def timing_locked(self, now: float) -> bool:
        return self.state == BridgeState.RUN and self.run_age(now) >= self.cfg.timing_lock_s

    def build_status(self, now: float, state: BridgeState | None = None) -> Status:
        """Status for ``now``; increments the status sequence number.

        ``state`` overrides the reported state (used for the immediate status of a
        transient state such as FAILSAFE, which is left in the same instant).
        """
        streaming = self.state in (BridgeState.START, BridgeState.RUN)
        period = round(1e7 / self.cfg.elrs_rate_hz) if streaming else 0
        offset = 0
        if self.state == BridgeState.RUN:
            offset = round(self._offset0 * math.exp(-self.run_age(now) / 0.15)) + self._rng.randint(-3, 3)
        self.status_seq = (self.status_seq + 1) & 0xFFFFFFFF
        return Status(
            state=self.state if state is None else state, seq=self.status_seq,
            t_gcs_us_echo=self.last_rc.t_gcs_us if self.last_rc else 0,
            camera_on_readback=self.cam_register, timing_locked=self.timing_locked(now),
            p2_link_100fd=self.cfg.p2_link_100fd,
            decoder_lock=self.cfg.report_video is not None and self.decoder_lock_override is not False,
            std_ntsc=self.cfg.report_video == "NTSC",
            fw_ver=self.cfg.fw_ver, rx_ok=self.rx_ok & 0xFFFFFFFF,
            rx_bad_crc=self.rx_bad_crc & 0xFFFFFFFF, rx_bad_seq=self.rx_bad_seq & 0xFFFFFFFF,
            crsf_tx=self.crsf_tx & 0xFFFFFFFF, sync_period_x10us=period, sync_offset_x10us=offset)

    def visited(self, state: BridgeState) -> bool:
        return any(new == state for _, _, new in self.transitions)


# =========================================================================== client simulation

@dataclass
class ClientConfig:
    """Simulated client drone. Values are arbitrary test data, not operational figures."""

    lat: float = 59.9000
    lon: float = 10.7500
    radius_m: float = 300.0
    carrier_offset_m: float = 300.0       # carrier sits this far north of the circle centre
    speed_ms: float = 15.0
    cruise_alt_m: float = 50.0
    range_m: float = 1000.0               # LQ model: LQ = 100 - 60 * (d / range)^2
    cells: int = 6
    capacity_mah: int = 1300
    min_sats: int = 8
    gps_fix_delay_s: float = 10.0         # sats < min_sats ('?' suffix) for this long
    fs_delay_s: float = 1.5               # bridge FAILSAFE -> '!FS!'
    rth_delay_s: float = 2.0              # '!FS!' -> 'RTH'
    recover_s: float = 1.0                # RC back -> normal mode
    base_mode: str = "ANGL"
    arm_channel: int = 5                  # 1-based; armed when value > 992 (ELRS CRSF_to_BIT)
    seed: int | None = None


class ClientSim:
    """Client drone model producing Betaflight-style CRSF telemetry."""

    def __init__(self, cfg: ClientConfig, now: float) -> None:
        self.cfg = cfg
        self._rng = random.Random(cfg.seed)
        self.start = now
        self.last_update = now
        self.armed = False
        self.phase = "normal"             # 'normal' | 'failsafe' | 'rth'
        self.rc_lost_since: float | None = None
        self.rc_ok_since: float | None = None
        self.rx_loss_flag = False          # disarmed RX loss -> arming disabled ('!')
        self.arm_switch_cycled = False     # arm switch must be seen low before arming (like Betaflight)
        self.angle = 0.0                   # position on the circle (rad)
        self.x, self.y = cfg.radius_m, 0.0  # east/north metres from the circle centre (home)
        self.home = (self.x, self.y)
        self.alt = 0.0
        self.vz = 0.0
        self.heading = 0.0
        self.speed = 0.0
        self.roll = 0.0
        self.used_mah = 0.0
        self.current = 0.0
        self._rotate = 0

    # ------------------------------------------------------------------ model
    @property
    def sats(self) -> int:
        if self.last_update - self.start < self.cfg.gps_fix_delay_s:
            return max(0, self.cfg.min_sats - 4)
        return self.cfg.min_sats + 4

    def flight_mode(self) -> str:
        if self.phase == "failsafe":
            return "!FS!"
        if self.phase == "rth":
            return "RTH"
        if self.armed:
            return self.cfg.base_mode
        if self.rx_loss_flag:
            suffix = "!"
        elif self.sats < self.cfg.min_sats:
            suffix = "?"
        else:
            suffix = "*"
        return self.cfg.base_mode + suffix

    def update(self, now: float, rc_flowing: bool, channels: Iterable[int] | None) -> None:
        """Advance the model. ``rc_flowing`` = the bridge is sending RC frames (RUN)."""
        dt = max(0.0, now - self.last_update)
        self.last_update = now
        cfg = self.cfg
        chans = list(channels) if channels is not None else None
        arm_high = bool(chans and chans[cfg.arm_channel - 1] > protocol.CRSF_CHANNEL_MID)

        if rc_flowing:
            self.rc_lost_since = None
            self.rx_loss_flag = False
            if self.rc_ok_since is None:
                self.rc_ok_since = now
            if self.phase != "normal" and now - self.rc_ok_since >= cfg.recover_s:
                log.info("client: RC recovered, leaving %s", self.phase)
                self.phase = "normal"
            if self.phase == "normal":
                if not arm_high:
                    self.arm_switch_cycled = True
                if (arm_high and not self.armed and self.arm_switch_cycled
                        and self.flight_mode().endswith("*")):
                    self.armed = True
                    log.info("client: ARMED")
                elif not arm_high and self.armed:
                    self.armed = False
                    log.info("client: disarmed")
        else:
            self.rc_ok_since = None
            if self.rc_lost_since is None:
                self.rc_lost_since = now
            lost = now - self.rc_lost_since
            if self.armed:
                if self.phase == "normal" and lost >= cfg.fs_delay_s:
                    self.phase = "failsafe"
                    log.warning("client: FAILSAFE (!FS!)")
                if self.phase == "failsafe" and lost >= cfg.fs_delay_s + cfg.rth_delay_s:
                    self.phase = "rth"
                    log.warning("client: GPS rescue (RTH)")
            elif lost >= cfg.fs_delay_s:
                self.rx_loss_flag = True
                self.arm_switch_cycled = False

        self._move(dt)
        self._battery(dt)

    def _move(self, dt: float) -> None:
        cfg = self.cfg
        vx = vy = 0.0
        if self.armed and self.phase == "normal":
            omega = cfg.speed_ms / cfg.radius_m
            self.angle = (self.angle + omega * dt) % (2 * math.pi)
            nx, ny = cfg.radius_m * math.cos(self.angle), cfg.radius_m * math.sin(self.angle)
            vx, vy = (nx - self.x) / dt if dt else 0.0, (ny - self.y) / dt if dt else 0.0
            self.x, self.y = nx, ny
            self.roll = math.atan(cfg.speed_ms ** 2 / (9.81 * cfg.radius_m))
            target_alt = cfg.cruise_alt_m
        elif self.armed and self.phase == "rth":
            dx, dy = self.home[0] - self.x, self.home[1] - self.y
            dist = math.hypot(dx, dy)
            step = min(dist, cfg.speed_ms * dt)
            if dist > 0.1:
                vx, vy = dx / dist * step / dt if dt else 0.0, dy / dist * step / dt if dt else 0.0
                self.x += dx / dist * step
                self.y += dy / dist * step
            self.roll = 0.0
            target_alt = self.alt
        else:
            self.roll = 0.0
            target_alt = self.alt if self.armed else 0.0
        climb = max(-3.0 * dt, min(3.0 * dt, target_alt - self.alt))
        self.vz = climb / dt if dt else 0.0
        self.alt += climb
        self.speed = math.hypot(vx, vy)
        if self.speed > 0.1:
            self.heading = math.degrees(math.atan2(vx, vy)) % 360

    def _battery(self, dt: float) -> None:
        self.current = 12.0 if self.armed else 0.4
        self.used_mah = min(self.cfg.capacity_mah, self.used_mah + self.current * dt / 3.6)

    @property
    def carrier_xy(self) -> tuple[float, float]:
        return 0.0, self.cfg.carrier_offset_m

    def distance_to_carrier(self) -> float:
        cx, cy = self.carrier_xy
        return math.hypot(self.x - cx, self.y - cy)

    def latlon(self) -> tuple[float, float]:
        lat = self.cfg.lat + self.y / 111_320.0
        lon = self.cfg.lon + self.x / (111_320.0 * math.cos(math.radians(self.cfg.lat)))
        return lat, lon

    # ------------------------------------------------------------------ telemetry
    def link_stats(self) -> crsf.LinkStatistics:
        d = self.distance_to_carrier()
        rssi = round(-40 - 25 * math.log10(1 + d / 20))
        lq = round(100 - 60 * (d / self.cfg.range_m) ** 2) + self._rng.randint(-2, 0)
        lq = max(0, min(100, lq))
        snr = max(-10, min(13, round((rssi + 110) / 4)))
        return crsf.LinkStatistics(rssi1_dbm=rssi, rssi2_dbm=rssi - 2, lq_pct=lq, snr_db=snr,
                                   active_antenna=0, rf_mode=6, tx_power_index=7,
                                   dl_rssi_dbm=rssi - 3, dl_lq_pct=min(100, lq + 1), dl_snr_db=snr - 1)

    def battery(self) -> crsf.Battery:
        cfg = self.cfg
        frac = self.used_mah / cfg.capacity_mah
        cell = max(3.0, 4.2 - 0.9 * frac)
        volt = cfg.cells * cell - self.current * 0.03
        return crsf.Battery(voltage_v=round(volt, 1), current_a=round(self.current, 1),
                            used_mah=int(self.used_mah), remaining_pct=max(0, round(100 * (1 - frac))))

    def gps(self) -> crsf.Gps:
        lat, lon = self.latlon()
        return crsf.Gps(lat_deg=lat, lon_deg=lon, gspd_kmh=self.speed * 3.6, hdg_deg=self.heading,
                        alt_m=round(self.alt), sats=self.sats)

    def attitude(self) -> crsf.Attitude:
        yaw = math.radians(self.heading)
        yaw = (yaw + math.pi) % (2 * math.pi) - math.pi
        pitch = -0.05 if self.armed and self.speed > 1 else 0.0
        return crsf.Attitude(pitch_rad=pitch, roll_rad=self.roll, yaw_rad=yaw)

    def telemetry_frames(self) -> list[bytes]:
        """One telemetry burst: link stats + flight mode + one rotating sensor frame."""
        rotating: list[Callable[[], object]] = [
            self.gps, self.battery, self.attitude,
            lambda: crsf.Vario(vspd_ms=self.vz),
            lambda: crsf.BaroAltitude(alt_m=self.alt, vspd_ms=self.vz, vspd_format="betaflight"),
        ]
        extra = rotating[self._rotate % len(rotating)]()
        self._rotate += 1
        return [crsf.telemetry_frame(self.link_stats()),
                crsf.telemetry_frame(crsf.FlightMode(self.flight_mode())),
                crsf.telemetry_frame(extra)]  # type: ignore[arg-type]


# =========================================================================== fake TX-module parameters (Q7a)

class FakeModule:
    """A tiny CRSF parameter tree so the GCS parameter menu can be exercised (``--crsf-pass``).

    The names and options are SIMULATOR data, not a copy of any real module's menu.
    """

    NAME = "SIM ELRS TX"

    def __init__(self) -> None:
        P = crsf.ParamType
        self.params: dict[int, crsf.ParameterEntry] = {
            1: crsf.ParameterEntry(1, 0, P.TEXT_SELECTION, False, "Packet Rate", value=2,
                                   min=0, max=3, options=["50Hz", "150Hz", "250Hz", "500Hz"]),
            2: crsf.ParameterEntry(2, 0, P.TEXT_SELECTION, False, "Telem Ratio", value=3,
                                   min=0, max=4, options=["Off", "1:128", "1:64", "1:16", "1:8"]),
            3: crsf.ParameterEntry(3, 0, P.FOLDER, False, "TX Power", children=[4]),
            4: crsf.ParameterEntry(4, 3, P.TEXT_SELECTION, False, "Max Power", value=1,
                                   min=0, max=3, options=["10", "25", "100", "250"], units="mW"),
            5: crsf.ParameterEntry(5, 0, P.COMMAND, False, "Bind", value=crsf.CommandStep.IDLE,
                                   timeout_ms=2000, info=""),
            6: crsf.ParameterEntry(6, 0, P.INFO, False, "Sim build", value="WP03 bridge_sim"),
            7: crsf.ParameterEntry(7, 0, P.UINT8, False, "Model Id", value=0, min=0, max=63, default=0),
        }

    def handle(self, frame: crsf.CrsfFrame) -> list[bytes]:
        """Reply frames for a frame the GCS sent through crsf_pass."""
        A = crsf.Addr
        if frame.type == crsf.FrameType.DEVICE_PING:
            info = crsf.DeviceInfo(dest=frame.origin or A.RADIO_TRANSMITTER, origin=A.CRSF_TRANSMITTER,
                                   name=self.NAME, serial_no=crsf.ELRS_SERIAL, hardware_ver=0,
                                   software_ver=0x00000001, field_count=len(self.params),
                                   parameter_version=0)
            return [info.to_frame()]
        if frame.type == crsf.FrameType.PARAMETER_READ and len(frame.body) >= 2:
            num, chunk = frame.body[0], frame.body[1]
            entry = self.params.get(num)
            if entry is None:
                return []
            frames = crsf.build_parameter_entry_frames(num, crsf.encode_parameter_entry(entry),
                                                       dest=frame.origin or A.RADIO_TRANSMITTER)
            return [frames[chunk]] if chunk < len(frames) else []
        if frame.type == crsf.FrameType.PARAMETER_WRITE and len(frame.body) >= 2:
            entry = self.params.get(frame.body[0])
            if entry is not None and entry.type != crsf.ParamType.FOLDER:
                value = int.from_bytes(frame.body[1:], "big")
                if entry.type == crsf.ParamType.COMMAND:
                    entry.value = crsf.CommandStep.IDLE if value == crsf.CommandStep.CANCEL else \
                        crsf.CommandStep.EXECUTING if value == crsf.CommandStep.CLICK else entry.value
                else:
                    entry.value = value
                log.info("fake module: param %d (%s) := %s", entry.number, entry.name, entry.value)
        return []


class ElrsModule(FakeModule):
    """A larger, ELRS-like parameter tree for the WP08b menu tests (``--module elrs``).

    Folder and field names follow the ELRS TX Lua menu, including its "VTX Administrator" folder;
    options and values are SIMULATOR data, not a copy of a real module.  Commands go CLICK ->
    EXECUTING -> IDLE after ``command_s``; "Bind" asks for confirmation first (ASK_CONFIRM).
    """

    NAME = "SIM ELRS TX (tree)"

    def __init__(self, command_s: float = 0.3, clock: Callable[[], float] = time.monotonic) -> None:
        super().__init__()
        P = crsf.ParamType
        E = crsf.ParameterEntry
        rates = ["50Hz(-115dBm)", "100Hz Full(-112dBm)", "150Hz(-112dBm)", "250Hz(-108dBm)",
                 "333Hz Full(-105dBm)", "500Hz(-105dBm)", "D250(-104dBm)", "D500(-104dBm)", "F500(-104dBm)",
                 "F1000(-104dBm)"]
        self.params = {
            1: E(1, 0, P.TEXT_SELECTION, False, "Packet Rate", value=3, min=0, max=len(rates) - 1, options=rates),
            2: E(2, 0, P.TEXT_SELECTION, False, "Telem Ratio", value=3, min=0, max=4,
                 options=["Off", "1:128", "1:64", "1:16", "1:8"]),
            3: E(3, 0, P.FOLDER, False, "TX Power", children=[4, 5]),
            4: E(4, 3, P.TEXT_SELECTION, False, "Max Power", value=1, min=0, max=3,
                 options=["10", "25", "100", "250"], units="mW"),
            5: E(5, 3, P.TEXT_SELECTION, False, "Dynamic", value=0, min=0, max=1, options=["Off", "On"]),
            6: E(6, 0, P.FOLDER, False, "VTX Administrator", children=[7, 8, 9, 10, 11]),
            7: E(7, 6, P.TEXT_SELECTION, False, "Band", value=5, min=0, max=6,
                 options=["Off", "A", "B", "E", "F", "R", "L"]),
            8: E(8, 6, P.TEXT_SELECTION, False, "Channel", value=4, min=0, max=7,
                 options=["1", "2", "3", "4", "5", "6", "7", "8"]),
            9: E(9, 6, P.TEXT_SELECTION, False, "Pwr Lvl", value=1, min=0, max=8,
                 options=["-", "1", "2", "3", "4", "5", "6", "7", "8"]),
            10: E(10, 6, P.TEXT_SELECTION, False, "Pitmode", value=0, min=0, max=1, options=["Off", "On"]),
            11: E(11, 6, P.COMMAND, False, "Send VTx", value=crsf.CommandStep.IDLE, timeout_ms=200, info=""),
            12: E(12, 0, P.COMMAND, False, "Bind", value=crsf.CommandStep.IDLE, timeout_ms=200, info=""),
            13: E(13, 0, P.UINT8, False, "Model Id", value=0, min=0, max=63, default=0),
            14: E(14, 0, P.INFO, True, "Hidden diag", value="x"),
            15: E(15, 0, P.INFO, False, "Sim build", value="WP08b bridge_sim"),
        }
        self.command_s = command_s
        self._clock = clock
        self._running: dict[int, float] = {}
        self.vtx_initial = self._vtx()
        self.vtx_sent: tuple[int, int, int] | None = None
        self.commands_run: list[str] = []

    def _vtx(self) -> tuple[int, int, int]:
        return int(self.params[7].value), int(self.params[8].value), int(self.params[9].value)

    def _finish_commands(self) -> None:
        now = self._clock()
        for num, started in list(self._running.items()):
            if now - started >= self.command_s:
                entry = self.params[num]
                entry.value, entry.info = crsf.CommandStep.IDLE, ""
                del self._running[num]
                self.commands_run.append(entry.name)
                if entry.name == "Send VTx":
                    self.vtx_sent = self._vtx()
                    log.info("fake module: VTX sent band/channel/power %s", self.vtx_sent)

    def handle(self, frame: crsf.CrsfFrame) -> list[bytes]:
        self._finish_commands()
        if frame.type == crsf.FrameType.PARAMETER_WRITE and len(frame.body) >= 2:
            entry = self.params.get(frame.body[0])
            if entry is not None and entry.type == crsf.ParamType.COMMAND:
                step = frame.body[1]
                S = crsf.CommandStep
                if step == S.CLICK and entry.name == "Bind":
                    entry.value, entry.info = S.ASK_CONFIRM, "Bind?"
                elif step in (S.CLICK, S.CONFIRMED):
                    entry.value, entry.info = S.EXECUTING, "Sending..."
                    self._running[entry.number] = self._clock()
                elif step == S.CANCEL:
                    entry.value, entry.info = S.IDLE, ""
                    self._running.pop(entry.number, None)
                return []
            if entry is not None and entry.type == crsf.ParamType.TEXT_SELECTION:
                value = frame.body[1]
                if not int(entry.min or 0) <= value <= int(entry.max or 0):
                    return []                       # out of range: ignored, like a real module would
        return super().handle(frame)


# =========================================================================== UDP runner

@dataclass
class SimConfig:
    host: str = "127.0.0.1"
    port: int = protocol.BRIDGE_PORT
    status_hz: float = 10.0
    telemetry_hz: float = 10.0            # 0 = no client telemetry
    latency_ms: float = 0.0               # added to every bridge -> GCS datagram
    jitter_ms: float = 0.0                # +/- uniform, added to latency
    loss_pct: float = 0.0                 # bridge -> GCS loss
    uplink_loss_pct: float = 0.0          # GCS -> bridge loss (applied before validation)
    video_kbps: float = 0.0               # 0 = off
    video_dest: tuple[str, int] = ("127.0.0.1", protocol.VIDEO_PORT)
    crsf_pass: bool = False
    module: str = "basic"                 # 'basic' (FakeModule) | 'elrs' (ElrsModule, WP08b)
    vrx_follows: bool = True              # False: a VTX change drops the decoder lock (WP08b R6)
    bridge: BridgeConfig = field(default_factory=BridgeConfig)
    client: ClientConfig = field(default_factory=ClientConfig)
    seed: int | None = None


def _disable_udp_connreset(sock: socket.socket) -> None:
    """Windows: stop ICMP 'port unreachable' from turning into recv errors (WSAECONNRESET)."""
    ioctl = getattr(socket, "SIO_UDP_CONNRESET", None)
    if ioctl is not None and hasattr(sock, "ioctl"):
        try:
            sock.ioctl(ioctl, False)
        except OSError:
            pass


class BridgeSim:
    """UDP front-end around :class:`BridgeCore` and :class:`ClientSim`."""

    def __init__(self, cfg: SimConfig, clock: Callable[[], float] = time.perf_counter) -> None:
        self.cfg = cfg
        self.clock = clock
        self._rng = random.Random(cfg.seed)
        now = clock()
        self.lock = threading.RLock()
        self.core = BridgeCore(cfg.bridge, now)
        self.client = ClientSim(cfg.client, now)
        self.module = ElrsModule() if cfg.module == "elrs" else FakeModule()
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        _disable_udp_connreset(self.sock)
        self.sock.bind((cfg.host, cfg.port))
        self.sock.setblocking(False)
        self._out: list[tuple[float, int, bytes, tuple[str, int]]] = []
        self._out_seq = 0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._next_status = now
        self._next_tlm = now
        self._video_credit = 0.0
        self._video_seq = 0
        self._last_loop = now
        self.sent_counts: collections.Counter[str] = collections.Counter()

    @property
    def address(self) -> tuple[str, int]:
        return self.sock.getsockname()[:2]

    # ------------------------------------------------------------------ sending
    def _queue(self, data: bytes, addr: tuple[str, int], kind: str, now: float) -> None:
        if self.cfg.loss_pct and self._rng.random() * 100 < self.cfg.loss_pct:
            return
        delay = self.cfg.latency_ms / 1000
        if self.cfg.jitter_ms:
            delay += self._rng.uniform(-self.cfg.jitter_ms, self.cfg.jitter_ms) / 1000
        self._out_seq += 1
        heapq.heappush(self._out, (now + max(0.0, delay), self._out_seq, data, addr))
        self.sent_counts[kind] += 1

    def _flush(self, now: float) -> None:
        while self._out and self._out[0][0] <= now:
            _, _, data, addr = heapq.heappop(self._out)
            try:
                self.sock.sendto(data, addr)
            except OSError as exc:
                log.debug("sendto %s failed: %s", addr, exc)

    def _send_status(self, now: float, state: BridgeState | None = None) -> None:
        if self.core.reply_addr is None:
            return
        self._queue(self.core.build_status(now, state).pack(), self.core.reply_addr, "status", now)

    # ------------------------------------------------------------------ receiving
    def _receive(self, now: float) -> None:
        while True:
            try:
                data, src = self.sock.recvfrom(2048)
            except (BlockingIOError, InterruptedError):
                return
            except OSError as exc:            # e.g. WSAECONNRESET if the ioctl is unavailable
                log.debug("recvfrom: %s", exc)
                return
            if self.cfg.uplink_loss_pct and self._rng.random() * 100 < self.cfg.uplink_loss_pct:
                continue
            if data[:2] == protocol.CRSF_PASS_MAGIC:
                self._on_crsf_pass(data, src, now)
            else:
                self.core.on_datagram(data, src, now)

    def _on_crsf_pass(self, data: bytes, src: tuple[str, int], now: float) -> None:
        if not self.cfg.crsf_pass:
            log.debug("crsf_pass ignored (start with --crsf-pass to simulate Q7a)")
            return
        if self.core.reply_addr is None or src[0] != self.core.reply_addr[0]:
            log.debug("crsf_pass from %s ignored: not the current GCS", src[0])
            return
        try:
            frame = crsf.parse_frame(protocol.CrsfPass.unpack(data).frame)
        except (ProtocolError, crsf.CrsfError) as exc:
            log.debug("crsf_pass rejected: %s", exc)
            return
        log.info("crsf_pass -> module: %r", frame)
        self.core.crsf_tx += 1               # the frame goes out to the module in a free slot
        for reply in self.module.handle(frame):
            self._queue(protocol.CrsfFwd(reply).pack(), self.core.reply_addr, "crsf_fwd", now)
        self._vrx_follow()

    def _vrx_follow(self) -> None:
        """WP08b: without a following VRX, a sent VTX change loses the (simulated) decoder lock."""
        mod = self.module
        if self.cfg.vrx_follows or not isinstance(mod, ElrsModule) or mod.vtx_sent is None:
            return
        same = mod.vtx_sent[:2] == mod.vtx_initial[:2]
        self.core.decoder_lock_override = None if same else False

    # ------------------------------------------------------------------ loop
    def step(self, now: float | None = None) -> None:
        """One loop iteration (receive, advance, send). Thread-safe."""
        now = self.clock() if now is None else now
        with self.lock:
            self._receive(now)
            core = self.core
            core.tick(now)
            pending, core.pending_states = core.pending_states, []
            for state in pending:            # proposal: one extra status per state entered
                self._send_status(now, state)
            if now >= self._next_status:
                self._send_status(now)
                self._next_status = max(self._next_status + 1 / self.cfg.status_hz, now - 1)
            rc_flowing = core.state == BridgeState.RUN
            self.client.update(now, rc_flowing, core.last_rc.channels if core.last_rc else None)
            if isinstance(self.module, ElrsModule):
                self.module._finish_commands()
                self._vrx_follow()
            if self.cfg.telemetry_hz > 0 and now >= self._next_tlm:
                self._next_tlm = max(self._next_tlm + 1 / self.cfg.telemetry_hz, now - 1)
                if core.reply_addr is not None:
                    for frame in self.client.telemetry_frames():
                        self._queue(protocol.CrsfFwd(frame).pack(), core.reply_addr, "crsf_fwd", now)
            self._video(now)
            self._flush(now)
            self._last_loop = now

    def _video(self, now: float) -> None:
        if self.cfg.video_kbps <= 0:
            return
        dt = min(0.1, now - self._last_loop)
        self._video_credit += self.cfg.video_kbps * 1000 / 8 * dt
        while self._video_credit >= 1400:
            self._video_credit -= 1400
            self._video_seq = (self._video_seq + 1) & 0xFFFF
            ts = int(now * 90000) & 0xFFFFFFFF
            # Minimal RTP header (V=2, PT=96) + filler; NOT decodable H.264 — throughput tests only.
            hdr = bytes((0x80, 96)) + self._video_seq.to_bytes(2, "big") + ts.to_bytes(4, "big") + b"SIM0"
            try:
                self.sock.sendto(hdr + bytes(1400 - len(hdr)), self.cfg.video_dest)
            except OSError as exc:
                log.debug("video sendto failed: %s", exc)

    def _next_deadline(self, now: float) -> float:
        deadlines = [self._next_status, now + 0.005]
        if self._out:
            deadlines.append(self._out[0][0])
        if self.cfg.telemetry_hz > 0:
            deadlines.append(self._next_tlm)
        return max(0.0, min(deadlines) - now)

    def run(self) -> None:
        """Run until :meth:`stop` (or Ctrl-C)."""
        winmm = _high_res_timer(True)
        try:
            while not self._stop.is_set():
                now = self.clock()
                select.select([self.sock], [], [], self._next_deadline(now))
                try:
                    self.step()
                except Exception:            # a simulator bug must not kill the bridge model
                    log.exception("bridge_sim step failed; continuing")
        finally:
            _high_res_timer(False, winmm)

    def start(self) -> "BridgeSim":
        self._thread = threading.Thread(target=self.run, name="bridge_sim", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
        self.sock.close()

    def __enter__(self) -> "BridgeSim":
        return self.start()

    def __exit__(self, *exc: object) -> None:
        self.stop()


def _high_res_timer(enable: bool, handle: object = None) -> object:
    """Windows: timeBeginPeriod(1) so select() timeouts are ~1 ms instead of ~15.6 ms."""
    if sys.platform != "win32":
        return None
    try:
        import ctypes
        winmm = handle or ctypes.WinDLL("winmm")
        (winmm.timeBeginPeriod if enable else winmm.timeEndPeriod)(1)
        return winmm
    except (OSError, AttributeError):
        return None


# =========================================================================== CLI

def _parse_networks(text: str) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    if text.strip().lower() in ("", "any", "*"):
        return ()
    return tuple(ipaddress.ip_network(part.strip(), strict=False) for part in text.split(","))


def _hostport(text: str) -> tuple[str, int]:
    host, _, port = text.rpartition(":")
    return host or "127.0.0.1", int(port)


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Relay RC-bridge simulator (protocol v1 PROPOSAL)")
    g = p.add_argument_group("network")
    g.add_argument("--host", default="127.0.0.1", help="listen address (default 127.0.0.1)")
    g.add_argument("--port", type=int, default=protocol.BRIDGE_PORT, help="listen port (default 5770)")
    g.add_argument("--allow-src", default="127.0.0.0/8",
                   help="comma-separated CIDRs allowed to send rc_up, or 'any' (default 127.0.0.0/8)")
    g.add_argument("--status-hz", type=float, default=10.0)
    g.add_argument("--latency-ms", type=float, default=0.0, help="extra delay on bridge->GCS datagrams")
    g.add_argument("--jitter-ms", type=float, default=0.0, help="+/- uniform jitter on that delay")
    g.add_argument("--loss-pct", type=float, default=0.0, help="bridge->GCS datagram loss")
    g.add_argument("--uplink-loss-pct", type=float, default=0.0, help="GCS->bridge datagram loss")
    b = p.add_argument_group("bridge")
    b.add_argument("--t-hold-ms", type=float, default=250.0)
    b.add_argument("--start-packets", type=int, default=5)
    b.add_argument("--model-id", type=int, default=0)
    b.add_argument("--camera-policy", choices=CAMERA_POLICIES, default="design")
    b.add_argument("--cam-fault", choices=CAM_FAULTS, default="none",
                   help="simulate a switch read-back fault")
    b.add_argument("--elrs-rate-hz", type=float, default=250.0)
    b.add_argument("--boot-ms", type=float, default=200.0)
    b.add_argument("--fw-ver", default="0.1", help="major.minor (default 0.1)")
    b.add_argument("--p2-down", action="store_true", help="report p2_link_100fd = 0")
    b.add_argument("--report-video", choices=("PAL", "NTSC"), help="set status bits 3/4 (future)")
    b.add_argument("--crsf-pass", action="store_true", help="accept crsf_pass (Q7a) with a fake module")
    b.add_argument("--module", choices=("basic", "elrs"), default="basic",
                   help="fake module parameter tree for --crsf-pass (elrs: larger tree with VTX Administrator)")
    b.add_argument("--no-vrx-follow", action="store_true",
                   help="a sent VTX change drops the reported decoder lock (needs --report-video)")
    c = p.add_argument_group("client")
    c.add_argument("--telemetry-hz", type=float, default=10.0, help="crsf_fwd bursts per second (0=off)")
    c.add_argument("--client-lat", type=float, default=ClientConfig.lat)
    c.add_argument("--client-lon", type=float, default=ClientConfig.lon)
    c.add_argument("--client-radius-m", type=float, default=ClientConfig.radius_m)
    c.add_argument("--gps-fix-delay-s", type=float, default=ClientConfig.gps_fix_delay_s)
    c.add_argument("--fs-delay-s", type=float, default=ClientConfig.fs_delay_s)
    c.add_argument("--rth-delay-s", type=float, default=ClientConfig.rth_delay_s)
    v = p.add_argument_group("video")
    v.add_argument("--video-kbps", type=float, default=0.0, help="fake RTP stream bitrate (0=off)")
    v.add_argument("--video-dest", type=_hostport, default=("127.0.0.1", protocol.VIDEO_PORT))
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("-v", "--verbose", action="store_true",
                   help="debug logging (every rejected packet, crsf_pass detail); default shows "
                        "state changes, ModelID and camera changes")
    return p


def config_from_args(args: argparse.Namespace) -> SimConfig:
    major, _, minor = args.fw_ver.partition(".")
    bridge = BridgeConfig(
        t_hold_s=args.t_hold_ms / 1000, start_packets=args.start_packets, model_id=args.model_id,
        camera_policy=args.camera_policy, allowed_src=_parse_networks(args.allow_src),
        elrs_rate_hz=args.elrs_rate_hz, boot_s=args.boot_ms / 1000,
        fw_ver=protocol.fw_ver_encode(int(major), int(minor or 0)), cam_fault=args.cam_fault,
        p2_link_100fd=not args.p2_down, report_video=args.report_video, seed=args.seed)
    client = ClientConfig(lat=args.client_lat, lon=args.client_lon, radius_m=args.client_radius_m,
                          gps_fix_delay_s=args.gps_fix_delay_s, fs_delay_s=args.fs_delay_s,
                          rth_delay_s=args.rth_delay_s, seed=args.seed)
    return SimConfig(host=args.host, port=args.port, status_hz=args.status_hz,
                     telemetry_hz=args.telemetry_hz, latency_ms=args.latency_ms, jitter_ms=args.jitter_ms,
                     loss_pct=args.loss_pct, uplink_loss_pct=args.uplink_loss_pct,
                     video_kbps=args.video_kbps, video_dest=args.video_dest, crsf_pass=args.crsf_pass,
                     module=args.module, vrx_follows=not args.no_vrx_follow,
                     bridge=bridge, client=client, seed=args.seed)


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    for stream in (sys.stdout, sys.stderr):   # never crash on a console that cannot show a character
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="backslashreplace")
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s.%(msecs)03d %(levelname)-7s %(message)s", datefmt="%H:%M:%S")
    sim = BridgeSim(config_from_args(args))
    log.info("bridge_sim listening on %s:%d (camera policy %s, T_hold %.0f ms) - PROTOCOL v1 PROPOSAL",
             *sim.address, args.camera_policy, args.t_hold_ms)
    try:
        sim.run()
    except KeyboardInterrupt:
        pass
    finally:
        sim.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
