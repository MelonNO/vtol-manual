"""``python -m vtolgcs --headless --sim`` as a real process against the simulator (brief R12)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import bridge_sim as BS
from vtolgcs import timing_win
from vtolgcs.__main__ import status_line
from vtolgcs.protocol import BridgeState

GCS_DIR = Path(__file__).resolve().parents[1]


def run_cli(*args: str, timeout: float = 30, stdin: str = "") -> subprocess.CompletedProcess:
    env = dict(os.environ, PYTHONPATH=str(GCS_DIR), PYTHONIOENCODING="utf-8")
    return subprocess.run([sys.executable, "-m", "vtolgcs", *args], capture_output=True, text=True,
                          timeout=timeout, env=env, cwd=GCS_DIR, input=stdin)


def sim_run(tmp_path: Path, *args: str, stdin: str = "") -> tuple[subprocess.CompletedProcess, "BS.BridgeSim"]:
    sim = BS.BridgeSim(BS.SimConfig(port=0, bridge=BS.BridgeConfig(boot_s=0.05, seed=1),
                                    client=BS.ClientConfig(gps_fix_delay_s=0.0, seed=1), seed=1)).start()
    try:
        proc = run_cli("--headless", "--sim", "--bridge", f"127.0.0.1:{sim.address[1]}", "--no-api",
                       "--mavlink-port", "0", "--config", str(tmp_path / "cfg.json"), "--log-dir", str(tmp_path),
                       "--run-seconds", "2", "--instance-name", f"vtol-gcs-test-{uuid.uuid4().hex}", *args,
                       stdin=stdin)
    finally:
        sim.stop()
    return proc, sim


def test_restart_with_switch_armed_comes_up_idle(tmp_path: Path) -> None:
    proc, sim = sim_run(tmp_path, "--sim-armed")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert sim.core.rx_ok == 0 and "idle" in proc.stdout.lower()          # never auto-resume


def test_cli_resume_with_typed_confirmation(tmp_path: Path) -> None:
    proc, sim = sim_run(tmp_path, "--sim-armed", "--resume", stdin="RESUME\n")
    out = proc.stdout
    assert proc.returncode == 0, out + proc.stderr
    assert "live values: CH5 arm = 2012 us (ARMED), CH3 throttle = 1500 us" in out
    assert out.index("live values") < out.index("RESUME started")
    assert sim.core.visited(BridgeState.RUN) and sim.core.last_rc.channels[4] == 1811


def test_cli_resume_cancelled_sends_nothing(tmp_path: Path) -> None:
    proc, sim = sim_run(tmp_path, "--sim-armed", "--resume", stdin="yes\n")
    assert proc.returncode == 0 and "RESUME cancelled - nothing sent" in proc.stdout
    assert sim.core.rx_ok == 0


def test_cli_resume_refused_with_switch_safe(tmp_path: Path) -> None:
    proc, sim = sim_run(tmp_path, "--resume", stdin="RESUME\n")
    assert "RESUME not possible" in proc.stdout and sim.core.rx_ok == 0


def test_headless_sim_streams_then_failsafe_on_exit(tmp_path: Path) -> None:
    sim = BS.BridgeSim(BS.SimConfig(port=0, bridge=BS.BridgeConfig(boot_s=0.05, seed=1),
                                    client=BS.ClientConfig(gps_fix_delay_s=0.0, seed=1), seed=1)).start()
    try:
        port = sim.address[1]
        proc = run_cli("--headless", "--sim", "--bridge", f"127.0.0.1:{port}", "--api-port", "0",
                       "--mavlink-port", "0", "--config", str(tmp_path / "cfg.json"), "--log-dir", str(tmp_path),
                       "--run-seconds", "3", "--instance-name", f"vtol-gcs-test-{uuid.uuid4().hex}")
        out = proc.stdout
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "[SIM]" in out and "bridge RUN" in out, out
        assert "FPV" in out
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
        types = {json.loads(line)["type"] for line in logs[0].read_text(encoding="utf-8").splitlines()}
        assert {"session_start", "mode", "status", "session_end"} <= types
    finally:
        sim.stop()


def test_config_error_exit_code(tmp_path: Path) -> None:
    cfg = tmp_path / "bad.json"
    cfg.write_text(json.dumps({"sender": {"rate_hz": 1000}}))
    proc = run_cli("--headless", "--config", str(cfg), "--no-api", "--no-log", "--run-seconds", "1")
    assert proc.returncode == 2 and "sender.rate_hz" in proc.stderr


def test_without_headless_is_a_usage_error() -> None:
    proc = run_cli()
    assert proc.returncode == 4 and "--headless" in proc.stderr


def test_second_instance_refused(tmp_path: Path) -> None:
    name = f"vtol-gcs-test-{uuid.uuid4().hex}"
    with timing_win.SingleInstance(name):
        proc = run_cli("--headless", "--sim", "--config", str(tmp_path / "c.json"), "--no-api", "--no-log",
                       "--mavlink-port", "0", "--run-seconds", "1", "--instance-name", name)
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
