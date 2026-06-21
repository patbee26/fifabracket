"""Elo-seeded Poisson goals model with the Dixon-Coles low-score correction.

Two teams' Elo difference -> expected goals for each side -> a full scoreline
distribution. Independent Poisson over-predicts away wins and under-predicts
0-0/1-0/1-1 (exactly the scorelines that decide group tiebreakers), so we apply
the Dixon-Coles tau correction on the four low-score cells.

Each match is two Poisson observations sharing parameters [b0, b_elo, b_home]:
    home goals ~ Poisson(exp(b0 + b_elo*diff + b_home*home_field))
    away goals ~ Poisson(exp(b0 - b_elo*diff))
with diff = (R_home - R_away)/100. Fit by weighted Poisson IRLS; rho fit
separately by 1-D search on the low-score cells.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

from .linalg import solve

MAX_GOALS = 10
# A fit record: (elo_diff/100, home_field 0/1, home_score, away_score, weight)
Record = Tuple[float, float, int, int, float]


def _pois_pmf(k: int, lam: float) -> float:
    return math.exp(-lam) * lam ** k / math.factorial(k)


def dc_tau(i: int, j: int, lh: float, la: float, rho: float) -> float:
    """Dixon-Coles dependence factor; 1.0 outside the four low-score cells."""
    if i == 0 and j == 0:
        return 1.0 - lh * la * rho
    if i == 0 and j == 1:
        return 1.0 + lh * rho
    if i == 1 and j == 0:
        return 1.0 + la * rho
    if i == 1 and j == 1:
        return 1.0 - rho
    return 1.0


@dataclass
class GoalsModel:
    b0: float = 0.0          # baseline log-goals
    b_elo: float = 0.0       # sensitivity to (Elo diff / 100)
    b_home: float = 0.0      # home-field bump (log-goals)
    rho: float = 0.0         # Dixon-Coles correlation
    n_records: int = 0
    mean_goals: float = 0.0

    # --- expected goals ---------------------------------------------------
    def _lam(self, diff: float, home_field: float) -> float:
        eta = self.b0 + self.b_elo * diff + self.b_home * home_field
        eta = max(-8.0, min(8.0, eta))
        return math.exp(eta)

    def lambdas(self, r_home: float, r_away: float, home_field: bool = False) -> Tuple[float, float]:
        diff = (r_home - r_away) / 100.0
        return self._lam(diff, 1.0 if home_field else 0.0), self._lam(-diff, 0.0)

    def lambdas_hf(self, r_a: float, r_b: float, hf_a: bool = False, hf_b: bool = False) -> Tuple[float, float]:
        """Expected goals with an independent home-field flag per side (for host
        games where either team — not necessarily the listed home side — is home)."""
        diff = (r_a - r_b) / 100.0
        return self._lam(diff, 1.0 if hf_a else 0.0), self._lam(-diff, 1.0 if hf_b else 0.0)

    # --- distributions ----------------------------------------------------
    def scoreline_matrix(self, lh: float, la: float, max_goals: int = MAX_GOALS) -> List[List[float]]:
        m = [[0.0] * (max_goals + 1) for _ in range(max_goals + 1)]
        total = 0.0
        for i in range(max_goals + 1):
            pi = _pois_pmf(i, lh)
            for j in range(max_goals + 1):
                p = dc_tau(i, j, lh, la, self.rho) * pi * _pois_pmf(j, la)
                if p < 0:
                    p = 0.0
                m[i][j] = p
                total += p
        if total > 0:
            for i in range(max_goals + 1):
                for j in range(max_goals + 1):
                    m[i][j] /= total
        return m

    def outcome_probs(self, r_home: float, r_away: float, home_field: bool = False) -> Tuple[float, float, float]:
        """Return (P home win, P draw, P away win)."""
        lh, la = self.lambdas(r_home, r_away, home_field)
        m = self.scoreline_matrix(lh, la)
        ph = pd = pa = 0.0
        for i, row in enumerate(m):
            for j, p in enumerate(row):
                if i > j:
                    ph += p
                elif i == j:
                    pd += p
                else:
                    pa += p
        return ph, pd, pa

    def sample_score(self, lh: float, la: float, rng: random.Random) -> Tuple[int, int]:
        """Draw a scoreline from the DC distribution (Phase 2 will vectorise this)."""
        m = self.scoreline_matrix(lh, la)
        r = rng.random()
        acc = 0.0
        for i, row in enumerate(m):
            for j, p in enumerate(row):
                acc += p
                if r <= acc:
                    return i, j
        return MAX_GOALS, MAX_GOALS

    # --- fitting ----------------------------------------------------------
    def fit(self, records: Sequence[Record], iters: int = 30, tol: float = 1e-9) -> "GoalsModel":
        obs = []  # (y, f_elo, f_home, weight)
        tot_w = tot_g = 0.0
        for diff, home_field, hs, as_, w in records:
            obs.append((hs, diff, home_field, w))
            obs.append((as_, -diff, 0.0, w))
            tot_w += 2 * w
            tot_g += w * (hs + as_)
        if not obs:
            raise ValueError("no records to fit")
        self.n_records = len(records)
        self.mean_goals = tot_g / tot_w
        b = [math.log(max(self.mean_goals, 0.1)), 0.0, 0.0]
        for _ in range(iters):
            ata = [[0.0] * 3 for _ in range(3)]
            atz = [0.0] * 3
            for y, f1, f2, w in obs:
                x = (1.0, f1, f2)
                eta = b[0] + b[1] * f1 + b[2] * f2
                eta = max(-8.0, min(8.0, eta))
                mu = math.exp(eta)
                z = eta + (y - mu) / mu
                ww = w * mu
                for i in range(3):
                    atz[i] += ww * x[i] * z
                    for j in range(3):
                        ata[i][j] += ww * x[i] * x[j]
            nb = solve(ata, atz)
            if max(abs(nb[i] - b[i]) for i in range(3)) < tol:
                b = nb
                break
            b = nb
        self.b0, self.b_elo, self.b_home = b
        self._fit_rho(records)
        return self

    def _fit_rho(self, records: Sequence[Record]) -> None:
        # Only low-score matches carry rho information.
        low = []
        for diff, home_field, hs, as_, w in records:
            if hs <= 1 and as_ <= 1:
                lh = self._lam(diff, home_field)
                la = self._lam(-diff, 0.0)
                low.append((lh, la, hs, as_, w))

        def loglik(rho: float) -> Optional[float]:
            ll = 0.0
            for lh, la, hs, as_, w in low:
                t = dc_tau(hs, as_, lh, la, rho)
                if t <= 0:
                    return None
                ll += w * math.log(t)
            return ll

        best_rho, best_ll = 0.0, loglik(0.0) or -math.inf
        for step in (0.02, 0.004, 0.001):
            lo, hi = best_rho - 10 * step, best_rho + 10 * step
            r = lo
            while r <= hi + 1e-12:
                ll = loglik(r)
                if ll is not None and ll > best_ll:
                    best_ll, best_rho = ll, r
                r += step
        self.rho = round(best_rho, 4)

    # --- (de)serialisation for the Phase 2 pipeline -----------------------
    def to_dict(self) -> dict:
        return {"b0": self.b0, "b_elo": self.b_elo, "b_home": self.b_home,
                "rho": self.rho, "n_records": self.n_records, "mean_goals": self.mean_goals}

    @classmethod
    def from_dict(cls, d: dict) -> "GoalsModel":
        return cls(b0=d["b0"], b_elo=d["b_elo"], b_home=d["b_home"], rho=d["rho"],
                   n_records=d.get("n_records", 0), mean_goals=d.get("mean_goals", 0.0))
