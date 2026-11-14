"""The move rule: which items moved the most since the previous run.

For each source that has rows on the run date:
  * the previous run is the latest earlier date with rows from the same source;
  * an item in both days has a move = (new - old) / old * 100 on the source's
    main value (votes for IMDb, views for Wikipedia); the old value must
    be above 0 and both values must exist;
  * the 5 items with the largest absolute move are kept from each source;
  * an item only in the run date has appeared, an item only in the previous
    run has disappeared;
  * a source with no rows on the run date (it failed) is skipped, and a
    source with no earlier run has nothing to compare with yet.
"""
from __future__ import annotations

from collections import defaultdict

from .config import MAIN_VALUE, NUMERIC_COLUMNS, TOP_MOVES_PER_SOURCE


def percent_change(old, new):
    """Return the percent change from old to new, or None if it is undefined."""
    if old is None or new is None or old <= 0:
        return None
    return (new - old) / old * 100.0


def compute_report(rows, date):
    """Compare the rows of `date` with each source's previous run."""
    by_source = defaultdict(lambda: defaultdict(dict))
    for row in rows:
        by_source[row["source"]][row["date"]][row["item_id"]] = row

    report = {"date": date, "moves": [], "new": [], "gone": [],
              "missing_sources": [], "first_run_sources": []}
    for source in sorted(by_source):
        days = by_source[source]
        if date not in days:
            report["missing_sources"].append(source)
            continue
        earlier = [day for day in days if day < date]
        if not earlier:
            report["first_run_sources"].append(source)
            continue
        previous = max(earlier)
        now, before = days[date], days[previous]
        column = MAIN_VALUE.get(source, NUMERIC_COLUMNS[0])

        for item_id in sorted(set(now) - set(before)):
            report["new"].append({"item_id": item_id, "item": now[item_id]["item"], "source": source})
        for item_id in sorted(set(before) - set(now)):
            report["gone"].append({"item_id": item_id, "item": before[item_id]["item"], "source": source})

        moves = []
        for item_id in set(now) & set(before):
            old, new = before[item_id][column], now[item_id][column]
            change = percent_change(old, new)
            if change is not None:
                moves.append({"item_id": item_id, "item": now[item_id]["item"], "source": source,
                              "column": column, "old": old, "new": new, "percent": change,
                              "previous_date": previous})
        moves.sort(key=lambda move: (-abs(move["percent"]), move["item_id"]))
        report["moves"].extend(moves[:TOP_MOVES_PER_SOURCE])

    report["moves"].sort(key=lambda move: (-abs(move["percent"]), move["item_id"]))
    return report
