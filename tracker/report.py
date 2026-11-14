"""The text of the daily GitHub Issue."""
from __future__ import annotations

from .moves import compute_report


def fmt_number(value):
    if value is None:
        return "—"
    if float(value).is_integer():
        return "{:,.0f}".format(value)
    return "{:,.2f}".format(value)


def clean(text):
    """Make a title safe for an issue: no @mentions, HTML or table breaks."""
    return (text.replace("|", "/").replace("@", "@\u200b").replace("<", "&lt;")
            .replace("`", "'").replace("\n", " "))


def issue_title(date):
    return date


def issue_body(rows, status, date):
    """Markdown listing the biggest moves, new items and gone items."""
    report = compute_report(rows, date)
    lines = ["# Movie tracker report for %s" % date, ""]
    lines.append("Run time (UTC): `%s` · days with data: %d · items today: %d"
                 % (status["run_time"], status["days_with_success"], status["items"]))
    lines += ["", "## Sources", "", "| Source | Result | Items |", "| --- | --- | --- |"]
    for source in status["sources"]:
        lines.append("| %s | %s | %d |" % (source["name"], "ok" if source["ok"] else "**failed**", source["count"]))

    lines += ["", "## Biggest moves since the previous run", ""]
    if report["moves"]:
        lines += ["| Item | Source | Value | Old | New | Change |", "| --- | --- | --- | ---: | ---: | ---: |"]
        for move in report["moves"]:
            lines.append("| %s | %s | %s | %s | %s | %+.1f%% |" % (
                clean(move["item"]), move["source"], move["column"],
                fmt_number(move["old"]), fmt_number(move["new"]), move["percent"]))
    else:
        lines.append("No moves to report today.")

    for key, heading in (("new", "Appeared"), ("gone", "Disappeared")):
        lines += ["", "## %s" % heading, ""]
        if report[key]:
            lines += ["- %s (%s)" % (clean(entry["item"]), entry["source"]) for entry in report[key]]
        else:
            lines.append("None.")

    notes = []
    for source in report["missing_sources"]:
        notes.append("- `%s` returned no data today, so it was not compared." % source)
    for source in report["first_run_sources"]:
        notes.append("- `%s` has no earlier run yet, so there is nothing to compare." % source)
    if notes:
        lines += ["", "## Notes", ""] + notes

    lines += ["", "_Move rule: percent change of each item's main value (popularity for TMDB, "
              "views for Wikipedia) since the source's previous run; the 5 largest moves per "
              "source are listed._"]
    return "\n".join(lines) + "\n"
