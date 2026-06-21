"""rezarahiminia / worldcup26.ir — the fast live source.

Serves live scores via GET /get/games. Caveats baked into how we parse it:
  - Scores and `finished` arrive as STRINGS ("2", "TRUE"); we coerce.
  - Teams are referenced by numeric id -> resolved via the teams seed.
  - `home_scorers` is a malformed curly-quoted blob; we ignore it (model needs
    only the score line).
  - README claims JWT is required but /get/games is currently open; we send no
    auth and tolerate a future 401 by simply being unavailable.
"""
from __future__ import annotations

from typing import List, Optional

from .. import config, net, normalize
from ..models import Match
from .base import ResultsSource

# rezarahiminia `type` -> our stage labels
_STAGE_MAP = {
    "group": config.STAGE_GROUP,
    "r32": config.STAGE_R32,
    "r16": config.STAGE_R16,
    "qf": config.STAGE_QF,
    "sf": config.STAGE_SF,
    "third": config.STAGE_THIRD,
    "final": config.STAGE_FINAL,
}


def _to_int(value) -> Optional[int]:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _reza_date_to_iso(local_date: str) -> str:
    """'06/11/2026 13:00' -> '2026-06-11' (best-effort)."""
    try:
        d = local_date.split(" ")[0]
        mm, dd, yyyy = d.split("/")
        return f"{yyyy}-{mm}-{dd}"
    except (ValueError, AttributeError, IndexError):
        return ""


class RezaSource(ResultsSource):
    name = "rezarahiminia"

    def available(self) -> bool:
        return net.head_ok(config.REZA_HEALTH)

    def completed_matches(self) -> List[Match]:
        try:
            payload = net.get_json(config.REZA_GAMES)
        except Exception:
            return []
        games = payload.get("games", payload) if isinstance(payload, dict) else payload
        out: List[Match] = []
        for g in games or []:
            if str(g.get("finished", "")).upper() != "TRUE":
                continue
            home = normalize.code_for_fixture_id(g.get("home_team_id"))
            away = normalize.code_for_fixture_id(g.get("away_team_id"))
            if not home or not away:
                continue
            hs, as_ = _to_int(g.get("home_score")), _to_int(g.get("away_score"))
            if hs is None or as_ is None:
                continue
            out.append(Match(
                home=home, away=away,
                date=_reza_date_to_iso(g.get("local_date", "")),
                home_score=hs, away_score=as_, finished=True,
                stage=_STAGE_MAP.get(str(g.get("type", "")).lower(), ""),
                group=str(g.get("group", "")) if g.get("type") == "group" else "",
                matchday=str(g.get("matchday", "")),
                source=self.name,
            ))
        return out
