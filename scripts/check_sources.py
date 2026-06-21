#!/usr/bin/env python3
"""Probe every data source's availability + latency. Reliability is the #1 risk
(see PRESSURE-TEST.md), so make it a one-command check.

    python3 scripts/check_sources.py
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wcodds.sources import ALL_SOURCE_CLASSES  # noqa: E402
from wcodds import config                       # noqa: E402


def main() -> int:
    print(f"{'source':<16}{'available':<12}{'latency':<10}{'completed':<10}note")
    print("-" * 64)
    for cls in ALL_SOURCE_CLASSES:
        src = cls()
        t0 = time.time()
        try:
            ok = src.available()
        except Exception as exc:  # noqa: BLE001
            ok = False
        dt = f"{time.time() - t0:.2f}s"
        n, note = "-", ""
        if ok:
            try:
                n = str(len(src.completed_matches()))
            except Exception as exc:  # noqa: BLE001
                note = f"fetch error: {exc}"
        elif cls.__name__ == "FootballDataSource" and not config.FOOTBALLDATA_TOKEN:
            note = "no FOOTBALL_DATA_TOKEN set (optional)"
        print(f"{src.name:<16}{('yes' if ok else 'no'):<12}{dt:<10}{n:<10}{note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
