"""Local API (contract C2): routes, exact Status shape, CORS/PNA, no-store, read-only 405, SSE (brief R10)."""

from __future__ import annotations

import http.client
import json
import uuid

import pytest

from _c2 import assert_c2_status
from vtolgcs import __version__
from vtolgcs.api import ApiServer, EventHub, origin_allowed
from vtolgcs.config import Config
from vtolgcs.controller import FakeController
from vtolgcs.runtime import Runtime


@pytest.fixture(scope="module")
def runtime():
    """A real runtime (no bridge present, API on a free port) so /status is the real C2 object."""
    cfg = Config()
    cfg.bridge.ip, cfg.bridge.port = "127.0.0.1", 9          # discard port: nobody answers
    cfg.api.port = 0
    cfg.mavlink.listen_port = 0
    cfg.log.enabled = False
    rt = Runtime(cfg, FakeController(), instance_name=f"vtol-gcs-test-{uuid.uuid4().hex}")
    rt.start()
    yield rt
    rt.stop()


def request(rt: Runtime, method: str, path: str, headers: dict | None = None,
            body: bytes | None = None) -> tuple[int, dict, bytes]:
    host, port = rt.api.address
    conn = http.client.HTTPConnection(host, port, timeout=5)
    try:
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        return resp.status, {k.lower(): v for k, v in resp.getheaders()}, resp.read()
    finally:
        conn.close()


def test_health(runtime) -> None:
    code, h, body = request(runtime, "GET", "/api/v1/health")
    assert code == 200 and json.loads(body) == {"ok": True, "app": "vtol-gcs", "version": __version__}
    assert h["cache-control"] == "no-store" and h["content-type"] == "application/json"


def test_status_shape_matches_c2_exactly(runtime) -> None:
    code, h, body = request(runtime, "GET", "/api/v1/status")
    assert code == 200 and h["cache-control"] == "no-store"
    status = json.loads(body)
    assert_c2_status(status)
    assert status["app"] == {"version": __version__, "mode": "idle", "streaming": False, "start_path": None}
    assert status["bridge"]["state"] == "UNREACHABLE"            # idle: the bridge has never heard us
    assert status["controller"]["connected"] is True and status["controller"]["arm_switch_safe"] is True


@pytest.mark.parametrize("origin", ["https://melonno.github.io", "http://localhost:8000", "http://localhost",
                                    "http://127.0.0.1:5500", "http://127.0.0.1", "null"])
def test_cors_reflects_allowed_origins(runtime, origin: str) -> None:
    code, h, _ = request(runtime, "GET", "/api/v1/status", {"Origin": origin})
    assert code == 200 and h["access-control-allow-origin"] == origin and h["vary"] == "Origin"


@pytest.mark.parametrize("origin", ["https://evil.example", "https://melonno.github.io.evil.example",
                                    "http://melonno.github.io", "http://localhost.evil:80", "https://localhost:8000"])
def test_cors_denies_other_origins(runtime, origin: str) -> None:
    code, h, _ = request(runtime, "GET", "/api/v1/status", {"Origin": origin})
    assert code == 200 and "access-control-allow-origin" not in h
    assert not origin_allowed(origin)


def test_preflight_with_private_network_access(runtime) -> None:
    code, h, body = request(runtime, "OPTIONS", "/api/v1/events", {
        "Origin": "https://melonno.github.io", "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true"})
    assert code == 204 and body == b""
    assert h["access-control-allow-origin"] == "https://melonno.github.io"
    assert h["access-control-allow-methods"] == "GET"
    assert h["access-control-allow-headers"] == "*"
    assert h["access-control-allow-private-network"] == "true"
    assert h["cache-control"] == "no-store"


def test_preflight_from_other_origin_gets_no_cors(runtime) -> None:
    code, h, _ = request(runtime, "OPTIONS", "/api/v1/status", {"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in h and "access-control-allow-private-network" not in h


@pytest.mark.parametrize("method", ["POST", "PUT", "DELETE", "PATCH", "HEAD", "TRACE", "FOO"])
def test_read_only_every_other_method_is_405(runtime, method: str) -> None:
    code, h, body = request(runtime, method, "/api/v1/status", {"Origin": "http://localhost:8000"},
                            body=b'{"mode":"fpv"}' if method in ("POST", "PUT", "PATCH") else None)
    assert code == 405 and h["allow"] == "GET, OPTIONS" and h["cache-control"] == "no-store"
    assert h["access-control-allow-origin"] == "http://localhost:8000"
    assert runtime.sender.state().mode.value == "idle"          # nothing changed


def test_unknown_path_404(runtime) -> None:
    code, h, body = request(runtime, "GET", "/api/v1/mode")
    assert code == 404 and json.loads(body)["error"] == "not found"


def test_bad_host_header_rejected(runtime) -> None:
    host, port = runtime.api.address
    conn = http.client.HTTPConnection(host, port, timeout=5)
    conn.putrequest("GET", "/api/v1/status", skip_host=True)
    conn.putheader("Host", f"evil.example:{port}")
    conn.endheaders()
    assert conn.getresponse().status == 403
    conn.close()
    code, _, _ = request(runtime, "GET", "/api/v1/health", {"Host": f"localhost:{port}"})
    assert code == 200


def _read_event(resp: http.client.HTTPResponse) -> tuple[str, dict]:
    event, data = None, None
    while True:
        line = resp.fp.readline().decode().rstrip("\n")
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            data = json.loads(line[6:])
        elif line == "" and event is not None:
            return event, data


def test_sse_status_and_alarm_events(runtime) -> None:
    host, port = runtime.api.address
    conn = http.client.HTTPConnection(host, port, timeout=5)
    conn.request("GET", "/api/v1/events", headers={"Origin": "https://melonno.github.io"})
    resp = conn.getresponse()
    try:
        assert resp.status == 200
        assert resp.getheader("Content-Type") == "text/event-stream"
        assert resp.getheader("Cache-Control") == "no-store"
        assert resp.getheader("Access-Control-Allow-Origin") == "https://melonno.github.io"
        kind, data = _read_event(resp)
        assert kind == "status"
        assert_c2_status(data)
        kind, _ = _read_event(resp)
        assert kind == "status"                                   # periodic (~5 Hz)
        alarm = {"id": "client_failsafe", "severity": "crit", "text": "FPV FAILSAFE",
                 "since": "2026-10-16T12:00:00.000Z", "active": True}
        runtime.hub.publish(alarm)
        for _ in range(10):
            kind, data = _read_event(resp)
            if kind == "alarm":
                break
        assert kind == "alarm" and data == alarm
    finally:
        conn.close()


def test_server_on_its_own_and_port_in_use() -> None:
    hub = EventHub()
    srv = ApiServer(lambda: {"x": float("nan")}, hub, "9.9.9", port=0).start()
    try:
        host, port = srv.address
        conn = http.client.HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/api/v1/status")
        assert json.loads(conn.getresponse().read()) == {"x": None}     # never emits invalid JSON
        conn.close()
        with pytest.raises(OSError):
            ApiServer(lambda: {}, hub, "9.9.9", port=port)               # 47800 can't be shared
    finally:
        srv.stop()


def test_sse_client_cap(runtime) -> None:
    host, port = runtime.api.address
    import time
    end = time.time() + 3
    while runtime.hub.subscribers and time.time() < end:     # streams of earlier tests close lazily
        time.sleep(0.05)
    conns = []
    try:
        for _ in range(4):
            c = http.client.HTTPConnection(host, port, timeout=5)
            c.request("GET", "/api/v1/events")
            r = c.getresponse()
            assert r.status == 200
            r.fp.readline()                                   # stream is open
            conns.append(c)
        code, _, body = request(runtime, "GET", "/api/v1/events")
        assert code == 503 and b"too many" in body
    finally:
        for c in conns:
            c.close()


def test_malformed_content_length_still_405(runtime) -> None:
    import socket as _socket
    host, port = runtime.api.address
    with _socket.create_connection((host, port), timeout=5) as s:
        s.sendall(b"POST /api/v1/status HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: abc\r\n\r\n")
        assert s.recv(200).startswith(b"HTTP/1.0 405")
