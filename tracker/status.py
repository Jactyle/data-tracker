"""The status file and the per-source result log."""
from __future__ import annotations

import csv
import json

from . import raw
from .config import DEFAULT_PATHS
from .moves import compute_report

LOG_COLUMNS = ["date", "run_time", "source", "ok", "count", "error"]


def build_status(rows, results, now, paths=DEFAULT_PATHS):
    """Describe the latest run. `results` is a list of dicts: name, ok, count, error."""
    date = now.strftime("%Y-%m-%d")
    raw_dates = sorted({day for day, _source, _path in raw.list_raw(paths)})
    report = compute_report(rows, date)
    return {
        "run_time": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "first_run_date": raw_dates[0] if raw_dates else None,
        "days_with_success": len(raw_dates),
        "items": sum(1 for row in rows if row["date"] == date),
        "new_today": len(report["new"]),
        "gone_today": len(report["gone"]),
        "sources": [{"name": r["name"], "ok": r["ok"], "count": r["count"]} for r in results],
    }


def write_status(status, paths=DEFAULT_PATHS):
    paths.status.parent.mkdir(parents=True, exist_ok=True)
    paths.status.write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")


def read_status(paths=DEFAULT_PATHS):
    return json.loads(paths.status.read_text(encoding="utf-8"))


def update_source_log(date, run_time, results, paths=DEFAULT_PATHS):
    """Record every source's result for this run, replacing the same day's earlier rows."""
    kept = []
    if paths.source_log.exists():
        with open(paths.source_log, newline="", encoding="utf-8") as handle:
            kept = [row for row in csv.DictReader(handle) if row["date"] != date]
    for result in results:
        kept.append({"date": date, "run_time": run_time, "source": result["name"],
                     "ok": "true" if result["ok"] else "false",
                     "count": result["count"], "error": result.get("error") or ""})
    kept.sort(key=lambda row: (row["date"], row["source"]))
    paths.source_log.parent.mkdir(parents=True, exist_ok=True)
    with open(paths.source_log, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=LOG_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(kept)
