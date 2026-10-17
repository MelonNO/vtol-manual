"""Local control channel between the RC sender process and the UI process (WP08b brief R0).

The RC sender (:class:`vtolgcs.runtime.Runtime`, ``python -m vtolgcs --headless``) runs in its own
process.  The UI, the video helper, the Mission Planner output and the ELRS menu run in another
process: they read state from the C2 API (read-only) and send operator commands here.

Transport
    A Windows **named pipe** (``\\\\.\\pipe\\vtol-gcs-ctl-<random>``; ``127.0.0.1`` TCP on other
    systems, for the tests) through :mod:`multiprocessing.connection`, with an HMAC challenge on the
    random per-session **token** (``authkey``).  Browsers cannot open a named pipe, and nothing here
    speaks HTTP, so the channel is not reachable from web pages (no CORS).

Control file
    ``control.json`` next to the config file (default ``%APPDATA%\\vtol-gcs\\control.json``):
    ``{"app", "control_version", "family", "address", "token", "pid", "api"}``.  It is created with
    an ACL that grants access to the current user only (Windows; ``0600`` elsewhere) and deleted
    when the runtime stops.

Messages
    Each message is one JSON object (UTF-8) sent with ``send_bytes``.  Requests
    ``{"id": n, "cmd": "...", ...}`` get one reply ``{"id": n, "ok": bool, "result": {...},
    "reasons": [...], "error": "..."}``.  After ``{"cmd": "subscribe"}`` the connection only carries
    events ``{"event": kind, "t": runtime_time_s, "data": {...}}``.  The commands are listed in
    :data:`COMMANDS` and in ``gcs/README.md`` ("Control channel").

Safety
    The channel adds **no** way around a guard.  It calls the same runtime methods as the console:
    RESUME, NOCLIENT, LANDED and THROTTLE confirmations are typed in the UI and forwarded
    **verbatim**; the runtime compares them with the exact words and the sender re-checks every
    interlock.  ``stop`` while streaming needs the typed word ``STOP``.  Work done here is small
    (JSON, queue puts) so the RC thread is not delayed.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import secrets
import sys
import threading
import time
from dataclasses import dataclass
from multiprocessing.connection import Client, Connection, Listener
from pathlib import Path
from typing import Any, Callable

from . import __version__

log = logging.getLogger("vtolgcs.control")

CONTROL_VERSION = 1
CONTROL_FILE_NAME = "control.json"
MAX_MESSAGE = 65536
MAX_CONNECTIONS = 8
EVENT_QUEUE_MAX = 2000

#: Exact words the operator types (the runtime compares them after stripping whitespace).
WORD_RESUME, WORD_THROTTLE, WORD_NOCLIENT, WORD_LANDED, WORD_STOP = "RESUME", "THROTTLE", "NOCLIENT", "LANDED", "STOP"


class ControlError(RuntimeError):
    """The control channel is unavailable (runtime down, bad file, timeout)."""


# --------------------------------------------------------------------------- the control file

def default_control_file(config_path: Path | None) -> Path:
    """``control.json`` next to the config file (``%APPDATA%\\vtol-gcs`` by default)."""
    from .config import default_config_path
    return Path(config_path or default_config_path()).parent / CONTROL_FILE_NAME


def _restrict_to_user(path: Path) -> None:
    """Give the current user (only) full access to ``path``."""
    if sys.platform != "win32":
        os.chmod(path, 0o600)
        return
    import ctypes
    from ctypes import wintypes
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi32.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
                                             ctypes.POINTER(wintypes.DWORD)]
    advapi32.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_wchar_p)]
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        ctypes.c_wchar_p, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p]
    advapi32.SetFileSecurityW.argtypes = [ctypes.c_wchar_p, wintypes.DWORD, ctypes.c_void_p]
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0008, ctypes.byref(token)):  # TOKEN_QUERY
        raise OSError(ctypes.get_last_error(), "OpenProcessToken failed")
    try:
        size = wintypes.DWORD(0)
        advapi32.GetTokenInformation(token, 1, None, 0, ctypes.byref(size))                       # TokenUser
        buf = ctypes.create_string_buffer(size.value)
        if not advapi32.GetTokenInformation(token, 1, buf, size, ctypes.byref(size)):
            raise OSError(ctypes.get_last_error(), "GetTokenInformation failed")
        psid = ctypes.c_void_p.from_buffer(buf).value                 # TOKEN_USER.User.Sid
        sid_str = ctypes.c_wchar_p()
        if not advapi32.ConvertSidToStringSidW(psid, ctypes.byref(sid_str)):
            raise OSError(ctypes.get_last_error(), "ConvertSidToStringSidW failed")
        sid = sid_str.value
        kernel32.LocalFree(ctypes.cast(sid_str, ctypes.c_void_p))
    finally:
        kernel32.CloseHandle(token)
    sd = ctypes.c_void_p()
    # D:P = protected DACL (no inherited entries); one entry: full access for this user only.
    if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(f"D:P(A;;FA;;;{sid})", 1,
                                                                         ctypes.byref(sd), None):
        raise OSError(ctypes.get_last_error(), "ConvertStringSecurityDescriptorToSecurityDescriptorW failed")
    try:
        if not advapi32.SetFileSecurityW(str(path), 0x00000004, sd):                       # DACL_SECURITY_INFORMATION
            raise OSError(ctypes.get_last_error(), "SetFileSecurityW failed")
    finally:
        kernel32.LocalFree(sd)


def write_private_file(path: Path, text: str) -> None:
    """Write ``text`` to ``path`` so that only the current user can read it (ACL set before the token
    is written; the file is then moved into place, which keeps its ACL)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    tmp.write_bytes(b"")
    try:
        _restrict_to_user(tmp)
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


@dataclass(frozen=True)
class ControlInfo:
    family: str                       # 'AF_PIPE' | 'AF_INET'
    address: Any                      # pipe name, or (host, port)
    token: str
    pid: int
    api: str | None                   # C2 base URL, e.g. http://127.0.0.1:47800 (None = API off)
    version: str = __version__

    def to_json(self) -> str:
        addr = list(self.address) if isinstance(self.address, tuple) else self.address
        return json.dumps({"app": "vtol-gcs", "control_version": CONTROL_VERSION, "family": self.family,
                           "address": addr, "token": self.token, "pid": self.pid, "api": self.api,
                           "version": self.version}, indent=2)

    @classmethod
    def load(cls, path: Path) -> "ControlInfo":
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            addr = data["address"]
            if data.get("control_version") != CONTROL_VERSION:
                raise ControlError(f"control channel version {data.get('control_version')} not supported")
            return cls(data["family"], tuple(addr) if isinstance(addr, list) else addr, data["token"],
                       int(data["pid"]), data.get("api"), data.get("version", "?"))
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise ControlError(f"no usable control file {path}: {exc}") from exc


# --------------------------------------------------------------------------- server (runtime process)

def _close(conn: Connection | None) -> None:
    """Close quietly (a connection may be closed by two threads at shutdown)."""
    if conn is None:
        return
    try:
        conn.close()
    except (OSError, TypeError, AttributeError):
        pass


#: Command name -> one-line description (documented in gcs/README.md).
COMMANDS = {
    "hello": "app, version, pid, runtime time, API URL",
    "ping": "liveness; returns the runtime time",
    "status": "the C2 status object (fallback when the HTTP API is off)",
    "request_mode": "mode = fpv (normal start, interlock) | idle",
    "prepare_resume": "RESUME step 1: live arm/throttle preview (sends nothing)",
    "confirm_resume": "RESUME step 2: token, typed (= RESUME), throttle_typed (= THROTTLE at minimum)",
    "prepare_carrier_only": "carrier-only step 1: preview (sends nothing)",
    "confirm_carrier_only": "carrier-only step 2: token, typed (= NOCLIENT), landed_typed (= LANDED)",
    "set_camera": "on = true | false (camera interlock applies)",
    "stop": "stop the RC sender process; typed = STOP while streaming",
    "inputs": "controller snapshot, raw axes/buttons (channel monitor, wizard)",
    "rtt_samples": "RTT samples (runtime time, ms) newer than since",
    "crsf_send": "frame = hex CRSF frame -> crsf_pass (ping / parameter read / write; guarded)",
    "video_report": "rx_kbps from the video fan-out (fills C2 video.rx_kbps)",
    "set_client_profile": "profile_id, cells (C2 client.profile_id, battery alarm cells)",
    "log": "type = test_*, fields: append a test result to the session log",
    "subscribe": "turn this connection into an event stream",
}


def _words(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _resume_preview(p: Any) -> dict:
    return {"token": p.token, "ok": p.ok, "problems": list(p.problems), "text": p.text(),
            "arm_channel": p.arm_channel, "arm_us": p.arm_us, "throttle_channel": p.throttle_channel,
            "throttle_us": p.throttle_us, "arm_armed": p.arm_armed, "throttle_at_min": p.throttle_at_min,
            "needs_throttle_confirm": p.needs_throttle_confirm}


def _co_preview(p: Any) -> dict:
    return {"token": p.token, "ok": p.ok, "problems": list(p.problems), "text": p.text(),
            "client_heard_s": p.client_heard_s, "fpv_this_session": p.fpv_this_session,
            "needs_landed_confirm": p.needs_landed_confirm}


def _mode_result(r: Any) -> dict:
    return {"ok": r.ok, "result": {"mode": r.mode.value}, "reasons": list(r.reasons)}


class ControlServer:
    """Serves the control channel for one :class:`Runtime` (started after the runtime).

    ``on_stop`` is called when an authorised client asks the process to stop.
    """

    def __init__(self, rt: Any, control_file: Path, *, on_stop: Callable[[], None] | None = None,
                 family: str | None = None) -> None:
        self.rt = rt
        self.control_file = Path(control_file)
        self.on_stop = on_stop
        self.family = family or ("AF_PIPE" if sys.platform == "win32" else "AF_INET")
        self.token = secrets.token_hex(32)
        self._listener: Listener | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._conns: list[Connection] = []
        self._subs: list[queue.Queue] = []
        self.dropped_events = 0
        self.info: ControlInfo | None = None
        self._thread: threading.Thread | None = None

    # -- lifecycle
    def start(self) -> "ControlServer":
        if self.family == "AF_PIPE":
            address: Any = r"\\.\pipe\vtol-gcs-ctl-" + secrets.token_hex(8)
        else:
            address = ("127.0.0.1", 0)
        self._listener = Listener(address, family=self.family, authkey=self.token.encode())
        addr = self._listener.address
        api = self.rt.api.base_url if getattr(self.rt, "api", None) is not None else None
        self.info = ControlInfo(self.family, addr, self.token, os.getpid(), api)
        write_private_file(self.control_file, self.info.to_json())
        self.rt.add_listener(self._on_runtime_event)
        self.rt.add_crsf_listener(self._on_crsf)
        self._thread = threading.Thread(target=self._accept_loop, name="control-accept", daemon=True)
        self._thread.start()
        log.info("control channel on %s (file %s)", addr, self.control_file)
        return self

    def stop(self) -> None:
        if self._stop.is_set():
            return
        self._stop.set()
        try:                                       # remove the file only if it is still ours
            if ControlInfo.load(self.control_file).token == self.token:
                self.control_file.unlink()
        except (ControlError, OSError):
            pass
        if self._listener is not None and self.info is not None:
            try:                                   # unblock accept(): a pipe accept cannot be interrupted
                Client(self.info.address, family=self.family, authkey=self.token.encode()).close()
            except Exception:
                pass
            try:
                self._listener.close()
            except OSError:
                pass
        with self._lock:
            conns, self._conns = list(self._conns), []
            for q in self._subs:
                q.put_nowait(None)
        for c in conns:
            _close(c)
        if self._thread is not None:
            self._thread.join(timeout=2)

    # -- runtime callbacks (runtime threads: queue puts only)
    def _publish(self, kind: str, data: dict) -> None:
        msg = {"event": kind, "t": self.rt.now(), "data": data}
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            try:
                q.put_nowait(msg)
            except queue.Full:
                self.dropped_events += 1

    def _on_runtime_event(self, kind: str, data: dict) -> None:
        self._publish(kind, data)

    def _on_crsf(self, frame: Any) -> None:
        if frame.is_extended:                      # menu replies: device info, parameter entries, status
            self._publish("crsf", {"frame": frame.raw.hex()})

    # -- connections
    def _accept_loop(self) -> None:
        assert self._listener is not None
        while not self._stop.is_set():
            try:
                conn = self._listener.accept()
            except Exception as exc:               # bad token, client gone, listener closed
                if self._stop.is_set():
                    break
                log.warning("control channel: connection refused (%s)", type(exc).__name__)
                continue
            if self._stop.is_set():
                conn.close()
                break
            with self._lock:
                if len(self._conns) >= MAX_CONNECTIONS:
                    conn.close()
                    continue
                self._conns.append(conn)
            threading.Thread(target=self._serve, args=(conn,), name="control-conn", daemon=True).start()

    def _serve(self, conn: Connection) -> None:
        try:
            while not self._stop.is_set():
                try:
                    raw = conn.recv_bytes(MAX_MESSAGE)
                except (EOFError, OSError):
                    return
                try:
                    req = json.loads(raw.decode("utf-8"))
                    if not isinstance(req, dict):
                        raise ValueError("request must be a JSON object")
                except (ValueError, UnicodeDecodeError) as exc:
                    conn.send_bytes(json.dumps({"id": None, "ok": False, "error": f"bad request: {exc}"}).encode())
                    continue
                if req.get("cmd") == "subscribe":
                    self._stream(conn, req.get("id"))
                    return
                reply = self.handle(req)
                reply["id"] = req.get("id")
                conn.send_bytes(json.dumps(reply, default=str).encode("utf-8"))
        except (EOFError, OSError):
            pass
        finally:
            with self._lock:
                if conn in self._conns:
                    self._conns.remove(conn)
            _close(conn)

    def _stream(self, conn: Connection, req_id: Any) -> None:
        q: queue.Queue = queue.Queue(maxsize=EVENT_QUEUE_MAX)
        with self._lock:
            self._subs.append(q)
        try:
            conn.send_bytes(json.dumps({"id": req_id, "ok": True, "result": {"t": self.rt.now()}}).encode())
            while not self._stop.is_set():
                try:
                    msg = q.get(timeout=1.0)
                except queue.Empty:
                    msg = {"event": "keepalive", "t": self.rt.now(), "data": {}}
                if msg is None:
                    return
                conn.send_bytes(json.dumps(msg, default=str).encode("utf-8"))
        except (EOFError, OSError):
            pass
        finally:
            with self._lock:
                if q in self._subs:
                    self._subs.remove(q)

    # -- commands
    def handle(self, req: dict) -> dict:
        """One request -> reply dict (``ok`` plus ``result`` / ``reasons`` / ``error``)."""
        cmd = req.get("cmd")
        fn = getattr(self, f"_cmd_{cmd}", None) if isinstance(cmd, str) and cmd in COMMANDS else None
        if fn is None:
            return {"ok": False, "error": f"unknown command {cmd!r}"}
        try:
            return fn(req)
        except (ValueError, TypeError) as exc:
            return {"ok": False, "error": f"{cmd}: {exc}"}
        except Exception as exc:                   # never let a command kill the connection thread
            log.exception("control command %s failed", cmd)
            return {"ok": False, "error": f"{cmd}: internal error {type(exc).__name__}: {exc}"}

    def _refused(self, requested: str, reasons: list[str]) -> dict:
        self.rt._log("interlock_refused", requested=requested, reasons=reasons,
                     **{"from": self.rt.sender.state().mode.value, "via": "control"})
        return {"ok": False, "reasons": reasons}

    def _cmd_hello(self, req: dict) -> dict:
        return {"ok": True, "result": {"app": "vtol-gcs", "version": __version__, "control_version": CONTROL_VERSION,
                                       "pid": os.getpid(), "t": self.rt.now(), "api": self.info.api if self.info else None,
                                       "bridge": "%s:%d" % tuple(self.rt.bridge_addr)}}

    def _cmd_ping(self, req: dict) -> dict:
        return {"ok": True, "result": {"t": self.rt.now()}}

    def _cmd_status(self, req: dict) -> dict:
        from .runtime import STATUS_CACHE_S
        return {"ok": True, "result": self.rt.status(STATUS_CACHE_S)}

    def _cmd_request_mode(self, req: dict) -> dict:
        from .sender import Mode
        mode = req.get("mode")
        if mode not in [m.value for m in Mode]:
            raise ValueError(f"mode must be one of {[m.value for m in Mode]}")
        return _mode_result(self.rt.request_mode(Mode(mode)))

    def _cmd_prepare_resume(self, req: dict) -> dict:
        return {"ok": True, "result": _resume_preview(self.rt.prepare_resume())}

    def _cmd_confirm_resume(self, req: dict) -> dict:
        if _words(req.get("typed")) != WORD_RESUME:
            return self._refused("resume", [f"typed confirmation is not {WORD_RESUME}: nothing sent"])
        token = req.get("token")
        if not isinstance(token, int) or isinstance(token, bool):
            raise ValueError("token must be an integer")
        throttle_ok = _words(req.get("throttle_typed")) == WORD_THROTTLE
        return _mode_result(self.rt.confirm_resume(token, throttle_min_confirmed=throttle_ok))

    def _cmd_prepare_carrier_only(self, req: dict) -> dict:
        return {"ok": True, "result": _co_preview(self.rt.prepare_carrier_only())}

    def _cmd_confirm_carrier_only(self, req: dict) -> dict:
        if _words(req.get("typed")) != WORD_NOCLIENT:
            return self._refused("carrier_only", [f"typed confirmation is not {WORD_NOCLIENT}: nothing sent"])
        token = req.get("token")
        if not isinstance(token, int) or isinstance(token, bool):
            raise ValueError("token must be an integer")
        landed = _words(req.get("landed_typed")) == WORD_LANDED
        return _mode_result(self.rt.confirm_carrier_only(token, no_client_confirmed=True, landed_confirmed=landed))

    def _cmd_set_camera(self, req: dict) -> dict:
        on = req.get("on")
        if not isinstance(on, bool):
            raise ValueError("on must be true or false")
        r = self.rt.set_camera(on)
        return {"ok": r.ok, "result": {"requested": r.requested}, "reasons": list(r.reasons)}

    def _cmd_stop(self, req: dict) -> dict:
        if self.rt.sender.state().streaming and _words(req.get("typed")) != WORD_STOP:
            return self._refused("stop", [f"the RC stream is running: stopping the sender ends it (client "
                                          f"failsafe); type {WORD_STOP} to confirm"])
        self.rt._log("control_stop", streaming=self.rt.sender.state().streaming)
        if self.on_stop is None:
            return {"ok": False, "error": "stop is not available in this process"}
        self.on_stop()
        return {"ok": True, "result": {}}

    def _cmd_inputs(self, req: dict) -> dict:
        return {"ok": True, "result": self.rt.inputs()}

    def _cmd_rtt_samples(self, req: dict) -> dict:
        since = req.get("since")
        if since is not None and (isinstance(since, bool) or not isinstance(since, (int, float))):
            raise ValueError("since must be a number")
        return {"ok": True, "result": {"t": self.rt.now(), "samples": self.rt.rtt_samples(since)}}

    def _cmd_crsf_send(self, req: dict) -> dict:
        frame = bytes.fromhex(str(req.get("frame", "")))
        ok, reasons = self.rt.send_crsf(frame)
        return {"ok": ok, "result": {"t": self.rt.now()}, "reasons": reasons}

    def _cmd_video_report(self, req: dict) -> dict:
        self.rt.report_video(req.get("rx_kbps"))
        return {"ok": True, "result": {}}

    def _cmd_set_client_profile(self, req: dict) -> dict:
        self.rt.set_client_profile(req.get("profile_id"), req.get("cells"))
        return {"ok": True, "result": {}}

    def _cmd_log(self, req: dict) -> dict:
        self.rt.log_record(req.get("type"), req.get("fields") or {})
        return {"ok": True, "result": {}}


# --------------------------------------------------------------------------- client (UI process)

def _connect(info: ControlInfo, timeout: float) -> Connection:
    """Connect with a timeout (the handshake blocks if the server is wedged)."""
    box: dict[str, Any] = {}

    def run() -> None:
        try:
            box["conn"] = Client(info.address, family=info.family, authkey=info.token.encode())
        except BaseException as exc:               # noqa: BLE001 - reported below
            box["error"] = exc
    th = threading.Thread(target=run, name="control-connect", daemon=True)
    th.start()
    th.join(timeout)
    if "conn" in box:
        return box["conn"]
    if th.is_alive():
        raise ControlError("control channel: connect timed out")
    raise ControlError(f"control channel: cannot connect ({box.get('error')!r})")


class ControlClient:
    """Request/reply client. Thread-safe (one request at a time)."""

    def __init__(self, info: ControlInfo, timeout: float = 3.0) -> None:
        self.info = info
        self.timeout = timeout
        self._lock = threading.Lock()
        self._conn: Connection | None = None
        self._next_id = 0

    @classmethod
    def from_file(cls, path: Path, timeout: float = 3.0) -> "ControlClient":
        return cls(ControlInfo.load(path), timeout)

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                _close(self._conn)
                self._conn = None

    def request(self, cmd: str, **params: Any) -> dict:
        """Send one command; returns the reply dict.  Raises :class:`ControlError` if the runtime is gone."""
        with self._lock:
            if self._conn is None:
                self._conn = _connect(self.info, self.timeout)
            self._next_id += 1
            msg = {"id": self._next_id, "cmd": cmd, **params}
            try:
                self._conn.send_bytes(json.dumps(msg).encode("utf-8"))
                if not self._conn.poll(self.timeout):
                    raise ControlError(f"control channel: no reply to {cmd} within {self.timeout:.0f} s")
                reply = json.loads(self._conn.recv_bytes(MAX_MESSAGE).decode("utf-8"))
            except (EOFError, OSError, ValueError, ControlError) as exc:
                _close(self._conn)
                self._conn = None
                if isinstance(exc, ControlError):
                    raise
                raise ControlError(f"control channel lost ({type(exc).__name__}: {exc})") from exc
        if reply.get("id") != msg["id"]:
            raise ControlError("control channel: reply out of order")
        return reply

    def call(self, cmd: str, **params: Any) -> Any:
        """Like :meth:`request` but returns ``result`` and raises :class:`ControlError` on ``error``."""
        reply = self.request(cmd, **params)
        if reply.get("error"):
            raise ControlError(reply["error"])
        return reply.get("result")


class EventStream:
    """A subscribed connection: :meth:`get` returns the next event dict, or None on timeout."""

    def __init__(self, info: ControlInfo, timeout: float = 3.0) -> None:
        self._conn = _connect(info, timeout)
        self._conn.send_bytes(json.dumps({"id": 0, "cmd": "subscribe"}).encode())
        if not self._conn.poll(timeout):
            self.close()
            raise ControlError("control channel: subscribe not answered")
        ack = json.loads(self._conn.recv_bytes(MAX_MESSAGE).decode("utf-8"))
        if not ack.get("ok"):
            self.close()
            raise ControlError(f"control channel: subscribe refused: {ack}")

    def get(self, timeout: float = 1.0) -> dict | None:
        """Next event; raises :class:`ControlError` when the runtime closed the stream."""
        try:
            if not self._conn.poll(timeout):
                return None
            return json.loads(self._conn.recv_bytes(MAX_MESSAGE).decode("utf-8"))
        except (EOFError, OSError, ValueError) as exc:
            raise ControlError(f"event stream closed ({type(exc).__name__})") from exc

    def close(self) -> None:
        _close(self._conn)


def wait_for_control_file(path: Path, timeout: float, not_pid: int | None = None) -> ControlInfo | None:
    """Wait until a control file appears (after spawning the runtime). Returns it, or None."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            info = ControlInfo.load(path)
            if not_pid is None or info.pid != not_pid:
                return info
        except ControlError:
            pass
        time.sleep(0.1)
    return None


__all__ = ["COMMANDS", "CONTROL_FILE_NAME", "CONTROL_VERSION", "ControlClient", "ControlError", "ControlInfo",
           "ControlServer", "EventStream", "WORD_LANDED", "WORD_NOCLIENT", "WORD_RESUME", "WORD_STOP",
           "WORD_THROTTLE", "default_control_file", "wait_for_control_file", "write_private_file"]
