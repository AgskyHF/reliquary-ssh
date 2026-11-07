#!/usr/bin/env python3
"""Generates the application icon.

The icon is drawn from scratch — no image tooling is installed on this
machine, so the PNG is written by hand (zlib + struct) and converted to
.icns with sips, which macOS ships with.

Run: python3 scripts/make-icon.py
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "build"
SIZE = 1024

# The "R" of ReliquarySSH, as a 5x7 bitmap. 1 = ink.
GLYPH = [
    "11110",
    "10001",
    "10001",
    "11110",
    "10100",
    "10010",
    "10001",
]

BG_TOP = (0x2B, 0x33, 0x3E)
BG_BOTTOM = (0x1B, 0x20, 0x27)
INK = (0xD7, 0xDD, 0xE5)
ACCENT = (0x38, 0x8B, 0xFD)


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def blend(base: tuple[int, int, int], top: tuple[int, int, int], alpha: float) -> tuple[int, int, int]:
    return (lerp(base[0], top[0], alpha), lerp(base[1], top[1], alpha), lerp(base[2], top[2], alpha))


def rounded_rect_alpha(x: float, y: float, size: int, radius: float) -> float:
    """Coverage of a rounded square at the pixel (x, y)."""
    inset = size * 0.06
    lo, hi = inset, size - inset
    cx = min(max(x, lo + radius), hi - radius)
    cy = min(max(y, lo + radius), hi - radius)
    dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5

    if lo <= x <= hi and lo <= y <= hi:
        if dist <= radius:
            return 1.0
        # Outside the corner circles but still inside the box.
        return 0.0

    # Outside the box — the corner rounding.
    if x < lo or x > hi or y < lo or y > hi:
        if dist <= radius:
            return 1.0
        return 0.0
    return 0.0


def glyph_coverage(px: float, py: float, cx: float, cy: float, cell: float) -> float:
    """Coverage of the letter at a pixel, sampled 3x3."""
    hits = 0
    samples = 3
    for sx in range(samples):
        for sy in range(samples):
            x = px + (sx + 0.5) / samples * cell
            y = py + (sy + 0.5) / samples * cell
            col = int((x - cx) / cell)
            row = int((y - cy) / cell)
            if 0 <= row < len(GLYPH) and 0 <= col < len(GLYPH[0]):
                if GLYPH[row][col] == "1":
                    hits += 1
    return hits / (samples * samples)


def render() -> bytes:
    rows = []
    cell = SIZE * 0.052
    glyph_w = len(GLYPH[0]) * cell
    glyph_h = len(GLYPH) * cell
    cx = SIZE / 2
    cy = SIZE / 2
    origin_x = cx - glyph_w / 2
    origin_y = cy - glyph_h / 2

    for y in range(SIZE):
        row = bytearray()
        t = y / (SIZE - 1)
        base = blend(BG_TOP, BG_BOTTOM, t)
        for x in range(SIZE):
            alpha = rounded_rect_alpha(x + 0.5, y + 0.5, SIZE, SIZE * 0.22)
            color = base

            # The accent bar under the letter.
            bar_top = origin_y + glyph_h + cell * 0.6
            bar_bottom = bar_top + cell * 0.5
            if origin_x - cell <= x <= origin_x + glyph_w + cell:
                if bar_top <= y <= bar_bottom:
                    color = blend(color, ACCENT, 1.0)

            # The letter itself.
            if origin_x <= x <= origin_x + glyph_w and origin_y <= y <= origin_y + glyph_h:
                cover = glyph_coverage(x, y, origin_x, origin_y, cell)
                if cover > 0:
                    color = blend(color, INK, cover)

            row += bytes(color) + bytes([round(alpha * 255)])
        rows.append(bytes(row))
    return b"".join(b"\x00" + row for row in rows)


def write_png(path: Path, raw: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    png = OUT_DIR / "icon.png"
    write_png(png, render())
    print(f"wrote {png} ({png.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
