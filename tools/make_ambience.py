"""Cut the background ambience loop used on every page from the long original.

    python tools/make_ambience.py path/to/background.mp3     # needs ffmpeg; writes static/ambience.mp3

The original is about 54 minutes and 60 MB, far too big for a web page. This takes a calm stretch of
LENGTH seconds starting at START, crossfades its end into its start (so the loop has no seam when it
repeats), re-encodes it at 112 kbps, and leaves out the tags and cover art.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
START = 1924      # where in the original the loop begins, in seconds (a steady stretch at 32:04)
LENGTH = 90       # length of the finished loop, in seconds
FADE = 4          # how long the end is blended into the start, in seconds


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    source = sys.argv[1]
    # Read LENGTH + FADE seconds. The first FADE seconds (head) are blended with the FADE seconds that follow
    # the loop (tail); the rest of the loop (body) follows. Played in a circle, the tail leads into the head.
    graph = ("[0:a]asplit=3[h][b][t];"
             "[h]atrim=0:{f},asetpts=PTS-STARTPTS[head];"
             "[b]atrim={f}:{n},asetpts=PTS-STARTPTS[body];"
             "[t]atrim={n}:{m},asetpts=PTS-STARTPTS[tail];"
             "[tail][head]acrossfade=d={f}:c1=qsin:c2=qsin[blend];"
             "[blend][body]concat=n=2:v=0:a=1[out]").format(f=FADE, n=LENGTH, m=LENGTH + FADE)
    target = ROOT / "static" / "ambience.mp3"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(START), "-t", str(LENGTH + FADE), "-i", source,
                    "-filter_complex", graph, "-map", "[out]", "-map_metadata", "-1", "-vn",
                    "-c:a", "libmp3lame", "-b:a", "112k", "-write_id3v2", "0", str(target)], check=True)
    data = target.read_bytes()
    if data[:3] == b"ID3":                       # ffmpeg still writes a tiny tag; take it off
        size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        data = data[10 + size:]
        target.write_bytes(data)
    print("wrote %s (%.2f MB, %d seconds)" % (target, len(data) / 1e6, LENGTH))


if __name__ == "__main__":
    main()
