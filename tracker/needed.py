"""Is a backup run needed? Used by the second daily slot of the workflow.

    python -m tracker.needed          # prints "true" or "false"

The daily workflow has two slots (14:17 and 20:17 UTC). GitHub's scheduled runs are best effort and
one is sometimes late or skipped, so the later slot only does the job if the earlier one did not: it
answers "false" when data/status.json says a run already happened today and every source was ok.
If a source failed in the main run, the backup tries again. It uses nothing but the standard library.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

from .config import DEFAULT_PATHS


def backup_needed(status, now):
    """True unless `status` (the contents of status.json, or None) shows a fully good run today."""
    try:
        today = now.strftime("%Y-%m-%d")
        sources = status["sources"]
        return not (str(status["run_time"]).startswith(today) and sources and all(s["ok"] for s in sources))
    except (TypeError, KeyError):
        return True


def main():
    try:
        status = json.loads(DEFAULT_PATHS.status.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        status = None
    print("true" if backup_needed(status, datetime.now(timezone.utc)) else "false")
    return 0


if __name__ == "__main__":
    sys.exit(main())
