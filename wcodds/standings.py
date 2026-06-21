"""Group standings and the 2026 FIFA tiebreaker procedure.

Order (FWC2026 regulations, Annex):
  overall points, then for teams level on points:
    a) head-to-head points
    b) head-to-head goal difference
    c) head-to-head goals scored
       (if a-c separate some but not all, restart a-c among those still level)
  then if still level:
    d) overall goal difference
    e) overall goals scored
    f) fair play  g) FIFA ranking  h) lots

We implement a-e exactly (the sporting criteria) and use Elo as the final
deterministic separator in place of f/g/h (we don't simulate cards). The
head-to-head-first ordering is the 2026 change.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, List, Sequence, Tuple

# A played match restricted form: (home_code, away_code, home_score, away_score)
PlayedMatch = Tuple[str, str, int, int]


@dataclass
class Stat:
    pts: int = 0
    gd: int = 0
    gf: int = 0
    ga: int = 0
    played: int = 0


def team_stats(teams: Sequence[str], matches: Sequence[PlayedMatch]) -> Dict[str, Stat]:
    """Stats for `teams`, counting only matches where BOTH sides are in `teams`
    (so the same function serves overall tables and head-to-head mini-tables)."""
    tset = set(teams)
    out = {t: Stat() for t in teams}
    for h, a, hs, as_ in matches:
        if h not in tset or a not in tset:
            continue
        out[h].gf += hs; out[h].ga += as_; out[h].gd += hs - as_; out[h].played += 1
        out[a].gf += as_; out[a].ga += hs; out[a].gd += as_ - hs; out[a].played += 1
        if hs > as_:
            out[h].pts += 3
        elif hs < as_:
            out[a].pts += 3
        else:
            out[h].pts += 1; out[a].pts += 1
    return out


def rank_group(teams: Sequence[str], matches: Sequence[PlayedMatch],
               elo: Callable[[str], float]) -> List[str]:
    """Return group order best -> worst."""
    overall = team_stats(teams, matches)
    order: List[str] = []
    for pts in sorted({s.pts for s in overall.values()}, reverse=True):
        tied = [t for t in teams if overall[t].pts == pts]
        order.extend(_resolve(tied, matches, overall, elo))
    return order


def _resolve(tied: List[str], matches: Sequence[PlayedMatch],
             overall: Dict[str, Stat], elo: Callable[[str], float]) -> List[str]:
    if len(tied) == 1:
        return tied
    h = team_stats(tied, matches)                       # a-c: head-to-head among the tied set
    keyf = lambda t: (h[t].pts, h[t].gd, h[t].gf)
    distinct = sorted({keyf(t) for t in tied}, reverse=True)
    if len(distinct) > 1:
        out: List[str] = []
        for k in distinct:
            sub = [t for t in tied if keyf(t) == k]
            out.extend(_resolve(sub, matches, overall, elo) if len(sub) > 1 else sub)
        return out
    # a-c gave no separation -> d, e, then Elo (proxy for fair-play / FIFA rank / lots)
    return sorted(tied, key=lambda t: (overall[t].gd, overall[t].gf, elo(t)), reverse=True)


def rank_thirds(third_stats: Dict[str, Stat], elo: Callable[[str], float]) -> List[str]:
    """Rank the 12 third-placed teams (different groups -> no head-to-head):
    overall points -> GD -> goals scored -> Elo. Returns all, best first."""
    return sorted(third_stats,
                  key=lambda t: (third_stats[t].pts, third_stats[t].gd, third_stats[t].gf, elo(t)),
                  reverse=True)
