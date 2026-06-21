"""Result sources. Each implements the same ResultsSource interface so the rest
of the app never depends on a particular provider (spec risk #2)."""
from .base import ResultsSource
from .martj42 import Martj42Source
from .rezarahiminia import RezaSource
from .footballdata import FootballDataSource

# Order matters only for display/preference; reconciliation treats all equally.
ALL_SOURCE_CLASSES = [RezaSource, Martj42Source, FootballDataSource]

__all__ = [
    "ResultsSource",
    "Martj42Source",
    "RezaSource",
    "FootballDataSource",
    "ALL_SOURCE_CLASSES",
]
