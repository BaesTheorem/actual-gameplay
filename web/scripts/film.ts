// Film a Pull the Pin or a Save the Clawd level with no browser: play it headless and tile a small
// picture of the world every half second into one PNG, so a run reads as a sequence and not as its
// last frame.
//   npx tsx scripts/film.ts pinPull <level id | path/to/level.json> [--pins p1,p2 | --solution] [--every 0.5] [--out file.png]
//   npx tsx scripts/film.ts saveDog <level id | path/to/level.json> [--solution | --stroke "x,y;x,y;..." | --random N | --dumb name] [--every 0.5] [--out file.png]
//
//   --solution     play the level's stored solution (this is what happens when nothing else is given)
//   --pins a,b     pull these pins in this order instead; "--pins none" pulls nothing
//   --stroke "x,y;x,y"   draw this stroke instead, in canvas points; "|" between two strokes draws both, 0.4 s apart
//   --random 3     draw the audit's random stroke number 3 (the one it calls random:03)
//   --dumb bar     draw one of the audit's naive strokes: drop, bar, wall-left, wall-right or roof
//   --every 0.5    seconds of game time between frames
//   --from 2 --to 4   only the frames between these times, for a close look with a small --every
//   --scale 0.5    size of a frame against the 402 point canvas;  --cols 8  frames to a row
//   --view 40,260  only the band of the canvas between these two heights
//   --out file     where the PNG goes; build/film/<level id>-<pins or stroke>.png when left out
//
// What is drawn for Pull the Pin: stone in grey (a cracked wall has a dashed edge and a zigzag down it, a door is
// tan with a mark toward the way it slides), plates as a bar that drops when pressed, vents green,
// drains dark, grates barred, pins in cream with their ids (a group's pins share a knob colour),
// water teal, lava clay, gas green, the hero H, goblins G, the friend F (an arrow beside the
// letter is a walk and its direction, an x is someone who is out of it), the gem a gold block,
// boulders with a spoke that shows their turn, bombs as crates (dark when plain, rose with a
// spark when lit, blue when soaked) and the exit dashed. Each frame carries its time, a banner
// when a pin was pulled since the frame before, and the names of the moments the simulation
// reported in between. The last frame carries the outcome and its reason.
//
// What is drawn for Save the Clawd: terrain in the colour of its skin (ice is pale blue), water
// teal and lava clay, spikes as teeth, saws as a toothed disc, no-ink zones as a rose wash with a
// dashed edge, props with a spoke or a cross that shows their turn, hives as a gold box with their
// count, flames as a gold tongue in the dashed box they fill, boulders darker than props (a held
// one sits in a bracket under the seconds it has left), bombs as a dark ball with the seconds to
// its blast, the ink (indigo when it is pinned, faint while a saw or a pit takes it, with a gold
// dot at every burning end), Clawd as a clay disc with a C (an x when he is out of it), and every
// bee coloured by what it is doing: rose for a bee with a way in, ochre for one that leans on the
// shield alone, violet for one in a crew, with a small violet ring at the place the crew gave it.
// Each frame carries the level time, the time since the bees came out, how many are out, the
// crew's step (gather, windup, heave, ease) and the names of the moments reported since the
// frame before.
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { Cue } from "../src/sim/clock";
import {
  BOMB_SIZE, FRAME_THICKNESS, FRIEND_RADIUS, HERO_RADIUS, KNOB_OFFSET, LIQUID_RADIUS, PIN_THICKNESS, PLATE_HEIGHT, PinSim, doorRect,
  segmentQuad, type PinLevel, type Rect,
} from "../src/sim/pinpull";
import { DogSim, type DogLevel } from "../src/sim/savedog";
import { DOG_RADIUS, BEE_RADIUS } from "../src/sim/savedog/beecrew";
import { baseTransform } from "../src/sim/savedog/level";
import { WIDTH as INK_WIDTH } from "../src/sim/savedog/stroke";
import { STEP, position, tagOf, type Vec } from "../src/sim/sk";
import { levelFrom } from "./pin-suite";
import { levelFrom as dogLevelFrom, randomStrokes, trials } from "./savedog-suite";

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
};

// The part of the canvas a level uses: all of its width, and from under the floor to over the
// hint. "--view 40,260" films only the band between those two heights, for a level that is small.
// Save the Clawd's hives sit higher than anything in Pull the Pin, so its band is taller.
const band = (option("view") ?? (process.argv[2] === "saveDog" ? "30,790" : "30,760")).split(",").map(Number);
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

// MARK: Save the Clawd

const INDIGO = "#2F3C7A";
const SKINS: Record<string, string> = { grass: "#A9C48F", stone: STONE, dirt: TAN, purple: "#B7A3D1", ice: "#BBD7E4" };
/// What a bee is doing, as a colour: a way in, leaning on the shield alone, or in a crew.
const BEES = { route: ROSE, press: OCHRE, crew: VIOLET };
const path = (points: Vec[], style: string) => `<polyline points="${points.map((p) => `${n(p.x)},${n(Y(p.y))}`).join(" ")}" fill="none" ${style}/>`;

/// One picture of a Save the Clawd level as it stands.
const dogPicture = (sim: DogSim): string => {
  const out: string[] = [];
  out.push(`<rect x="${VIEW.x}" y="${Y(VIEW.y + VIEW.h)}" width="${VIEW.w}" height="${VIEW.h}" fill="${PAPER}"/>`);
  for (const r of sim.forbidden) out.push(rect(r, `fill="${ROSE}" fill-opacity="0.18" stroke="${INK}" stroke-width="1.2" stroke-dasharray="6 4"`));
  for (const pit of sim.liquids) out.push(rect(pit.rect, `fill="${pit.kind === "lava" ? CLAY : TEAL}" fill-opacity="0.8"`));
  for (const item of sim.terrain) {
    const dash = item.solid ? "" : ` stroke-dasharray="3 3" fill-opacity="0.4"`;
    if (item.type === "rect") out.push(rect(item.rect, `fill="${SKINS[item.skin] ?? SKINS.grass}" ${outline}${dash}`));
    else if (item.type === "circle") out.push(circle(item.center, item.radius, `fill="${item.skin === "ice" ? SKINS.ice : STONE}" ${outline}${dash}`));
    else out.push(path(item.points, `stroke="${INK}" stroke-width="${2 * item.halfWidth + 2}" stroke-linecap="round"`), path(item.points, `stroke="${item.skin === "ice" ? SKINS.ice : "#7A4B31"}" stroke-width="${2 * item.halfWidth}" stroke-linecap="round"`));
  }
  for (const f of sim.flames) {
    const tongue = [{ x: f.x + 2, y: f.y }, { x: f.x + f.w - 2, y: f.y }, { x: f.x + f.w, y: f.y + f.h * 0.4 }, { x: f.x + f.w / 2, y: f.y + f.h }, { x: f.x, y: f.y + f.h * 0.4 }];
    out.push(poly(tongue, `fill="${OCHRE}" stroke="${CLAY}" stroke-width="2"`), rect(f, `fill="none" stroke="${CLAY}" stroke-width="1" stroke-dasharray="3 2"`));
  }
  for (const r of sim.spikes) {
    out.push(rect({ x: r.x, y: r.y, w: r.w, h: r.h * 0.4 }, `fill="${STONE}" ${outline}`));
    const teeth: Vec[] = [];
    for (let x = r.x; x <= r.x + r.w + 0.01; x += 6) teeth.push({ x: Math.min(x, r.x + r.w), y: r.y + r.h * (teeth.length % 2 === 0 ? 0.4 : 1) });
    out.push(path(teeth, `stroke="${INK}" stroke-width="1.5"`));
  }
  for (const saw of sim.saws) {
    const c = { x: saw.x, y: saw.y };
    out.push(circle(c, saw.r, `fill="#C9C3D2" ${outline} stroke-dasharray="4 3"`));
    for (const turn of [0, Math.PI / 2]) {
      const a = sim.sawAngle + turn, reach = { x: saw.r * Math.cos(a), y: saw.r * Math.sin(a) };
      out.push(line({ x: c.x - reach.x, y: c.y - reach.y }, { x: c.x + reach.x, y: c.y + reach.y }, `stroke="${INK}" stroke-width="1.2"`));
    }
  }
  for (const hive of sim.hives) {
    out.push(rect({ x: hive.x - 12, y: hive.y - 9, w: 24, h: 18 }, `fill="${OCHRE}" ${outline}`), text({ x: hive.x, y: hive.y }, String(hive.count), 12));
  }
  for (const prop of sim.props) {
    const c = prop.position, a = prop.angle, faint = prop.state === "sunk" ? ` opacity="0.35"` : "";
    if (prop.shape === "ball") {
      out.push(circle(c, prop.radius, `fill="#8C8377" ${outline}${faint}`), line(c, { x: c.x + prop.radius * Math.cos(a), y: c.y + prop.radius * Math.sin(a) }, `stroke="${INK}" stroke-width="1.5"${faint}`));
    } else {
      const corners = turned(c, prop.size.w, prop.size.h, a);
      out.push(poly(corners, `fill="${TAN}" ${outline}${faint}`), line(corners[0], corners[2], `stroke="${INK}" stroke-width="1"${faint}`), line(corners[1], corners[3], `stroke="${INK}" stroke-width="1"${faint}`));
    }
  }
  const seconds = (at: number) => Math.max(0, at - sim.beeClock).toFixed(1);
  for (const rock of sim.rocks) {
    const c = rock.position, a = rock.angle, r = rock.radius, faint = rock.state === "sunk" ? ` opacity="0.35"` : "";
    out.push(circle(c, r, `fill="#6F6C88" ${outline}${faint}`), line(c, { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }, `stroke="${INK}" stroke-width="1.5"${faint}`));
    if (!rock.held) continue;
    out.push(path([{ x: c.x - r - 4, y: c.y + 4 }, { x: c.x - r - 4, y: c.y - r - 4 }, { x: c.x + r + 4, y: c.y - r - 4 }, { x: c.x + r + 4, y: c.y + 4 }], `stroke="${INK}" stroke-width="2.5"`));
    out.push(text({ x: c.x, y: c.y + r + 9 }, seconds(rock.releaseAt), 12));
  }
  for (const bomb of sim.bombs) {
    const c = bomb.position, faint = bomb.state === "sunk" ? ` opacity="0.35"` : "";
    out.push(circle(c, bomb.radius, `fill="#3A3340" ${outline}${faint}`), circle({ x: c.x + 7, y: c.y + 11 }, 3, `fill="${ROSE}"${faint}`));
    out.push(text({ x: c.x, y: c.y + bomb.radius + 10 }, seconds(bomb.blastAt), 12, `fill="${ROSE}"`));
  }
  for (const stroke of sim.strokes) {
    const points = stroke.world, colour = stroke.dynamic ? INK : INDIGO, faint = stroke.state === "live" ? "" : ` opacity="0.3"`;
    if (points.length === 1) out.push(circle(points[0], INK_WIDTH / 2, `fill="${colour}"${faint}`));
    else out.push(path(points, `stroke="${colour}" stroke-width="${INK_WIDTH}" stroke-linecap="round" stroke-linejoin="round"${faint}`));
  }
  for (const ember of sim.embers) out.push(circle(ember, 4, `fill="${OCHRE}" stroke="${CLAY}" stroke-width="1.5"`));
  if (sim.liveStroke.length > 1) out.push(path(sim.liveStroke, `stroke="${INK}" stroke-width="${INK_WIDTH}" stroke-linecap="round" stroke-opacity="0.5"`));
  for (const dog of sim.dogs) {
    const c = dog.position, out_ = dog.mood === "ko";
    out.push(circle(c, DOG_RADIUS, `fill="${out_ ? "#C9C3D2" : CLAY}" ${outline}`), text(c, out_ ? "x" : dog.id.charAt(0).toUpperCase(), 14, `fill="${CREAM}"`));
  }
  for (const bee of sim.bees) {
    const place = bee.mode === "crew" ? sim.swarm.crew.placeOf(bee) : null;
    if (place) out.push(circle(place, 2.5, `fill="none" stroke="${VIOLET}" stroke-width="1"`));
  }
  for (const bee of sim.bees) out.push(circle(bee.position, BEE_RADIUS, `fill="${BEES[bee.mode]}" stroke="${INK}" stroke-width="1"`));
  return out.join("");
};

/// The words on a Save the Clawd frame: the level time, then the bees' own clock and what they are at.
const dogCaption = (sim: DogSim, moments: string[], verdict: string | null): string => {
  let words = `${sim.elapsed.toFixed(2)} s`;
  if (sim.launchedAt !== null) {
    const crew = sim.swarm.crew;
    words += `   bees ${(sim.elapsed - sim.launchedAt).toFixed(1)} s   ${sim.swarm.alive} out`;
    words += crew.active ? `   crew: ${crew.phase}` : sim.routeOpen ? "   way in" : "";
  }
  return `<text x="6" y="16" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" fill="${INK}">${escape(words)}</text>` + caption(sim.elapsed, [], moments, verdict).replace(/^<text[^>]*>[^<]*<\/text>/, "");
};

// MARK: the run

const mode = process.argv[2], ref = process.argv[3];
if ((mode !== "pinPull" && mode !== "saveDog") || !ref) {
  console.error("usage: npx tsx scripts/film.ts pinPull <level id | path/to/level.json> [--pins p1,p2 | --solution] [--every 0.5] [--out file.png]\n"
    + "       npx tsx scripts/film.ts saveDog <level id | path/to/level.json> [--solution | --stroke \"x,y;x,y;...\" | --random N | --dumb name] [--every 0.5] [--out file.png]");
  process.exit(1);
}
const every = Number(option("every") ?? 0.5), scale = Number(option("scale") ?? 0.5), cols = Number(option("cols") ?? 8);
const from = Number(option("from") ?? 0), to = Number(option("to") ?? Infinity);

/// A run as pictures: the frames, the line over them, and the name of the file they go to.
interface Film { frames: string[]; title: string; name: string }

/// Step a simulation to its end and take a picture every `every` seconds, and one more of how it ended.
const shootRun = (sim: { frame(): void; finished: boolean; elapsed: number }, limit: number, shoot: (last: boolean) => void) => {
  let next = Math.max(from, 0);
  if (from <= 0) shoot(false);
  next += every;
  for (let i = 0; i < Math.ceil(limit / STEP) && !sim.finished; i++) {
    sim.frame();
    if (sim.elapsed + 1e-9 >= next && sim.elapsed <= to && !sim.finished) {
      shoot(false);
      next += every;
    }
  }
  shoot(true);
};

const filmPin = (): Film => {
  const level: PinLevel = levelFrom(ref);
  const asked = option("pins");
  const pins = asked === undefined ? level.solution ?? [] : asked === "none" || asked === "" ? [] : asked.split(",");
  const limit = Number(option("seconds") ?? 60);
  // Play it. The moments the simulation reports are kept by name, to be written on the next frame.
  const moments: string[] = [], seen: Cue[] = [];
  const sim = new PinSim(level, (cue) => seen.push(cue));
  sim.replay(pins);
  const frames: string[] = [];
  let pulled = 0, verdict = "";
  shootRun(sim, limit, (last) => {
    const outcome = sim.outcome;
    if (last) verdict = outcome === null ? `NO RESULT in ${limit} s` : outcome.won ? `WON, ${outcome.stars} stars, ${sim.pulled.length} pulled` : `LOST: ${outcome.reason}`;
    for (const cue of seen) if (cue.type === "fx" && cue.name !== "pin" && !moments.includes(cue.name)) moments.push(cue.name);
    seen.length = 0;
    frames.push(picture(sim) + caption(sim.elapsed, sim.pulled.slice(pulled), moments, last ? verdict : null));
    pulled = sim.pulled.length;
    moments.length = 0;
  });
  return {
    frames,
    title: `${level.name} (${level.id})   pins: ${pins.length > 0 ? pins.join(" > ") : "none"}   ${verdict}   ${sim.elapsed.toFixed(2)} s`,
    name: `${level.id}-${pins.length > 0 ? pins.join("+") : "none"}`,
  };
};

const filmDog = (): Film => {
  const level: DogLevel = dogLevelFrom(ref);
  const drawn = option("stroke"), random = option("random"), dumb = option("dumb");
  // What to draw: strokes of the caller's, one of the audit's, or the stored solution.
  let strokes: Vec[][] | null = null, what = "solution";
  if (drawn !== undefined) {
    strokes = drawn.split("|").map((one) => one.split(";").map((pair) => { const [x, y] = pair.split(",").map(Number); return { x, y }; }));
    what = "stroke";
  } else if (random !== undefined) {
    const k = Number(random), found = randomStrokes(level, k + 1)[k];
    if (!found) { console.error(`no random stroke ${random} for ${level.id}`); process.exit(1); }
    strokes = [found.map(([x, y]) => ({ x, y }))];
    what = `random-${String(k).padStart(2, "0")}`;
  } else if (dumb !== undefined) {
    const attempt = trials(level).get(`dumb:${dumb}`);
    if (!attempt || !("strokes" in attempt)) { console.error(`no naive stroke "${dumb}": one of drop, bar, wall-left, wall-right, roof`); process.exit(1); }
    strokes = attempt.strokes;
    what = `dumb-${dumb}`;
  }
  const moments: string[] = [], seen: Cue[] = [];
  const sim = new DogSim(level, (cue) => seen.push(cue));
  if (strokes) sim.replayStrokes(strokes);
  else if (level.solution) sim.replay(level.solution, baseTransform(level));
  // The same wait the replay and the audit give a level, so the film ends where they stop looking.
  const limit = Number(option("seconds") ?? sim.replayWait + 2);
  const frames: string[] = [];
  let verdict = "";
  shootRun(sim, limit, (last) => {
    const outcome = sim.outcome;
    if (last) verdict = outcome === null ? `NO RESULT in ${limit.toFixed(1)} s` : outcome.won ? `WON, ${outcome.stars} stars, ink ${Math.round(sim.inkUsed)}` : `LOST: ${outcome.reason}`;
    for (const cue of seen) {
      // A burning end throws a spark eight times a second, which would fill every frame's line.
      const name = cue.type === "fx" ? cue.name : cue.type === "sound" && cue.name === "heave" ? "heave" : null;
      if (name && name !== "ember" && !moments.includes(name)) moments.push(name);
    }
    seen.length = 0;
    frames.push(dogPicture(sim) + dogCaption(sim, moments, last ? verdict : null));
    moments.length = 0;
  });
  return {
    frames,
    title: `${level.name} (${level.id})   ${what}   ${verdict}   ${sim.elapsed.toFixed(2)} s   bees: rose has a way in, ochre leans, violet is in a crew`,
    name: `${level.id}-${what}`,
  };
};

const film = mode === "saveDog" ? filmDog() : filmPin();

// Tile the frames, under one line that says what was played.
const { frames, title } = film;
const fw = Math.round(VIEW.w * scale), fh = Math.round(VIEW.h * scale), head = 24;
const rows = Math.ceil(frames.length / cols), width = Math.min(cols, frames.length) * fw, height = head + rows * fh;
const tiles = frames.map((frame, i) =>
  `<g transform="translate(${(i % cols) * fw}, ${head + Math.floor(i / cols) * fh}) scale(${scale})"><g clip-path="url(#frame)">${frame}</g><rect x="0" y="0" width="${VIEW.w}" height="${VIEW.h}" fill="none" stroke="${INK}" stroke-width="2"/></g>`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><clipPath id="frame"><rect width="${VIEW.w}" height="${VIEW.h}"/></clipPath></defs><rect width="${width}" height="${height}" fill="${CREAM}"/>`
  + `<text x="6" y="17" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="bold" fill="${INK}">${escape(title)}</text>${tiles.join("")}</svg>`;

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(option("out") ?? join(root, "build/film", `${film.name}.png`));
mkdirSync(dirname(out), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(out);
console.log(`${title}\n${frames.length} frames  ${out}`);
