"""Control channel (WP08b brief R0): the UI process drives the RC sender only through guarded commands.

Runs a real :class:`Runtime` against ``bridge_sim`` on localhost with a :class:`ControlServer`, and
talks to it with :class:`ControlClient` exactly like the UI process does.  Every guard path
(RESUME + THROTTLE, NOCLIENT + LANDED, carrier-only with the radio ARMED, STOP, camera, crsf_pass)
is exercised through the channel.
"""

from __future__ import annotations

import contextlib
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
    """bridge_sim + Runtime + ControlServer + a client.  WP18 R1: every part is registered for shutdown as soon as
    it exists, so :meth:`close` (and a failure half-way through ``__init__``) stops exactly what was started, in
    reverse order, even if one of the stops raises."""

    def __init__(self, tmp: Path, telemetry_hz: float = 10.0, crsf_pass: bool = False, **server_kw: object) -> None:
        self._parts = contextlib.ExitStack()
        try:
            self.sim = BS.BridgeSim(BS.SimConfig(port=0, bridge=BS.BridgeConfig(boot_s=0.05, seed=1),
                                                 client=BS.ClientConfig(gps_fix_delay_s=0.0, seed=1),
                                                 telemetry_hz=telemetry_hz, crsf_pass=crsf_pass, seed=1))
            self._parts.callback(self.sim.stop)
            self.sim.start()
            cfg = Config()
            cfg.bridge.ip, cfg.bridge.port = self.sim.address
            cfg.api.enabled = False
            cfg.mavlink.enabled = False
            self.cfg = cfg
            self.fake = FakeController()
            self.rt = Runtime(cfg, self.fake, instance_name=f"vtol-gcs-test-{uuid.uuid4().hex}", log_dir=tmp)
            self._parts.callback(self.rt.stop)
            self.rt.start()
            self.stopped = False
            self.file = tmp / f"control-{uuid.uuid4().hex[:8]}.json"
            self.server = ControlServer(self.rt, self.file, on_stop=self._on_stop, **server_kw)  # type: ignore[arg-type]
            self._parts.callback(self.server.stop)
            self.server.start()
            self.client = ControlClient.from_file(self.file)
            self._parts.callback(self.client.close)
        except BaseException:
            self.close()
            raise

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
        """Stop everything started so far (idempotent)."""
        self._parts.close()


@pytest.fixture
def rig(tmp_path: Path):
    with contextlib.ExitStack() as made:                 # every rig is closed, even if a test fails or one close raises

        def make(**kw: object) -> Rig:
            r = Rig(tmp_path, **kw)
            made.callback(r.close)
            return r
        yield make


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

def _win_security() -> tuple:
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    adv = ctypes.WinDLL("advapi32", use_last_error=True)
    k32.CreateFileW.restype = wintypes.HANDLE
    k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
                                wintypes.DWORD, wintypes.HANDLE]
    k32.CloseHandle.argtypes = [wintypes.HANDLE]
    k32.LocalFree.argtypes = [ctypes.c_void_p]
    k32.GetCurrentProcess.restype = wintypes.HANDLE
    adv.GetSecurityInfo.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p),
                                    ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p,
                                    ctypes.POINTER(ctypes.c_void_p)]
    adv.ConvertSecurityDescriptorToStringSecurityDescriptorW.argtypes = [
        ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(wintypes.LPWSTR), ctypes.c_void_p]
    adv.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR)]
    adv.GetSecurityDescriptorControl.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.WORD),
                                                 ctypes.POINTER(wintypes.DWORD)]
    adv.GetAce.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p)]
    adv.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    adv.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
                                        ctypes.POINTER(wintypes.DWORD)]
    return ctypes, wintypes, k32, adv


def _sid_str(psid: int) -> str:
    """A SID as ``S-1-...`` (never an SDDL alias such as ``LA`` or ``BA``)."""
    ctypes, wintypes, k32, adv = _win_security()
    text = wintypes.LPWSTR()
    if not psid or not adv.ConvertSidToStringSidW(psid, ctypes.byref(text)):
        return "?"
    out = text.value
    k32.LocalFree(ctypes.cast(text, ctypes.c_void_p))
    return out


def _token_facts() -> dict:
    """WP18 R3 diagnostics: this process token's user, default owner, elevation, integrity and groups."""
    ctypes, wintypes, k32, adv = _win_security()
    token = wintypes.HANDLE()
    assert adv.OpenProcessToken(k32.GetCurrentProcess(), 0x0008, ctypes.byref(token)), ctypes.get_last_error()

    def info(cls: int) -> ctypes.Array:
        size = wintypes.DWORD(0)
        adv.GetTokenInformation(token, cls, None, 0, ctypes.byref(size))
        buf = ctypes.create_string_buffer(max(size.value, 4))
        assert adv.GetTokenInformation(token, cls, buf, len(buf), ctypes.byref(size)), (cls, ctypes.get_last_error())
        return buf
    try:
        ptr = ctypes.sizeof(ctypes.c_void_p)
        groups_buf = info(2)                                                     # TokenGroups
        count = ctypes.c_uint32.from_buffer(groups_buf).value
        groups = []
        for i in range(count):                                                   # SID_AND_ATTRIBUTES after the count
            off = ptr + i * 2 * ptr
            psid = ctypes.c_void_p.from_buffer(groups_buf, off).value
            attrs = ctypes.c_uint32.from_buffer(groups_buf, off + ptr).value
            groups.append(f"{_sid_str(psid)}{'' if attrs & 0x4 else ' (disabled)'}{' (owner ok)' if attrs & 0x8 else ''}")
        user, owner, integrity = info(1), info(4), info(25)       # TokenUser, TokenOwner, TokenIntegrityLevel
        return {"user": _sid_str(ctypes.c_void_p.from_buffer(user).value),
                "default_owner": _sid_str(ctypes.c_void_p.from_buffer(owner).value),
                "elevated": bool(ctypes.c_uint32.from_buffer(info(20)).value),          # TokenElevation
                "elevation_type": {1: "default", 2: "full", 3: "limited"}.get(
                    ctypes.c_uint32.from_buffer(info(18)).value, "?"),                   # TokenElevationType
                "integrity": _sid_str(ctypes.c_void_p.from_buffer(integrity).value),
                "session": ctypes.c_uint32.from_buffer(info(12)).value,                  # TokenSessionId
                "groups": groups}
    finally:
        k32.CloseHandle(token)


def _pipe_security(address: str) -> dict:
    """The pipe's owner and DACL, read back through a handle (GetSecurityInfo), decoded ACE by ACE."""
    ctypes, wintypes, k32, adv = _win_security()
    h = k32.CreateFileW(address, 0x00020000, 0, None, 3, 0, None)            # READ_CONTROL, OPEN_EXISTING
    assert h not in (None, wintypes.HANDLE(-1).value), ctypes.get_last_error()
    try:
        owner, dacl, sd = ctypes.c_void_p(), ctypes.c_void_p(), ctypes.c_void_p()
        err = adv.GetSecurityInfo(h, 6, 1 | 4, ctypes.byref(owner), None, ctypes.byref(dacl), None, ctypes.byref(sd))
        assert err == 0, f"GetSecurityInfo failed ({err})"                     # kernel object; OWNER | DACL
        try:
            text = wintypes.LPWSTR()
            assert adv.ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, 1 | 4, ctypes.byref(text), None)
            sddl = text.value
            k32.LocalFree(ctypes.cast(text, ctypes.c_void_p))
            control, rev = wintypes.WORD(), wintypes.DWORD()
            assert adv.GetSecurityDescriptorControl(sd, ctypes.byref(control), ctypes.byref(rev))
            aces = []
            if dacl.value:
                count = ctypes.c_uint16.from_address(dacl.value + 4).value      # ACL: rev, sbz1, size, AceCount
                for i in range(count):
                    ace = ctypes.c_void_p()
                    assert adv.GetAce(dacl, i, ctypes.byref(ace))
                    a = ace.value                                               # ACE_HEADER, Mask, SidStart
                    aces.append({"type": ctypes.c_uint8.from_address(a).value,
                                 "flags": ctypes.c_uint8.from_address(a + 1).value,
                                 "mask": ctypes.c_uint32.from_address(a + 4).value,
                                 "sid": _sid_str(a + 8)})
            return {"sddl": sddl, "owner": _sid_str(owner.value), "protected": bool(control.value & 0x1000),
                    "dacl_present": bool(dacl.value), "aces": aces}
        finally:
            k32.LocalFree(sd)
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
    """R1: explicit protected DACL (current user only) on the pipe; PIPE_REJECT_REMOTE_CLIENTS.

    WP18 R3: the DACL is checked ACE by ACE against the token's user SID, not as an SDDL string.  The SDDL text
    of the same DACL differs by account: Windows prints the built-in Administrator account (RID 500; the GitHub
    runner's elevated ``runneradmin`` is such an account) as the alias ``LA`` instead of its ``S-1-5-21-...-500``,
    so the old string comparison failed there although the DACL was right.  The owner is the token's default
    owner: the user, or ``BUILTIN\\Administrators`` for an elevated administrator token (Windows' rule for objects
    created without an explicit owner).  Either way no other account gets any access through the DACL.
    """
    from multiprocessing.connection import Listener
    from vtolgcs.control import current_user_sid
    r = rig()
    address = ControlInfo.load(r.file).address
    sec, token = _pipe_security(address), _token_facts()
    diag = f"pipe {sec}; token {token}"
    print(f"WP18 R3 diagnostics: {diag}")                                     # shown with the failure (captured)
    user = current_user_sid()
    assert token["user"] == user, diag
    assert sec["dacl_present"] and sec["protected"], diag                    # D:P (no inherited entries)
    assert sec["aces"] == [{"type": 0, "flags": 0, "mask": 0x1F01FF, "sid": user}], diag   # one ACE: user, FILE_ALL_ACCESS
    assert sec["owner"] == token["default_owner"], diag                      # the user, or Administrators if elevated
    assert r.client.call("ping")["t"] > 0                                    # the user still connects
    probe = Listener(r"\\.\pipe\vtol-gcs-probe-" + uuid.uuid4().hex[:8], family="AF_PIPE")   # stdlib default
    try:
        if not _remote_open(probe.address):
            pytest.skip("SMB loopback (\\\\127.0.0.1\\pipe) not available: cannot test the remote flag")
    finally:
        probe.close()
    assert not _remote_open(address), diag                                   # refused as a remote client
    assert r.client.call("ping")["t"] > 0


@pytest.mark.skipif(sys.platform != "win32", reason="SDDL is Windows only")
def test_sddl_text_of_the_builtin_administrator_is_an_alias() -> None:
    """WP18 R3, the cause of the runner-only failure, shown without elevation: the SDDL text of a protected DACL for
    the RID-500 account of this machine's account domain reads ``LA``, not the SID the old test expected."""
    import ctypes
    from vtolgcs.control import _security_descriptor, current_user_sid
    _, wintypes, k32, adv = _win_security()
    admin500 = current_user_sid().rsplit("-", 1)[0] + "-500"
    if not admin500.startswith("S-1-5-21-"):
        pytest.skip(f"not a local account SID: {admin500}")
    sd = _security_descriptor(f"D:P(A;;FA;;;{admin500})")
    text = wintypes.LPWSTR()
    assert adv.ConvertSecurityDescriptorToStringSecurityDescriptorW(ctypes.addressof(sd), 1, 4, ctypes.byref(text), None)
    try:
        assert text.value == "D:P(A;;FA;;;LA)"
    finally:
        k32.LocalFree(ctypes.cast(text, ctypes.c_void_p))


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


class _FakeClock:
    """The rate limit's clock in the tests below: time moves only when the test moves it."""

    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def test_rate_limit_refuses_the_excess_with_a_warning(rig, caplog, monkeypatch) -> None:
    """R3: beyond the per-connection rate the commands are refused (not executed, not queued), with a warning, and
    the refusals are paced too.  WP19: the bucket runs on a fake clock, so every count is exact.  The wall-clock
    version had a margin of about 10 ms, measured with ``time.monotonic`` (15.6 ms ticks on Windows), and failed
    once in a desktop run (WP18 verification round 2, finding 3)."""
    import logging
    clock = _FakeClock()
    r = rig(rate_per_s=20.0, rate_burst=5, rate_clock=clock)
    pauses: list[float] = []
    process = r.server._process

    def recording(raw: bytes, bucket: object, stats: dict) -> tuple:
        out = process(raw, bucket, stats)
        pauses.append(out[2])                                                   # the pause before the next read
        return out
    monkeypatch.setattr(r.server, "_process", recording)
    caplog.set_level(logging.WARNING, logger="vtolgcs.control")
    t0 = time.perf_counter()
    replies = [r.client.request("request_mode", mode="idle") for _ in range(15)]   # no time passes: no new token
    took = time.perf_counter() - t0
    assert [x.get("ok") for x in replies] == [True] * 5 + [False] * 10, replies     # exactly the burst ran
    assert all("rate limit" in x["error"] and "not executed" in x["error"] for x in replies[5:]), replies
    assert r.server.rate_limited == 10
    assert any("commands/s" in m for m in caplog.messages)
    # paced: after each refusal the server waits one token interval (50 ms) before it reads the next request.  Only a
    # lower bound on the real time (a busy machine makes it longer, never shorter); 10 % for timer granularity.
    assert pauses == [0.0] * 5 + [pytest.approx(0.05)] * 10, pauses
    assert took >= 0.9 * 9 * 0.05, took
    clock.t += 0.151                                                            # 3.02 token intervals later
    assert [r.client.request("request_mode", mode="idle")["ok"] for _ in range(4)] == [True, True, True, False]
    clock.t += 1.0
    assert r.client.request("ping")["ok"]                                       # the connection stays usable
    assert r.server.rate_limited == 11


def test_ui_load_is_never_rate_limited(rig) -> None:
    """The UI's own worst case (about 30 commands/s on one connection) stays below the default limit, also when its
    timers bunch up.  WP19: on a fake clock (10 s of UI time), so the result does not depend on the machine's speed;
    the old wall-clock version sent 45 commands, fewer than the burst of 50, so it could not have failed at all."""
    from vtolgcs.control import RATE_BURST, RATE_LIMIT_PER_S
    assert RATE_LIMIT_PER_S > 30 and RATE_BURST >= 30                          # sustained 30/s never drains the bucket
    clock = _FakeClock()
    r = rig(rate_clock=clock)
    for i in range(300):                                                        # a limit below 25/s fails here
        clock.t += 1 / 30
        assert r.client.request("inputs")["ok"], i
    clock.t += 1.0                                                              # a 1 s stall, then its backlog at once
    assert all(r.client.request("inputs")["ok"] for _ in range(30))
    assert r.server.rate_limited == 0


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
    for i in range(6):
        r = rig()
        try:                                      # WP18: one runtime at a time (six at once starved a small runner)
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
            threads = [threading.Thread(target=resume, name=f"resume-{i}"),
                       threading.Thread(target=stop, name=f"stop-{i}")]
            for t in threads:
                t.start()
            for t in threads:
                t.join(10)
            other.close()
            assert out.keys() == {"resume", "stop"}, f"iteration {i}: a request did not finish within 10 s: {out}"
            assert out["resume"] != out["stop"], out
            assert r.rt.sender.state().streaming == out["resume"] and r.stopped == out["stop"]
        finally:
            r.close()


def test_server_budget_bounds_the_work_of_many_connections(rig) -> None:
    """R3: however many connections flood, the server reads at most its budget (the rest waits in the pipes)."""
    import threading
    r = rig(rate_per_s=1000.0, rate_burst=1000, server_msgs_per_s=100.0)      # per-connection limit out of the way
    info = ControlInfo.load(r.file)
    clients = [ControlClient(info) for _ in range(4)]
    counts = [0] * 4
    t0 = time.perf_counter()                       # WP19: not monotonic (15.6 ms ticks on Windows)

    def flood(i: int) -> None:
        while time.perf_counter() - t0 < 1.5:
            assert clients[i].request("ping")["ok"]
            counts[i] += 1
    threads = [threading.Thread(target=flood, args=(i,), name=f"flood-{i}") for i in range(4)]
    try:
        for t in threads:
            t.start()
        for t in threads:
            t.join(10)
        elapsed = time.perf_counter() - t0
        assert sum(counts) <= 100 + 100 * elapsed + 4, (counts, elapsed)      # burst + rate
        assert min(counts) > 0                                               # every connection is served
    finally:
        for c in clients:
            c.close()
