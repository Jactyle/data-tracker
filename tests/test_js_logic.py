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


# ---- the 3D film cloud ----

def test_films_are_placed_between_the_edges_of_the_box_by_their_numbers(js):
    cloud = js["cloud"]
    assert cloud["names"] == ["Alpha", "Beta", "Gamma"] and cloud["skipped"] == ["Delta"]    # no rating: left out
    assert cloud["ratingEnds"] == [-0.9, 0.9]
    assert abs(cloud["votesMiddle"]) < 1e-9                  # 1,000 is halfway between 100 and 10,000 on a log scale
    assert cloud["logRange"] == [2, 4]
    assert cloud["growthEnds"] == [-0.9, 0.9]


def test_a_film_without_a_third_number_sits_in_the_middle_and_is_marked(js):
    cloud = js["cloud"]
    assert cloud["thirdKnown"] == 2
    assert cloud["unknownThird"] == [0, False]


def test_an_axis_where_every_film_is_equal_collapses_to_the_middle(js):
    assert js["cloud"]["sameRating"] == [0, 0]
    assert js["cloud"]["noSource"] == 0


def test_wikipedia_films_use_views_the_weekly_spike_and_the_change(js):
    wiki = js["cloud"]["wiki"]
    assert [p["name"] for p in wiki["points"]] == ["W1", "W2"]       # W3 has no 7-day views, so it cannot be placed
    assert [s["name"] for s in wiki["skipped"]] == ["W3"]
    assert [a["key"] for a in wiki["axes"]] == ["views_7d", "spike", "change"]
    assert wiki["points"][0]["thirdKnown"] is True and wiki["points"][1]["thirdKnown"] is False


def test_the_projection_puts_the_middle_in_the_middle_and_near_things_bigger(js):
    cloud = js["cloud"]
    assert (cloud["center"]["x"], cloud["center"]["y"]) == (300, 200)
    assert cloud["right"]["x"] > 300 and cloud["up"]["y"] < 200      # right is right, up is up (screen y grows downward)
    assert cloud["near"]["s"] > cloud["center"]["s"] > cloud["far"]["s"]
    assert cloud["near"]["depth"] > cloud["far"]["depth"]
    assert abs(cloud["quarterTurn"]["x"] - 300) < 1e-6 and cloud["quarterTurn"]["depth"] > 0.99   # turned 90 degrees, the right edge faces the viewer


def test_the_mouse_finds_the_closest_film_within_reach(js):
    assert js["cloud"]["nearest"] == [1, -1, 1, -1]


def test_stepping_through_films_wraps_around(js):
    assert js["cloud"]["step"] == [0, 4, 0, 4, -1]


def test_the_note_about_a_film_stays_inside_the_cloud(js):
    right, left, squeezed = js["cloud"]["tip"]
    assert right == {"left": 110, "below": False}
    assert left == {"left": 290, "below": False}
    assert squeezed["below"] is True and 4 <= squeezed["left"] <= 340 - 220 - 4


def test_the_tilt_cannot_flip_the_box_over(js):
    assert js["cloud"]["pitch"] == [1.35, -1.35, 0.3]


def test_even_spacing_spreads_films_by_rank_and_shares_places_between_equals(js):
    rank = js["cloud"]["rank"]
    assert rank["mode"] == "rank" and rank["trueMode"] == "true"
    assert rank["rating"] == [-0.9, 0.0, 0.0, 0.9]            # the two films rated 7 share the middle place
    assert [round(v, 3) for v in rank["votes"]] == [-0.9, -0.3, 0.3, 0.9]
    assert rank["third"] == [0, 0, 0, 0]                       # no third number for anyone: everything stays in the middle
    assert rank["one"] == [0, 0, 0]                            # a single film is placed in the middle


# ---- the cloud over time ----

def test_the_timeline_has_one_model_per_day_and_keeps_one_range_on_every_axis(js):
    line = js["timeline"]
    assert line["dates"] == ["2026-11-01", "2026-11-02", "2026-11-03"]
    assert line["counts"] == [2, 2, 3]                       # the third film is new on the last day
    assert line["sameAxesEveryDay"] is True
    assert abs(line["ranges"][1][0] - 1.69897) < 1e-5 and line["ranges"][1][1] == 3     # log10(50), the new film's votes, up to log10(1,000), over all the days


def test_a_film_moves_between_days_when_its_numbers_change(js):
    line = js["timeline"]
    assert line["alphaVotesY"][0] < line["alphaVotesY"][1] < line["alphaVotesY"][2]      # 100, then 200, then 400 votes: it climbs
    assert line["betaVotesY"] == [0.9, 0.9, 0.9]             # 1,000 votes every day: it stays at the top
    assert line["alphaVotesY"][0] == -0.484                  # 100 votes sits above the bottom of the range, which the film that arrives on day 3 (50 votes) sets


def test_each_film_has_a_path_through_the_days_it_was_present(js):
    line = js["timeline"]
    assert line["pathLengths"] == {"a": 3, "c": 1} and line["pathDaysOfC"] == [2]


def test_the_third_number_needs_a_second_day_and_uses_only_history_up_to_that_day(js):
    line = js["timeline"]
    assert line["thirdKnown"][0] == 0 and line["thirdKnown"][1] == 2
    assert line["lastDayThirdForAlpha"] == 150               # (400 - 100) votes over 2 days


def test_even_spacing_and_other_sources_work_over_time(js):
    assert js["timeline"]["rankMode"] == ["rank", "rank", "rank"]
    assert js["timeline"]["none"] == []


def test_gliding_starts_at_the_old_place_and_arrives_at_the_new_one(js):
    start, middle, end, still = js["ease"]
    assert start == 0 and 0.6 < middle < 0.7 and abs(end - 1) < 1e-9 and still == 5


# ---- comparing two films ----

def test_films_in_both_sources_are_one_entry_with_both_item_ids(js):
    films = js["compare"]["films"]
    assert "Alpha:2:imdb+wikipedia" in films and "Beta:1:imdb" in films and "Gamma:1:wikipedia" in films
    assert "constructor:1:imdb" in films                      # a film called "constructor" is still just a film


def test_a_films_numbers_come_from_its_latest_values_and_its_whole_history(js):
    alpha = js["compare"]["alpha"]
    assert (alpha["rating"], alpha["votes"], alpha["views"], alpha["views_7d"]) == (6.5, 300, 1500, 7000)
    assert alpha["growth"] == 200                             # (300 - 100) votes over 1 day
    assert alpha["viewsChange"] == 50                         # 1,000 to 1,500 views
    beta = js["compare"]["beta"]
    assert beta["views"] is None and beta["viewsChange"] is None and beta["growth"] == 50
    assert js["compare"]["gamma"]["votes"] is None and js["compare"]["gamma"]["growth"] is None     # one day only: nothing to measure


def test_each_measure_says_who_is_ahead_and_by_how_much(js):
    rows = {r[0]: r for r in js["compare"]["ab"]}
    assert rows["rating"][1:] == ["b", 0.5, "diff"]            # ratings are compared by difference
    assert rows["votes"][1:] == ["a", 1.2, "ratio"] and rows["growth"][1:] == ["a", 4.0, "ratio"]
    assert rows["views"][1] is None and rows["viewsChange"][1] is None       # Beta has no Wikipedia numbers
    assert js["compare"]["gapTexts"][0] == "0.5" and js["compare"]["gapTexts"][1] == "1.2×" and js["compare"]["gapTexts"][2] == "4.0×"
    assert js["compare"]["pointsGap"] == "12.5 points"
    assert js["compare"]["levelLeads"] == ["tie", "tie"] and js["compare"]["levelText"] == "level"


def test_the_finding_states_what_the_comparison_adds_up_to(js):
    finding = js["compare"]["findingAB"]
    assert finding["heading"] == "Alpha is ahead of Beta on 2 of 3 measures"
    assert "widest gap is votes added per day, where Alpha has 4.0× as many as Beta" in finding["paragraphs"][0]
    assert "ratings differ by 0.5, in favour of Beta" in finding["paragraphs"][0]
    assert "Not compared" in finding["paragraphs"][1] and "daily views" in finding["paragraphs"][1]
    assert js["compare"]["levelHeading"] == "Alpha and Beta are level: each is ahead on 1 of 2 measures"
    assert "no measure in common yet" in js["compare"]["findingBG"]["heading"]      # one is IMDb only, the other Wikipedia only


def test_the_default_pair_is_the_two_films_with_the_most_votes(js):
    assert js["compare"]["defaults"] == {"a": "Alpha", "b": "Beta"}          # Gamma has 3,000 7-day views, but views are not votes
    assert js["compare"]["defaultsOne"] is None
    assert js["compare"]["defaultsWikiOnly"] == {"a": "Alpha", "b": "Gamma"}  # with no votes anywhere, 7-day views decide


def test_a_pair_travels_in_the_page_address_and_other_parts_of_it_are_kept(js):
    c = js["compare"]
    assert c["parse"][0] == {"a": "Alpha", "b": "Beta"} and c["parse"][1] is None and c["parse"][2] is None and c["parse"][3] is None
    assert c["parse"][4] == {"a": "Dune: Part Two", "b": "Sinners"}
    assert c["merged"] == "?compare=Dune%3A%20Part%20Two~Sinners"
    assert "items=a%2Cb" in c["keeps"] and "compare=A~B" in c["keeps"] and "x=1" in c["keeps"]
    assert c["removes"] == "?x=1" and c["nothing"] == "?x=1" and c["empty"] == ""


def test_the_command_bar_suggests_films_for_both_sides_of_compare(js):
    s = js["compare"]["suggest"]
    assert s["start"] == ["compare Sinners vs "]
    assert s["second"] == ["compare Sinners vs Avatar: Fire and Ash", "compare Sinners vs Avengers: Doomsday"]
    assert s["blank"] == [] and s["ripples"] == ["ripples on", "ripples off"] and "compare " in s["word"]


# ---- click ripples ----

def test_a_click_makes_a_ring_of_glyphs_that_fly_outward_from_the_click(js):
    r = js["ripple"]
    assert r["counts"] == [14, 1] and r["startsAtClick"] is True
    assert 90 <= r["speeds"][0] and r["speeds"][1] <= 170 and 0.5 <= r["ttls"][0] and r["ttls"][1] <= 0.75
    assert r["movesOutward"] is True and r["ringGrows"] > 3
    assert r["allGoneAfterASecond"] == 0


def test_starring_drops_columns_of_code_and_unstarring_pulls_glyphs_in(js):
    on, off = js["ripple"]["starOn"], js["ripple"]["starOff"]
    assert on["glyphs"] == 18 and on["allFall"] and on["xSpread"] and on["staggered"] and on["hasRing"] == 1
    assert off["glyphs"] == 8 and off["allInward"]


def test_particles_fade_out_wait_their_turn_and_are_capped(js):
    r = js["ripple"]
    assert r["fade"][0] == 1 and r["fade"][1] == 0 and r["fade"][2] == 0 and 0 < r["fade"][3] < 0.5
    assert r["waitingStays"] is True
    assert r["cap"] == [160, 40, 5] and r["max"] == 160     # the oldest go first
    assert r["glyph"] == [1, True]
