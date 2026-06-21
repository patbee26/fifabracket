#!/usr/bin/env python3
"""Phase 1 validation: walk-forward backtest + 'pre-tournament favorites' sanity.

    python3 scripts/backtest.py
    python3 scripts/backtest.py --eval-start 2014-01-01
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wcodds import backtest  # noqa: E402
from wcodds.sources.martj42 import Martj42Source  # noqa: E402


def _hr(title: str) -> None:
    print(f"\n{'=' * 60}\n{title}\n{'=' * 60}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval-start", default="2018-01-01")
    ap.add_argument("--eval-end", default="2026-06-11")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    # load history once, reuse for backtest + both favorites snapshots
    history = Martj42Source(refresh=args.refresh).history()

    r = backtest.walk_forward(history=history, eval_start=args.eval_start, eval_end=args.eval_end)

    _hr(f"WALK-FORWARD BACKTEST  ({args.eval_start} -> {args.eval_end})")
    print(f"matches evaluated: {r.n:,}   (competitive, both teams >= {backtest.MIN_GAMES} games)")
    print(f"base rates  H/D/A: {r.base_rates}")
    print(f"\n{'metric':<12}{'model':>10}{'baseline':>12}{'skill':>10}")
    print("-" * 44)
    print(f"{'log-loss':<12}{r.logloss:>10.4f}{r.base_logloss:>12.4f}{(r.base_logloss - r.logloss):>+10.4f}")
    print(f"{'RPS':<12}{r.rps:>10.4f}{r.base_rps:>12.4f}{(r.base_rps - r.rps):>+10.4f}")
    print(f"{'Brier':<12}{r.brier:>10.4f}{'-':>12}{'':>10}")
    print(f"{'accuracy':<12}{r.accuracy*100:>9.1f}%{'-':>12}{'':>10}")
    print("\n(positive skill = model beats always-guess-the-base-rate; lower is better.)")

    for label, date in (("2018 World Cup", "2018-06-14"), ("2022 World Cup", "2022-11-20")):
        _hr(f"TOP 12 BY ELO — eve of the {label} ({date})")
        for i, (name, rating) in enumerate(backtest.favorites_asof(date, top_n=12, history=history), 1):
            print(f"  {i:>2}. {name:<26} {rating:>6.0f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
