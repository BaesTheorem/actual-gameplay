#!/usr/bin/env python3
"""Draw the app icon: a pin holding lava above a hero, flat and sharp, no text.

Writes ActualGameplay/Assets.xcassets/AppIcon.appiconset/icon.png at 1024 px.
Drawn at 2x and downsampled so the edges are clean without a browser.
"""
from __future__ import annotations

import math
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "ActualGameplay/Assets.xcassets/AppIcon.appiconset/icon.png"
S = 2  # supersample
BG, INK, LAVA, WATER, WALL = "#111318", "#E2E4EA", "#FF6A3D", "#4FB8FF", "#262A32"


def circle(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float, fill: str) -> None:
    d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=fill)


def rect(d: ImageDraw.ImageDraw, x: float, y: float, w: float, h: float, fill: str) -> None:
    d.rectangle([x * S, y * S, (x + w) * S, (y + h) * S], fill=fill)


def heap(d: ImageDraw.ImageDraw, x0: float, x1: float, y_floor: float, rows: int, r: float, fill: str) -> None:
    """Hex-packed circles resting on y_floor, each row narrower than the one below."""
    dy = r * math.sqrt(3)
    for row in range(rows):
        inset = row * r * 1.6
        left, right = x0 + inset, x1 - inset
        y = y_floor - r - row * dy
        x = left + r + (r if row % 2 else 0)
        while x + r <= right:
            circle(d, x, y, r, fill)
            x += 2 * r


def main() -> None:
    img = Image.new("RGB", (1024 * S, 1024 * S), BG)
    d = ImageDraw.Draw(img)
    # chamber: left wall and floor
    rect(d, 72, 96, 36, 856, WALL)
    rect(d, 72, 916, 880, 36, WALL)
    # lava heaped on the pin
    heap(d, 108, 792, 512, 5, 30, LAVA)
    # the pin, with its knob poking out the right side
    rect(d, 108, 512, 700, 52, INK)
    circle(d, 852, 538, 64, INK)
    # a little water in the corner
    heap(d, 108, 440, 916, 3, 24, WATER)
    # hero standing on the floor, right of the water
    hx = 720
    circle(d, hx, 690, 40, INK)
    rect(d, hx - 22, 740, 44, 110, INK)
    rect(d, hx - 78, 768, 156, 24, INK)
    rect(d, hx - 40, 850, 26, 66, INK)
    rect(d, hx + 14, 850, 26, 66, INK)
    img = img.resize((1024, 1024), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
