"""Elo rating engine, fit from the martj42 international history.

Standard World-Football-Elo formulation:
  R' = R + K * G * (W - We)
  We = 1 / (1 + 10^(-(dr)/400)),  dr = R_home - R_away + home_adv (0 if neutral)
  G  = margin-of-victory multiplier (bigger wins move ratings more)
  K  = match importance (World Cup >> friendly)

Ratings are venue-neutral *strength*; the home edge is applied at expectation
time (and, for WC2026, only to host nations in their own country — see config).
WC-team aliases in history are merged to one identity via normalize.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from . import normalize
from .sources.martj42 import HistRow, Martj42Source

INITIAL_RATING = 1500.0
HOME_ADV_ELO = 100.0   # added to the home side's rating in the expectation (eloratings.net)


def tournament_weight(tournament: str) -> float:
    """Map a competition name to the Elo K-factor (importance)."""
    t = tournament.lower()
    if "friendly" in t:
        return 20.0
    # World Cup final tournament (not qualifying)
    if "fifa world cup" in t and "qual" not in t:
        return 60.0
    if "qualif" in t:
        return 40.0  # WC + continental qualifiers
    if "nations league" in t or "confederations" in t:
        return 40.0
    # continental final tournaments
    for major in ("uefa euro", "copa am", "african cup", "africa cup", "afc asian",
                  "gold cup", "concacaf", "oceania nations", "nations cup"):
        if major in t:
            return 50.0
    return 30.0  # other competitive matches


def mov_multiplier(goal_diff: int) -> float:
    """Margin-of-victory multiplier (eloratings.net)."""
    g = abs(goal_diff)
    if g <= 1:
        return 1.0
    if g == 2:
        return 1.5
    return (11.0 + g) / 8.0


def expected_score(r_home: float, r_away: float, neutral: bool) -> float:
    dr = r_home - r_away + (0.0 if neutral else HOME_ADV_ELO)
    return 1.0 / (1.0 + 10.0 ** (-dr / 400.0))


@dataclass
class EloModel:
    ratings: Dict[str, float] = field(default_factory=dict)
    games: Dict[str, int] = field(default_factory=dict)
    last_date: str = ""

    def rating(self, name: str) -> float:
        return self.ratings.get(name, INITIAL_RATING)

    def rating_for_code(self, code: str) -> float:
        """Current strength of a WC team by FIFA code."""
        return self.rating(normalize.name_for(code))

    def diff_features(self, row: HistRow) -> tuple:
        """Pre-match (Elo diff / 100, home_field) for feeding the goals model.
        Call BEFORE update() to avoid leaking the result into its own features."""
        home = normalize.canonical_history_name(row.home)
        away = normalize.canonical_history_name(row.away)
        diff = (self.rating(home) - self.rating(away)) / 100.0
        return diff, (0.0 if row.neutral else 1.0)

    def update(self, row: HistRow) -> None:
        home = normalize.canonical_history_name(row.home)
        away = normalize.canonical_history_name(row.away)
        rh, ra = self.rating(home), self.rating(away)
        we = expected_score(rh, ra, row.neutral)
        if row.home_score > row.away_score:
            w = 1.0
        elif row.home_score < row.away_score:
            w = 0.0
        else:
            w = 0.5
        k = tournament_weight(row.tournament) * mov_multiplier(row.home_score - row.away_score)
        delta = k * (w - we)
        self.ratings[home] = rh + delta
        self.ratings[away] = ra - delta
        self.games[home] = self.games.get(home, 0) + 1
        self.games[away] = self.games.get(away, 0) + 1
        self.last_date = row.date


def build_elo(history: Optional[List[HistRow]] = None, until: Optional[str] = None,
              refresh: bool = False) -> EloModel:
    """Walk the full history in date order, returning ratings as of `until` (ISO date)."""
    if history is None:
        history = Martj42Source(refresh=refresh).history()
    history = sorted(history, key=lambda r: r.date)
    model = EloModel()
    for row in history:
        if until and row.date >= until:
            break
        model.update(row)
    return model
