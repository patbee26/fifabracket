"""Small, source-independent data types.

Every source normalises into these, so nothing downstream (model, simulator,
front-end JSON) ever sees a source's raw shape. Teams are identified by FIFA
3-letter code — the one stable join key across all sources.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass(frozen=True)
class Team:
    code: str            # canonical FIFA code, e.g. "BRA"
    name: str            # display name, e.g. "Brazil"
    group: str           # "A".."L"
    iso2: str = ""       # for flags
    fixture_id: str = "" # the live source's numeric team id (rezarahiminia)


@dataclass
class Match:
    """One completed (or scheduled) match, normalised onto FIFA codes."""
    home: str                       # FIFA code
    away: str                       # FIFA code
    date: str = ""                  # ISO yyyy-mm-dd
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    finished: bool = False
    stage: str = ""                 # config.STAGE_*
    group: str = ""                 # "A".."L" for group games, else ""
    matchday: str = ""
    source: str = ""                # which source produced this row

    @property
    def played(self) -> bool:
        return self.finished and self.home_score is not None and self.away_score is not None

    @property
    def is_draw(self) -> bool:
        return self.played and self.home_score == self.away_score

    @property
    def winner(self) -> Optional[str]:
        if not self.played or self.is_draw:
            return None
        return self.home if self.home_score > self.away_score else self.away

    def key(self) -> tuple:
        """Stable identity for cross-source reconciliation: the unordered pair."""
        return tuple(sorted((self.home, self.away)))


@dataclass
class ReconciledResult:
    """A completed match merged across sources, with an agreement status."""
    home: str
    away: str
    home_score: int
    away_score: int
    date: str = ""
    stage: str = ""
    group: str = ""
    status: str = "provisional"     # confirmed | provisional | conflict
    sources: List[str] = field(default_factory=list)
    note: str = ""                  # populated on conflict (the disagreement)
