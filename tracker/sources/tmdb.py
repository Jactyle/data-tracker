"""Source 1: TMDB trending movies (JSON).

One request returns the 20 movies that are trending this week. TMDB needs a
free API Read Access Token. The workflow passes it in the TMDB_API_KEY
environment variable (a repository secret). It is sent in a request header,
never in the URL, so it cannot end up in an error message or a file.
"""
from __future__ import annotations

import json
import os

from .. import http
from ..rows import make_row, number_or_none

NAME = "tmdb"
EXT = "json"
URL = "https://api.themoviedb.org/3/trending/movie/week"


def fetch(today, get=http.get):
    """Download the trending list and return the raw JSON bytes."""
    token = os.environ.get("TMDB_API_KEY", "").strip()
    if not token:
        raise http.SourceError("TMDB_API_KEY is not set")
    response = get(URL, headers={"Authorization": "Bearer " + token,
                                 "Accept": "application/json"})
    try:
        data = response.json()
    except ValueError:
        raise http.SourceError("response was not JSON")
    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        raise http.SourceError("response has no results list")
    return response.content


def convert(raw, date):
    """Turn the raw JSON bytes of one day into rows of the common columns."""
    data = json.loads(raw)
    rows = []
    for movie in data.get("results", []):
        movie_id = movie.get("id")
        if movie_id is None:
            continue
        release = movie.get("release_date") or ""
        year = int(release[:4]) if release[:4].isdigit() else None
        rows.append(make_row(
            date=date,
            item_id="tmdb:%s" % movie_id,
            item=movie.get("title") or movie.get("original_title") or str(movie_id),
            source=NAME,
            popularity=number_or_none(movie.get("popularity")),
            vote_average=number_or_none(movie.get("vote_average")),
            vote_count=number_or_none(movie.get("vote_count")),
            release_year=year,
            original_language=movie.get("original_language") or None,
        ))
    return rows
