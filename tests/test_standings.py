#!/usr/bin/env python3
"""Tiebreaker tests — offline. Run: python3 tests/test_standings.py

The 2026 headline change is head-to-head BEFORE overall goal difference; these
tests pin that down."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wcodds import standings  # noqa: E402

FLAT_ELO = lambda t: 1500.0


def test_orders_by_points():
    teams = ["A", "B", "C", "D"]
    matches = [("A", "B", 1, 0), ("A", "C", 1, 0), ("A", "D", 1, 0),
               ("B", "C", 1, 0), ("B", "D", 1, 0), ("C", "D", 1, 0)]
    assert standings.rank_group(teams, matches, FLAT_ELO) == ["A", "B", "C", "D"]


def test_head_to_head_beats_overall_gd():
    # X and Y both finish on 6 pts. Y has the better OVERALL goal difference (+3 vs -1),
    # but X won their head-to-head -> under 2026 rules X must rank above Y.
    teams = ["X", "Y", "Z", "W"]
    matches = [
        ("X", "Y", 1, 0),   # X beats Y (head-to-head)
        ("X", "Z", 1, 0),   # X beats Z
        ("W", "X", 3, 0),   # X loses big to W      -> X: 6pts, GD -1
        ("Y", "Z", 3, 0),   # Y beats Z big
        ("Y", "W", 1, 0),   # Y beats W             -> Y: 6pts, GD +3
        ("Z", "W", 0, 0),
    ]
    order = standings.rank_group(teams, matches, FLAT_ELO)
    assert order.index("X") < order.index("Y"), order


def test_overall_gd_when_head_to_head_level():
    # X and Y drew head-to-head (h2h identical) -> fall through to overall GD.
    teams = ["X", "Y", "Z", "W"]
    matches = [
        ("X", "Y", 1, 1),   # draw -> no h2h separation
        ("X", "Z", 5, 0),   # X big win
        ("W", "X", 1, 0),
        ("Y", "Z", 1, 0),   # Y small win
        ("W", "Y", 1, 0),
        ("Z", "W", 0, 0),
    ]
    order = standings.rank_group(teams, matches, FLAT_ELO)   # X GD +4, Y GD 0
    assert order.index("X") < order.index("Y"), order


def test_rank_thirds_points_then_gd_then_elo():
    stats = {
        "P": standings.Stat(pts=4, gd=2, gf=3),
        "Q": standings.Stat(pts=4, gd=2, gf=3),   # tied with P on pts/gd/gf -> Elo breaks it
        "R": standings.Stat(pts=6, gd=1, gf=2),   # most points -> first
        "S": standings.Stat(pts=1, gd=-5, gf=0),
    }
    elo = {"P": 1600, "Q": 1700, "R": 1500, "S": 1400}.get
    order = standings.rank_thirds(stats, elo)
    assert order[0] == "R"
    assert order.index("Q") < order.index("P")   # higher Elo wins the dead heat
    assert order[-1] == "S"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn(); print(f"PASS  {fn.__name__}")
        except AssertionError as exc:
            failed += 1; print(f"FAIL  {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    raise SystemExit(1 if failed else 0)
