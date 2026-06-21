#!/usr/bin/env python3
"""Bracket + Annex C allocation tests — offline. Run: python3 tests/test_bracket.py"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wcodds import bracket  # noqa: E402


def test_allocation_table_complete():
    table = bracket.allocation_table()
    assert len(table) == 495                       # C(12,8)
    for key, mapping in table.items():
        assert len(key) == 8                        # 8 qualifying third-groups
        assert len(mapping) == 8                    # 8 winner slots
        assert set(mapping.values()) == set(key)    # the 8 thirds are exactly the qualifiers


def test_known_combination():
    m = bracket.thirds_assignment(frozenset("EFGHIJKL"))
    assert m == {"A": "E", "B": "J", "D": "I", "E": "F",
                 "G": "H", "I": "G", "K": "L", "L": "K"}


def test_allocation_respects_candidate_sets():
    # whatever third a winner is assigned, it must be a legal candidate for that winner
    for key, mapping in bracket.allocation_table().items():
        for winner, third in mapping.items():
            assert third in bracket.THIRD_CANDIDATES[winner], (key, winner, third)


def test_bracket_structure_counts_and_references():
    assert len(bracket.R32) == 16
    assert len(bracket.KO_TREE) == 16              # 8 R16 + 4 QF + 2 SF + final + 3rd
    # every knockout feeder points at an earlier, real match
    valid = set(bracket.R32) | set(bracket.KO_TREE)
    for mid, (fa, fb) in bracket.KO_TREE.items():
        for kind, ref in (fa, fb):
            assert kind in ("W", "L") and ref in valid and ref < mid


def test_every_group_winner_and_runner_used_once():
    slots = [s for pair in bracket.R32.values() for s in pair]
    winners = sorted(ref for kind, ref in slots if kind == "W")
    runners = sorted(ref for kind, ref in slots if kind == "RU")
    assert winners == list("ABCDEFGHIJKL")          # all 12 winners placed once
    assert runners == list("ABCDEFGHIJKL")          # all 12 runners placed once


def test_official_chronological_match_numbers():
    # FIFA numbers knockout matches by kickoff time, not bracket position.
    # Spot-checks against the published 2026 schedule:
    assert bracket.KO_TREE[94] == (("W", 81), ("W", 82))    # Seattle R16 (Jul 6)
    assert bracket.KO_TREE[91] == (("W", 76), ("W", 78))    # East Rutherford R16 (Jul 5)
    assert bracket.KO_TREE[98] == (("W", 93), ("W", 94))    # QF Inglewood = winners of R16 93 & 94
    assert bracket.FINAL_ID == 104 and bracket.THIRD_ID == 103
    assert bracket.KO_TREE[104] == (("W", 101), ("W", 102))  # final = the two SF winners
    assert bracket.KO_TREE[103] == (("L", 101), ("L", 102))  # third place = the two SF losers


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn(); print(f"PASS  {fn.__name__}")
        except AssertionError as exc:
            failed += 1; print(f"FAIL  {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    raise SystemExit(1 if failed else 0)
