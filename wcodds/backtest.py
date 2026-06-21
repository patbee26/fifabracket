"""Walk-forward backtest — the honesty check on the model.

For every match in an evaluation window we predict W/D/L from the Elo + goals
model as it stood *before* the match, then update Elo. No leakage: goals params
are fit only on data before the window; Elo is online (past-only by construction).

Scored with the metrics the football-forecasting literature uses:
  - log-loss        (proper, punishes confident wrong calls)
  - RPS             (ranked probability score; respects W>D>L ordering)
  - Brier           (multiclass)
  - accuracy        (arg-max hit rate)
All compared against a base-rate baseline so "better than guessing" is explicit.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from . import normalize
from .elo import EloModel
from .model import DEFAULT_FIT_START, FRIENDLY_WEIGHT, _is_friendly
from .poisson import GoalsModel, Record
from .sources.martj42 import HistRow, Martj42Source

MIN_GAMES = 5  # skip teams still in Elo cold-start during evaluation


def _outcome(hs: int, as_: int) -> int:
    return 0 if hs > as_ else (1 if hs == as_ else 2)  # 0=H 1=D 2=A


def _rps(p: List[float], o: int) -> float:
    obs = [1.0 if k == o else 0.0 for k in range(3)]
    c_p = c_o = 0.0
    total = 0.0
    for k in range(2):  # r-1 = 2 cumulative terms
        c_p += p[k]
        c_o += obs[k]
        total += (c_p - c_o) ** 2
    return total / 2.0


@dataclass
class BacktestResult:
    n: int = 0
    logloss: float = 0.0
    rps: float = 0.0
    brier: float = 0.0
    accuracy: float = 0.0
    base_logloss: float = 0.0
    base_rps: float = 0.0
    base_rates: List[float] = field(default_factory=list)
    goals_params: Dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return self.__dict__


def walk_forward(history: Optional[List[HistRow]] = None,
                 fit_start: str = DEFAULT_FIT_START,
                 eval_start: str = "2018-01-01",
                 eval_end: str = "2026-06-11",
                 refresh: bool = False) -> BacktestResult:
    if history is None:
        history = Martj42Source(refresh=refresh).history()
    history = sorted(history, key=lambda r: r.date)

    elo = EloModel()
    records: List[Record] = []
    goals: Optional[GoalsModel] = None

    preds: List[List[float]] = []
    outcomes: List[int] = []

    for row in history:
        in_eval = eval_start <= row.date < eval_end
        # fit the goals model exactly once, when we first cross into the window
        if goals is None and row.date >= eval_start:
            goals = GoalsModel().fit(records)

        if in_eval and goals is not None and not _is_friendly(row.tournament):
            home = normalize.canonical_history_name(row.home)
            away = normalize.canonical_history_name(row.away)
            if elo.games.get(home, 0) >= MIN_GAMES and elo.games.get(away, 0) >= MIN_GAMES:
                rh, ra = elo.rating(home), elo.rating(away)
                ph, pd, pa = goals.outcome_probs(rh, ra, home_field=(not row.neutral))
                preds.append([ph, pd, pa])
                outcomes.append(_outcome(row.home_score, row.away_score))

        # collect fit records (pre-eval) then update Elo
        if goals is None and row.date >= fit_start:
            diff, home_field = elo.diff_features(row)
            w = FRIENDLY_WEIGHT if _is_friendly(row.tournament) else 1.0
            records.append((diff, home_field, row.home_score, row.away_score, w))
        elo.update(row)

    return _score(preds, outcomes, goals)


def _score(preds: List[List[float]], outcomes: List[int], goals: Optional[GoalsModel]) -> BacktestResult:
    n = len(outcomes)
    res = BacktestResult(n=n, goals_params=goals.to_dict() if goals else {})
    if n == 0:
        return res
    base = [sum(1 for o in outcomes if o == k) / n for k in range(3)]
    eps = 1e-15
    ll = rps = brier = correct = bll = brps = 0.0
    for p, o in zip(preds, outcomes):
        ll += -math.log(max(p[o], eps))
        rps += _rps(p, o)
        brier += sum((p[k] - (1.0 if k == o else 0.0)) ** 2 for k in range(3))
        correct += 1.0 if max(range(3), key=lambda k: p[k]) == o else 0.0
        bll += -math.log(max(base[o], eps))
        brps += _rps(base, o)
    res.logloss, res.rps, res.brier, res.accuracy = ll / n, rps / n, brier / n, correct / n
    res.base_logloss, res.base_rps, res.base_rates = bll / n, brps / n, [round(b, 3) for b in base]
    return res


def favorites_asof(date: str, top_n: int = 16, history: Optional[List[HistRow]] = None,
                   refresh: bool = False) -> List[tuple]:
    """Top teams by Elo as of `date` — the spec's 'pre-tournament favorites' sanity check."""
    from .elo import build_elo
    elo = build_elo(history=history, until=date, refresh=refresh)
    ranked = sorted(elo.ratings.items(), key=lambda kv: -kv[1])
    return [(name, round(r, 0)) for name, r in ranked[:top_n]]
