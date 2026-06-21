"""Minimal dense linear solver — Gaussian elimination with partial pivoting.

Just enough to solve the small (p x p) normal equations in the Poisson GLM fit,
so Phase 1 needs no numpy. p is 3, so this is trivially fast and stable.
"""
from __future__ import annotations

from typing import List


def solve(a: List[List[float]], b: List[float]) -> List[float]:
    """Solve A x = b for a square matrix A (list of rows) and vector b."""
    n = len(a)
    # augmented copy
    m = [list(row) + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        # partial pivot: largest |value| in this column at/below the diagonal
        pivot = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[pivot][col]) < 1e-12:
            raise ValueError("singular matrix in GLM fit")
        m[col], m[pivot] = m[pivot], m[col]
        # eliminate below
        for r in range(col + 1, n):
            factor = m[r][col] / m[col][col]
            for c in range(col, n + 1):
                m[r][c] -= factor * m[col][c]
    # back-substitution
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        s = m[r][n] - sum(m[r][c] * x[c] for c in range(r + 1, n))
        x[r] = s / m[r][r]
    return x
