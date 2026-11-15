"""The Atom feed of the daily reports."""
import xml.etree.ElementTree as ET

from tests.helpers import at, imdb_raw, sources, wiki
from tracker.config import Paths
from tracker.feed import EMPTY_TIME, build_feed, day_text, xml_text
from tracker.moves import compute_report
from tracker.rows import make_row
from tracker.run import run

NS = {"a": "http://www.w3.org/2005/Atom"}


def row(date, item_id, item, votes, source="imdb"):
    return make_row(date=date, item_id=item_id, item=item, source=source, votes=votes)


HISTORY = [row("2026-11-13", "imdb:1", "Alpha", 100), row("2026-11-13", "imdb:2", "Beta", 200),
           row("2026-11-14", "imdb:1", "Alpha", 150), row("2026-11-14", "imdb:3", "Gamma", 50)]


def parse(text):
    return ET.fromstring(text.encode("utf-8"))


def test_the_feed_is_valid_xml_with_one_entry_per_day_newest_first():
    root = parse(build_feed(HISTORY))
    assert root.tag == "{http://www.w3.org/2005/Atom}feed"
    titles = [e.find("a:title", NS).text for e in root.findall("a:entry", NS)]
    assert titles == ["Report for 2026-11-14", "Report for 2026-11-13"]
    assert root.find("a:updated", NS).text == "2026-11-14T00:00:00Z"


def test_an_entry_says_what_moved_appeared_and_disappeared():
    text = parse(build_feed(HISTORY)).find("a:entry/a:content", NS).text
    assert "Alpha (imdb): votes 100 -> 150 (+50.0%)" in text
    assert "Appeared: Gamma (imdb)" in text
    assert "Disappeared: Beta (imdb)" in text
    assert parse(build_feed(HISTORY)).find("a:entry/a:summary", NS).text == "1 moves, 1 appeared, 1 disappeared"


def test_the_first_day_says_there_is_nothing_to_compare():
    text = day_text(compute_report(HISTORY, "2026-11-13"))
    assert "Note: imdb has no earlier run yet" in text and "- none" in text


def test_building_the_feed_twice_gives_the_same_text():
    assert build_feed(HISTORY) == build_feed(list(HISTORY))


def test_only_the_last_days_are_listed():
    rows = [row("2026-10-%02d" % day, "imdb:1", "Alpha", 100 + day) for day in range(1, 29)]
    rows += [row("2026-11-%02d" % day, "imdb:1", "Alpha", 200 + day) for day in range(1, 10)]
    root = parse(build_feed(rows, days=30))
    assert len(root.findall("a:entry", NS)) == 30
    assert len(parse(build_feed(rows, days=3)).findall("a:entry", NS)) == 3


def test_an_empty_history_still_gives_a_valid_feed():
    root = parse(build_feed([]))
    assert root.findall("a:entry", NS) == [] and root.find("a:updated", NS).text == EMPTY_TIME


def test_titles_with_markup_and_control_characters_cannot_break_the_feed():
    nasty = [row("2026-11-13", "imdb:1", "A & B <script>", 100), row("2026-11-14", "imdb:1", "A & B <script>\x0b", 200)]
    root = parse(build_feed(nasty))
    assert "A & B <script>" in root.find("a:entry/a:content", NS).text
    assert "\x0b" not in xml_text("x\x0by") and xml_text("a<b&\"") == "a&lt;b&amp;&quot;"


def test_every_run_writes_the_feed_and_a_second_run_the_same_day_rewrites_it(tmp_path):
    paths = Paths(tmp_path)
    run(at(14), paths, sources(imdb_raw({1: ("A", 10)}), wiki(7)))
    first = (tmp_path / "feed.xml").read_text(encoding="utf-8")
    run(at(14, hour=20), paths, sources(imdb_raw({1: ("A", 10)}), wiki(7)))
    assert (tmp_path / "feed.xml").read_text(encoding="utf-8") == first      # same data, same feed: no needless commit
    run(at(15), paths, sources(imdb_raw({1: ("A", 12)}), wiki(7)))
    assert len(parse((tmp_path / "feed.xml").read_text(encoding="utf-8")).findall("a:entry", NS)) == 2
