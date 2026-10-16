"""Config: defaults, file creation, validation with clear errors (brief R1)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from vtolgcs import config as C


def test_defaults_match_the_sources() -> None:
    cfg = C.default_config()
    assert (cfg.bridge.ip, cfg.bridge.port) == ("192.168.144.21", 5770)       # plan §3.3 proposal (Q3)
    assert cfg.sender.rate_hz == 250 and cfg.sender.t_hold_ms == 250 and cfg.sender.start_packets == 5
    assert cfg.api.port == 47800
    assert cfg.mavlink.listen_port == 14551 and cfg.mavlink.listen_ip == "127.0.0.1"
    il = cfg.interlock
    assert (il.arm_channel, il.arm_safe_min_us, il.arm_safe_max_us) == (5, 988, 1699)   # aux 0 0 0 1700 2100
    assert (il.throttle_channel, il.throttle_low_max_us) == (3, 1050)                  # AETR, min_check 1050
    assert cfg.camera.default_on is False
    a = cfg.alarms
    assert (a.status_timeout_ms, a.lq_min_pct, a.telemetry_stale_s, a.send_late_max_ms, a.camera_mismatch_s) \
        == (300, 70, 2.0, 2.0, 1.0)
    assert a.cell_min_v == 3.50 and a.min_sats == 8
    assert a.rtt_max_ms is None          # TBD: HM30 RTT unmeasured
    assert len(cfg.controller.channel_map) == 16
    assert [c.src for c in cfg.controller.channel_map] == ["axis"] * 8 + ["button"] * 8
    assert C.validate(cfg) == []


def test_load_creates_file_with_defaults(tmp_path: Path) -> None:
    path = tmp_path / "sub" / "config.json"
    cfg = C.load_config(path)
    assert path.exists()
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["bridge"]["ip"] == "192.168.144.21"
    assert "Q3" in data["bridge"]["_note"]                # the proposed IP is marked in the file
    assert C.load_config(path) == cfg                     # round trip


def test_default_path_uses_appdata(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("APPDATA", str(tmp_path))
    assert C.default_config_path() == tmp_path / "vtol-gcs" / "config.json"
    assert C.log_dir(C.default_config()) == tmp_path / "vtol-gcs" / "logs"


def test_partial_file_keeps_defaults(tmp_path: Path) -> None:
    path = tmp_path / "c.json"
    path.write_text(json.dumps({"bridge": {"ip": "192.168.144.30"}, "sender": {"rate_hz": 200}}))
    cfg = C.load_config(path)
    assert cfg.bridge.ip == "192.168.144.30" and cfg.bridge.port == 5770
    assert cfg.sender.rate_hz == 200.0 and cfg.api.port == 47800


@pytest.mark.parametrize("data, fragment", [
    ({"sender": {"rate_hz": 300}}, "sender.rate_hz: must be between 200 and 250"),
    ({"sender": {"rate_hz": 199}}, "sender.rate_hz"),
    ({"bridge": {"ip": "192.168.144"}}, "bridge.ip: not an IPv4 address"),
    ({"bridge": {"port": 70000}}, "bridge.port"),
    ({"bridge": {"pport": 1}}, "bridge.pport: unknown key"),
    ({"api": {"port": "47800"}}, "api.port: must be an integer"),
    ({"camera": {"default_on": 1}}, "camera.default_on: must be true or false"),
    ({"interlock": {"arm_channel": 3}}, "arm_channel and throttle_channel must differ"),
    ({"interlock": {"arm_channel": 17}}, "interlock.arm_channel"),
    ({"interlock": {"arm_safe_min_us": 1800, "arm_safe_max_us": 1200}}, "arm_safe_min_us must not exceed"),
    ({"controller": {"stale_ms": 500}}, "controller.stale_ms: must be between 5 and 100"),
    ({"controller": {"channel_map": [{"src": "slider"}]}}, "channel_map[0].src"),
    ({"controller": {"channel_map": [{"src": "axis", "index": i} for i in range(4)]}},
     "interlock.arm_channel: CH5 is not mapped"),
    ({"controller": {"channel_map": [{"src": "axis", "index": 0}, {"src": "axis", "index": 1},
                                     {"src": "none"}, {"src": "axis", "index": 3}, {"src": "axis", "index": 4}]}},
     "interlock.throttle_channel: CH3 is not mapped"),
    ({"controller": {"channel_map": "axes"}}, "controller.channel_map: must be a list"),
    ({"controller": {"channel_map": [{"src": "axis", "min": 1, "max": -1}]}}, "min must be below max"),
    ({"alarms": {"lq_min_pct": 170}}, "alarms.lq_min_pct"),
    ({"alarms": {"rtt_max_ms": -5}}, "alarms.rtt_max_ms: must be > 0"),
    ({"sender": {"t_hold_ms": 5}}, "longer than two send periods"),
    ({"mavlink": {"carrier_sysid": 0}}, "mavlink.carrier_sysid"),
    ({"schema_version": 2}, "schema_version"),
    ([1, 2], "top level: must be a JSON object"),
])
def test_validation_errors_are_clear(data: object, fragment: str) -> None:
    with pytest.raises(C.ConfigError) as exc:
        C.from_dict(data)
    assert any(fragment in e for e in exc.value.errors), exc.value.errors
    assert fragment.split(":")[0] in str(exc.value)


def test_every_problem_is_listed() -> None:
    with pytest.raises(C.ConfigError) as exc:
        C.from_dict({"nope": 1, "api": {"port": "x"}})        # structural pass: all type/key errors
    assert len(exc.value.errors) == 2
    with pytest.raises(C.ConfigError) as exc:
        C.from_dict({"sender": {"rate_hz": 300}, "api": {"port": -1}})   # semantic pass: all range errors
    assert len(exc.value.errors) == 2


def test_invalid_json_file(tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    path.write_text("{ not json")
    with pytest.raises(C.ConfigError, match="not valid JSON"):
        C.load_config(path)


def test_comment_keys_are_ignored() -> None:
    cfg = C.from_dict({"_comment": "x", "bridge": {"_note": "y", "ip": "10.0.0.1"}})
    assert cfg.bridge.ip == "10.0.0.1"
