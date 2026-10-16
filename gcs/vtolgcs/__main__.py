"""``python -m vtolgcs --headless [--sim]`` — run the GCS runtime with a console status line.

``--sim`` uses a fake controller (sticks centred, throttle low, arm switch
safe) and the simulator address ``127.0.0.1:5770``; start
``python gcs/tools/bridge_sim.py`` first.  With ``--sim`` the default mode is
``fpv`` (normal start), so the simulator reaches RUN, and FAILSAFE when the app is killed.

The app always starts **idle** unless told otherwise; it never resumes by itself.
``--resume`` starts on the RESUME (client airborne) path: the live arm and
throttle values are printed and the pilot must type ``RESUME`` (and, with the
throttle at minimum, also ``THROTTLE``) before the first packet is sent.

Console keys (Windows console):

  f  FPV, normal start (interlock)      c  carrier-only mode      i  idle (stop streaming)
  r  normal restart of the stopped mode R  RESUME (client airborne): preview + typed confirmation
  k  toggle the carrier camera           q  quit
  --sim only:  a  toggle the fake arm switch   d  fake controller disconnect / reconnect
"""

from __future__ import annotations

import argparse
import logging
import logging.handlers
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Sequence

from . import __version__, config as config_mod, protocol
from .controller import FakeController, safe_channels
from .runtime import Runtime
from .sender import ModeResult
from .sender import Mode
from .timing_win import AlreadyRunning

EXIT_OK, EXIT_CONFIG, EXIT_RUNNING, EXIT_USAGE, EXIT_START = 0, 2, 3, 4, 5


def _hostport(text: str) -> tuple[str, int]:
    host, sep, port = text.rpartition(":")
    if not sep:
        raise argparse.ArgumentTypeError("expected HOST:PORT")
    return host or "127.0.0.1", int(port)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m vtolgcs", description=f"vtol-gcs {__version__} runtime")
    p.add_argument("--headless", action="store_true", help="run without a UI (console status line)")
    p.add_argument("--sim", action="store_true", help="fake controller; bridge = bridge_sim on 127.0.0.1:5770")
    p.add_argument("--config", type=Path, help="config file (default %%APPDATA%%\\vtol-gcs\\config.json)")
    p.add_argument("--bridge", type=_hostport, help="override the bridge address HOST:PORT")
    p.add_argument("--api-port", type=int, help="override the local API port (0 = any free port)")
    p.add_argument("--no-api", action="store_true", help="do not start the local API")
    p.add_argument("--mavlink-port", type=int, help="override the MAVLink mirror listen port")
    p.add_argument("--log-dir", type=Path, help="session log folder")
    p.add_argument("--no-log", action="store_true", help="do not write a session log")
    start = p.add_mutually_exclusive_group()
    start.add_argument("--mode", choices=[m.value for m in Mode],
                       help="normal start in this mode (default: idle; fpv with --sim)")
    start.add_argument("--resume", action="store_true",
                       help="RESUME (client airborne): show the live arm/throttle values, then start FPV with "
                            "the arm switch ARMED after a typed confirmation")
    p.add_argument("--sim-armed", action="store_true",
                   help="--sim only: the fake controller starts with the arm switch ARMED and throttle mid")
    p.add_argument("--camera", choices=("on", "off"), help="camera request at start")
    p.add_argument("--run-seconds", type=float, help=argparse.SUPPRESS)        # tests
    p.add_argument("--instance-name", default="vtol-gcs-sender", help=argparse.SUPPRESS)  # tests
    p.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    return p


def _fmt(v: Any, fmt: str = "{}", none: str = "--") -> str:
    return none if v is None else fmt.format(v)


def status_line(s: dict) -> str:
    """One-line console summary of a C2 status object."""
    b, c, cl = s["bridge"], s["controller"], s["client"]
    mode = s["app"]["mode"].upper() + ("" if s["app"]["streaming"] or s["app"]["mode"] == "idle" else " STOPPED")
    cam = b["camera"]
    reported = "--" if cam["reported"] is None else ("ON" if cam["reported"] else "off")
    batt = cl["battery"]["voltage_v"]
    fm = cl["flight_mode"]["raw"]
    alarms = ",".join(a["id"] for a in s["alarms"]) or "-"
    return (f"{mode:<16} bridge {b['state']:<11} rtt {_fmt(b['rtt_ms'], '{:.1f}')}ms "
            f"loss {_fmt(b['uplink_loss_pct'], '{:.1f}')}% jit99 {_fmt(b['send_jitter_ms_p99'], '{:.2f}')}ms "
            f"cam {'ON' if cam['requested'] else 'off'}/{reported} "
            f"ctl {'ok' if c['connected'] else 'LOST'}{'' if c['arm_switch_safe'] in (True, None) else ' ARMED'} "
            f"LQ {_fmt(cl['link']['lq_pct'])} batt {_fmt(batt, '{:.1f}')}V fm {_fmt(fm)} | alarms {alarms}")


class Console:
    """Prints events and a periodic status line; reads single keys on a Windows console."""

    def __init__(self, rt: Runtime, fake: FakeController | None, tty: bool) -> None:
        self.rt = rt
        self.fake = fake
        self.tty = tty
        self._lock = threading.Lock()
        self._fake_arm_high = False
        self._last_len = 0
        self._events: queue.SimpleQueue = queue.SimpleQueue()
        rt.add_listener(lambda kind, data: self._events.put((kind, data)))   # never print on the caller's thread

    def drain(self) -> None:
        """Print queued runtime events (main thread only)."""
        while True:
            try:
                kind, data = self._events.get_nowait()
            except queue.Empty:
                return
            self.on_event(kind, data)

    def print_line(self, text: str) -> None:
        with self._lock:
            if self.tty and self._last_len:
                sys.stdout.write("\r" + " " * self._last_len + "\r")
                self._last_len = 0
            sys.stdout.write(text + "\n")
            sys.stdout.flush()

    def status(self) -> None:
        line = status_line(self.rt.status())
        with self._lock:
            if self.tty:
                sys.stdout.write("\r" + line[:200].ljust(self._last_len))
                self._last_len = min(len(line), 200)
            else:
                sys.stdout.write(line + "\n")
            sys.stdout.flush()

    def on_event(self, kind: str, data: dict) -> None:
        if kind == "alarm":
            state = "RAISED" if data["active"] else "cleared"
            self.print_line(f"ALARM {state}: {data['severity'].upper()} {data['id']} - {data['text']}")
        elif kind == "interlock_refused":
            self.print_line(f"REFUSED {data['requested']}: " + "; ".join(data["reasons"]))
        elif kind == "suspended":
            self.print_line(f"RC STREAM STOPPED: {data['reason']} ({data['detail']}) - "
                            "r = normal restart, R = RESUME (client airborne)")
        elif kind == "camera_refused":
            self.print_line("CAMERA ON refused: " + "; ".join(data["reasons"]))
        elif kind == "mode" and data.get("start_path") == "resume":
            self.print_line(f"RESUME started: CH{self.rt.cfg.interlock.arm_channel} = {data['arm_us']} us, "
                            f"CH{self.rt.cfg.interlock.throttle_channel} = {data['throttle_us']} us")
        elif kind in ("mode", "camera", "bridge_state", "error"):
            self.print_line(f"{kind}: {data}")

    def key(self, ch: str) -> bool:
        """Handle one key. Returns False to quit."""
        rt = self.rt
        if ch == "q":
            return False
        if ch == "f":
            rt.request_mode(Mode.FPV)
        elif ch == "c":
            rt.request_mode(Mode.CARRIER_ONLY)
        elif ch == "i":
            rt.request_mode(Mode.IDLE)
        elif ch == "r":
            rt.request_mode(rt.sender.state().mode)
        elif ch == "R":
            resume_dialog(rt, self.print_line, sys.stdin.readline)
        elif ch == "k":
            rt.set_camera(not rt.sender.state().camera_requested)
        elif ch == "a" and self.fake is not None:
            self._fake_arm_high = not self._fake_arm_high
            il = rt.cfg.interlock
            self.fake.set_channel_us(il.arm_channel, protocol.US_MAX if self._fake_arm_high else il.arm_safe_min_us)
            self.print_line(f"sim: fake arm switch {'HIGH (armed)' if self._fake_arm_high else 'low (safe)'}")
        elif ch == "d" and self.fake is not None:
            if self.fake.snapshot().connected:
                self.fake.disconnect()
                self.print_line("sim: fake controller DISCONNECTED")
            else:
                self.fake.connect()
                self.print_line("sim: fake controller reconnected")
        return True


def resume_dialog(rt: Runtime, out: Callable[[str], None], read_line: Callable[[], str]) -> ModeResult | None:
    """RESUME (client airborne): live values first, then typed confirmation(s). Nothing is sent before."""
    preview = rt.prepare_resume()
    out("RESUME (client airborne) - live values: " + preview.text())
    if not preview.ok:
        out("RESUME not possible: " + "; ".join(preview.problems))
        return None
    out("The client gets these values at once (arm switch ARMED). Type RESUME + Enter to start, "
        "anything else cancels:")
    if read_line().strip() != "RESUME":
        out("RESUME cancelled - nothing sent")
        return None
    throttle_ok = False
    if preview.needs_throttle_confirm:
        out(f"WARNING: THROTTLE AT MINIMUM ({preview.throttle_us} us): an airborne client would get minimum "
            "throttle. Type THROTTLE + Enter to confirm again, anything else cancels:")
        if read_line().strip() != "THROTTLE":
            out("RESUME cancelled - nothing sent")
            return None
        throttle_ok = True
    result = rt.confirm_resume(preview.token, throttle_min_confirmed=throttle_ok)
    if not result.ok:
        out("RESUME refused: " + "; ".join(result.reasons))
    return result


def _read_key() -> str | None:
    if sys.platform != "win32":
        return None
    import msvcrt
    if msvcrt.kbhit():
        ch = msvcrt.getwch()
        if ch in ("\x00", "\xe0"):           # function / arrow key prefix
            msvcrt.getwch()
            return None
        return ch
    return None


def setup_logging(verbose: bool) -> logging.handlers.QueueListener:
    """Log through a queue: a frozen console (e.g. QuickEdit selection) must never block the RC thread."""
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s", "%H:%M:%S"))
    q: queue.SimpleQueue = queue.SimpleQueue()
    root = logging.getLogger()
    root.handlers[:] = [logging.handlers.QueueHandler(q)]
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    listener = logging.handlers.QueueListener(q, handler)
    listener.start()
    return listener


_LOG_LISTENER: list[logging.handlers.QueueListener] = []


def main(argv: Sequence[str] | None = None) -> int:
    try:
        return _main(argv)
    finally:
        while _LOG_LISTENER:
            _LOG_LISTENER.pop().stop()     # flushes queued log lines


def _main(argv: Sequence[str] | None) -> int:
    args = build_parser().parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="backslashreplace")
    _LOG_LISTENER.append(setup_logging(args.verbose))
    if not args.headless:
        print("The windowed UI is not part of this build yet (WP08b). Run with --headless.", file=sys.stderr)
        return EXIT_USAGE
    try:
        cfg = config_mod.load_config(args.config)
    except config_mod.ConfigError as exc:
        print(f"CONFIG ERROR: {exc}", file=sys.stderr)
        return EXIT_CONFIG
    if args.sim:
        cfg.bridge.ip, cfg.bridge.port = "127.0.0.1", protocol.BRIDGE_PORT
    if args.bridge:
        cfg.bridge.ip, cfg.bridge.port = args.bridge
    if args.api_port is not None:
        cfg.api.port = args.api_port
    if args.no_api:
        cfg.api.enabled = False
    if args.mavlink_port is not None:
        cfg.mavlink.listen_port = args.mavlink_port
    if args.no_log:
        cfg.log.enabled = False
    errors = config_mod.validate(cfg)
    if errors:
        print("CONFIG ERROR:\n  " + "\n  ".join(errors), file=sys.stderr)
        return EXIT_CONFIG

    fake = None
    if args.sim:
        il = cfg.interlock
        fake = FakeController(safe_channels(il.arm_channel, il.arm_safe_min_us, il.throttle_channel,
                                            protocol.US_MIN), name="SIM fake EdgeTX Joystick")
        if args.sim_armed:
            fake.set_channel_us(il.arm_channel, protocol.US_MAX)
            fake.set_channel_us(il.throttle_channel, 1500)
    rt = Runtime(cfg, fake, instance_name=args.instance_name, log_dir=args.log_dir)
    try:
        rt.start()
    except AlreadyRunning as exc:
        print(f"NOT STARTED: {exc}", file=sys.stderr)
        return EXIT_RUNNING
    except OSError as exc:                     # e.g. the configured local UDP port is taken
        print(f"NOT STARTED: {exc}", file=sys.stderr)
        return EXIT_START
    tty = sys.stdout.isatty()
    console = Console(rt, fake, tty)
    console.print_line(f"vtol-gcs {__version__} headless - bridge {cfg.bridge.ip}:{cfg.bridge.port}"
                       + (f", API {rt.api.base_url}" if rt.api else ", API off")
                       + (f", log {rt.session.path}" if rt.session else "")
                       + ("  [SIM]" if args.sim else ""))
    console.print_line("keys: f fpv | c carrier-only | i idle | r restart | R RESUME (client airborne) | k camera | q quit"
                       + (" | a sim arm | d sim disconnect" if args.sim else ""))
    if args.camera:
        rt.set_camera(args.camera == "on")
    if args.resume:
        console.drain()
        resume_dialog(rt, console.print_line, sys.stdin.readline)
    else:
        mode = args.mode or ("fpv" if args.sim and not args.sim_armed else None)
        if mode and mode != "idle":
            rt.request_mode(Mode(mode))
    end = time.monotonic() + args.run_seconds if args.run_seconds else None
    next_line = 0.0
    try:
        while end is None or time.monotonic() < end:
            ch = _read_key() if tty else None
            if ch is not None and not console.key(ch):
                break
            console.drain()
            if time.monotonic() >= next_line:
                next_line = time.monotonic() + (0.5 if tty else 1.0)
                console.status()
            time.sleep(0.05)
    except KeyboardInterrupt:
        pass
    finally:
        rt.stop()
        console.drain()
        console.print_line("stopped (RC stream off; the bridge goes to FAILSAFE after T_hold)")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
