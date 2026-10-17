"""UI process (brief R0/R1/R9): importable without a display, pure view/profile/wizard logic, the link's
up/down detection ("RC SENDER DOWN"), and the RC sender surviving the death of a UI process.

A full windowed smoke run (UI + spawned sender + bridge_sim, camera round trip) opens windows and a
console, so it runs only with ``VTOLGCS_UI_SMOKE=1``.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest

import bridge_sim as BS
from vtolgcs import config as C
from vtolgcs.config import Config
from vtolgcs.control import ControlServer
from vtolgcs.controller import FakeController
from vtolgcs.runtime import Runtime

GCS_DIR = Path(__file__).resolve().parents[1]


def test_ui_modules_import_without_a_display() -> None:
    code = ("import tkinter, vtolgcs.ui, vtolgcs.ui.app, vtolgcs.ui.link, vtolgcs.ui.view, vtolgcs.ui.profiles, "
            "vtolgcs.ui.mapping, vtolgcs.ui.hotkey; assert tkinter._default_root is None; print('ok')")
    env = dict(os.environ, PYTHONPATH=str(GCS_DIR), DISPLAY="")
    out = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0 and out.stdout.strip() == "ok", out.stderr


def test_status_bar_fields() -> None:
    from vtolgcs.ui import view
    assert view.status_fields(None, "down") == [("sender", view.SENDER_DOWN, view.RED)]
    assert view.status_fields(None, "connecting")[0][2] == view.AMBER
    s = {"app": {"mode": "fpv", "streaming": True, "start_path": "resume"},
         "bridge": {"state": "RUN", "rtt_ms": 3.2, "uplink_loss_pct": 0.0, "send_jitter_ms_p99": 0.5,
                    "sync_offset_us": -1.5, "timing_locked": True, "camera": {"requested": True, "reported": False}},
         "client": {"link": {"lq_pct": 65, "rssi1_dbm": -80}, "battery": {"voltage_v": 22.4}},
         "video": {"standard": "PAL", "decoder_lock": True},
         "alarms": [{"id": "camera_mismatch", "severity": "warn", "text": "x", "since": "t"}]}
    f = {k: (t, c) for k, t, c in view.status_fields(s, "up")}
    assert f["mode"][0] == "FPV (RESUME)" and f["bridge"] == ("BRIDGE RUN", view.GREEN)
    assert f["camera"] == ("CAM req ON / rep off", view.RED)               # requested vs reported
    assert f["lq"][1] == view.AMBER and f["video"] == ("video PAL LOCK", view.GREEN)
    assert f["alarms"] == ("1 ALARM", view.AMBER)
    for key in ("rtt", "loss", "jitter", "batt", "offset"):                # plan §7.5 fields
        assert key in f


def test_profiles_from_tools_export() -> None:
    from vtolgcs.ui.profiles import ProfileError, parse_profiles
    store = {"schemaVersion": 2, "packs": [{"id": "p1", "cells": 6}, {"id": "p2", "deleted": True}],
             "clients": [{"id": "c1", "name": "Reference client #1", "packId": "p1", "videoStandard": None,
                          "vtx": {"band": "R", "channel": 5}, "elrs": {"modelId": None}},
                         {"id": "c2", "name": "NTSC quad", "packId": "p2", "videoStandard": "NTSC"},
                         {"id": "c3", "deleted": True}]}
    ps = parse_profiles(store)
    assert [p.id for p in ps] == ["c1", "c2"]
    assert ps[0].cells == 6 and ps[0].video_standard is None and "video TBD" in ps[0].summary()
    assert ps[0].summary().count("R5") == 1 and ps[1].cells is None and ps[1].video_standard == "NTSC"
    with pytest.raises(ProfileError):
        parse_profiles({"packs": []})


def test_mapping_wizard_logic(tmp_path: Path) -> None:
    from vtolgcs.ui.mapping import Calibration, apply_assignment, detect_moved, save_channel_map
    assert detect_moved([0, 0, 0], [0, 0.1, 0]) is None
    assert detect_moved([0, 0, 0], [0, 0.1, -0.9]) == ("axis", 2, -0.9)
    assert detect_moved([0.0], [0.0], [False, False], [False, True]) == ("button", 1, 1.0)
    cal = Calibration()
    for v in (-0.8, 0.0, 0.9):
        cal.add([v, 0.0])
    assert cal.range(0) == (-0.8, 0.9) and cal.range(1) is None
    cfg_path = tmp_path / "config.json"
    C.save_config(C.default_config(), cfg_path)
    cmap = C.default_config().controller.channel_map
    apply_assignment(cmap, 3, "axis", 2, reverse=True, cal=Calibration({2: -0.9}, {2: 0.95}))
    assert save_channel_map(cfg_path, cmap) == []
    saved = C.load_config(cfg_path).controller.channel_map[2]
    assert (saved.src, saved.index, saved.reverse, saved.min, saved.max) == ("axis", 2, True, -0.9, 0.95)
    apply_assignment(cmap, 5, "none", 0)                                   # arm channel unmapped: refused
    assert any("arm_channel" in e for e in save_channel_map(cfg_path, cmap))
    assert C.load_config(cfg_path).controller.channel_map[4].src == "axis"   # file unchanged


def test_passthrough_and_commands() -> None:
    from vtolgcs.ui.link import fanout_command, passthrough_args, sender_command
    argv = ["--sim", "--run-seconds", "5", "--config", "c.json", "--attach-only", "--ui-smoke-out=x", "--headless"]
    assert passthrough_args(argv) == ["--sim", "--config", "c.json"]
    cmd = sender_command(["--sim"])
    assert cmd[-2:] == ["--headless", "--sim"] and "vtolgcs" in cmd
    assert "--video-fanout" in fanout_command(5600, [5601, 5602], None)


def test_hotkey_names_and_sse_parser() -> None:
    from vtolgcs.ui.hotkey import vk_code
    from vtolgcs.ui.link import iter_sse
    assert vk_code("F9") == 0x78 and vk_code("f1") == 0x70 and vk_code("X") is None
    raw = b"retry: 2000\n\nevent: status\ndata: {\"a\": 1}\n\nevent: alarm\ndata: {}\n\n"
    assert list(iter_sse(io.BytesIO(raw))) == [("status", '{"a": 1}'), ("alarm", "{}")]


# --------------------------------------------------------------------------- process separation (R0)

class _Sender:
    def __init__(self, tmp: Path) -> None:
        self.sim = BS.BridgeSim(BS.SimConfig(port=0, bridge=BS.BridgeConfig(boot_s=0.05, seed=1),
                                             client=BS.ClientConfig(gps_fix_delay_s=0.0, seed=1), seed=1)).start()
        cfg = Config()
        cfg.bridge.ip, cfg.bridge.port = self.sim.address
        cfg.api.port = 0
        cfg.mavlink.enabled = False
        self.rt = Runtime(cfg, FakeController(), instance_name=f"vtol-gcs-test-{uuid.uuid4().hex}", log_dir=tmp)
        self.rt.start()
        self.file = tmp / "control.json"
        self.server = ControlServer(self.rt, self.file).start()

    def rx_ok(self) -> int:
        with self.sim.lock:
            return self.sim.core.rx_ok

    def close(self) -> None:
        self.server.stop()
        self.rt.stop()
        self.sim.stop()


def _wait(cond, timeout: float = 8.0) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


def test_link_shows_sender_down_when_the_sender_dies(tmp_path: Path) -> None:
    from vtolgcs.ui.link import RuntimeLink
    s = _Sender(tmp_path)
    states: list[str] = []
    statuses: list[dict] = []
    link = RuntimeLink(s.file, statuses.append, lambda ev: None, lambda st, d: states.append(st)).start()
    try:
        assert _wait(lambda: link.up), states
        assert _wait(lambda: len(statuses) >= 3)                            # C2 status over SSE
        assert link.request("request_mode", mode="fpv")["ok"]
        assert _wait(lambda: statuses[-1]["bridge"]["state"] == "RUN")
        s.server.stop()                                                     # the sender process "dies"
        s.rt.stop()
        assert _wait(lambda: link.state == "down"), states                  # -> RC SENDER DOWN
    finally:
        link.stop()
        s.close()


def test_sender_keeps_streaming_when_the_ui_process_dies(tmp_path: Path) -> None:
    s = _Sender(tmp_path)
    try:
        ui = ("import os, sys; from vtolgcs.control import ControlClient; "
              f"c = ControlClient.from_file(r'{s.file}'); assert c.request('request_mode', mode='fpv')['ok']; "
              "os._exit(9)")                                                # abrupt death of the UI process
        proc = subprocess.run([sys.executable, "-c", ui], env=dict(os.environ, PYTHONPATH=str(GCS_DIR)),
                              capture_output=True, text=True, timeout=30)
        assert proc.returncode == 9, proc.stderr
        assert _wait(lambda: s.rt.status()["bridge"]["state"] == "RUN")
        n = s.rx_ok()
        time.sleep(1.0)
        assert s.rx_ok() - n > 150 and s.rt.sender.state().streaming       # still ~250 Hz after the UI died
    finally:
        s.close()


@pytest.mark.skipif(os.environ.get("VTOLGCS_UI_SMOKE") != "1", reason="opens windows; set VTOLGCS_UI_SMOKE=1")
def test_ui_smoke_with_spawned_sender(tmp_path: Path) -> None:
    sim = BS.BridgeSim(BS.SimConfig(port=0, bridge=BS.BridgeConfig(boot_s=0.05, seed=1), seed=1)).start()
    try:
        out = tmp_path / "smoke.json"
        proc = subprocess.run([sys.executable, "-m", "vtolgcs", "--sim", "--bridge", f"127.0.0.1:{sim.address[1]}",
                               "--config", str(tmp_path / "cfg.json"), "--log-dir", str(tmp_path), "--api-port", "0",
                               "--mavlink-port", "0", "--run-seconds", "10", "--ui-smoke-out", str(out)],
                              cwd=GCS_DIR, env=dict(os.environ, PYTHONPATH=str(GCS_DIR),
                                                    VTOLGCS_TEST_INSTANCE_NAME=f"vtol-gcs-test-{uuid.uuid4().hex}"),
                              timeout=60)
        assert proc.returncode == 0
        smoke = json.loads(out.read_text())
        assert smoke["last_bridge_state"] == "RUN" and smoke["camera_reported_on"] and smoke["link_state"] == "up"
    finally:
        sim.stop()


def test_revert_label_follows_the_revert_outcome() -> None:
    """WP13 R5, the UI handler itself: the label says "reverting..." until the result is known."""
    from types import SimpleNamespace
    from vtolgcs.crsf_menu import MenuError, VrxFollow
    from vtolgcs.ui.app import App
    for outcome in ("refused", "ok"):
        follow = VrxFollow(0.0)
        follow.start({"band": 5, "channel": 4})
        assert follow.update(False) == "no_lock"
        jobs: list = []
        shown: list = []

        def apply(band, channel, power, outcome=outcome):
            assert (band, channel) == (5, 4)
            if outcome == "refused":
                raise MenuError("write refused: the client may be armed")
            return {}
        fake = SimpleNamespace(follow=follow, vtx=SimpleNamespace(apply=apply),
                               bg=lambda fn, done: jobs.append((fn, done)),
                               _menu_done=lambda what, res: shown.append((what, res)))
        App.revert_vtx(fake)                                          # type: ignore[arg-type]
        assert follow.state == "reverting" and "reverted" not in follow.text()
        fn, done = jobs.pop()
        try:
            res = fn()
        except Exception as exc:                                      # what App.bg hands to done()
            res = exc
        done(res)
        if outcome == "refused":
            assert follow.state == "revert_failed" and "may be armed" in follow.text() and follow.offer_revert
            assert isinstance(shown[0][1], MenuError)
        else:
            assert follow.state == "reverted" and not follow.offer_revert
