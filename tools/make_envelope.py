"""Turn the intro track into the loudness curve that drives the opening animation.

    python tools/make_envelope.py        # needs ffmpeg; rewrites static/intro-envelope.js

It reads static/intro.mp3 from 13 seconds in (where the opening starts) and measures how loud
the track is 25 times a second: overall, in the bass (below 160 Hz) and in the treble (above
3 kHz). It also finds the moments the sound hits (the "onsets"). The animation reads these
numbers instead of listening to the audio, so it follows the pacing exactly and also works when
the sound is muted.

The opening plays only the parts of the track listed in KEEP (seconds after the 13-second start).
The quiet stretches between them are cut out to shorten the wait: the lulls at 2.2 - 3.2 s,
4.8 - 6.9 s and 8.3 - 9.0 s. Every hit and the climax are kept, and each cut starts and ends at a
similar low loudness so the joins are smooth. Both the sound and the animation read this list.
"""
import json
import math
import struct
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
START = 13        # seconds into the track where the opening begins
RATE = 25         # measurements per second
BANDS = {"e": "anull", "l": "lowpass=f=160", "h": "highpass=f=3000"}
KEEP = [[0, 2.2], [3.2, 4.8], [6.9, 8.3], [9.0, 11.2]]   # parts of the track that are played, in seconds


SAMPLE_RATE = 22050


def decode(track, audio_filter):
    """The track from START seconds in, filtered, as a list of samples."""
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", str(START), "-i", str(track), "-af", audio_filter,
                          "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"], capture_output=True, check=True).stdout
    return struct.unpack("<%dh" % (len(raw) // 2), raw), SAMPLE_RATE


def loudness(samples, rate):
    step = rate // RATE
    return [math.sqrt(sum(x * x for x in samples[i:i + step]) / step)
            for i in range(0, len(samples) - step + 1, step)]


def normalise(values, power=0.8):
    top = max(values) or 1
    return [round(100 * (v / top) ** power) for v in values]


def onsets(curve):
    """Moments the sound hits: where a clear rise has climbed a quarter of the way to its peak."""
    found = []
    values = [v / 100 for v in curve]
    window = RATE
    for i in range(2, len(values) - 2):
        peak = values[i]
        if peak < 0.3 or peak < values[i - 1] or peak <= values[i + 1]:
            continue
        before = min(values[max(0, i - window):i])
        if peak - before < 0.15:
            continue
        start = before + (peak - before) / 4
        j = i
        while j > 0 and values[j - 1] > start:
            j -= 1
        found.append([round(j / RATE, 2), round(peak, 2)])
    merged = []
    for t, strength in found:                      # one hit per half second
        if merged and t - merged[-1][0] < 0.5:
            if strength > merged[-1][1]:
                merged[-1] = [t, strength]
        else:
            merged.append([t, strength])
    return merged


def main():
    track = ROOT / "static" / "intro.mp3"
    curves = {}
    for key, audio_filter in BANDS.items():
        samples, rate = decode(track, audio_filter)
        curves[key] = normalise(loudness(samples, rate))
    data = {"rate": RATE, "e": curves["e"], "l": curves["l"], "h": curves["h"], "onsets": onsets(curves["e"]), "segments": KEEP}
    text = ("/* Made by tools/make_envelope.py from static/intro.mp3 (from 13 seconds in). Do not edit by hand.\n"
            " * e, l and h are how loud the track is, 0 to 100, %d times a second: overall, bass and treble.\n"
            " * onsets lists [seconds, strength] for each moment the sound hits.\n"
            " * segments lists [from, to] seconds of the track that the opening plays (the lulls are cut out). */\n"
            "window.INTRO_ENVELOPE = %s;\n") % (RATE, json.dumps(data, separators=(",", ":")))
    (ROOT / "static" / "intro-envelope.js").write_text(text, encoding="utf-8")
    print("%d measurements (%.1f s); onsets: %s" % (len(data["e"]), len(data["e"]) / RATE, data["onsets"]))
    print("plays %.1f s of the %.1f s: %s" % (sum(b - a for a, b in KEEP), len(data["e"]) / RATE, KEEP))
    for a, b in KEEP:
        print("  segment %.1f-%.1f s: loudness at its start %d, at its end %d (0-100)"
              % (a, b, curves["e"][min(len(curves["e"]) - 1, int(a * RATE))], curves["e"][min(len(curves["e"]) - 1, int(b * RATE))]))


if __name__ == "__main__":
    main()
