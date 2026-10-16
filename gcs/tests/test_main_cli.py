"""``python -m vtolgcs --headless --sim`` as a real process, and the CLI safety rules (brief R12, rework 1)."""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import bridge_sim as BS
from vtolgcs import timing_win
from vtolgcs.__main__ import (TEST_INSTANCE_ENV, Console, build_parser, initial_start, make_sim_controller,
                              sim_usage_error, status_line)
from vtolgcs.config import Config
from vtolgcs.protocol import BridgeState

GCS_DIR = Path(__file__).resolve().parents[1]


def run_cli(*args: str, timeout: float = 30, stdin: str = "",
            instance: str | None = None) -> subprocess.CompletedProcess:
    env = dict(os.environ, PYTHONPATH=str(GCS_DIR), PYTHONIOENCODING="utf-8")
    env[TEST_INSTANCE_ENV] = instance or f"vtol-gcs-test-{uuid.uuid4().hex}"
    return subprocess.run([sys.executable, "-m", "vtolgcs", *args], capture_output=True, text=True,
                          timeout=timeout, env=env, cwd=GCS_DIR, input=stdin)


def sim_run(tmp_path: Path, *args: str, stdin: str = "") -> tuple[subprocess.CompletedProcess, "BS.BridgeSim"]:
    sim = BS.BridgeSim(BS.SimConfig(port=0, bridge=BS.BridgeConfig(boot_s=0.05, seed=1),
                                    client=BS.ClientConfig(gps_fix_delay_s=0.0, seed=1), seed=1)).start()
    try:
        proc = run_cli("--headless", "--sim", "--bridge", f"127.0.0.1:{sim.address[1]}", "--no-api",
                       "--mavlink-port", "0", "--config", str(tmp_path / "cfg.json"), "--log-dir", str(tmp_path),
                       "--run-seconds", "2", *args, stdin=stdin)
    finally:
        sim.stop()
    return proc, sim


class Listener:
    """A UDP socket standing in for a bridge: counts whatever arrives."""

    def __init__(self) -> None:
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.settimeout(0.2)
        self.port = self.sock.getsockname()[1]

    def count(self) -> int:
        n = 0
        while True:
            try:
                self.sock.recvfrom(2048)
                n += 1
            except (socket.timeout, ConnectionResetError):
                return n

    def close(self) -> None:
        self.sock.close()


def test_headless_sim_streams_then_failsafe_on_exit(tmp_path: Path) -> None:
    sim = BS.BridgeSim(BS.SimConfig(port=0, bridge=BS.BridgeConfig(boot_s=0.05, seed=1),
                                    client=BS.ClientConfig(gps_fix_delay_s=0.0, seed=1), seed=1)).start()
    try:
        port = sim.address[1]
        proc = run_cli("--headless", "--sim", "--bridge", f"127.0.0.1:{port}", "--api-port", "0",
                       "--mavlink-port", "0", "--config", str(tmp_path / "cfg.json"), "--log-dir", str(tmp_path),
                       "--run-seconds", "3")
        out = proc.stdout
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "[SIM]" in out and "bridge RUN" in out, out
        assert "bridge START after" in out                    # start_packets expectation reported
        with sim.lock:
            assert sim.core.visited(BridgeState.RUN)
        t_end = time.time() + 5                     # the app is gone: the bridge must reach FAILSAFE
        while time.time() < t_end:
            with sim.lock:
                if sim.core.visited(BridgeState.FAILSAFE):
                    break
            time.sleep(0.02)
        with sim.lock:
            assert sim.core.visited(BridgeState.FAILSAFE)
        assert (tmp_path / "cfg.json").exists()       # config created with defaults
        logs = list(tmp_path.glob("session-*.jsonl"))
        assert len(logs) == 1
        recs = [json.loads(line) for line in logs[0].read_text(encoding="utf-8").splitlines()]
        types = {r["type"] for r in recs}
        assert {"session_start", "mode", "status", "start_timing", "session_end"} <= types
        st = [r for r in recs if r["type"] == "start_timing"][0]
        assert st["expected_start_packets"] == 5 and st["packets_sent"] >= 5
    finally:
        sim.stop()


# --------------------------------------------------------------------------- F2: --sim confined to loopback

def test_sim_with_non_loopback_bridge_is_a_hard_error(tmp_path: Path) -> None:
    proc = run_cli("--headless", "--sim", "--bridge", "192.168.144.21:5770", "--no-api", "--no-log",
                   "--config", str(tmp_path / "c.json"), "--run-seconds", "1")
    assert proc.returncode == 4 and "not loopback" in proc.stderr
    assert "headless - bridge" not in proc.stdout                 # never started
    proc = run_cli("--headless", "--sim-armed", "--no-api", "--no-log", "--config", str(tmp_path / "c.json"),
                   "--run-seconds", "1")
    assert proc.returncode == 4 and "--sim-armed needs --sim" in proc.stderr


def _args(*argv: str) -> argparse.Namespace:
    return build_parser().parse_args(["--headless", *argv])


def test_sim_usage_rules() -> None:
    assert sim_usage_error(_args("--sim")) is None
    assert sim_usage_error(_args("--sim", "--bridge", "127.0.0.1:5999")) is None
    assert sim_usage_error(_args("--sim", "--bridge", "10.0.0.5:5770")) is not None
    assert sim_usage_error(_args("--bridge", "10.0.0.5:5770")) is None       # real use: any bridge


def test_fake_controller_and_keyboard_arm_only_with_loopback() -> None:
    cfg = Config()
    cfg.bridge.ip = "192.168.144.21"
    assert make_sim_controller(cfg, sim=True, sim_armed=False) is None
    cfg.bridge.ip = "127.0.0.1"
    assert make_sim_controller(cfg, sim=True, sim_armed=False) is not None
    assert make_sim_controller(cfg, sim=False, sim_armed=False) is None

    class _Rt:                                                    # Console needs only these here
        cfg = Config()

        def add_listener(self, fn) -> None:
            pass
    console = Console(_Rt(), None, tty=False)                     # type: ignore[arg-type]
    assert console.key("a") is True and console.key("d") is True  # no fake controller: no-ops


def test_sim_auto_start_only_with_loopback() -> None:
    cfg = Config()
    cfg.bridge.ip = "127.0.0.1"
    assert initial_start(_args("--sim"), cfg) == "fpv"
    assert initial_start(_args("--sim", "--sim-armed"), cfg) is None
    cfg.bridge.ip = "192.168.144.21"
    assert initial_start(_args("--sim"), cfg) is None
    assert initial_start(_args(), cfg) is None                    # real use: always idle
    assert initial_start(_args("--mode", "carrier_only"), cfg) == "carrier_only"   # -> confirmation dialog
    assert initial_start(_args("--resume"), cfg) == "resume"


# --------------------------------------------------------------------------- never auto-start, typed confirmations

def test_restart_with_switch_armed_comes_up_idle(tmp_path: Path) -> None:
    proc, sim = sim_run(tmp_path, "--sim-armed")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert sim.core.rx_ok == 0 and "idle" in proc.stdout.lower()          # never auto-resume


def test_piped_resume_confirmation_is_refused(tmp_path: Path) -> None:
    proc, sim = sim_run(tmp_path, "--sim-armed", "--resume", stdin="RESUME\n")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "interactive console" in proc.stdout and sim.core.rx_ok == 0


def test_carrier_only_launch_flag_never_streams_by_itself(tmp_path: Path) -> None:
    """Verifier F1 probe: ``--mode carrier_only`` (real mode) streamed DISARM at once. Now: nothing."""
    bridge = Listener()
    try:
        proc = run_cli("--headless", "--mode", "carrier_only", "--bridge", f"127.0.0.1:{bridge.port}",
                       "--no-api", "--no-log", "--mavlink-port", "0", "--config", str(tmp_path / "c.json"),
                       "--run-seconds", "1.5", stdin="NOCLIENT\n")
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "CARRIER-ONLY needs a typed confirmation on an interactive console" in proc.stdout
        assert bridge.count() == 0
    finally:
        bridge.close()


def test_config_error_exit_code(tmp_path: Path) -> None:
    cfg = tmp_path / "bad.json"
    cfg.write_text(json.dumps({"sender": {"rate_hz": 1000}}))
    proc = run_cli("--headless", "--config", str(cfg), "--no-api", "--no-log", "--run-seconds", "1")
    assert proc.returncode == 2 and "sender.rate_hz" in proc.stderr


def test_without_headless_is_a_usage_error() -> None:
    proc = run_cli()
    assert proc.returncode == 4 and "--headless" in proc.stderr


def test_instance_name_is_not_a_cli_flag() -> None:
    proc = run_cli("--headless", "--instance-name", "x")
    assert proc.returncode == 2 and "unrecognized arguments" in proc.stderr


def test_second_instance_refused(tmp_path: Path) -> None:
    name = f"vtol-gcs-test-{uuid.uuid4().hex}"
    with timing_win.SingleInstance(name):
        proc = run_cli("--headless", "--sim", "--config", str(tmp_path / "c.json"), "--no-api", "--no-log",
                       "--mavlink-port", "0", "--run-seconds", "1", instance=name)
    assert proc.returncode == 3 and "another GCS runtime is running" in proc.stderr


def test_status_line_formats_unknowns() -> None:
    s = {"app": {"mode": "fpv", "streaming": False},
         "bridge": {"state": "UNREACHABLE", "rtt_ms": None, "uplink_loss_pct": None, "send_jitter_ms_p99": None,
                    "camera": {"requested": True, "reported": None}},
         "controller": {"connected": False, "arm_switch_safe": None},
         "client": {"battery": {"voltage_v": None}, "flight_mode": {"raw": None}, "link": {"lq_pct": None}},
         "alarms": [{"id": "rc_stream_stopped"}]}
    line = status_line(s)
    assert "FPV STOPPED" in line and "UNREACHABLE" in line and "cam ON/--" in line and "ctl LOST" in line
    assert "alarms rc_stream_stopped" in line
