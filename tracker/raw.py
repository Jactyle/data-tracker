"""Saving and listing compressed raw files: data/raw/<date>/<source>.<format>.gz"""
from __future__ import annotations

import gzip
import io

from .config import DEFAULT_PATHS


def raw_path(date, source, ext, paths=DEFAULT_PATHS):
    return paths.raw / date / ("%s.%s.gz" % (source, ext))


def compress(data):
    """Gzip bytes the same way every time (no timestamp in the header)."""
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0) as handle:
        handle.write(data)
    return buffer.getvalue()


def write_raw(date, source, ext, data, paths=DEFAULT_PATHS):
    """Save one source's response for one day, replacing any earlier file."""
    path = raw_path(date, source, ext, paths)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(compress(data))
    return path


def list_raw(paths=DEFAULT_PATHS):
    """Return [(date, source, path)] for every raw file, oldest first."""
    found = []
    if not paths.raw.exists():
        return found
    for day_dir in sorted(p for p in paths.raw.iterdir() if p.is_dir()):
        for path in sorted(day_dir.glob("*.gz")):
            source = path.name.split(".", 1)[0]
            found.append((day_dir.name, source, path))
    return found


def read_raw(path):
    return gzip.decompress(path.read_bytes())
