"""The plain logic behind the shareable view links, the decoding effect and the command bar, run
with the real JavaScript (node, or JavaScriptCore on a Mac)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"


@pytest.fixture(scope="module")
def js():
    node = shutil.which("node")
    if node:
        command = [node, "tests/js_logic.js", str(ROOT)]
    elif Path(JSC).exists():
        command = [JSC, "tests/js_logic.js", "--", str(ROOT)]
    else:
        pytest.skip("neither node nor jsc is available")
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr + result.stdout
    return json.loads(result.stdout.strip().splitlines()[-1])


# ---- the Browse view as a link ----

def test_plain_view_has_no_query(js):
    assert js["parseEmpty"] == {"q": "", "source": "", "language": "", "year": "", "starred": False, "sort": "item", "dir": 1}
    assert js["formatDefault"] == ""


def test_a_full_view_is_read_from_the_address(js):
    assert js["parseFull"] == {"q": "Sin ners", "source": "imdb", "language": "en", "year": "2025", "starred": True, "sort": "votes", "dir": 1}


def test_sort_direction_defaults_like_the_page_does(js):
    assert js["parseNumberSort"]["dir"] == -1     # numbers: highest first
    assert js["parseTextSort"]["dir"] == 1        # text: A to Z


def test_unknown_or_broken_parts_are_ignored(js):
    assert js["parseBadSort"]["sort"] == "item" and js["parseBadSort"]["dir"] == 1
    assert js["parseBroken"]["q"] == "" and js["parseBroken"]["source"] == "imdb"
    assert js["longQuery"] == 100


def test_a_view_survives_the_trip_into_a_link_and_back(js):
    assert js["roundTrip"] == "?q=Sin%20ners&source=imdb&starred=1&sort=votes&dir=asc"
    assert js["parsePlus"]["q"] == "a b&c"
    assert js["specialBack"] == "a b&c=d"


def test_chosen_trends_items_travel_in_the_link(js):
    assert js["items"] == ["imdb:tt1", "wikipedia:Inception"]
    assert js["itemsFormat"] == "?items=imdb%3Att1%2Cwikipedia%3AInception"
    assert js["itemsEmpty"] == "" and js["itemsMax"] == 8


# ---- the decoding effect ----

def test_decoding_never_changes_the_final_text(js):
    d = js["decode"]
    assert d["full"] == "Sinners 2025"
    assert d["empty"] == ""
    assert d["spaces"][1] == " " and d["spaces"][3] == " "          # spaces stay put
    assert len(d["zero"]) == len(d["mid"]) == len("Sinners 2025")
    assert d["zero"] != "Sinners 2025", "at the start the text is scrambled"


def test_decoding_resolves_gradually(js):
    d = js["decode"]
    right = sum(a == b for a, b in zip(d["mid"], "Sinners 2025"))
    wrong_at_start = sum(a != b for a, b in zip(d["zero"], "Sinners 2025"))
    assert right > sum(a == b for a, b in zip(d["zero"], "Sinners 2025"))
    assert wrong_at_start >= 8


# ---- the command bar ----

def test_commands_are_split_into_a_word_and_the_rest(js):
    assert js["parse"] == [{"name": "star", "args": "Sinners"}, {"name": "", "args": ""}, {"name": "trends", "args": ""}]


def test_films_are_grouped_by_name_across_sources(js):
    assert js["groupNames"] == ["Avatar: Fire and Ash", "Avengers: Doomsday", "Sinners", "Superman", "The Odyssey"]
    assert js["sinnersIds"] == ["imdb:tt1", "wikipedia:Sinners"]


def test_a_film_is_found_from_part_of_its_name(js):
    r = js["resolve"]
    assert r["exact"]["group"]["name"] == "Sinners"
    assert r["single"]["group"]["name"] == "The Odyssey"
    assert r["many"]["many"] == ["Avatar: Fire and Ash", "Avengers: Doomsday"]
    assert r["none"] == {"none": True}


def test_suggestions_follow_what_is_typed(js):
    s = js["suggest"]
    assert len(s["empty"]) == 7 and s["empty"][0] == "go "
    assert "sort " in s["so"] and "sound " in s["so"]
    assert "go trends" in s["tr"]
    assert s["starSin"] == ["star Sinners"]
    assert s["sortV"] == ["sort votes", "sort views"]
    assert s["filterSource"] == ["filter source imdb", "filter source wikipedia"]
    assert s["filterY"] == ["filter year "]
    assert s["soundO"] == ["sound on", "sound off"]
    assert s["nothing"] == []
    assert s["avatar"][0] == "search Avatar: Fire and Ash"
    assert s["goB"] == ["go browse"]
    assert s["noContext"] == []


def test_sort_words_map_to_columns(js):
    assert js["columns"] == ["views_7d", "rating", "release_year", None]


# ---- words every JavaScript object knows must not be mistaken for commands ----

def test_inherited_object_names_are_not_columns_or_filters(js):
    assert js["inherited"]["column"] == ["null", "null", "null"]      # not "function" or "object"
    assert js["inherited"]["filter"] == [] and js["inherited"]["filterKey"] == []


# ---- a damaged saved shortlist must never break a page ----

def test_a_damaged_shortlist_reads_as_empty_or_keeps_only_film_ids(js):
    short = js["shortlist"]
    assert short["fine"] == ["imdb:tt1", "wikipedia:Sinners"]
    assert short["nothing"] == []
    assert short["isNull"] == short["isObject"] == short["isText"] == []
    assert short["mixed"] == ["imdb:tt1"]
    assert short["garbage"] == []
