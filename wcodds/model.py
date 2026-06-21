"""Assemble the full match model (Elo + goals model) in one forward pass, and
(de)serialise it for the Phase 2 simulator.

The forward pass walks history once: it updates Elo online and, for matches in
the goals-fit window, records the *pre-match* Elo diff alongside the realised
scoreline. Fitting the goals model on pre-match diffs is what makes it usable for
prediction (no leakage).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import List, Optional, Tuple

from . import config, normalize
from .elo import EloModel
from .poisson import GoalsModel, Record
from .sources.martj42 import HistRow, Martj42Source

DEFAULT_FIT_START = "2002-01-01"   # modern scoring era
FRIENDLY_WEIGHT = 0.5              # friendlies are noisier; down-weight in the goals fit


def _is_friendly(tournament: str) -> bool:
    return "friendly" in tournament.lower()


@dataclass
class MatchModel:
    elo: EloModel
    goals: GoalsModel
    as_of: str = ""

    def outcome_probs_for_codes(self, home_code: str, away_code: str, home_field: bool = False):
        rh = self.elo.rating_for_code(home_code)
        ra = self.elo.rating_for_code(away_code)
        return self.goals.outcome_probs(rh, ra, home_field)


def build(history: Optional[List[HistRow]] = None, fit_start: str = DEFAULT_FIT_START,
          fit_end: Optional[str] = None, refresh: bool = False) -> MatchModel:
    """One forward pass -> (Elo as of fit_end/now, goals model fit on [fit_start, fit_end))."""
    if history is None:
        history = Martj42Source(refresh=refresh).history()
    history = sorted(history, key=lambda r: r.date)

    elo = EloModel()
    records: List[Record] = []
    for row in history:
        if fit_end and row.date >= fit_end:
            break
        if row.date >= fit_start:
            diff, home_field = elo.diff_features(row)
            w = FRIENDLY_WEIGHT if _is_friendly(row.tournament) else 1.0
            records.append((diff, home_field, row.home_score, row.away_score, w))
        elo.update(row)

    goals = GoalsModel().fit(records)
    return MatchModel(elo=elo, goals=goals, as_of=elo.last_date)


# --- persistence -------------------------------------------------------------

def save(model: MatchModel, path=None) -> "object":
    path = path or (config.RAW_DIR / "model.json")
    ratings_by_code = {
        t.code: round(model.elo.rating_for_code(t.code), 1)
        for t in normalize.canonical_teams()
    }
    payload = {
        "as_of": model.as_of,
        "goals_params": model.goals.to_dict(),
        "wc_ratings": ratings_by_code,
        # full table too, for any non-WC analysis / debugging
        "all_ratings": {k: round(v, 1) for k, v in sorted(
            model.elo.ratings.items(), key=lambda kv: -kv[1])},
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load(path=None) -> Tuple[dict, GoalsModel]:
    path = path or (config.RAW_DIR / "model.json")
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload, GoalsModel.from_dict(payload["goals_params"])
