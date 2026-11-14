from tests.helpers import TMDB_RAW, tmdb_raw, wiki_raw
from tracker import raw
from tracker.build import build_history, build_rows
from tracker.config import COLUMNS, Paths
from tracker.rows import read_csv


def test_raw_files_are_gzipped_and_identical_when_rewritten(tmp_path):
    paths = Paths(tmp_path)
    path = raw.write_raw("2026-11-14", "tmdb", "json", TMDB_RAW, paths)
    assert path == tmp_path / "data/raw/2026-11-14/tmdb.json.gz"
    first = path.read_bytes()
    assert raw.read_raw(path) == TMDB_RAW
    raw.write_raw("2026-11-14", "tmdb", "json", TMDB_RAW, paths)
    assert path.read_bytes() == first


def test_history_has_fixed_columns_and_is_sorted(tmp_path):
    paths = Paths(tmp_path)
    raw.write_raw("2026-11-15", "tmdb", "json", tmdb_raw({2: ("B", 1.0), 1: ("A", 2.0)}), paths)
    raw.write_raw("2026-11-14", "wikipedia", "json", wiki_raw(Inception={"20261113": 4}), paths)
    raw.write_raw("2026-11-14", "tmdb", "json", tmdb_raw({2: ("B", 1.5)}), paths)
    build_history(paths)
    header = paths.history.read_text().splitlines()[0].split(",")
    assert header == COLUMNS
    assert header[:4] == ["date", "item_id", "item", "source"]
    rows = read_csv(paths.history)
    keys = [(r["date"], r["item_id"]) for r in rows]
    assert keys == [("2026-11-14", "tmdb:2"), ("2026-11-14", "wikipedia:Inception"),
                    ("2026-11-15", "tmdb:1"), ("2026-11-15", "tmdb:2")]


def test_building_twice_gives_the_same_file(tmp_path):
    paths = Paths(tmp_path)
    raw.write_raw("2026-11-14", "tmdb", "json", TMDB_RAW, paths)
    raw.write_raw("2026-11-15", "wikipedia", "json", wiki_raw(Inception={"20261114": 9}), paths)
    build_history(paths)
    first = paths.history.read_bytes()
    paths.history.unlink()
    build_history(paths)
    assert paths.history.read_bytes() == first


def test_history_is_rebuilt_from_raw_so_stale_rows_disappear(tmp_path):
    paths = Paths(tmp_path)
    raw.write_raw("2026-11-14", "tmdb", "json", tmdb_raw({1: ("A", 1.0)}), paths)
    build_history(paths)
    paths.history.write_text(paths.history.read_text() + "2026-11-20,tmdb:99,Fake,tmdb,,,,,,,\n")
    build_history(paths)
    assert [r["item_id"] for r in read_csv(paths.history)] == ["tmdb:1"]


def test_a_day_without_a_source_file_has_no_rows_from_that_source(tmp_path):
    paths = Paths(tmp_path)
    raw.write_raw("2026-11-14", "tmdb", "json", tmdb_raw({1: ("A", 1.0)}), paths)
    raw.write_raw("2026-11-14", "wikipedia", "json", wiki_raw(Inception={"20261113": 4}), paths)
    raw.write_raw("2026-11-15", "tmdb", "json", tmdb_raw({1: ("A", 2.0)}), paths)  # wikipedia failed
    rows = build_rows(paths)
    assert [(r["date"], r["source"]) for r in rows] == [
        ("2026-11-14", "tmdb"), ("2026-11-14", "wikipedia"), ("2026-11-15", "tmdb")]


def test_empty_values_are_written_empty(tmp_path):
    paths = Paths(tmp_path)
    raw.write_raw("2026-11-14", "wikipedia", "json", wiki_raw(Inception={"20261113": 4}), paths)
    build_history(paths)
    line = paths.history.read_text().splitlines()[1]
    assert line == "2026-11-14,wikipedia:Inception,Inception,wikipedia,,,,4,4,2010,en"


def test_a_change_to_a_rule_applies_to_every_day(tmp_path, monkeypatch):
    paths = Paths(tmp_path)
    raw.write_raw("2026-11-14", "tmdb", "json", tmdb_raw({1: ("A", 1.0)}), paths)
    raw.write_raw("2026-11-15", "tmdb", "json", tmdb_raw({1: ("A", 2.0)}), paths)
    from tracker.sources import tmdb
    original = tmdb.convert

    def doubled(data, date):
        rows = original(data, date)
        for row in rows:
            row["popularity"] *= 2
        return rows

    monkeypatch.setattr(tmdb, "convert", doubled)
    build_history(paths)
    assert [r["popularity"] for r in read_csv(paths.history)] == [2.0, 4.0]


def test_a_damaged_raw_file_is_skipped(tmp_path):
    paths = Paths(tmp_path)
    raw.write_raw("2026-11-14", "tmdb", "json", tmdb_raw({1: ("A", 1.0)}), paths)
    raw.write_raw("2026-11-15", "tmdb", "json", b"not json", paths)
    assert [r["date"] for r in build_rows(paths)] == ["2026-11-14"]


def test_a_day_written_twice_has_one_row_per_item(tmp_path):
    paths = Paths(tmp_path)
    raw.write_raw("2026-11-14", "tmdb", "json", tmdb_raw({1: ("A", 1.0), 2: ("B", 2.0)}), paths)
    build_history(paths)
    raw.write_raw("2026-11-14", "tmdb", "json", tmdb_raw({1: ("A", 5.0)}), paths)  # the second run
    build_history(paths)
    rows = read_csv(paths.history)
    assert [(r["item_id"], r["popularity"]) for r in rows] == [("tmdb:1", 5.0)]


def test_check_mode_detects_a_history_that_is_not_a_rebuild(tmp_path, monkeypatch):
    from tracker import build
    paths = Paths(tmp_path)
    monkeypatch.setattr(build, "DEFAULT_PATHS", paths)
    raw.write_raw("2026-11-14", "tmdb", "json", tmdb_raw({1: ("A", 1.0)}), paths)
    build_history(paths)
    assert build.main(["--check"]) == 0
    paths.history.write_text(paths.history.read_text() + "2026-11-20,tmdb:9,Fake,tmdb,,,,,,,\n")
    assert build.main(["--check"]) == 1  # the file differed from a rebuild...
    assert build.main(["--check"]) == 0  # ...and a rebuild has fixed it
