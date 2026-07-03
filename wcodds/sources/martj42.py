"""martj42/international_results.

Two jobs:
  1. history() -> the full ~49k-match international record, for fitting Elo +
     the Poisson model (Phase 1).
  2. completed_matches() -> WC2026 rows that already have scores. martj42
     back-fills real scores within ~a day (verified: 11-13 Jun match the live
     API), so it's our most *reliable* (token-free, can't really 403) results
     source — just slower than the live API. We use it as a cross-check.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .. import config, net, normalize
from ..models import Match
from .base import ResultsSource

_CACHE = config.RAW_DIR / "martj42_results.csv"


@dataclass
class HistRow:
    date: str
    home: str            # raw name (history covers teams beyond the 48)
    away: str
    home_score: int
    away_score: int
    tournament: str
    neutral: bool


def _to_int(value: str) -> Optional[int]:
    value = (value or "").strip()
    if value in ("", "NA", "NaN", "null"):
        return None
    try:
        return int(value)
    except ValueError:
        return None


class Martj42Source(ResultsSource):
    name = "martj42"

    def __init__(self, refresh: bool = False):
        self.refresh = refresh

    def _rows(self) -> List[dict]:
        path = net.cached_download(config.MARTJ42_RESULTS, _CACHE, refresh=self.refresh)
        with path.open(encoding="utf-8") as fh:
            return list(csv.DictReader(fh))

    def available(self) -> bool:
        return net.head_ok(config.MARTJ42_RESULTS)

    # -- history (for the model) ------------------------------------------
    def history(self) -> List[HistRow]:
        """Every completed international with a numeric score. Raw names kept —
        the Elo model spans all nations, not just the 48 WC teams."""
        rows: List[HistRow] = []
        for r in self._rows():
            hs, as_ = _to_int(r["home_score"]), _to_int(r["away_score"])
            if hs is None or as_ is None:
                continue  # future/unplayed fixture
            rows.append(HistRow(
                date=r["date"], home=r["home_team"], away=r["away_team"],
                home_score=hs, away_score=as_, tournament=r["tournament"],
                neutral=(r.get("neutral", "FALSE").upper() == "TRUE"),
            ))
        return rows

    # -- live WC2026 results (cross-check) --------------------------------
    def completed_matches(self) -> List[Match]:
        out: List[Match] = []
        for r in self._rows():
            if r["tournament"] != "FIFA World Cup":
                continue
            if r["date"] < config.TOURNAMENT_START:
                continue
            hs, as_ = _to_int(r["home_score"]), _to_int(r["away_score"])
            if hs is None or as_ is None:
                continue  # scheduled but not yet played
            home = normalize.code_for(r["home_team"])
            away = normalize.code_for(r["away_team"])
            if not home or not away:
                continue  # unmapped name — surfaced via normalize.unknown_names()
            ht, at = normalize.team(home), normalize.team(away)
            group = ht.group if (ht and at and ht.group == at.group) else ""
            out.append(Match(
                home=home, away=away, date=r["date"],
                home_score=hs, away_score=as_, finished=True,
                stage=config.STAGE_GROUP if group else "",
                group=group, source=self.name,
            ))
        return out

    # -- penalty-shootout winners (a drawn knockout tie is decided on penalties) --
    def shootouts(self) -> Dict[Tuple[str, str], str]:
        """{sorted (code, code): winner_code} for WC2026 shootouts — the real winner
        of a knockout tie whose score line records a draw."""
        path = net.cached_download(config.MARTJ42_SHOOTOUTS,
                                   config.RAW_DIR / "martj42_shootouts.csv", refresh=self.refresh)
        out: Dict[Tuple[str, str], str] = {}
        with path.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if r["date"] < config.TOURNAMENT_START:
                    continue
                h, a, w = (normalize.code_for(r["home_team"]),
                           normalize.code_for(r["away_team"]),
                           normalize.code_for(r["winner"]))
                if h and a and w:
                    out[tuple(sorted((h, a)))] = w
        return out
