"""The second daily slot only runs when the first one did not do the job."""
from datetime import datetime, timezone

from tracker.needed import backup_needed

NOW = datetime(2026, 11, 15, 20, 17, tzinfo=timezone.utc)


def status(run_time, *oks):
    return {"run_time": run_time, "sources": [{"name": "s%d" % i, "ok": ok, "count": 1} for i, ok in enumerate(oks)]}


def test_no_backup_when_todays_run_saved_every_source():
    assert backup_needed(status("2026-11-15T14:19:02Z", True, True), NOW) is False


def test_backup_when_no_run_happened_today():
    assert backup_needed(status("2026-11-14T14:19:02Z", True, True), NOW) is True


def test_backup_when_a_source_failed_in_todays_run():
    assert backup_needed(status("2026-11-15T14:19:02Z", True, False), NOW) is True


def test_backup_when_the_status_is_missing_or_damaged():
    for broken in (None, {}, {"run_time": "2026-11-15T14:19:02Z"}, {"run_time": "2026-11-15T14:19:02Z", "sources": []}, "text", 5):
        assert backup_needed(broken, NOW) is True
