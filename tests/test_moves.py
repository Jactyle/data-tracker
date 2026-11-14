from tracker.config import MAIN_VALUE
from tracker.moves import compute_report, percent_change
from tracker.rows import make_row


def imdb_row(date, film, votes, name=None):
    return make_row(date=date, item_id="imdb:tt%07d" % film, item=name or "Film %d" % film,
                    source="imdb", votes=votes)


def wiki_row(date, key, views):
    return make_row(date=date, item_id="wikipedia:" + key, item=key, source="wikipedia", views=views)


def test_percent_change():
    assert percent_change(100, 150) == 50
    assert percent_change(200, 100) == -50
    assert percent_change(0, 5) is None
    assert percent_change(None, 5) is None
    assert percent_change(5, None) is None


def test_main_values_are_defined_for_both_sources():
    assert MAIN_VALUE == {"imdb": "votes", "wikipedia": "views"}


def test_moves_are_ranked_by_absolute_percent_change():
    rows = [imdb_row("2026-11-14", 1, 100), imdb_row("2026-11-14", 2, 100), imdb_row("2026-11-14", 3, 100),
            imdb_row("2026-11-15", 1, 110), imdb_row("2026-11-15", 2, 40), imdb_row("2026-11-15", 3, 100)]
    report = compute_report(rows, "2026-11-15")
    assert [m["item_id"] for m in report["moves"]] == ["imdb:tt0000002", "imdb:tt0000001", "imdb:tt0000003"]
    drop = report["moves"][0]
    assert (drop["old"], drop["new"]) == (100, 40)
    assert drop["percent"] == -60
    assert drop["previous_date"] == "2026-11-14"


def test_only_five_moves_are_kept_per_source():
    old = [imdb_row("2026-11-14", i, 100) for i in range(1, 9)]
    new = [imdb_row("2026-11-15", i, 100 + i) for i in range(1, 9)]
    report = compute_report(old + new, "2026-11-15")
    assert [m["item_id"] for m in report["moves"]] == ["imdb:tt0000008", "imdb:tt0000007", "imdb:tt0000006", "imdb:tt0000005", "imdb:tt0000004"]


def test_the_top_five_is_kept_for_each_source():
    rows = []
    for day, factor in (("2026-11-14", 1), ("2026-11-15", 2)):
        rows += [imdb_row(day, i, 100 * factor) for i in range(1, 7)]
        rows += [wiki_row(day, "F%d" % i, 10 * factor) for i in range(1, 7)]
    assert len(compute_report(rows, "2026-11-15")["moves"]) == 10


def test_items_that_appeared_or_disappeared():
    rows = [imdb_row("2026-11-14", 1, 5, "Old Film"), imdb_row("2026-11-14", 2, 5, "Stays"),
            imdb_row("2026-11-15", 2, 6, "Stays"), imdb_row("2026-11-15", 3, 5, "Fresh Film")]
    report = compute_report(rows, "2026-11-15")
    assert [e["item"] for e in report["new"]] == ["Fresh Film"]
    assert [e["item"] for e in report["gone"]] == ["Old Film"]
    assert [m["item_id"] for m in report["moves"]] == ["imdb:tt0000002"]  # only items in both days move


def test_previous_run_is_the_source_own_latest_earlier_day():
    rows = [imdb_row("2026-11-14", 1, 100), wiki_row("2026-11-14", "A", 10),
            wiki_row("2026-11-15", "A", 20),  # imdb failed on the 15th
            imdb_row("2026-11-16", 1, 150), wiki_row("2026-11-16", "A", 30)]
    report = compute_report(rows, "2026-11-16")
    by_item = {m["item_id"]: m for m in report["moves"]}
    assert by_item["imdb:tt0000001"]["previous_date"] == "2026-11-14"
    assert by_item["imdb:tt0000001"]["percent"] == 50
    assert by_item["wikipedia:A"]["previous_date"] == "2026-11-15"
    assert report["gone"] == [] and report["new"] == []


def test_a_failed_source_does_not_make_its_items_disappear():
    rows = [imdb_row("2026-11-14", 1, 100), wiki_row("2026-11-14", "A", 10),
            wiki_row("2026-11-15", "A", 20)]
    report = compute_report(rows, "2026-11-15")
    assert report["gone"] == []
    assert report["missing_sources"] == ["imdb"]


def test_first_run_has_nothing_to_compare():
    report = compute_report([imdb_row("2026-11-14", 1, 100)], "2026-11-14")
    assert report["moves"] == [] and report["new"] == [] and report["gone"] == []
    assert report["first_run_sources"] == ["imdb"]


def test_items_without_a_usable_old_value_are_not_ranked():
    rows = [imdb_row("2026-11-14", 1, 0), imdb_row("2026-11-14", 2, None),
            imdb_row("2026-11-15", 1, 5), imdb_row("2026-11-15", 2, 5)]
    assert compute_report(rows, "2026-11-15")["moves"] == []


def test_ties_are_broken_by_item_id():
    rows = [imdb_row("2026-11-14", 2, 100), imdb_row("2026-11-14", 1, 100),
            imdb_row("2026-11-15", 2, 110), imdb_row("2026-11-15", 1, 110)]
    assert [m["item_id"] for m in compute_report(rows, "2026-11-15")["moves"]] == ["imdb:tt0000001", "imdb:tt0000002"]
