#!/usr/bin/env python3
"""Normalisation tests — offline, no network. Run: python3 tests/test_normalize.py
(also works under pytest)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wcodds import normalize  # noqa: E402


def test_all_48_canonical_names_resolve():
    teams = normalize.canonical_teams()
    assert len(teams) == 48
    for t in teams:
        assert normalize.code_for(t.name) == t.code, t.name


def test_known_cross_source_variants():
    cases = {
        "Korea Republic": "KOR",
        "South Korea": "KOR",
        "USA": "USA",
        "United States": "USA",
        "DR Congo": "COD",
        "Democratic Republic of the Congo": "COD",
        "Czechia": "CZE",
        "Czech Republic": "CZE",
        "Cabo Verde": "CPV",
        "IR Iran": "IRN",
    }
    for name, code in cases.items():
        assert normalize.code_for(name) == code, f"{name} -> {normalize.code_for(name)} != {code}"


def test_accent_and_punctuation_insensitive():
    assert normalize.code_for("Curacao") == "CUW"      # canonical is "Curaçao"
    assert normalize.code_for("Côte d'Ivoire") == "CIV"
    assert normalize.code_for("Cote dIvoire") == "CIV"


def test_fixture_id_resolution():
    # ids are stable in the seed: 1=Mexico, 9=Brazil, 45=England
    assert normalize.code_for_fixture_id("1") == "MEX"
    assert normalize.code_for_fixture_id("9") == "BRA"
    assert normalize.code_for_fixture_id("45") == "ENG"


def test_unknown_is_recorded_not_raised():
    normalize.reset_unknowns()
    assert normalize.code_for("Atlantis") is None
    assert "Atlantis" in normalize.unknown_names()


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS  {fn.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"FAIL  {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    raise SystemExit(1 if failed else 0)
