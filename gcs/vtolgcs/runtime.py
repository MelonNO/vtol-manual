"""The headless GCS runtime: wires controller, sender, receiver, telemetry, alarms,
read-only MAVLink input, the local API (C2) and the session log together.

Threads (all daemon, none of them tied to a UI):

========== ===================================================================
rc-sender  :class:`vtolgcs.sender.Sender` — rc_up on absolute deadlines
bridge-rx  :class:`vtolgcs.receiver.Receiver` — status / crsf_fwd (same socket)
controller :class:`vtolgcs.controller.PygameController` (or a fake)
monitor    alarms at 20 Hz, power status every 5 s, 5 Hz status log samples
mavlink-ro :class:`vtolgcs.mavlink_ro.MavlinkReadOnly` (never sends)
api        :class:`vtolgcs.api.ApiServer` (read-only)
========== ===================================================================

UIs (WP08b) call :meth:`Runtime.request_mode`, :meth:`Runtime.set_camera` and
:meth:`Runtime.status`, and may register :meth:`Runtime.add_listener` for events.
"""

from __future__ import annotations

import logging
import socket
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from . import __version__, config as config_mod, timing_win
from .alarms import AlarmEngine, RttRiseDetector, RuleInputs, alarm_defs, evaluate_rules, iso_utc
from .api import ApiServer, EventHub
from .config import Config
from .controller import Controller, PygameController
from .mavlink_ro import CarrierPosition, MavlinkReadOnly
from .protocol import BridgeState, Status, fw_ver_str
from .receiver import BridgeLink, Receiver
from .sender import Mode, ModeResult, ResumePreview, Sender, SenderStats, arm_switch_safe, gcs_time_us, throttle_low
from .session_log import SCHEMA, SessionLog
from .telemetry import ClientTelemetry, describe

log = logging.getLogger("vtolgcs.runtime")

MONITOR_HZ = 20.0
SAMPLE_PERIOD_S = 0.2          # brief R11: status samples at 5 Hz
POWER_PERIOD_S = 5.0
#: The RC thread must get the GIL back quickly when its timer fires; CPython's default
#: switch interval (5 ms) would let any busy thread delay a packet by a whole period.
GIL_SWITCH_INTERVAL_S = 0.0005


@dataclass(frozen=True)
class CameraResult:
    ok: bool
    requested: bool
    reasons: tuple[str, ...] = ()


def _r4(v: float | None) -> float | None:
    return None if v is None else round(v, 4)


def _disable_udp_connreset(sock: socket.socket) -> None:
    """Windows: ICMP 'port unreachable' must not turn into recv errors on the shared socket."""
    ioctl = getattr(socket, "SIO_UDP_CONNRESET", None)
    if ioctl is not None and hasattr(sock, "ioctl"):
        try:
            sock.ioctl(ioctl, False)
        except OSError:
            pass


class Runtime:
    """Owns every runtime component. ``start()`` / ``stop()``; thread-safe accessors."""

    def __init__(self, cfg: Config, controller: Controller | None = None, *,
                 clock: Callable[[], float] = time.perf_counter,
                 us_clock: Callable[[], int] = gcs_time_us,
                 instance_name: str | None = "vtol-gcs-sender",
                 log_dir: Path | None = None,
                 mavlink_socket_factory: Callable[..., socket.socket] = socket.socket,
                 power_status: Callable[[], timing_win.PowerStatus] = timing_win.power_status) -> None:
        self.cfg = cfg
        self.controller = controller if controller is not None else PygameController(cfg.controller)
        self._clock = clock
        self._us_clock = us_clock
        self._instance = timing_win.SingleInstance(instance_name) if instance_name else None
        self._log_dir = log_dir
        self._mav_factory = mavlink_socket_factory
        self._power_fn = power_status
        self.bridge_addr = (cfg.bridge.ip, cfg.bridge.port)

        self.telemetry = ClientTelemetry(cfg.client, clock)
        self.link = BridgeLink(clock, us_clock)
        self.carrier = CarrierPosition(cfg.mavlink, clock)
        self.alarms = AlarmEngine(alarm_defs(cfg.alarms), clock)
        self.hub = EventHub()
        self.rtt_rise = RttRiseDetector(cfg.alarms.rtt_rise_window_s, cfg.alarms.rtt_rise_ms)
        self._listeners: list[Callable[[str, dict], None]] = []
        self.alarms.add_listener(self._on_alarm)

        self.sock: socket.socket | None = None
        self.sender: Sender | None = None
        self.receiver: Receiver | None = None
        self.mavlink: MavlinkReadOnly | None = None
        self.api: ApiServer | None = None
        self.session: SessionLog | None = None
        self.api_error: str | None = None

        self._stream_started_t: float | None = None
        self._fpv_started_t: float | None = None
        self._power = timing_win.PowerStatus(None, None, None)
        self._last_rtt_t: float | None = None
        self._last_cam_reported: bool | None = None
        self._stop = threading.Event()
        self._monitor: threading.Thread | None = None
        self._started = False

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> "Runtime":
        if self._started:
            return self
        if self._instance is not None:
            self._instance.acquire()          # raises AlreadyRunning: two senders must never fight
        try:
            self._start_components()
        except BaseException:
            self.stop()
            raise
        self._started = True
        return self

    def _start_components(self) -> None:
        cfg = self.cfg
        if cfg.log.enabled:
            self.session = SessionLog(self._log_dir or config_mod.log_dir(cfg), self._clock)
            self.session.write("session_start", schema=SCHEMA, version=__version__,
                               config=config_mod.to_dict(cfg))
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        _disable_udp_connreset(sock)
        sock.bind(("0.0.0.0", cfg.bridge.local_port))
        self.sock = sock
        bridge = self.bridge_addr

        def transmit(data: bytes) -> None:
            sock.sendto(data, bridge)

        sys.setswitchinterval(min(sys.getswitchinterval(), GIL_SWITCH_INTERVAL_S))
        self.sender = Sender(cfg, self.controller, transmit, clock=self._clock, us_clock=self._us_clock,
                             on_packet=self.link.note_sent, on_event=self._on_sender_event,
                             on_stats=self._on_stats)
        self.receiver = Receiver(cfg, sock, self.link, self.telemetry, clock=self._clock,
                                 on_state_change=self._on_bridge_state, on_telemetry=self._on_telemetry)
        self.controller.start()
        self.receiver.start()
        self.sender.start()
        if cfg.mavlink.enabled:
            self.mavlink = MavlinkReadOnly(cfg.mavlink, self.carrier, self._mav_factory).start()
        if cfg.api.enabled:
            try:
                self.api = ApiServer(self.status, self.hub, __version__, port=cfg.api.port).start()
            except OSError as exc:            # the API is optional; the RC path must still run
                self.api_error = f"local API not started on 127.0.0.1:{cfg.api.port}: {exc}"
                log.error("%s", self.api_error)
                self._emit("error", {"text": self.api_error})
        if cfg.alarms.rtt_max_ms is None:
            log.warning("alarms.rtt_max_ms is null (TBD): the RC RTT HIGH alarm is inactive")
        self._monitor = threading.Thread(target=self._monitor_loop, name="monitor", daemon=True)
        self._monitor.start()
        log.info("runtime started: bridge %s:%d, local UDP port %d, %.0f Hz", *bridge,
                 sock.getsockname()[1], cfg.sender.rate_hz)

    def stop(self) -> None:
        """Stop everything. The sender stops first, so the bridge reaches FAILSAFE after T_hold."""
        if self.sender is not None:
            self.sender.stop()
        self._stop.set()
        if self._monitor is not None:
            self._monitor.join(timeout=2)
            self._monitor = None
        for part in (self.receiver, self.mavlink, self.api):
            if part is not None:
                try:
                    part.stop()
                except Exception:  # pragma: no cover - shutdown best effort
                    log.exception("stopping %s failed", type(part).__name__)
        try:
            self.controller.stop()
        except Exception:  # pragma: no cover
            log.exception("stopping the controller failed")
        if self.sock is not None:
            self.sock.close()
            self.sock = None
        if self.session is not None:
            st = self.sender.state() if self.sender else None
            self.session.close(packets_sent=st.packets_sent if st else 0,
                               rx=dict(self.receiver.counters) if self.receiver else {})
            self.session = None
        if self._instance is not None:
            self._instance.release()
        self._started = False

    def __enter__(self) -> "Runtime":
        return self.start()

    def __exit__(self, *exc: object) -> None:
        self.stop()

    @property
    def local_address(self) -> tuple[str, int] | None:
        return self.sock.getsockname()[:2] if self.sock else None

    # ------------------------------------------------------------------ events
    def add_listener(self, fn: Callable[[str, dict], None]) -> None:
        """``fn(kind, data)`` for mode / suspended / interlock_refused / resume_preview / camera / alarm /
        bridge_state / error."""
        self._listeners.append(fn)

    def _emit(self, kind: str, data: dict) -> None:
        for fn in list(self._listeners):
            try:
                fn(kind, data)
            except Exception:
                log.exception("runtime listener failed")

    def _log(self, rtype: str, **fields: Any) -> None:
        if self.session is not None:
            self.session.write(rtype, **fields)

    def _on_sender_event(self, kind: str, data: dict) -> None:
        if kind == "mode":
            now = self._clock()
            mode = Mode(data["mode"])
            self._stream_started_t = now if mode is not Mode.IDLE else None
            if mode is Mode.FPV and not data.get("resumed"):
                self._fpv_started_t = now
            elif mode is not Mode.FPV:
                self._fpv_started_t = None
        self._log(kind, **data)
        self._emit(kind, data)

    def _on_stats(self, stats: SenderStats) -> None:
        st = self.sender.state() if self.sender else None
        if st is not None and (st.streaming or stats.sent):
            self._log("sender", sent=stats.sent, rate_hz=round(stats.rate_hz, 2), send_errors=stats.send_errors,
                      skipped_slots=stats.skipped_slots, jitter_p50_ms=_r4(stats.p50_ms),
                      jitter_p99_ms=_r4(stats.p99_ms), jitter_max_ms=_r4(stats.max_ms), waiter=st.waiter)

    def _on_bridge_state(self, old: BridgeState | None, new: BridgeState, st: Status) -> None:
        data = {"from": old.name if old is not None else None, "to": new.name, "fw_version": fw_ver_str(st.fw_ver),
                "rx_ok": st.rx_ok, "rx_bad_crc": st.rx_bad_crc, "rx_bad_seq": st.rx_bad_seq}
        self._log("bridge_state", **data)
        self._emit("bridge_state", data)

    def _on_telemetry(self, obj: Any) -> None:
        rec = describe(obj)
        if rec is not None:
            self._log("telemetry", **rec)

    def _on_alarm(self, event: dict) -> None:
        self._log("alarm", **event)
        self.hub.publish(event)
        self._emit("alarm", event)

    # ------------------------------------------------------------------ commands
    def _client_armed_from_telemetry(self, now: float) -> bool | None:
        tv = self.telemetry.view(now)
        fresh = tv.age_s is not None and tv.age_s <= self.cfg.alarms.telemetry_stale_s
        return tv.armed if fresh else None

    def request_mode(self, mode: Mode | str) -> ModeResult:
        """Normal start / mode change (start interlock in :class:`vtolgcs.sender.Sender`)."""
        assert self.sender is not None, "runtime not started"
        mode = Mode(mode)
        before = self.sender.state()
        result = self.sender.request_mode(mode, client_armed=self._client_armed_from_telemetry(self._clock()))
        if result.ok and mode is not before.mode:
            cam = self.cfg.camera
            if mode is Mode.CARRIER_ONLY and cam.on_in_carrier_only:
                self._apply_camera(True, "carrier-only mode")
            elif mode is Mode.FPV and cam.refuse_on_while_armed and before.camera_requested:
                self._apply_camera(False, "entering FPV: camera off while the client may arm (plan Q13)")
        return result

    def prepare_resume(self) -> ResumePreview:
        """RESUME (client airborne), step 1: live arm/throttle values to show the pilot. Sends nothing."""
        assert self.sender is not None, "runtime not started"
        return self.sender.prepare_resume()

    def confirm_resume(self, token: int, *, throttle_min_confirmed: bool = False) -> ModeResult:
        """RESUME (client airborne), step 2: the pilot confirmed the preview ``token``."""
        assert self.sender is not None, "runtime not started"
        result = self.sender.confirm_resume(token, throttle_min_confirmed=throttle_min_confirmed)
        if result.ok and self.cfg.camera.refuse_on_while_armed and self.sender.state().camera_requested:
            self._apply_camera(False, "RESUME: the client is armed (plan Q13)")
        return result

    def client_may_be_armed(self) -> list[str]:
        """Reasons to think the client is (or may be) armed; empty = no sign of it."""
        assert self.sender is not None, "runtime not started"
        now = self._clock()
        reasons = []
        if self._client_armed_from_telemetry(now):
            reasons.append("client telemetry reports ARMED")
        st = self.sender.state()
        if st.mode is Mode.FPV:
            if st.suspended:
                reasons.append("FPV stream stopped: client state unknown (may be in failsafe)")
            else:
                snap = self.controller.snapshot()
                if snap.connected and not arm_switch_safe(snap, self.cfg.interlock):
                    reasons.append("arm switch is outside the safe (disarmed) range")
        return reasons

    def set_camera(self, on: bool) -> CameraResult:
        """Request the carrier camera ON/OFF (``CAM_ENABLE``). ON is refused while the client may be armed
        if ``camera.refuse_on_while_armed`` is set (plan §7.5, Q13)."""
        assert self.sender is not None, "runtime not started"
        if on and self.cfg.camera.refuse_on_while_armed:
            reasons = self.client_may_be_armed()
            if reasons:
                data = {"requested": True, "reasons": reasons}
                self._log("camera_refused", **data)
                self._emit("camera_refused", data)
                return CameraResult(False, self.sender.state().camera_requested, tuple(reasons))
        self._apply_camera(on, "operator")
        return CameraResult(True, on)

    def _apply_camera(self, on: bool, why: str) -> None:
        assert self.sender is not None
        if self.sender.state().camera_requested != on:
            log.info("camera requested %s (%s)", "ON" if on else "OFF", why)
            self._log("camera_reason", requested=on, reason=why)
        self.sender.set_camera_requested(on)

    # ------------------------------------------------------------------ monitor
    def _monitor_loop(self) -> None:
        period = 1.0 / MONITOR_HZ
        next_sample = next_power = 0.0
        while not self._stop.is_set():
            now = self._clock()
            try:
                if now >= next_power:
                    next_power = now + POWER_PERIOD_S
                    self._power = self._power_fn()
                self.alarms.update(evaluate_rules(self.rule_inputs(now), self.cfg.alarms), now)
                if now >= next_sample:
                    next_sample = now + SAMPLE_PERIOD_S
                    if self.session is not None:
                        self.session.write("status", status=self.status())
            except Exception:                  # alarms must keep running
                log.exception("monitor iteration failed")
            self._stop.wait(period)

    def rule_inputs(self, now: float) -> RuleInputs:
        assert self.sender is not None
        cfg = self.cfg
        st = self.sender.state()
        snap = self.controller.snapshot()
        connected = snap.connected and now - snap.t <= cfg.controller.stale_ms / 1000
        bv = self.link.view(now, streaming=st.streaming)
        fresh = bv.status_age_s is not None and bv.status_age_s * 1000 <= cfg.alarms.status_timeout_ms
        bridge_state = bv.last_status.state.name if bv.last_status is not None and fresh else None
        silence = None
        if st.streaming and self._stream_started_t is not None:
            ref = self._stream_started_t
            if bv.status_t is not None:
                ref = max(ref, bv.status_t)
            silence = now - ref
        cam_reported = bv.last_status.camera_on_readback if bv.last_status is not None and fresh else None
        if cam_reported != self._last_cam_reported:
            if cam_reported is not None:
                self._log("camera_readback", reported=cam_reported)
            self._last_cam_reported = cam_reported
        if bv.rtt_t is not None and bv.rtt_t != self._last_rtt_t and bv.rtt_sample_ms is not None:
            self._last_rtt_t = bv.rtt_t
            self.rtt_rise.add_sample(bv.rtt_t, bv.rtt_sample_ms)
        rtt_rising = self.rtt_rise.evaluate(now, cam_reported)
        tv = self.telemetry.view(now)
        fpv = st.mode is Mode.FPV
        tl_silence = None
        if fpv and self._fpv_started_t is not None:
            ref = self._fpv_started_t
            if tv.age_s is not None:
                ref = max(ref, now - tv.age_s)
            tl_silence = now - ref
        relevant = fpv or (tv.age_s is not None and tv.age_s <= cfg.alarms.telemetry_stale_s)
        stats = st.stats
        return RuleInputs(
            mode=st.mode.value, streaming=st.streaming, suspended=st.suspended is not None,
            controller_connected=connected, status_silence_s=silence, bridge_state=bridge_state,
            rtt_ms=bv.rtt_ms, jitter_p99_ms=stats.p99_ms if stats and st.streaming else None,
            camera_requested=st.camera_requested, camera_reported=cam_reported,
            telemetry_silence_s=tl_silence, telemetry_relevant=relevant,
            lq_pct=tv.lq_pct, cell_v=tv.cell_v, sats=tv.sats, client_failsafe=tv.failsafe,
            client_rth=tv.rth, client_rescue_not_ready=tv.rescue_not_ready, rtt_rising=rtt_rising,
            on_battery=self._power.on_battery, battery_saver=self._power.battery_saver)

    # ------------------------------------------------------------------ C2 status
    def status(self) -> dict[str, Any]:
        """The C2 Status object (``GET /api/v1/status``). Keys exactly as in contract C2."""
        assert self.sender is not None, "runtime not started"
        cfg = self.cfg
        now = self._clock()
        st = self.sender.state()
        snap = self.controller.snapshot()
        connected = snap.connected and now - snap.t <= cfg.controller.stale_ms / 1000
        bv = self.link.view(now, streaming=st.streaming)
        s = bv.last_status
        fresh = bv.status_age_s is not None and bv.status_age_s * 1000 <= cfg.alarms.status_timeout_ms
        video_bits = (s is not None and fresh and cfg.video.status_bits_min_fw_ver is not None
                      and s.fw_ver >= cfg.video.status_bits_min_fw_ver)
        return {
            "time_utc": iso_utc(datetime.now(timezone.utc)),
            "app": {"version": __version__, "mode": st.mode.value, "streaming": st.streaming,
                    "start_path": st.start_path},                # additive to C2 (PM amendment to R4)
            "controller": {
                "connected": connected,
                "name": snap.name if connected else None,
                "arm_switch_safe": arm_switch_safe(snap, cfg.interlock) if connected else None,
                "throttle_low": throttle_low(snap, cfg.interlock) if connected else None,
            },
            "bridge": {
                "state": s.state.name if s is not None and fresh else "UNREACHABLE",
                "rtt_ms": None if bv.rtt_ms is None else round(bv.rtt_ms, 2),
                "uplink_loss_pct": None if bv.uplink_loss_pct is None else round(bv.uplink_loss_pct, 2),
                "send_jitter_ms_p99": (round(st.stats.p99_ms, 3) if st.streaming and st.stats
                                       and st.stats.p99_ms is not None else None),
                "status_age_ms": None if bv.status_age_s is None else round(bv.status_age_s * 1000),
                "timing_locked": s.timing_locked if s is not None and fresh else None,
                "sync_offset_us": s.sync_offset_x10us / 10 if s is not None and fresh else None,
                "fw_version": fw_ver_str(s.fw_ver) if s is not None else None,
                "camera": {"requested": st.camera_requested,
                           "reported": s.camera_on_readback if s is not None and fresh else None},
            },
            "video": {
                "standard": ("NTSC" if s.std_ntsc else "PAL") if video_bits and s.decoder_lock else None,
                "decoder_lock": s.decoder_lock if video_bits else None,
                "rx_kbps": None,                # WP08b video fan-out fills this
            },
            "client": self.telemetry.to_c2(now),
            "carrier": self.carrier.to_c2(now),
            "alarms": self.alarms.active(),
        }
