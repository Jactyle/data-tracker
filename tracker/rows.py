"""Reading and writing rows of the common column set."""
from __future__ import annotations

import csv

from .config import COLUMNS, NUMERIC_COLUMNS


def make_row(**values):
    """Return a row holding every common column, empty when not given."""
    unknown = set(values) - set(COLUMNS)
    if unknown:
        raise ValueError("unknown columns: %s" % sorted(unknown))
    return {column: values.get(column) for column in COLUMNS}


def number_or_none(value):
    """Return value as a number, or None when it is missing or not a number."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    return None


def sort_rows(rows):
    """Sort rows by date, then by item_id (as text)."""
    return sorted(rows, key=lambda row: (row["date"], row["item_id"]))


def write_csv(path, rows):
    """Write rows to path with the common columns; missing values stay empty."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(COLUMNS)
        for row in rows:
            writer.writerow(["" if row[c] is None else row[c] for c in COLUMNS])


def read_csv(path):
    """Read a history file; numeric columns become numbers, empty becomes None."""
    if not path.exists():
        return []
    rows = []
    with open(path, newline="", encoding="utf-8") as handle:
        for record in csv.DictReader(handle):
            row = {}
            for column in COLUMNS:
                text = record.get(column, "")
                if text == "":
                    row[column] = None
                elif column in NUMERIC_COLUMNS or column == "release_year":
                    number = float(text)
                    row[column] = int(number) if number.is_integer() else number
                else:
                    row[column] = text
            rows.append(row)
    return rows
