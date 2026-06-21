#!/usr/bin/env python3
"""Goals-model tests — offline, deterministic. Run: python3 tests/test_poisson.py"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wcodds.poisson import GoalsModel, dc_tau  # noqa: E402


def test_dc_tau_identity_at_zero_rho():
    for i in range(3):
        for j in range(3):
            assert dc_tau(i, j, 1.3, 1.1, 0.0) == 1.0


def test_scoreline_matrix_normalised():
    g = GoalsModel(b0=0.2, b_elo=0.3, b_home=0.2, rho=-0.1)
    lh, la = g.lambdas(1600, 1500, home_field=True)
    total = sum(sum(row) for row in g.scoreline_matrix(lh, la))
    assert abs(total - 1.0) < 1e-9


def test_outcome_probs_sum_and_direction():
    g = GoalsModel(b0=0.2, b_elo=0.4, b_home=0.0, rho=0.0)
    ph, pd, pa = g.outcome_probs(1700, 1500)   # home much stronger
    assert abs(ph + pd + pa - 1.0) < 1e-9
    assert ph > pa


def test_negative_rho_boosts_draws():
    base = GoalsModel(b0=0.1, b_elo=0.0, b_home=0.0, rho=0.0)
    drawy = GoalsModel(b0=0.1, b_elo=0.0, b_home=0.0, rho=-0.12)
    _, pd0, _ = base.outcome_probs(1500, 1500)
    _, pd1, _ = drawy.outcome_probs(1500, 1500)
    assert pd1 > pd0


def test_fit_recovers_positive_elo_slope():
    # synthesise: stronger team (positive diff) scores more, weaker scores less
    records = []
    for d in range(-6, 7):                      # diff in [-6, 6] (i.e. +-600 Elo)
        hs = max(0, round(1.3 + 0.35 * d))
        as_ = max(0, round(1.3 - 0.35 * d))
        for _ in range(50):                     # repeat for weight
            records.append((float(d), 1.0, hs, as_, 1.0))
    g = GoalsModel().fit(records)
    assert g.b_elo > 0
    ph, _, pa = g.outcome_probs(1600, 1500, home_field=True)
    assert ph > pa
    assert -0.3 <= g.rho <= 0.3


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
