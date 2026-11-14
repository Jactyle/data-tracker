"""Source 1: IMDb ratings (TSV).

IMDb publishes title.ratings.tsv.gz for personal and non-commercial use, with
no login, refreshed daily. It holds every title (about 1.7 million rows,
8.7 MB), so the pipeline downloads it and keeps only the header and the rows
of the films listed in FILMS. The raw file is that tab-separated subset.
"""
from __future__ import annotations

import gzip

from .. import http
from ..rows import make_row

NAME = "imdb"
EXT = "tsv"
URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"
HEADER = ["tconst", "averageRating", "numVotes"]

# (IMDb id, title, release year): the 24 films released in 2025 or 2026 with the most
# votes when this list was made. Ids, titles and years are IMDb's own (title.basics).
FILMS = [
    ("tt12042730", "Project Hail Mary", 2026),
    ("tt33764258", "The Odyssey", 2026),
    ("tt31193180", "Sinners", 2025),
    ("tt30144839", "One Battle After Another", 2025),
    ("tt5950044", "Superman", 2025),
    ("tt37287335", "Obsession", 2025),
    ("tt26581740", "Weapons", 2025),
    ("tt16311594", "F1: The Movie", 2025),
    ("tt6208148", "Snow White", 2025),
    ("tt22084616", "Spider-Man: Brand New Day", 2026),
    ("tt1312221", "Frankenstein", 2025),
    ("tt20969586", "Thunderbolts*", 2025),
    ("tt10676052", "The Fantastic Four: First Steps", 2025),
    ("tt12299608", "Mickey 17", 2025),
    ("tt14364480", "Wake Up Dead Man", 2025),
    ("tt26657236", "Backrooms", 2026),
    ("tt9603208", "Mission: Impossible - The Final Reckoning", 2025),
    ("tt12300742", "Bugonia", 2025),
    ("tt10548174", "28 Years Later", 2025),
    ("tt32916440", "Marty Supreme", 2025),
    ("tt1757678", "Avatar: Fire and Ash", 2025),
    ("tt27543632", "The Housemaid", 2025),
    ("tt31036941", "Jurassic World: Rebirth", 2025),
    ("tt11378946", "Michael", 2026),
]
FILM_INFO = {tconst: (title, year) for tconst, title, year in FILMS}


def fetch(today, get=http.get):
    """Download the ratings file and return the TSV rows of the tracked films."""
    response = get(URL, timeout=120)
    try:
        text = gzip.decompress(response.content).decode("utf-8")
    except (OSError, EOFError, UnicodeDecodeError):
        raise http.SourceError("response was not a gzip text file")
    lines = text.split("\n")
    if lines[0].split("\t")[:3] != HEADER:
        raise http.SourceError("unexpected columns in the ratings file")
    kept = sorted(line for line in lines[1:] if line.split("\t", 1)[0] in FILM_INFO)
    if not kept:
        raise http.SourceError("none of the tracked films is in the ratings file")
    return ("\n".join(["\t".join(HEADER)] + kept) + "\n").encode("utf-8")


def _number(text, kind):
    """IMDb writes \\N for a missing value."""
    try:
        return kind(text)
    except ValueError:
        return None


def convert(raw, date):
    """Turn the raw TSV bytes of one day into rows of the common columns."""
    lines = raw.decode("utf-8").splitlines()
    if not lines or lines[0].split("\t")[:3] != HEADER:
        raise ValueError("not an IMDb ratings file")
    rows = []
    for line in lines[1:]:
        if not line.strip():
            continue
        tconst, rating, votes = line.split("\t")[:3]
        title, year = FILM_INFO.get(tconst, (tconst, None))
        rows.append(make_row(
            date=date,
            item_id="imdb:%s" % tconst,
            item=title,
            source=NAME,
            rating=_number(rating, float),
            votes=_number(votes, int),
            release_year=year,
        ))
    return rows
