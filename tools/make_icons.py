"""Draw the app icons (a play button on blue) with the standard library only.

    python tools/make_icons.py

Writes static/icon-192.png and static/icon-512.png. The art fills the whole square and keeps
the play button inside the middle 60%, so the same files work as normal and as "maskable" icons.
"""
import struct
import zlib
from pathlib import Path

BLUE = (28, 92, 171)       # --link in site.css
WHITE = (255, 255, 255)
SAMPLES = 3                # SAMPLES x SAMPLES points per pixel, for smooth edges


def inside_triangle(x, y, a, b, c):
    def sign(p, q, r):
        return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    p = (x, y)
    d1, d2, d3 = sign(p, a, b), sign(p, b, c), sign(p, c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def png(size):
    # A play triangle, centred optically (a little right of centre), inside the safe zone.
    a = (size * 0.40, size * 0.30)
    b = (size * 0.40, size * 0.70)
    c = (size * 0.70, size * 0.50)
    raw = bytearray()
    for py in range(size):
        raw.append(0)  # filter type: none
        for px in range(size):
            hits = 0
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    x, y = px + (sx + 0.5) / SAMPLES, py + (sy + 0.5) / SAMPLES
                    hits += inside_triangle(x, y, a, b, c)
            t = hits / (SAMPLES * SAMPLES)
            raw += bytes(round(BLUE[i] * (1 - t) + WHITE[i] * t) for i in range(3))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "static"
    for size in (192, 512):
        (out / ("icon-%d.png" % size)).write_bytes(png(size))
        print("wrote", out / ("icon-%d.png" % size))
