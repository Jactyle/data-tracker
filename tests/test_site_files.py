"""The site is plain files, so check that the files the pages and the service worker name exist."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ["index.html", "browse.html", "trends.html"]


def test_service_worker_only_caches_files_that_exist():
    source = (ROOT / "sw.js").read_text(encoding="utf-8")
    listed = re.findall(r"'([^']+)'", source[source.index("const SHELL"):source.index("];")])
    assert len(listed) > 5
    missing = [name for name in listed if name != "./" and not (ROOT / name).exists()]
    assert missing == []


def test_the_optional_audio_never_blocks_the_service_worker_install():
    source = (ROOT / "sw.js").read_text(encoding="utf-8")
    shell = source[source.index("const SHELL"):source.index("];")]
    assert ".mp3" not in shell, "if the audio fails to download, the whole install would fail"
    audio = re.findall(r"'([^']+\.mp3)'", source[source.index("const AUDIO"):])
    assert audio and all((ROOT / name).exists() for name in audio)
    assert "AUDIO" in source[source.index("DATA.concat"):source.index("DATA.concat") + 40]


def test_pages_load_scripts_and_styles_that_exist():
    for page in PAGES:
        html = (ROOT / page).read_text(encoding="utf-8")
        for name in re.findall(r'(?:src|href)="((?:static/|manifest)[^"]+)"', html):
            assert (ROOT / name).exists(), "%s refers to %s" % (page, name)


def test_every_script_a_page_loads_is_precached_for_offline_use():
    source = (ROOT / "sw.js").read_text(encoding="utf-8")
    for page in PAGES:
        for name in re.findall(r'src="(static/[^"]+\.js)"', (ROOT / page).read_text(encoding="utf-8")):
            assert "'%s'" % name in source, "%s is not in the service worker's list" % name


def test_manifest_icons_exist():
    manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
    assert manifest["icons"]
    for icon in manifest["icons"]:
        assert (ROOT / icon["src"]).exists()


def test_intro_sound_is_a_clean_mp3():
    data = (ROOT / "static" / "intro.mp3").read_bytes()
    assert data[0] == 0xFF and data[1] & 0xE0 == 0xE0, "should start with an MPEG audio frame"
    assert not data.startswith(b"ID3") and data[-128:-125] != b"TAG", "tags and cover art should be stripped"
    assert len(data) < 1_000_000


def load_envelope():
    text = (ROOT / "static" / "intro-envelope.js").read_text(encoding="utf-8")
    return json.loads(text[text.index("{"):text.rindex("}") + 1])


def at(curve, seconds, rate=25):
    return curve[min(len(curve) - 1, int(seconds * rate))]


def test_loudness_curve_is_well_formed():
    env = load_envelope()
    assert env["rate"] == 25
    assert len(env["e"]) == len(env["l"]) == len(env["h"])
    assert 10.5 < len(env["e"]) / env["rate"] < 12      # the opening runs from 13 s to the end of the 24 s track
    for name in ("e", "l", "h"):
        assert all(0 <= value <= 100 for value in env[name])


def test_loudness_curve_follows_the_pacing_of_the_track():
    e = load_envelope()["e"]
    assert max(at(e, t / 25) for t in range(0, 15)) < 25, "the first half second is quiet"
    assert max(at(e, t / 25) for t in range(22, 42)) >= 40, "the first hit comes at about 1 to 1.6 seconds"
    peak = max(range(len(e)), key=lambda i: e[i]) / 25
    assert 10.0 <= peak <= 10.6, "the climax is the loudest moment"
    assert at(e, 8.8) < 40 and at(e, 10.9) < 25, "quiet before the climax and after it"


def test_hits_in_the_track_are_listed_in_order():
    env = load_envelope()
    times = [t for t, _strength in env["onsets"]]
    assert times == sorted(times) and len(times) >= 3
    assert all(0 <= t <= 11 and 0 < strength <= 1 for t, strength in env["onsets"])
    strongest = max(env["onsets"], key=lambda onset: onset[1])
    assert 9.5 <= strongest[0] <= 10.4, "the climax is the strongest hit"


def test_cut_list_removes_only_quiet_stretches_and_keeps_every_hit():
    env = load_envelope()
    segments, e, rate = env["segments"], env["e"], env["rate"]
    assert segments == sorted(segments) and all(a < b for a, b in segments)
    assert all(segments[i][1] < segments[i + 1][0] for i in range(len(segments) - 1)), "the parts must not overlap"
    assert segments[-1][1] <= len(e) / rate + 0.1
    total = sum(b - a for a, b in segments)
    assert 6.5 <= total <= 8.5, "the cuts should make the opening clearly shorter than the full 11 seconds"
    for before, after in zip(segments, segments[1:]):
        end_level, start_level = at(e, before[1], rate), at(e, after[0], rate)
        assert end_level <= 30 and start_level <= 30, "a cut should start and end in a quiet moment"
        assert abs(end_level - start_level) <= 12, "the two sides of a join should be about as loud as each other"
    for time, _strength in env["onsets"]:
        assert any(a <= time <= b for a, b in segments), "a hit at %.2f s would be cut out" % time


def test_ambience_loop_is_a_clean_small_mp3():
    data = (ROOT / "static" / "ambience.mp3").read_bytes()
    assert data[0] == 0xFF and data[1] & 0xE0 == 0xE0, "should start with an MPEG audio frame"
    assert not data.startswith(b"ID3") and data[-128:-125] != b"TAG", "tags and cover art should be left out"
    assert len(data) < 2_000_000, "a page-load of ambience should stay small (the original was 60 MB)"


def test_ambience_is_kept_for_offline_use():
    assert "'static/ambience.mp3'" in (ROOT / "sw.js").read_text(encoding="utf-8")
