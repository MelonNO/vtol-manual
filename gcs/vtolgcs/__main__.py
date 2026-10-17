"""``python -m vtolgcs`` — the windowed UI; ``python -m vtolgcs --headless [--sim]`` — the RC sender.

Process separation (WP08b brief R0): the **RC sender** (this module with ``--headless``) runs in its
own process and serves the local control channel (:mod:`vtolgcs.control`).  Without ``--headless``
the windowed UI (:mod:`vtolgcs.ui`) starts in this process and attaches to a running sender, or
starts one **without a console window** (``--no-keys``, WP15 R1); the UI never runs inside the
sender process.
``--video-fanout`` (first argument, internal) runs the video fan-out helper process.

``--sim`` uses a fake controller (sticks centred, throttle low, arm switch
safe) and the simulator on a **loopback** address (default ``127.0.0.1:5770``;
``--bridge`` may only name another loopback address); start
``python gcs/tools/bridge_sim.py`` first.  With ``--sim`` the default is an FPV
normal start, so the simulator reaches RUN, and FAILSAFE when the app is killed.
The fake controller, its keys and that auto-start exist only with a loopback bridge.

Otherwise the app always starts **idle**; it never resumes by itself.  The
confirmations below must be typed on an interactive console (piped input is
refused):

* ``--resume`` / key ``R`` — RESUME (client airborne): the live arm and throttle
  values are printed, then ``RESUME`` (and ``THROTTLE`` with the throttle at minimum).
* ``--mode carrier_only`` / key ``c`` — carrier-only sends DISARM: ``NOCLIENT``
  (no client powered or bound), plus ``LANDED`` after an FPV stream in this session.

Console keys (Windows console, WP15 R2): **no single key starts, ends or changes the RC stream, the
mode or the camera.**  Such a key only asks for a typed word + Enter (anything else cancels):

  f  FPV, normal start (interlock): START   c  carrier-only: NOCLIENT (+ LANDED)   i  idle: STOP
  r  normal restart of the stopped mode: START   R  RESUME (client airborne): RESUME (+ THROTTLE)
  k  camera request on/off: CAMERA         q / Ctrl+C / Ctrl+Break  quit: STOP while streaming (else at once)
  --sim only:  a  fake arm switch: ARM / SAFE   d  fake controller: UNPLUG / PLUG
  s  print the status line   h / ?  help   (the only keys that act at once)

Ctrl+Break is handled like Ctrl+C (WP16 R3).  Closing the console window, logging off and shutting down
cannot be caught or refused (Windows ends the process; the bridge goes to FAILSAFE after T_hold).

A prompt never blocks the main loop (WP16 R1): the action runs in a worker thread and the main loop
collects the typed characters, so a stop through the control channel takes effect at once and events
keep printing.  A pending prompt is cancelled when the sender's state changes underneath it.

``--no-keys`` (the UI passes it to the sender it starts): no key or typed input is read at all.
"""

from __future__ import annotations

import argparse
import ipaddress
import logging
import logging.handlers
import os
import queue
import signal
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Sequence

from . import __version__, config as config_mod, protocol
from .control import WORD_STOP, ControlServer, default_control_file
from .controller import FakeController, safe_channels
from .runtime import Runtime
from .sender import Mode, ModeResult
from .timing_win import AlreadyRunning

EXIT_OK, EXIT_CONFIG, EXIT_RUNNING, EXIT_USAGE, EXIT_START = 0, 2, 3, 4, 5
#: Test suites only: a different single-instance mutex name.  Never set it operationally (it lets
#: two senders run at once).
TEST_INSTANCE_ENV = "VTOLGCS_TEST_INSTANCE_NAME"
DEFAULT_INSTANCE = "vtol-gcs-sender"


def _hostport(text: str) -> tuple[str, int]:
    host, sep, port = text.rpartition(":")
    if not sep:
        raise argparse.ArgumentTypeError("expected HOST:PORT")
    return host or "127.0.0.1", int(port)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m vtolgcs", description=f"vtol-gcs {__version__} runtime")
    p.add_argument("--headless", action="store_true", help="run without a UI (console status line)")
    p.add_argument("--sim", action="store_true",
                   help="fake controller; bridge = bridge_sim on a loopback address (default 127.0.0.1:5770)")
    p.add_argument("--config", type=Path, help="config file (default %%APPDATA%%\\vtol-gcs\\config.json)")
    p.add_argument("--bridge", type=_hostport, help="override the bridge address HOST:PORT")
    p.add_argument("--api-port", type=int, help="override the local API port (0 = any free port)")
    p.add_argument("--no-api", action="store_true", help="do not start the local API")
    p.add_argument("--mavlink-port", type=int, help="override the MAVLink mirror listen port")
    p.add_argument("--log-dir", type=Path, help="session log folder")
    p.add_argument("--no-log", action="store_true", help="do not write a session log")
    start = p.add_mutually_exclusive_group()
    start.add_argument("--mode", choices=[m.value for m in Mode],
                       help="start in this mode (default: idle; fpv with --sim); carrier_only asks for the "
                            "typed NOCLIENT confirmation first")
    start.add_argument("--resume", action="store_true",
                       help="RESUME (client airborne): show the live arm/throttle values, then start FPV with "
                            "the arm switch ARMED after a typed confirmation")
    p.add_argument("--sim-armed", action="store_true",
                   help="--sim only: the fake controller starts with the arm switch ARMED and throttle mid")
    p.add_argument("--camera", choices=("on", "off"), help="camera request at start")
    p.add_argument("--control-file", type=Path,
                   help="control channel file (default: control.json next to the config file)")
    p.add_argument("--no-control", action="store_true",
                   help="headless: do not serve the local control channel (no UI can attach)")
    p.add_argument("--attach-only", action="store_true",
                   help="UI: attach to a running RC sender, never start one")
    p.add_argument("--no-keys", action="store_true",
                   help="headless: read no console keys and no typed confirmations (the UI starts its sender so)")
    p.add_argument("--ui-smoke-out", help=argparse.SUPPRESS)                   # tests: UI smoke summary file
    p.add_argument("--run-seconds", type=float, help=argparse.SUPPRESS)        # tests: stop after N s
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


#: Typed words of the console keys (WP15 R2).  ``STOP`` is the control channel's word for ending the stream.
WORD_START, WORD_CAMERA = "START", "CAMERA"
WORD_SIM_ARM, WORD_SIM_SAFE, WORD_SIM_UNPLUG, WORD_SIM_PLUG = "ARM", "SAFE", "UNPLUG", "PLUG"

KEYS_HELP = ("keys (each asks for a typed word + Enter; anything else cancels): f FPV start (START) | "
             "c carrier-only (NOCLIENT) | i idle (STOP) | r restart (START) | R RESUME client airborne (RESUME) | "
             "k camera (CAMERA) | q / Ctrl+C / Ctrl+Break quit (STOP while streaming) | s status | h help | "
             "Esc cancels a prompt")
KEYS_HELP_SIM = " | sim: a fake arm switch (ARM / SAFE), d fake controller (UNPLUG / PLUG)"


class Console:
    """Prints events and a periodic status line; reads single keys on a Windows console.

    WP15 R2: no single key starts, ends or changes the RC stream, the mode or the camera.  Those keys
    only print what they would do and ask for a typed word on an interactive console (piped or
    redirected input is refused, like the RESUME and carrier-only dialogs).  ``s`` and ``h`` act at once.
    """

    def __init__(self, rt: Runtime, fake: FakeController | None, tty: bool, interactive: bool = False,
                 read_line: Callable[[], str] | None = None) -> None:
        self.rt = rt
        self.fake = fake
        self.tty = tty
        self.interactive = interactive
        self.read_line = read_line or (sys.stdin.readline if sys.stdin is not None else (lambda: ""))
        self._lock = threading.Lock()
        self._last_len = 0
        self._typed: str | None = None          # the answer being typed at a prompt (WP16 R1), else None
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
            typing = self.tty and self._typed is not None
            if typing:                             # keep a half-typed answer below the new line
                sys.stdout.write("\r" + " " * len(self._typed or "") + "\r")
            sys.stdout.write(text + "\n")
            if typing:
                sys.stdout.write(self._typed or "")
            sys.stdout.flush()

    def feed(self, ch: str) -> str | None:
        """Main loop, while a prompt waits: one typed character.  Returns the answer on Enter (Esc and a
        Ctrl+C character give an empty answer, which cancels), else None.  Echoes on a console."""
        with self._lock:
            typed, out, line = self._typed or "", "", None
            if ch in ("\r", "\n"):
                line, out = typed, "\n"
            elif ch in ("\x1b", "\x03"):
                line, out = "", "\n"
            elif ch == "\b":
                if typed:
                    typed, out = typed[:-1], "\b \b"
            elif ch.isprintable():
                typed, out = typed + ch, ch
            self._typed = None if line is not None else typed
            if self.tty and out:
                sys.stdout.write(out)
                sys.stdout.flush()
            return line

    def end_input(self) -> None:
        """The prompt is over (answered or cancelled): drop a half-typed answer from the screen."""
        with self._lock:
            if self._typed is not None and self.tty:
                sys.stdout.write("\r" + " " * len(self._typed) + "\r")
                sys.stdout.flush()
            self._typed = None

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
        elif kind == "failsafe_timing":
            self.print_line(f"bridge FAILSAFE {data['observed_ms']:.0f} ms after the stop "
                            f"(expected T_hold {data['expected_t_hold_ms']:.0f} ms)")
        elif kind == "start_timing":
            self.print_line(f"bridge START after {data['packets_sent']} packets "
                            f"(expected {data['expected_start_packets']})")
        elif kind in ("mode", "camera", "bridge_state", "error"):
            self.print_line(f"{kind}: {data}")

    def confirm(self, what: str, explain: str, word: str) -> bool:
        """Print what a key would do, then read one line: True only for exactly ``word``."""
        if not self.interactive:
            self.print_line(f"{what} {NOT_INTERACTIVE} - nothing changed")
            return False
        self.print_line(f"{what}: {explain} Type {word} + Enter to confirm, anything else cancels:")
        if self.read_line().strip() != word:
            self.print_line(f"{what} cancelled - nothing changed")
            return False
        return True

    def quit_ok(self) -> bool:
        """``q`` / Ctrl+C: True when the process may stop now.  While streaming it needs the typed ``STOP``
        (the control channel's word); the streaming check and the "no later start" gate are one locked
        step in the sender (``begin_stop``, WP13 R4)."""
        sender = self.rt.sender
        if sender.begin_stop(stream_stop_confirmed=False):
            return True
        if not self.confirm("QUIT", "the RC stream is running; quitting ends it (the client goes to its "
                            "failsafe after T_hold).", WORD_STOP):
            return False
        return sender.begin_stop(stream_stop_confirmed=True)

    def help(self) -> None:
        self.print_line(KEYS_HELP + (KEYS_HELP_SIM if self.fake is not None else ""))

    def signature(self) -> dict[str, Any]:
        """What a pending prompt depends on: it is cancelled when any of this changes (WP16 R1)."""
        st = self.rt.sender.state()
        sig: dict[str, Any] = {"mode": st.mode.value, "streaming": st.streaming, "camera": st.camera_requested,
                               "stopping": self.rt.sender.stopping, "sender thread dead": st.thread_dead}
        if self.fake is not None:
            il = self.rt.cfg.interlock
            snap = self.fake.snapshot()
            sig["sim controller connected"] = snap.connected
            sig["sim arm switch"] = "ARMED" if snap.channel_us(il.arm_channel) > il.arm_safe_max_us else "safe"
        return sig

    def key(self, ch: str) -> bool:
        """Handle one key. Returns False to quit."""
        rt = self.rt
        if ch == "q":
            return not self.quit_ok()
        if ch == "s":
            self.print_line(status_line(rt.status()))
        elif ch in ("h", "?"):
            self.help()
        elif ch == "r" and rt.sender.state().mode is not Mode.FPV:
            self.print_line("r restarts a stopped FPV stream only (idle: f; carrier-only: c)")
        elif ch in ("f", "r"):
            if self.confirm("FPV normal start", "the start interlock applies (arm switch SAFE, throttle low); "
                            "an airborne client would be DISARMED - for a client in the air use R (RESUME).",
                            WORD_START):
                rt.request_mode(Mode.FPV)
        elif ch == "c":
            carrier_only_dialog(rt, self.print_line, self.read_line, self.interactive)
        elif ch == "i":
            if rt.sender.state().mode is Mode.IDLE:
                self.print_line("already idle")
            elif self.confirm("IDLE", "stops the RC stream (the bridge goes to FAILSAFE after T_hold, the "
                              "client to its failsafe).", WORD_STOP):
                rt.request_mode(Mode.IDLE)
        elif ch == "R":
            resume_dialog(rt, self.print_line, self.read_line, self.interactive)
        elif ch == "k":
            on = not rt.sender.state().camera_requested
            if self.confirm(f"CAMERA {'ON' if on else 'OFF'}", f"switches the carrier camera request "
                            f"{'ON' if on else 'OFF'}.", WORD_CAMERA):
                rt.set_camera(on)
        elif ch == "a" and self.fake is not None:
            il = rt.cfg.interlock
            armed = self.fake.snapshot().channel_us(il.arm_channel) > il.arm_safe_max_us
            if self.confirm(f"sim: fake arm switch {'SAFE' if armed else 'ARMED'}", "moves the fake arm switch.",
                            WORD_SIM_SAFE if armed else WORD_SIM_ARM):
                self.fake.set_channel_us(il.arm_channel, il.arm_safe_min_us if armed else protocol.US_MAX)
                self.print_line(f"sim: fake arm switch {'low (safe)' if armed else 'HIGH (armed)'}")
        elif ch == "d" and self.fake is not None:
            if self.fake.snapshot().connected:
                if self.confirm("sim: fake controller DISCONNECT", "the FPV stream stops (controller lost).",
                                WORD_SIM_UNPLUG):
                    self.fake.disconnect()
                    self.print_line("sim: fake controller DISCONNECTED")
            elif self.confirm("sim: fake controller reconnect", "the stream stays stopped until a start.",
                              WORD_SIM_PLUG):
                self.fake.connect()
                self.print_line("sim: fake controller reconnected")
        return True


NOT_INTERACTIVE = "needs a typed confirmation on an interactive console; piped or redirected input is refused"


class PromptCancelled(Exception):
    """A pending console prompt was cancelled before anything was done (WP16 R1)."""


class PromptRunner:
    """Runs one console action at a time **off the main loop** (WP16 R1).

    A key's action (and the launch RESUME / carrier-only dialog) runs in a worker thread.  Its
    ``read_line`` waits for an answer that the main loop collects character by character
    (:meth:`submit`), so the main loop never blocks on a prompt: a stop through the control channel ends
    the process at once, and alarms and events keep printing.  Every action reads all its typed words
    first and acts only after the last one, so a cancelled prompt has done nothing.  A prompt is
    cancelled when the state it was opened in (:meth:`Console.signature`) changes while it waits, when
    the process stops, or on Ctrl+C / Ctrl+Break.

    ``read_source`` (not Windows): a blocking line reader called in the worker instead.
    """

    def __init__(self, signature: Callable[[], dict[str, Any]], out: Callable[[str], None],
                 read_source: Callable[[], str] | None = None) -> None:
        self.signature = signature
        self.out = out
        self.read_source = read_source
        self.name = ""
        self._thread: threading.Thread | None = None
        self._lines: queue.SimpleQueue = queue.SimpleQueue()
        self._waiting = threading.Event()
        self._opened: dict[str, Any] = {}
        self._result: Any = None
        self._note = ""

    @property
    def busy(self) -> bool:
        return self._thread is not None

    @property
    def waiting(self) -> bool:
        """The action waits for a typed answer (the main loop reads characters only then)."""
        return self._waiting.is_set()

    def start(self, name: str, fn: Callable[[], Any]) -> None:
        """Run ``fn`` in the worker; the state it depends on is taken now."""
        if self._thread is not None:
            raise RuntimeError("a console prompt is already pending")
        self.name, self._opened, self._result, self._note = name, self.signature(), None, ""
        self._lines = queue.SimpleQueue()
        self._thread = threading.Thread(target=self._run, args=(fn,), name=f"console-{name}", daemon=True)
        self._thread.start()

    def _run(self, fn: Callable[[], Any]) -> None:
        try:
            self._result = fn()
        except PromptCancelled as exc:
            self.out(f"prompt cancelled: {exc} - nothing changed{self._note}")
        except Exception:                           # never take the main loop down
            logging.getLogger("vtolgcs.console").exception("console action %r failed", self.name)
        finally:
            self._waiting.clear()

    def changes(self) -> str:
        """The state changes since the prompt opened ('' = none)."""
        now = self.signature()
        return ", ".join(f"{k} {self._opened.get(k)} -> {v}" for k, v in now.items() if v != self._opened.get(k))

    def read_line(self) -> str:
        """The action's ``read_line`` (worker thread): the next answer, or :class:`PromptCancelled`."""
        if self.read_source is not None:
            item: Any = self.read_source()
        else:
            lines = self._lines
            self._waiting.set()
            item = lines.get()
        if isinstance(item, PromptCancelled):
            raise item
        changed = self.changes()
        if changed:                                 # changed between the Enter and this check
            raise PromptCancelled(f"the state changed while it waited ({changed})")
        return item

    def submit(self, line: str) -> None:
        """Main loop: the operator pressed Enter."""
        self._waiting.clear()
        self._lines.put(line)

    def cancel(self, reason: str, note: str = "") -> None:
        """Main loop: cancel the pending prompt (also one the action has not reached yet); ``note`` is
        added to the message."""
        if self._thread is not None:
            self._note = note
            self._waiting.clear()
            self._lines.put(PromptCancelled(reason))

    def poll(self) -> tuple[bool, Any]:
        """``(True, result)`` once, when the action has ended; else ``(False, None)``."""
        t = self._thread
        if t is None or t.is_alive():
            return False, None
        t.join()
        self._thread = None
        return True, self._result

    def join(self, timeout: float) -> None:
        if self._thread is not None:
            self._thread.join(timeout)


def resume_dialog(rt: Runtime, out: Callable[[str], None], read_line: Callable[[], str],
                  interactive: bool) -> ModeResult | None:
    """RESUME (client airborne): live values first, then typed confirmation(s). Nothing is sent before."""
    if not interactive:
        out("RESUME " + NOT_INTERACTIVE + " - nothing sent")
        return None
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


def carrier_only_dialog(rt: Runtime, out: Callable[[str], None], read_line: Callable[[], str],
                        interactive: bool) -> ModeResult | None:
    """Carrier-only sends DISARM: typed NOCLIENT (and LANDED after an FPV stream). Nothing is sent before."""
    if not interactive:
        out("CARRIER-ONLY " + NOT_INTERACTIVE + " - nothing sent")
        return None
    preview = rt.prepare_carrier_only()
    out(preview.text())
    if not preview.ok:
        out("CARRIER-ONLY not possible: " + "; ".join(preview.problems))
        return None
    out("Type NOCLIENT + Enter to confirm that NO client drone is powered or bound to this TX module "
        "(anything else cancels):")
    if read_line().strip() != "NOCLIENT":
        out("CARRIER-ONLY cancelled - nothing sent")
        return None
    landed = False
    if preview.needs_landed_confirm:
        out("An FPV stream ran in this session. Type LANDED + Enter to confirm the client is LANDED and "
            "DISARMED (anything else cancels):")
        if read_line().strip() != "LANDED":
            out("CARRIER-ONLY cancelled - nothing sent")
            return None
        landed = True
    result = rt.confirm_carrier_only(preview.token, no_client_confirmed=True, landed_confirmed=landed)
    if not result.ok:
        out("CARRIER-ONLY refused: " + "; ".join(result.reasons))
    return result


def is_loopback(ip: str) -> bool:
    try:
        return ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return False


def sim_usage_error(args: argparse.Namespace) -> str | None:
    """``--sim`` is confined to a loopback simulator; ``--sim-armed`` needs ``--sim``."""
    if args.sim_armed and not args.sim:
        return "--sim-armed needs --sim"
    if args.sim and args.bridge and not is_loopback(args.bridge[0]):
        return (f"--sim only talks to a simulator on a loopback address; --bridge {args.bridge[0]} is not "
                "loopback (the fake controller must never reach real hardware)")
    return None


def make_sim_controller(cfg: config_mod.Config, sim: bool, sim_armed: bool) -> FakeController | None:
    """The fake controller exists only for ``--sim`` with a loopback bridge."""
    if not sim or not is_loopback(cfg.bridge.ip):
        return None
    il = cfg.interlock
    fake = FakeController(safe_channels(il.arm_channel, il.arm_safe_min_us, il.throttle_channel,
                                        protocol.US_MIN), name="SIM fake EdgeTX Joystick")
    if sim_armed:
        fake.set_channel_us(il.arm_channel, protocol.US_MAX)
        fake.set_channel_us(il.throttle_channel, 1500)
    return fake


def initial_start(args: argparse.Namespace, cfg: config_mod.Config) -> str | None:
    """What to do at launch: None (idle), 'fpv' (normal start), 'resume' or 'carrier_only' (dialogs)."""
    if args.resume:
        return "resume"
    if args.mode in ("fpv", "carrier_only"):
        return args.mode
    if args.mode is None and args.sim and not args.sim_armed and is_loopback(cfg.bridge.ip):
        return "fpv"                                  # simulator acceptance run only
    return None


def is_console(stream: Any) -> bool:
    """True only for a real console.  On Windows ``isatty()`` is also True for ``NUL`` (the UI starts
    its sender with stdin = NUL), so the console mode is checked as well."""
    try:
        if stream is None or not stream.isatty():
            return False
        if sys.platform != "win32":
            return True
        import ctypes
        import msvcrt
        mode = ctypes.c_uint32()
        handle = ctypes.c_void_p(msvcrt.get_osfhandle(stream.fileno()))
        return bool(ctypes.WinDLL("kernel32").GetConsoleMode(handle, ctypes.byref(mode)))
    except (OSError, ValueError, AttributeError):
        return False


def console_input(args: argparse.Namespace) -> tuple[bool, bool]:
    """``(read_keys, interactive)``: whether keys are read, and whether typed confirmations can be.
    ``--no-keys`` (the sender the UI starts, WP15 R1) turns both off."""
    if args.no_keys:
        return False, False
    return is_console(sys.stdout), is_console(sys.stdin)


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


def _read_chars(limit: int = 64) -> list[str]:
    """The characters typed so far, up to and including the first Enter (Windows console)."""
    if sys.platform != "win32":
        return []
    import msvcrt
    out: list[str] = []
    while len(out) < limit and msvcrt.kbhit():
        ch = msvcrt.getwch()
        if ch in ("\x00", "\xe0"):           # function / arrow key prefix
            msvcrt.getwch()
            continue
        out.append(ch)
        if ch in ("\r", "\n"):
            break
    return out


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
    raw = list(sys.argv[1:] if argv is None else argv)
    if raw[:1] == ["--video-fanout"]:                # helper process of the UI (brief R0/R2)
        from .video import fanout_main
        return fanout_main(raw[1:])
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
        from .ui.app import main as ui_main          # the UI process; it starts the sender separately
        return ui_main(args, list(argv) if argv is not None else sys.argv[1:])
    notices: list[str] = []
    try:
        cfg = config_mod.load_config(args.config, notices=notices)
    except config_mod.ConfigError as exc:
        print(f"CONFIG ERROR: {exc}", file=sys.stderr)
        return EXIT_CONFIG
    for line in notices:
        print(f"CONFIG MIGRATED: {line}", file=sys.stderr)
    problem = sim_usage_error(args)
    if problem:
        print(f"USAGE ERROR: {problem}", file=sys.stderr)
        return EXIT_USAGE
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

    if args.sim and not is_loopback(cfg.bridge.ip):     # defence in depth: never reached after the check above
        print("USAGE ERROR: --sim needs a loopback bridge address", file=sys.stderr)
        return EXIT_USAGE
    fake = make_sim_controller(cfg, args.sim, args.sim_armed)
    rt = Runtime(cfg, fake, instance_name=os.environ.get(TEST_INSTANCE_ENV) or DEFAULT_INSTANCE,
                 log_dir=args.log_dir)
    try:
        rt.start()
    except AlreadyRunning as exc:
        print(f"NOT STARTED: {exc}", file=sys.stderr)
        return EXIT_RUNNING
    except OSError as exc:                     # e.g. the configured local UDP port is taken
        print(f"NOT STARTED: {exc}", file=sys.stderr)
        return EXIT_START
    stop_requested = threading.Event()
    control: ControlServer | None = None
    if not args.no_control:
        try:
            control = ControlServer(rt, args.control_file or default_control_file(args.config),
                                    on_stop=stop_requested.set).start()
        except Exception as exc:                # the RC path must still run without it
            print(f"WARNING: control channel not started ({exc}); no UI can attach", file=sys.stderr)
            control = None
    tty = sys.stdout.isatty()                          # display style only
    read_keys, interactive = console_input(args)
    console = Console(rt, fake, tty, interactive)
    # WP16 R1: an action with a prompt runs in a worker; the main loop collects the typed answer itself
    # (Windows console), so it never blocks.  Elsewhere the worker reads stdin itself.
    runner = PromptRunner(console.signature, console.print_line,
                          None if sys.platform == "win32" else console.read_line)
    console.read_line = runner.read_line
    console.print_line(f"vtol-gcs {__version__} headless - bridge {cfg.bridge.ip}:{cfg.bridge.port}"
                       + (f", API {rt.api.base_url}" if rt.api else ", API off")
                       + (f", log {rt.session.path}" if rt.session else "")
                       + (", control channel on" if control else "")
                       + ("  [SIM]" if args.sim else ""))
    if args.no_keys:
        console.print_line("console keys off (--no-keys): control this sender through the UI")
    elif read_keys:
        console.help()
    # Ctrl+C and Ctrl+Break are handled like the key q (typed STOP while streaming), never as an immediate
    # exit (WP15 R2, WP16 R3).  Closing the console window cannot be caught (Windows ends the process).
    interrupted = threading.Event()
    old_handlers: dict[int, Any] = {}
    for signum in (signal.SIGINT, getattr(signal, "SIGBREAK", None)):
        if signum is None:
            continue
        try:
            old_handlers[signum] = signal.signal(signum, lambda signum, frame: interrupted.set())
        except ValueError:                             # not the main thread (in-process callers)
            pass
    if args.camera:
        rt.set_camera(args.camera == "on")
    start = initial_start(args, cfg)
    console.drain()
    if start == "resume":
        runner.start("resume", lambda: resume_dialog(rt, console.print_line, console.read_line, interactive))
    elif start == "carrier_only":
        runner.start("carrier_only",
                     lambda: carrier_only_dialog(rt, console.print_line, console.read_line, interactive))
    elif start == "fpv":
        rt.request_mode(Mode.FPV)
    end = time.monotonic() + args.run_seconds if args.run_seconds else None
    next_line = 0.0
    quit_next = False                                  # Ctrl+C / Ctrl+Break: open the quit prompt next
    discard = False                                    # after a cancel: the typed line up to Enter is ignored

    def cancel(reason: str) -> None:
        nonlocal discard
        if interactive and sys.platform == "win32":    # the word being typed must not become key presses
            discard = True
            runner.cancel(reason, "; what is typed up to the next Enter is ignored")
        else:
            runner.cancel(reason)
    try:
        while (end is None or time.monotonic() < end) and not stop_requested.is_set():
            finished, result = runner.poll()
            if finished:
                console.end_input()
                if result is False:                    # q / Ctrl+C: quit (confirmed, or nothing streamed)
                    break
            if interrupted.is_set():
                interrupted.clear()
                if runner.busy and runner.name == "q":
                    console.print_line("the QUIT prompt is open: type STOP + Enter to quit, anything else cancels")
                else:
                    if runner.busy:
                        cancel("Ctrl+C / Ctrl+Break")
                    quit_next = True
            if runner.busy:
                if runner.waiting:
                    changed = runner.changes()
                    if changed:
                        cancel(f"the state changed while it waited ({changed})")
                    else:
                        for ch in _read_chars():
                            line = console.feed(ch)
                            if line is not None:
                                runner.submit(line)
                                break
            elif quit_next:
                quit_next = discard = False            # the quit prompt takes the rest of the line
                runner.start("q", lambda: console.key("q"))
            elif discard:
                for ch in _read_chars():
                    if console.feed(ch) is not None:
                        discard = False
                        break
            elif read_keys:
                ch = _read_key()
                if ch is not None:
                    runner.start(ch, lambda ch=ch: console.key(ch))
            console.drain()
            if not runner.busy and time.monotonic() >= next_line:     # paused while a prompt is open
                next_line = time.monotonic() + (0.5 if tty else 1.0)
                console.status()
            stop_requested.wait(0.02 if runner.busy else 0.05)        # wakes at once on a control stop
    except KeyboardInterrupt:
        pass
    finally:
        for signum, old in old_handlers.items():
            signal.signal(signum, old)                 # (this process exits next)
        if stop_requested.is_set():
            console.print_line("stop requested through the control channel")
        if rt.sender is not None:
            rt.sender.stop()                           # the RC stream ends first, at once (WP16 R1)
        runner.cancel("the sender is stopping")
        if control is not None:
            control.stop()
        rt.stop()
        runner.join(1.0)
        console.end_input()
        console.drain()
        console.print_line("stopped (RC stream off; the bridge goes to FAILSAFE after T_hold)")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
