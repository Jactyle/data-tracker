"""Source 2: Wikipedia page views for a fixed list of films (JSON).

For each film the Wikimedia pageviews API returns the daily views of its
English Wikipedia article. The raw file holds every article's response in one
JSON object, so a run makes one raw file per source.
"""
from __future__ import annotations

import json
import time
from datetime import date as date_type, timedelta
from urllib.parse import quote

from .. import http
from ..rows import make_row

NAME = "wikipedia"
EXT = "json"
URL = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
       "en.wikipedia/all-access/user/{article}/daily/{start}/{end}")

# (Wikipedia article title, display name, release year, original language)
FILMS = [
    ("Avatar: Fire and Ash", "Avatar: Fire and Ash", 2025, "en"),
    ("Zootopia 2", "Zootopia 2", 2025, "en"),
    ("Wicked: For Good", "Wicked: For Good", 2025, "en"),
    ("Avengers: Doomsday", "Avengers: Doomsday", 2026, "en"),
    ("Dune: Part Three", "Dune: Part Three", 2026, "en"),
    ("Toy Story 5", "Toy Story 5", 2026, "en"),
    ("Oppenheimer (film)", "Oppenheimer", 2023, "en"),
    ("Barbie (film)", "Barbie", 2023, "en"),
    ("Inception", "Inception", 2010, "en"),
    ("Interstellar (film)", "Interstellar", 2014, "en"),
    ("Titanic (1997 film)", "Titanic", 1997, "en"),
    ("The Godfather", "The Godfather", 1972, "en"),
    ("Parasite (2019 film)", "Parasite", 2019, "ko"),
    ("Spider-Man: Across the Spider-Verse", "Spider-Man: Across the Spider-Verse", 2023, "en"),
    ("Top Gun: Maverick", "Top Gun: Maverick", 2022, "en"),
    ("The Dark Knight", "The Dark Knight", 2008, "en"),
    ("Joker (2019 film)", "Joker", 2019, "en"),
    ("Everything Everywhere All at Once", "Everything Everywhere All at Once", 2022, "en"),
]
FILM_INFO = {title.replace(" ", "_"): (name, year, lang) for title, name, year, lang in FILMS}

DELAY_SECONDS = 1.5       # pause between requests so the API is not hammered
BACKOFF_SECONDS = 8.0     # first wait after a "too many requests" answer
RETRY_PAUSE_SECONDS = 20  # pause before the second pass over failed films


def _day(day):
    return day.strftime("%Y%m%d")


def _download(key, start, end, get):
    """Return the parsed response for one article, or raise SourceError."""
    url = URL.format(article=quote(key, safe=""), start=start, end=end)
    try:
        payload = get(url, backoff=BACKOFF_SECONDS).json()
    except ValueError:
        raise http.SourceError("response was not JSON")
    if not (isinstance(payload, dict) and isinstance(payload.get("items"), list)):
        raise http.SourceError("unexpected response")
    return payload


def fetch(today, get=http.get, sleep=time.sleep):
    """Download the last 7 days of views for every film; return raw JSON bytes.

    The API answers "too many requests" when it is asked quickly, so requests
    are spaced out and a film that still fails gets one more try at the end.
    A film that cannot be downloaded is left out. The source fails only when
    no film could be downloaded.
    """
    start, end = _day(today - timedelta(days=7)), _day(today - timedelta(days=1))
    keys = [title.replace(" ", "_") for title, _name, _year, _lang in FILMS]
    articles, errors = {}, {}

    def attempt(key):
        try:
            articles[key] = _download(key, start, end, get)
            errors.pop(key, None)
        except http.SourceError as exc:
            errors[key] = str(exc)

    for index, key in enumerate(keys):
        if index:
            sleep(DELAY_SECONDS)
        attempt(key)
    if errors:
        sleep(RETRY_PAUSE_SECONDS)
        for key in [k for k in keys if k in errors]:
            attempt(key)
            sleep(DELAY_SECONDS)
    if not articles:
        raise http.SourceError("no article could be downloaded (%s)"
                               % "; ".join(sorted(set(errors.values()))))
    yesterday = _day(today - timedelta(days=1))
    if not any(item.get("timestamp", "")[:8] == yesterday
               for payload in articles.values() for item in payload["items"]):
        # The API leaves out days it has no data for, which would read as 0 views.
        raise http.SourceError("views for %s are not published yet" % yesterday)
    return json.dumps({"articles": articles, "errors": errors},
                      sort_keys=True).encode("utf-8")


def convert(raw, date):
    """Turn the raw JSON bytes of one day into rows of the common columns.

    views is the article's views on the UTC day before the run date. views_7d
    is the sum over the seven days before the run date. A day the API leaves
    out had no views and counts as 0.
    """
    run_day = date_type.fromisoformat(date)
    data = json.loads(raw)
    rows = []
    for key, payload in data.get("articles", {}).items():
        by_day = {item["timestamp"][:8]: item["views"] for item in payload.get("items", [])}
        views = by_day.get(_day(run_day - timedelta(days=1)), 0)
        views_7d = sum(by_day.get(_day(run_day - timedelta(days=k)), 0) for k in range(1, 8))
        name, year, lang = FILM_INFO.get(key, (key.replace("_", " "), None, None))
        rows.append(make_row(
            date=date,
            item_id="wikipedia:%s" % key,
            item=name,
            source=NAME,
            views=views,
            views_7d=views_7d,
            release_year=year,
            original_language=lang,
        ))
    return rows
