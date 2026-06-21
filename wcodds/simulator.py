"""Monte Carlo tournament simulator.

One simulation: fill every unplayed match (fixing real results), rank groups
with the 2026 tiebreakers, rank the third-placed teams, apply the Annex C
allocation, build and play the knockout bracket. Aggregate over ~10k runs to get
each team's probability of reaching each round and winning the Cup.

Scoreline distributions are cached per pairing (DC matrix is built once), so the
whole 10k-run job stays fast in pure Python. Phase 3 can vectorise with numpy if
needed.
"""
from __future__ import annotations

import random
from collections import defaultdict
from typing import Dict, FrozenSet, List, Optional, Tuple

from . import bracket, config, fetch, normalize, standings
from .poisson import GoalsModel
from .standings import Stat

Pair = Tuple[str, str]                       # sorted (code, code)
Completed = Dict[Pair, Tuple[int, int]]      # sorted-pair -> (score_lo, score_hi)
ROUNDS = ("qualify", "r16", "qf", "sf", "final", "champion")


def _pair(a: str, b: str) -> Pair:
    return (a, b) if a <= b else (b, a)


class Sampler:
    """Caches per-pairing scoreline distribution + W/D/L probabilities."""

    def __init__(self, ratings: Dict[str, float], goals: GoalsModel, rng: random.Random):
        self.r = ratings
        self.g = goals
        self.rng = rng
        self._cache: Dict[tuple, tuple] = {}   # (a,b) order-sensitive -> (cum, pA, pD, pB)

    def _hf(self, a: str, b: str) -> Tuple[bool, bool]:
        ah, bh = a in config.HOST_NATIONS, b in config.HOST_NATIONS
        if ah and not bh:
            return True, False
        if bh and not ah:
            return False, True
        return False, False  # both hosts (never in groups) or neither -> neutral

    def _dist(self, a: str, b: str):
        key = (a, b)
        d = self._cache.get(key)
        if d is None:
            hfa, hfb = self._hf(a, b)
            la, lb = self.g.lambdas_hf(self.r[a], self.r[b], hfa, hfb)
            m = self.g.scoreline_matrix(la, lb)
            cum: List[Tuple[int, int, float]] = []
            acc = pa = pd = pb = 0.0
            for i, row in enumerate(m):
                for j, p in enumerate(row):
                    acc += p
                    cum.append((i, j, acc))
                    if i > j:
                        pa += p
                    elif i == j:
                        pd += p
                    else:
                        pb += p
            d = (cum, pa, pd, pb)
            self._cache[key] = d
        return d

    def score(self, a: str, b: str) -> Tuple[int, int]:
        cum = self._dist(a, b)[0]
        r = self.rng.random()
        for i, j, c in cum:
            if r <= c:
                return i, j
        return cum[-1][0], cum[-1][1]

    def advance(self, a: str, b: str) -> str:
        """Winner of a knockout tie (regulation W/D/L, draws -> penalty lean)."""
        _, pa, pd, pb = self._dist(a, b)
        r = self.rng.random()
        if r < pa:
            return a
        if r < pa + pb:
            return b
        we = 1.0 / (1.0 + 10.0 ** (-(self.r[a] - self.r[b]) / 400.0))
        p = 0.5 + (we - 0.5) * config.PENALTY_LEAN
        return a if self.rng.random() < p else b


def load_group_fixtures() -> Dict[str, List[Pair]]:
    """group -> the six round-robin pairings (offline, from the seed)."""
    out: Dict[str, List[Pair]] = defaultdict(list)
    for m in fetch.load_fixtures():
        if m.stage == config.STAGE_GROUP and m.home and m.away:
            out[m.group].append((m.home, m.away))
    return out


def _group_members() -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = defaultdict(list)
    for t in normalize.canonical_teams():
        out[t.group].append(t.code)
    return out


def current_standings(completed: Completed, ratings: Dict[str, float]) -> Dict[str, dict]:
    """Live group table from results played so far (2026 tiebreakers). Groups with no
    games yet fall back to an Elo-based provisional order."""
    members = _group_members()
    elo = lambda c: ratings.get(c, 1500.0)
    cur: Dict[str, dict] = {}
    for g, codes in members.items():
        matches = [(a, b, sa, sb) for (a, b), (sa, sb) in completed.items()
                   if a in codes and b in codes]
        stats = standings.team_stats(codes, matches)
        order = standings.rank_group(codes, matches, elo)
        for pos, c in enumerate(order, 1):
            s = stats[c]
            cur[c] = {"played": s.played, "pts": s.pts, "gd": s.gd,
                      "gf": s.gf, "ga": s.ga, "pos": pos}
    return cur


def simulate_once(sampler: Sampler, group_fixtures: Dict[str, List[Pair]],
                  members: Dict[str, List[str]], completed: Completed,
                  elo) -> Dict[str, set]:
    winners: Dict[str, str] = {}
    runners: Dict[str, str] = {}
    third_team: Dict[str, str] = {}
    third_stat: Dict[str, Stat] = {}

    # --- group stage ---
    for g, fixtures in group_fixtures.items():
        played: List[standings.PlayedMatch] = []
        for a, b in fixtures:
            key = _pair(a, b)
            if key in completed:
                slo, shi = completed[key]
                lo, hi = key
                hs, as_ = (slo, shi) if (a, b) == (lo, hi) else (shi, slo)
            else:
                hs, as_ = sampler.score(a, b)
            played.append((a, b, hs, as_))
        order = standings.rank_group(members[g], played, elo)
        winners[g], runners[g], third = order[0], order[1], order[2]
        third_team[g] = third
        third_stat[third] = standings.team_stats(members[g], played)[third]

    # --- best eight third-placed teams ---
    best_thirds = set(standings.rank_thirds(third_stat, elo)[:config.BEST_THIRDS])
    qualifying_groups = frozenset(g for g in group_fixtures if third_team[g] in best_thirds)
    alloc = bracket.thirds_assignment(qualifying_groups)

    # --- resolve Round of 32 ---
    def resolve_slot(slot) -> str:
        kind, ref = slot
        if kind == "W":
            return winners[ref]
        if kind == "RU":
            return runners[ref]
        # '3' -> the third assigned (Annex C) to the winner of group `ref`
        return third_team[alloc[ref]]

    match_winner: Dict[int, str] = {}
    match_loser: Dict[int, str] = {}
    qualified = set()

    for mid, (sa, sb) in bracket.R32.items():
        a, b = resolve_slot(sa), resolve_slot(sb)
        qualified.add(a); qualified.add(b)
        w = _ko_winner(a, b, mid, completed, sampler)
        match_winner[mid] = w
        match_loser[mid] = b if w == a else a

    # --- remaining knockout rounds (ids already in dependency order) ---
    for mid in sorted(bracket.KO_TREE):
        if mid == bracket.THIRD_ID:
            continue  # third-place play-off doesn't affect round-reached
        (ka, ra), (kb, rb) = bracket.KO_TREE[mid]
        a = match_winner[ra] if ka == "W" else match_loser[ra]
        b = match_winner[rb] if kb == "W" else match_loser[rb]
        w = _ko_winner(a, b, mid, completed, sampler)
        match_winner[mid] = w
        match_loser[mid] = b if w == a else a

    return {
        "qualify": qualified,
        "r16": {match_winner[m] for m in bracket.R32_IDS},
        "qf": {match_winner[m] for m in bracket.R16_IDS},
        "sf": {match_winner[m] for m in bracket.QF_IDS},
        "final": {match_winner[m] for m in bracket.SF_IDS},
        "champion": {match_winner[bracket.FINAL_ID]},
    }


def _ko_winner(a: str, b: str, mid: int, completed: Completed, sampler: Sampler) -> str:
    """Use a real result if this knockout tie has already been played, else sim."""
    key = _pair(a, b)
    if key in completed:
        slo, shi = completed[key]
        if slo != shi:  # decisive in regulation/recorded
            lo, hi = key
            return lo if slo > shi else hi
    return sampler.advance(a, b)


def run(ratings: Dict[str, float], goals: GoalsModel, completed: Completed,
        n: int = config.DEFAULT_SIMS, seed: int = 12345) -> Tuple[Dict[str, Dict[str, float]], int]:
    rng = random.Random(seed)
    sampler = Sampler(ratings, goals, rng)
    group_fixtures = load_group_fixtures()
    members = _group_members()
    elo = lambda code: ratings.get(code, 1500.0)

    counts = {code: {r: 0 for r in ROUNDS} for code in ratings}
    for _ in range(n):
        reached = simulate_once(sampler, group_fixtures, members, completed, elo)
        for rnd, teams in reached.items():
            for t in teams:
                counts[t][rnd] += 1

    probs = {code: {r: counts[code][r] / n for r in ROUNDS} for code in ratings}
    return probs, n
