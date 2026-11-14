from tracker.config import MAIN_VALUE
from tracker.moves import compute_report, percent_change
from tracker.rows import make_row


def tmdb_row(date, movie_id, popularity, name=None):
    return make_row(date=date, item_id="tmdb:%d" % movie_id, item=name or "Movie %d" % movie_id,
                    source="tmdb", popularity=popularity)


def wiki_row(date, key, views):
    return make_row(date=date, item_id="wikipedia:" + key, item=key, source="wikipedia", views=views)


def test_percent_change():
    assert percent_change(100, 150) == 50
    assert percent_change(200, 100) == -50
    assert percent_change(0, 5) is None
    assert percent_change(None, 5) is None
    assert percent_change(5, None) is None


def test_main_values_are_defined_for_both_sources():
    assert MAIN_VALUE == {"tmdb": "popularity", "wikipedia": "views"}


def test_moves_are_ranked_by_absolute_percent_change():
    rows = [tmdb_row("2026-11-14", 1, 100), tmdb_row("2026-11-14", 2, 100), tmdb_row("2026-11-14", 3, 100),
            tmdb_row("2026-11-15", 1, 110), tmdb_row("2026-11-15", 2, 40), tmdb_row("2026-11-15", 3, 100)]
    report = compute_report(rows, "2026-11-15")
    assert [m["item_id"] for m in report["moves"]] == ["tmdb:2", "tmdb:1", "tmdb:3"]
    drop = report["moves"][0]
    assert (drop["old"], drop["new"]) == (100, 40)
    assert drop["percent"] == -60
    assert drop["previous_date"] == "2026-11-14"


def test_only_five_moves_are_kept_per_source():
    old = [tmdb_row("2026-11-14", i, 100) for i in range(1, 9)]
    new = [tmdb_row("2026-11-15", i, 100 + i) for i in range(1, 9)]
    report = compute_report(old + new, "2026-11-15")
    assert [m["item_id"] for m in report["moves"]] == ["tmdb:8", "tmdb:7", "tmdb:6", "tmdb:5", "tmdb:4"]


def test_the_top_five_is_kept_for_each_source():
    rows = []
    for day, factor in (("2026-11-14", 1), ("2026-11-15", 2)):
        rows += [tmdb_row(day, i, 100 * factor) for i in range(1, 7)]
        rows += [wiki_row(day, "F%d" % i, 10 * factor) for i in range(1, 7)]
    assert len(compute_report(rows, "2026-11-15")["moves"]) == 10


def test_items_that_appeared_or_disappeared():
    rows = [tmdb_row("2026-11-14", 1, 5, "Old Film"), tmdb_row("2026-11-14", 2, 5, "Stays"),
            tmdb_row("2026-11-15", 2, 6, "Stays"), tmdb_row("2026-11-15", 3, 5, "Fresh Film")]
    report = compute_report(rows, "2026-11-15")
    assert [e["item"] for e in report["new"]] == ["Fresh Film"]
    assert [e["item"] for e in report["gone"]] == ["Old Film"]
    assert [m["item_id"] for m in report["moves"]] == ["tmdb:2"]  # only items in both days move


def test_previous_run_is_the_source_own_latest_earlier_day():
    rows = [tmdb_row("2026-11-14", 1, 100), wiki_row("2026-11-14", "A", 10),
            wiki_row("2026-11-15", "A", 20),  # tmdb failed on the 15th
            tmdb_row("2026-11-16", 1, 150), wiki_row("2026-11-16", "A", 30)]
    report = compute_report(rows, "2026-11-16")
    by_item = {m["item_id"]: m for m in report["moves"]}
    assert by_item["tmdb:1"]["previous_date"] == "2026-11-14"
    assert by_item["tmdb:1"]["percent"] == 50
    assert by_item["wikipedia:A"]["previous_date"] == "2026-11-15"
    assert report["gone"] == [] and report["new"] == []


def test_a_failed_source_does_not_make_its_items_disappear():
    rows = [tmdb_row("2026-11-14", 1, 100), wiki_row("2026-11-14", "A", 10),
            wiki_row("2026-11-15", "A", 20)]
    report = compute_report(rows, "2026-11-15")
    assert report["gone"] == []
    assert report["missing_sources"] == ["tmdb"]


def test_first_run_has_nothing_to_compare():
    report = compute_report([tmdb_row("2026-11-14", 1, 100)], "2026-11-14")
    assert report["moves"] == [] and report["new"] == [] and report["gone"] == []
    assert report["first_run_sources"] == ["tmdb"]


def test_items_without_a_usable_old_value_are_not_ranked():
    rows = [tmdb_row("2026-11-14", 1, 0), tmdb_row("2026-11-14", 2, None),
            tmdb_row("2026-11-15", 1, 5), tmdb_row("2026-11-15", 2, 5)]
    assert compute_report(rows, "2026-11-15")["moves"] == []


def test_ties_are_broken_by_item_id():
    rows = [tmdb_row("2026-11-14", 2, 100), tmdb_row("2026-11-14", 1, 100),
            tmdb_row("2026-11-15", 2, 110), tmdb_row("2026-11-15", 1, 110)]
    assert [m["item_id"] for m in compute_report(rows, "2026-11-15")["moves"]] == ["tmdb:1", "tmdb:2"]
