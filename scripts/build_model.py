#!/usr/bin/env python3
"""Phase 1: build Elo from history, fit the goals model, save + summarise.

    python3 scripts/build_model.py            # build, print, save data/raw/model.json
    python3 scripts/build_model.py --refresh  # re-download history first

Writes data/raw/model.json (ratings + goals params) for the Phase 2 simulator.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wcodds import config, model, normalize  # noqa: E402


def _hr(title: str) -> None:
    print(f"\n{'=' * 60}\n{title}\n{'=' * 60}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    mm = model.build(refresh=args.refresh)
    path = model.save(mm)
    g = mm.goals

    _hr("GOALS MODEL (Elo-seeded Poisson + Dixon-Coles)")
    print(f"fit on {g.n_records:,} matches  |  as of {mm.as_of}")
    print(f"  b0     (baseline log-goals) = {g.b0:+.4f}  -> {math.exp(g.b0):.2f} goals at parity, neutral")
    print(f"  b_elo  (per 100 Elo)        = {g.b_elo:+.4f}")
    print(f"  b_home (home-field)         = {g.b_home:+.4f}  -> x{math.exp(g.b_home):.3f} goals at home")
    print(f"  rho    (Dixon-Coles)        = {g.rho:+.4f}")
    print(f"  observed mean goals/team    = {g.mean_goals:.2f}")

    _hr("WC2026 TEAM STRENGTH (current Elo)")
    teams = sorted(normalize.canonical_teams(), key=lambda t: -mm.elo.rating_for_code(t.code))
    for i, t in enumerate(teams, 1):
        print(f"  {i:>2}. {t.name:<26} {t.group}  {mm.elo.rating_for_code(t.code):>6.0f}")

    # demo: model the two strongest teams on a neutral field
    a, b = teams[0], teams[1]
    ra, rb = mm.elo.rating_for_code(a.code), mm.elo.rating_for_code(b.code)
    ph, pd, pa = mm.goals.outcome_probs(ra, rb, home_field=False)
    lh, la = mm.goals.lambdas(ra, rb)
    mtx = mm.goals.scoreline_matrix(lh, la)
    cells = sorted(((mtx[i][j], i, j) for i in range(6) for j in range(6)), reverse=True)[:5]
    _hr(f"DEMO MATCH (neutral): {a.name} vs {b.name}")
    print(f"  expected goals: {a.name} {lh:.2f} - {la:.2f} {b.name}")
    print(f"  {a.name} win {ph*100:4.1f}%  |  draw {pd*100:4.1f}%  |  {b.name} win {pa*100:4.1f}%")
    print("  most likely scorelines:")
    for p, i, j in cells:
        print(f"     {i}-{j}  {p*100:4.1f}%")

    print(f"\nwrote {path.relative_to(config.BASE_DIR)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
