"""The UI process's link to the RC sender process (brief R0). No tkinter here.

* **Commands** go through the control channel (:class:`vtolgcs.control.ControlClient`).
* **State** comes from the C2 API (``GET /api/v1/events``, SSE, read-only); when the API is off or
  refuses another event stream, the control command ``status`` is polled instead.
* **Events** (mode, refusals, alarms, CRSF replies, client flight mode) come from a subscribed
  control connection.
* **Liveness:** a ping every second.  When the control channel is gone the state is ``down`` and
  the UI shows "RC SENDER DOWN".  The UI never streams RC itself; if it dies, the sender keeps going.

Callbacks run on the link's threads; the Tk UI hands them to its own thread with a queue.
"""

from __future__ import annotations

import http.client
import json
import logging
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from ..control import ControlClient, ControlError, ControlInfo, EventStream

log = logging.getLogger("vtolgcs.ui.link")

PING_PERIOD_S = 1.0
STATUS_POLL_S = 0.2

#: Options of ``python -m vtolgcs`` that belong to the UI process only (never passed to the sender).
UI_ONLY_FLAGS = {"--run-seconds": 1, "--ui-smoke-out": 1, "--attach-only": 0}


def package_root() -> Path:
    """Folder that contains the ``vtolgcs`` package (source runs put it on PYTHONPATH of children)."""
    return Path(__file__).resolve().parents[2]


def frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def sender_command(passthrough: list[str]) -> list[str]:
    """Command line of the RC sender process (``--headless``)."""
    if frozen():
        return [str(Path(sys.executable).with_name("vtol-gcs-sender.exe")), "--headless", *passthrough]
    return [sys.executable, "-m", "vtolgcs", "--headless", *passthrough]


def fanout_command(listen: int, ports: list[int], control_file: Path | None) -> list[str]:
    """Command line of the video fan-out helper process."""
    args = ["--video-fanout", "--listen", str(listen), "--out", ",".join(str(p) for p in ports)]
    if control_file is not None:
        args += ["--control-file", str(control_file)]
    if frozen():
        return [str(Path(sys.executable).with_name("vtol-gcs-sender.exe")), *args]
    return [sys.executable, "-m", "vtolgcs", *args]


def child_env() -> dict[str, str]:
    env = dict(os.environ)
    if not frozen():
        env["PYTHONPATH"] = str(package_root()) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    return env


def passthrough_args(argv: list[str]) -> list[str]:
    """The UI's arguments minus UI-only ones = the sender's arguments."""
    out, skip = [], 0
    for arg in argv:
        if skip:
            skip -= 1
            continue
        name = arg.split("=", 1)[0]
        if name in UI_ONLY_FLAGS:
            skip = UI_ONLY_FLAGS[name] if "=" not in arg else 0
            continue
        if name == "--headless":
            continue
        out.append(arg)
    return out


def spawn_sender(cmd: list[str]) -> subprocess.Popen:
    """Start the RC sender in its **own console window**, independent of the UI process (if the UI
    dies, the sender keeps streaming; its console also takes typed confirmations)."""
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.CREATE_NEW_CONSOLE | subprocess.CREATE_NEW_PROCESS_GROUP
    return subprocess.Popen(cmd, creationflags=flags, env=child_env(), close_fds=True,
                            cwd=str(package_root()) if not frozen() else None)


def iter_sse(resp: Any) -> Any:
    """Yield ``(event, data_text)`` from an SSE response (http.client)."""
    event, data = "message", []
    while True:
        line = resp.readline()
        if not line:
            return
        line = line.decode("utf-8", "replace").rstrip("\r\n")
        if not line:
            if data:
                yield event, "\n".join(data)
            event, data = "message", []
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())


class RuntimeLink:
    """Connects to the sender named by ``control_file``; keeps reconnecting.

    ``on_status(dict)``, ``on_event(dict)`` and ``on_state(state, detail)`` are called on link threads.
    ``state`` is ``connecting`` | ``up`` | ``down``.
    """

    def __init__(self, control_file: Path, on_status: Callable[[dict], None],
                 on_event: Callable[[dict], None], on_state: Callable[[str, str], None]) -> None:
        self.control_file = Path(control_file)
        self.on_status = on_status
        self.on_event = on_event
        self.on_state = on_state
        self.client: ControlClient | None = None
        self.info: ControlInfo | None = None
        self.hello: dict | None = None
        self.state = "connecting"
        #: before the first connection, "connecting" (not "down") for this long (a sender is starting)
        self.startup_grace_s = 8.0
        self._t0 = time.monotonic()
        self._was_up = False
        self._stop = threading.Event()
        self._session = 0                     # bumps on every (re)connect; old threads exit
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None

    # -- public
    def start(self) -> "RuntimeLink":
        self._thread = threading.Thread(target=self._run, name="ui-link", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            if self.client is not None:
                self.client.close()

    def request(self, cmd: str, **params: Any) -> dict:
        """One command; raises :class:`ControlError` when the sender is not reachable."""
        client = self.client
        if client is None:
            raise ControlError("RC sender not connected")
        return client.request(cmd, **params)

    @property
    def up(self) -> bool:
        return self.state == "up"

    # -- internals
    def _set_state(self, state: str, detail: str = "") -> None:
        if state != self.state or detail:
            self.state = state
            try:
                self.on_state(state, detail)
            except Exception:
                log.exception("on_state failed")

    def _connect(self) -> bool:
        try:
            info = ControlInfo.load(self.control_file)
            client = ControlClient(info, timeout=2.0)
            hello = client.call("hello")
        except ControlError as exc:
            if not self._was_up and time.monotonic() - self._t0 < self.startup_grace_s:
                self._set_state("connecting", "waiting for the RC sender to start")
            else:
                self._set_state("down", str(exc))
            return False
        with self._lock:
            if self.client is not None:
                self.client.close()
            self.client, self.info, self.hello = client, info, hello
            self._session += 1
            session = self._session
        threading.Thread(target=self._events, args=(info, session), name="ui-events", daemon=True).start()
        threading.Thread(target=self._status, args=(session,), name="ui-status", daemon=True).start()
        self._was_up = True
        self._set_state("up", f"sender pid {hello.get('pid')}")
        return True

    def _run(self) -> None:
        while not self._stop.is_set():
            if self.client is None or self.state != "up":
                if not self._connect():
                    self._stop.wait(1.0)
                    continue
            try:
                assert self.client is not None
                self.client.call("ping")
            except (ControlError, AssertionError) as exc:
                self._set_state("down", f"RC sender not answering: {exc}")
                with self._lock:
                    self._session += 1                # stops the event/status threads
                    if self.client is not None:
                        self.client.close()
                    self.client = None
            self._stop.wait(PING_PERIOD_S)

    def _alive(self, session: int) -> bool:
        return not self._stop.is_set() and session == self._session

    def _events(self, info: ControlInfo, session: int) -> None:
        try:
            stream = EventStream(info)
        except ControlError as exc:
            log.warning("event stream: %s", exc)
            return
        try:
            while self._alive(session):
                try:
                    ev = stream.get(0.5)
                except ControlError:
                    self._set_state("down", "RC sender closed the event stream")
                    return
                if ev and ev.get("event") != "keepalive":
                    try:
                        self.on_event(ev)
                    except Exception:
                        log.exception("on_event failed")
        finally:
            stream.close()

    def _status(self, session: int) -> None:
        api = (self.hello or {}).get("api")
        while self._alive(session):
            if api:
                try:
                    self._sse(api, session)
                except (OSError, http.client.HTTPException, ValueError) as exc:
                    log.info("C2 event stream unavailable (%s); polling the control channel", exc)
                    api = None
                continue
            try:
                self.on_status(self.request("status")["result"])
            except (ControlError, KeyError, TypeError):
                pass
            self._stop.wait(STATUS_POLL_S)

    def _sse(self, base: str, session: int) -> None:
        u = urlparse(base)
        conn = http.client.HTTPConnection(u.hostname, u.port, timeout=3)
        try:
            conn.request("GET", "/api/v1/events")
            resp = conn.getresponse()
            if resp.status != 200:
                raise ValueError(f"HTTP {resp.status}")
            for event, data in iter_sse(resp):
                if not self._alive(session):
                    return
                if event == "status":
                    try:
                        self.on_status(json.loads(data))
                    except Exception:
                        log.exception("on_status failed")
            raise OSError("event stream ended")
        finally:
            conn.close()


def wait_until(cond: Callable[[], bool], timeout: float, step: float = 0.05) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(step)
    return cond()


__all__ = ["RuntimeLink", "child_env", "fanout_command", "iter_sse", "passthrough_args", "sender_command",
           "spawn_sender", "wait_until"]
