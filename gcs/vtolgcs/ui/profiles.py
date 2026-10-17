"""Client profiles from the Tools page export (contract C1: ``VtolStore.exportJSON()``). No tkinter.

The export is the whole store object; the UI needs its ``clients`` (C1.3 ``ClientProfile``) and the
``packs`` they point to (for the cell count).  Tombstones (``deleted: true``) are skipped; ``null``
values stay unknown (C1: never compute with them).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ProfileError(ValueError):
    pass


@dataclass(frozen=True)
class ClientChoice:
    id: str
    name: str
    cells: int | None                 # from the client's pack; None = unknown
    video_standard: str | None        # 'PAL' | 'NTSC' | None (TBD)
    vtx_band: str | None
    vtx_channel: int | None
    model_id: int | None              # elrs.modelId
    raw: dict

    def summary(self) -> str:
        def tbd(v: Any) -> str:
            return "TBD" if v is None else str(v)
        vtx = "TBD" if self.vtx_band is None and self.vtx_channel is None else \
            f"{tbd(self.vtx_band)}{tbd(self.vtx_channel)}"
        return (f"{self.name}: pack {tbd(self.cells)}S, video {tbd(self.video_standard)}, VTX {vtx}, "
                f"ELRS model id {tbd(self.model_id)}")


def _int(v: Any) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def parse_profiles(data: Any) -> list[ClientChoice]:
    """Client profiles of an exported store (or of a bare ``{"clients": [...]}``)."""
    if not isinstance(data, dict) or not isinstance(data.get("clients"), list):
        raise ProfileError("not a Tools-page export: no 'clients' list")
    packs = {p.get("id"): p for p in data.get("packs") or [] if isinstance(p, dict) and not p.get("deleted")}
    out = []
    for c in data["clients"]:
        if not isinstance(c, dict) or c.get("deleted") or not isinstance(c.get("id"), str):
            continue
        pack = packs.get(c.get("packId")) or {}
        cells = _int(pack.get("cells"))
        std = c.get("videoStandard") if c.get("videoStandard") in ("PAL", "NTSC") else None
        vtx = c.get("vtx") if isinstance(c.get("vtx"), dict) else {}
        elrs = c.get("elrs") if isinstance(c.get("elrs"), dict) else {}
        out.append(ClientChoice(id=c["id"][:64], name=str(c.get("name") or c["id"]), cells=cells if cells and 1 <= cells <= 16 else None,
                                video_standard=std, vtx_band=vtx.get("band") if isinstance(vtx.get("band"), str) else None,
                                vtx_channel=_int(vtx.get("channel")), model_id=_int(elrs.get("modelId")), raw=c))
    return out


def load_profiles(path: Path) -> list[ClientChoice]:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise ProfileError(f"cannot read {path}: {exc}") from exc
    return parse_profiles(data)


__all__ = ["ClientChoice", "ProfileError", "load_profiles", "parse_profiles"]
