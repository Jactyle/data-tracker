"""Sample raw files and small builders shared by the tests."""
import json
from datetime import datetime, timezone
from types import SimpleNamespace

from tracker.sources import imdb

IMDB_HEADER = "tconst\taverageRating\tnumVotes"

# Real ids from imdb.FILMS, one with missing values (IMDb writes \N) and one that is not tracked.
IMDB_RAW = (IMDB_HEADER + "\n"
            "tt1757678\t7.2\t218842\n"
            "tt33764258\t8.4\t563721\n"
            "tt12042730\t\\N\t\\N\n"
            "tt9999999\t5.0\t10\n").encode("utf-8")


def imdb_ids(number):
    """The made-up IMDb id the tests use for film number `number`."""
    return "tt%07d" % number


def imdb_raw(films):
    """Build a raw IMDb file from {number: (title, votes)} and register each film's title."""
    lines = [IMDB_HEADER]
    for number, (title, votes) in films.items():
        imdb.FILM_INFO[imdb_ids(number)] = (title, 2020)
        lines.append("%s\t7.0\t%s" % (imdb_ids(number), votes))
    return ("\n".join(lines) + "\n").encode("utf-8")


def wiki_raw(**articles):
    """Build a raw Wikipedia file; each keyword is an article, value {YYYYMMDD: views}."""
    return json.dumps({
        "articles": {
            key: {"items": [{"timestamp": day + "00", "views": views}
                            for day, views in sorted(days.items())]}
            for key, days in articles.items()
        },
        "errors": {},
    }).encode("utf-8")


def fake_source(name, payload, convert_module):
    """A source whose fetch returns `payload` (bytes), or raises if payload is an Exception."""
    def fetch(today):
        if isinstance(payload, Exception):
            raise payload
        return payload

    return SimpleNamespace(NAME=name, EXT="tsv" if name == "imdb" else "json", fetch=fetch, convert=convert_module.convert)


def sources(imdb_payload, wiki_payload):
    from tracker.sources import imdb, wikipedia
    return {"imdb": fake_source("imdb", imdb_payload, imdb),
            "wikipedia": fake_source("wikipedia", wiki_payload, wikipedia)}


def at(day, hour=6):
    return datetime(2026, 11, day, hour, 5, 9, tzinfo=timezone.utc)


def wiki(day_views):
    return wiki_raw(Inception={"20261113": day_views, "20261112": day_views})
