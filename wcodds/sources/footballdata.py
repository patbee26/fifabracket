"""football-data.org — the reliable, token-gated cross-check.

Free tier: needs an API token (X-Auth-Token header; see .env.example), 10 req/min,
scores delayed by a few minutes. Trustworthy infra — the right *fallback* even if
its data is slower than the live source. Without a token this source is simply
unavailable (graceful), never an error.
"""
from __future__ import annotations

from typing import List, Optional

from .. import config, net, normalize
from ..models import Match
from .base import ResultsSource

# football-data `stage` enum -> our labels
_STAGE_MAP = {
    "GROUP_STAGE": config.STAGE_GROUP,
    "LAST_32": config.STAGE_R32,
    "ROUND_OF_32": config.STAGE_R32,
    "LAST_16": config.STAGE_R16,
    "ROUND_OF_16": config.STAGE_R16,
    "QUARTER_FINALS": config.STAGE_QF,
    "SEMI_FINALS": config.STAGE_SF,
    "THIRD_PLACE": config.STAGE_THIRD,
    "FINAL": config.STAGE_FINAL,
}


class FootballDataSource(ResultsSource):
    name = "football-data"

    def __init__(self, token: str = None):
        self.token = token if token is not None else config.FOOTBALLDATA_TOKEN

    @property
    def _headers(self) -> dict:
        return {"X-Auth-Token": self.token} if self.token else {}

    def available(self) -> bool:
        if not self.token:
            return False
        return net.head_ok(config.FOOTBALLDATA_MATCHES + "?status=FINISHED", headers=self._headers)

    def completed_matches(self) -> List[Match]:
        if not self.token:
            return []
        try:
            payload = net.get_json(config.FOOTBALLDATA_MATCHES + "?status=FINISHED", headers=self._headers)
        except Exception:
            return []
        out: List[Match] = []
        for m in payload.get("matches", []):
            home = normalize.code_for((m.get("homeTeam") or {}).get("name", ""))
            away = normalize.code_for((m.get("awayTeam") or {}).get("name", ""))
            if not home or not away:
                continue
            full = (m.get("score") or {}).get("fullTime") or {}
            hs, as_ = full.get("home"), full.get("away")
            if hs is None or as_ is None:
                continue
            out.append(Match(
                home=home, away=away,
                date=(m.get("utcDate", "") or "")[:10],
                home_score=int(hs), away_score=int(as_), finished=True,
                stage=_STAGE_MAP.get(m.get("stage", ""), ""),
                group=(m.get("group") or "").replace("GROUP_", "") if m.get("group") else "",
                matchday=str(m.get("matchday", "") or ""),
                source=self.name,
            ))
        return out
