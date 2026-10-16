"""Contract C2 reference shape (copied from docs/tasks/02-CONTRACTS.md) for the API tests."""

from __future__ import annotations

from typing import Any

#: The C2 Status object example, verbatim apart from the alarm list holding one item and the
#: additive ``app.start_path`` ("normal" | "resume" | null; PM amendment to WP08a R4).
C2_STATUS_EXAMPLE: dict[str, Any] = {
    "time_utc": "ISO-8601",
    "app": {"version": "2.0.0", "mode": "fpv|carrier_only|idle", "streaming": True, "start_path": "normal"},
    "controller": {"connected": True, "name": "RadioMaster TX16S Joystick", "arm_switch_safe": True,
                   "throttle_low": True},
    "bridge": {
        "state": "BOOT|WAIT_GCS|START|RUN|FAILSAFE|UNREACHABLE",
        "rtt_ms": 0.0, "uplink_loss_pct": 0.0, "send_jitter_ms_p99": 0.0, "status_age_ms": 0,
        "timing_locked": True, "sync_offset_us": 0.0, "fw_version": "x",
        "camera": {"requested": False, "reported": False},
    },
    "video": {"standard": "PAL|NTSC|null", "decoder_lock": True, "rx_kbps": 0},
    "client": {
        "profile_id": "...", "telemetry_age_ms": 0,
        "link": {"rssi1_dbm": -60, "rssi2_dbm": -62, "lq_pct": 100, "snr_db": 8, "rf_mode": 0, "tx_power_mw": 250,
                 "dl_rssi_dbm": -70, "dl_lq_pct": 100, "dl_snr_db": 6},
        "gps": {"lat": 0.0, "lon": 0.0, "alt_m": 0.0, "gspd_kmh": 0.0, "hdg_deg": 0.0, "sats": 0},
        "battery": {"voltage_v": 0.0, "current_a": 0.0, "used_mah": 0, "remaining_pct": 0},
        "attitude": {"pitch_rad": 0.0, "roll_rad": 0.0, "yaw_rad": 0.0},
        "flight_mode": {"raw": "ANGL*", "failsafe": False, "armed": False, "rescue_not_ready": False},
    },
    "carrier": {"lat": 0.0, "lon": 0.0, "alt_rel_m": 0.0, "hdg_deg": 0.0, "source": "mavlink-readonly|null"},
    "alarms": [{"id": "client_failsafe", "severity": "warn|crit", "text": "FPV FAILSAFE", "since": "ISO-8601"}],
}

ALARM_KEYS = {"id", "severity", "text", "since"}
BRIDGE_STATES = {"BOOT", "WAIT_GCS", "START", "RUN", "FAILSAFE", "UNREACHABLE"}


def key_tree(obj: Any) -> Any:
    """Nested key structure of a dict (lists are checked item by item separately)."""
    if isinstance(obj, dict):
        return {k: key_tree(v) for k, v in obj.items() if not isinstance(v, list)}
    return None


def assert_c2_status(status: dict) -> None:
    """Keys exactly as C2; value types sane; alarm items exactly the C2 Alarm keys."""
    assert key_tree(status) == key_tree(C2_STATUS_EXAMPLE)
    assert set(status) == set(C2_STATUS_EXAMPLE)
    assert isinstance(status["alarms"], list)
    for alarm in status["alarms"]:
        assert set(alarm) == ALARM_KEYS
        assert alarm["severity"] in ("warn", "crit")
    assert status["app"]["mode"] in ("fpv", "carrier_only", "idle")
    assert status["app"]["start_path"] in ("normal", "resume", None)
    assert status["bridge"]["state"] in BRIDGE_STATES
    assert status["carrier"]["source"] in ("mavlink-readonly", None)
    assert status["video"]["standard"] in ("PAL", "NTSC", None)
    assert status["time_utc"].endswith("Z")
