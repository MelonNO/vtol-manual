"""Mapping / calibration wizard logic (brief R1). No tkinter.

The wizard reads raw axes and buttons from the RC sender (control command ``inputs``), lets the pilot
move one control at a time to assign it to a channel, records the travel for calibration, and writes
``controller.channel_map`` into the config file.  The config is validated before it is saved (the arm
and throttle channels must stay mapped), and the RC sender uses the new map after its next start.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence

from .. import config as config_mod
from ..config import ChannelSource

#: Smallest raw axis change that counts as "this control moved" (axis units -1..1; app default).
MOVE_MIN = 0.35


def detect_moved(before: Sequence[float], after: Sequence[float], buttons_before: Sequence[bool] = (),
                 buttons_after: Sequence[bool] = ()) -> tuple[str, int, float] | None:
    """The input that moved most between two raw reads: ``("axis", index, delta)`` or
    ``("button", index, 1.0)``; None if nothing moved enough."""
    best: tuple[str, int, float] | None = None
    for i, (a, b) in enumerate(zip(before, after)):
        d = b - a
        if abs(d) >= MOVE_MIN and (best is None or abs(d) > abs(best[2])):
            best = ("axis", i, d)
    if best is None:
        for i, (a, b) in enumerate(zip(buttons_before, buttons_after)):
            if a != b:
                return ("button", i, 1.0)
    return best


@dataclass
class Calibration:
    """Min/max seen per axis while the pilot moves every stick and switch to its ends."""

    mins: dict[int, float] = field(default_factory=dict)
    maxs: dict[int, float] = field(default_factory=dict)

    def add(self, axes: Sequence[float]) -> None:
        for i, v in enumerate(axes):
            self.mins[i] = min(v, self.mins.get(i, v))
            self.maxs[i] = max(v, self.maxs.get(i, v))

    def range(self, index: int) -> tuple[float, float] | None:
        lo, hi = self.mins.get(index), self.maxs.get(index)
        if lo is None or hi is None or hi - lo < 2 * MOVE_MIN:
            return None                      # not moved through its travel: keep the default
        return lo, hi


def apply_assignment(channel_map: list[ChannelSource], channel: int, kind: str, index: int,
                     reverse: bool = False, cal: Calibration | None = None) -> None:
    """Map 1-based ``channel`` to an axis/button (with calibrated min/max when known)."""
    while len(channel_map) < channel:
        channel_map.append(ChannelSource("none"))
    src = ChannelSource(kind, index, reverse)
    if kind == "axis" and cal is not None:
        rng = cal.range(index)
        if rng is not None:
            src.min, src.max = rng
    channel_map[channel - 1] = src


def save_channel_map(config_path: Path, channel_map: list[ChannelSource]) -> list[str]:
    """Validate and save. Returns the validation errors (nothing is written when there are any)."""
    cfg = config_mod.load_config(config_path)
    cfg.controller.channel_map = [ChannelSource(c.src, c.index, c.reverse, c.min, c.max) for c in channel_map]
    errors = config_mod.validate(cfg)
    if not errors:
        config_mod.save_config(cfg, config_path)
    return errors


def update_config(config_path: Path, change: Callable[[config_mod.Config], None]) -> list[str]:
    """Load, change, validate and save the config file (UI settings). Returns the errors."""
    cfg = config_mod.load_config(config_path)
    change(cfg)
    errors = config_mod.validate(cfg)
    if not errors:
        config_mod.save_config(cfg, config_path)
    return errors


__all__ = ["Calibration", "MOVE_MIN", "apply_assignment", "detect_moved", "save_channel_map", "update_config"]
