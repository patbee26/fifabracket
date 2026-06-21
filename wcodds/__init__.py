"""World Cup 2026 — Live Odds Predictor.

Phase 0: the data layer. History (martj42), team-name normalization, and a
source-agnostic live-results fetch layer (primary + fallbacks, reconciled).

Deliberately stdlib-only so it runs with no `pip install`. Modelling phases
(numpy/scipy for the Elo + Poisson + Monte Carlo) add dependencies later.
"""

__version__ = "0.0.1"
