# World Cup 2026 — Live Odds Predictor

A self-updating bracket that shows each team's odds to advance and win the 2026 World Cup,
recomputing as real results come in. Runs on free data + free hosting.

- **Spec:** [`worldcup-odds-spec.md`](worldcup-odds-spec.md)
- **Spec pressure-test (read this):** [`PRESSURE-TEST.md`](PRESSURE-TEST.md)

> **Status:** Phases 0 (data) + 1 (model) + 2 (simulator) + 4 (front end) built and
> verified. The tournament is underway — completed results flow through to live odds and
> a self-refreshing bracket UI. (Phase 3, the automation pipeline, is next.)

## Quick start

Everything through Phase 2 is **standard-library only** — no install needed (Python 3.9+):

```bash
# Phase 0 — data
python3 scripts/check_sources.py     # which sources are up, latency, # completed
python3 scripts/fetch_data.py        # full pull: history + reconciled live results

# Phase 1 — model
python3 scripts/build_model.py       # Elo + goals model -> data/raw/model.json + summary
python3 scripts/backtest.py          # walk-forward validation + favorites sanity

# Phase 2 — simulator
python3 scripts/simulate.py          # ~10k Monte Carlo runs -> odds.json (data/raw + web/) + board

# Phase 4 — front end (static site in web/, reads odds.json)
python3 -m http.server -d web 4318   # then open http://localhost:4318

# tests (all offline, ~instant)
for t in normalize reconcile elo poisson standings bracket simulator; do python3 tests/test_$t.py; done
```

Optional: enable the football-data.org cross-check by copying `.env.example` → `.env`,
adding a [free token](https://www.football-data.org/client/register), and `source .env`.

## What Phase 0 does

1. **History** — pulls martj42's ~49k international results (1872→today) to seed Elo. All
   48 WC teams have prior history.
2. **Normalisation** — resolves every source's team names to a canonical FIFA code,
   accent/punctuation-insensitive; **unmapped names are reported, never dropped**
   (`data/aliases.json` holds known variants).
3. **Source-agnostic live results** — pulls completed WC2026 matches from every available
   source behind one interface, then **reconciles**: `confirmed` (≥2 sources agree),
   `provisional` (one source), or `conflict` (disagreement, surfaced). Writes
   `data/raw/results_normalized.json`.

Example run today: 49,437 history matches · 104 fixtures · 35 completed (32 confirmed,
3 provisional, 0 conflicts, 0 unmapped names).

## Layout

```
wcodds/
  config.py          paths, source URLs, 2026 format constants (groups, hosts, stages)
  models.py          Team / Match / ReconciledResult dataclasses (FIFA-code keyed)
  normalize.py       name -> FIFA code; history-name merge; unknown-name surfacing
  net.py             stdlib HTTP + cached download (no `requests`)
  fetch.py           orchestrate sources + reconcile completed results
  sources/
    base.py          ResultsSource interface (swap sources without touching the model)
    martj42.py       history + WC2026 results back-fill   (token-free backstop)
    rezarahiminia.py worldcup26.ir live scores            (fast, fragile)
    footballdata.py  football-data.org                    (token'd cross-check)
  elo.py             Elo engine (MOV + importance weighting, home edge)
  poisson.py         Elo-seeded Poisson goals model + Dixon-Coles correction
  linalg.py          tiny Gaussian-elimination solver (for the GLM fit)
  model.py           assemble Elo + goals in one forward pass; save/load model.json
  backtest.py        walk-forward validation (log-loss / RPS / Brier / accuracy)
  bracket.py         fixed 2026 knockout structure + Annex C 495-combo allocation
  standings.py       group tables + 2026 recursive tiebreakers; third-place ranking
  simulator.py       Monte Carlo: groups -> thirds -> knockout -> per-round odds
data/
  teams.json                    48 canonical teams (committed seed)
  fixtures.json                 104-match schedule (committed seed)
  aliases.json                  cross-source name variants
  third_place_allocation.json   Annex C: 495 third-place combinations (committed)
  raw/                          cached downloads + model.json + odds.json (gitignored)
scripts/   check_sources.py · fetch_data.py · build_model.py · backtest.py · simulate.py
tests/     offline unit tests (32 cases; run standalone or via pytest)
web/       index.html (static dashboard) + odds.json — the deployable site
```

The site is **dependency-free** (one `index.html`, vanilla JS, no build step): title-race
board, live group standings, projected bracket, sortable 48-team table, methodology page,
light/dark, and a 60-second auto-refresh that flashes changed odds. Deploy = publish the
`web/` folder; the pipeline (Phase 3) regenerates `web/odds.json` in place.

`simulate.py` bakes the latest odds into `index.html` itself (a `<script id="bootstrap">`
block), so the page works **opened directly** (double-click → `file://`) *and* served.
Browsers block `fetch()` of a local file, so the `file://` version reads the embedded
snapshot; serving over http additionally enables the live fetch + auto-refresh.

## Roadmap

Phase 0 **Data** ✅ → 1 **Model** ✅ → 2 **Simulator** ✅ → 4 **Front end** ✅ →
3 Pipeline (GitHub Action, hourly: fetch → model → simulate → publish `odds.json`) →
5 Explain (confidence + "why it moved" snapshot diff) → 6 Polish. *(Front end built ahead
of the pipeline for visible mid-tournament payoff; it reads the committed `odds.json` until
Phase 3 automates regeneration.)*

**Phase 1 validation** (walk-forward, 5,793 competitive matches 2018→2026): log-loss
**0.848** vs 1.051 baseline, RPS **0.166** (baseline 0.232), accuracy **61.8%** — genuine
skill, competitive with published football models.

**Phase 2 output** (10k sims in ~2.5 s, 35 results fixed, as of 2026-06-19). Title odds:
Argentina **20.9%**, Spain **16.8%**, France **12.6%**, England **8.1%**, Colombia 6.9%,
Brazil/Mexico 4.9%. Internally consistent — Σ(win%)=1.000, Σ(finalist%)=2.000 across all
48 teams. The 2026 head-to-head-first tiebreakers and the full 495-combo Annex C
third-place allocation are implemented and unit-tested.

**Known model limitation (still open):** the goals model conditions on the Elo *difference*
only, so it can't tell two strong teams from two weak ones — goal *totals* compress for
elite-vs-elite. W/D/L is unaffected (backtest-confirmed) and round-count invariants hold,
so it didn't block Phase 2; revisit with an absolute-strength (sum) term if goal-difference
tiebreaks prove sensitive.

*Personal / non-commercial project.*
