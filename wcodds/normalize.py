"""Team-name normalisation — the join key across sources.

Sources disagree on names ("South Korea" vs "Korea Republic", "DR Congo" vs
"Democratic Republic of the Congo"). We canonicalise everything to the FIFA
3-letter code. Lookup is accent/case/punctuation-insensitive, so most variants
resolve without an explicit alias; data/aliases.json holds the genuinely
divergent spellings.

Unknown names are RECORDED, never silently dropped — call `unknown_names()`
after a run to surface anything new that needs an alias (spec risk #3).
"""
from __future__ import annotations

import json
import unicodedata
from functools import lru_cache
from typing import Dict, List, Optional, Set

from . import config
from .models import Team

_UNKNOWN: Set[str] = set()


def slugify(name: str) -> str:
    """Lowercase, strip accents, drop non-alphanumerics. 'Côte d'Ivoire' -> 'cotedivoire'."""
    if not name:
        return ""
    decomposed = unicodedata.normalize("NFKD", name)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return "".join(c for c in stripped.lower() if c.isalnum())


@lru_cache(maxsize=1)
def _teams_by_code() -> Dict[str, Team]:
    raw = json.loads(config.TEAMS_SEED.read_text(encoding="utf-8"))
    out: Dict[str, Team] = {}
    for t in raw:
        out[t["fifa_code"]] = Team(
            code=t["fifa_code"],
            name=t["name_en"],
            group=t.get("group", ""),
            iso2=t.get("iso2", ""),
            fixture_id=str(t.get("id", "")),
        )
    if len(out) != config.N_TEAMS:
        raise ValueError(f"teams seed has {len(out)} teams, expected {config.N_TEAMS}")
    return out


@lru_cache(maxsize=1)
def _slug_to_code() -> Dict[str, str]:
    """Build the lookup: canonical names + codes themselves + curated aliases."""
    index: Dict[str, str] = {}
    for code, team in _teams_by_code().items():
        index[slugify(team.name)] = code   # canonical display name
        index[slugify(code)] = code        # the code as a name (e.g. "USA")
    aliases = json.loads(config.ALIASES_SEED.read_text(encoding="utf-8"))
    for name, code in aliases.items():
        if name.startswith("_"):
            continue
        index[slugify(name)] = code
    return index


@lru_cache(maxsize=1)
def _fixture_id_to_code() -> Dict[str, str]:
    """rezarahiminia identifies teams by numeric id, not name — map id -> code."""
    return {t.fixture_id: t.code for t in _teams_by_code().values() if t.fixture_id}


# --- public API --------------------------------------------------------------

def canonical_teams() -> List[Team]:
    return list(_teams_by_code().values())


def team(code: str) -> Optional[Team]:
    return _teams_by_code().get(code)


def name_for(code: str) -> str:
    t = _teams_by_code().get(code)
    return t.name if t else code


def code_for(name: str) -> Optional[str]:
    """Resolve any source's team name to a FIFA code, or None (and record the miss)."""
    if not name:
        return None
    code = _slug_to_code().get(slugify(name))
    if code is None:
        _UNKNOWN.add(name)
    return code


def code_for_fixture_id(fixture_id: str) -> Optional[str]:
    code = _fixture_id_to_code().get(str(fixture_id))
    if code is None:
        _UNKNOWN.add(f"id:{fixture_id}")
    return code


def canonical_history_name(raw: str) -> str:
    """Collapse a history team name to our canonical spelling IFF it's one of the
    48 WC teams, else leave it untouched. Merges 'DR Congo'/'IR Iran'/'Cabo Verde'
    into a single Elo identity, without disturbing non-WC nations."""
    code = _slug_to_code().get(slugify(raw))
    if code is None:
        return raw  # not a WC team — don't record as unknown, history spans all nations
    return _teams_by_code()[code].name


def unknown_names() -> Set[str]:
    """Names seen this run that we couldn't map — add these to aliases.json."""
    return set(_UNKNOWN)


def reset_unknowns() -> None:
    _UNKNOWN.clear()
