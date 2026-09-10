#!/usr/bin/env python3
"""Draw the app icon: the dog under a drawn shield with bees on the way. Flat, no text.

Composites the Kenney dog and bee sprites (CC0) over a sky and a grass strip, plus the
player's stroke drawn in code the way the game draws it. Writes the 1024 px icon into the
asset catalog. Drawn at 2x and downsampled so the stroke edges are clean.
"""
from __future__ import annotations

import math
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
ART = ROOT / "ActualGameplay/Art"
OUT = ROOT / "ActualGameplay/Assets.xcassets/AppIcon.appiconset/icon.png"
S = 2
SKY, GRASS, DIRT, INK = "#CDEBF7", "#7BC950", "#8A5A2B", "#F4F6FA"


def paste_sprite(canvas: Image.Image, name: str, center: tuple[float, float], size: int, flip: bool = False) -> None:
    sprite = Image.open(ART / f"{name}.png").convert("RGBA")
    scale = size * S / max(sprite.size)
    sprite = sprite.resize((max(1, int(sprite.width * scale)), max(1, int(sprite.height * scale))), Image.LANCZOS)
    if flip:
        sprite = sprite.transpose(Image.FLIP_LEFT_RIGHT)
    x = int(center[0] * S - sprite.width / 2)
    y = int(center[1] * S - sprite.height / 2)
    canvas.alpha_composite(sprite, (x, y))


def main() -> None:
    img = Image.new("RGBA", (1024 * S, 1024 * S), SKY)
    d = ImageDraw.Draw(img)
    # ground: grass over dirt, flat and sharp
    d.rectangle([0, 860 * S, 1024 * S, 1024 * S], fill=DIRT)
    d.rectangle([0, 860 * S, 1024 * S, 900 * S], fill=GRASS)
    # the shield: a dome drawn in the game's stroke style, feet on the grass
    cx, base, half, height = 512, 862, 300, 330
    points = []
    for i in range(0, 41):
        t = i / 40
        ang = math.pi * (1 - t)
        points.append((cx + half * math.cos(ang), base - height * math.sin(ang) ** 0.9))
    points[0] = (cx - half, base)
    points[-1] = (cx + half, base)
    d.line([(x * S, y * S) for x, y in points], fill=INK, width=56 * S, joint="curve")
    for x, y in (points[0], points[-1]):
        d.ellipse([(x - 28) * S, (y - 28) * S, (x + 28) * S, (y + 28) * S], fill=INK)
    # the dog, sitting on the grass under the shield
    paste_sprite(img, "dog", (512, 745), 250)
    # bees, inbound
    paste_sprite(img, "bee_a", (150, 260), 150, flip=True)
    paste_sprite(img, "bee_b", (880, 190), 130)
    paste_sprite(img, "bee_a", (760, 420), 110)
    img = img.resize((1024, 1024), Image.LANCZOS).convert("RGB")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
