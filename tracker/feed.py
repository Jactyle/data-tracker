"""The Atom feed of the daily reports: feed.xml.

    python -m tracker.feed        # rebuild feed.xml from data/history.csv

Subscribe to it in any feed reader to be told about each day's biggest moves, new and gone
items. It has one entry per day (the last 30 days), written from the history file alone with
the same move rule as the daily issue, so building it again gives the same file.
"""
from __future__ import annotations

import re
import sys

from .config import DEFAULT_PATHS, FEED_DAYS, SITE_URL
from .moves import compute_report
from .report import fmt_number
from .rows import read_csv

EMPTY_TIME = "1970-01-01T00:00:00Z"
# XML 1.0 cannot hold most control characters, so any that sneak into a title are dropped.
_BAD_CHARS = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]")


def xml_text(text):
    """Escape text for an XML element or attribute."""
    text = _BAD_CHARS.sub("", str(text))
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def day_summary(report):
    """One line: how many moves and changes the day had."""
    return "%d moves, %d appeared, %d disappeared" % (len(report["moves"]), len(report["new"]), len(report["gone"]))


def day_text(report):
    """The plain-text body of one day's entry."""
    lines = ["Movie tracker report for %s" % report["date"], "", "Biggest moves since the previous run:"]
    if report["moves"]:
        for move in report["moves"]:
            lines.append("- %s (%s): %s %s -> %s (%+.1f%%)" % (
                move["item"], move["source"], move["column"], fmt_number(move["old"]), fmt_number(move["new"]), move["percent"]))
    else:
        lines.append("- none")
    for key, heading in (("new", "Appeared"), ("gone", "Disappeared")):
        names = ["%s (%s)" % (entry["item"], entry["source"]) for entry in report[key]]
        lines.append("%s: %s" % (heading, ", ".join(names) if names else "none"))
    for source in report["missing_sources"]:
        lines.append("Note: %s returned no data today, so it was not compared." % source)
    for source in report["first_run_sources"]:
        lines.append("Note: %s has no earlier run yet, so there is nothing to compare." % source)
    return "\n".join(lines)


def build_feed(rows, site_url=SITE_URL, days=FEED_DAYS):
    """The text of the Atom feed for the given history rows (newest day first)."""
    dates = sorted({row["date"] for row in rows}, reverse=True)[:days]
    entries = []
    for date in dates:
        report = compute_report(rows, date)
        entries.append(
            "  <entry>\n"
            "    <id>%s#%s</id>\n"
            "    <title>Report for %s</title>\n"
            "    <updated>%sT00:00:00Z</updated>\n"
            "    <link rel=\"alternate\" href=\"%s\"/>\n"
            "    <summary>%s</summary>\n"
            "    <content type=\"text\">%s</content>\n"
            "  </entry>\n" % (xml_text(site_url), date, date, date, xml_text(site_url),
                              xml_text(day_summary(report)), xml_text(day_text(report))))
    updated = "%sT00:00:00Z" % dates[0] if dates else EMPTY_TIME
    return (
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<feed xmlns=\"http://www.w3.org/2005/Atom\">\n"
        "  <id>%s</id>\n"
        "  <title>Movie Tracker daily report</title>\n"
        "  <subtitle>The biggest moves, and the films that appeared or disappeared, each day.</subtitle>\n"
        "  <updated>%s</updated>\n"
        "  <link rel=\"alternate\" href=\"%s\"/>\n"
        "  <link rel=\"self\" type=\"application/atom+xml\" href=\"%sfeed.xml\"/>\n"
        "  <author><name>Movie Tracker</name></author>\n"
        "%s</feed>\n" % (xml_text(site_url), updated, xml_text(site_url), xml_text(site_url), "".join(entries)))


def write_feed(rows, paths=DEFAULT_PATHS):
    """Write feed.xml and return its text."""
    text = build_feed(rows)
    paths.feed.write_text(text, encoding="utf-8")
    return text


def main():
    rows = read_csv(DEFAULT_PATHS.history)
    write_feed(rows)
    print("wrote %s (%d day(s))" % (DEFAULT_PATHS.feed, len({row["date"] for row in rows})))
    return 0


if __name__ == "__main__":
    sys.exit(main())
