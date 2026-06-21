# World Cup 2026 — Live Odds Predictor
### Product Specification v1.0

*Non-commercial / personal project*

---

## 1. Summary

A web app that shows a live, self-updating bracket for the 2026 FIFA World Cup. Each team carries a probability of advancing through each round and winning the tournament. As real results come in, the model re-runs and the bracket updates on its own. Where a viewer wants to know *why* the numbers moved, the app can explain it.

**One-line pitch:** A bracket that knows the odds, and updates itself as the tournament plays out.

---

## 2. Goals & non-goals

**Goals**
- Show per-team odds for the *entire* tournament (now → final, all 48 teams), visualized as a bracket.
- Auto-refresh: recompute after each completed match, plus a periodic safety poll (hourly).
- Surface model confidence and a short "why this moved" explanation per team.
- Run entirely on free data sources and free hosting.

**Non-goals (v1)**
- No betting, money, or odds-to-stake conversion.
- No pick'em / multi-user accounts / leaderboards.
- No player- or lineup-level modeling (free data doesn't support it well).
- No live in-match win probability (we update on *completed* results, not minute-by-minute).

---

## 3. Users

| User | Need |
|------|------|
| Primary (you) | A credible, good-looking live model you control and can tinker with. |
| Casual visitor | "Who's likely to win?" answered at a glance, with the bracket as the hook. |
| Curious visitor | "Why did Brazil's odds jump?" — optional drill-down. |

---

## 4. Scope: the tournament

The 2026 format is the first 48-team World Cup: 12 groups of 4, 104 total matches, hosted across the US, Mexico, and Canada. The knockout stage includes a Round of 32 (the top two from each group plus the eight best third-placed teams), then R16 → QF → SF → Final.

The model must handle:
- **Group stage:** round-robin within each group; standard FIFA tiebreakers (points → goal difference → goals scored → head-to-head, etc.).
- **Third-place qualification:** rank the 12 third-placed teams; top 8 advance. This is the fiddliest bit of bracket logic and needs explicit handling.
- **Knockout:** single-elimination; draws resolved by extra time then penalties (modeled as a near-coin-flip, slightly weighted by team strength).

---

## 5. The model (recommended approach)

**Chosen design: Elo-seeded bivariate Poisson, with Monte Carlo simulation.**

Reasoning for a personal, free, international-tournament use case:
- A pure Elo gives a clean win/draw/loss probability and is transparent, but doesn't produce scorelines (needed for group-stage goal-difference tiebreakers).
- A trained ML model is data-hungry and hard to keep honest with the sparse, free data available for national teams.
- A **Poisson goal model seeded by Elo ratings** hits the sweet spot: it produces realistic scorelines (so tiebreakers work), stays interpretable, and updates cleanly from match results.

**How it works**
1. **Ratings.** Maintain an Elo rating per team, initialized from history and updated after every completed match (margin-of-victory weighted; friendlies discounted vs. competitive matches).
2. **Match model.** Convert the Elo difference (plus a small host/neutral-venue adjustment) into expected goals for each side, then draw scorelines from a bivariate Poisson distribution.
3. **Simulation.** Monte Carlo: simulate every remaining match thousands of times (target ~10,000 runs), applying real results as fixed where they've already happened. Apply group tiebreakers, resolve third-place ranking, build the knockout bracket, resolve draws via ET/penalties.
4. **Aggregate.** Across all runs, compute each team's probability of reaching each round and winning the Cup.

**Confidence & explanation (for the "why it moved" feature)**
- **Confidence:** report the spread of outcomes, not just the point estimate (e.g. a team at 18% with a tight distribution vs. a volatile one). Early in the tournament, confidence is inherently low; show that honestly.
- **"Why it moved":** after each recompute, diff the new probabilities against the previous snapshot and attribute the change to the result(s) that triggered it ("Argentina +6% to win group after beating Croatia 2–0; their R32 path now avoids France").

---

## 6. Data sources (all free, non-commercial)

| Purpose | Source | Notes |
|---------|--------|-------|
| **Historical training** | `martj42/international_results` (GitHub raw CSV) | ~49k internationals since 1872, daily-updated, no key. Used to initialize Elo and fit the Poisson model. |
| **Live results (primary)** | `rezarahiminia/worldcup2026` REST API | Purpose-built for WC2026: groups, 104 matches, scores, standings; no key for reads. **Verify uptime/latency before the tournament; have a fallback.** |
| **Live results (fallback)** | football-data.org free tier | Reliable but limited: 10 req/min, delayed scores, free token. Competition code `WC`. Use as cross-check / backup. |
| **Ratings feature (optional)** | Compute own Elo from martj42 history | Avoids scraping; fully free; deterministic. Preferred over eloratings.net scraping. |

**Licensing note:** these sources are non-commercial-friendly but each carries its own terms (football-data.org is explicitly non-commercial; Kaggle/GitHub datasets carry their own licenses). Fine for this project; revisit if it ever ships commercially.

---

## 7. Architecture

Keep it simple and free. Two moving parts: a scheduled job that updates the model, and a static front end that reads its output.

```
┌─────────────────────────────────────────────┐
│ Scheduled job (runs hourly + on-demand)      │
│  1. Fetch completed results (live API)       │
│  2. Update Elo ratings                       │
│  3. Run Monte Carlo (~10k sims)              │
│  4. Diff vs. previous snapshot ("why moved") │
│  5. Write odds.json + history snapshots      │
└───────────────────────┬─────────────────────┘
                        │ writes
                        ▼
              ┌──────────────────┐
              │  odds.json       │  (static, versioned)
              │  + snapshots/    │
              └────────┬─────────┘
                        │ reads
                        ▼
┌─────────────────────────────────────────────┐
│ Static web app (bracket UI)                   │
│  - Renders bracket + probabilities            │
│  - Auto-refreshes (polls odds.json)           │
│  - Drill-down: confidence + "why it moved"    │
└─────────────────────────────────────────────┘
```

**Recommended stack (simplest free path):**
- **Hosting:** Netlify (you've used it). Static front end + a scheduled Netlify Function for the update job. Free tier covers this easily.
- **Compute job:** the Monte Carlo runs in the scheduled function (or a GitHub Action on a cron, which is also free and avoids function timeout limits — preferred if 10k sims is slow). Output committed/published as `odds.json`.
- **Storage:** no database needed for v1. `odds.json` is the live state; a `snapshots/` folder of timestamped JSON gives you history and powers the "why it moved" diff. (Supabase is available later if you want queryable history, but it's not needed for v1.)
- **Front end:** static site (your choice of framework). Reads JSON, renders the bracket. No server state.

**Why GitHub Action over a serverless function for the sim:** 10,000 tournament simulations may exceed a serverless function's timeout. A cron-scheduled Action has generous runtime, runs the Python model, and publishes the JSON. The front end never runs the model — it just reads results.

---

## 8. Visual direction

Sporty and data-forward (distinct from your editorial projects). Principles:
- **Bracket is the hero.** The full 48→1 structure is the landing view. Probabilities live on the bracket itself, not in a side table.
- **Data-dense but legible.** Think a clean stats-broadcast / FiveThirtyEight-era feel: confident typography, a functional accent palette, probability bars/sparklines inline.
- **Motion = meaning.** When odds update, animate the change so a returning viewer can see what moved.
- **Honest uncertainty.** Show confidence visually (e.g. faded/tighter bars when the model is unsure), never false precision.

A dedicated **methodology page** explains the model in plain language (Elo + Poisson + Monte Carlo, data sources, limitations) — this is where the credibility lives for a data-forward audience.

---

## 9. Key screens

1. **Bracket view (landing).** Full tournament tree. Each team shows its live odds to win the Cup; knockout slots show advancement probabilities. Auto-refreshes.
2. **Team drill-down.** Tap a team → probability to reach each round, confidence, and a short "why your odds moved" feed tied to recent results.
3. **Group stage view.** The 12 groups with projected standings and qualification odds (incl. third-place scenarios).
4. **Methodology / about.** How the model works, data sources, limitations, last-updated timestamp.

---

## 10. Edge cases & risks

- **Third-place qualification logic** is the most error-prone part — needs its own test cases.
- **Live API reliability:** the primary source is a hobby project. Build the fetch layer source-agnostic so you can swap to the fallback without touching the model.
- **Team-name mismatches** between the historical dataset and the live API (e.g. "South Korea" vs "Korea Republic"). Needs a normalization map.
- **Pre-tournament cold start:** before any matches, odds rest entirely on Elo priors — communicate that this is expected and uncertainty is high.
- **Penalty shootouts:** treat as near-random with a slight strength lean; don't over-model.
- **Free-tier rate limits:** hourly polling + on-result is well within limits; don't poll aggressively.

---

## 11. Build phases

| Phase | Deliverable |
|-------|-------------|
| **0 — Data** | Pull martj42 history; build team-name normalization; wire live API fetch (primary + fallback). |
| **1 — Model** | Elo from history; Poisson match model; validate on past tournaments (backtest). |
| **2 — Simulator** | Monte Carlo engine: groups, tiebreakers, third-place ranking, knockout. Outputs `odds.json`. |
| **3 — Pipeline** | Scheduled job (GitHub Action): fetch → update → simulate → diff → publish. |
| **4 — Front end** | Bracket UI reading `odds.json`; auto-refresh. |
| **5 — Explain** | Confidence display + "why it moved" diffing + methodology page. |
| **6 — Polish** | Visual design pass, motion on updates, mobile layout. |

---

## 12. Success criteria

- Bracket renders all 48 teams with sensible probabilities that sum correctly per slot.
- A completed real result triggers a visible, correct odds update within the refresh window.
- Backtest: model's pre-tournament favorites are reasonable vs. a past World Cup.
- A viewer can answer "who's most likely to win?" in under 5 seconds and "why did that change?" in under 30.
- Runs at $0/month.
