"""Static configuration: paths, source URLs, and 2026 format constants.

Everything that is "a fact about the tournament or our sources" lives here so the
rest of the code carries no magic strings.
"""
from __future__ import annotations

import os
from pathlib import Path

# --- Paths (resolved relative to this file, so cwd never matters) -------------
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
TEAMS_SEED = DATA_DIR / "teams.json"
FIXTURES_SEED = DATA_DIR / "fixtures.json"
ALIASES_SEED = DATA_DIR / "aliases.json"
ALLOC_SEED = DATA_DIR / "third_place_allocation.json"   # Annex C: 495 third-place combos
MODEL_OUT = RAW_DIR / "model.json"
RESULTS_OUT = RAW_DIR / "results_normalized.json"
ODDS_OUT = RAW_DIR / "odds.json"                         # the published artifact (Phase 3)

# --- Data sources ------------------------------------------------------------
# History: rock-solid, public, no token. Daily git commits; ALSO carries the
# WC2026 fixtures and back-fills real scores as matches complete (see PRESSURE-TEST).
MARTJ42_RESULTS = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv"
MARTJ42_SHOOTOUTS = "https://raw.githubusercontent.com/martj42/international_results/master/shootouts.csv"

# Live (fast): purpose-built WC2026 API. /get/games currently serves live scores
# WITHOUT auth despite its README claiming JWT is required — treat as undocumented
# and liable to change. Iranian host, Persian-translated upstream (Varzesh3).
REZA_BASE = "https://worldcup26.ir"
REZA_GAMES = REZA_BASE + "/get/games"
REZA_HEALTH = REZA_BASE + "/health"

# Live (reliable, token-gated): football-data.org free tier. Set the token in the
# environment (see .env.example). 10 req/min, delayed-but-trustworthy scores.
FOOTBALLDATA_BASE = "https://api.football-data.org/v4"
FOOTBALLDATA_MATCHES = FOOTBALLDATA_BASE + "/competitions/WC/matches"
FOOTBALLDATA_TOKEN = os.environ.get("FOOTBALL_DATA_TOKEN", "").strip()

HTTP_TIMEOUT = 30  # seconds, per request
USER_AGENT = "wc2026-odds/0.0.1 (personal, non-commercial)"

# --- Tournament format (2026: first 48-team World Cup) ------------------------
TOURNAMENT_START = "2026-06-11"          # opening match; used to slice WC rows
N_TEAMS = 48
GROUPS = list("ABCDEFGHIJKL")            # 12 groups
N_GROUPS = len(GROUPS)
TEAMS_PER_GROUP = 4
ADVANCE_PER_GROUP = 2                     # top two go straight through
BEST_THIRDS = 8                          # plus the 8 best third-placed teams -> R32
GROUP_MATCHES = 72                       # 12 groups * 6 round-robin matches
TOTAL_MATCHES = 104

# The three hosts get a genuine home-field edge in their OWN country. Do NOT trust
# a source's `neutral` flag for this (martj42 marks some host-country games as
# non-neutral for non-host teams) — detect hosts explicitly. See PRESSURE-TEST.
HOST_NATIONS = {"USA", "MEX", "CAN"}

# Stage labels we normalise every source onto.
STAGE_GROUP = "group"
STAGE_R32 = "r32"
STAGE_R16 = "r16"
STAGE_QF = "qf"
STAGE_SF = "sf"
STAGE_THIRD = "third"   # third-place play-off (loser SF vs loser SF), NOT 3rd-place qualifying
STAGE_FINAL = "final"

# --- Simulation ---------------------------------------------------------------
DEFAULT_SIMS = 10000
# Penalty shootout: near coin-flip with a slight lean to the stronger side.
# P(stronger advances) = 0.5 + (elo_expected - 0.5) * PENALTY_LEAN.
PENALTY_LEAN = 0.5
