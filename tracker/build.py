"""Build data/history.csv from the raw files alone.

    python -m tracker.build           # rebuild data/history.csv
    python -m tracker.build --check   # fail if the file differs from a rebuild
"""
from __future__ import annotations

import sys

from . import raw
from .config import DEFAULT_PATHS
from .rows import sort_rows, write_csv
from .sources import SOURCES


def build_rows(paths=DEFAULT_PATHS):
    """Convert every raw file to rows. The result depends only on the raw files."""
    rows = []
    seen = set()
    for date, source, path in raw.list_raw(paths):
        module = SOURCES.get(source)
        if module is None:
            print("skipping %s: unknown source" % path, file=sys.stderr)
            continue
        try:
            converted = module.convert(raw.read_raw(path), date)
        except Exception as exc:  # a damaged file must not stop the whole build
            print("skipping %s: %s" % (path, exc), file=sys.stderr)
            continue
        for row in converted:
            key = (row["date"], row["item_id"])
            if key not in seen:  # an item appears once per day
                seen.add(key)
                rows.append(row)
    return sort_rows(rows)


def build_history(paths=DEFAULT_PATHS):
    """Rebuild the history file from the raw files and return its rows."""
    rows = build_rows(paths)
    write_csv(paths.history, rows)
    return rows


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    paths = DEFAULT_PATHS
    if "--check" in argv:
        before = paths.history.read_bytes() if paths.history.exists() else None
        build_history(paths)
        after = paths.history.read_bytes()
        if before != after:
            print("history.csv does not match a rebuild from the raw files")
            return 1
        print("history.csv matches a rebuild from the raw files")
        return 0
    rows = build_history(paths)
    print("wrote %d rows to %s" % (len(rows), paths.history))
    return 0


if __name__ == "__main__":
    sys.exit(main())
