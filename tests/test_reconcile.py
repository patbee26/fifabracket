#!/usr/bin/env python3
"""Reconciliation tests — offline. Run: python3 tests/test_reconcile.py"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wcodds.fetch import reconcile  # noqa: E402
from wcodds.models import Match     # noqa: E402


def _m(home, away, hs, as_, source, stage="group", date="2026-06-11"):
    return Match(home=home, away=away, home_score=hs, away_score=as_,
                 finished=True, stage=stage, date=date, source=source)


def test_two_sources_agree_is_confirmed():
    res = reconcile({
        "a": [_m("MEX", "RSA", 2, 0, "a")],
        "b": [_m("MEX", "RSA", 2, 0, "b")],
    })
    assert len(res) == 1
    assert res[0].status == "confirmed"
    assert res[0].sources == ["a", "b"]


def test_single_source_is_provisional():
    res = reconcile({"a": [_m("BRA", "MAR", 1, 1, "a")]})
    assert res[0].status == "provisional"


def test_disagreement_is_conflict():
    res = reconcile({
        "a": [_m("USA", "PAR", 4, 1, "a")],
        "b": [_m("USA", "PAR", 3, 1, "b")],
    })
    assert res[0].status == "conflict"
    assert "4-1" in res[0].note and "3-1" in res[0].note


def test_flipped_home_away_still_matches_and_orients():
    # same match, opposite orientation across sources -> still one bucket, agreeing
    res = reconcile({
        "a": [_m("KOR", "CZE", 2, 1, "a")],
        "b": [_m("CZE", "KOR", 1, 2, "b")],
    })
    assert len(res) == 1
    assert res[0].status == "confirmed"
    # canonical orientation is sorted pair (CZE, KOR)
    assert (res[0].home, res[0].away) == ("CZE", "KOR")
    assert (res[0].home_score, res[0].away_score) == (1, 2)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS  {fn.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"FAIL  {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    raise SystemExit(1 if failed else 0)
