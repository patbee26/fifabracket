# Spec pressure-test — World Cup 2026 Odds Predictor

*Verified against the live sources on 2026-06-20 (tournament day ~10). Every claim
below was checked by actually hitting the endpoints / dataset, not from memory.*

## Verdict

The spec is **sound and buildable** — the model choice, the static-JSON architecture,
and the $0 constraint all hold up. But three things need correcting before more code
lands, and one is urgent:

1. **The live-data plan is backwards.** The "primary" source is the fragile one; the
   "fallback" is the reliable one; and a *third*, more robust source the spec never
   mentions is already serving the data.
2. **We're mid-tournament, not pre-tournament.** The spec reads as a pre-kickoff build;
   ~35 group matches are already played. The "cold start" risk is moot — backfill is the
   first real job.
3. **The two highest-risk pieces of logic** (third-place allocation, the 2026 tiebreaker
   order) are under-specified and need pinning down before the simulator (Phase 2).

---

## 1. Data sources — what's actually true

| Source | Spec said | Reality (verified) |
|---|---|---|
| **martj42** | "history only; compute Elo from it" | ✅ History is perfect (49,437 matches, 1872→2026-06-19, **all 48 WC teams have prior history**). **Bonus the spec missed:** it carries the full WC2026 fixture list *and back-fills real scores* (11–19 Jun present, identical to the live API). No token, no auth, plain GitHub raw CSV — **our most reliable results source.** |
| **rezarahiminia** | "primary; **no key for reads**" | ⚠️ Wrong on the key. Its README says *"all endpoints require a JWT."* In practice `/get/games` is **currently open** and serving live scores — i.e. undocumented behaviour that can change under us. Host is up (~1.3 s, 9-day uptime), but it's an Iranian domain proxying a Persian site (Varzesh3), with a name-translation layer and **malformed fields** (scorers come back as curly-quoted blobs; scores/booleans are strings). Fine for *scores*, rough everywhere else. |
| **football-data.org** | "fallback, free token" | ✅ Correct, but **403 without a token** (verified) — not zero-setup. Reliable infra, 10 req/min, scores delayed a few minutes. |

### The correction that matters

> **Our design updates on _completed_ matches, hourly.** So the live source's one
> advantage — 3-second granularity — is **worthless to us.** Reliability should dominate
> source choice, not speed.

So the ranking should flip:

- **martj42 = trusted backstop** (can't really 403; daily cadence is plenty for an hourly
  completed-match pipeline).
- **rezarahiminia = fast nudge** ("something changed since the last daily commit"), never
  trusted alone.
- **football-data.org = token'd cross-check.**
- **Never trust one source.** Phase 0 already reconciles: a result is `confirmed` only when
  ≥2 sources agree, `provisional` on one, `conflict` (surfaced, not silently picked) on
  disagreement. Live run today: **32 confirmed, 3 provisional, 0 conflicts, 0 unmapped names.**

This is implemented and proven (`scripts/fetch_data.py`). It directly executes the spec's
own risk mitigations #2 (source-agnostic layer) and #3 (name normalisation).

---

## 2. Timing: the train has left the station

Today is **day ~10**. USA already qualified, Haiti are out, ~35 of 72 group games are done.
Consequences for the build order:

- **Phase 0's first job is backfill, not priming** — already handled (we pull all completed
  results, normalised + reconciled).
- The pre-tournament "Elo-priors-only cold start" risk in §10 of the spec **no longer
  applies**; we have real signal.
- **Pull the front-end forward.** A bracket that shows the *current* standings + naïve
  advancement is valuable now and de-risks the UI before the model is perfect. Consider
  Phase 4 (front end) in parallel with Phase 2 (simulator) rather than strictly after.

---

## 3. Model & format risks (Phase 1–2)

**The model choice is good.** Elo-seeded bivariate Poisson + Monte Carlo is the
well-trodden, interpretable approach (it's the Dixon–Coles lineage). Two refinements:

- **Low-score correction.** A plain double-Poisson mis-prices 0-0/1-0/1-1 — exactly the
  scorelines that decide group tiebreakers. Apply the **Dixon–Coles τ correction** (or a
  small bivariate correlation term). Cheap, materially better.
- **Host advantage ≠ the `neutral` flag.** martj42 marks some host-country games oddly
  (e.g. Haiti–Scotland in Foxborough as non-neutral). Don't read advantage off that flag —
  give the bump only to **USA/MEX/CAN in their own country**. Already encoded as
  `config.HOST_NATIONS`.

**The two genuinely fiddly bits (highest bug risk):**

- **Third-place allocation.** With 12 groups, the 8-of-12 advancing thirds create
  **C(12,8) = 495** combinations, each mapping thirds to specific R32 slots via a
  *predetermined FIFA table* (Wikipedia's "2026 knockout stage" article has all 495 rows;
  source of truth is **Annex C of the FIFA regulations**). This must be **hardcoded and
  unit-tested** — do not try to infer it at runtime. The spec rightly flags it as #1 risk;
  budget real time and dedicated test cases.
  > ✅ **Resolved (Phase 2):** all 495 rows parsed from Annex C → `data/third_place_allocation.json`,
  > validated (each row maps 8 winners to the 8 distinct qualifying thirds, all within their
  > candidate sets) and unit-tested in `tests/test_bracket.py`.
- **2026 tiebreaker order changed.** Wikipedia indicates FIFA moved **head-to-head points
  up to the first tiebreaker** (ahead of goal difference) for 2026. The spec lists the old
  order (points → GD → GF → H2H). **Confirm against the official regulations** and encode
  the correct sequence — it changes who advances in tight groups.
  > ✅ **Resolved (Phase 2):** confirmed from the FWC2026 regulations — overall points →
  > head-to-head (pts → GD → goals, recursively reapplied) → overall GD → overall goals →
  > fair play → FIFA ranking. Implemented in `standings.py` (a–e exact, Elo as the
  > deterministic final separator), with the head-to-head-first case unit-tested.
- **Penalties:** spec's "near-coin-flip, slight strength lean" is right; don't over-model.
  `martj42` also ships `shootouts.csv` if you ever want to calibrate the lean empirically.

---

## 4. Architecture & feasibility

- **GitHub Action over a serverless function for the sim: agreed.** 10k full-tournament
  sims will blow a typical function timeout; an Action has the runtime and is free for
  public repos. Front end stays static, reading `odds.json`.
- **10k sims in Python is fine — with numpy.** Pure-Python nested loops over ~70 remaining
  matches × 10k would be sluggish; vectorise the Poisson draws. Comfortably minutes, well
  within an Action.
- **Pin the third-party JS API out of the runtime.** The live API is a hobby project on a
  domain that could disappear. The pipeline already degrades gracefully (martj42 alone is
  enough to keep odds updating). Good.
- **`snapshots/` for the "why it moved" diff: keep it.** It's the cheapest way to attribute
  probability changes to results, and doubles as an audit log. No DB needed for v1 — agreed.

---

## 5. Smaller notes

- **Type hygiene:** every live-API field is a string (`"2"`, `"TRUE"`); scorer arrays are
  malformed. Parsing is defensive in `sources/rezarahiminia.py`; keep it that way.
- **Name normalisation is real but tractable:** only the 48 teams matter for results. Today
  every name mapped (DR Congo, Curaçao, Côte d'Ivoire included). New variants from
  football-data.org will appear once its token is added — `fetch_data.py` *prints unmapped
  names* so they're caught, not dropped.
- **Licensing:** non-commercial is fine for all three; revisit only if it ever ships.

## Scorecard

| Spec claim | Status |
|---|---|
| Free / $0 / no backend | ✅ holds |
| martj42 for history | ✅ + it's also a live results source |
| rezarahiminia "no key for reads" | ⚠️ contradicts its own README; currently true, fragile |
| football-data fallback | ✅ but needs a token (403 without) |
| Elo + bivariate Poisson + MC | ✅ sound; add Dixon–Coles low-score correction |
| Third-place logic = #1 risk | ✅ done — 495-combo Annex C table parsed, validated, tested |
| Group tiebreakers (the order) | ✅ done — 2026 H2H-first order confirmed + implemented |
| Host adjustment | ⚠️ don't use the `neutral` flag; hosts = USA/MEX/CAN |
| Pre-tournament cold start | ❌ moot — we're mid-tournament |
| GitHub Action for the sim | ✅ right call |
