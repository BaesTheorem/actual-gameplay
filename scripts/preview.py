#!/usr/bin/env python3
"""Draw a level file as an annotated picture, without the simulator.

The level JSON is numbers; this turns it into something to look at in a few milliseconds, with the
things that decide whether a level works drawn on top: where liquid will fall, how far a shelf is
from a compartment wall, where a stroke rests on something solid, how much ink a solution spends,
and which openings a bee could fit through. It is the sketchbook; the replay is the proof.

    scripts/preview.py pinPull            all twelve pin levels as one contact sheet
    scripts/preview.py saveDog 03 07      just those, one image each plus the sheet
    scripts/preview.py pinPull --out build/preview

Images land in build/preview/<mode>-NN.png and build/preview/<mode>-sheet.png.
"""
from __future__ import annotations

import json
import math
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
LEVELS = ROOT / "ActualGameplay/Levels"
W, H = 402, 874                      # the game's canvas, origin bottom-left
SCALE = 2                            # pixels per point in the picture
FONT = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 11 * SCALE // 2 + 5)
SMALL = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 9 * SCALE // 2 + 4)

INK = (43, 34, 51)
PAPER = (243, 235, 220)
GRID = (215, 205, 190)
WALL = (140, 138, 160)
WATER = (58, 156, 152)
LAVA = (217, 119, 87)
HERO = (110, 159, 88)
GEM = (232, 170, 56)
DRAIN = (31, 37, 80)
GRATE = (120, 120, 150)
GOAL = (217, 119, 87)
PIN = (255, 245, 226)
BEE = (232, 170, 56)
STROKE = (43, 34, 51)
FORBID = (226, 122, 146)
NOTE = (168, 77, 51)
OK = (78, 122, 60)


def sy(y: float) -> float:
    """Game y (up) to picture y (down)."""
    return (H - y) * SCALE


def sx(x: float) -> float:
    return x * SCALE


def rect(d: ImageDraw.ImageDraw, x, y, w, h, fill=None, outline=INK, width=2):
    d.rectangle([sx(x), sy(y + h), sx(x + w), sy(y)], fill=fill, outline=outline, width=width)


def label(d: ImageDraw.ImageDraw, x, y, text, fill=INK, font=SMALL, anchor="la"):
    d.text((sx(x), sy(y)), text, fill=fill, font=font, anchor=anchor)


def canvas(title: str, subtitle: str = "") -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGB", (W * SCALE, H * SCALE), PAPER)
    d = ImageDraw.Draw(im)
    for x in range(0, W + 1, 50):
        d.line([sx(x), 0, sx(x), H * SCALE], fill=GRID, width=1)
        label(d, x + 1, H - 2, str(x), fill=GRID)
    for y in range(0, H + 1, 50):
        d.line([0, sy(y), W * SCALE, sy(y)], fill=GRID, width=1)
        label(d, 1, y + 12, str(y), fill=GRID)
    d.rectangle([0, sy(814), W * SCALE, sy(34)], outline=(180, 170, 160), width=1)   # the playfield
    d.text((sx(6), sy(870)), title, fill=INK, font=FONT)
    if subtitle:
        d.text((sx(6), sy(856)), subtitle, fill=NOTE, font=SMALL)
    return im, d


# ---------------------------------------------------------------- Pull the Pin

def pin_surfaces(level: dict) -> list[tuple[float, float, float, str]]:
    """Horizontal surfaces liquid can land on: (x0, x1, top y, what)."""
    out: list[tuple[float, float, float, str]] = [(24.0, 378.0, 68.0, "floor")] if level.get("frame", True) else []
    for w in level.get("walls", []) or []:
        out.append((w["x"], w["x"] + w["w"], w["y"] + w["h"], "wall"))
    for p in level["pins"]:
        out.append((p["x"], p["x"] + p["w"], p["y"] + 14, f"pin {p['id']}"))
    for s in level.get("slabs", []) or []:
        lo, hi = sorted([s["x1"], s["x2"]])
        out.append((lo, hi, max(s["y1"], s["y2"]), "slab"))
    return out


def first_surface_below(level: dict, x: float, y: float, skip: str | None = None):
    best = None
    for x0, x1, top, what in pin_surfaces(level):
        if what == skip:
            continue
        if x0 <= x <= x1 and top <= y and (best is None or top > best[0]):
            best = (top, what)
    return best


def draw_pin(level: dict) -> Image.Image:
    par = level.get("parPins", 1)
    im, d = canvas(f"{level['id']} {level['name']}   par {par}   {level.get('winWhen')}",
                   "solution " + " > ".join(level.get("solution") or []))
    if level.get("frame", True):
        for x, y, w, h in ((24, 54, 14, 660), (364, 54, 14, 660), (24, 54, 354, 14)):
            rect(d, x, y, w, h, fill=WALL, outline=INK, width=1)
    for w in level.get("walls", []) or []:
        rect(d, w["x"], w["y"], w["w"], w["h"], fill=WALL, outline=INK, width=1)
    for s in level.get("slabs", []) or []:
        d.line([sx(s["x1"]), sy(s["y1"]), sx(s["x2"]), sy(s["y2"])], fill=WALL, width=int((s.get("t") or 14) * SCALE))
        d.line([sx(s["x1"]), sy(s["y1"]), sx(s["x2"]), sy(s["y2"])], fill=INK, width=2)
    for g in level.get("grates", []) or []:
        rect(d, g["x"], g["y"], g["w"], g["h"], fill=GRATE, outline=INK, width=1)
        label(d, g["x"] + 2, g["y"] + g["h"] + 12, "grate: liquid dies, solids pass", fill=INK)
    for g in level.get("drains", []) or []:
        rect(d, g["x"], g["y"], g["w"], g["h"], fill=DRAIN, outline=INK, width=1)
        label(d, g["x"] + 2, g["y"] + g["h"] + 12, "drain: liquid and gem die", fill=DRAIN)
    goal = level["actors"].get("goal")
    if goal:
        rect(d, goal["x"], goal["y"], goal["w"], goal["h"], outline=GOAL, width=2)
        label(d, goal["x"] + 3, goal["y"] + goal["h"] - 3, "GOAL", fill=GOAL, font=FONT)
    # pools, and where each one falls once its pin goes
    for pool in level.get("pools", []) or []:
        col = WATER if pool["liquid"] == "water" else LAVA
        rect(d, pool["x"], pool["y"], pool["w"], pool["h"], fill=col, outline=INK, width=1)
        label(d, pool["x"] + 2, pool["y"] + pool["h"] + 12, f"{pool['liquid']} {pool['count']}", fill=col, font=FONT)
        holder = None
        for p in level["pins"]:
            if p["x"] <= pool["x"] + pool["w"] / 2 <= p["x"] + p["w"] and abs(p["y"] + 14 - pool["y"]) < 2:
                holder = p["id"]
        if holder:
            cx = pool["x"] + pool["w"] / 2
            below = first_surface_below(level, cx, pool["y"] - 1, skip=f"pin {holder}")
            if below:
                top, what = below
                d.line([sx(cx), sy(pool["y"]), sx(cx), sy(top)], fill=col, width=2)
                for xx in (pool["x"] + 4, pool["x"] + pool["w"] - 4):
                    d.line([sx(xx), sy(pool["y"]), sx(xx), sy(top)], fill=col, width=1)
                label(d, cx + 4, (pool["y"] + top) / 2, f"{holder} pulled: falls {pool['y'] - top:.0f} to {what}", fill=col)
    for p in level["pins"]:
        rect(d, p["x"], p["y"], p["w"], 14, fill=PIN, outline=INK, width=2)
        kx = p["x"] - 26 if p["side"] == "left" else p["x"] + p["w"] + 26
        d.ellipse([sx(kx) - 11 * SCALE, sy(p["y"] + 7) - 11 * SCALE, sx(kx) + 11 * SCALE, sy(p["y"] + 7) + 11 * SCALE], fill=PIN, outline=INK, width=2)
        order = (level.get("solution") or [])
        tag = p["id"] + (f" #{order.index(p['id']) + 1}" if p["id"] in order else "")
        label(d, p["x"] + 4, p["y"] + 12, tag, fill=INK, font=FONT)
    hero = level["actors"].get("hero")
    if hero:
        d.ellipse([sx(hero["x"]) - 16 * SCALE, sy(hero["y"]) - 16 * SCALE, sx(hero["x"]) + 16 * SCALE, sy(hero["y"]) + 16 * SCALE], fill=HERO, outline=INK, width=2)
        label(d, hero["x"] + 18, hero["y"] + 4, "hero", fill=HERO, font=FONT)
    t = level["actors"].get("treasure")
    if t:
        rect(d, t["x"] - 14, t["y"] - 12, 28, 24, fill=GEM, outline=INK, width=2)
        label(d, t["x"] + 16, t["y"] + 4, "gem", fill=GEM, font=FONT)
        below = first_surface_below(level, t["x"], t["y"] - 13)
        if below:
            label(d, t["x"] + 16, t["y"] - 10, f"rests on {below[1]}", fill=INK)
        # the nearest lava on the same shelf, and the divider between them
        for pool in level.get("pools", []) or []:
            if pool["liquid"] == "lava" and abs(pool["y"] - (t["y"] - 12)) < 3:
                gap = pool["x"] - (t["x"] + 14) if pool["x"] > t["x"] else (t["x"] - 14) - (pool["x"] + pool["w"])
                between = [w for w in level.get("walls", []) or [] if min(t["x"], pool["x"]) < w["x"] < max(t["x"], pool["x"]) and w["y"] <= t["y"] <= w["y"] + w["h"]]
                note = f"lava {gap:.0f} pt away on the same shelf, " + ("divider between" if between else "NO DIVIDER")
                label(d, 40, t["y"] - 28, note, fill=OK if between else NOTE, font=FONT)
    n = sum(p["count"] for p in level.get("pools", []) or [])
    label(d, 6, 842, f"particles {n}/320   pins {len(level['pins'])}", fill=INK)
    return im


# ---------------------------------------------------------------- Save the Clawd

def stroke_length(points) -> float:
    return sum(math.dist(points[i], points[i + 1]) for i in range(len(points) - 1))


def draw_dog(level: dict) -> Image.Image:
    sol = level.get("solution") or {}
    strokes = sol.get("strokes") or []
    ink = sum(stroke_length(s["points"]) for s in strokes)
    stars = level.get("stars", [0, 0])
    im, d = canvas(f"{level['id']} {level['name']}   ink {level.get('inkBudget')}   stars <= {stars[0]} / {stars[1]}",
                   f"solution: {len(strokes)} stroke(s), {ink:.0f} ink ({'3 stars' if ink <= stars[0] else '2 stars' if ink <= stars[1] else '1 star'})")
    solids = []   # rects a stroke can rest on
    for s in level.get("statics", []) or []:
        if s["type"] == "rect":
            rect(d, s["x"], s["y"], s["w"], s["h"], fill=WALL if s.get("skin") != "grass" else (169, 196, 143), outline=INK, width=1)
            solids.append((s["x"], s["y"], s["w"], s["h"]))
        elif s["type"] == "circle":
            d.ellipse([sx(s["x"] - s["r"]), sy(s["y"] + s["r"]), sx(s["x"] + s["r"]), sy(s["y"] - s["r"])], fill=WALL, outline=INK, width=1)
        elif s["type"] == "chain":
            pts = [(sx(x), sy(y)) for x, y in s["points"]]
            d.line(pts, fill=INK, width=3)
    for k in level.get("killers", []) or []:
        rect(d, k["x"], k["y"], k["w"], k["h"], fill=FORBID, outline=INK, width=1)
        label(d, k["x"] + 2, k["y"] + k["h"] + 12, "spikes", fill=FORBID)
    for s in level.get("saws", []) or []:
        d.ellipse([sx(s["x"] - s["r"]), sy(s["y"] + s["r"]), sx(s["x"] + s["r"]), sy(s["y"] - s["r"])], outline=NOTE, width=3)
        label(d, s["x"] + s["r"] + 2, s["y"], "saw: cuts ink", fill=NOTE)
    for p in level.get("props", []) or []:
        if p.get("type") == "ball":
            d.ellipse([sx(p["x"] - p["r"]), sy(p["y"] + p["r"]), sx(p["x"] + p["r"]), sy(p["y"] - p["r"])], outline=INK, width=2)
        else:
            rect(d, p["x"] - p.get("w", 30) / 2, p["y"] - p.get("h", 30) / 2, p.get("w", 30), p.get("h", 30), outline=INK, width=2)
        label(d, p["x"], p["y"], p.get("type", "prop"), fill=INK, anchor="mm")
    for f in level.get("forbidden", []) or []:
        rect(d, f["x"], f["y"], f["w"], f["h"], outline=FORBID, width=1)
        label(d, f["x"] + 2, f["y"] + f["h"] - 2, "no ink", fill=FORBID)
    for hv in level.get("hives", []) or []:
        d.ellipse([sx(hv["x"]) - 10 * SCALE, sy(hv["y"]) - 10 * SCALE, sx(hv["x"]) + 10 * SCALE, sy(hv["y"]) + 10 * SCALE], fill=BEE, outline=INK, width=2)
        label(d, hv["x"] + 12, hv["y"] + 4, f"hive x{hv['count']}" + (f" +{hv['delay']}s" if hv.get("delay") else ""), fill=NOTE, font=FONT)
    for dog in level.get("dogs", []) or []:
        d.ellipse([sx(dog["x"]) - 18 * SCALE, sy(dog["y"]) - 18 * SCALE, sx(dog["x"]) + 18 * SCALE, sy(dog["y"]) + 18 * SCALE], fill=LAVA, outline=INK, width=2)
        label(d, dog["x"] + 20, dog["y"] + 4, dog.get("id", "clawd"), fill=INK, font=FONT)
    # the stored solution, with its support points
    for i, s in enumerate(strokes):
        pts = s["points"]
        d.line([(sx(x), sy(y)) for x, y in pts], fill=STROKE, width=8 * SCALE // 2 + 3, joint="curve")
        x0, y0 = pts[0]
        label(d, x0, y0 + 14, f"s{i + 1} {stroke_length(pts):.0f} ink" + (f" @{s['delay']}s" if s.get("delay") else ""), fill=NOTE, font=FONT)
        for x, y in pts:
            for rx, ry, rw, rh in solids:
                if rx - 6 <= x <= rx + rw + 6 and abs(y - 4 - (ry + rh)) <= 14:
                    d.ellipse([sx(x) - 8, sy(y) - 8, sx(x) + 8, sy(y) + 8], outline=OK, width=3)
    # gaps a bee (radius 6, so 12 pt) could pass beside the dog at dog height: the horizontal scan
    for dog in level.get("dogs", []) or []:
        y = dog["y"]
        blocked = []
        for rx, ry, rw, rh in solids:
            if ry <= y <= ry + rh:
                blocked.append((rx, rx + rw))
        for s in strokes:
            xs = [p[0] for p in s["points"]]
            ys = [p[1] for p in s["points"]]
            if min(ys) - 4 <= y <= max(ys) + 4:
                blocked.append((min(xs) - 4, max(xs) + 4))
        blocked.sort()
        free = []
        cur = 0
        for a, b in blocked:
            if a - cur >= 12:
                free.append((cur, a))
            cur = max(cur, b)
        if W - cur >= 12:
            free.append((cur, W))
        d.line([sx(0), sy(y), sx(W), sy(y)], fill=(200, 190, 175), width=1)
        for a, b in free:
            d.line([sx(a), sy(y), sx(b), sy(y)], fill=NOTE, width=2)
        label(d, 6, y + 14, f"open at his height: {', '.join(f'{a:.0f}-{b:.0f}' for a, b in free) or 'sealed'}", fill=NOTE)
    bees = sum(h["count"] for h in level.get("hives", []) or [])
    label(d, 6, 842, f"bees {bees}   duration {level.get('duration', 10)}s   pinned ink {level.get('pinnedInk', False)}", fill=INK)
    return im


# ---------------------------------------------------------------- main

def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = ROOT / "build/preview"
    if "--out" in sys.argv:
        out = pathlib.Path(sys.argv[sys.argv.index("--out") + 1])
    mode = args[0] if args else "pinPull"
    folder = "pinpull" if mode == "pinPull" else "savedog"
    only = set(args[1:])
    out.mkdir(parents=True, exist_ok=True)
    images = []
    for path in sorted((LEVELS / folder).glob("*.json")):
        level = json.loads(path.read_text())
        if only and level["id"] not in only:
            continue
        im = draw_pin(level) if mode == "pinPull" else draw_dog(level)
        im.save(out / f"{mode}-{level['id']}.png")
        images.append(im)
    if not images:
        raise SystemExit("no levels matched")
    cols = min(4, len(images))
    rows = math.ceil(len(images) / cols)
    thumb = (W * SCALE // 2, H * SCALE // 2)
    sheet = Image.new("RGB", (cols * (thumb[0] + 8), rows * (thumb[1] + 8)), (60, 55, 65))
    for i, im in enumerate(images):
        sheet.paste(im.resize(thumb, Image.Resampling.LANCZOS), ((i % cols) * (thumb[0] + 8) + 4, (i // cols) * (thumb[1] + 8) + 4))
    sheet.save(out / f"{mode}-sheet.png")
    print(f"{len(images)} level(s) -> {out}/{mode}-sheet.png")


if __name__ == "__main__":
    main()
