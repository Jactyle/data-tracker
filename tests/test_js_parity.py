"""The site repeats the move rule in JavaScript. This runs the real static/lib.js over a
generated history and checks it agrees with the Python rule (tracker/moves.py)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.helpers import tmdb_raw, wiki_raw
from tests.test_run import at, sources
from tracker.config import Paths
from tracker.moves import compute_report
from tracker.rows import read_csv
from tracker.run import run

ROOT = Path(__file__).resolve().parent.parent
JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"


def js_command(csv_path):
    node = shutil.which("node")
    if node:
        return [node, "tests/js_parity.js", str(csv_path), "static/lib.js"]
    if Path(JSC).exists():
        return [JSC, "tests/js_parity.js", "--", str(csv_path), "static/lib.js"]
    pytest.skip("neither node nor jsc is available")


def build_history(tmp_path, last_day_wikipedia_fails):
    paths = Paths(tmp_path)
    tricky = 'Beta, the "Sequel"'  # a comma and quotes must survive the CSV round trip
    days = [
        (14, {1: ("Alpha", 100.0), 2: (tricky, 50.0), 3: ("Zero", 0.0), 4: ("Gone", 9.0)}, 40),
        (15, {1: ("Alpha", 150.0), 2: (tricky, 25.0), 3: ("Zero", 5.0), 5: ("Fresh", 7.0)}, 50),
        (17, {1: ("Alpha", 120.0), 2: (tricky, 30.0), 3: ("Zero", 6.0), 5: ("Fresh", 21.0), 6: ("New", 1.0)}, 20),
    ]
    for day, movies, views in days:
        wiki = wiki_raw(Inception={"20261113": views, "20261114": views // 2, "20261116": views * 3})
        if last_day_wikipedia_fails and day == 17:
            wiki = RuntimeError("down")
        run(at(day), paths, sources(tmdb_raw(movies), wiki))
    return paths


@pytest.mark.parametrize("wikipedia_fails", [False, True])
def test_javascript_matches_python(tmp_path, wikipedia_fails):
    paths = build_history(tmp_path, wikipedia_fails)
    result = subprocess.run(js_command(paths.history), cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    js = json.loads(result.stdout.strip().splitlines()[-1])

    rows = read_csv(paths.history)
    assert js["rows"] == rows  # the browser parses the CSV exactly as Python does

    py = compute_report(rows, js["latestDate"])
    assert js["latestDate"] == "2026-11-17"
    assert [(m["item_id"], m["old"], m["now"], round(m["percent"], 9)) for m in js["moves"]] == \
           [(m["item_id"], m["old"], m["new"], round(m["percent"], 9)) for m in py["moves"]]
    assert [i["item_id"] for i in js["newItems"]] == [i["item_id"] for i in py["new"]]
    assert [i["item_id"] for i in js["goneItems"]] == [i["item_id"] for i in py["gone"]]
    assert py["moves"], "the scenario should produce moves"
    if wikipedia_fails:
        assert [s["source"] for s in js["stale"]] == py["missing_sources"] == ["wikipedia"]
