"""UI process (brief R0/R1/R9): importable without a display, pure view/profile/wizard logic, the link's
up/down detection ("RC SENDER DOWN"), and the RC sender surviving the death of a UI process.

A full windowed smoke run (UI + spawned sender + bridge_sim, camera round trip) opens windows, so it
runs only with ``VTOLGCS_UI_SMOKE=1``.  WP15: the spawned sender has no console window, takes no focus
and ignores keys (tested without any window, by typing into its windowless console).
"""

from __future__ import annotations

import contextlib
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
    assert cmd[-3:] == ["--headless", "--no-keys", "--sim"] and "vtolgcs" in cmd     # WP15 R1: no keys
    assert sender_command(["--no-keys", "--sim"]).count("--no-keys") == 1
    assert "--video-fanout" in fanout_command(5600, [5601, 5602], None)


def test_sender_output_file_helpers(tmp_path: Path) -> None:
    from vtolgcs.ui.link import sender_output_path, tail_lines
    path = sender_output_path(tmp_path)
    assert path.parent == tmp_path and path.name.startswith("sender-") and path.suffix == ".log"
    path.write_text("".join(f"line {i}\n" for i in range(2000)) + "\n\n", encoding="utf-8")
    assert tail_lines(path, 3) == ["line 1997", "line 1998", "line 1999"]
    assert tail_lines(tmp_path / "missing.log") == [] and tail_lines(None) == []


@pytest.mark.skipif(sys.platform != "win32", reason="Windows console flags")
def test_spawn_sender_gives_no_console_window_and_no_input(tmp_path: Path) -> None:
    """WP15 R1: the process has no console window and its stdin is NUL; its output lands in the file."""
    from vtolgcs.ui.link import spawn_sender
    probe = ("import ctypes, sys; from vtolgcs.__main__ import is_console; "
             "print('window', ctypes.WinDLL('kernel32').GetConsoleWindow()); "
             "print('stdin console', is_console(sys.stdin), 'read', repr(sys.stdin.read())); "
             "print('stdout console', is_console(sys.stdout)); print('err', file=sys.stderr)")
    out = tmp_path / "logs" / "sender-x.log"
    proc = spawn_sender([sys.executable, "-c", probe], out)
    assert proc.wait(30) == 0
    text = out.read_text(encoding="utf-8")
    assert "window 0" in text and "stdin console False read ''" in text and "stdout console False" in text
    assert "err" in text                                                        # stderr goes to the file too


class _UiSpawnedSender:
    """The real sender started exactly the way the UI starts it (``spawn_sender``: no console window, stdin
    NUL, ``--no-keys``), against an in-process bridge_sim, and its control-channel client."""

    def __init__(self, tmp_path: Path, monkeypatch, watch_foreground: bool = False) -> None:
        from vtolgcs.__main__ import TEST_INSTANCE_ENV
        from vtolgcs.control import ControlClient, ControlError
        from vtolgcs.ui.link import passthrough_args, sender_command, sender_output_path, spawn_sender
        monkeypatch.setenv(TEST_INSTANCE_ENV, f"vtol-gcs-test-{uuid.uuid4().hex}")
        self.tmp = tmp_path
        self.proc: subprocess.Popen | None = None
        self.client = None
        self.sim = BS.BridgeSim(BS.SimConfig(port=0, bridge=BS.BridgeConfig(boot_s=0.05, seed=1), seed=1)).start()
        try:                                          # WP18 R1: a failure from here on still stops the sim
            argv = ["--sim", "--bridge", f"127.0.0.1:{self.sim.address[1]}", "--config", str(tmp_path / "cfg.json"),
                    "--log-dir", str(tmp_path), "--api-port", "0", "--mavlink-port", "0", "--run-seconds", "30"]
            self.out = sender_output_path(tmp_path)
            self.proc = spawn_sender(sender_command(passthrough_args(argv)), self.out)
            self.pids, self.fg = {self.proc.pid}, set()
            end = time.monotonic() + 20
            while self.client is None and time.monotonic() < end:
                if watch_foreground:
                    from _console import foreground_pid
                    self.fg.add(foreground_pid())
                try:
                    self.client = ControlClient.from_file(tmp_path / "control.json", timeout=2.0)
                    self.pids.add(self.client.request("hello")["result"]["pid"])    # the sender (a launcher's child)
                except (ControlError, OSError, KeyError):
                    self.client = None
                    time.sleep(0.05)
            assert self.client is not None, self.text() or "no output"
        except BaseException:
            self.close()
            raise

    def status(self) -> dict:
        assert self.client is not None
        return self.client.request("status")["result"]

    def text(self) -> str:
        return self.out.read_text(encoding="utf-8", errors="replace") if self.out.exists() else ""

    def close(self) -> None:
        try:
            if self.client is not None:
                self.client.close()
            if self.proc is not None and self.proc.poll() is None:
                self.proc.kill()
                self.proc.wait(10)
        finally:
            self.sim.stop()

    def assert_streaming_unchanged(self) -> None:
        s = self.status()
        assert self.proc.poll() is None and s["app"]["mode"] == "fpv" and s["app"]["streaming"], s["app"]
        assert s["controller"]["connected"] and s["controller"]["arm_switch_safe"]
        assert s["bridge"]["camera"]["requested"] is False and s["bridge"]["state"] == "RUN"

    def assert_final_output(self) -> str:
        text = self.text()
        assert "headless - bridge 127.0.0.1" in text and "console keys off (--no-keys)" in text
        assert "cancelled" not in text and "Type " not in text                         # it never asked for input
        assert "stop requested through the control channel" in text and "stopped (RC stream off" in text
        recs = [json.loads(x) for x in next(self.tmp.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()]
        assert [r["mode"] for r in recs if r["type"] == "mode"] == ["fpv"]
        return text


@pytest.mark.skipif(sys.platform != "win32", reason="Windows console flags")
def test_spawned_sender_streams_without_input_and_stops_only_through_the_control_channel(tmp_path: Path,
                                                                                       monkeypatch) -> None:
    """WP15 R1, the part that needs no interactive desktop (WP17 split; runs on CI): the real sender started the
    way the UI starts it streams with console keys off and no visible window, asks for nothing, and stops only
    through the control channel with the typed STOP."""
    from _console import visible_windows
    h = _UiSpawnedSender(tmp_path, monkeypatch)
    try:
        assert _wait(lambda: h.status()["bridge"]["state"] == "RUN", 15)
        time.sleep(0.5)
        h.assert_streaming_unchanged()
        assert visible_windows(h.pids) == []
        assert h.client is not None
        assert not h.client.request("stop")["ok"]                              # streaming: STOP must be typed
        h.assert_streaming_unchanged()
        assert h.client.request("stop", typed="STOP")["ok"]                    # the UI's way to stop it
        assert h.proc.wait(15) == 0
    finally:
        h.close()
    assert "QUIT" not in h.assert_final_output()


@pytest.mark.skipif(sys.platform != "win32", reason="Windows console and windows")
@pytest.mark.interactive_desktop             # foreground window + WriteConsoleInput / Ctrl+C / Ctrl+Break
def test_spawned_sender_has_no_window_takes_no_focus_and_ignores_keys(tmp_path: Path, monkeypatch) -> None:
    """WP15 R1/R3: the real sender started the way the UI starts it - no visible window, never the
    foreground window, and keys typed into its (windowless) console change nothing, Ctrl+C included.
    WP16 R3/R4: Ctrl+C never reaches it (its process group ignores Ctrl+C); Ctrl+Break does reach it, for
    real, and only gives the refused QUIT (no console to type STOP on)."""
    from _console import ctrl_break, ctrl_c, foreground_pid, type_keys, visible_windows
    h = _UiSpawnedSender(tmp_path, monkeypatch, watch_foreground=True)
    try:
        assert _wait(lambda: h.status()["bridge"]["state"] == "RUN", 15)
        for _ in range(20):
            h.fg.add(foreground_pid())
            time.sleep(0.05)
        assert not (h.fg & h.pids), "the sender took the focus"
        assert visible_windows(h.pids) == []
        for keys in ("q", "i", "a", "d", "k", "iSTOP\r", "qSTOP\r", "aARM\r", "dUNPLUG\r"):
            type_keys(h.proc.pid, keys)                                     # typed into its own console
        ctrl_c(h.proc.pid)
        time.sleep(1.0)
        assert "QUIT" not in h.text()                                       # Ctrl+C: ignored (process group)
        ctrl_break(h.proc.pid)                                              # Ctrl+Break: delivered, refused
        assert _wait(lambda: "QUIT needs a typed confirmation" in h.text(), 10)
        time.sleep(0.5)
        h.assert_streaming_unchanged()
        assert visible_windows(h.pids) == []
        assert h.client is not None
        assert h.client.request("stop", typed="STOP")["ok"]                 # the UI's way to stop it
        assert h.proc.wait(15) == 0
    finally:
        h.close()
    text = h.assert_final_output()
    # Ctrl+C never even reaches it (CREATE_NEW_PROCESS_GROUP disables Ctrl+C); had it, --no-keys refuses QUIT
    assert text.count("QUIT needs a typed confirmation") == 1                       # Ctrl+Break only


def test_prune_sender_outputs(tmp_path: Path) -> None:
    """WP16 R5: keep the newest N sender-*.log files, cap their total size, never delete the current one
    or any other file."""
    from vtolgcs.ui.link import prune_sender_outputs
    names = [f"sender-202610{d:02d}T120000Z.log" for d in range(1, 11)]
    for i, name in enumerate(names):                                   # oldest first, 1000 bytes each
        (tmp_path / name).write_bytes(b"x" * 1000)
        os.utime(tmp_path / name, (1_700_000_000 + i, 1_700_000_000 + i))
    others = ["session-20261001T120000Z.jsonl", "sender-notes.log", "sender-20261001T120000Z.log.bak"]
    for name in others:
        (tmp_path / name).write_text("keep me", encoding="utf-8")
    current = tmp_path / names[0]                                     # current = the oldest-looking file
    deleted = prune_sender_outputs(tmp_path, current, keep=4, max_bytes=1e9)
    assert sorted(p.name for p in deleted) == names[1:7]               # current + the 3 newest stay
    assert sorted(p.name for p in tmp_path.glob("sender-2*Z.log")) == [names[0], *names[7:]]
    assert all((tmp_path / n).exists() for n in others)
    deleted = prune_sender_outputs(tmp_path, current, keep=20, max_bytes=2500)   # size cap: current + 1 newest
    assert sorted(p.name for p in deleted) == names[7:9]
    assert sorted(p.name for p in tmp_path.glob("sender-2*Z.log")) == [names[0], names[9]]
    assert prune_sender_outputs(tmp_path, current, keep=1, max_bytes=1) == [tmp_path / names[9]]
    assert [p.name for p in tmp_path.glob("sender-2*Z.log")] == [names[0]]          # never the current one
    assert prune_sender_outputs(tmp_path / "missing", None, keep=1, max_bytes=1) == []


@pytest.mark.skipif(sys.platform != "win32", reason="an open file cannot be deleted on Windows")
def test_prune_sender_outputs_leaves_a_file_in_use(tmp_path: Path) -> None:
    from vtolgcs.ui.link import prune_sender_outputs
    old, cur = tmp_path / "sender-20261001T120000Z.log", tmp_path / "sender-20261002T120000Z.log"
    old.write_text("old", encoding="utf-8")
    cur.write_text("cur", encoding="utf-8")
    os.utime(old, (1_700_000_000, 1_700_000_000))
    with open(old, "a", encoding="utf-8"):                             # a sender that still runs holds it open
        assert prune_sender_outputs(tmp_path, cur, keep=1, max_bytes=1e9) == []
    assert prune_sender_outputs(tmp_path, cur, keep=1, max_bytes=1e9) == [old]


def test_sender_output_retention_config() -> None:
    cfg = Config()
    assert (cfg.log.sender_output_keep, cfg.log.sender_output_max_mb) == (20, 100.0)
    cfg.log.sender_output_keep, cfg.log.sender_output_max_mb = 0, 0
    errors = C.validate(cfg)
    assert any(e.startswith("log.sender_output_keep") for e in errors)
    assert any(e.startswith("log.sender_output_max_mb") for e in errors)


def test_launch_dialog_helpers() -> None:
    from vtolgcs.__main__ import build_parser
    from vtolgcs.ui.link import launch_dialog, launch_refusals
    parse = build_parser().parse_args
    assert launch_dialog(parse(["--resume"]))[:2] == ("RESUME", "--resume")
    assert launch_dialog(parse(["--resu"]))[:2] == ("RESUME", "--resume")             # argparse abbreviation
    assert launch_dialog(parse(["--mode=carrier_only"]))[:2] == ("CARRIER-ONLY", "--mode carrier_only")
    assert launch_dialog(parse(["--mode", "fpv"])) is None and launch_dialog(parse([])) is None
    lines = ["vtol-gcs 2.0.0 headless", "RESUME started: CH5 = 2012 us",
             "RESUME needs a typed confirmation on an interactive console; piped or redirected input is refused"
             " - nothing sent"]
    assert launch_refusals(lines, "RESUME") == lines[2:]
    assert launch_refusals(lines, "CARRIER-ONLY") == []


@pytest.mark.skipif(sys.platform != "win32", reason="Windows console flags")
@pytest.mark.parametrize("flags, prefix", [(["--sim-armed", "--resume"], "RESUME"),
                                           (["--mode", "carrier_only"], "CARRIER-ONLY")])
def test_ui_shows_the_launch_dialog_refusal_in_events(tmp_path: Path, monkeypatch, flags, prefix) -> None:
    """WP16 R2: the real sender, started as the UI starts it with --resume / --mode carrier_only, refuses
    (no console); the UI's handler puts that refusal, with its reason, under Events."""
    from types import SimpleNamespace
    from vtolgcs.__main__ import TEST_INSTANCE_ENV, build_parser
    from vtolgcs.control import ControlClient
    from vtolgcs.ui.app import App
    from vtolgcs.ui.link import launch_dialog, passthrough_args, sender_command, sender_output_path, spawn_sender
    monkeypatch.setenv(TEST_INSTANCE_ENV, f"vtol-gcs-test-{uuid.uuid4().hex}")
    sim = BS.BridgeSim(BS.SimConfig(port=0, bridge=BS.BridgeConfig(boot_s=0.05, seed=1), seed=1)).start()
    client = proc = None
    try:                                                              # WP18 R1: the sim stops whatever fails
        argv = ["--sim", "--bridge", f"127.0.0.1:{sim.address[1]}", "--config", str(tmp_path / "cfg.json"),
                "--log-dir", str(tmp_path), "--no-api", "--mavlink-port", "0", *flags]
        dialog = launch_dialog(build_parser().parse_args(argv))
        assert dialog is not None and dialog[0] == prefix
        out = sender_output_path(tmp_path)
        proc = spawn_sender(sender_command(passthrough_args(argv)), out)
        notes: list[str] = []
        fake = SimpleNamespace(_launch_watch=(dialog, time.monotonic() + 20), sender_output=out, spawned=proc,
                               note=notes.append)

        def answered() -> bool:
            App._check_launch_dialog(fake)                            # type: ignore[arg-type]
            return bool(notes)
        assert _wait(answered, 20), out.read_text(encoding="utf-8")
        assert fake._launch_watch is None
        assert notes[0].startswith(f"RC sender refused {dialog[1]} at launch: {prefix} needs a typed "
                                   "confirmation on an interactive console"), notes
        assert "nothing sent" in notes[0] and f"Use Flight -> {dialog[2]}" in notes[1]
        client = ControlClient.from_file(tmp_path / "control.json", timeout=2.0)
        assert client.request("status")["result"]["app"]["mode"] == "idle"
        assert client.request("stop")["ok"]
        assert proc.wait(15) == 0
    finally:
        try:
            if client is not None:
                client.close()
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.wait(10)
        finally:
            sim.stop()
    with sim.lock:
        assert sim.core.rx_ok == 0                                    # nothing was sent


def test_launch_dialog_watch_gives_up_without_an_answer(tmp_path: Path) -> None:
    from types import SimpleNamespace
    from vtolgcs.ui.app import App
    from vtolgcs.ui.link import LAUNCH_DIALOGS
    out = tmp_path / "sender-20261017T120000Z.log"
    out.write_text("vtol-gcs headless", encoding="utf-8")
    notes: list[str] = []
    fake = SimpleNamespace(_launch_watch=(LAUNCH_DIALOGS["resume"], time.monotonic() - 1), sender_output=out,
                           spawned=SimpleNamespace(poll=lambda: None), note=notes.append)
    App._check_launch_dialog(fake)                                    # type: ignore[arg-type]
    assert fake._launch_watch is None and len(notes) == 1 and "shows no answer" in notes[0]


def test_hotkey_names_and_sse_parser() -> None:
    from vtolgcs.ui.hotkey import vk_code
    from vtolgcs.ui.link import iter_sse
    assert vk_code("F9") == 0x78 and vk_code("f1") == 0x70 and vk_code("X") is None
    raw = b"retry: 2000\n\nevent: status\ndata: {\"a\": 1}\n\nevent: alarm\ndata: {}\n\n"
    assert list(iter_sse(io.BytesIO(raw))) == [("status", '{"a": 1}'), ("alarm", "{}")]


# --------------------------------------------------------------------------- process separation (R0)

class _Sender:
    def __init__(self, tmp: Path) -> None:
        self._parts = contextlib.ExitStack()           # WP18 R1: stop what was started, also after a failure
        try:
            self.sim = BS.BridgeSim(BS.SimConfig(port=0, bridge=BS.BridgeConfig(boot_s=0.05, seed=1),
                                                 client=BS.ClientConfig(gps_fix_delay_s=0.0, seed=1), seed=1))
            self._parts.callback(self.sim.stop)
            self.sim.start()
            cfg = Config()
            cfg.bridge.ip, cfg.bridge.port = self.sim.address
            cfg.api.port = 0
            cfg.mavlink.enabled = False
            self.rt = Runtime(cfg, FakeController(), instance_name=f"vtol-gcs-test-{uuid.uuid4().hex}", log_dir=tmp)
            self._parts.callback(self.rt.stop)
            self.rt.start()
            self.file = tmp / "control.json"
            self.server = ControlServer(self.rt, self.file)
            self._parts.callback(self.server.stop)
            self.server.start()
        except BaseException:
            self.close()
            raise

    def rx_ok(self) -> int:
        with self.sim.lock:
            return self.sim.core.rx_ok

    def close(self) -> None:
        self._parts.close()


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
@pytest.mark.interactive_desktop                                 # Tk windows on the desktop
def test_ui_smoke_launch_resume_refusal_in_events(tmp_path: Path) -> None:
    """WP16 R2 in the windowed UI: ``--resume`` reaches a sender without a console; the refusal and its
    reason appear under Events, and nothing is sent."""
    sim = BS.BridgeSim(BS.SimConfig(port=0, bridge=BS.BridgeConfig(boot_s=0.05, seed=1), seed=1)).start()
    try:
        out = tmp_path / "smoke.json"
        proc = subprocess.run([sys.executable, "-m", "vtolgcs", "--sim", "--sim-armed", "--resume", "--bridge",
                               f"127.0.0.1:{sim.address[1]}", "--config", str(tmp_path / "cfg.json"), "--log-dir",
                               str(tmp_path), "--api-port", "0", "--mavlink-port", "0", "--run-seconds", "6",
                               "--ui-smoke-out", str(out)],
                              cwd=GCS_DIR, env=dict(os.environ, PYTHONPATH=str(GCS_DIR),
                                                    VTOLGCS_TEST_INSTANCE_NAME=f"vtol-gcs-test-{uuid.uuid4().hex}"),
                              timeout=60)
        assert proc.returncode == 0
        notes = json.loads(out.read_text())["notes"]
        assert any(n.startswith("RC sender refused --resume at launch: RESUME needs a typed confirmation on an "
                                "interactive console") for n in notes), notes
        assert any("Use Flight -> RESUME (client airborne)" in n for n in notes), notes
        with sim.lock:
            assert sim.core.rx_ok == 0
    finally:
        sim.stop()


@pytest.mark.skipif(os.environ.get("VTOLGCS_UI_SMOKE") != "1", reason="opens windows; set VTOLGCS_UI_SMOKE=1")
@pytest.mark.interactive_desktop                                 # Tk windows on the desktop
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
        outputs = list(tmp_path.glob("sender-*.log"))                     # WP15 R1: no console, output to a file
        assert len(outputs) == 1 and "console keys off (--no-keys)" in outputs[0].read_text(encoding="utf-8")
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
