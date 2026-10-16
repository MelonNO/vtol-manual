"""Bridge -> GCS receiver: ``status`` and ``crsf_fwd`` on the sender's own socket (contract C3).

The bridge replies to the source IP:port of the latest valid ``rc_up``, so the
receiver thread reads the same UDP socket the sender writes.  Only datagrams
from the configured bridge address are accepted.

Derived values (:class:`BridgeLink`):

* **RTT** = ``(t_gcs_now_us - t_gcs_us_echo) mod 2^32`` (protocol README §3.2),
  computed only when the echo is one of *our* recent packets and newer than
  the one behind the previous RTT sample.  It includes up to one send period of waiting.
* **Uplink loss** over a ~2 s window: ``1 - delta(rx_ok) / delta(seq of the echoed packet)``.
  The echo identifies the newest packet the bridge had accepted, so the
  sequence numbers sent in the same interval are known exactly.
* **Status age**; the C2 state is ``UNREACHABLE`` when no status arrived for
  ``alarms.status_timeout_ms`` (the bridge only talks to a GCS that streams).
"""

from __future__ import annotations

import collections
import logging
import socket
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable

from . import crsf, protocol
from .config import Config
from .protocol import BridgeState, Status
from .sender import Packet, gcs_time_us
from .telemetry import ClientTelemetry

log = logging.getLogger("vtolgcs.receiver")

#: Our own sent packets remembered for RTT/loss (t_gcs_us -> seq); ~8 s at 250 Hz.
SENT_MEMORY = 2000
LOSS_WINDOW_S = 2.0
RTT_HISTORY_S = 30.0


@dataclass(frozen=True)
class BridgeView:
    """What the alarm rules and C2 need from the bridge link."""

    last_status: Status | None
    status_t: float | None          # receive time of last_status
    status_age_s: float | None
    rtt_ms: float | None            # None when not streaming or older than 1 s
    rtt_t: float | None             # time of the newest RTT sample (even if rtt_ms is None)
    rtt_sample_ms: float | None     # the newest RTT sample
    uplink_loss_pct: float | None


class BridgeLink:
    """State derived from received ``status`` packets. Thread-safe."""

    def __init__(self, clock: Callable[[], float] = time.perf_counter,
                 us_clock: Callable[[], int] | None = None) -> None:
        self._clock = clock
        self._us_clock = us_clock or gcs_time_us
        self._lock = threading.Lock()
        self._sent: collections.OrderedDict[int, int] = collections.OrderedDict()
        self.last_status: Status | None = None
        self.last_status_t: float | None = None
        self._last_rtt_seq: int | None = None
        self.rtt_ms: float | None = None
        self.rtt_t: float | None = None
        self.rtt_history: collections.deque[tuple[float, float]] = collections.deque()
        self._loss: collections.deque[tuple[float, int, int]] = collections.deque()  # (t, seq, rx_ok)
        self.status_count = 0

    def note_sent(self, pkt: Packet) -> None:
        with self._lock:
            self._sent[pkt.t_gcs_us] = pkt.seq
            while len(self._sent) > SENT_MEMORY:
                self._sent.popitem(last=False)

    def on_status(self, st: Status, now: float | None = None) -> tuple[BridgeState | None, BridgeState] | None:
        """Process a status. Returns ``(old, new)`` when the reported state changed."""
        now = self._clock() if now is None else now
        now_us = self._us_clock()
        with self._lock:
            old = self.last_status.state if self.last_status else None
            self.last_status, self.last_status_t = st, now
            self.status_count += 1
            seq = self._sent.get(st.t_gcs_us_echo) if st.t_gcs_us_echo else None
            if seq is not None and (self._last_rtt_seq is None or protocol.seq_newer(seq, self._last_rtt_seq)):
                self._last_rtt_seq = seq
                self.rtt_ms = protocol.u32_diff(now_us, st.t_gcs_us_echo) / 1000.0
                self.rtt_t = now
                self.rtt_history.append((now, self.rtt_ms))
            while self.rtt_history and now - self.rtt_history[0][0] > RTT_HISTORY_S:
                self.rtt_history.popleft()
            if seq is not None:
                if self._loss:
                    _, last_seq, last_ok = self._loss[-1]
                    went_back = seq != last_seq and not protocol.seq_newer(seq, last_seq)
                    if st.rx_ok < last_ok or went_back:
                        self._loss.clear()   # bridge restarted or a new stream: start a new window
                self._loss.append((now, seq, st.rx_ok))
                while len(self._loss) > 2 and now - self._loss[0][0] > LOSS_WINDOW_S:
                    self._loss.popleft()
        return (old, st.state) if old != st.state else None

    def view(self, now: float | None = None, streaming: bool = True) -> BridgeView:
        now = self._clock() if now is None else now
        with self._lock:
            age = None if self.last_status_t is None else max(0.0, now - self.last_status_t)
            rtt = self.rtt_ms if streaming and self.rtt_t is not None and now - self.rtt_t <= 1.0 else None
            loss = None
            if streaming and len(self._loss) >= 2:
                (_, s0, ok0), (t1, s1, ok1) = self._loss[0], self._loss[-1]
                sent = protocol.u32_diff(s1, s0)
                if sent > 0 and now - t1 <= 1.0:
                    loss = max(0.0, min(100.0, 100.0 * (1 - protocol.u32_diff(ok1, ok0) / sent)))
            return BridgeView(self.last_status, self.last_status_t, age, rtt, self.rtt_t, self.rtt_ms, loss)

    def rtt_samples(self) -> list[tuple[float, float]]:
        with self._lock:
            return list(self.rtt_history)


class Receiver:
    """Reads the shared UDP socket in its own thread and dispatches bridge datagrams."""

    def __init__(self, cfg: Config, sock: socket.socket, link: BridgeLink, telemetry: ClientTelemetry,
                 clock: Callable[[], float] = time.perf_counter,
                 on_state_change: Callable[[BridgeState | None, BridgeState, Status], None] | None = None,
                 on_telemetry: Callable[[Any], None] | None = None) -> None:
        self.cfg = cfg
        self.sock = sock
        self.link = link
        self.telemetry = telemetry
        self._clock = clock
        self._on_state_change = on_state_change
        self._on_telemetry = on_telemetry
        self.crsf_listeners: list[Callable[[crsf.CrsfFrame], None]] = []
        self.counters: collections.Counter[str] = collections.Counter()
        self._bridge_ip = cfg.bridge.ip
        self._bridge_port = cfg.bridge.port
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> "Receiver":
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="bridge-rx", daemon=True)
            self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    def _run(self) -> None:
        self.sock.settimeout(0.1)
        while not self._stop.is_set():
            try:
                data, src = self.sock.recvfrom(2048)
            except (socket.timeout, BlockingIOError, InterruptedError):
                continue
            except ConnectionResetError:     # ICMP port unreachable (Windows): the bridge is not there
                self.counters["icmp_unreachable"] += 1
                continue
            except OSError:
                if self._stop.is_set():
                    break
                self.counters["recv_error"] += 1
                time.sleep(0.01)
                continue
            try:
                self.handle_datagram(data, src)
            except Exception:                 # one bad datagram must never stop the receiver
                self.counters["handler_error"] += 1
                log.exception("bridge datagram handler failed")

    def handle_datagram(self, data: bytes, src: tuple[str, int], now: float | None = None) -> None:
        now = self._clock() if now is None else now
        if src[0] != self._bridge_ip or src[1] != self._bridge_port:
            self.counters["bad_src"] += 1
            return
        try:
            msg = protocol.decode(data)
        except protocol.LengthError:
            self.counters["bad_len"] += 1
            return
        except protocol.MagicError:
            self.counters["bad_magic"] += 1
            return
        except protocol.VersionError:
            self.counters["bad_ver"] += 1
            return
        except protocol.CrcError:
            self.counters["bad_crc"] += 1
            return
        except protocol.FieldError:
            self.counters["bad_field"] += 1
            return
        if isinstance(msg, protocol.Status):
            self.counters["status"] += 1
            change = self.link.on_status(msg, now)
            if change and self._on_state_change:
                self._on_state_change(change[0], change[1], msg)
        elif isinstance(msg, protocol.CrsfFwd):
            self.counters["crsf_fwd"] += 1
            try:
                frame = crsf.parse_frame(msg.frame)
            except crsf.CrsfError:
                self.counters["bad_crsf"] += 1
                return
            obj = self.telemetry.on_frame(frame, now)
            if obj is not None and self._on_telemetry:
                self._on_telemetry(obj)
            for listener in list(self.crsf_listeners):
                try:
                    listener(frame)
                except Exception:
                    log.exception("CRSF listener failed")
        else:
            self.counters["unexpected"] += 1   # rc_up / crsf_pass are never sent to the GCS
