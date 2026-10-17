"""ELRS menu (brief R5/R6/R9) against the extended ``bridge_sim`` tree, through the real path:
menu -> control channel ``crsf_send`` -> RC sender ``crsf_pass`` -> simulator -> ``crsf_fwd`` -> event -> menu.
"""

from __future__ import annotations

import contextlib
import threading
import time
import uuid
from pathlib import Path

import pytest

import bridge_sim as BS
from vtolgcs import crsf
from vtolgcs.config import Config
from vtolgcs.control import ControlClient, ControlError, ControlInfo, ControlServer, EventStream
from vtolgcs.controller import FakeController
from vtolgcs.crsf_menu import (NOT_SUPPORTED, VRX_FOLLOW_TEXT, CrsfMenu, MenuError, NotSupported, VrxFollow, VtxAdmin,
                               control_send, display_value)
from vtolgcs.runtime import Runtime


class MenuRig:
    def __init__(self, tmp: Path, crsf_pass: bool = True, vrx_follows: bool = True) -> None:
        self._parts = contextlib.ExitStack()           # WP18 R1: stop what was started, also after a failure
        try:
            self.sim = BS.BridgeSim(BS.SimConfig(
                port=0, bridge=BS.BridgeConfig(boot_s=0.05, seed=1, report_video="PAL"),
                client=BS.ClientConfig(gps_fix_delay_s=0.0, seed=1), crsf_pass=crsf_pass, module="elrs",
                vrx_follows=vrx_follows, seed=1))
            self._parts.callback(self.sim.stop)
            self.sim.start()
            cfg = Config()
            cfg.bridge.ip, cfg.bridge.port = self.sim.address
            cfg.api.enabled = cfg.mavlink.enabled = False
            cfg.video.status_bits_min_fw_ver = 0      # trust the sim's decoder-lock bit
            self.fake = FakeController()
            self.rt = Runtime(cfg, self.fake, instance_name=f"vtol-gcs-test-{uuid.uuid4().hex}", log_dir=tmp)
            self._parts.callback(self.rt.stop)
            self.rt.start()
            self.server = ControlServer(self.rt, tmp / "control.json")
            self._parts.callback(self.server.stop)
            self.server.start()
            info = ControlInfo.load(tmp / "control.json")
            self.client = ControlClient(info)
            self._parts.callback(self.client.close)
            self.menu = CrsfMenu(control_send(self.client), timeout_s=0.3, retries=2)
            self.stream = EventStream(info)
            self._parts.callback(self.stream.close)
            self._stop = threading.Event()
            pump = threading.Thread(target=self._pump, name="menu-pump", daemon=True)
            self._parts.callback(lambda: pump.join(2))
            self._parts.callback(self._stop.set)
            pump.start()
        except BaseException:
            self.close()
            raise

    def _pump(self) -> None:                         # what the UI's event thread does
        while not self._stop.is_set():
            try:
                ev = self.stream.get(0.2)
            except ControlError:
                return
            if ev and ev["event"] == "crsf":
                self.menu.feed(bytes.fromhex(ev["data"]["frame"]))

    def stream_fpv(self) -> None:
        assert self.client.request("request_mode", mode="fpv")["ok"]
        end = time.monotonic() + 8
        while self.rt.status()["bridge"]["state"] != "RUN":
            assert time.monotonic() < end, "bridge RUN"
            time.sleep(0.02)

    def close(self) -> None:
        self._parts.close()


@pytest.fixture
def menu_rig(tmp_path: Path):
    with contextlib.ExitStack() as made:              # WP18 R1: every rig closed, also when a test fails

        def make(**kw: object) -> MenuRig:
            r = MenuRig(tmp_path, **kw)
            made.callback(r.close)
            return r
        yield make


def test_menu_needs_a_stream(menu_rig) -> None:
    r = menu_rig()
    with pytest.raises(MenuError, match="no RC stream"):
        r.menu.ping()


def test_not_supported_by_bridge_firmware(menu_rig) -> None:
    r = menu_rig(crsf_pass=False)                     # bridge without Q7a: crsf_pass ignored
    r.stream_fpv()
    with pytest.raises(NotSupported) as err:
        r.menu.ping()
    assert str(err.value) == NOT_SUPPORTED == "Not supported by bridge firmware (Q7a)"


def test_tree_read_write_and_commands(menu_rig) -> None:
    r = menu_rig()
    r.stream_fpv()
    tree = r.menu.load_tree()
    assert tree.device.name == "SIM ELRS TX (tree)" and tree.device.field_count == 15 and not tree.missing
    rate = tree.params[1]
    assert len(rate.options) == 10 and len(crsf.encode_parameter_entry(rate)) > crsf.PARAM_CHUNK_MAX  # multi-chunk
    rows = [(d, e.name) for d, _, e in tree.rows()]
    assert (0, "TX Power") in rows and (1, "Max Power") in rows and (1, "Band") in rows
    assert all(name != "Hidden diag" for _, name in rows)                              # hidden skipped
    assert display_value(tree.params[4]) == "25mW"

    fresh = r.menu.write(4, 3)                                                          # Max Power 250 mW
    assert fresh.value == 3 and r.sim.module.params[4].value == 3
    with pytest.raises(MenuError):
        r.menu.write(4, 9)                                                              # outside min..max

    bind = r.menu.command(12)
    assert bind.value == crsf.CommandStep.ASK_CONFIRM and "Bind?" in bind.info
    assert r.menu.command(12, crsf.CommandStep.CANCEL).value == crsf.CommandStep.IDLE


def test_writes_refused_while_client_may_be_armed(menu_rig) -> None:
    r = menu_rig()
    r.stream_fpv()
    r.menu.load_tree()
    r.fake.set_channel_us(5, 2000)                                                      # arm switch ARMED
    with pytest.raises(MenuError, match="armed"):
        r.menu.write(4, 0)
    assert r.sim.module.params[4].value == 1
    assert r.menu.read_param(4).value == 1                                              # reads still work


def test_vtx_admin_and_vrx_follow_revert(menu_rig) -> None:
    r = menu_rig(vrx_follows=False)
    r.stream_fpv()
    r.menu.load_tree()
    vtx = VtxAdmin(r.menu)
    fields = vtx.fields()
    assert fields is not None and fields.send is not None and fields.values() == \
        {"band": 5, "channel": 4, "power": 1, "pitmode": 0}                             # R5 (from the sim)
    lock = lambda: r.rt.status()["video"]["decoder_lock"]                               # noqa: E731
    assert lock() is True
    follow = VrxFollow(lock_timeout_s=0.6)
    before = vtx.apply(band=1, channel=0)                                               # A1
    follow.start(before)
    assert r.sim.module.vtx_sent[:2] == (1, 0) and "Send VTx" in r.sim.module.commands_run
    end = time.monotonic() + 5
    while follow.update(lock()) != "no_lock":
        assert time.monotonic() < end, follow.state
        time.sleep(0.05)
    assert follow.offer_revert and VRX_FOLLOW_TEXT in follow.text() and "revert" in follow.text()
    vtx.apply(band=before["band"], channel=before["channel"])                           # operator: revert
    end = time.monotonic() + 5
    while lock() is not True:
        assert time.monotonic() < end
        time.sleep(0.05)


def test_vrx_follow_states_without_lock_reporting() -> None:
    t = [0.0]
    f = VrxFollow(10, clock=lambda: t[0])
    assert f.update(None) == "idle" and f.text() == VRX_FOLLOW_TEXT
    f.start({"band": 5, "channel": 4})
    assert f.update(None) == "unknown" and "not reported" in f.text()
    f.start({"band": 5, "channel": 4})
    assert f.update(False) == "waiting"
    t[0] = 10.0
    assert f.update(False) == "no_lock" and f.offer_revert
    f.start({})
    assert f.update(True) == "locked" and not f.offer_revert


def test_menu_retries_lost_replies() -> None:
    """A lossy link: the first reply of every request is lost; retries recover the full entry."""
    module = BS.ElrsModule()
    menu: CrsfMenu

    def send(frame: bytes) -> tuple[bool, list[str]]:
        send.calls += 1
        if send.calls % 2 == 1:
            return True, []                                       # sent, but the reply is lost
        for reply in module.handle(crsf.parse_frame(frame)):
            menu.feed(reply)
        return True, []
    send.calls = 0
    menu = CrsfMenu(send, timeout_s=0.05, retries=3)
    assert menu.ping().name == "SIM ELRS TX (tree)"
    assert len(menu.read_param(1).options) == 10


def test_vrx_follow_revert_label_waits_for_the_outcome() -> None:
    """WP13 R5: "reverted" only after the revert writes succeeded; a refused revert says so."""
    t = [0.0]
    f = VrxFollow(10, clock=lambda: t[0])
    f.start({"band": 5, "channel": 4})
    t[0] = 10.0
    assert f.update(False) == "no_lock" and f.offer_revert
    assert f.begin_revert() == {"band": 5, "channel": 4}
    assert f.state == "reverting" and "reverted" not in f.text() and not f.offer_revert
    assert f.update(False) == "reverting"                           # status polls do not overwrite it
    f.revert_done("write refused: the client may be armed")
    assert f.state == "revert_failed" and "revert FAILED" in f.text() and "may be armed" in f.text()
    assert f.update(True) == "revert_failed" and f.offer_revert     # the operator can retry
    f.begin_revert()
    f.revert_done(None)
    assert f.state == "reverted" and f.text().endswith(" - reverted") and not f.offer_revert
