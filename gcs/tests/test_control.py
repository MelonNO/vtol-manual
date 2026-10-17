"""Control channel (WP08b brief R0): the UI process drives the RC sender only through guarded commands.

Runs a real :class:`Runtime` against ``bridge_sim`` on localhost with a :class:`ControlServer`, and
talks to it with :class:`ControlClient` exactly like the UI process does.  Every guard path
(RESUME + THROTTLE, NOCLIENT + LANDED, carrier-only with the radio ARMED, STOP, camera, crsf_pass)
is exercised through the channel.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Callable

import pytest

import bridge_sim as BS
from vtolgcs import crsf, protocol
from vtolgcs.config import Config
from vtolgcs.control import (ControlClient, ControlError, ControlInfo, ControlServer, EventStream,
                             write_private_file)
from vtolgcs.controller import FakeController
from vtolgcs.runtime import Runtime


class Rig:
    def __init__(self, tmp: Path, telemetry_hz: float = 10.0, crsf_pass: bool = False, **server_kw: object) -> None:
        self.sim = BS.BridgeSim(BS.SimConfig(port=0, bridge=BS.BridgeConfig(boot_s=0.05, seed=1),
                                             client=BS.ClientConfig(gps_fix_delay_s=0.0, seed=1),
                                             telemetry_hz=telemetry_hz, crsf_pass=crsf_pass, seed=1)).start()
        cfg = Config()
        cfg.bridge.ip, cfg.bridge.port = self.sim.address
        cfg.api.enabled = False
        cfg.mavlink.enabled = False
        self.cfg = cfg
        self.fake = FakeController()
        self.rt = Runtime(cfg, self.fake, instance_name=f"vtol-gcs-test-{uuid.uuid4().hex}", log_dir=tmp)
        self.rt.start()
        self.stopped = False
        self.file = tmp / f"control-{uuid.uuid4().hex[:8]}.json"
        self.server = ControlServer(self.rt, self.file, on_stop=self._on_stop, **server_kw).start()  # type: ignore[arg-type]
        self.client = ControlClient.from_file(self.file)

    def _on_stop(self) -> None:
        self.stopped = True

    def rx_ok(self) -> int:
        with self.sim.lock:
            return self.sim.core.rx_ok

    def expect(self, cond: Callable[[], bool], what: str, timeout: float = 8.0) -> None:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if cond():
                return
            time.sleep(0.02)
        raise AssertionError(f"timed out waiting for {what}: sender {self.rt.sender.state()}")

    def close(self) -> None:
        self.client.close()
        self.server.stop()
        self.rt.stop()
        self.sim.stop()


@pytest.fixture
def rig(tmp_path: Path):
    made: list[Rig] = []

    def make(**kw: object) -> Rig:
        r = Rig(tmp_path, **kw)
        made.append(r)
        return r
    yield make
    for r in made:
        r.close()


# --------------------------------------------------------------------------- transport and file

def test_control_file_is_private_and_removed_on_stop(rig) -> None:
    r = rig()
    info = ControlInfo.load(r.file)
    assert len(info.token) == 64 and info.pid > 0
    if sys.platform == "win32":
        assert info.family == "AF_PIPE" and str(info.address).startswith("\\\\.\\pipe\\vtol-gcs-ctl-")
        acl = subprocess.run(["icacls", str(r.file)], capture_output=True, text=True, timeout=30).stdout
        entries = [line for line in acl.splitlines() if ":(" in line]
        assert len(entries) == 1, acl                                # one entry: the current user
        assert "Everyone" not in acl and "BUILTIN\\Users" not in acl and "Administrators" not in acl
    r.server.stop()
    assert not r.file.exists()
    with pytest.raises(ControlError):
        ControlClient(info, timeout=1).call("ping")


def test_wrong_token_is_refused(rig) -> None:
    r = rig()
    info = ControlInfo.load(r.file)
    forged = ControlInfo(info.family, info.address, "00" * 32, info.pid, info.api)
    with pytest.raises(ControlError):
        ControlClient(forged, timeout=2).call("ping")
    assert r.client.call("ping")["t"] > 0                            # the real one still works


def test_write_private_file_replaces_atomically(tmp_path: Path) -> None:
    path = tmp_path / "x" / "f.json"
    write_private_file(path, "one")
    write_private_file(path, "two")
    assert path.read_text(encoding="utf-8") == "two" and len(list(path.parent.iterdir())) == 1


def test_hello_status_and_unknown_commands(rig) -> None:
    r = rig()
    hello = r.client.call("hello")
    assert hello["app"] == "vtol-gcs" and hello["control_version"] == 1
    assert r.client.call("status")["app"]["mode"] == "idle"
    assert "unknown command" in r.client.request("rm_rf")["error"]
    assert "unknown command" in r.client.request("_refused")["error"]          # no private methods
    assert r.client.request("request_mode", mode="warp")["ok"] is False


# --------------------------------------------------------------------------- normal start, stop

def test_normal_start_and_idle_through_the_channel(rig) -> None:
    r = rig()
    assert r.client.request("request_mode", mode="fpv")["ok"]
    r.expect(lambda: r.rt.status()["bridge"]["state"] == "RUN", "RUN")
    assert r.client.request("request_mode", mode="idle")["ok"]
    assert not r.rt.sender.state().streaming


def test_normal_start_interlock_applies(rig) -> None:
    r = rig()
    r.fake.set_channel_us(5, 2000)                                      # arm switch ARMED
    reply = r.client.request("request_mode", mode="fpv")
    assert not reply["ok"] and any("RESUME" in x for x in reply["reasons"])
    time.sleep(0.2)
    assert r.rx_ok() == 0


def test_carrier_only_cannot_be_requested_as_a_mode(rig) -> None:
    r = rig()
    assert not r.client.request("request_mode", mode="carrier_only")["ok"]
    time.sleep(0.2)
    assert r.rx_ok() == 0


def test_stop_needs_typed_stop_while_streaming(rig) -> None:
    r = rig()
    assert r.client.request("request_mode", mode="fpv")["ok"]
    reply = r.client.request("stop")
    assert not reply["ok"] and "STOP" in reply["reasons"][0] and not r.stopped
    assert not r.client.request("stop", typed="stop")["ok"] and not r.stopped
    assert r.client.request("stop", typed="STOP")["ok"] and r.stopped
    r2 = rig()
    assert r2.client.request("stop")["ok"] and r2.stopped               # idle: no confirmation needed


# --------------------------------------------------------------------------- RESUME (client airborne)

def test_resume_needs_the_typed_words(rig) -> None:
    r = rig()
    r.fake.set_channel_us(5, 2000)                                      # pilot holds ARMED
    r.fake.set_channel_us(3, 988)                                       # throttle at minimum
    prev = r.client.call("prepare_resume")
    assert prev["ok"] and prev["needs_throttle_confirm"] and "2000 us (ARMED)" in prev["text"]
    for typed in (None, "", "resume", "RESUMEX", "OK"):
        reply = r.client.request("confirm_resume", token=prev["token"], typed=typed, throttle_typed="THROTTLE")
        assert not reply["ok"], typed
    reply = r.client.request("confirm_resume", token=prev["token"], typed="RESUME")
    assert not reply["ok"] and "throttle at minimum" in reply["reasons"][0]
    reply = r.client.request("confirm_resume", token=prev["token"] + 7, typed="RESUME", throttle_typed="THROTTLE")
    assert not reply["ok"]                                              # forged token
    time.sleep(0.2)
    assert r.rx_ok() == 0                                               # nothing sent so far
    reply = r.client.request("confirm_resume", token=prev["token"], typed=" RESUME\n", throttle_typed="THROTTLE")
    assert reply["ok"], reply
    r.expect(lambda: r.rt.status()["app"]["start_path"] == "resume", "resume stream")


def test_resume_refused_with_switch_safe(rig) -> None:
    r = rig()
    prev = r.client.call("prepare_resume")
    assert not prev["ok"] and "SAFE" in prev["problems"][0]
    assert not r.client.request("confirm_resume", token=prev["token"], typed="RESUME")["ok"]


# --------------------------------------------------------------------------- carrier-only (DISARM)

def test_carrier_only_needs_noclient_and_landed(rig) -> None:
    r = rig(telemetry_hz=0)                                            # no client heard
    prev = r.client.call("prepare_carrier_only")
    assert prev["ok"] and "UNKNOWN since app start" in prev["text"] and not prev["needs_landed_confirm"]
    assert not r.client.request("confirm_carrier_only", token=prev["token"], typed="noclient")["ok"]
    prev = r.client.call("prepare_carrier_only")
    assert r.client.request("confirm_carrier_only", token=prev["token"], typed="NOCLIENT")["ok"]
    r.expect(lambda: r.rt.sender.state().mode.value == "carrier_only" and r.rx_ok() > 0, "carrier-only")
    assert r.client.request("request_mode", mode="idle")["ok"]
    assert r.client.request("request_mode", mode="fpv")["ok"]
    assert r.client.request("request_mode", mode="idle")["ok"]
    prev = r.client.call("prepare_carrier_only")
    assert prev["needs_landed_confirm"]
    reply = r.client.request("confirm_carrier_only", token=prev["token"], typed="NOCLIENT")
    assert not reply["ok"] and "LANDED" in reply["reasons"][0]
    prev = r.client.call("prepare_carrier_only")
    assert r.client.request("confirm_carrier_only", token=prev["token"], typed="NOCLIENT",
                            landed_typed="LANDED")["ok"]


def test_carrier_only_refused_with_radio_armed(rig) -> None:
    r = rig(telemetry_hz=0)
    r.fake.set_channel_us(5, 2000)
    prev = r.client.call("prepare_carrier_only")
    assert not prev["ok"] and "ARMED" in prev["problems"][0]
    assert not r.client.request("confirm_carrier_only", token=prev["token"], typed="NOCLIENT")["ok"]
    time.sleep(0.2)
    assert r.rx_ok() == 0


def test_carrier_only_refused_while_client_heard(rig) -> None:
    r = rig()
    assert r.client.request("request_mode", mode="fpv")["ok"]
    r.expect(lambda: r.rt.telemetry.heard_age_s() is not None, "client telemetry")
    assert r.client.request("request_mode", mode="idle")["ok"]
    prev = r.client.call("prepare_carrier_only")
    assert not prev["ok"] and "heard" in prev["problems"][0]


# --------------------------------------------------------------------------- camera, events, misc

def test_camera_round_trip_and_interlock(rig) -> None:
    r = rig()
    assert r.client.request("request_mode", mode="fpv")["ok"]
    r.expect(lambda: r.rt.status()["bridge"]["state"] == "RUN", "RUN")
    assert r.client.request("set_camera", on=True)["ok"]
    r.expect(lambda: r.rt.status()["bridge"]["camera"]["reported"] is True, "camera read-back ON")
    assert r.client.request("set_camera", on=False)["ok"]
    r.fake.set_channel_us(5, 2000)                                      # client may be armed
    reply = r.client.request("set_camera", on=True)
    assert not reply["ok"] and reply["reasons"]
    assert r.client.request("set_camera", on="yes")["ok"] is False


def test_event_stream_and_flight_mode_events(rig) -> None:
    r = rig()
    stream = EventStream(ControlInfo.load(r.file))
    try:
        assert r.client.request("request_mode", mode="fpv")["ok"]
        kinds: set[str] = set()
        end = time.monotonic() + 8
        while time.monotonic() < end and not {"mode", "bridge_state", "client_flight_mode"} <= kinds:
            ev = stream.get(0.5)
            if ev:
                kinds.add(ev["event"])
                assert isinstance(ev["t"], float)
        assert {"mode", "bridge_state", "client_flight_mode"} <= kinds, kinds
    finally:
        stream.close()


def test_runtime_gone_is_detected(rig) -> None:
    r = rig()
    stream = EventStream(ControlInfo.load(r.file))
    r.server.stop()
    with pytest.raises(ControlError):
        for _ in range(10):
            stream.get(0.5)
    with pytest.raises(ControlError):
        r.client.call("ping")


def test_inputs_video_profile_and_log(rig, tmp_path: Path) -> None:
    r = rig()
    inp = r.client.call("inputs")
    assert inp["connected"] and inp["arm_channel"] == 5 and len(inp["channels_us"]) == 16
    assert r.rt.status()["video"]["rx_kbps"] is None
    assert r.client.request("video_report", rx_kbps=2500.0)["ok"]
    assert r.rt.status()["video"]["rx_kbps"] == 2500.0
    assert not r.client.request("video_report", rx_kbps=-1)["ok"]
    assert r.client.request("set_client_profile", profile_id="c1", cells=4)["ok"]
    assert r.rt.status()["client"]["profile_id"] == "c1" and r.cfg.client.cells == 4
    assert not r.client.request("set_client_profile", profile_id="c1", cells=40)["ok"]
    assert r.client.request("log", type="test_rtt", fields={"mean_ms": 3.2})["ok"]
    assert not r.client.request("log", type="mode", fields={"mode": "fpv"})["ok"]     # no forged records
    r.rt.stop()
    recs = [json.loads(x) for p in tmp_path.glob("session-*.jsonl") for x in p.read_text().splitlines()]
    assert any(x["type"] == "test_rtt" and x["mean_ms"] == 3.2 for x in recs)


def test_crsf_send_guards(rig) -> None:
    r = rig(crsf_pass=True)
    ping = crsf.build_device_ping().hex()
    reply = r.client.request("crsf_send", frame=ping)
    assert not reply["ok"] and "no RC stream" in reply["reasons"][0]          # bridge answers streamers only
    assert r.client.request("request_mode", mode="fpv")["ok"]
    r.expect(lambda: r.rt.status()["bridge"]["state"] == "RUN", "RUN")
    assert r.client.request("crsf_send", frame=ping)["ok"]
    assert not r.client.request("crsf_send", frame="00112233")["ok"]           # not CRSF
    rc = crsf.build_rc_channels_frame([992] * 16).hex()
    assert "not allowed" in r.client.request("crsf_send", frame=rc)["reasons"][0]
    write = crsf.build_param_write(1, b"\x01").hex()
    r.fake.set_channel_us(5, 2000)                                      # client may be armed
    reply = r.client.request("crsf_send", frame=write)
    assert not reply["ok"] and "armed" in reply["reasons"][0]
    r.fake.set_channel_us(5, 988)
    r.expect(lambda: r.rt.client_may_be_armed() == [], "client disarmed in telemetry")
    assert r.client.request("crsf_send", frame=write)["ok"]
    assert r.sim.core.crsf_tx > 0 and protocol.CRSF_PASS_MAGIC == b"RP"


# --------------------------------------------------------------------------- hardening (WP13)

def _pipe_sddl(address: str) -> str:
    """The pipe's DACL as SDDL, read back through a handle (GetSecurityInfo)."""
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    adv = ctypes.WinDLL("advapi32", use_last_error=True)
    k32.CreateFileW.restype = wintypes.HANDLE
    k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
                                wintypes.DWORD, wintypes.HANDLE]
    k32.CloseHandle.argtypes = [wintypes.HANDLE]
    k32.LocalFree.argtypes = [ctypes.c_void_p]
    adv.GetSecurityInfo.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p,
                                    ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    adv.ConvertSecurityDescriptorToStringSecurityDescriptorW.argtypes = [
        ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(wintypes.LPWSTR), ctypes.c_void_p]
    h = k32.CreateFileW(address, 0x00020000, 0, None, 3, 0, None)            # READ_CONTROL, OPEN_EXISTING
    assert h not in (None, wintypes.HANDLE(-1).value), ctypes.get_last_error()
    try:
        sd = ctypes.c_void_p()
        assert adv.GetSecurityInfo(h, 6, 4, None, None, None, None, ctypes.byref(sd)) == 0   # kernel object, DACL
        text = wintypes.LPWSTR()
        assert adv.ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, 4, ctypes.byref(text), None)
        out = text.value
        k32.LocalFree(sd)
        return out
    finally:
        k32.CloseHandle(h)


def _remote_open(address: str) -> bool:
    """Open the pipe through the SMB redirector (``\\\\127.0.0.1\\pipe\\...``), i.e. as a remote client."""
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateFileW.restype = wintypes.HANDLE
    k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
                                wintypes.DWORD, wintypes.HANDLE]
    k32.CloseHandle.argtypes = [wintypes.HANDLE]
    h = k32.CreateFileW(address.replace("\\\\.\\", "\\\\127.0.0.1\\"), 0xC0000000, 0, None, 3, 0, None)
    if h in (None, wintypes.HANDLE(-1).value):
        return False
    k32.CloseHandle(h)
    return True


@pytest.mark.skipif(sys.platform != "win32", reason="named pipes are Windows only")
def test_pipe_dacl_is_user_only_and_remote_clients_are_rejected(rig) -> None:
    """R1: explicit protected DACL (current user only) on the pipe; PIPE_REJECT_REMOTE_CLIENTS."""
    from multiprocessing.connection import Listener
    from vtolgcs.control import current_user_sid
    r = rig()
    address = ControlInfo.load(r.file).address
    sddl = _pipe_sddl(address)
    assert sddl == f"D:P(A;;FA;;;{current_user_sid()})", sddl                # no Everyone, Anonymous, Admins
    assert r.client.call("ping")["t"] > 0                                    # the user still connects
    probe = Listener(r"\\.\pipe\vtol-gcs-probe-" + uuid.uuid4().hex[:8], family="AF_PIPE")   # stdlib default
    try:
        if not _remote_open(probe.address):
            pytest.skip("SMB loopback (\\\\127.0.0.1\\pipe) not available: cannot test the remote flag")
    finally:
        probe.close()
    assert not _remote_open(address)                                         # refused as a remote client
    assert r.client.call("ping")["t"] > 0


def test_stalled_handshake_does_not_block_a_second_client(rig) -> None:
    """R2: a client that connects but never answers the challenge neither blocks others nor stays."""
    from multiprocessing.connection import Client
    # A long handshake timeout leaves a wide margin on a loaded CI runner (WP10 R10b): the second client must be
    # served well before the stalled one times out, so "not blocked" is still told apart from "served after it".
    r = rig(handshake_timeout_s=5.0)
    info = ControlInfo.load(r.file)
    stalled = Client(info.address, family=info.family)                        # no authkey: never answers
    try:
        t0 = time.monotonic()
        legit = ControlClient(info, timeout=6.0)
        assert legit.call("ping")["t"] > 0
        served_s = time.monotonic() - t0
        assert served_s < 4.0, f"second client served after {served_s:.2f} s"  # not after the stalled timeout
        legit.close()
        stalled.recv_bytes()                                                  # the challenge
        with pytest.raises((EOFError, OSError)):                              # then closed by the server
            end = time.monotonic() + 12.0
            while time.monotonic() < end:
                if stalled.poll(0.2):
                    stalled.recv_bytes()
        r.expect(lambda: r.server.handshake_failures == 1, "handshake timeout counted")
    finally:
        stalled.close()
    assert r.client.call("ping")["t"] > 0


def test_many_stalled_handshakes_time_out_and_free_their_slots(rig) -> None:
    from multiprocessing.connection import Client
    from vtolgcs.control import MAX_PENDING
    r = rig(handshake_timeout_s=0.5)
    info = ControlInfo.load(r.file)
    stalled = [Client(info.address, family=info.family) for _ in range(MAX_PENDING + 2)]
    try:
        r.expect(lambda: r.server.handshake_failures >= MAX_PENDING, "stalled handshakes timed out", 5.0)
        # WP17: a slot is freed just after its failure is counted (finally: _pending -= 1); connecting in between
        # was refused as "all slots busy" (EOFError) - seen once in a CI-like run with the non-venv Python
        r.expect(lambda: r.server._pending == 0, "their slots were freed", 5.0)
        assert ControlClient(info, timeout=2.0).call("ping")["t"] > 0
    finally:
        for c in stalled:
            c.close()


def test_rate_limit_unit() -> None:
    from vtolgcs.control import RateLimit
    t = [0.0]
    b = RateLimit(rate=10, burst=3, clock=lambda: t[0])
    assert [b.take() for _ in range(4)] == [True, True, True, False]
    assert b.wait_s() == pytest.approx(0.1)
    t[0] = 0.1
    assert b.take() and not b.take()
    t[0] = 10.0
    assert sum(b.take() for _ in range(10)) == 3                             # never more than the burst


def test_rate_limit_refuses_the_excess_with_a_warning(rig, caplog) -> None:
    """R3: beyond the per-connection rate the commands are refused (not executed, not queued)."""
    import logging
    r = rig(rate_per_s=20.0, rate_burst=5)
    caplog.set_level(logging.WARNING, logger="vtolgcs.control")
    t0 = time.monotonic()
    replies = [r.client.request("request_mode", mode="idle") for _ in range(30)]   # ids are checked per reply
    elapsed = time.monotonic() - t0
    done = [x for x in replies if x.get("ok")]
    limited = [x for x in replies if "rate limit" in str(x.get("error"))]
    assert len(done) + len(limited) == 30 and limited
    assert len(done) <= 5 + 20 * elapsed + 1
    assert len(limited) <= 20 * elapsed + 1                                  # refusals are paced too
    assert any("commands/s" in m for m in caplog.messages)
    assert r.server.rate_limited == len(limited)
    time.sleep(0.3)
    assert r.client.request("ping")["ok"]                                     # the connection stays usable


def test_ui_load_is_never_rate_limited(rig) -> None:
    """The UI's own worst case (about 30 commands/s on one connection) stays below the default limit."""
    r = rig()
    replies = []
    for _ in range(45):
        replies.append(r.client.request("inputs"))
        time.sleep(1 / 30)
    assert all(x["ok"] for x in replies) and r.server.rate_limited == 0


def test_nothing_changes_after_an_accepted_stop(rig) -> None:
    """R4, the verifier's reproduction: stop (idle) then an immediate RESUME must be refused."""
    r = rig()
    r.fake.set_channel_us(5, 2000)                                      # pilot holds ARMED
    r.fake.set_channel_us(3, 1400)
    prev = r.client.call("prepare_resume")
    assert prev["ok"]
    assert r.client.request("stop")["ok"] and r.stopped                 # idle: no word needed
    reply = r.client.request("confirm_resume", token=prev["token"], typed="RESUME")
    assert not reply["ok"] and "stop was accepted" in reply["reasons"][0]
    assert not r.client.request("prepare_resume")["ok"]
    assert not r.client.request("request_mode", mode="fpv")["ok"]
    assert not r.client.request("set_camera", on=True)["ok"]
    assert not r.client.request("crsf_send", frame=crsf.build_device_ping().hex())["ok"]
    assert r.client.request("request_mode", mode="idle")["ok"]
    assert r.client.request("stop")["ok"]                                # repeated stop: harmless
    assert not r.rt.sender.state().streaming
    time.sleep(0.2)
    assert r.rx_ok() == 0


def test_concurrent_stop_and_resume_from_two_clients(rig) -> None:
    """R4: two connections race a stop (no word) and a RESUME: exactly one wins, every time."""
    import threading
    for _ in range(6):
        r = rig()
        r.fake.set_channel_us(5, 2000)
        r.fake.set_channel_us(3, 1400)
        other = ControlClient.from_file(r.file)
        prev = r.client.call("prepare_resume")
        go = threading.Barrier(2)
        out: dict[str, bool] = {}

        def resume() -> None:
            go.wait()
            out["resume"] = r.client.request("confirm_resume", token=prev["token"], typed="RESUME")["ok"]

        def stop() -> None:
            go.wait()
            out["stop"] = other.request("stop")["ok"]
        threads = [threading.Thread(target=resume), threading.Thread(target=stop)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(10)
        other.close()
        assert out["resume"] != out["stop"], out
        assert r.rt.sender.state().streaming == out["resume"] and r.stopped == out["stop"]


def test_server_budget_bounds_the_work_of_many_connections(rig) -> None:
    """R3: however many connections flood, the server reads at most its budget (the rest waits in the pipes)."""
    import threading
    r = rig(rate_per_s=1000.0, rate_burst=1000, server_msgs_per_s=100.0)      # per-connection limit out of the way
    info = ControlInfo.load(r.file)
    clients = [ControlClient(info) for _ in range(4)]
    counts = [0] * 4
    t0 = time.monotonic()

    def flood(i: int) -> None:
        while time.monotonic() - t0 < 1.5:
            assert clients[i].request("ping")["ok"]
            counts[i] += 1
    threads = [threading.Thread(target=flood, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    elapsed = time.monotonic() - t0
    assert sum(counts) <= 100 + 100 * elapsed + 4, (counts, elapsed)          # burst + rate
    assert min(counts) > 0                                                   # every connection is served
    for c in clients:
        c.close()
