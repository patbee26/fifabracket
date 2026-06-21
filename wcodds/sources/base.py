"""The source-agnostic contract.

A source is anything that can tell us which WC2026 matches have finished and
their scores, normalised onto FIFA codes. Swapping or adding a source never
touches the model or simulator — exactly the decoupling the spec asks for.
"""
from __future__ import annotations

import abc
from typing import List

from ..models import Match


class ResultsSource(abc.ABC):
    #: short, stable id used in reports and the `source` field on Match.
    name: str = "base"

    @abc.abstractmethod
    def available(self) -> bool:
        """Cheap probe: can we use this source right now? (host up, token present...)"""
        raise NotImplementedError

    @abc.abstractmethod
    def completed_matches(self) -> List[Match]:
        """Return ONLY finished WC2026 matches, normalised. Never raise for an
        empty/partial upstream — return what parsed and let the caller reconcile."""
        raise NotImplementedError

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        return f"<{self.__class__.__name__} name={self.name!r}>"
