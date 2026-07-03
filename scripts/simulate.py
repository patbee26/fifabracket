#!/usr/bin/env python3
"""Phase 2: Monte Carlo the rest of the tournament -> odds.json.

    python3 scripts/simulate.py                 # 10k sims (uses cached results + model)
    python3 scripts/simulate.py --sims 20000
    python3 scripts/simulate.py --refresh       # re-pull live results first

Reads data/raw/model.json (Phase 1) and data/raw/results_normalized.json
(Phase 0). Writes data/raw/odds.json.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wcodds import config, fetch, model, normalize, simulator  # noqa: E402


def load_completed(refresh: bool) -> dict:
    """sorted-pair -> (score_lo, score_hi), from the Phase 0 artifact or a live pull."""
    if refresh or not config.RESULTS_OUT.exists():
        results = fetch.gather(refresh=refresh)["reconciled"]
        rows = [{"home": r.home, "away": r.away, "home_score": r.home_score,
                 "away_score": r.away_score, "status": r.status} for r in results]
    else:
        rows = json.loads(config.RESULTS_OUT.read_text(encoding="utf-8"))["results"]
    completed = {}
    for r in rows:
        if r["status"] == "conflict":
            continue
        completed[(r["home"], r["away"])] = (r["home_score"], r["away_score"])
    return completed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sims", type=int, default=config.DEFAULT_SIMS)
    ap.add_argument("--seed", type=int, default=12345)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--guard", action="store_true",
                    help="skip publishing if completed-results dropped (flaky-fetch protection)")
    ap.add_argument("--top", type=int, default=24)
    args = ap.parse_args()

    if not config.MODEL_OUT.exists():
        print("model.json missing — run scripts/build_model.py first.", file=sys.stderr)
        return 1
    payload, goals = model.load()
    ratings = {c: float(v) for c, v in payload["wc_ratings"].items()}
    completed = load_completed(args.refresh)

    t0 = time.time()
    probs, n, matchups, scenarios = simulator.run(ratings, goals, completed, n=args.sims, seed=args.seed)
    dt = time.time() - t0

    cur = simulator.current_standings(completed, ratings)
    teams = sorted(normalize.canonical_teams(), key=lambda t: -probs[t.code]["champion"])
    out = {
        "as_of": payload.get("as_of", ""),
        "n_sims": n,
        "completed_results": len(completed),
        "model_params": payload.get("goals_params", {}),
        "teams": [{
            "code": t.code, "name": t.name, "group": t.group,
            "elo": round(ratings[t.code]),
            "played": cur[t.code]["played"], "pts": cur[t.code]["pts"],
            "gd": cur[t.code]["gd"], "gf": cur[t.code]["gf"], "pos": cur[t.code]["pos"],
            **{f"p_{r}": round(probs[t.code][r], 4) for r in simulator.ROUNDS},
        } for t in teams],
    }
    payload_json = json.dumps(out, ensure_ascii=False, indent=2)

    # matchup explorer data: per team, per round, the distribution of opponents faced
    mu = {"n_sims": n, "teams": {}}
    for t in teams:
        rounds = {}
        for rnd in simulator.MATCH_ROUNDS:
            opps = matchups[t.code][rnd]
            if opps:
                rounds[rnd] = {"reach": sum(opps.values()), "opps": opps}
        mu["teams"][t.code] = rounds
    matchups_json = json.dumps(mu, ensure_ascii=False, separators=(",", ":"))

    # clinching scenarios: per team, qualify count + chance conditional on the next game
    scenarios_json = json.dumps({"n_sims": n, "teams": scenarios}, ensure_ascii=False, separators=(",", ":"))

    # live knockout bracket: actual teams / scores / winners resolved from results so far
    from wcodds.sources.martj42 import Martj42Source
    shootouts = Martj42Source(refresh=args.refresh).shootouts()
    bracket_state = simulator.resolve_bracket(completed, shootouts, ratings)
    bracket_state["as_of"] = payload.get("as_of", "")
    bracket_json = json.dumps(bracket_state, ensure_ascii=False, separators=(",", ":"))

    web_dir = config.BASE_DIR / "web"
    web_odds = web_dir / "odds.json"

    # Completed results only ever grow during a tournament; a drop means a flaky live
    # fetch. Under --guard (the pipeline), keep the last good odds rather than regress.
    if args.guard and web_odds.exists():
        try:
            published = json.loads(web_odds.read_text(encoding="utf-8")).get("completed_results", 0)
        except Exception:
            published = 0
        if out["completed_results"] < published:
            print(f"guard: {out['completed_results']} completed results < published {published} "
                  f"(likely a flaky fetch) — keeping last good, not publishing.")
            return 0

    config.ODDS_OUT.write_text(payload_json, encoding="utf-8")
    (config.RAW_DIR / "matchups.json").write_text(matchups_json, encoding="utf-8")
    (config.RAW_DIR / "scenarios.json").write_text(scenarios_json, encoding="utf-8")
    (config.RAW_DIR / "bracket.json").write_text(bracket_json, encoding="utf-8")
    if web_dir.exists():
        if web_odds.exists():   # keep the prior run for the "why it moved" diff (Phase 5)
            (web_dir / "odds.prev.json").write_text(web_odds.read_text(encoding="utf-8"), encoding="utf-8")
        web_odds.write_text(payload_json, encoding="utf-8")
        (web_dir / "matchups.json").write_text(matchups_json, encoding="utf-8")
        (web_dir / "scenarios.json").write_text(scenarios_json, encoding="utf-8")
        (web_dir / "bracket.json").write_text(bracket_json, encoding="utf-8")
        # bake the data into index.html's <script id="bootstrap"> so the page also works
        # opened directly as a file:// (browsers block fetch of a local odds.json).
        web_index = web_dir / "index.html"
        if web_index.exists():
            html = web_index.read_text(encoding="utf-8")
            html = re.sub(
                r'(<script id="bootstrap" type="application/json">).*?(</script>)',
                lambda m: m.group(1) + "\n" + payload_json + "\n" + m.group(2),
                html, count=1, flags=re.S)
            web_index.write_text(html, encoding="utf-8")

    # --- report ---
    print(f"{n:,} sims in {dt:.1f}s  |  {len(completed)} completed results fixed  |  as of {payload.get('as_of')}\n")
    print(f"{'#':>3} {'team':<26}{'grp':>4}{'elo':>6}{'win%':>8}{'final':>8}{'sf':>7}{'qf':>7}{'r16':>7}{'qual':>7}")
    print("-" * 90)
    for i, t in enumerate(teams[:args.top], 1):
        p = probs[t.code]
        print(f"{i:>3} {t.name:<26}{t.group:>4}{ratings[t.code]:>6.0f}"
              f"{p['champion']*100:>7.1f}%{p['final']*100:>7.1f}%{p['sf']*100:>6.1f}%"
              f"{p['qf']*100:>6.1f}%{p['r16']*100:>6.1f}%{p['qualify']*100:>6.1f}%")

    # sanity: exactly one champion & two finalists per sim
    tot_champ = sum(probs[c]["champion"] for c in ratings)
    tot_final = sum(probs[c]["final"] for c in ratings)
    print(f"\nsanity: sum(win%)={tot_champ:.3f} (=1.0)  sum(final%)={tot_final:.3f} (=2.0)")
    print(f"wrote {config.ODDS_OUT.relative_to(config.BASE_DIR)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
