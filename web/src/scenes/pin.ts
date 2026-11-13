// Pull the Pin on screen: the simulation in sim/pinpull.ts, drawn.
import { Container, Filter, GlProgram, Graphics, Rectangle, Sprite, Text, Texture, defaultFilterVert } from "pixi.js";
import * as art from "../app/art";
import type { Cue } from "../sim/clock";
import {
  BOMB_SIZE, FRAME_THICKNESS, FRIEND_RADIUS, HERO_RADIUS, KNOB_OFFSET, LIQUID_RADIUS, PIN_THICKNESS, PinSim, doorRect, segmentQuad, walks,
  type Bomb, type Boulder, type Cracked, type Door, type Foe, type Particle, type PinLevel, type Pin, type Plate, type Rect,
} from "../sim/pinpull";
import { position, tagOf, type Vec } from "../sim/sk";
import {
  ClipSprite, Fx, H, MARKER, Pigment, Puffs, W, Y, hintLabel, paper, reducedMotion, sprite, terrain,
  type BurstOptions, type Scene,
} from "./kit";

export const PIN_ART = [
  "paper_cave", "pin_knob", "gem_yellow", "sign_exit", "clawd_hard_idle", "clawd_hard_ko", "clawd_hard_excited",
  "clawd_foe_idle", "clawd_foe_ko", "terrain_stone_block_center", "terrain_stone_block_top", "terrain_stone_block_left",
  "terrain_stone_block_right", "terrain_stone_block_top_left", "terrain_stone_block_top_right",
  "terrain_stone_horizontal_left", "terrain_stone_horizontal_middle", "terrain_stone_horizontal_right",
];

/// The art one level needs on top of PIN_ART: the clips of whoever walks in it, and the pieces
/// it carries. A level under the first rules needs none of it.
export const pinArt = (level: PinLevel): string[] => {
  if (!walks(level)) return [];
  const names: string[] = [];
  if (level.actors.hero) names.push("clawd_hard_run");
  if ((level.actors.foes ?? []).length > 0) names.push("clawd_foe_run");
  if (level.actors.friend) names.push("clawd_friend_idle", "clawd_friend_happy", "clawd_friend_ko");
  if ((level.boulders ?? []).length > 0) names.push("rock_big");
  if ((level.bombs ?? []).length > 0) names.push("bomb", "bomb_lit_a", "bomb_lit_b", "bomb_wet");
  if ((level.plates ?? []).length > 0) names.push("plate_up", "plate_down");
  return names;
};

/// Each blob sprite extends this many physics radii; two particles merge when they are closer than about two diameters.
const BLOB_SCALE = 3;

/// How long a hint stays up, in seconds, before it fades.
const HINT_SECONDS = 4;

/// The hero's height on screen, in points. The friend is four fifths of it.
const HERO_HEIGHT = 48, FRIEND_HEIGHT = 38;

/// Pins that are pulled together share a colour: on the knob, and in a band across the bar.
/// The first group in the level is ochre, the second teal, then rose, then violet.
const GROUP_COLOURS = [Pigment.ochre, Pigment.teal, Pigment.rose, Pigment.violet];

// What each moment looks like. Small and short: the level has to stay readable through it.
const UP = Math.PI / 2;
const POP: BurstOptions = { count: 5, color: Pigment.cream, shape: "dot", speed: 70, life: 0.28, size: 2.2 };
// Water throws drops the colour of its own rim, so they show against the water as well as the paper.
const SPLASH: BurstOptions = { count: 10, color: Pigment.sky, shape: "drop", speed: 170, life: 0.5, size: 3, gravity: 620, angle: UP, spread: 1.9 };
const STEAM: BurstOptions = { count: 6, color: Pigment.cream, shape: "dot", speed: 45, life: 0.5, size: 3.2, gravity: -90 };
const SPARKS: BurstOptions = { count: 8, color: Pigment.ochre, shape: "star", speed: 130, life: 0.5, size: 3.6, gravity: 160 };
const EMBERS: BurstOptions = { count: 9, color: Pigment.clay, shape: "shard", speed: 150, life: 0.45, size: 3, gravity: 380, angle: UP, spread: 2.6 };
const SCUFFLE: BurstOptions = { count: 7, color: Pigment.violet, shape: "star", speed: 120, life: 0.4, size: 3.2 };
const SEEING_STARS: BurstOptions = { count: 5, color: Pigment.cream, shape: "star", speed: 90, life: 0.4, size: 3, gravity: 120, angle: UP, spread: 2.2 };
const DRIPS: BurstOptions = { count: 6, color: Pigment.ochre, shape: "drop", speed: 80, life: 0.45, size: 2.8, gravity: 420, angle: UP, spread: 2.4 };
// Dust under a foot that sets off, and under a boulder that lands.
const SCUFF: BurstOptions = { count: 4, color: Pigment.cream, shape: "dot", speed: 45, life: 0.3, size: 2.2, gravity: -40, angle: UP, spread: 2.4 };
const DUST: BurstOptions = { count: 7, color: Pigment.cream, shape: "dot", speed: 80, life: 0.4, size: 3, gravity: -30, angle: UP, spread: 2.8 };
const FUSE: BurstOptions = { count: 5, color: Pigment.ochre, shape: "star", speed: 70, life: 0.35, size: 2.6, gravity: 120, angle: UP, spread: 1.8 };
const DAMP: BurstOptions = { count: 5, color: Pigment.sky, shape: "drop", speed: 70, life: 0.4, size: 2.4, gravity: 420, angle: UP, spread: 2.0 };
const BLAST: BurstOptions = { count: 10, color: Pigment.ochre, shape: "shard", speed: 230, life: 0.4, size: 3.6, gravity: 240 };
const RUBBLE: BurstOptions = { count: 6, color: Pigment.stone, shape: "shard", speed: 130, life: 0.5, size: 3.6, gravity: 520, angle: UP, spread: 2.8 };
const FUMES: BurstOptions = { count: 6, color: Pigment.sap, shape: "dot", speed: 40, life: 0.5, size: 3, gravity: -110 };
const CHEER: BurstOptions = { count: 8, color: Pigment.sap, shape: "star", speed: 110, life: 0.5, size: 3.4, gravity: 140 };

/// A white disc whose alpha falls off as (1 - (d/R)^2)^2, peaking at 0.75. The surface shader's cut at
/// 0.5 shows a lone particle at about 0.43 R and merges neighbours whose falloffs overlap.
let blob: Texture | null = null;
const blobTexture = () => {
  if (blob) return blob;
  const size = 64, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!, image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - size / 2) / (size / 2), dy = (y + 0.5 - size / 2) / (size / 2), d2 = dx * dx + dy * dy;
      const i = (y * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = d2 >= 1 ? 0 : Math.round((1 - d2) ** 2 * 0.75 * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  blob = Texture.from(canvas);
  return blob;
};

/// Liquids are drawn as one surface: every particle adds a soft blob to a layer, and this pass
/// keeps the region where the summed blobs pass a threshold. Neighbours merge into one body with a
/// smooth edge and a lighter rim; a lone drop stays a drop.
const SURFACE = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec3 uCore;
uniform vec3 uRim;
void main() {
    vec4 s = texture(uTexture, vTextureCoord);
    float body = smoothstep(0.46, 0.54, s.a);
    float depth = smoothstep(0.54, 0.85, s.a);
    vec3 color = mix(uRim, uCore, depth);
    finalColor = vec4(color * body, body);
}`;
const rgb = (hex: number) => new Float32Array([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]);
const surface = (core: number, rim: number) => new Filter({
  glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: SURFACE }),
  resources: { liquid: { uCore: { value: rgb(core), type: "vec3<f32>" }, uRim: { value: rgb(rim), type: "vec3<f32>" } } },
});
/// Each kind of particle is a surface of its own: its body colour, and the lighter colour of its rim.
const SURFACES: Record<Particle["kind"], [core: number, rim: number]> = {
  water: [Pigment.teal, Pigment.sky], lava: [Pigment.clay, Pigment.ochre], gas: [Pigment.sap, Pigment.cream],
};

export class PinScene implements Scene {
  readonly root = new Container();
  readonly sim: PinSim;
  readonly title: string;
  private cues: Cue[] = [];
  private pinNodes = new Map<Pin, Container>();
  private liquidLayer = new Container();
  private liquids = new Map<Particle["kind"], Container>();
  private blobs = new Map<unknown, Sprite>();
  private hero: ClipSprite | null = null;
  private friend: ClipSprite | null = null;
  private gem: Sprite | null = null;
  private foes = new Map<Foe, ClipSprite>();
  private boulders = new Map<Boulder, Sprite>();
  private bombs = new Map<Bomb, Sprite>();
  private cracked = new Map<Cracked, Container>();
  private doors = new Map<Door, Container>();
  private plates = new Map<Plate, Sprite>();
  private puffs = new Puffs(8);
  private fx = new Fx(9);
  private clips: ClipSprite[] = [];
  private marks: { pin: Pin; node: Container; ring: Graphics }[] = [];
  private markAge = 0;
  /// Only a level that stores its solution can show the way.
  hint?: (step: number) => void;

  /// `label` is the level's place in its chapter, "1-3".
  constructor(readonly level: PinLevel, label: string, private onCue: (cue: Cue) => void) {
    this.title = `${label} ${level.name}`;
    this.sim = new PinSim(level, (cue) => this.cues.push(cue));
    this.root.sortableChildren = true;
    if ((level.solution ?? []).length > 0) this.hint = (step) => this.mark(step);
    this.build();
  }

  private build() {
    // The simulation's copy of the level is the one that is drawn: under the first rules it has
    // none of the newer pieces in it, whatever the file says.
    const { sim, root } = this, level = sim.level;
    root.addChild(paper("paper_cave"));
    for (const d of level.decor ?? []) {
      if (art.exists(d.sprite)) root.addChild(sprite(d.sprite, d.x, d.y, d.w, d.h, 1));
    }
    // Doors lie under the walls, so one that slides into the stone beside it goes out of sight.
    for (const door of sim.doors) {
      const node = this.doorNode(door);
      this.doors.set(door, node);
      root.addChild(node);
    }
    for (const wall of sim.walls()) {
      const node = terrain(wall, "stone");
      node.zIndex = 2;
      root.addChild(node);
    }
    for (const slab of level.slabs ?? []) {
      const quad = segmentQuad({ x: slab.x1, y: slab.y1 }, { x: slab.x2, y: slab.y2 }, (slab.t ?? FRAME_THICKNESS) / 2);
      const g = new Graphics().poly(quad.flatMap((p) => [p.x, Y(p.y)]))
        .fill({ texture: art.texture("terrain_stone_block_center"), textureSpace: "global" })
        .stroke({ color: Pigment.ink, width: 2 });
      g.zIndex = 2;
      root.addChild(g);
    }
    for (const wall of sim.cracked) {
      const node = this.crackedNode(wall.rect);
      this.cracked.set(wall, node);
      root.addChild(node);
    }
    for (const r of level.drains ?? []) {
      const g = new Graphics().rect(r.x, Y(r.y + r.h), r.w, r.h).fill({ color: Pigment.night, alpha: 0.55 }).stroke({ color: Pigment.ink, width: 2 });
      for (let x = r.x; x < r.x + r.w; x += 10) {
        g.moveTo(x, Y(r.y)).lineTo(Math.min(x + r.h, r.x + r.w), Y(Math.min(r.y + r.h, r.y + (r.x + r.w - x))));
      }
      g.stroke({ color: Pigment.ink, width: 1, alpha: 0.7 });
      root.addChild(g);
    }
    for (const r of level.grates ?? []) root.addChild(barred(r, Pigment.night));
    // A vent is a grate for gas: the same bars, over the green of what it takes.
    for (const r of level.vents ?? []) root.addChild(barred(r, Pigment.sap));
    const goal = level.actors.goal;
    if (goal) {
      const g = new Graphics().rect(goal.x, Y(goal.y + goal.h), goal.w, goal.h).fill({ color: Pigment.clay, alpha: 0.12 });
      dashedRect(g, goal.x, Y(goal.y + goal.h), goal.w, goal.h, 7, 5);
      g.stroke({ color: Pigment.clay, width: 2 });
      root.addChild(g, sprite("sign_exit", goal.x + goal.w - 20, goal.y + 16, 30, 30, 1));
    }
    for (const plate of sim.plates) {
      // The painted plate is 48 points wide. It is stretched to the strip, and its foot sits on the floor.
      const node = new Sprite(art.texture("plate_up"));
      node.anchor.set(0.5, 1 - (art.entry("plate_up")?.anchor[1] ?? 0));
      node.position.set(plate.spec.x + plate.spec.w / 2, Y(plate.spec.y));
      node.width = plate.spec.w;
      node.height = 16 * Math.min(1.5, Math.max(0.75, plate.spec.w / 48));
      node.zIndex = 3;
      this.plates.set(plate, node);
      root.addChild(node);
    }
    const groups = [...new Set(sim.pins.map((pin) => pin.group).filter((group) => group !== undefined))];
    for (const pin of sim.pins) {
      const node = this.pinNode(pin, pin.group === undefined ? null : GROUP_COLOURS[groups.indexOf(pin.group) % GROUP_COLOURS.length]);
      this.pinNodes.set(pin, node);
      root.addChild(node);
    }
    // Water under lava, as they have always been drawn. Gas goes over both, and its surface is
    // only made in a level that has gas, so no other level pays for the pass.
    this.liquidLayer.zIndex = 5;
    this.surfaceOf("water");
    this.surfaceOf("lava");
    root.addChild(this.liquidLayer);
    for (const p of sim.particles) this.addBlob(p.body, p.kind);

    if (sim.hero) {
      this.hero = new ClipSprite("clawd_hard_idle", HERO_HEIGHT);
      this.hero.zIndex = 6;
      this.clips.push(this.hero);
      root.addChild(this.hero);
    }
    if (sim.friend) {
      this.friend = new ClipSprite("clawd_friend_idle", FRIEND_HEIGHT);
      this.friend.zIndex = 6;
      this.clips.push(this.friend);
      root.addChild(this.friend);
    }
    if (sim.treasure) {
      this.gem = sprite("gem_yellow", 0, 0, 28, 24, 6);
      root.addChild(this.gem);
    }
    for (const foe of sim.foes) {
      const node = new ClipSprite("clawd_foe_idle", HERO_HEIGHT);
      node.zIndex = 6;
      this.foes.set(foe, node);
      this.clips.push(node);
      root.addChild(node);
    }
    for (const boulder of sim.boulders) {
      // The painted rock fills nine tenths of its picture.
      const node = sprite("rock_big", 0, 0, boulder.radius * 2.2, boulder.radius * 2.2, 6);
      this.boulders.set(boulder, node);
      root.addChild(node);
    }
    for (const bomb of sim.bombs) {
      // The painted bomb is a ball with a fuse standing off it, so its picture is a third larger than the crate.
      const node = sprite("bomb", 0, 0, BOMB_SIZE * 4 / 3, BOMB_SIZE * 4 / 3, 6);
      this.bombs.set(bomb, node);
      root.addChild(node);
    }
    root.addChild(this.puffs.layer, this.fx.layer);
    const hint = hintLabel(level.hint);
    if (hint) root.addChild(hint);
    this.draw(0);
  }

  /// A bar with a knob outside the chamber wall. The knob stays upright on a tilted pin. A pin of
  /// a group wears the group's colour: a band across the bar at the knob's end, and the knob's middle.
  private pinNode(pin: Pin, colour: number | null): Container {
    const node = new Container(), w = pin.spec.w, dir = pin.direction;
    const stem = new Graphics().rect(dir * (w / 2 + KNOB_OFFSET / 2) - KNOB_OFFSET / 2, -3, KNOB_OFFSET, 6)
      .fill(Pigment.cream).stroke({ color: Pigment.ink, width: 2 });
    const bar = new Graphics().roundRect(-w / 2, -PIN_THICKNESS / 2, w, PIN_THICKNESS, 3)
      .fill(Pigment.cream).stroke({ color: Pigment.ink, width: 2 });
    const knob = new Sprite(art.texture("pin_knob"));
    knob.anchor.set(0.5);
    knob.width = knob.height = 30;
    knob.position.set(dir * (w / 2 + KNOB_OFFSET), 0);
    knob.rotation = pin.angle;
    node.addChild(stem, bar, knob);
    if (colour !== null) {
      const band = new Graphics().rect(dir * (w / 2 - 9) - 3, -PIN_THICKNESS / 2 + 1, 6, PIN_THICKNESS - 2).fill(colour).stroke({ color: Pigment.ink, width: 1 });
      const cap = new Graphics().circle(dir * (w / 2 + KNOB_OFFSET), 0, 5.5).fill(colour).stroke({ color: Pigment.ink, width: 1.5 });
      node.addChildAt(band, 2);
      node.addChild(cap);
    }
    node.rotation = -pin.angle;
    node.zIndex = 4;
    return node;
  }

  /// A wall that a blast can take out: the same stone as the others, with cracks inked across it
  /// from end to end so it reads as the one that will break.
  private crackedNode(rect: Rect): Container {
    const node = terrain(rect, "stone");
    const along = rect.w >= rect.h, length = Math.max(rect.w, rect.h), across = Math.min(rect.w, rect.h);
    // In the wall's own frame: u runs along its length and v across it, both from 0.
    const at = (u: number, v: number): [number, number] => (along ? [rect.x + u, Y(rect.y + v)] : [rect.x + v, Y(rect.y + u)]);
    const g = new Graphics();
    // One crack wanders down the middle. It is the same every time, because it is drawn from the wall's own numbers.
    let seed = Math.round(rect.x * 7 + rect.y * 13 + length) >>> 0;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const main: [number, number][] = [];
    for (let u = 0; u <= length + 0.01; u += Math.min(9, length / 3)) main.push([Math.min(u, length), across * (0.3 + 0.4 * random())]);
    g.moveTo(...at(...main[0]));
    for (const point of main.slice(1)) g.lineTo(...at(...point));
    // Short cracks run off it to the edges, on one side and then the other.
    main.slice(1, -1).forEach(([u, v], i) => {
      const edge = i % 2 === 0 ? 0 : across;
      g.moveTo(...at(u, v)).lineTo(...at(u + 3 + 3 * random(), edge + (v - edge) * 0.15));
    });
    g.stroke({ color: Pigment.ink, width: 1.4, cap: "round", join: "round" });
    g.rect(rect.x, Y(rect.y + rect.h), rect.w, rect.h).stroke({ color: Pigment.ink, width: 2 });
    node.addChild(g);
    node.zIndex = 2;
    return node;
  }

  /// A door: stone like the walls, inked round its edge and banded like a gate, so it reads as
  /// the part of the wall that moves.
  private doorNode(door: Door): Container {
    const rect: Rect = door.spec, node = new Container();
    const g = new Graphics().rect(rect.x, Y(rect.y + rect.h), rect.w, rect.h).stroke({ color: Pigment.ink, width: 2 });
    // Two bands across it, a quarter of the way in from each end.
    const tall = rect.h >= rect.w;
    for (const t of [0.25, 0.75]) {
      if (tall) g.rect(rect.x, Y(rect.y + rect.h * t) - 2, rect.w, 4);
      else g.rect(rect.x + rect.w * t - 2, Y(rect.y + rect.h), 4, rect.h);
    }
    g.fill(Pigment.cream).stroke({ color: Pigment.ink, width: 1.5 });
    node.addChild(terrain(rect, "stone"), g);
    node.zIndex = 1.5;
    return node;
  }

  /// The layer one kind of particle is drawn on, made when it is first asked for.
  private surfaceOf(kind: Particle["kind"]): Container {
    let layer = this.liquids.get(kind);
    if (!layer) {
      layer = new Container();
      layer.filters = [surface(...SURFACES[kind])];
      layer.filterArea = new Rectangle(0, 0, W, H);
      this.liquids.set(kind, layer);
      this.liquidLayer.addChild(layer);
    }
    return layer;
  }

  private addBlob(body: unknown, kind: Particle["kind"]) {
    const layer = this.surfaceOf(kind);
    const s = new Sprite(blobTexture());
    s.anchor.set(0.5);
    s.width = s.height = 2 * LIQUID_RADIUS * BLOB_SCALE;
    s.blendMode = "add";
    layer.addChild(s);
    this.blobs.set(body, s);
  }

  readout() { return this.sim.readout; }
  progress() { return null; }
  outcome() { return this.sim.outcome; }

  pointer(type: "down" | "move" | "up", point: Vec) {
    if (type !== "down") return;
    const pin = this.sim.pinAt(point);
    if (pin) this.sim.pull(pin.id);
  }

  step() {
    this.sim.frame();
    for (const cue of this.cues) {
      if (cue.type === "puff") this.puffs.add(cue.x, cue.y);
      else if (cue.type === "fx") this.effect(cue.name, cue.x, cue.y, cue.n);
      else this.onCue(cue);
    }
    this.cues.length = 0;
  }

  /// What the player sees for each moment the simulation reports. `n` is the reach of a blast.
  private effect(name: string, x: number, y: number, n = 0) {
    const fx = this.fx;
    if (name === "pin") fx.burst(x, y, POP);
    else if (name === "splash") fx.burst(x, y, SPLASH);
    else if (name === "steam") { fx.burst(x, y, STEAM); fx.ring(x, y, Pigment.cream); }
    else if (name === "gem") { fx.burst(x, y, SPARKS); fx.ring(x, y, Pigment.ochre); }
    else if (name === "burn") { fx.burst(x, y, EMBERS); fx.shake(5, 0.3); }
    else if (name === "caught") { fx.burst(x, y, SCUFFLE); fx.shake(5, 0.3); }
    else if (name === "knockout") fx.burst(x, y + 6, SEEING_STARS);
    else if (name === "melt") { fx.burst(x, y, DRIPS); fx.ring(x, y, Pigment.clay); }
    else if (name === "win") fx.confetti();
    else if (name === "walk") fx.burst(x, y, SCUFF);
    else if (name === "thud") { fx.burst(x, y, DUST); fx.shake(3, 0.2); }
    else if (name === "fuse") fx.burst(x, y + BOMB_SIZE / 2, FUSE);
    else if (name === "soak") fx.burst(x, y + BOMB_SIZE / 2, DAMP);
    // A blast: pieces thrown out, a ring that opens to the edge of its reach, and a shake.
    else if (name === "blast") { fx.burst(x, y, BLAST); fx.burst(x, y, EMBERS); fx.ring(x, y, Pigment.ochre, n); fx.shake(5, 0.3); }
    else if (name === "rubble") fx.burst(x, y, RUBBLE);
    else if (name === "plateDown" || name === "plateUp") fx.burst(x, y + 4, POP);
    else if (name === "gassed") { fx.burst(x, y, FUMES); fx.ring(x, y, Pigment.sap); }
    else if (name === "friend") { fx.burst(x, y, CHEER); fx.ring(x, y, Pigment.sap); }
    else if (name === "crush") { fx.burst(x, y + 6, SEEING_STARS); fx.shake(5, 0.3); }
    else if (name === "blasted") { fx.burst(x, y, EMBERS); fx.shake(5, 0.3); }
  }

  /// Ring the first `step` pulls of the stored solution, each with its place in the order. A pull
  /// that takes a group rings every pin of the group, all with the same number.
  private mark(step: number) {
    this.clearMarks();
    (this.level.solution ?? []).slice(0, Math.max(1, step)).forEach((id, i) => {
      const named = this.sim.pins.find((p) => p.id === id);
      if (!named) return;
      for (const pin of named.group === undefined ? [named] : this.sim.pins.filter((p) => p.group === named.group)) {
        const at = pin.knob, node = new Container();
        // Ochre over a wider ink line, so the ring has the ink edge everything else has.
        const ring = new Graphics().circle(0, 0, 19).stroke({ color: Pigment.ink, width: 6 }).circle(0, 0, 19).stroke({ color: Pigment.ochre, width: 3.5 });
        const plate = new Graphics().circle(0, 0, 9).fill(Pigment.cream).stroke({ color: Pigment.ink, width: 1.5 });
        const number = new Text({ text: String(i + 1), style: { fontFamily: MARKER, fontSize: 13, fill: Pigment.ink }, resolution: 3 });
        number.anchor.set(0.5);
        const tag = new Container();
        tag.addChild(plate, number);
        // Up and toward the chamber, which is the side with room for it.
        tag.position.set(-pin.direction * 16, -18);
        node.addChild(ring, tag);
        // A knob sits half off the edge of the canvas. The ring keeps to the canvas, so all of it shows.
        node.position.set(Math.min(W - 24, Math.max(24, at.x)), Y(at.y));
        node.zIndex = 32;
        this.root.addChild(node);
        this.marks.push({ pin, node, ring });
      }
    });
    this.markAge = 0;
  }

  private clearMarks() {
    for (const mark of this.marks) mark.node.destroy({ children: true });
    this.marks.length = 0;
  }

  draw(dt: number) {
    const sim = this.sim, short = reducedMotion();
    for (const [pin, node] of this.pinNodes) {
      if (pin.gone) { if (!node.destroyed) node.destroy({ children: true }); this.pinNodes.delete(pin); continue; }
      const c = pin.center;
      node.position.set(c.x, Y(c.y));
    }
    const live = new Set<unknown>();
    for (const p of sim.particles) {
      const s = this.blobs.get(p.body);
      if (!s) continue;
      live.add(p.body);
      const at = position(p.body);
      s.position.set(at.x, Y(at.y));
    }
    if (live.size !== this.blobs.size) {
      for (const [body, s] of this.blobs) if (!live.has(body)) { s.destroy(); this.blobs.delete(body); }
    }
    for (const [door, node] of this.doors) {
      // The node was drawn where the door is when shut. It is moved by as far as the door has slid.
      const now = doorRect(door);
      node.position.set(now.x - door.spec.x, door.spec.y - now.y);
    }
    for (const [wall, node] of this.cracked) {
      if (!wall.gone) continue;
      node.destroy({ children: true });
      this.cracked.delete(wall);
    }
    for (const [plate, node] of this.plates) node.texture = art.texture(plate.pressed ? "plate_down" : "plate_up");
    for (const [boulder, node] of this.boulders) {
      const at = position(boulder.body);
      node.position.set(at.x, Y(at.y));
      node.rotation = -boulder.body.getAngle();
    }
    for (const [bomb, node] of this.bombs) {
      node.visible = bomb.state !== "gone";
      if (!node.visible) continue;
      const at = position(bomb.body);
      node.position.set(at.x, Y(at.y));
      node.rotation = -bomb.body.getAngle();
      // A lit fuse flickers between its two pictures, twelve times a second.
      const flicker = short || Math.floor((sim.elapsed - bomb.since) * 12) % 2 === 0 ? "bomb_lit_a" : "bomb_lit_b";
      node.texture = art.texture(bomb.state === "lit" ? flicker : bomb.state === "wet" ? "bomb_wet" : "bomb");
    }
    if (this.hero && sim.hero) {
      const at = position(sim.hero), since = sim.elapsed - sim.heroStateSince;
      this.hero.position.set(at.x, Y(at.y - HERO_RADIUS));
      let stretch = 1;
      if (sim.heroState === "ko") {
        this.hero.play("clawd_hard_ko");
        // A beat on the knocked-out pose, so the take reads before he goes.
        const t = Math.min(1, Math.max(0, (since - 0.6) / (short ? 0.1 : 0.5)));
        this.hero.clipScale = HERO_HEIGHT / art.size("clawd_hard_idle").h * (1 - 0.8 * t);
        this.hero.alpha = 1 - t;
      } else if (sim.heroState === "excited") {
        this.hero.play("clawd_hard_excited");
        if (!short) stretch = since < 0.1 ? 1 + 1.8 * since : since < 0.22 ? 1.18 - 1.5 * (since - 0.1) : 1;
      } else {
        // He runs while he walks, facing the way he goes.
        this.hero.play(sim.heroWalking ? "clawd_hard_run" : "clawd_hard_idle");
        this.hero.facing = sim.heroFacing;
      }
      this.hero.fit(stretch);
    }
    if (this.friend && sim.friend) {
      const at = position(sim.friend), since = sim.elapsed - sim.friendStateSince;
      this.friend.position.set(at.x, Y(at.y - FRIEND_RADIUS));
      if (sim.friendState === "ko") {
        this.friend.play("clawd_friend_ko");
        const t = Math.min(1, Math.max(0, (since - 0.6) / (short ? 0.1 : 0.5)));
        this.friend.clipScale = FRIEND_HEIGHT / art.size("clawd_friend_idle").h * (1 - 0.8 * t);
        this.friend.alpha = 1 - t;
      } else if (sim.friendState === "happy") {
        this.friend.play("clawd_friend_happy");
      }
      this.friend.fit();
    }
    if (this.gem && sim.treasure) {
      const at = position(sim.treasure);
      this.gem.position.set(at.x, Y(at.y));
      this.gem.rotation = -sim.treasure.getAngle();
      if (sim.treasureMelting >= 0) {
        const t = Math.min(1, (sim.elapsed - sim.treasureMelting) / (short ? 0.1 : 0.5));
        this.gem.tint = Pigment.clay;
        this.gem.width = 28 * (1 - 0.7 * t);
        this.gem.height = 24 * (1 - 0.7 * t);
        this.gem.alpha = 1 - t;
      }
    }
    for (const [foe, node] of this.foes) {
      if (foe.gone) { node.visible = false; continue; }
      const since = sim.elapsed - foe.since;
      if (foe.state !== "sink" && !tagOf(foe.body).removed) {
        const at = position(foe.body);
        node.position.set(at.x, Y(at.y - HERO_RADIUS));
      }
      let t = 0, shrink = 0;
      if (foe.state === "ko") {
        node.play("clawd_foe_ko", false);
        t = Math.min(1, Math.max(0, (since - 0.7) / (short ? 0.1 : 0.4)));
        shrink = 0.4;
      } else if (foe.state === "sink") {
        t = Math.min(1, since / (short ? 0.1 : 0.35));
        shrink = 0.8;
      } else {
        node.play(foe.walking ? "clawd_foe_run" : "clawd_foe_idle");
        node.facing = foe.facing;
      }
      node.clipScale = HERO_HEIGHT / art.size("clawd_foe_idle").h * (1 - shrink * t);
      node.alpha = 1 - t;
      node.fit();
    }
    for (const c of this.clips) c.tick(dt);
    this.puffs.tick(dt, short ? 0.1 : 0.45);
    this.fx.tick(dt);
    this.root.position.set(this.fx.offset.x, this.fx.offset.y);
    if (this.marks.length > 0) {
      this.markAge += dt;
      // The rings pulse for four seconds and then fade. A pin that has been pulled drops its ring.
      const fade = short ? 0.1 : 0.3, left = HINT_SECONDS + fade - this.markAge;
      for (const mark of this.marks) {
        mark.node.visible = !mark.pin.pulled;
        mark.node.alpha = Math.min(1, Math.max(0, left / fade));
        mark.ring.scale.set(short ? 1 : 1 + 0.1 * Math.sin((this.markAge * 2 * Math.PI) / 0.7));
      }
      if (left <= 0) this.clearMarks();
    }
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}

/// An opening with bars across it: a grate over the dark of a drain, or a vent over the green of gas.
const barred = (r: Rect, color: number): Graphics => {
  const g = new Graphics().rect(r.x, Y(r.y + r.h), r.w, r.h).fill({ color, alpha: 0.3 }).stroke({ color: Pigment.ink, width: 2 });
  // The bars cross the short way, so an opening in a wall is barred as one in a floor is.
  if (r.w >= r.h) for (let x = r.x + 5; x < r.x + r.w - 2; x += 8) g.moveTo(x, Y(r.y)).lineTo(x, Y(r.y + r.h));
  else for (let y = r.y + 5; y < r.y + r.h - 2; y += 8) g.moveTo(r.x, Y(y)).lineTo(r.x + r.w, Y(y));
  g.stroke({ color: Pigment.ink, width: 2 });
  g.zIndex = 3;
  return g;
};

/// A dashed rectangle outline, as line segments on `g`.
const dashedRect = (g: Graphics, x: number, y: number, w: number, h: number, on: number, off: number) => {
  const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  let carry = 0, drawing = true;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i], [bx, by] = corners[i + 1];
    const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
    let d = 0;
    while (d < len) {
      const run = Math.min((drawing ? on : off) - carry, len - d);
      if (drawing) g.moveTo(ax + ux * d, ay + uy * d).lineTo(ax + ux * (d + run), ay + uy * (d + run));
      d += run;
      carry += run;
      if (carry >= (drawing ? on : off)) { carry = 0; drawing = !drawing; }
    }
  }
};
