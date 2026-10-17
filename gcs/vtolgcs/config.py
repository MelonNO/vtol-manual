"""GCS runtime configuration: ``%APPDATA%\\vtol-gcs\\config.json``.

The file is created with :func:`default_config` on first run.  On load every
key is type-checked and range-checked; unknown keys are errors (they are
usually typos).  Keys missing from an older file are filled from the
defaults.  Keys starting with ``_`` are comments and are ignored.

Where the defaults come from (never invented; see ``gcs/README.md``):

* bridge IP ``192.168.144.21`` — plan §3.3 proposal, **open question Q3**
  (confirm at bring-up); port 5770 — relay design.
* rate 200-250 Hz, default 250, T_hold 250 ms, 5 start packets — relay design.
* arm channel CH5 (ELRS takes the arm state from CH5, protocol README §4);
  safe range 988-1699 us and throttle CH3 low <= 1050 us — reference client
  ``docs/FPV_betaflight_dump.txt`` (``aux 0 0 0 1700 2100``, ``map AETR1234``,
  ``min_check = 1050``).
* alarm thresholds — plan §7.5 / §14.2; client cell voltage — the dump's
  ``vbat_warning_cell_voltage = 350``; min sats 8 — dump ``gps_rescue_min_sats``.
* RTT limits are ``null`` (TBD): the HM30 uplink latency is unmeasured.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import os
import types
import typing
from dataclasses import asdict, dataclass, field, fields, is_dataclass
from pathlib import Path
from typing import Any

from . import protocol

SCHEMA_VERSION = 1
APP_DIR_NAME = "vtol-gcs"

#: Mapping sources for one output channel.
CHANNEL_SOURCES = ("axis", "button", "none")


class ConfigError(ValueError):
    """The configuration file is invalid. ``errors`` lists every problem (dotted path: message)."""

    def __init__(self, errors: list[str], path: Path | None = None) -> None:
        self.errors = errors
        self.path = path
        where = f" in {path}" if path else ""
        super().__init__(f"invalid configuration{where}:\n  " + "\n  ".join(errors))


# --------------------------------------------------------------------------- schema

@dataclass
class BridgeConfig:
    #: Proposed address (plan §3.3, open question Q3) — confirm before flight.
    ip: str = "192.168.144.21"
    port: int = protocol.BRIDGE_PORT
    #: Local UDP port the sender/receiver socket binds to; 0 = any free port.
    local_port: int = 0


@dataclass
class SenderConfig:
    rate_hz: float = 250.0
    #: Bridge T_hold the app expects (relay design: start at 250 ms). Compared with the observed
    #: stop -> FAILSAFE time (``failsafe_timing`` log record, console line).
    t_hold_ms: float = 250.0
    #: Consecutive valid packets the bridge needs to leave WAIT_GCS (relay design: 5). Compared
    #: with the packets sent before START was reported (``start_timing`` log record).
    start_packets: int = 5


@dataclass
class ChannelSource:
    """Where one output channel comes from."""

    src: str = "none"          # 'axis' | 'button' | 'none' (none = centred, 1500 us)
    index: int = 0
    reverse: bool = False
    #: Raw axis values that map to 988 us and 2012 us (calibration; default full travel).
    min: float = -1.0
    max: float = 1.0


def edgetx_classic_map() -> list[ChannelSource]:
    """EdgeTX USB joystick *Classic* mode: CH1-8 -> axes 0-7, CH9-16 -> buttons 0-7 (plan §7.3)."""
    return ([ChannelSource("axis", i) for i in range(8)]
            + [ChannelSource("button", i) for i in range(8)])


@dataclass
class ControllerConfig:
    #: Substrings (case-insensitive) that make a joystick preferred, in priority order.
    prefer_names: list[str] = field(default_factory=lambda: ["RadioMaster", "EdgeTX", "Joystick"])
    #: Exact device name to use; null = pick by ``prefer_names``.
    device_name: str | None = None
    poll_hz: float = 500.0
    #: Controller data older than this counts as a disconnect (brief: detect within <= 100 ms).
    stale_ms: float = 100.0
    channel_map: list[ChannelSource] = field(default_factory=edgetx_classic_map)


@dataclass
class InterlockConfig:
    arm_channel: int = 5
    arm_safe_min_us: int = 988
    arm_safe_max_us: int = 1699
    throttle_channel: int = 3
    throttle_low_max_us: int = 1050


@dataclass
class CameraConfig:
    #: Requested camera state at start-up (plan §7.1: default off).
    default_on: bool = False
    #: Refuse CAM_ENABLE while the client is (or may be) armed (plan §7.5, Q13: camera off while armed).
    refuse_on_while_armed: bool = True
    #: Request the camera ON when entering carrier-only mode (plan §3.4-3 interim mode).
    on_in_carrier_only: bool = True


@dataclass
class AlarmConfig:
    status_timeout_ms: float = 300.0       # plan §7.5: no status for > 300 ms
    rtt_max_ms: float | None = None        # TBD - HM30 uplink unmeasured (relay design "UDP echo" test)
    lq_min_pct: float = 70.0               # plan §7.5 / §14.2
    cell_min_v: float = 3.50               # reference client vbat_warning_cell_voltage = 350
    min_sats: int = 8                      # reference client gps_rescue_min_sats = 8
    telemetry_stale_s: float = 2.0         # plan §14.2
    #: plan §7.5 "send jitter > 2 ms": any packet sent more than this after its deadline,
    #: or any skipped slot, raises SEND JITTER HIGH
    send_late_max_ms: float = 2.0
    #: ... but only when at least this many packets of one 1 s window were that late (app default,
    #: WP08a verification m2: one late packet only adds latency).  Skipped slots always raise it.
    send_late_count: int = 3
    camera_mismatch_s: float = 1.0         # plan §7.1: requested != reported for > 1 s
    #: RTT rise after camera ON: null = "median after ON exceeds the p99 before ON";
    #: a number = "median after ON exceeds the median before ON by this many ms". TBD after test 9.
    rtt_rise_ms: float | None = None
    rtt_rise_window_s: float = 5.0         # app default: compare windows of this length


@dataclass
class ClientConfig:
    #: Client profile id (contract C1.3) shown in C2 ``client.profile_id``.
    profile_id: str | None = None
    #: Cell count used for the per-cell battery alarm (default client pack: 6S).
    cells: int = 6
    #: True when Betaflight ``report_cell_voltage`` is ON (telemetry already sends per-cell volts).
    report_cell_voltage: bool = False


@dataclass
class MavlinkConfig:
    """Read-only Mission Planner "MAVLink Mirror" input (S-02b: the app never sends MAVLink)."""

    enabled: bool = True
    listen_ip: str = "127.0.0.1"
    listen_port: int = 14551
    #: Carrier system id; null = the first ArduPilot autopilot heartbeat seen.
    carrier_sysid: int | None = None
    #: Position older than this is reported as unknown (app default).
    stale_s: float = 5.0


@dataclass
class ApiConfig:
    enabled: bool = True
    port: int = 47800


@dataclass
class LogConfig:
    enabled: bool = True
    #: Log folder; null = ``%APPDATA%\\vtol-gcs\\logs``.
    dir: str | None = None
    #: Output files of the senders the UI starts (``sender-*.log``, WP16 R5): the UI keeps the newest
    #: ``sender_output_keep`` files and also deletes the oldest while all of them together exceed
    #: ``sender_output_max_mb`` (app defaults).  The current file is never deleted.
    sender_output_keep: int = 20
    sender_output_max_mb: float = 100.0


@dataclass
class VideoConfig:
    #: Status bits 3/4 (decoder lock, NTSC) are trusted only from this ``fw_ver`` on.
    #: null = TBD (future firmware request, protocol README §3.2): treat as unknown.
    status_bits_min_fw_ver: int | None = None
    #: Client video RTP from the N6 (C3) and the local fan-out targets (C3: viewer 5601, MP HUD 5602).
    listen_port: int = protocol.VIDEO_PORT
    fanout_ports: list[int] = field(default_factory=lambda: [5601, 5602])
    #: ``gst-launch-1.0`` executable; null = search PATH and the usual GStreamer install folders.
    gst_launch_path: str | None = None
    #: H.264 decoder in the generated pipelines (plan §7.4: compare ``avdec_h264`` with ``d3d11h264dec``).
    decoder: str = "avdec_h264"


@dataclass
class MpOutputConfig:
    """Client telemetry -> MAVLink for a second Mission Planner link (plan §14.4, S-02b)."""

    enabled: bool = True
    #: Loopback only: the stream is for Mission Planner on this laptop, never for the HM30 network.
    host: str = "127.0.0.1"
    port: int = 14560
    #: Never 1 (the carrier) or 255 (Mission Planner, the primary GCS) - plan S-02b.
    sysid: int = 2
    compid: int = 1
    #: 'vehicle' (HEARTBEAT, GLOBAL_POSITION_INT, ...) or 'adsb' (ADSB_VEHICLE traffic icon, brief R4).
    mode: str = "vehicle"
    #: ADSB_VEHICLE ICAO address; null = the sysid.  Display only.
    adsb_icao: int | None = None
    #: Callsign shown in Mission Planner (ADSB); null = "FPV<sysid>".
    callsign: str | None = None


@dataclass
class CrsfMenuConfig:
    """ELRS parameter menu through ``crsf_pass`` (plan §7.7, future firmware feature Q7a)."""

    #: Reply timeout per request and the number of retries (app defaults).
    timeout_ms: float = 500.0
    retries: int = 3
    #: Parameter writes are refused while the client is or may be armed (app default: a bind or a
    #: packet-rate change drops the link).  Set true only if you accept that risk.
    allow_write_while_armed: bool = False
    #: VRX follow: offer to revert a VTX change when there is no decoder lock within this time (app default).
    vrx_lock_timeout_s: float = 10.0


@dataclass
class UiConfig:
    """Windowed UI (a separate process, brief R0/R1)."""

    #: Profiles JSON exported from the Tools page (remembered).
    profiles_file: str | None = None
    camera_hotkey: str = "F9"
    #: Register the camera hotkey system-wide, so it works while the video viewer has the focus.
    global_hotkey: bool = True
    status_bar: bool = True
    sound: bool = True


@dataclass
class Config:
    schema_version: int = SCHEMA_VERSION
    bridge: BridgeConfig = field(default_factory=BridgeConfig)
    sender: SenderConfig = field(default_factory=SenderConfig)
    controller: ControllerConfig = field(default_factory=ControllerConfig)
    interlock: InterlockConfig = field(default_factory=InterlockConfig)
    camera: CameraConfig = field(default_factory=CameraConfig)
    alarms: AlarmConfig = field(default_factory=AlarmConfig)
    client: ClientConfig = field(default_factory=ClientConfig)
    mavlink: MavlinkConfig = field(default_factory=MavlinkConfig)
    api: ApiConfig = field(default_factory=ApiConfig)
    log: LogConfig = field(default_factory=LogConfig)
    video: VideoConfig = field(default_factory=VideoConfig)
    mp_output: MpOutputConfig = field(default_factory=MpOutputConfig)
    crsf_menu: CrsfMenuConfig = field(default_factory=CrsfMenuConfig)
    ui: UiConfig = field(default_factory=UiConfig)


_COMMENTS = {
    "bridge": {"_note": "ip is the plan §3.3 PROPOSAL (open question Q3) - confirm at bring-up"},
    "alarms": {"_note": "rtt_max_ms / rtt_rise_ms null = TBD until the HM30 RTT is measured"},
}


def default_config() -> Config:
    return Config()


def to_dict(cfg: Config) -> dict[str, Any]:
    """Plain JSON-able dict (with the explanatory ``_note`` comments)."""
    data = asdict(cfg)
    for section, notes in _COMMENTS.items():
        data[section] = {**notes, **data[section]}
    return data


# --------------------------------------------------------------------------- paths

def app_dir() -> Path:
    """``%APPDATA%\\vtol-gcs`` (falls back to ``~/AppData/Roaming/vtol-gcs``)."""
    base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return Path(base) / APP_DIR_NAME


def default_config_path() -> Path:
    return app_dir() / "config.json"


def log_dir(cfg: Config) -> Path:
    return Path(cfg.log.dir) if cfg.log.dir else app_dir() / "logs"


# --------------------------------------------------------------------------- conversion

def _type_name(tp: Any) -> str:
    return getattr(tp, "__name__", str(tp))


def _convert(value: Any, tp: Any, path: str, errors: list[str]) -> Any:
    """Check ``value`` against the type hint ``tp``; returns the converted value (or None on error)."""
    origin = typing.get_origin(tp)
    if origin in (typing.Union, types.UnionType):
        args = typing.get_args(tp)
        if value is None and type(None) in args:
            return None
        (inner,) = [a for a in args if a is not type(None)]
        return _convert(value, inner, path, errors)
    if is_dataclass(tp):
        if not isinstance(value, dict):
            errors.append(f"{path}: must be an object")
            return None
        return _from_dict(tp, value, path, errors)
    if origin is list:
        (inner,) = typing.get_args(tp)
        if not isinstance(value, list):
            errors.append(f"{path}: must be a list")
            return None
        return [_convert(v, inner, f"{path}[{i}]", errors) for i, v in enumerate(value)]
    if tp is bool:
        if not isinstance(value, bool):
            errors.append(f"{path}: must be true or false")
        return value
    if tp is int:
        if not isinstance(value, int) or isinstance(value, bool):
            errors.append(f"{path}: must be an integer")
        return value
    if tp is float:
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            errors.append(f"{path}: must be a number")
            return value
        return float(value)
    if tp is str:
        if not isinstance(value, str):
            errors.append(f"{path}: must be a string")
        return value
    raise TypeError(f"unsupported config type {_type_name(tp)}")  # pragma: no cover - schema bug


def _from_dict(cls: type, data: dict[str, Any], path: str, errors: list[str]) -> Any:
    hints = typing.get_type_hints(cls)
    known = {f.name for f in fields(cls)}
    for key in data:
        if not key.startswith("_") and key not in known:
            errors.append(f"{path + '.' if path else ''}{key}: unknown key")
    kwargs: dict[str, Any] = {}
    for f in fields(cls):
        if f.name not in data:
            continue                      # keep the default
        kwargs[f.name] = _convert(data[f.name], hints[f.name], f"{path + '.' if path else ''}{f.name}", errors)
    try:
        return cls(**kwargs)
    except TypeError as exc:  # pragma: no cover - only on a schema bug
        errors.append(f"{path}: {exc}")
        return cls()


# --------------------------------------------------------------------------- validation

def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate(cfg: Config) -> list[str]:
    """Semantic checks. Returns a list of ``path: message`` strings (empty = valid)."""
    e: list[str] = []

    def rng(path: str, v: Any, lo: float, hi: float) -> None:
        if not _num(v) or not lo <= v <= hi:
            e.append(f"{path}: must be between {lo:g} and {hi:g} (got {v!r})")

    def positive(path: str, v: Any) -> None:
        if not _num(v) or v <= 0:
            e.append(f"{path}: must be > 0 (got {v!r})")

    if cfg.schema_version != SCHEMA_VERSION:
        e.append(f"schema_version: must be {SCHEMA_VERSION} (got {cfg.schema_version!r})")
    try:
        ipaddress.IPv4Address(cfg.bridge.ip)
    except (ipaddress.AddressValueError, ValueError):
        e.append(f"bridge.ip: not an IPv4 address ({cfg.bridge.ip!r})")
    rng("bridge.port", cfg.bridge.port, 1, 65535)
    rng("bridge.local_port", cfg.bridge.local_port, 0, 65535)

    rng("sender.rate_hz", cfg.sender.rate_hz, 200, 250)      # relay design: every 4-5 ms
    positive("sender.t_hold_ms", cfg.sender.t_hold_ms)
    if _num(cfg.sender.rate_hz) and _num(cfg.sender.t_hold_ms) and cfg.sender.rate_hz > 0:
        if cfg.sender.t_hold_ms <= 2 * 1000 / cfg.sender.rate_hz:
            e.append("sender.t_hold_ms: must be longer than two send periods")
    rng("sender.start_packets", cfg.sender.start_packets, 1, 1000)

    c = cfg.controller
    if not c.prefer_names or not all(isinstance(n, str) and n for n in c.prefer_names):
        e.append("controller.prefer_names: must be a non-empty list of names")
    rng("controller.poll_hz", c.poll_hz, 50, 2000)
    rng("controller.stale_ms", c.stale_ms, 5, 100)          # brief R2: disconnect detected <= 100 ms
    if isinstance(c.channel_map, list):
        if not 1 <= len(c.channel_map) <= protocol.NUM_CHANNELS:
            e.append(f"controller.channel_map: needs 1..{protocol.NUM_CHANNELS} entries")
        for i, ch in enumerate(c.channel_map):
            if not isinstance(ch, ChannelSource):
                continue
            p = f"controller.channel_map[{i}]"
            if ch.src not in CHANNEL_SOURCES:
                e.append(f"{p}.src: must be one of {', '.join(CHANNEL_SOURCES)} (got {ch.src!r})")
            rng(f"{p}.index", ch.index, 0, 127)
            if _num(ch.min) and _num(ch.max) and ch.min >= ch.max:
                e.append(f"{p}: min must be below max")

    il = cfg.interlock
    rng("interlock.arm_channel", il.arm_channel, 1, protocol.NUM_CHANNELS)
    rng("interlock.throttle_channel", il.throttle_channel, 1, protocol.NUM_CHANNELS)
    if il.arm_channel == il.throttle_channel:
        e.append("interlock: arm_channel and throttle_channel must differ")
    rng("interlock.arm_safe_min_us", il.arm_safe_min_us, protocol.US_MIN, protocol.US_MAX)
    rng("interlock.arm_safe_max_us", il.arm_safe_max_us, protocol.US_MIN, protocol.US_MAX)
    if _num(il.arm_safe_min_us) and _num(il.arm_safe_max_us) and il.arm_safe_min_us > il.arm_safe_max_us:
        e.append("interlock: arm_safe_min_us must not exceed arm_safe_max_us")
    rng("interlock.throttle_low_max_us", il.throttle_low_max_us, protocol.US_MIN, protocol.US_MAX)
    if isinstance(c.channel_map, list):          # an unmapped arm/throttle channel is centred: never "safe"
        for name, ch in (("arm_channel", il.arm_channel), ("throttle_channel", il.throttle_channel)):
            if isinstance(ch, int) and 1 <= ch <= protocol.NUM_CHANNELS and (
                    ch > len(c.channel_map) or getattr(c.channel_map[ch - 1], "src", "none") == "none"):
                e.append(f"interlock.{name}: CH{ch} is not mapped in controller.channel_map "
                         "(an unmapped channel can never be checked as safe)")

    a = cfg.alarms
    positive("alarms.status_timeout_ms", a.status_timeout_ms)
    if a.rtt_max_ms is not None:
        positive("alarms.rtt_max_ms", a.rtt_max_ms)
    rng("alarms.lq_min_pct", a.lq_min_pct, 0, 100)
    rng("alarms.cell_min_v", a.cell_min_v, 0, 5)
    rng("alarms.min_sats", a.min_sats, 0, 64)
    positive("alarms.telemetry_stale_s", a.telemetry_stale_s)
    positive("alarms.send_late_max_ms", a.send_late_max_ms)
    rng("alarms.send_late_count", a.send_late_count, 1, 250)
    positive("alarms.camera_mismatch_s", a.camera_mismatch_s)
    if a.rtt_rise_ms is not None:
        positive("alarms.rtt_rise_ms", a.rtt_rise_ms)
    positive("alarms.rtt_rise_window_s", a.rtt_rise_window_s)

    rng("client.cells", cfg.client.cells, 1, 16)

    m = cfg.mavlink
    try:
        ipaddress.IPv4Address(m.listen_ip)
    except (ipaddress.AddressValueError, ValueError):
        e.append(f"mavlink.listen_ip: not an IPv4 address ({m.listen_ip!r})")
    rng("mavlink.listen_port", m.listen_port, 0, 65535)          # 0 = any free port (tests)
    if m.carrier_sysid is not None:
        rng("mavlink.carrier_sysid", m.carrier_sysid, 1, 255)
    positive("mavlink.stale_s", m.stale_s)

    rng("api.port", cfg.api.port, 0, 65535)
    rng("log.sender_output_keep", cfg.log.sender_output_keep, 1, 1000)
    positive("log.sender_output_max_mb", cfg.log.sender_output_max_mb)
    v = cfg.video
    if v.status_bits_min_fw_ver is not None:
        rng("video.status_bits_min_fw_ver", v.status_bits_min_fw_ver, 0, 0xFFFF)
    rng("video.listen_port", v.listen_port, 1, 65535)
    if isinstance(v.fanout_ports, list):
        if not 1 <= len(v.fanout_ports) <= 4:
            e.append("video.fanout_ports: needs 1..4 ports")
        for i, port in enumerate(v.fanout_ports):
            rng(f"video.fanout_ports[{i}]", port, 1, 65535)
            if port == v.listen_port:
                e.append(f"video.fanout_ports[{i}]: must differ from video.listen_port (it would loop)")
    if v.decoder not in VIDEO_DECODERS:
        e.append(f"video.decoder: must be one of {', '.join(VIDEO_DECODERS)} (got {v.decoder!r})")

    mp = cfg.mp_output
    e.extend(mp_sysid_problems(mp.sysid, "mp_output.sysid"))
    if m.carrier_sysid is not None and mp.sysid == m.carrier_sysid:
        e.append("mp_output.sysid: must differ from mavlink.carrier_sysid")
    rng("mp_output.compid", mp.compid, 1, 255)
    try:
        if not ipaddress.IPv4Address(mp.host).is_loopback:
            e.append(f"mp_output.host: must be a loopback address (got {mp.host!r}); the client stream is for "
                     "Mission Planner on this laptop only (S-02b)")
    except (ipaddress.AddressValueError, ValueError):
        e.append(f"mp_output.host: not an IPv4 address ({mp.host!r})")
    rng("mp_output.port", mp.port, 1, 65535)
    if mp.port in (m.listen_port, cfg.api.port):
        e.append("mp_output.port: must differ from mavlink.listen_port and api.port")
    if mp.mode not in MP_MODES:
        e.append(f"mp_output.mode: must be one of {', '.join(MP_MODES)} (got {mp.mode!r})")
    if mp.adsb_icao is not None:
        rng("mp_output.adsb_icao", mp.adsb_icao, 1, 0xFFFFFF)
    if mp.callsign is not None and not 1 <= len(mp.callsign) <= 8:
        e.append("mp_output.callsign: 1..8 characters")

    cm = cfg.crsf_menu
    rng("crsf_menu.timeout_ms", cm.timeout_ms, 50, 5000)
    rng("crsf_menu.retries", cm.retries, 0, 10)
    rng("crsf_menu.vrx_lock_timeout_s", cm.vrx_lock_timeout_s, 1, 120)
    if not cfg.ui.camera_hotkey:
        e.append("ui.camera_hotkey: must be a key name such as F9")
    return e


#: Decoders the generated GStreamer pipelines may use (plan §7.4).
VIDEO_DECODERS = ("avdec_h264", "d3d11h264dec")
MP_MODES = ("vehicle", "adsb")
#: MAVLink system ids the app must never send as (plan S-02b): 1 = the carrier, 255 = Mission Planner.
FORBIDDEN_SYSIDS = (1, 255)


def mp_sysid_problems(sysid: Any, path: str = "sysid") -> list[str]:
    """The S-02b sysid guard: 2..254 only; never 1 (carrier) or 255 (Mission Planner, the primary GCS)."""
    if not isinstance(sysid, int) or isinstance(sysid, bool):
        return [f"{path}: must be an integer"]
    if sysid in FORBIDDEN_SYSIDS:
        return [f"{path}: {sysid} is forbidden (1 = carrier, 255 = Mission Planner; plan S-02b)"]
    if not 2 <= sysid <= 254:
        return [f"{path}: must be between 2 and 254 (got {sysid})"]
    return []


# --------------------------------------------------------------------------- migration (WP08a verification m4)

#: Renamed keys: (section, old name, new name, why).
RENAMED_KEYS = (
    ("alarms", "jitter_p99_max_ms", "send_late_max_ms",
     "WP08a rework 1: the SEND JITTER HIGH limit applies to single packets now; see gcs/README.md 'Alarms'"),
)


def migrate(data: dict[str, Any]) -> list[str]:
    """Rename old keys in a raw config dict, in place. Returns one notice per change."""
    notices: list[str] = []
    for section, old, new, why in RENAMED_KEYS:
        sec = data.get(section)
        if not isinstance(sec, dict) or old not in sec:
            continue
        value = sec.pop(old)
        if new in sec:
            notices.append(f"{section}.{old} removed: {section}.{new} is already set ({why})")
        else:
            sec[new] = value
            notices.append(f"{section}.{old} renamed to {section}.{new}, value {value!r} kept ({why})")
    return notices


def from_dict(data: Any, path: Path | None = None) -> Config:
    """Build and validate a :class:`Config`. Raises :class:`ConfigError` listing every problem."""
    errors: list[str] = []
    if not isinstance(data, dict):
        raise ConfigError(["top level: must be a JSON object"], path)
    cfg = _from_dict(Config, data, "", errors)
    if not errors:
        errors = validate(cfg)
    if errors:
        raise ConfigError(errors, path)
    return cfg


def save_config(cfg: Config, path: Path | None = None) -> Path:
    path = Path(path) if path else default_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(to_dict(cfg), indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return path


def load_config(path: Path | str | None = None, create: bool = True,
                notices: list[str] | None = None) -> Config:
    """Load ``path`` (default ``%APPDATA%\\vtol-gcs\\config.json``).

    A missing file is created with the defaults when ``create`` is true.
    Raises :class:`ConfigError` for invalid JSON or invalid values.

    Old key names are migrated (:func:`migrate`): a copy of the old file is kept as
    ``<name>.pre-migration.json`` and the file is rewritten with the new names.  One line per change
    goes to ``notices`` (the caller shows them; they are also logged).  A file that is still invalid
    after the migration is not rewritten, and the error lists the migration too.
    """
    path = Path(path) if path else default_config_path()
    if not path.exists():
        cfg = default_config()
        if create:
            save_config(cfg, path)
        return cfg
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise ConfigError([f"not valid JSON: {exc}"], path) from exc
    except OSError as exc:
        raise ConfigError([f"cannot read: {exc}"], path) from exc
    changes = migrate(data) if isinstance(data, dict) else []
    try:
        cfg = from_dict(data, path)
    except ConfigError as exc:
        if changes:
            raise ConfigError([f"(migrated: {c})" for c in changes] + exc.errors, path) from exc
        raise
    if changes:
        backup = path.with_name(path.stem + ".pre-migration.json")
        try:
            backup.write_bytes(path.read_bytes())
            save_config(cfg, path)
            changes.append(f"config file migrated and saved; the old file is kept as {backup.name}")
        except OSError as exc:
            changes.append(f"config migrated in memory only (could not rewrite {path}: {exc})")
        for line in changes:
            logging.getLogger("vtolgcs.config").warning("config migration: %s", line)
        if notices is not None:
            notices.extend(changes)
    return cfg


__all__ = [
    "ApiConfig", "AlarmConfig", "BridgeConfig", "CameraConfig", "ChannelSource", "ClientConfig",
    "Config", "ConfigError", "ControllerConfig", "InterlockConfig", "LogConfig", "MavlinkConfig",
    "SenderConfig", "VideoConfig", "MpOutputConfig", "CrsfMenuConfig", "UiConfig", "FORBIDDEN_SYSIDS",
    "migrate", "mp_sysid_problems", "app_dir", "default_config", "default_config_path",
    "edgetx_classic_map", "from_dict", "load_config", "log_dir", "save_config", "to_dict", "validate",
]
