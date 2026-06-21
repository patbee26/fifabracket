#!/usr/bin/env python3
"""Simulator integration tests — offline, synthetic model (no model.json/network).
Run: python3 tests/test_simulator.py

The round-count invariants are the strongest correctness check: every simulation
sends exactly 32/16/8/4/2/1 teams to each successive round, so the per-team
probabilities must sum to those totals."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wcodds import normalize, simulator  # noqa: E402
from wcodds.poisson import GoalsModel    # noqa: E402

GOALS = GoalsModel(b0=0.1, b_elo=0.2, b_home=0.25, rho=-0.04)
EXPECTED_TOTALS = {"qualify": 32, "r16": 16, "qf": 8, "sf": 4, "final": 2, "champion": 1}


def _ratings(strong=None, weak=None):
    r = {t.code: 1500.0 for t in normalize.canonical_teams()}
    if strong:
        r[strong] = 2400.0
    if weak:
        r[weak] = 1000.0
    return r


def test_round_count_invariants():
    probs, n = simulator.run(_ratings(), GOALS, completed={}, n=300, seed=1)
    for rnd, total in EXPECTED_TOTALS.items():
        s = sum(probs[c][rnd] for c in probs)
        assert abs(s - total) < 1e-9, f"{rnd}: sum={s} expected {total}"


def test_probabilities_in_range():
    probs, _ = simulator.run(_ratings(), GOALS, completed={}, n=200, seed=2)
    for c in probs:
        for rnd in simulator.ROUNDS:
            assert 0.0 <= probs[c][rnd] <= 1.0


def test_strong_team_wins_more_than_weak():
    probs, _ = simulator.run(_ratings(strong="BRA", weak="HAI"), GOALS, completed={}, n=400, seed=3)
    assert probs["BRA"]["champion"] > probs["HAI"]["champion"]
    assert probs["BRA"]["champion"] == max(probs[c]["champion"] for c in probs)


def test_completed_result_is_respected():
    # Force a finished group game; the recorded winner must always be among qualifiers
    # in a setting where it otherwise might not dominate.
    completed = {("BRA", "HAI"): (5, 0)}  # sorted pair BRA<HAI? 'BRA'<'HAI' yes -> (BRA, HAI)
    probs, _ = simulator.run(_ratings(), GOALS, completed=completed, n=200, seed=4)
    # BRA thumped HAI, so BRA should qualify more often than HAI
    assert probs["BRA"]["qualify"] >= probs["HAI"]["qualify"]


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
