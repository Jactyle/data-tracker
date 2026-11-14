import json
from datetime import date

import pytest

from tests.helpers import TMDB_RAW, wiki_raw
from tracker import http
from tracker.config import COLUMNS
from tracker.sources import tmdb, wikipedia


class FakeResponse:
    def __init__(self, payload, status=200):
        self.content = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.status_code = status

    def json(self):
        return json.loads(self.content)


# ---- TMDB conversion -------------------------------------------------------

def test_tmdb_convert_gives_common_columns():
    rows = tmdb.convert(TMDB_RAW, "2026-11-14")
    assert len(rows) == 3  # the movie without an id is skipped
    assert all(list(row) == COLUMNS for row in rows)
    alpha = rows[0]
    assert alpha["date"] == "2026-11-14"
    assert alpha["item_id"] == "tmdb:101"
    assert alpha["item"] == "Alpha"
    assert alpha["source"] == "tmdb"
    assert alpha["popularity"] == 100.5
    assert alpha["vote_average"] == 7.5
    assert alpha["vote_count"] == 1200
    assert alpha["release_year"] == 2026
    assert alpha["original_language"] == "en"
    assert alpha["views"] is None and alpha["views_7d"] is None


def test_tmdb_convert_leaves_missing_values_empty():
    rows = {row["item_id"]: row for row in tmdb.convert(TMDB_RAW, "2026-11-14")}
    assert rows["tmdb:102"]["release_year"] is None  # empty release date
    assert rows["tmdb:103"]["item"] == "Gamma Original"  # falls back to original_title
    assert rows["tmdb:103"]["popularity"] is None


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
    assert row["popularity"] is None


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

def test_tmdb_fetch_without_key_fails(monkeypatch):
    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    with pytest.raises(http.SourceError, match="TMDB_API_KEY"):
        tmdb.fetch(date(2026, 11, 14))


def test_tmdb_fetch_sends_key_in_header_only(monkeypatch):
    monkeypatch.setenv("TMDB_API_KEY", "secret-token")
    seen = {}

    def fake_get(url, headers=None, params=None):
        seen.update(url=url, headers=headers, params=params)
        return FakeResponse(TMDB_RAW)

    raw = tmdb.fetch(date(2026, 11, 14), get=fake_get)
    assert raw == TMDB_RAW
    assert seen["headers"]["Authorization"] == "Bearer secret-token"
    assert "secret-token" not in seen["url"] and not seen["params"]


def test_tmdb_fetch_rejects_a_response_without_results(monkeypatch):
    monkeypatch.setenv("TMDB_API_KEY", "x")
    with pytest.raises(http.SourceError):
        tmdb.fetch(date(2026, 11, 14), get=lambda *a, **k: FakeResponse({"status_message": "bad"}))


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
