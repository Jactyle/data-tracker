"""The daily pipeline: download, save raw files, build history, write status.

    python -m tracker.run

Every run uses the UTC date of the moment it runs. A second run on the same
day replaces that day's raw files and rebuilds the history, so each day counts
once. A source that fails writes no raw file; an earlier raw file from the same
day is kept. The result of every source is recorded in the status file and in
data/source_log.csv.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

from . import raw
from .build import build_history
from .config import DEFAULT_PATHS
from .sources import SOURCES
from .status import build_status, update_source_log, write_status


def clean_error(exc):
    """A short message that never contains a secret."""
    text = ("%s: %s" % (type(exc).__name__, exc))[:200].replace("\n", " ")
    secret = os.environ.get("TMDB_API_KEY", "").strip()
    return text.replace(secret, "***") if secret else text


def run(now=None, paths=DEFAULT_PATHS, sources=None):
    now = now or datetime.now(timezone.utc)
    sources = SOURCES if sources is None else sources
    date = now.strftime("%Y-%m-%d")

    results = []
    for name, module in sources.items():
        try:
            data = module.fetch(now.date())
            rows = module.convert(data, date)  # make sure the file is usable before saving it
            if not rows:
                raise ValueError("the source returned no items")
            raw.write_raw(date, name, module.EXT, data, paths)
            results.append({"name": name, "ok": True, "count": len(rows), "error": None})
        except Exception as exc:  # one source failing must not stop the run
            results.append({"name": name, "ok": False, "count": 0, "error": clean_error(exc)})

    rows = build_history(paths)
    status = build_status(rows, results, now, paths)
    write_status(status, paths)
    update_source_log(date, status["run_time"], results, paths)
    return status, results


def main():
    status, results = run()
    for result in results:
        print("%-10s %s  items=%d  %s" % (result["name"], "ok  " if result["ok"] else "FAIL",
                                          result["count"], result["error"] or ""))
    print("run %s: %d items, %d day(s) with data" % (status["run_time"], status["items"],
                                                     status["days_with_success"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
