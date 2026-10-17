"""Video helper (plan §7.4, brief R2): UDP fan-out, GStreamer pipelines, ``client-video.sdp``.

* :class:`UdpFanout` receives the client video RTP on UDP 5600 and re-sends every datagram to
  ``127.0.0.1:5601`` (standalone viewer) and ``127.0.0.1:5602`` (Mission Planner HUD), contract C3.
  It keeps throughput statistics (packets, kbps, largest gap between packets).
* The fan-out runs in **its own process** (``python -m vtolgcs --video-fanout ...``, started by the
  UI; brief R0): it never shares an interpreter with the RC sender.  It prints one JSON stats line per
  second on stdout (the UI reads it) and reports ``rx_kbps`` to the RC sender over the control
  channel, which fills C2 ``video.rx_kbps``.  It keeps running if the UI dies (the pilot keeps the
  picture); stop it from a new UI or with Task Manager.
* :func:`viewer_pipeline` / :func:`mp_hud_pipeline` build the GStreamer pipelines for PAL (fields
  704x288 -> 768x576) and NTSC (704x224/240 -> 640x480); the ``avdec_h264`` form is identical to
  ``data/content.js`` ``pipelines``.  No ``rtpjitterbuffer`` (relay design).
* :func:`choose_standard`: the bridge status flag when present (C2 ``video.standard``), else the
  client profile, else the operator is asked.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import socket
import subprocess
import sys
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Sequence

from . import protocol

FANOUT_PORTS = (5601, 5602)                 # C3: viewer, Mission Planner HUD
STANDARDS = ("PAL", "NTSC")
SIZES = {"PAL": (768, 576), "NTSC": (640, 480)}       # plan §7.4
RTP_CAPS = 'caps="application/x-rtp,media=video,clock-rate=90000,encoding-name=H264,payload=96"'
SDP_NAME = "client-video.sdp"
RCVBUF = 1 << 20

# --------------------------------------------------------------------------- pipelines


def _check(standard: str) -> tuple[int, int]:
    if standard not in SIZES:
        raise ValueError(f"video standard must be PAL or NTSC, not {standard!r}")
    return SIZES[standard]


def _decode(decoder: str) -> str:
    if decoder == "avdec_h264":
        return "rtph264depay ! h264parse ! avdec_h264 max-threads=1 ! videoconvert ! videoscale"
    if decoder == "d3d11h264dec":                    # hardware decode option, plan §7.4 (VERIFY on the laptop)
        return "rtph264depay ! h264parse ! d3d11h264dec ! d3d11download ! videoconvert ! videoscale"
    raise ValueError(f"unknown decoder {decoder!r}")


def viewer_pipeline(standard: str, port: int = FANOUT_PORTS[0], decoder: str = "avdec_h264") -> str:
    """Standalone viewer (``gst-launch-1.0 ...``), reading the fan-out's viewer port."""
    w, h = _check(standard)
    return (f"gst-launch-1.0 udpsrc port={port} {RTP_CAPS} ! {_decode(decoder)} ! "
            f"video/x-raw,width={w},height={h} ! autovideosink sync=false")


def mp_hud_pipeline(standard: str, port: int = FANOUT_PORTS[1], decoder: str = "avdec_h264") -> str:
    """Mission Planner HUD source (right-click the HUD -> Video -> Set GStreamer Source)."""
    w, h = _check(standard)
    return (f"udpsrc port={port} {RTP_CAPS} ! {_decode(decoder)} ! "
            f"video/x-raw,width={w},height={h},format=BGRA ! appsink name=outsink sync=false")


def pipeline_args(pipeline: str) -> list[str]:
    """Argument list for ``subprocess`` from a ``gst-launch-1.0 ...`` string (quotes removed)."""
    args = shlex.split(pipeline, posix=True)
    return args[1:] if args and args[0] == "gst-launch-1.0" else args


def sdp_text(port: int = FANOUT_PORTS[0]) -> str:
    """``client-video.sdp`` for mpv (plan §7.4; port 5601 per C5.1, the fan-out's viewer port)."""
    return ("v=0\no=- 0 0 IN IP4 0.0.0.0\ns=Relay client video\nc=IN IP4 0.0.0.0\nt=0 0\n"
            f"m=video {port} RTP/AVP 96\na=rtpmap:96 H264/90000\n")


def write_sdp(directory: Path, port: int = FANOUT_PORTS[0]) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / SDP_NAME
    path.write_text(sdp_text(port), encoding="ascii", newline="\n")
    return path


def choose_standard(status: dict | None, profile_standard: str | None) -> tuple[str | None, str]:
    """``(standard, source)``: bridge flag (C2 ``video.standard``) > client profile > ``(None, 'ask')``."""
    std = ((status or {}).get("video") or {}).get("standard")
    if std in STANDARDS:
        return std, "bridge"
    if profile_standard in STANDARDS:
        return profile_standard, "profile"
    return None, "ask"


# --------------------------------------------------------------------------- GStreamer

GST_EXE = "gst-launch-1.0.exe" if sys.platform == "win32" else "gst-launch-1.0"
GST_ENV_ROOTS = ("GSTREAMER_1_0_ROOT_MSVC_X86_64", "GSTREAMER_1_0_ROOT_X86_64", "GSTREAMER_1_0_ROOT_MINGW_X86_64")
GST_DIRS = (r"C:\Program Files\gstreamer\1.0\msvc_x86_64\bin", r"C:\gstreamer\1.0\msvc_x86_64\bin",
            r"C:\gstreamer\1.0\x86_64\bin")

GST_INSTALL_HELP = (
    "GStreamer was not found.\n"
    "1. Download the Windows *runtime* installer, MSVC 64-bit, from https://gstreamer.freedesktop.org/download/\n"
    "2. Run it and choose 'Complete' (the viewer needs the libav plugin for avdec_h264).\n"
    "3. The installer sets GSTREAMER_1_0_ROOT_MSVC_X86_64; log off and on, or set video.gst_launch_path in the\n"
    "   config to ...\\gstreamer\\1.0\\msvc_x86_64\\bin\\gst-launch-1.0.exe.\n"
    "Mission Planner's HUD has its own GStreamer: it only needs the MP HUD pipeline below.")


def find_gst(configured: str | None = None, env: dict[str, str] | None = None,
             exists: Callable[[str], bool] = os.path.isfile) -> str | None:
    """``gst-launch-1.0``: the configured path, PATH, the installer's environment variables, usual folders."""
    env = os.environ if env is None else env
    if configured:
        return configured if exists(configured) else None
    found = shutil.which(GST_EXE, path=env.get("PATH"))
    if found:
        return found
    for var in GST_ENV_ROOTS:
        root = env.get(var)
        if root:
            cand = os.path.join(root, "bin", GST_EXE)
            if exists(cand):
                return cand
    for d in GST_DIRS:
        cand = os.path.join(d, GST_EXE)
        if exists(cand):
            return cand
    return None


def launch_viewer(gst: str, pipeline: str) -> subprocess.Popen:
    """Start the standalone viewer (its own process and window)."""
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    return subprocess.Popen([gst, *pipeline_args(pipeline)], creationflags=flags,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# --------------------------------------------------------------------------- fan-out

@dataclass(frozen=True)
class FanoutStats:
    t: float                       # monotonic time of the stats
    packets: int                   # total received
    bytes: int
    forwarded: int                 # datagrams sent (all targets)
    send_errors: int
    rx_kbps: float                 # last window
    pps: float                     # packets per second, last window
    max_gap_ms: float | None       # largest gap between packets in the last window
    last_packet_age_ms: float | None
    source: str | None             # sender of the latest packet


class UdpFanout:
    """Re-send every datagram from ``listen_port`` to ``127.0.0.1`` on each of ``ports``."""

    def __init__(self, listen_port: int = protocol.VIDEO_PORT, ports: Sequence[int] = FANOUT_PORTS,
                 listen_ip: str = "0.0.0.0", clock: Callable[[], float] = time.perf_counter) -> None:
        if listen_port in ports:
            raise ValueError("a fan-out port must differ from the listen port")
        self._clock = clock
        self.targets = [("127.0.0.1", int(p)) for p in ports]
        self.rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            self.rx.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, RCVBUF)
        except OSError:
            pass
        self.rx.bind((listen_ip, listen_port))
        self.rx.settimeout(0.2)
        self.tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        ioctl = getattr(socket, "SIO_UDP_CONNRESET", None)
        for s in (self.rx, self.tx):
            if ioctl is not None and hasattr(s, "ioctl"):
                try:
                    s.ioctl(ioctl, False)       # no viewer on 5601: not an error
                except OSError:
                    pass
        self._lock = threading.Lock()
        self.packets = self.bytes = self.forwarded = self.send_errors = 0
        self._win_start = clock()
        self._win_bytes = self._win_packets = 0
        self._win_gap = 0.0
        self._last_t: float | None = None
        self._source: str | None = None
        self._last_stats: FanoutStats | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def listen_port(self) -> int:
        return self.rx.getsockname()[1]

    def handle(self, data: bytes, src: tuple[str, int], now: float) -> None:
        sent = errors = 0
        for target in self.targets:
            try:
                self.tx.sendto(data, target)
                sent += 1
            except OSError:
                errors += 1
        with self._lock:
            if self._last_t is not None:
                self._win_gap = max(self._win_gap, now - self._last_t)
            self._last_t = now
            self.packets += 1
            self.bytes += len(data)
            self._win_packets += 1
            self._win_bytes += len(data)
            self.forwarded += sent
            self.send_errors += errors
            self._source = src[0]

    def stats(self, now: float | None = None, roll: bool = True) -> FanoutStats:
        """Statistics; ``roll`` closes the current window (call about once a second)."""
        now = self._clock() if now is None else now
        with self._lock:
            span = max(1e-6, now - self._win_start)
            gap = max(self._win_gap, now - self._last_t) if self._last_t is not None else None
            st = FanoutStats(t=now, packets=self.packets, bytes=self.bytes, forwarded=self.forwarded,
                             send_errors=self.send_errors, rx_kbps=self._win_bytes * 8 / 1000 / span,
                             pps=self._win_packets / span, max_gap_ms=None if gap is None else gap * 1000,
                             last_packet_age_ms=None if self._last_t is None else (now - self._last_t) * 1000,
                             source=self._source)
            if roll:
                self._win_start, self._win_bytes, self._win_packets, self._win_gap = now, 0, 0, 0.0
                self._last_stats = st
        return st

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                data, src = self.rx.recvfrom(65536)
            except socket.timeout:
                continue
            except (ConnectionResetError, InterruptedError):
                continue
            except OSError:
                if self._stop.is_set():
                    break
                time.sleep(0.01)
                continue
            self.handle(data, src, self._clock())

    def start(self) -> "UdpFanout":
        self._thread = threading.Thread(target=self.run, name="video-fanout", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
        self.rx.close()
        self.tx.close()


def _report(control_file: Path | None) -> Callable[[float | None], None]:
    """rx_kbps -> the RC sender's C2 ``video.rx_kbps`` through the control channel (best effort)."""
    if control_file is None:
        return lambda kbps: None
    from .control import ControlClient, ControlError
    state: dict[str, Any] = {"client": None, "next_try": 0.0}

    def report(kbps: float | None) -> None:
        now = time.monotonic()
        if state["client"] is None and now >= state["next_try"]:
            try:
                state["client"] = ControlClient.from_file(control_file, timeout=1.0)
            except ControlError:
                state["next_try"] = now + 5.0
                return
        if state["client"] is None:
            return
        try:
            state["client"].request("video_report", rx_kbps=kbps)
        except ControlError:
            state["client"], state["next_try"] = None, now + 5.0
    return report


def fanout_main(argv: Sequence[str]) -> int:
    """The fan-out helper process: ``--video-fanout --listen 5600 --out 5601,5602 [--control-file F]``."""
    p = argparse.ArgumentParser(prog="vtol-gcs --video-fanout")
    p.add_argument("--listen", type=int, default=protocol.VIDEO_PORT)
    p.add_argument("--out", default=",".join(str(x) for x in FANOUT_PORTS))
    p.add_argument("--control-file", type=Path)
    p.add_argument("--run-seconds", type=float, help=argparse.SUPPRESS)
    args = p.parse_args(list(argv))
    try:
        fan = UdpFanout(args.listen, [int(x) for x in args.out.split(",") if x])
    except OSError as exc:
        print(json.dumps({"error": f"cannot listen on UDP {args.listen}: {exc}"}), flush=True)
        return 5
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}), flush=True)
        return 4
    fan.start()
    report = _report(args.control_file)
    print(json.dumps({"started": True, "listen": fan.listen_port, "out": [t[1] for t in fan.targets],
                      "pid": os.getpid()}), flush=True)
    end = time.monotonic() + args.run_seconds if args.run_seconds else None
    try:
        while end is None or time.monotonic() < end:
            time.sleep(1.0)
            st = fan.stats()
            report(round(st.rx_kbps, 1))
            try:
                print(json.dumps(asdict(st)), flush=True)
            except (OSError, ValueError):            # the UI went away: keep forwarding video
                pass
    except KeyboardInterrupt:
        pass
    finally:
        fan.stop()
    return 0


class FanoutProcess:
    """UI side: starts the fan-out helper process and reads its stats lines."""

    def __init__(self, command: list[str], env: dict[str, str] | None = None, cwd: str | None = None) -> None:
        self.command = command
        self.env, self.cwd = env, cwd
        self.proc: subprocess.Popen | None = None
        self.latest: dict | None = None
        self.error: str | None = None
        self.history: list[dict] = []                 # recent stats (test tools)
        self._thread: threading.Thread | None = None

    def start(self) -> "FanoutProcess":
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self.proc = subprocess.Popen(self.command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     stdin=subprocess.DEVNULL, text=True, creationflags=flags, env=self.env,
                                     cwd=self.cwd)
        self._thread = threading.Thread(target=self._read, name="fanout-reader", daemon=True)
        self._thread.start()
        return self

    def _read(self) -> None:
        assert self.proc is not None and self.proc.stdout is not None
        for line in self.proc.stdout:
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if "error" in obj:
                self.error = obj["error"]
            elif "packets" in obj:
                self.latest = obj
                self.history = (self.history + [obj])[-600:]

    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def stop(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()


__all__ = ["FANOUT_PORTS", "FanoutProcess", "FanoutStats", "GST_INSTALL_HELP", "SDP_NAME", "UdpFanout",
           "choose_standard", "fanout_main", "find_gst", "launch_viewer", "mp_hud_pipeline", "pipeline_args",
           "sdp_text", "viewer_pipeline", "write_sdp"]
