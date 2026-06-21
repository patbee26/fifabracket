"""The fixed 2026 knockout structure — transcribed from the FIFA bracket
(Wikipedia "2026 FIFA World Cup knockout stage", cross-checked against Annex C).

Slot types:
  ('W',  g)   winner of group g
  ('RU', g)   runner-up of group g
  ('3',  w)   the best-third assigned (via Annex C) to the winner of group w

Matches are numbered chronologically by kickoff (official FIFA numbering), NOT by
bracket position: R32 73-88, R16 89-96, QF 97-100, SF 101-102, 3rd-place 103
(Jul 18), Final 104 (Jul 19). The R16 numbers in particular do not follow the
draw order, so the QF feeders below must reference the official numbers.
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Dict, FrozenSet, List, Tuple

from . import config

# Round of 32: match_id -> (slotA, slotB).
# The '3' slot is paired with the group winner in the SAME match; Annex C maps
# that winner-group to a third-placed group.
R32: Dict[int, Tuple[tuple, tuple]] = {
    73: (("RU", "A"), ("RU", "B")),
    74: (("W", "E"), ("3", "E")),
    75: (("W", "F"), ("RU", "C")),
    76: (("W", "C"), ("RU", "F")),
    77: (("W", "I"), ("3", "I")),
    78: (("RU", "E"), ("RU", "I")),
    79: (("W", "A"), ("3", "A")),
    80: (("W", "L"), ("3", "L")),
    81: (("W", "D"), ("3", "D")),
    82: (("W", "G"), ("3", "G")),
    83: (("RU", "K"), ("RU", "L")),
    84: (("W", "H"), ("RU", "J")),
    85: (("W", "B"), ("3", "B")),
    86: (("W", "J"), ("RU", "H")),
    87: (("W", "K"), ("3", "K")),
    88: (("RU", "D"), ("RU", "G")),
}

# Candidate third-groups per winner (for validating the Annex C lookup).
THIRD_CANDIDATES: Dict[str, FrozenSet[str]] = {
    "E": frozenset("ABCDF"), "I": frozenset("CDFGH"), "A": frozenset("CEFHI"),
    "L": frozenset("EHIJK"), "D": frozenset("BEFIJ"), "G": frozenset("AEHIJ"),
    "B": frozenset("EFGIJ"), "K": frozenset("DEIJL"),
}

# Knockout tree: match_id -> (feederA, feederB); feeder = ('W'|'L', match_id).
KO_TREE: Dict[int, Tuple[tuple, tuple]] = {
    89: (("W", 74), ("W", 77)), 90: (("W", 73), ("W", 75)),
    91: (("W", 76), ("W", 78)), 92: (("W", 79), ("W", 80)),
    93: (("W", 83), ("W", 84)), 94: (("W", 81), ("W", 82)),
    95: (("W", 86), ("W", 88)), 96: (("W", 85), ("W", 87)),
    97: (("W", 89), ("W", 90)), 98: (("W", 93), ("W", 94)),
    99: (("W", 91), ("W", 92)), 100: (("W", 95), ("W", 96)),
    101: (("W", 97), ("W", 98)), 102: (("W", 99), ("W", 100)),
    103: (("L", 101), ("L", 102)),   # third-place play-off (Jul 18)
    104: (("W", 101), ("W", 102)),   # final (Jul 19)
}

R32_IDS = list(R32)
R16_IDS = [89, 90, 91, 92, 93, 94, 95, 96]
QF_IDS = [97, 98, 99, 100]
SF_IDS = [101, 102]
FINAL_ID = 104
THIRD_ID = 103


@lru_cache(maxsize=1)
def allocation_table() -> Dict[str, Dict[str, str]]:
    """key = sorted 8 qualifying third-groups (e.g. 'EFGHIJKL')
       value = {winner_group: third_group}."""
    return json.loads(config.ALLOC_SEED.read_text(encoding="utf-8"))


def thirds_assignment(qualifying_groups: FrozenSet[str]) -> Dict[str, str]:
    """Annex C lookup: which third-group each relevant winner faces."""
    key = "".join(sorted(qualifying_groups))
    table = allocation_table()
    if key not in table:
        raise KeyError(f"no Annex C row for third-place combination {key!r}")
    return table[key]
