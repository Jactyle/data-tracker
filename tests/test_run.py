import csv
import json
from datetime import datetime, timezone
from types import SimpleNamespace

from tests.helpers import tmdb_raw, wiki_raw
from tracker.config import Paths
from tracker.report import issue_body
from tracker.rows import read_csv
from tracker.run import run
from tracker.status import read_status


def fake_source(name, payload, convert_module):
    """A source whose fetch returns `payload` (bytes), or raises if payload is an Exception."""
    def fetch(today):
        if isinstance(payload, Exception):
            raise payload
        return payload

    return SimpleNamespace(NAME=name, EXT="json", fetch=fetch, convert=convert_module.convert)


def sources(tmdb_payload, wiki_payload):
    from tracker.sources import tmdb, wikipedia
    return {"tmdb": fake_source("tmdb", tmdb_payload, tmdb),
            "wikipedia": fake_source("wikipedia", wiki_payload, wikipedia)}


def at(day, hour=6):
    return datetime(2026, 11, day, hour, 5, 9, tzinfo=timezone.utc)


def wiki(day_views):
    return wiki_raw(Inception={"20261113": day_views, "20261112": day_views})


def test_first_run_writes_raw_history_and_status(tmp_path):
    paths = Paths(tmp_path)
    status, _ = run(at(14), paths, sources(tmdb_raw({1: ("A", 10.0), 2: ("B", 5.0)}), wiki(7)))
    assert (tmp_path / "data/raw/2026-11-14/tmdb.json.gz").exists()
    assert (tmp_path / "data/raw/2026-11-14/wikipedia.json.gz").exists()
    assert len(read_csv(paths.history)) == 3
    assert status == read_status(paths)
    assert status["run_time"] == "2026-11-14T06:05:09Z"
    assert status["first_run_date"] == "2026-11-14"
    assert status["days_with_success"] == 1
    assert status["items"] == 3
    assert status["new_today"] == 0 and status["gone_today"] == 0
    assert status["sources"] == [{"name": "tmdb", "ok": True, "count": 2},
                                 {"name": "wikipedia", "ok": True, "count": 1}]


def test_a_failed_source_does_not_stop_the_run(tmp_path):
    paths = Paths(tmp_path)
    status, results = run(at(14), paths, sources(RuntimeError("boom"), wiki(7)))
    assert not (tmp_path / "data/raw/2026-11-14/tmdb.json.gz").exists()  # no raw file for a failure
    assert (tmp_path / "data/raw/2026-11-14/wikipedia.json.gz").exists()
    assert status["sources"] == [{"name": "tmdb", "ok": False, "count": 0},
                                 {"name": "wikipedia", "ok": True, "count": 1}]
    assert status["items"] == 1
    assert results[0]["error"] == "RuntimeError: boom"
    log = list(csv.DictReader(open(paths.source_log)))
    assert [(r["source"], r["ok"], r["count"]) for r in log] == [("tmdb", "false", "0"), ("wikipedia", "true", "1")]
    assert log[0]["error"] == "RuntimeError: boom"


def test_a_response_that_cannot_be_converted_counts_as_a_failure(tmp_path):
    paths = Paths(tmp_path)
    status, _ = run(at(14), paths, sources(b"<html>not json</html>", wiki(7)))
    assert status["sources"][0]["ok"] is False
    assert not (tmp_path / "data/raw/2026-11-14/tmdb.json.gz").exists()


def test_an_empty_response_counts_as_a_failure(tmp_path):
    status, _ = run(at(14), Paths(tmp_path), sources(json.dumps({"results": []}).encode(), wiki(7)))
    assert status["sources"][0]["ok"] is False


def test_all_sources_failing_still_finishes(tmp_path):
    paths = Paths(tmp_path)
    status, _ = run(at(14), paths, sources(RuntimeError("x"), RuntimeError("y")))
    assert status["items"] == 0 and status["days_with_success"] == 0
    assert status["first_run_date"] is None
    assert read_csv(paths.history) == []


def test_secret_is_removed_from_error_messages(tmp_path, monkeypatch):
    monkeypatch.setenv("TMDB_API_KEY", "topsecret")
    _, results = run(at(14), Paths(tmp_path), sources(RuntimeError("bad topsecret here"), wiki(7)))
    assert "topsecret" not in results[0]["error"]


def test_second_run_on_the_same_day_replaces_that_day(tmp_path):
    paths = Paths(tmp_path)
    run(at(14, 6), paths, sources(tmdb_raw({1: ("A", 10.0)}), wiki(7)))
    status, _ = run(at(14, 18), paths, sources(tmdb_raw({1: ("A", 99.0), 2: ("B", 5.0)}), wiki(8)))
    rows = read_csv(paths.history)
    assert len([r for r in rows if r["date"] == "2026-11-14"]) == 3  # 2 tmdb + 1 wikipedia, not doubled
    assert len({(r["date"], r["item_id"]) for r in rows}) == len(rows)
    assert {r["item_id"]: r["popularity"] for r in rows if r["source"] == "tmdb"} == {"tmdb:1": 99.0, "tmdb:2": 5.0}
    assert status["days_with_success"] == 1  # the day counts once
    assert status["items"] == 3
    assert status["run_time"] == "2026-11-14T18:05:09Z"
    assert len(list((tmp_path / "data/raw").iterdir())) == 1
    assert len(list(csv.DictReader(open(paths.source_log)))) == 2  # the day's log rows are replaced


def test_second_run_with_a_failed_source_keeps_the_earlier_raw_file(tmp_path):
    paths = Paths(tmp_path)
    run(at(14, 6), paths, sources(tmdb_raw({1: ("A", 10.0)}), wiki(7)))
    status, _ = run(at(14, 18), paths, sources(RuntimeError("down"), wiki(7)))
    assert status["sources"][0]["ok"] is False
    assert [r["item_id"] for r in read_csv(paths.history) if r["source"] == "tmdb"] == ["tmdb:1"]


def test_history_is_the_same_after_rebuilding_from_raw(tmp_path):
    from tracker.build import build_history
    paths = Paths(tmp_path)
    run(at(14), paths, sources(tmdb_raw({1: ("A", 10.0)}), wiki(7)))
    run(at(15), paths, sources(tmdb_raw({1: ("A", 12.0), 3: ("C", 1.0)}), wiki(9)))
    first = paths.history.read_bytes()
    paths.history.unlink()
    build_history(paths)
    assert paths.history.read_bytes() == first


def test_status_counts_new_and_gone_items_and_days(tmp_path):
    paths = Paths(tmp_path)
    run(at(14), paths, sources(tmdb_raw({1: ("A", 10.0), 2: ("B", 5.0)}), wiki(7)))
    status, _ = run(at(16), paths, sources(tmdb_raw({2: ("B", 6.0), 3: ("C", 1.0), 4: ("D", 1.0)}), wiki(7)))
    assert status["days_with_success"] == 2
    assert status["first_run_date"] == "2026-11-14"
    assert status["new_today"] == 2  # C and D
    assert status["gone_today"] == 1  # A
    assert status["items"] == 4


def test_issue_body_lists_moves_new_and_gone(tmp_path):
    paths = Paths(tmp_path)
    run(at(14), paths, sources(tmdb_raw({1: ("Alpha", 10.0), 2: ("Beta", 5.0)}), wiki(7)))
    status, _ = run(at(15), paths, sources(tmdb_raw({2: ("Beta", 10.0), 3: ("Gamma", 1.0)}), wiki(7)))
    body = issue_body(read_csv(paths.history), status, "2026-11-15")
    assert "Beta" in body and "+100.0%" in body and "| 5 | 10 |" in body
    assert "## Appeared" in body and "Gamma (tmdb)" in body
    assert "## Disappeared" in body and "Alpha (tmdb)" in body


def test_issue_body_is_still_written_on_a_day_with_no_changes(tmp_path):
    paths = Paths(tmp_path)
    run(at(14), paths, sources(tmdb_raw({1: ("A", 10.0)}), wiki(7)))
    status, _ = run(at(15), paths, sources(tmdb_raw({1: ("A", 10.0)}), wiki(7)))
    body = issue_body(read_csv(paths.history), status, "2026-11-15")
    assert "+0.0%" in body and "None." in body


def test_issue_body_mentions_a_failed_source(tmp_path):
    paths = Paths(tmp_path)
    run(at(14), paths, sources(tmdb_raw({1: ("A", 10.0)}), wiki(7)))
    status, _ = run(at(15), paths, sources(RuntimeError("down"), wiki(7)))
    body = issue_body(read_csv(paths.history), status, "2026-11-15")
    assert "**failed**" in body and "`tmdb` returned no data today" in body


def test_titles_cannot_ping_users_or_break_the_issue_table(tmp_path):
    paths = Paths(tmp_path)
    nasty = "@octocat <b>Hi</b> | `x`"
    run(at(14), paths, sources(tmdb_raw({1: (nasty, 10.0), 2: ("Gone", 5.0)}), wiki(7)))
    status, _ = run(at(15), paths, sources(tmdb_raw({1: (nasty, 20.0), 3: (nasty + "2", 1.0)}), wiki(7)))
    body = issue_body(read_csv(paths.history), status, "2026-11-15")
    assert "@octocat" not in body and "@\u200boctocat" in body
    assert "<b>" not in body and "`x`" not in body
    moves_row = [line for line in body.splitlines() if "+100.0%" in line][0]
    assert moves_row.count("|") == 7  # the pipe in the title did not add a column
