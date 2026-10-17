"""Video helper (brief R2/R9): pipelines for PAL/NTSC, SDP, standard choice, GStreamer search, fan-out."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

from vtolgcs import video as V

GCS_DIR = Path(__file__).resolve().parents[1]
CONTENT_JS = GCS_DIR.parent / "data" / "content.js"
CAPS = 'caps="application/x-rtp,media=video,clock-rate=90000,encoding-name=H264,payload=96"'
DEC = "rtph264depay ! h264parse ! avdec_h264 max-threads=1 ! videoconvert ! videoscale"


def test_viewer_pipelines_pal_ntsc() -> None:
    assert V.viewer_pipeline("PAL") == (f"gst-launch-1.0 udpsrc port=5601 {CAPS} ! {DEC} ! "
                                        "video/x-raw,width=768,height=576 ! autovideosink sync=false")
    assert V.viewer_pipeline("NTSC") == (f"gst-launch-1.0 udpsrc port=5601 {CAPS} ! {DEC} ! "
                                         "video/x-raw,width=640,height=480 ! autovideosink sync=false")


def test_mp_hud_pipelines_pal_ntsc() -> None:
    assert V.mp_hud_pipeline("PAL") == (f"udpsrc port=5602 {CAPS} ! {DEC} ! "
                                        "video/x-raw,width=768,height=576,format=BGRA ! appsink name=outsink sync=false")
    assert V.mp_hud_pipeline("NTSC").endswith("width=640,height=480,format=BGRA ! appsink name=outsink sync=false")


def test_no_jitterbuffer_and_hardware_option() -> None:
    for std in V.STANDARDS:
        for p in (V.viewer_pipeline(std), V.mp_hud_pipeline(std, decoder="d3d11h264dec")):
            assert "rtpjitterbuffer" not in p
    assert "d3d11h264dec" in V.viewer_pipeline("PAL", decoder="d3d11h264dec")
    with pytest.raises(ValueError):
        V.viewer_pipeline("SECAM")


def test_pipelines_match_the_shared_content_file() -> None:
    """``data/content.js`` (WP05, C5.1) carries the same strings for the Tools page and the manual."""
    js = CONTENT_JS.read_text(encoding="utf-8")
    assert f"const RTP_CAPS = '{CAPS}';" in js
    assert f"const DECODE = '{DEC}';" in js
    assert "m=video 5601 RTP/AVP 96" in js and "m=video 5601 RTP/AVP 96" in V.sdp_text()
    for std, (w, h) in V.SIZES.items():
        assert f"video/x-raw,width={w},height={h} ! autovideosink sync=false" in js
        assert f"video/x-raw,width={w},height={h},format=BGRA ! appsink name=outsink sync=false" in js


def test_pipeline_args_for_subprocess() -> None:
    args = V.pipeline_args(V.viewer_pipeline("PAL"))
    assert args[0] == "udpsrc" and "caps=application/x-rtp,media=video,clock-rate=90000,encoding-name=H264," \
                                   "payload=96" in args and '"' not in "".join(args)


def test_sdp(tmp_path: Path) -> None:
    path = V.write_sdp(tmp_path)
    assert path.name == "client-video.sdp"
    text = path.read_text(encoding="ascii")
    assert text.splitlines() == ["v=0", "o=- 0 0 IN IP4 0.0.0.0", "s=Relay client video", "c=IN IP4 0.0.0.0",
                                 "t=0 0", "m=video 5601 RTP/AVP 96", "a=rtpmap:96 H264/90000"]


def test_choose_standard_precedence() -> None:
    assert V.choose_standard({"video": {"standard": "NTSC"}}, "PAL") == ("NTSC", "bridge")
    assert V.choose_standard({"video": {"standard": None}}, "PAL") == ("PAL", "profile")
    assert V.choose_standard({"video": {"standard": None}}, None) == (None, "ask")
    assert V.choose_standard(None, "bogus") == (None, "ask")


def test_find_gst(tmp_path: Path) -> None:
    exe = tmp_path / "bin" / V.GST_EXE
    exe.parent.mkdir()
    exe.write_text("")
    assert V.find_gst(str(exe)) == str(exe)
    assert V.find_gst(str(tmp_path / "missing.exe")) is None
    env = {"PATH": "", V.GST_ENV_ROOTS[0]: str(tmp_path)}
    assert V.find_gst(None, env=env) == str(exe)
    assert V.find_gst(None, env={"PATH": ""}, exists=lambda p: False) is None
    assert "gstreamer.freedesktop.org" in V.GST_INSTALL_HELP


def _rx() -> socket.socket:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    s.settimeout(1.0)
    return s


def _free_udp_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def test_fanout_forwards_every_datagram_to_both_ports() -> None:
    a, b = _rx(), _rx()
    fan = V.UdpFanout(_free_udp_port(), [a.getsockname()[1], b.getsockname()[1]], listen_ip="127.0.0.1").start()
    src = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        payloads = [bytes((0x80, 96)) + i.to_bytes(2, "big") + bytes(1200) for i in range(40)]
        for p in payloads:
            src.sendto(p, ("127.0.0.1", fan.listen_port))
            time.sleep(0.001)
        got_a = [a.recv(2048) for _ in payloads]
        got_b = [b.recv(2048) for _ in payloads]
        assert got_a == payloads and got_b == payloads
        st = fan.stats()
        assert st.packets == 40 and st.forwarded == 80 and st.rx_kbps > 0 and st.source == "127.0.0.1"
        assert st.max_gap_ms is not None
    finally:
        fan.stop()
        src.close()
        a.close()
        b.close()


def test_fanout_refuses_a_loop() -> None:
    with pytest.raises(ValueError):
        V.UdpFanout(5999, [5999])


def test_fanout_helper_process() -> None:
    a = _rx()
    listen = _free_udp_port()
    env = dict(os.environ, PYTHONPATH=str(GCS_DIR))
    proc = subprocess.Popen([sys.executable, "-m", "vtolgcs", "--video-fanout", "--listen", str(listen),
                             "--out", str(a.getsockname()[1]), "--run-seconds", "2.5"],
                            cwd=GCS_DIR, env=env, stdout=subprocess.PIPE, text=True)
    try:
        first = json.loads(proc.stdout.readline())
        assert first["started"] and first["listen"] == listen
        src = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        for _ in range(20):
            src.sendto(b"\x80\x60" + bytes(500), ("127.0.0.1", listen))
            time.sleep(0.01)
        assert a.recv(2048)[:2] == b"\x80\x60"
        src.close()
        out, _ = proc.communicate(timeout=10)
        stats = [json.loads(line) for line in out.splitlines() if line.strip()]
        assert stats and max(s["packets"] for s in stats) == 20
    finally:
        if proc.poll() is None:
            proc.kill()
        a.close()


def test_fanout_helper_reports_port_in_use() -> None:
    busy = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    busy.bind(("0.0.0.0", 0))
    port = busy.getsockname()[1]
    try:
        proc = subprocess.run([sys.executable, "-m", "vtolgcs", "--video-fanout", "--listen", str(port),
                               "--run-seconds", "1"], cwd=GCS_DIR, env=dict(os.environ, PYTHONPATH=str(GCS_DIR)),
                              capture_output=True, text=True, timeout=20)
        assert proc.returncode == 5 and "cannot listen" in proc.stdout
    finally:
        busy.close()


def test_gst_locator_caches_the_lookup() -> None:
    """WP13 R6: not a PATH scan per redraw; re-checked every GST_RECHECK_S (>= 30 s) or on demand."""
    t = [0.0]
    calls: list[str | None] = []

    def finder(configured: str | None) -> str | None:
        calls.append(configured)
        return "C:/gst/bin/gst-launch-1.0.exe" if len(calls) > 1 else None
    loc = V.GstLocator("cfg", clock=lambda: t[0], finder=finder)
    assert V.GST_RECHECK_S >= 30
    for _ in range(299):                                             # 29.9 s of 100 ms UI redraws
        assert loc.get() is None
        t[0] += 0.1
    assert calls == ["cfg"]
    t[0] = 30.0
    assert loc.get() == "C:/gst/bin/gst-launch-1.0.exe" and len(calls) == 2
    assert loc.get(refresh=True) and len(calls) == 3                 # on demand (Launch viewer)
