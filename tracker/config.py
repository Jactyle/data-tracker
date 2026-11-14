"""Paths and column definitions shared by the whole pipeline."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The first four columns are fixed by the project outline.
COLUMNS = [
    "date",
    "item_id",
    "item",
    "source",
    "rating",
    "votes",
    "views",
    "views_7d",
    "release_year",
    "original_language",
]

# Columns that hold numbers a source updates from day to day.
NUMERIC_COLUMNS = ["rating", "votes", "views", "views_7d"]

# The one value per source that the move rule measures.
MAIN_VALUE = {
    "imdb": "votes",
    "wikipedia": "views",
}

# How many moves the move rule keeps from each source.
TOP_MOVES_PER_SOURCE = 5


class Paths:
    """Every file the pipeline reads or writes, relative to one root folder."""

    def __init__(self, root):
        self.root = Path(root)
        self.data = self.root / "data"
        self.raw = self.data / "raw"
        self.history = self.data / "history.csv"
        self.status = self.data / "status.json"
        self.source_log = self.data / "source_log.csv"


DEFAULT_PATHS = Paths(ROOT)
