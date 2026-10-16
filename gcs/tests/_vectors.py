"""Shared loader for protocol/test-vectors.json."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any

VECTORS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "protocol",
                            "test-vectors.json")


@lru_cache(maxsize=1)
def vectors() -> dict[str, Any]:
    with open(VECTORS_PATH, encoding="utf-8") as f:
        return json.load(f)


def ids(items: list[dict[str, Any]], key: str = "name") -> list[str]:
    return [str(i.get(key, n)) for n, i in enumerate(items)]
