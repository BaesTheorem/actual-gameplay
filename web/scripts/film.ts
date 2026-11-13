// Film a Pull the Pin level with no browser: play it headless and tile a small picture of the
// world every half second into one PNG, so a run reads as a sequence and not as its last frame.
//   npx tsx scripts/film.ts pinPull <level id | path/to/level.json> [--pins p1,p2 | --solution] [--every 0.5] [--out file.png]
//
//   --solution     pull the level's stored solution (this is what happens when neither is given)
//   --pins a,b     pull these pins in this order instead; "--pins none" pulls nothing
//   --every 0.5    seconds of game time between frames
//   --from 2 --to 4   only the frames between these times, for a close look with a small --every
//   --scale 0.5    size of a frame against the 402 point canvas;  --cols 8  frames to a row
//   --view 40,260  only the band of the canvas between these two heights
//   --out file     where the PNG goes; build/film/<level id>-<pins>.png when left out
//
// What is drawn: stone in grey (a cracked wall has a dashed edge and a zigzag down it, a door is
// tan with a mark toward the way it slides), plates as a bar that drops when pressed, vents green,
// drains dark, grates barred, pins in cream with their ids (a group's pins share a knob colour),
// water teal, lava clay, gas green, the hero H, goblins G, the friend F (an arrow beside the
// letter is a walk and its direction, an x is someone who is out of it), the gem a gold block,
// boulders with a spoke that shows their turn, bombs as crates (dark when plain, rose with a
// spark when lit, blue when soaked) and the exit dashed. Each frame carries its time, a banner
// when a pin was pulled since the frame before, and the names of the moments the simulation
// reported in between. The last frame carries the outcome and its reason.
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { Cue } from "../src/sim/clock";
import {
  BOMB_SIZE, FRAME_THICKNESS, FRIEND_RADIUS, HERO_RADIUS, KNOB_OFFSET, LIQUID_RADIUS, PIN_THICKNESS, PLATE_HEIGHT, PinSim, doorRect,
  segmentQuad, type PinLevel, type Rect,
} from "../src/sim/pinpull";
import { STEP, position, tagOf, type Vec } from "../src/sim/sk";
import { levelFrom } from "./pin-suite";

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
};

// The part of the canvas a level uses: all of its width, and from under the floor to over the
// hint. "--view 40,260" films only the band between those two heights, for a level that is small.
const band = (option("view") ?? "30,760").split(",").map(Number);
const VIEW = { x: 0, y: band[0], w: 402, h: band[1] - band[0] };
const INK = "#2B2233", PAPER = "#F3EBDC", CREAM = "#FFF5E2", CLAY = "#D97757", SAP = "#6E9F58", SKY = "#8EC3E6";
const TEAL = "#3A9C98", OCHRE = "#E8AA38", ROSE = "#E27A92", VIOLET = "#7B5CA8", NIGHT = "#1F2550", STONE = "#A8A2B2", TAN = "#CDB892";
const PARTICLE = { water: TEAL, lava: CLAY, gas: SAP };
/// The colours of pin groups, in the order the groups first appear in the level.
const GROUPS = [OCHRE, TEAL, ROSE, VIOLET];

const n = (value: number) => (Math.round(value * 10) / 10).toString();
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Shapes are given in canvas points with y up, as the levels are. Y turns a height into a
// distance down the frame.
const Y = (y: number) => VIEW.y + VIEW.h - y;
const rect = (r: Rect, style: string) => `<rect x="${n(r.x)}" y="${n(Y(r.y + r.h))}" width="${n(r.w)}" height="${n(r.h)}" ${style}/>`;
const circle = (c: Vec, r: number, style: string) => `<circle cx="${n(c.x)}" cy="${n(Y(c.y))}" r="${n(r)}" ${style}/>`;
const poly = (points: Vec[], style: string) => `<polygon points="${points.map((p) => `${n(p.x)},${n(Y(p.y))}`).join(" ")}" ${style}/>`;
const line = (a: Vec, b: Vec, style: string) => `<line x1="${n(a.x)}" y1="${n(Y(a.y))}" x2="${n(b.x)}" y2="${n(Y(b.y))}" ${style}/>`;
const text = (at: Vec, words: string, size: number, style = `fill="${INK}"`) =>
  `<text x="${n(at.x)}" y="${n(Y(at.y))}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="bold" text-anchor="middle" dominant-baseline="central" ${style}>${escape(words)}</text>`;
const outline = `stroke="${INK}" stroke-width="1.5"`;
/// A box turned about its middle, for the gem and the crates.
const turned = (c: Vec, w: number, h: number, angle: number): Vec[] =>
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = (sx * w) / 2, y = (sy * h) / 2;
    return { x: c.x + x * Math.cos(angle) - y * Math.sin(angle), y: c.y + x * Math.sin(angle) + y * Math.cos(angle) };
  });

/// One picture of the world as it stands.
const picture = (sim: PinSim): string => {
  const level = sim.level, out: string[] = [];
  out.push(`<rect x="${VIEW.x}" y="${Y(VIEW.y + VIEW.h)}" width="${VIEW.w}" height="${VIEW.h}" fill="${PAPER}"/>`);
  const goal = level.actors.goal;
  if (goal) out.push(rect(goal, `fill="${CLAY}" fill-opacity="0.12" stroke="${CLAY}" stroke-width="1.5" stroke-dasharray="6 4"`), text({ x: goal.x + goal.w / 2, y: goal.y + goal.h - 9 }, "EXIT", 11, `fill="${CLAY}"`));
  for (const r of level.drains ?? []) out.push(rect(r, `fill="${NIGHT}" fill-opacity="0.6" ${outline}`));
  for (const r of level.grates ?? []) {
    out.push(rect(r, `fill="${NIGHT}" fill-opacity="0.25" ${outline}`));
    for (let x = r.x + 5; x < r.x + r.w - 2; x += 8) out.push(line({ x, y: r.y }, { x, y: r.y + r.h }, `stroke="${INK}" stroke-width="1.5"`));
  }
  for (const r of level.vents ?? []) {
    out.push(rect(r, `fill="${SAP}" fill-opacity="0.3" stroke="${SAP}" stroke-width="1.5"`));
    for (let x = r.x + 5; x < r.x + r.w - 2; x += 8) out.push(line({ x, y: r.y }, { x, y: r.y + r.h }, `stroke="${SAP}" stroke-width="1.5"`));
  }
  // Doors go under the walls, so a door that has slid into the stone beside it is hidden by it.
  for (const door of sim.doors) {
    const r = doorRect(door), c = { x: r.x + r.w / 2, y: r.y + r.h / 2 }, s = door.spec.slide;
    const tip = { x: c.x + (s === "left" ? -6 : s === "right" ? 6 : 0), y: c.y + (s === "down" ? -6 : s === "up" ? 6 : 0) };
    out.push(rect(r, `fill="${TAN}" ${outline}`), line({ x: 2 * c.x - tip.x, y: 2 * c.y - tip.y }, tip, `stroke="${INK}" stroke-width="1.5"`), circle(tip, 2.2, `fill="${INK}"`));
  }
  for (const wall of sim.walls()) out.push(rect(wall, `fill="${STONE}" ${outline}`));
  for (const slab of level.slabs ?? []) {
    out.push(poly(segmentQuad({ x: slab.x1, y: slab.y1 }, { x: slab.x2, y: slab.y2 }, (slab.t ?? FRAME_THICKNESS) / 2), `fill="${STONE}" ${outline}`));
  }
  for (const wall of sim.cracked) {
    if (wall.gone) continue;
    const r = wall.rect, along = r.w >= r.h;
    out.push(rect(r, `fill="${STONE}" ${outline} stroke-dasharray="3 2"`));
    // A zigzag down its length: this one can be blown out.
    const points: Vec[] = [];
    for (let i = 0, steps = Math.max(2, Math.round(Math.max(r.w, r.h) / 8)); i <= steps; i++) {
      const t = i / steps, wobble = (i % 2 === 0 ? 0.3 : 0.7);
      points.push(along ? { x: r.x + r.w * t, y: r.y + r.h * wobble } : { x: r.x + r.w * wobble, y: r.y + r.h * t });
    }
    out.push(`<polyline points="${points.map((p) => `${n(p.x)},${n(Y(p.y))}`).join(" ")}" fill="none" stroke="${INK}" stroke-width="1.2"/>`);
  }
  for (const plate of sim.plates) {
    const { spec } = plate;
    out.push(rect({ x: spec.x, y: spec.y, w: spec.w, h: plate.pressed ? 2 : PLATE_HEIGHT }, `fill="${plate.pressed ? SAP : OCHRE}" ${outline}`));
  }
  const groups = [...new Set(sim.pins.map((pin) => pin.group).filter((g) => g !== undefined))];
  for (const pin of sim.pins) {
    if (pin.gone) continue;
    const c = pin.center, w = pin.spec.w, cos = Math.cos(pin.angle), sin = Math.sin(pin.angle);
    const end = (reach: number): Vec => ({ x: c.x + reach * cos, y: c.y + reach * sin });
    const knob = end(pin.direction * (w / 2 + KNOB_OFFSET));
    const colour = pin.group === undefined ? CREAM : GROUPS[groups.indexOf(pin.group) % GROUPS.length];
    out.push(poly(segmentQuad(end(-w / 2), end(w / 2), PIN_THICKNESS / 2), `fill="${CREAM}" ${outline}`));
    out.push(line(end(pin.direction * w / 2), knob, `stroke="${INK}" stroke-width="3"`), circle(knob, 9, `fill="${colour}" ${outline}`));
    out.push(text({ x: Math.min(VIEW.w - 14, Math.max(14, knob.x)), y: knob.y + 17 }, pin.id, 12));
  }
  for (const p of sim.particles) out.push(circle(position(p.body), LIQUID_RADIUS, `fill="${PARTICLE[p.kind]}"`));
  for (const boulder of sim.boulders) {
    const c = position(boulder.body), a = boulder.body.getAngle();
    out.push(circle(c, boulder.radius, `fill="#8C8377" ${outline}`), line(c, { x: c.x + boulder.radius * Math.cos(a), y: c.y + boulder.radius * Math.sin(a) }, `stroke="${INK}" stroke-width="1.5"`));
  }
  for (const bomb of sim.bombs) {
    if (bomb.state === "gone") continue;
    const c = position(bomb.body), fill = bomb.state === "lit" ? ROSE : bomb.state === "wet" ? SKY : "#5B5364";
    out.push(poly(turned(c, BOMB_SIZE, BOMB_SIZE, bomb.body.getAngle()), `fill="${fill}" ${outline}`));
    out.push(text(c, bomb.state === "lit" ? "*" : bomb.state === "wet" ? "~" : "B", 14, `fill="${bomb.state === "dry" ? CREAM : INK}"`));
  }
  if (sim.treasure && !tagOf(sim.treasure).removed && sim.treasureMelting < 0) {
    out.push(poly(turned(position(sim.treasure), 26, 22, sim.treasure.getAngle()), `fill="${OCHRE}" ${outline}`));
  }
  for (const foe of sim.foes) {
    if (foe.gone || foe.state === "sink") continue;
    const c = position(foe.body);
    out.push(circle(c, HERO_RADIUS, `fill="${foe.active ? VIOLET : "#C9C3D2"}" ${outline}`), text(c, foe.active ? (foe.walking ? (foe.facing > 0 ? "G>" : "<G") : "G") : "x", 13, `fill="${CREAM}"`));
  }
  if (sim.friend) {
    const c = position(sim.friend), mark = sim.friendState === "ko" ? "x" : sim.friendState === "happy" ? "F!" : "F";
    out.push(circle(c, FRIEND_RADIUS, `fill="${sim.friendState === "ko" ? "#C9C3D2" : SKY}" ${outline}`), text(c, mark, 12));
  }
  if (sim.hero) {
    const c = position(sim.hero), mark = sim.heroState === "ko" ? "x" : sim.heroWalking ? (sim.heroFacing > 0 ? "H>" : "<H") : "H";
    out.push(circle(c, HERO_RADIUS, `fill="${sim.heroState === "ko" ? "#C9C3D2" : CLAY}" ${outline}`), text(c, mark, 13, `fill="${CREAM}"`));
  }
  return out.join("");
};

/// The words that go on top of a frame: its time, a pull, what happened, and the outcome on the last one.
const caption = (seconds: number, pulls: string[], moments: string[], verdict: string | null): string => {
  const out = [`<text x="6" y="16" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" fill="${INK}">${seconds.toFixed(2)} s</text>`];
  if (pulls.length > 0) {
    out.push(`<rect x="70" y="2" width="${VIEW.w - 76}" height="20" rx="4" fill="${CLAY}"/>`,
      `<text x="${70 + (VIEW.w - 76) / 2}" y="17" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" text-anchor="middle" fill="${CREAM}">PULL ${escape(pulls.join(", "))}</text>`);
  }
  if (moments.length > 0) {
    out.push(`<text x="6" y="${VIEW.h - 8}" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="${INK}">${escape(moments.join(" "))}</text>`);
  }
  if (verdict) {
    const won = verdict.startsWith("WON");
    out.push(`<rect x="6" y="28" width="${VIEW.w - 12}" height="40" rx="5" fill="${CREAM}" stroke="${won ? SAP : ROSE}" stroke-width="3"/>`,
      `<text x="${VIEW.w / 2}" y="53" font-family="Helvetica, Arial, sans-serif" font-size="${verdict.length > 34 ? 13 : 16}" font-weight="bold" text-anchor="middle" fill="${won ? SAP : ROSE}">${escape(verdict)}</text>`);
  }
  return out.join("");
};

const mode = process.argv[2], ref = process.argv[3];
if (mode !== "pinPull" || !ref) {
  console.error("usage: npx tsx scripts/film.ts pinPull <level id | path/to/level.json> [--pins p1,p2 | --solution] [--every 0.5] [--out file.png]");
  process.exit(1);
}
const level: PinLevel = levelFrom(ref);
const asked = option("pins");
const pins = asked === undefined ? level.solution ?? [] : asked === "none" || asked === "" ? [] : asked.split(",");
const every = Number(option("every") ?? 0.5), scale = Number(option("scale") ?? 0.5), cols = Number(option("cols") ?? 8);
const from = Number(option("from") ?? 0), to = Number(option("to") ?? Infinity), limit = Number(option("seconds") ?? 60);

// Play it. The moments the simulation reports are kept by name, to be written on the next frame.
const moments: string[] = [], seen: Cue[] = [];
const sim = new PinSim(level, (cue) => seen.push(cue));
sim.replay(pins);
const frames: string[] = [];
let pulled = 0, next = Math.max(from, 0);
const shoot = (verdict: string | null) => {
  for (const cue of seen) if (cue.type === "fx" && cue.name !== "pin" && !moments.includes(cue.name)) moments.push(cue.name);
  seen.length = 0;
  frames.push(picture(sim) + caption(sim.elapsed, sim.pulled.slice(pulled), moments, verdict));
  pulled = sim.pulled.length;
  moments.length = 0;
};
if (from <= 0) shoot(null);
next += every;
for (let i = 0; i < Math.ceil(limit / STEP) && !sim.finished; i++) {
  sim.frame();
  if (sim.elapsed + 1e-9 >= next && sim.elapsed <= to && !sim.finished) {
    shoot(null);
    next += every;
  }
}
const outcome = sim.outcome;
const verdict = outcome === null ? `NO RESULT in ${limit} s` : outcome.won ? `WON, ${outcome.stars} stars, ${sim.pulled.length} pulled` : `LOST: ${outcome.reason}`;
shoot(verdict);

// Tile the frames, under one line that says what was played.
const fw = Math.round(VIEW.w * scale), fh = Math.round(VIEW.h * scale), head = 24;
const rows = Math.ceil(frames.length / cols), width = Math.min(cols, frames.length) * fw, height = head + rows * fh;
const title = `${level.name} (${level.id})   pins: ${pins.length > 0 ? pins.join(" > ") : "none"}   ${verdict}   ${sim.elapsed.toFixed(2)} s`;
const tiles = frames.map((frame, i) =>
  `<g transform="translate(${(i % cols) * fw}, ${head + Math.floor(i / cols) * fh}) scale(${scale})"><g clip-path="url(#frame)">${frame}</g><rect x="0" y="0" width="${VIEW.w}" height="${VIEW.h}" fill="none" stroke="${INK}" stroke-width="2"/></g>`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><clipPath id="frame"><rect width="${VIEW.w}" height="${VIEW.h}"/></clipPath></defs><rect width="${width}" height="${height}" fill="${CREAM}"/>`
  + `<text x="6" y="17" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="bold" fill="${INK}">${escape(title)}</text>${tiles.join("")}</svg>`;

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(option("out") ?? join(root, "build/film", `${level.id}-${pins.length > 0 ? pins.join("+") : "none"}.png`));
mkdirSync(dirname(out), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(out);
console.log(`${title}\n${frames.length} frames  ${out}`);
