"""Local read-only HTTP API, contract C2: ``http://127.0.0.1:47800``.

* ``GET /api/v1/health`` -> ``{"ok": true, "app": "vtol-gcs", "version": "x.y.z"}``
* ``GET /api/v1/status`` -> the C2 Status object
* ``GET /api/v1/events`` -> Server-Sent Events: ``event: status`` at ~5 Hz and
  ``event: alarm`` on every raise/clear (the C2 Alarm object plus ``"active"``).
* CORS: ``Origin`` is reflected only for ``https://melonno.github.io``,
  ``http://localhost[:port]``, ``http://127.0.0.1[:port]`` and ``null`` (file://).
  ``OPTIONS`` answers ``Access-Control-Allow-Methods: GET``,
  ``Access-Control-Allow-Headers: *`` and ``Access-Control-Allow-Private-Network: true``.
* Every response carries ``Cache-Control: no-store``.
* **Read-only**: every method other than GET/OPTIONS gets 405.  Nothing here
  can change the runtime's state.
* Binds 127.0.0.1 only, and rejects a ``Host`` header that is not
  ``127.0.0.1``/``localhost`` (DNS-rebinding guard).
"""

from __future__ import annotations

import json
import logging
import math
import queue
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

log = logging.getLogger("vtolgcs.api")

API_HOST = "127.0.0.1"
API_PORT = 47800
SSE_STATUS_PERIOD_S = 0.2           # C2: status events at ~5 Hz
SSE_MAX_CLIENTS = 4                 # every client costs a status build per 200 ms on the GIL

ALLOWED_ORIGIN = re.compile(r"^(https://melonno\.github\.io|http://localhost(:\d{1,5})?"
                            r"|http://127\.0\.0\.1(:\d{1,5})?|null)$")

_HOST = re.compile(r"^(127\.0\.0\.1|localhost)(?::(\d{1,5}))?$")


def origin_allowed(origin: str | None) -> bool:
    return bool(origin) and ALLOWED_ORIGIN.match(origin) is not None


def _json_safe(value: Any) -> Any:
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def dumps(obj: Any) -> bytes:
    return json.dumps(_json_safe(obj), separators=(",", ":"), allow_nan=False).encode("utf-8")


class EventHub:
    """Fan-out of alarm events to SSE subscribers (bounded queues; a slow client loses events)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subs: list[queue.Queue] = []

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=256)
        with self._lock:
            self._subs.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._subs:
                self._subs.remove(q)

    def publish(self, item: Any) -> None:
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            try:
                q.put_nowait(item)
            except queue.Full:
                pass

    @property
    def subscribers(self) -> int:
        with self._lock:
            return len(self._subs)


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False      # never share 47800 with another process

    def __init__(self, addr: tuple[str, int], status: Callable[[], dict], hub: EventHub, version: str) -> None:
        super().__init__(addr, _Handler)
        self.status_provider = status
        self.hub = hub
        self.version = version
        self.stopping = threading.Event()


class _Handler(BaseHTTPRequestHandler):
    server: _Server
    server_version = "vtol-gcs"
    sys_version = ""

    # -- helpers
    def log_message(self, fmt: str, *args: Any) -> None:  # quiet: route to logging at debug level
        log.debug("%s %s", self.address_string(), fmt % args)

    def _cors(self) -> bool:
        origin = self.headers.get("Origin")
        if origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            return True
        return False

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").strip().lower()
        if not host:
            return True
        m = _HOST.match(host)
        return m is not None and (m.group(2) is None or int(m.group(2)) == self.server.server_port)

    def _send(self, code: int, body: bytes, ctype: str = "application/json", extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self._cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, code: int, message: str, extra: dict | None = None) -> None:
        self._send(code, dumps({"error": message}), extra=extra)

    # -- methods
    def do_GET(self) -> None:  # noqa: N802 - http.server naming
        if not self._host_ok():
            self._error(403, "bad Host header")
            return
        path = self.path.split("?", 1)[0]
        if path == "/api/v1/health":
            self._send(200, dumps({"ok": True, "app": "vtol-gcs", "version": self.server.version}))
        elif path == "/api/v1/status":
            self._send(200, dumps(self.server.status_provider()))
        elif path == "/api/v1/events":
            self._events()
        else:
            self._error(404, "not found")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        if self._cors():
            self.send_header("Access-Control-Allow-Methods", "GET")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def _method_not_allowed(self) -> None:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if 0 < length <= 65536:
            self.rfile.read(length)           # drain, so the client sees the 405 cleanly
        self._error(405, "read-only API: only GET and OPTIONS", {"Allow": "GET, OPTIONS"})

    def __getattr__(self, name: str) -> Any:
        # http.server looks up do_<METHOD>; every method except GET/OPTIONS is answered with 405.
        if name.startswith("do_"):
            return self._method_not_allowed
        raise AttributeError(name)

    def _events(self) -> None:
        if self.server.hub.subscribers >= SSE_MAX_CLIENTS:
            self._error(503, "too many event-stream clients")
            return
        q = self.server.hub.subscribe()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.send_header("X-Accel-Buffering", "no")
            self._cors()
            self.end_headers()
            self.wfile.write(b"retry: 2000\n\n")
            stopping = self.server.stopping
            next_status = 0.0
            while not stopping.is_set():
                now = time.monotonic()
                if now >= next_status:
                    self._sse("status", self.server.status_provider())
                    next_status = now + SSE_STATUS_PERIOD_S
                try:
                    item = q.get(timeout=max(0.0, min(next_status - time.monotonic(), SSE_STATUS_PERIOD_S)))
                except queue.Empty:
                    continue
                self._sse("alarm", item)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass                                # client went away
        finally:
            self.server.hub.unsubscribe(q)
            self.close_connection = True

    def _sse(self, event: str, data: Any) -> None:
        self.wfile.write(b"event: " + event.encode() + b"\ndata: " + dumps(data) + b"\n\n")
        self.wfile.flush()


class ApiServer:
    """The C2 server in a background thread. ``status`` is called for every status response/event."""

    def __init__(self, status: Callable[[], dict], hub: EventHub, version: str,
                 host: str = API_HOST, port: int = API_PORT) -> None:
        self._server = _Server((host, port), status, hub, version)
        self._thread: threading.Thread | None = None

    @property
    def address(self) -> tuple[str, int]:
        return self._server.server_address[:2]  # type: ignore[return-value]

    @property
    def base_url(self) -> str:
        host, port = self.address
        return f"http://{host}:{port}"

    def start(self) -> "ApiServer":
        self._thread = threading.Thread(target=self._server.serve_forever, kwargs={"poll_interval": 0.2},
                                        name="api", daemon=True)
        self._thread.start()
        log.info("local API on %s (read-only)", self.base_url)
        return self

    def stop(self) -> None:
        self._server.stopping.set()
        self._server.shutdown()
        self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None
