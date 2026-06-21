#!/usr/bin/env python3
"""Phase 0 end-to-end: history + normalisation + live results, with a report.

    python3 scripts/fetch_data.py            # full run (uses cached history)
    python3 scripts/fetch_data.py --refresh  # force re-download of history
    python3 scripts/fetch_data.py --no-history
    python3 scripts/fetch_data.py --json     # machine-readable

Writes data/raw/results_normalized.json (the reconciled completed results).
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wcodds import config, fetch, normalize          # noqa: E402
from wcodds.sources import Martj42Source             # noqa: E402


def _hr(title: str) -> None:
    print(f"\n{'=' * 64}\n{title}\n{'=' * 64}")


def history_summary(refresh: bool) -> dict:
    src = Martj42Source(refresh=refresh)
    rows = src.history()
    dates = [r.date for r in rows]
    wc_codes = {t.code for t in normalize.canonical_teams()}
    seen = set()
    for r in rows:
        for nm in (r.home, r.away):
            c = normalize.code_for(nm)
            if c in wc_codes:
                seen.add(c)
    return {
        "matches": len(rows),
        "date_range": [min(dates), max(dates)] if dates else [],
        "wc_teams_with_history": f"{len(seen)}/{len(wc_codes)}",
        "missing_wc_teams": sorted(wc_codes - seen),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="WC2026 odds — Phase 0 data pull")
    ap.add_argument("--refresh", action="store_true", help="re-download history CSV")
    ap.add_argument("--no-history", action="store_true", help="skip the ~5MB history pull")
    ap.add_argument("--json", action="store_true", help="emit JSON only")
    args = ap.parse_args()

    report = fetch.gather(refresh=args.refresh)
    fixtures = fetch.load_fixtures()
    reconciled = report["reconciled"]

    hist = None
    if not args.no_history:
        hist = history_summary(args.refresh)

    # write the normalized live results artifact
    out_path = config.RAW_DIR / "results_normalized.json"
    out_path.write_text(json.dumps(
        {"results": [asdict(r) for r in reconciled], "unknown_names": report["unknown_names"]},
        ensure_ascii=False, indent=2), encoding="utf-8")

    if args.json:
        print(json.dumps({
            "history": hist,
            "sources_used": report["sources_used"],
            "per_source_counts": report["per_source_counts"],
            "results": [asdict(r) for r in reconciled],
            "unknown_names": report["unknown_names"],
        }, ensure_ascii=False, indent=2, default=str))
        return 0

    # --- human report --------------------------------------------------------
    _hr("FIXTURES (seed)")
    print(f"loaded {len(fixtures)} matches | stages: {dict(Counter(f.stage for f in fixtures))}")

    if hist:
        _hr("HISTORY (martj42)")
        print(f"matches: {hist['matches']:,}  |  range: {hist['date_range'][0]} -> {hist['date_range'][1]}")
        print(f"WC teams with prior history: {hist['wc_teams_with_history']}")
        if hist["missing_wc_teams"]:
            print(f"  (no history found for: {', '.join(hist['missing_wc_teams'])})")

    _hr("LIVE RESULTS (reconciled across sources)")
    print(f"sources available: {', '.join(report['sources_used']) or '(none)'}")
    print(f"per-source completed counts: {report['per_source_counts']}")
    status_counts = Counter(r.status for r in reconciled)
    print(f"completed matches: {len(reconciled)}  |  {dict(status_counts)}\n")

    for r in reconciled:
        flag = {"confirmed": "OK ", "provisional": " ? ", "conflict": "!! "}.get(r.status, "   ")
        line = (f"  {flag} {normalize.name_for(r.home):>14} {r.home_score}-{r.away_score} "
                f"{normalize.name_for(r.away):<14}  [{','.join(r.sources)}]")
        if r.status == "conflict":
            line += f"  CONFLICT: {r.note}"
        print(line)

    if report["unknown_names"]:
        _hr("UNMAPPED NAMES  (add to data/aliases.json)")
        for nm in report["unknown_names"]:
            print(f"  - {nm}")

    print(f"\nwrote {out_path.relative_to(config.BASE_DIR)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
