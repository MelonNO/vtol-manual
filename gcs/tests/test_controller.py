"""Controller mapping, device choice and disconnect detection (brief R2)."""

from __future__ import annotations

from types import SimpleNamespace

from vtolgcs import protocol
from vtolgcs.config import ChannelSource, ControllerConfig, edgetx_classic_map
from vtolgcs.controller import (FakeController, PygameController, axis_to_us, button_to_us,
                                channels_to_crsf, choose_device, map_inputs)


def test_axis_scaling_full_travel() -> None:
    src = ChannelSource("axis", 0)
    assert axis_to_us(-1.0, src) == 988
    assert axis_to_us(0.0, src) == 1500
    assert axis_to_us(1.0, src) == 2012
    assert axis_to_us(2.0, src) == 2012 and axis_to_us(-3.0, src) == 988      # clamped
    assert axis_to_us(float("nan"), src) == 1500
    rev = ChannelSource("axis", 0, reverse=True)
    assert axis_to_us(-1.0, rev) == 2012 and axis_to_us(1.0, rev) == 988


def test_axis_calibration_endpoints() -> None:
    src = ChannelSource("axis", 0, min=-0.8, max=0.8)
    assert axis_to_us(-0.8, src) == 988 and axis_to_us(0.8, src) == 2012 and axis_to_us(0.0, src) == 1500


def test_buttons() -> None:
    assert button_to_us(True, ChannelSource("button", 0)) == 2012
    assert button_to_us(False, ChannelSource("button", 0)) == 988
    assert button_to_us(True, ChannelSource("button", 0, reverse=True)) == 988


def test_edgetx_classic_mapping_axes_then_buttons() -> None:
    axes = [-1.0, -0.5, 0.0, 0.5, 1.0, 0.0, 0.0, 0.0]
    buttons = [True, False] + [False] * 30
    ch = map_inputs(axes, buttons, edgetx_classic_map())
    assert ch[:5] == (988, 1244, 1500, 1756, 2012)
    assert ch[8] == 2012 and ch[9] == 988
    assert len(ch) == 16


def test_missing_inputs_are_centred() -> None:
    ch = map_inputs([0.5], [], edgetx_classic_map())
    assert ch[0] == 1756 and ch[1:8] == (1500,) * 7 and ch[8:] == (1500,) * 8


def test_crsf_conversion_uses_c3_scaling() -> None:
    assert channels_to_crsf([988, 1000, 1500, 2000, 2012]) == (172, 191, 992, 1792, 1811)
    assert channels_to_crsf([800, 2300]) == (protocol.CRSF_CHANNEL_MIN, protocol.CRSF_CHANNEL_MAX)


def test_choose_device_preference() -> None:
    cfg = ControllerConfig()
    assert choose_device([], cfg) is None
    assert choose_device(["Xbox Controller", "RadioMaster TX16S Joystick"], cfg) == 1
    assert choose_device(["Xbox Controller", "EdgeTX Radio"], cfg) == 1
    assert choose_device(["Gamepad", "Generic USB Joystick"], cfg) == 1
    assert choose_device(["Gamepad"], cfg) == 0                    # fallback: first device
    exact = ControllerConfig(device_name="EdgeTX Radio")
    assert choose_device(["RadioMaster TX16S", "EdgeTX Radio"], exact) == 1
    assert choose_device(["RadioMaster TX16S"], exact) is None


def test_fake_controller() -> None:
    t = [10.0]
    fake = FakeController(clock=lambda: t[0])
    snap = fake.snapshot()
    assert snap.connected and snap.channel_us(3) == 988 and snap.channel_us(5) == 988 and snap.channel_us(1) == 1500
    fake.set_channel_us(1, 1600)
    t[0] = 11.0
    assert fake.snapshot().channel_us(1) == 1600 and fake.snapshot().t == 11.0
    fake.freeze()
    t[0] = 12.0
    assert fake.snapshot().t == 11.0                 # hung input thread
    fake.disconnect()
    assert not fake.snapshot().connected


# --------------------------------------------------------------------------- pygame backend with a fake module

class _FakeJoy:
    def __init__(self, name: str, instance_id: int) -> None:
        self.name, self.iid = name, instance_id
        self.axes = [0.0] * 8
        self.buttons = [0] * 16

    def init(self) -> None:
        pass

    def get_name(self) -> str:
        return self.name

    def get_instance_id(self) -> int:
        return self.iid

    def get_numaxes(self) -> int:
        return len(self.axes)

    def get_numbuttons(self) -> int:
        return len(self.buttons)

    def get_axis(self, i: int) -> float:
        return self.axes[i]

    def get_button(self, i: int) -> int:
        return self.buttons[i]


class _FakePygame:
    JOYDEVICEADDED, JOYDEVICEREMOVED = 1541, 1542

    def __init__(self) -> None:
        self.devices: list[_FakeJoy] = []
        self.events: list[SimpleNamespace] = []
        outer = self
        self.display = SimpleNamespace(init=lambda: None)
        self.joystick = SimpleNamespace(init=lambda: None, quit=lambda: None,
                                        get_count=lambda: len(outer.devices),
                                        Joystick=lambda i: outer.devices[i])
        self.event = SimpleNamespace(get=self._get)

    def _get(self) -> list[SimpleNamespace]:
        ev, self.events = self.events, []
        return ev


def test_pygame_controller_reads_and_detects_removal() -> None:
    pg = _FakePygame()
    t = [0.0]
    ctl = PygameController(ControllerConfig(), clock=lambda: t[0], pygame_module=pg)
    assert ctl._init()
    ctl.poll_once()
    assert not ctl.snapshot().connected                        # nothing plugged in
    joy = _FakeJoy("RadioMaster TX16S Joystick", 7)
    joy.axes[2] = -1.0
    joy.axes[4] = -1.0
    pg.devices.append(joy)
    pg.events.append(SimpleNamespace(type=pg.JOYDEVICEADDED, device_index=0))
    t[0] = 0.002
    ctl.poll_once()
    snap = ctl.snapshot()
    assert snap.connected and snap.name == "RadioMaster TX16S Joystick"
    assert snap.channel_us(3) == 988 and snap.channel_us(5) == 988 and snap.channel_us(1) == 1500
    assert snap.t == 0.002
    # unplug: the very next poll (2 ms at 500 Hz) reports it -> well inside the 100 ms budget
    pg.devices.clear()
    pg.events.append(SimpleNamespace(type=pg.JOYDEVICEREMOVED, instance_id=7))
    t[0] = 0.004
    ctl.poll_once()
    assert not ctl.snapshot().connected
    assert ctl.snapshot().channels_us == (1500,) * 16


def test_pygame_removal_of_another_device_is_ignored() -> None:
    pg = _FakePygame()
    pg.devices.append(_FakeJoy("EdgeTX", 1))
    ctl = PygameController(ControllerConfig(), clock=lambda: 0.0, pygame_module=pg)
    ctl._init()
    ctl.poll_once()
    pg.events.append(SimpleNamespace(type=pg.JOYDEVICEREMOVED, instance_id=99))
    ctl.poll_once()
    assert ctl.snapshot().connected


def test_pygame_missing_reports_error() -> None:
    class Broken:
        class display:  # noqa: N801
            @staticmethod
            def init() -> None:
                raise RuntimeError("no SDL")
    ctl = PygameController(ControllerConfig(), pygame_module=Broken)
    assert not ctl._init()
    assert "no SDL" in (ctl.error or "")
    assert not ctl.snapshot().connected


def test_real_pygame_thread_starts_and_stops() -> None:
    """The real pygame-ce backend runs headless in its thread (no device needed)."""
    ctl = PygameController(ControllerConfig())
    ctl.start()
    try:
        import time
        time.sleep(0.5)
        assert ctl.error is None
        assert isinstance(ctl.snapshot().connected, bool)
    finally:
        ctl.stop()
