#!/usr/bin/env python3
"""Elo engine tests — offline, deterministic. Run: python3 tests/test_elo.py"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wcodds import elo                       # noqa: E402
from wcodds.sources.martj42 import HistRow   # noqa: E402


def test_expected_score_symmetry_and_home_edge():
    assert abs(elo.expected_score(1500, 1500, neutral=True) - 0.5) < 1e-9
    assert elo.expected_score(1500, 1500, neutral=False) > 0.5   # home edge
    assert elo.expected_score(1800, 1500, neutral=True) > 0.8    # much stronger


def test_mov_multiplier():
    assert elo.mov_multiplier(0) == 1.0
    assert elo.mov_multiplier(1) == 1.0
    assert elo.mov_multiplier(2) == 1.5
    assert elo.mov_multiplier(4) == (11 + 4) / 8


def test_tournament_weight():
    assert elo.tournament_weight("Friendly") == 20.0
    assert elo.tournament_weight("FIFA World Cup") == 60.0
    assert elo.tournament_weight("FIFA World Cup qualification") == 40.0
    assert elo.tournament_weight("UEFA Euro") == 50.0


def test_update_is_zero_sum_and_directional():
    m = elo.EloModel()
    row = HistRow(date="2020-01-01", home="Brazil", away="Argentina",
                  home_score=3, away_score=0, tournament="Friendly", neutral=True)
    m.update(row)
    # winner up, loser down, by equal and opposite amounts (zero-sum)
    up = m.rating("Brazil") - elo.INITIAL_RATING
    down = elo.INITIAL_RATING - m.rating("Argentina")
    assert up > 0 and abs(up - down) < 1e-9


def test_until_cutoff_excludes_later_matches():
    hist = [
        HistRow("2010-01-01", "A", "B", 5, 0, "Friendly", True),
        HistRow("2030-01-01", "B", "A", 5, 0, "Friendly", True),  # in the future
    ]
    m = elo.build_elo(history=hist, until="2020-01-01")
    assert m.rating("A") > m.rating("B")  # only the first match counted


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
