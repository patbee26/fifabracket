"""Orchestration: load fixtures, pull every available source, reconcile.

The reconciliation is the spec's "don't trust one source" made concrete: a
result is `confirmed` when >=2 sources agree, `provisional` when only one has it,
and `conflict` when sources disagree on the score (surfaced, never silently
picked). The model should weight confirmed > provisional and skip conflicts
until resolved.
"""
from __future__ import annotations

import json
from typing import Dict, List

from . import config, normalize
from .models import Match, ReconciledResult
from .sources import ALL_SOURCE_CLASSES, ResultsSource


# --- fixtures ----------------------------------------------------------------

def load_fixtures() -> List[Match]:
    """The full 104-match schedule from the seed, team ids resolved to codes.
    Group games get both teams; knockout slots are TBD (ids unresolved -> '')."""
    raw = json.loads(config.FIXTURES_SEED.read_text(encoding="utf-8"))
    out: List[Match] = []
    for m in raw:
        home = normalize.code_for_fixture_id(m.get("home_team_id")) or ""
        away = normalize.code_for_fixture_id(m.get("away_team_id")) or ""
        out.append(Match(
            home=home, away=away,
            stage=m.get("stage", ""), group=m.get("group", ""),
            matchday=str(m.get("matchday", "")), source="fixtures",
        ))
    return out


# --- gathering + reconciliation ---------------------------------------------

def available_sources(refresh: bool = False) -> List[ResultsSource]:
    """Instantiate sources and keep the ones usable right now."""
    instances: List[ResultsSource] = []
    for cls in ALL_SOURCE_CLASSES:
        src = cls(refresh=refresh) if cls.__name__ == "Martj42Source" else cls()
        try:
            if src.available():
                instances.append(src)
        except Exception:
            continue
    return instances


def reconcile(by_source: Dict[str, List[Match]]) -> List[ReconciledResult]:
    """Merge completed matches across sources, keyed by the unordered team pair."""
    buckets: Dict[tuple, List[Match]] = {}
    for matches in by_source.values():
        for m in matches:
            buckets.setdefault(m.key(), []).append(m)

    results: List[ReconciledResult] = []
    for key, group in buckets.items():
        # Normalise every row to the same orientation (sorted pair) for comparison.
        scores = set()
        srcs = sorted({m.source for m in group})
        anchor = group[0]
        a, b = key  # sorted codes
        for m in group:
            if (m.home, m.away) == (a, b):
                scores.add((m.home_score, m.away_score))
            else:  # flipped home/away — swap to the canonical orientation
                scores.add((m.away_score, m.home_score))

        # pick richest metadata (a source that knew the stage/date)
        best = max(group, key=lambda m: (bool(m.stage), bool(m.date)))
        oriented = _orient(best, a, b)

        if len(scores) == 1:
            status = "confirmed" if len(srcs) >= 2 else "provisional"
            note = ""
        else:
            status = "conflict"
            note = "; ".join(f"{m.source}:{m.home_score}-{m.away_score}" for m in group)

        results.append(ReconciledResult(
            home=a, away=b,
            home_score=oriented[0], away_score=oriented[1],
            date=best.date, stage=best.stage, group=best.group,
            status=status, sources=srcs, note=note,
        ))
    results.sort(key=lambda r: (r.date, r.home))
    return results


def _orient(m: Match, a: str, b: str):
    """Return (score_a, score_b) for the canonical (a,b) orientation."""
    if (m.home, m.away) == (a, b):
        return (m.home_score, m.away_score)
    return (m.away_score, m.home_score)


def gather(refresh: bool = False) -> dict:
    """Full Phase-0 pull. Returns a structured report dict (also what the CLI prints)."""
    normalize.reset_unknowns()
    sources = available_sources(refresh=refresh)
    by_source: Dict[str, List[Match]] = {}
    for src in sources:
        try:
            by_source[src.name] = src.completed_matches()
        except Exception as exc:  # never let one source sink the run
            by_source[src.name] = []
            by_source[src.name + "_error"] = str(exc)  # type: ignore

    reconciled = reconcile({k: v for k, v in by_source.items() if isinstance(v, list)})
    return {
        "sources_used": [s.name for s in sources],
        "per_source_counts": {k: len(v) for k, v in by_source.items() if isinstance(v, list)},
        "reconciled": reconciled,
        "unknown_names": sorted(normalize.unknown_names()),
    }
