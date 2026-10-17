"""What the status bar and the main window show, computed from a C2 status object. No tkinter.

Fields follow plan §7.5: bridge state (colour), RTT, uplink loss, send jitter, client LQ/RSSI,
client battery, video decoder lock / standard, timing-frame offset, camera requested vs **reported**.
Colours are the project's palette (``--green``, ``--amber``, ``--red``, ``--accent``, muted grey).
"""

from __future__ import annotations

from typing import Any

GREEN, AMBER, RED, ACCENT, MUTED, TEXT = "#22c55e", "#facc15", "#ef4444", "#f97316", "#94a3b8", "#e5e7eb"
BG, SURFACE = "#0b0f14", "#141a22"

SENDER_DOWN = "RC SENDER DOWN"


def _f(v: Any, fmt: str = "{}", none: str = "--") -> str:
    return none if v is None else fmt.format(v)


def bridge_colour(state: str | None) -> str:
    return {"RUN": GREEN, "START": AMBER, "WAIT_GCS": AMBER, "BOOT": AMBER, "FAILSAFE": RED}.get(state or "", RED)


def mode_text(s: dict) -> str:
    app = s.get("app") or {}
    mode = (app.get("mode") or "?").upper().replace("_", "-")
    if app.get("mode") not in (None, "idle") and not app.get("streaming"):
        mode += " STOPPED"
    if app.get("start_path") == "resume":
        mode += " (RESUME)"
    return mode


def camera_text(s: dict) -> tuple[str, str]:
    cam = ((s.get("bridge") or {}).get("camera")) or {}
    req, rep = cam.get("requested"), cam.get("reported")
    text = f"CAM req {'ON' if req else 'off'} / rep {'--' if rep is None else ('ON' if rep else 'off')}"
    colour = MUTED if rep is None else (GREEN if rep == req else RED)
    return text, colour


def status_fields(s: dict | None, link_state: str) -> list[tuple[str, str, str]]:
    """``[(key, text, colour)]`` for the always-on-top status bar."""
    if link_state != "up" or s is None:
        return [("sender", SENDER_DOWN if link_state == "down" else "connecting to the RC sender...",
                 RED if link_state == "down" else AMBER)]
    b, c, v = s.get("bridge") or {}, s.get("client") or {}, s.get("video") or {}
    link, batt = c.get("link") or {}, c.get("battery") or {}
    alarms = s.get("alarms") or []
    crit = [a for a in alarms if a.get("severity") == "crit"]
    state = b.get("state")
    lock = v.get("decoder_lock")
    out = [
        ("mode", mode_text(s), ACCENT if (s.get("app") or {}).get("streaming") else MUTED),
        ("bridge", f"BRIDGE {state or '--'}", bridge_colour(state)),
        ("rtt", f"RTT {_f(b.get('rtt_ms'), '{:.1f}')} ms", TEXT),
        ("loss", f"loss {_f(b.get('uplink_loss_pct'), '{:.1f}')}%",
         AMBER if (b.get("uplink_loss_pct") or 0) > 1 else TEXT),
        ("jitter", f"jit99 {_f(b.get('send_jitter_ms_p99'), '{:.2f}')} ms", TEXT),
        ("lq", f"LQ {_f(link.get('lq_pct'))}% RSSI {_f(link.get('rssi1_dbm'))}",
         AMBER if link.get("lq_pct") is not None and link["lq_pct"] < 70 else TEXT),
        ("batt", f"batt {_f(batt.get('voltage_v'), '{:.1f}')} V", TEXT),
        ("video", f"video {v.get('standard') or '--'} {'LOCK' if lock else ('no lock' if lock is False else '')}".rstrip(),
         GREEN if lock else (RED if lock is False else MUTED)),
        ("offset", f"sync {_f(b.get('sync_offset_us'), '{:+.0f}')} us", TEXT if b.get("timing_locked") else MUTED),
        ("camera", *camera_text(s)),
        ("alarms", f"{len(alarms)} ALARM{'S' if len(alarms) != 1 else ''}" if alarms else "no alarms",
         RED if crit else (AMBER if alarms else GREEN)),
    ]
    return out


__all__ = ["SENDER_DOWN", "bridge_colour", "camera_text", "mode_text", "status_fields"]
