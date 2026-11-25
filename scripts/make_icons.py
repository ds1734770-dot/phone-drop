"""Generate the PhoneDrop app icons (plain PNG, no dependencies).

Run once:  python3 -I scripts/make_icons.py
"""
import os
import struct
import zlib

BG = (13, 15, 18)
ACCENT = (70, 211, 154)


def dist_round_rect(px, py, cx, cy, hw, hh, r):
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    ox, oy = max(qx, 0.0), max(qy, 0.0)
    return (ox * ox + oy * oy) ** 0.5 + min(max(qx, qy), 0.0) - r


def render(size):
    s = size / 180.0
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            px, py = (x + 0.5) / s, (y + 0.5) / s
            # mic capsule + stand, drawn as accent on the dark tile
            capsule = dist_round_rect(px, py, 90, 74, 20, 36, 20)
            cradle = abs(dist_round_rect(px, py, 90, 78, 42, 40, 40)) - 4.5
            cradle = max(cradle, -(py - 78))  # keep only the lower half
            stem = dist_round_rect(px, py, 90, 134, 3, 10, 3)
            base = dist_round_rect(px, py, 90, 146, 18, 3, 3)
            d = min(capsule, cradle, stem, base)
            a = max(0.0, min(1.0, 0.5 - d * s))
            r = int(BG[0] + (ACCENT[0] - BG[0]) * a)
            g = int(BG[1] + (ACCENT[1] - BG[1]) * a)
            b = int(BG[2] + (ACCENT[2] - BG[2]) * a)
            row += bytes((r, g, b))
        rows.append(bytes(row))
    return b"".join(rows)


def png(size):
    raw = render(size)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
for size in (180, 512):
    with open(os.path.join(out, f"icon-{size}.png"), "wb") as f:
        f.write(png(size))
    print("wrote icon", size)
