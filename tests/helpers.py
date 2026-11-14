"""Sample raw files and small builders shared by the tests."""
import json

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
