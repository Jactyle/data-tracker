"""The data sources. Each has a NAME, a file EXT, fetch() and convert()."""
from __future__ import annotations

from . import tmdb, wikipedia

SOURCES = {module.NAME: module for module in (tmdb, wikipedia)}
