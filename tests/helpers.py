"""Sample raw files and small builders shared by the tests."""
import json

TMDB_RAW = json.dumps({
    "page": 1,
    "results": [
        {"id": 101, "title": "Alpha", "popularity": 100.5, "vote_average": 7.5,
         "vote_count": 1200, "release_date": "2026-05-01", "original_language": "en"},
        {"id": 102, "title": "Beta, the Sequel", "popularity": 50.0, "vote_average": 6.0,
         "vote_count": 300, "release_date": "", "original_language": "fr"},
        {"title": "No id, skipped", "popularity": 1.0},
        {"id": 103, "original_title": "Gamma Original", "popularity": None},
    ],
}).encode("utf-8")


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


def tmdb_raw(movies):
    """Build a raw TMDB file from {id: (title, popularity)}."""
    return json.dumps({"results": [
        {"id": movie_id, "title": title, "popularity": popularity, "vote_average": 7.0,
         "vote_count": 10, "release_date": "2020-01-01", "original_language": "en"}
        for movie_id, (title, popularity) in movies.items()
    ]}).encode("utf-8")
