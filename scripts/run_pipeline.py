#!/usr/bin/env python3
"""Phase 3 — the full update pipeline (what the GitHub Action runs hourly).

    fetch refreshed history + live results  ->  rebuild Elo + goals model
        ->  Monte Carlo  ->  publish web/odds.json (+ index.html bootstrap, + prev)

Run it locally exactly as CI does:

    python3 scripts/run_pipeline.py

Stdlib only, so CI needs no `pip install`. The publish step is guarded: if the
live fetch comes back with fewer completed results than already published, it
keeps the last good odds instead of regressing the site.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(*args: str) -> None:
    print("\n$ python " + " ".join(args), flush=True)
    subprocess.run([sys.executable, *args], cwd=str(ROOT), check=True)


def main() -> int:
    # 1+2. refresh history (martj42 back-fills WC scores) and refit Elo + goals model
    run("scripts/build_model.py", "--refresh")
    # 3+4+5. fetch live results, simulate, publish (guarded)
    run("scripts/simulate.py", "--refresh", "--guard")
    print("\npipeline complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
