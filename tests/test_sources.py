import gzip
import json
from datetime import date

import pytest

from tests.helpers import IMDB_RAW, wiki_raw
from tracker import http
from tracker.config import COLUMNS
from tracker.sources import imdb, wikipedia


class FakeResponse:
    def __init__(self, payload, status=200):
        self.content = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.status_code = status

    def json(self):
        return json.loads(self.content)


# ---- IMDb conversion -------------------------------------------------------

def test_imdb_convert_gives_common_columns():
    rows = imdb.convert(IMDB_RAW, "2026-11-14")
    assert len(rows) == 4
    assert all(list(row) == COLUMNS for row in rows)
    avatar = rows[0]
    assert avatar["date"] == "2026-11-14"
    assert avatar["item_id"] == "imdb:tt1757678"
    assert avatar["item"] == "Avatar: Fire and Ash"
    assert avatar["source"] == "imdb"
    assert avatar["rating"] == 7.2
    assert avatar["votes"] == 218842
    assert avatar["release_year"] == 2025
    assert avatar["views"] is None and avatar["views_7d"] is None


def test_imdb_convert_leaves_missing_values_empty():
    rows = {row["item_id"]: row for row in imdb.convert(IMDB_RAW, "2026-11-14")}
    assert rows["imdb:tt12042730"]["rating"] is None  # IMDb wrote \N
    assert rows["imdb:tt12042730"]["votes"] is None
    assert rows["imdb:tt9999999"]["item"] == "tt9999999"  # an id outside the list keeps its id as name
    assert rows["imdb:tt9999999"]["release_year"] is None


def test_imdb_convert_rejects_a_file_that_is_not_the_ratings_file():
    with pytest.raises(ValueError):
        imdb.convert(b"<html>not a tsv</html>", "2026-11-14")


def test_imdb_film_list_is_consistent():
    ids = [tconst for tconst, _title, _year in imdb.FILMS]
    assert len(ids) == len(set(ids)) >= 10  # the outline asks for at least ten items
    assert all(i.startswith("tt") for i in ids)


# ---- Wikipedia conversion --------------------------------------------------

def test_wikipedia_convert_views_and_week():
    # Run date 2026-11-14: "yesterday" is 20261113, the week is 20261107..20261113.
    raw = wiki_raw(Inception={"20261106": 999, "20261107": 10, "20261110": 20, "20261113": 30})
    (row,) = wikipedia.convert(raw, "2026-11-14")
    assert row["item_id"] == "wikipedia:Inception"
    assert row["item"] == "Inception"
    assert row["source"] == "wikipedia"
    assert row["views"] == 30
    assert row["views_7d"] == 60  # 20261106 is outside the 7 days
    assert row["release_year"] == 2010 and row["original_language"] == "en"
    assert row["rating"] is None and row["votes"] is None


def test_wikipedia_missing_day_counts_as_zero():
    raw = wiki_raw(Inception={"20261112": 40})  # nothing on 20261113
    (row,) = wikipedia.convert(raw, "2026-11-14")
    assert row["views"] == 0
    assert row["views_7d"] == 40


def test_wikipedia_known_film_uses_display_name_and_language():
    raw = wiki_raw(**{"Parasite_(2019_film)": {"20261113": 5}})
    (row,) = wikipedia.convert(raw, "2026-11-14")
    assert row["item"] == "Parasite"
    assert row["original_language"] == "ko"
    assert row["release_year"] == 2019


def test_wikipedia_unknown_article_still_converts():
    (row,) = wikipedia.convert(wiki_raw(Some_New_Film={"20261113": 7}), "2026-11-14")
    assert row["item"] == "Some New Film"
    assert row["release_year"] is None


# ---- Fetching --------------------------------------------------------------

def ratings_file(extra_lines=(), header="tconst\taverageRating\tnumVotes"):
    """A gzipped ratings file like IMDb's: many titles, two of them tracked."""
    lines = [header, "tt0000001\t5.7\t2000", "tt1757678\t7.2\t218842", "tt0000002\t5.8\t270",
             "tt33764258\t8.4\t563721", "tt0000003\t6.5\t2000"] + list(extra_lines)
    return gzip.compress(("\n".join(lines) + "\n").encode("utf-8"))


def test_imdb_fetch_keeps_only_the_tracked_films():
    seen = {}

    def fake_get(url, **kwargs):
        seen["url"] = url
        return FakeResponse(ratings_file())

    raw = imdb.fetch(date(2026, 11, 14), get=fake_get)
    assert seen["url"] == imdb.URL
    assert raw.decode().splitlines() == ["tconst\taverageRating\tnumVotes",
                                         "tt1757678\t7.2\t218842", "tt33764258\t8.4\t563721"]


def test_imdb_fetch_output_is_the_same_each_time():
    first = imdb.fetch(date(2026, 11, 14), get=lambda url, **k: FakeResponse(ratings_file()))
    second = imdb.fetch(date(2026, 11, 15), get=lambda url, **k: FakeResponse(ratings_file()))
    assert first == second


def test_imdb_fetch_fails_when_no_tracked_film_is_in_the_file():
    body = gzip.compress(b"tconst\taverageRating\tnumVotes\ntt0000001\t5.7\t2000\n")
    with pytest.raises(http.SourceError, match="none of the tracked films"):
        imdb.fetch(date(2026, 11, 14), get=lambda url, **k: FakeResponse(body))


def test_imdb_fetch_fails_on_a_response_that_is_not_gzip():
    with pytest.raises(http.SourceError, match="gzip"):
        imdb.fetch(date(2026, 11, 14), get=lambda url, **k: FakeResponse(b"<html>busy</html>"))


def test_imdb_fetch_fails_on_unexpected_columns():
    body = ratings_file(header="id\trating\tvotes")
    with pytest.raises(http.SourceError, match="unexpected columns"):
        imdb.fetch(date(2026, 11, 14), get=lambda url, **k: FakeResponse(body))


def test_wikipedia_fetch_skips_a_failed_article():
    def fake_get(url, **kwargs):
        if "Inception" in url:
            raise http.SourceError("HTTP 404")
        return FakeResponse({"items": [{"timestamp": "2026111300", "views": 5}]})

    raw = wikipedia.fetch(date(2026, 11, 14), get=fake_get, sleep=lambda s: None)
    data = json.loads(raw)
    assert "Inception" not in data["articles"]
    assert data["errors"]["Inception"] == "HTTP 404"
    assert len(data["articles"]) == len(wikipedia.FILMS) - 1


def test_wikipedia_fetch_retries_a_failed_article_at_the_end():
    calls = {}

    def fake_get(url, **kwargs):
        calls[url] = calls.get(url, 0) + 1
        if "Inception" in url and calls[url] == 1:
            raise http.SourceError("HTTP 429 after 4 attempts")
        return FakeResponse({"items": [{"timestamp": "2026111300", "views": 5}]})

    data = json.loads(wikipedia.fetch(date(2026, 11, 14), get=fake_get, sleep=lambda s: None))
    assert "Inception" in data["articles"] and data["errors"] == {}


def test_wikipedia_fetch_fails_when_every_article_fails():
    def fake_get(url, **kwargs):
        raise http.SourceError("HTTP 503")

    with pytest.raises(http.SourceError):
        wikipedia.fetch(date(2026, 11, 14), get=fake_get, sleep=lambda s: None)


def test_wikipedia_fetch_fails_when_yesterday_is_not_published_yet():
    # The API leaves out days it has no data for; that must not be recorded as 0 views.
    def fake_get(url, **kwargs):
        return FakeResponse({"items": [{"timestamp": "2026111200", "views": 5}]})

    with pytest.raises(http.SourceError, match="not published yet"):
        wikipedia.fetch(date(2026, 11, 14), get=fake_get, sleep=lambda s: None)


def test_wikipedia_fetch_asks_for_the_seven_days_before_today():
    urls = []

    def fake_get(url, **kwargs):
        urls.append(url)
        return FakeResponse({"items": [{"timestamp": "2026111300", "views": 1}]})

    wikipedia.fetch(date(2026, 11, 14), get=fake_get, sleep=lambda s: None)
    assert urls[0].endswith("/daily/20261107/20261113")


# ---- HTTP helper -----------------------------------------------------------

def test_http_get_retries_a_busy_server():
    answers = [FakeResponse({}, 429), FakeResponse({}, 503), FakeResponse({"ok": 1})]

    class Client:
        def get(self, url, **kwargs):
            return answers.pop(0)

    waits = []
    response = http.get("http://x", session=Client(), sleep=waits.append)
    assert response.json() == {"ok": 1}
    assert len(waits) == 2


def test_http_get_does_not_retry_a_missing_page():
    calls = []

    class Client:
        def get(self, url, **kwargs):
            calls.append(url)
            return FakeResponse({}, 404)

    with pytest.raises(http.SourceError, match="404"):
        http.get("http://x", session=Client(), sleep=lambda s: None)
    assert len(calls) == 1
