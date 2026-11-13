// Number Tower on screen: the simulation in sim/tower.ts, drawn. The scene holds no rules and no
// score. Every frame it reads the simulation (which rooms are options, which are cleared, the
// beat that is playing and how far it has run) and draws that.
import { Container, Graphics, Matrix, Sprite, Text } from "pixi.js";
import * as art from "../app/art";
import type { Cue } from "../sim/clock";
import { STEP, type Vec } from "../sim/sk";
import { EXPLAINERS, TowerSim, type Beat, type Explained, type Room, type Thing, type TowerLevel } from "../sim/tower";
import {
  ClipSprite, Fx, MARKER, Pigment, W, Y, hintLabel, paper, reducedMotion, terrain,
  type BurstOptions, type Scene,
} from "./kit";
import {
  GROUND, LADDER, LIP, MERLON, PLINTH, WALL, cellAt, cellRect, slotShares, towerLayout, type TowerLayout,
} from "./towerlayout";

export const TOWER_ART = [
  "paper", "clawd_band_idle", "clawd_band_run", "clawd_band_determined", "clawd_band_excited", "clawd_band_ko",
  "clawd_foe_idle", "clawd_foe_ko", "clawd_grower_idle", "clawd_grower_ko", "clawd_boss_idle", "clawd_boss_hit",
  "item_sword", "item_potion", "item_mirror", "item_key", "item_lock", "item_weight", "spikes", "saw_a", "saw_b",
  "block_planks", "terrain_stone_block_center",
  "terrain_grass_block_top", "terrain_grass_block_top_left", "terrain_grass_block_top_right",
  "terrain_grass_block_center", "terrain_grass_block_left", "terrain_grass_block_right",
];

/// A painted figure's frame is this tall, in points, in the tightest grid. The figure itself
/// stands about half as tall as its frame.
const FIGURE = 56;
/// The boss is painted on a frame half as big again.
const BOSS = 1.5;
/// How high each figure's head is above its feet, as a share of its frame.
const HEAD = { hero: 0.49, rival: 0.46, boss: 0.6 };
/// How long a hint stays up, in seconds, before it fades.
const HINT_SECONDS = 4;
/// How far through a beat the two sides meet: the bump lands, the pickup arrives.
const MEET = { fight: 0.4, gain: 0.6, item: 0.6 };
/// The small print on the second plate. Permanent Marker is for what shouts, and this does not.
const BODY = "system-ui, sans-serif";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
/// One palette colour thinned with another: `t` of `b` in `a`.
const mix = (a: number, b: number, t: number) => {
  const channel = (shift: number) => Math.round(lerp((a >> shift) & 255, (b >> shift) & 255, t)) << shift;
  return channel(16) | channel(8) | channel(0);
};

/// The wash inside a room says what it is to the hero right now.
const Wash = {
  /// Not reachable yet: violet thinned with cream, so the cream plates stand off it.
  plain: mix(Pigment.cream, Pigment.violet, 0.2),
  /// A room he can enter now: ochre, the colour of its dashed outline.
  open: mix(Pigment.cream, Pigment.ochre, 0.4),
  /// Cleared: almost the paper.
  cleared: mix(Pigment.paper, Pigment.cream, 0.6),
  /// Locked: the plain wash with ink in it, so the room looks shut before the padlock is read.
  locked: mix(mix(Pigment.cream, Pigment.violet, 0.2), Pigment.ink, 0.22),
};

// What each moment looks like. Small and short: the tower has to stay readable through it.
const UP = Math.PI / 2;
const GAIN: BurstOptions = { count: 6, color: Pigment.sap, shape: "star", speed: 110, life: 0.45, size: 3, gravity: 160, angle: UP, spread: 2.4 };
const LOSS: BurstOptions = { count: 6, color: Pigment.rose, shape: "shard", speed: 130, life: 0.4, size: 2.8, gravity: 380, angle: UP, spread: 2.8 };
const SCUFFLE: BurstOptions = { count: 7, color: Pigment.violet, shape: "star", speed: 120, life: 0.4, size: 3.2 };
const SEEING_STARS: BurstOptions = { count: 5, color: Pigment.cream, shape: "star", speed: 90, life: 0.4, size: 3, gravity: 120, angle: UP, spread: 2.2 };
const SPARKS: BurstOptions = { count: 6, color: Pigment.ochre, shape: "star", speed: 110, life: 0.45, size: 3.2, gravity: 160 };
const SPLINTERS: BurstOptions = { count: 8, color: Pigment.clayDark, shape: "shard", speed: 140, life: 0.45, size: 3, gravity: 420, angle: -UP, spread: 2.2 };

/// The painted item for each thing that is not a figure: its art, its size in points in the
/// tightest grid, where its foot is in the frame, how far off the floor it hangs, and how high
/// its top is, which is where its label starts.
const ITEMS = {
  plus: { art: "item_sword", size: 38, foot: 0.96, lift: 0, top: 35 },
  times: { art: "item_potion", size: 38, foot: 0.96, lift: 0, top: 35 },
  mirror: { art: "item_mirror", size: 40, foot: 0.97, lift: 0, top: 37 },
  key: { art: "item_key", size: 30, foot: 0.5, lift: 20, top: 34 },
  minus: { art: "spikes", size: 42, foot: 1, lift: 0, top: 24 },
  halve: { art: "saw_a", size: 38, foot: 0.5, lift: 20, top: 39 },
};

/// What a thing does to a number, as its label says it. A rival's label is its own number.
const opText = (thing: Thing): string | null => {
  switch (thing.kind) {
    case "plus": return `+${thing.n}`;
    case "times": return `×${thing.k}`;
    // Permanent Marker has no minus sign, so its hyphen stands in.
    case "minus": return `-${thing.n}`;
    case "halve": return `÷${thing.k}`;
    default: return null;
  }
};

const marker = (text: string, size: number): Text => {
  const label = new Text({ text, style: { fontFamily: MARKER, fontSize: size, fill: Pigment.ink }, resolution: 3 });
  label.anchor.set(0.5);
  return label;
};

/// A number on a small plate with an ink edge. The plate fits its number. With `tail` it has a
/// small point under it, or over it for "up", so it reads as belonging to the thing it points at. Its colours can
/// change: cream with ink for most numbers, rose for one that beats the hero now.
class Plate extends Container {
  readonly tall: number;
  wide = 0;
  private readonly back = new Graphics();
  private readonly words: Text;
  private shown: string | null = null;
  private fill: number = Pigment.cream;

  /// `edge` is the width of the ink line round the plate.
  constructor(text: string, private readonly size: number, private readonly edge = 1.5, private readonly tail: boolean | "up" = false) {
    super();
    this.tall = Math.round(size * 1.3);
    this.words = marker("", size);
    this.addChild(this.back, this.words);
    this.set(text);
  }

  set(text: string) {
    if (text === this.shown) return;
    this.shown = text;
    this.words.text = text;
    this.wide = Math.max(this.tall, Math.ceil(this.words.width + this.size * 0.6));
    this.paint();
  }

  /// Paint the plate and its number in other colours.
  tone(fill: number, ink: number = Pigment.ink) {
    if (fill === this.fill && this.words.style.fill === ink) return;
    this.fill = fill;
    this.words.style.fill = ink;
    this.paint();
  }

  private paint() {
    const g = this.back.clear(), low = this.tall / 2, way = this.tail === "up" ? -1 : 1;
    if (this.tail) g.poly([-5, way * (low - 1), 5, way * (low - 1), 0, way * (low + 5)]).fill(this.fill).stroke({ color: Pigment.ink, width: this.edge, join: "round" });
    g.roundRect(-this.wide / 2, -low, this.wide, this.tall, 6).fill(this.fill).stroke({ color: Pigment.ink, width: this.edge });
    // The point joins the plate: the ink line between them is painted over.
    if (this.tail) g.rect(-3.5, way * (low - this.edge / 2) - (this.edge + 1) / 2, 7, this.edge + 1).fill(this.fill);
  }
}

interface Box { x: number; y: number; w: number; h: number }

/// A box in canvas points, y up, as a rectangle on `g`.
const box = (g: Graphics, b: Box, grow = 0) => g.rect(b.x - grow, Y(b.y + b.h) - grow, b.w + 2 * grow, b.h + 2 * grow);

/// Dashes along the four sides of a rectangle, with a dash turning each corner.
const dashes = (g: Graphics, x: number, y: number, w: number, h: number, dash: number, gap: number) => {
  const side = (ax: number, ay: number, bx: number, by: number) => {
    const length = Math.hypot(bx - ax, by - ay), count = Math.max(1, Math.round(length / (dash + gap))), period = length / count;
    const ux = (bx - ax) / length, uy = (by - ay) / length, on = (period * dash) / (dash + gap);
    for (let i = 0; i <= count; i++) {
      const from = Math.max(0, i * period - on / 2), to = Math.min(length, i * period + on / 2);
      g.moveTo(ax + ux * from, ay + uy * from).lineTo(ax + ux * to, ay + uy * to);
    }
  };
  side(x, y, x + w, y);
  side(x + w, y, x + w, y + h);
  side(x + w, y + h, x, y + h);
  side(x, y + h, x, y);
};

/// A ladder between two heights, as ink lines on `g`: two rails and a rung every nine points.
const ladder = (g: Graphics, x: number, bottom: number, top: number, width: number) => {
  g.moveTo(x - width / 2, Y(bottom)).lineTo(x - width / 2, Y(top)).moveTo(x + width / 2, Y(bottom)).lineTo(x + width / 2, Y(top));
  for (let y = bottom + 7; y < top - 2; y += 9) g.moveTo(x - width / 2, Y(y)).lineTo(x + width / 2, Y(y));
};

/// One thing in a room, as it is drawn.
interface ThingView {
  thing: Thing;
  index: number;
  room: number;
  /// The floor point it stands over.
  home: Vec;
  node: Container;
  body: Sprite | ClipSprite;
  /// Its number, or what it does to one. A mirror and a key have none.
  plate: Plate | null;
  /// The plate and, for a grower, its badge. They stay put while a pickup flies.
  labels: Container;
  /// The scale the body is drawn at when nothing is happening to it.
  scale: number;
  /// The number the plate shows, and how long ago it last changed, for the pop.
  value: number;
  sinceChange: number;
}

interface RoomView {
  index: number;
  room: Room;
  /// The room inside its walls: the floor is its bottom edge.
  inside: Box;
  wash: Graphics;
  outline: Graphics;
  things: ThingView[];
  /// The padlock of a locked room, and the height it hangs at.
  lock: Sprite | null;
  lockY: number;
  /// A weak floor is two halves of planking that swing down when it gives way.
  floor: Container[];
  /// The sign under a weak floor that says what it holds.
  limit: Plate | null;
  /// How lit the room is as an option, and how washed out as a cleared one, each 0 to 1.
  glow: number;
  fade: number;
}

/// One move as the scene follows it: the beats the simulation queued for it, and what the scene
/// needs to remember from the moment it began.
interface Move {
  room: number;
  beats: Beat[];
  /// Where the hero stood when the move began.
  from: Vec;
  /// The number each thing in the room had when he walked in. A grower's number moves on the
  /// moment a move is made, and the one he is about to fight must not.
  values: number[];
  /// The height he lands at if the floor gives way.
  landing: number;
}

/// Where the hero stands and what he is doing. `lean` moves his body and leaves his number where
/// he stands, so a lunge does not put his plate over the other one.
interface Pose { x: number; y: number; clip: string; face: number; lean?: number; stretch?: number; settle?: boolean }

export class TowerScene implements Scene {
  readonly root = new Container();
  readonly sim: TowerSim;
  readonly title: string;
  /// Only a level that stores its solution can show the way.
  hint?: (step: number) => void;

  private readonly layout: TowerLayout;
  private readonly walled = new Set<string>();
  private readonly ladders: { left: boolean; right: boolean };
  private cues: Cue[] = [];
  private views: (RoomView | null)[] = [];
  private clips: ClipSprite[] = [];
  private saws: Sprite[] = [];
  private hero!: ClipSprite;
  private heroTag = new Container();
  private heroPlate!: Plate;
  private heroKeys: Sprite[] = [];
  private heroAt: Vec;
  private move: Move | null = null;
  /// The beat that was playing at the last step, and whether its moment of contact has been shown.
  private beat: Beat | null = null;
  private met = false;
  private fx = new Fx(20);
  private explainer: Container | null = null;
  private marks: { room: number; node: Container; ring: Graphics }[] = [];
  private markAge = 0;
  private clock = 0;

  /// `label` is the level's place in its chapter, "1-3", or nothing for a level outside the
  /// campaign. `lessons` are the pieces this level is the first to show.
  constructor(readonly level: TowerLevel, label: string, private onCue: (cue: Cue) => void, lessons: Explained[] = []) {
    this.title = `${label} ${level.name ?? ""}`.trim();
    this.sim = new TowerSim(level, (cue) => this.cues.push(cue));
    this.root.sortableChildren = true;
    for (const [a, b] of level.walls) { this.walled.add(`${a}-${b}`); this.walled.add(`${b}-${a}`); }
    // An entry above the ground floor needs a way up the outside: a ladder on that side of the tower.
    const upper = (column: number) => level.entries.some((e) => e % level.w === column && e >= level.w);
    this.ladders = { left: upper(0), right: level.w > 1 && upper(level.w - 1) };
    if ((level.solution ?? []).length > 0) this.hint = (step) => this.mark(step);

    this.root.addChild(paper("paper"));
    // The grass runs past both edges of the canvas, so the tiles with a corner on them stay out of sight.
    const ground = terrain({ x: -32, y: 0, w: W + 64, h: GROUND }, "grass");
    ground.zIndex = 0;
    this.root.addChild(ground);
    this.layout = towerLayout(level, this.plates(lessons), this.ladders);
    this.heroAt = { ...this.layout.start };
    this.build();
    this.draw(0);
  }

  // MARK: geometry

  /// The room at a column and a floor, or -1 for open air and for anywhere off the grid.
  private cell(column: number, floor: number): number {
    const { w, h, rooms } = this.level;
    if (column < 0 || column >= w || floor < 0 || floor >= h) return -1;
    return rooms[floor * w + column] ? floor * w + column : -1;
  }

  /// How a room is entered from outside, for a room that is an entry: by the ladder on its side
  /// of the tower, by the door at street level under it, or by a door in its back wall.
  private wayIn(room: number): "left" | "right" | "street" | "back" {
    const column = room % this.level.w;
    if (this.ladders.left && column === 0) return "left";
    if (this.ladders.right && column === this.level.w - 1) return "right";
    return room < this.level.w ? "street" : "back";
  }

  private get figure() { return FIGURE * this.layout.figure; }
  /// A doorway is tall enough for the hero to walk through.
  private get doorHeight() { return Math.round(this.figure * 0.62 + 8); }

  /// Where the hero stands to meet a thing: on its left, as near as the room allows.
  private heroSpot(room: number, thing: number): Vec {
    const view = this.views[room]!, target = view.things[thing] ?? view.things[0];
    const reach = this.figure * (target.thing.kind === "boss" ? 0.8 : 0.56);
    return { x: Math.max(view.inside.x + this.figure * 0.3, target.home.x - reach), y: view.inside.y };
  }

  /// Where he stands for a beat of a move: beside the thing the beat is about, and for the walk
  /// in, a lock or a floor, beside the first thing in the room.
  private standSpot(move: Move, k: number): Vec {
    const beat = move.beats[k];
    if (beat.thing !== undefined) return this.heroSpot(move.room, beat.thing);
    if (k > 0 && (beat.kind === "lose" || beat.kind === "win")) return this.standSpot(move, k - 1);
    return this.heroSpot(move.room, 0);
  }

  // MARK: building

  /// The hint, and under it the plate that explains the pieces this level is the first to show.
  /// Returns the height the tower has to stay under.
  private plates(lessons: Explained[]): number {
    let bottom = Y(730);
    const hint = hintLabel(this.level.hint);
    if (hint) {
      this.root.addChild(hint);
      const bounds = hint.getLocalBounds();
      bottom = bounds.y + bounds.height;
    }
    if (lessons.length > 0) {
      // One line to a piece: its picture, then what it does.
      const rows = new Container(), size = 18;
      let y = 0, wide = 0;
      for (const piece of lessons) {
        const words = new Text({
          text: EXPLAINERS[piece],
          style: { fontFamily: BODY, fontWeight: "700", fontSize: 11, fill: Pigment.ink, wordWrap: true, wordWrapWidth: 320, lineHeight: 14 },
          resolution: 3,
        });
        const tall = Math.max(size, words.height), picture = this.picture(piece, size);
        picture.position.set(size / 2, y + tall / 2);
        words.position.set(size + 6, y + (tall - words.height) / 2);
        rows.addChild(picture, words);
        wide = Math.max(wide, size + 6 + words.width);
        y += tall + 3;
      }
      const tall = y - 3, top = bottom + 5, node = new Container();
      const plate = new Graphics().roundRect(W / 2 - wide / 2 - 10, top, wide + 20, tall + 12, 6)
        .fill(Pigment.cream).stroke({ color: Pigment.ink, width: 1 });
      rows.position.set(W / 2 - wide / 2, top + 6);
      node.addChild(plate, rows);
      node.zIndex = 30;
      this.root.addChild(node);
      this.explainer = node;
      bottom = top + tall + 12;
    }
    return Y(bottom) - 8;
  }

  /// A small picture of a piece, for the plate that explains it: `size` points across, centred.
  private picture(piece: Explained, size: number): Container {
    const node = new Container();
    const figure = (clip: string, middle: number) => {
      // A figure is about seven eighths as wide as its frame is tall.
      const s = new Sprite(art.texture(clip)), frame = art.size(clip);
      s.anchor.set(0.5, middle);
      s.height = size / 0.88;
      s.width = (s.height * frame.w) / frame.h;
      node.addChild(s);
    };
    const item = (name: string) => {
      const s = new Sprite(art.texture(name));
      s.anchor.set(0.5);
      s.width = s.height = size;
      node.addChild(s);
    };
    if (piece === "enemy") figure("clawd_foe_idle", 0.65);
    else if (piece === "grower") figure("clawd_grower_idle", 0.65);
    else if (piece === "boss") figure("clawd_boss_idle", 0.6);
    else if (piece === "limit") item("item_weight");
    else if (piece === "lock") item("item_lock");
    else if (piece === "wall") {
      node.addChild(new Graphics().rect(-3, -size / 2, 6, size)
        .fill({ texture: art.texture("terrain_stone_block_center"), matrix: new Matrix().scale(1 / 3, 1 / 3), textureSpace: "global" })
        .stroke({ color: Pigment.ink, width: 1.5 }));
    } else if (piece === "entry") {
      const g = new Graphics().rect(-size / 2 + 1, -size / 2 + 1, size - 2, size - 2).fill(Wash.open);
      dashes(g, -size / 2 + 1, -size / 2 + 1, size - 2, size - 2, 5, 3);
      node.addChild(g.stroke({ color: Pigment.ochre, width: 2 }));
    } else if (piece === "minus") {
      // The spikes fill the lower half of their frame.
      const s = new Sprite(art.texture("spikes"));
      s.anchor.set(0.5, 0.72);
      s.width = s.height = size;
      node.addChild(s);
    } else item(ITEMS[piece].art);
    return node;
  }

  private build() {
    const { level, root } = this, L = this.layout, half = WALL / 2;
    const stoneFill = { texture: art.texture("terrain_stone_block_center"), matrix: new Matrix().scale(1 / 3, 1 / 3), textureSpace: "global" as const };
    const washes = new Container(), back = new Graphics(), inner = new Graphics(), outlines = new Container();
    const stone: Box[] = [], pits: Box[] = [], doors = new Graphics(), floors = new Container();
    const hatch = Math.round(this.figure * 0.46), rails = Math.round(this.figure * 0.3);

    for (let i = 0; i < level.rooms.length; i++) {
      const room = level.rooms[i];
      if (!room) { this.views.push(null); continue; }
      const r = cellRect(L, level, i);
      const wash = box(new Graphics(), r).fill(0xffffff);
      const inside = { x: r.x + half, y: r.y + half, w: r.w - WALL, h: r.h - WALL };
      // The outline of a room he can enter: ochre dashes over a wider ink line, a little inside the walls.
      const outline = new Graphics(), o = { x: inside.x + 4, y: Y(inside.y + inside.h) + 4, w: inside.w - 8, h: inside.h - 8 };
      dashes(outline, o.x, o.y, o.w, o.h, 9, 7);
      outline.stroke({ color: Pigment.ink, width: 5, cap: "round" });
      dashes(outline, o.x, o.y, o.w, o.h, 9, 7);
      outline.stroke({ color: Pigment.ochre, width: 3, cap: "round" });
      washes.addChild(wash);
      outlines.addChild(outline);
      this.views.push({ index: i, room, inside, wash, outline, things: [], lock: null, lockY: 0, floor: [], limit: null, glow: 0, fade: 0 });
    }

    // Walls stand on the lines between columns. Where two rooms share a doorway the wall starts
    // above it; a wall the level lists, and any wall with open air beyond it, is solid.
    for (let floor = 0; floor < level.h; floor++) {
      for (let line = 0; line <= level.w; line++) {
        const a = this.cell(line - 1, floor), b = this.cell(line, floor);
        if (a < 0 && b < 0) continue;
        const x = L.left + line * L.cellW, y = L.base + floor * L.cellH;
        let door = a >= 0 && b >= 0 && !this.walled.has(`${a}-${b}`);
        // An entry on a side with a ladder has its door in the outside wall.
        if (line === 0 && b >= 0 && level.entries.includes(b) && this.wayIn(b) === "left") door = true;
        if (line === level.w && a >= 0 && level.entries.includes(a) && this.wayIn(a) === "right") door = true;
        const from = y + half + (door ? this.doorHeight : 0);
        stone.push({ x: x - half, y: from, w: WALL, h: y + L.cellH - half - from });
      }
    }
    // Floors lie on the lines between floors. A doorway between two floors is a gap in the middle
    // with a ladder through it. A weak floor is planking, kept apart so it can give way.
    for (let line = 1; line <= level.h; line++) {
      for (let column = 0; column < level.w; column++) {
        const below = this.cell(column, line - 1), above = this.cell(column, line);
        if (below < 0 && above < 0) continue;
        const x = L.left + column * L.cellW, y = L.base + line * L.cellH, middle = x + L.cellW / 2;
        const open = below >= 0 && above >= 0 && !this.walled.has(`${below}-${above}`);
        if (open) ladder(inner, middle, y - L.cellH + half, y + half + 10, rails);
        const spans = open ? [[x + half, middle - hatch / 2], [middle + hatch / 2, x + L.cellW - half]] : [[x + half, middle], [middle, x + L.cellW - half]];
        if (above >= 0 && level.rooms[above]!.max !== undefined) this.weakFloor(floors, above, spans, y);
        else for (const [from, to] of spans) stone.push({ x: from, y: y - half, w: to - from, h: WALL });
      }
    }
    // A post at every corner a room touches, so the walls and the floors join.
    for (let floor = 0; floor <= level.h; floor++) {
      for (let line = 0; line <= level.w; line++) {
        const touches = [this.cell(line - 1, floor - 1), this.cell(line, floor - 1), this.cell(line - 1, floor), this.cell(line, floor)];
        if (touches.some((room) => room >= 0)) stone.push({ x: L.left + line * L.cellW - half, y: L.base + floor * L.cellH - half, w: WALL, h: WALL });
      }
    }
    for (let column = 0; column < level.w; column++) {
      for (let floor = 0; floor < level.h; floor++) {
        const room = this.cell(column, floor);
        if (room < 0) continue;
        const x = L.left + column * L.cellW, y = L.base + floor * L.cellH;
        // Battlements on every room with nothing above it.
        if (this.cell(column, floor + 1) < 0) {
          const count = Math.max(2, Math.round(L.cellW / 26)), step = L.cellW / count;
          for (let i = 0; i < count; i++) stone.push({ x: x + step * (i + 0.5) - 6, y: y + L.cellH + half, w: 12, h: MERLON });
        }
        if (floor > 0) continue;
        // The plinth under a ground floor room, with a lip where the tower ends. Under a weak
        // floor its top is a pit, covered by the planking.
        const weak = level.rooms[room]!.max !== undefined;
        const lipLeft = this.cell(column - 1, 0) < 0 ? LIP : 0, lipRight = this.cell(column + 1, 0) < 0 ? LIP : 0;
        stone.push({ x: x - half - lipLeft, y: GROUND, w: L.cellW + WALL + lipLeft + lipRight, h: PLINTH - (weak ? WALL : 0) });
        if (weak) {
          pits.push({ x: x + half, y: y - half, w: L.cellW - WALL, h: WALL });
          this.weakFloor(floors, room, [[x + half, x + L.cellW / 2], [x + L.cellW / 2, x + L.cellW - half]], y);
        }
      }
    }

    // The ways in from outside. A ground floor entry has a door at street level in the plinth
    // under it. A side with entries above the ground has a ladder up to the highest of them.
    for (const entry of level.entries) {
      const r = cellRect(L, level, entry), way = this.wayIn(entry), x = r.x + r.w / 2;
      if (way === "street") {
        doors.moveTo(x - 9, Y(GROUND)).lineTo(x - 9, Y(GROUND + 14)).arc(x, Y(GROUND + 14), 9, Math.PI, 0).lineTo(x + 9, Y(GROUND)).closePath();
      } else if (way === "back") {
        const left = r.x + half + 6, floor = r.y + half;
        back.moveTo(left, Y(floor)).lineTo(left, Y(floor + 20)).arc(left + 9, Y(floor + 20), 9, Math.PI, 0).lineTo(left + 18, Y(floor));
      }
    }
    doors.fill(Pigment.ink);
    for (const side of ["left", "right"] as const) {
      if (!this.ladders[side]) continue;
      const column = side === "left" ? 0 : level.w - 1;
      const highest = Math.max(...level.entries.filter((e) => e % level.w === column).map((e) => Math.floor(e / level.w)));
      const x = side === "left" ? L.left - half - LADDER / 2 : L.left + level.w * L.cellW + half + LADDER / 2;
      ladder(back, x, GROUND, L.base + highest * L.cellH + half + this.doorHeight, LADDER - 12);
      // A landing from the ladder to each door it serves, so the way in is drawn and not guessed.
      const wall = side === "left" ? L.left - half : L.left + level.w * L.cellW + half, out = side === "left" ? -1 : 1;
      for (const entry of level.entries) {
        if (entry % level.w !== column || this.wayIn(entry) !== side) continue;
        const sill = Y(L.base + Math.floor(entry / level.w) * L.cellH + half);
        back.rect(Math.min(wall, wall + out * (LADDER + 2)), sill - 1, LADDER + 2, 4);
      }
    }
    back.stroke({ color: Pigment.ink, width: 2, cap: "round" });
    // The ladders inside are part of the back wall: thinner in tone, so what stands in front reads first.
    inner.stroke({ color: Pigment.ink, width: 2, cap: "round", alpha: 0.4 });

    // The stonework is drawn twice: every piece in ink and two points bigger, then every piece in
    // stone. What shows is one outline round the whole tower, with no seams where pieces meet.
    const walls = new Graphics();
    for (const piece of [...stone, ...pits]) box(walls, piece, 2);
    walls.fill(Pigment.ink);
    for (const piece of stone) box(walls, piece);
    walls.fill(stoneFill);

    washes.zIndex = 1;
    back.zIndex = inner.zIndex = 2;
    walls.zIndex = 3;
    floors.zIndex = 4;
    doors.zIndex = 4;
    outlines.zIndex = 5;
    root.addChild(washes, inner, back, walls, floors, doors, outlines);

    for (const view of this.views) if (view) this.furnish(view);

    this.hero = new ClipSprite("clawd_band_idle", this.figure);
    this.hero.zIndex = 8;
    // His own number is the one everything is measured against: a size up, with a heavier edge.
    this.heroPlate = new Plate(String(level.start), L.numberSize + 3, 2.5, true);
    this.heroPlate.tone(Pigment.ink, Pigment.cream);
    this.heroTag.addChild(this.heroPlate);
    this.heroTag.zIndex = 9;
    this.clips.push(this.hero);
    root.addChild(this.hero, this.heroTag, this.fx.layer);
  }

  /// The planking of a weak floor: two halves hinged at the walls, with a crack in each.
  private weakFloor(layer: Container, room: number, spans: number[][], y: number) {
    const planks = { texture: art.texture("block_planks"), matrix: new Matrix().scale(1 / 4, 1 / 4), textureSpace: "global" as const };
    spans.forEach(([from, to], i) => {
      const length = to - from, half = new Container();
      // Each half is drawn out from its hinge, so turning it swings the free end down.
      const g = new Graphics().rect(i === 0 ? 0 : -length, 0, length, WALL).fill(planks).stroke({ color: Pigment.ink, width: 2 });
      const crack = (i === 0 ? 1 : -1) * length * 0.55;
      g.moveTo(crack - 3, 0).lineTo(crack + 1, WALL * 0.45).lineTo(crack - 2, WALL * 0.6).lineTo(crack + 2, WALL)
        .stroke({ color: Pigment.ink, width: 1.5, join: "round" });
      half.addChild(g);
      half.position.set(i === 0 ? from : to, Y(y + WALL / 2));
      layer.addChild(half);
      this.views[room]!.floor.push(half);
    });
  }

  /// Put a room's things in it, and its lock and its weight limit.
  private furnish(view: RoomView) {
    const L = this.layout, f = L.figure, { inside, room } = view, things = room.things;
    const shares = slotShares(things.length);
    // The boss is wide. When it shares a room, both stand a little to the left to make space.
    if (things.length === 2 && things[1].kind === "boss") { shares[0] = 0.34; shares[1] = 0.72; }
    things.forEach((thing, index) => {
      const node = new Container(), labels = new Container();
      const home = { x: inside.x + shares[index] * inside.w, y: inside.y };
      let body: Sprite | ClipSprite, head: number, text = opText(thing);
      if (thing.kind === "enemy" || thing.kind === "grower" || thing.kind === "boss") {
        const boss = thing.kind === "boss";
        // A boss that shares its room gives up some size so both fit.
        const tall = this.figure * (boss ? (things.length === 2 && inside.w < 120 ? 1.25 : BOSS) : 1);
        body = new ClipSprite(boss ? "clawd_boss_idle" : thing.kind === "grower" ? "clawd_grower_idle" : "clawd_foe_idle", tall);
        this.clips.push(body as ClipSprite);
        head = tall * (boss ? HEAD.boss : HEAD.rival);
        text = String(thing.n);
      } else {
        const item = ITEMS[thing.kind];
        body = new Sprite(art.texture(item.art));
        body.anchor.set(0.5, item.foot);
        body.width = body.height = item.size * f;
        body.y = -item.lift * f;
        head = item.top * f;
        if (thing.kind === "halve") this.saws.push(body);
      }
      const plate = text === null ? null : new Plate(text, L.numberSize, 1.5, true);
      if (plate) {
        labels.addChild(plate);
        plate.y = -plate.tall / 2;
        if (thing.kind === "boss") {
          // A crown on the boss's number: this is the one to beat.
          const s = L.numberSize, wide = s * 0.95, tall = s * 0.5;
          labels.addChild(new Graphics()
            .poly([-wide / 2, 0, -wide / 2, -tall, -wide / 4, -tall * 0.45, 0, -tall, wide / 4, -tall * 0.45, wide / 2, -tall, wide / 2, 0])
            .fill(Pigment.ochre).stroke({ color: Pigment.ink, width: 1.5, join: "round" }))
            .y = -plate.tall + 1;
        }
        if (thing.kind === "grower") {
          // What it gains each move, on a green badge that sits on top of its number and touches
          // it, so the two read as one label however many growers share a room.
          const badge = new Plate(`+${thing.grow}`, Math.max(11, Math.round(L.numberSize * 0.8)));
          badge.tone(Pigment.sap, Pigment.cream);
          labels.addChildAt(badge, 0);
          badge.y = plate.y - plate.tall / 2 - badge.tall / 2 + 2;
        }
      }
      // The plate's point stops just over the head.
      labels.y = -(head + 7);
      node.addChild(body, labels);
      node.position.set(home.x, Y(home.y));
      node.zIndex = 6;
      this.root.addChild(node);
      view.things.push({ thing, index, room: view.index, home, node, body, plate, labels, scale: body.scale.y, value: "n" in thing ? thing.n : 0, sinceChange: 9 });
    });

    // A weak floor's limit sits under the planks it is about and points up at them, so nobody
    // takes it for a label on something in the room. The padlock is at the top right of its room.
    const flags = new Container();
    flags.zIndex = 7;
    if (room.max !== undefined) {
      const sign = new Plate(`max ${room.max}`, Math.max(12, Math.round(L.numberSize * 0.9)), 1.5, "up");
      const x = inside.x + Math.max(sign.wide / 2 + 2, inside.w * 0.27), top = Y(inside.y - WALL);
      sign.position.set(x, top + 6 + sign.tall / 2);
      flags.addChild(sign);
      view.limit = sign;
    }
    if (room.locked) {
      const size = 28 * f, lock = new Sprite(art.texture("item_lock"));
      lock.anchor.set(0.5);
      lock.width = lock.height = size;
      view.lockY = Y(inside.y + inside.h - 3 - size / 2);
      lock.position.set(inside.x + inside.w - 3 - size / 2, view.lockY);
      flags.addChild(lock);
      view.lock = lock;
    }
    this.root.addChild(flags);
  }

  // MARK: the scene contract

  readout() {
    const keys = this.level.rooms.some((room) => room && (room.locked || room.things.some((thing) => thing.kind === "key")));
    return `3 stars at ${this.sim.best}` + (keys ? `   keys ${this.sim.shownKeys}` : "");
  }
  progress() { return null; }
  outcome() { return this.sim.outcome; }

  /// A tap on a room that is an option enters it. A tap anywhere else does nothing, and so does
  /// any tap while a move is playing.
  pointer(type: "down" | "move" | "up", point: Vec) {
    if (type !== "down") return;
    const room = cellAt(this.layout, this.level, point.x, point.y);
    if (room < 0 || !this.sim.enter(room)) return;
    this.begin(room, [...this.sim.timeline]);
  }

  step() {
    const sim = this.sim;
    sim.frame(STEP);
    const beat = sim.beat;
    for (const cue of this.cues) {
      // The simulation has one sound for every change to the number. One that lowers it gets the falling one.
      const lowers = cue.type === "sound" && cue.name === "gain" && beat?.from !== undefined && beat.to !== undefined && beat.to < beat.from;
      this.onCue(lowers ? { type: "sound", name: "drain" } : cue);
    }
    this.cues.length = 0;
    if (beat !== this.beat) {
      this.beat = beat;
      this.met = false;
      if (beat) {
        // A move the simulation began by itself, as a replay does, is followed the same way.
        if (!this.move?.beats.includes(beat)) this.begin(beat.room, [beat, ...sim.timeline]);
        this.began(beat);
      }
    }
    if (beat && !this.met && (beat.kind === "fight" || beat.kind === "gain" || beat.kind === "item") && sim.beatProgress >= MEET[beat.kind]) {
      this.met = true;
      this.meet(beat);
    }
  }

  // MARK: a move

  /// Start following a move into a room: `beats` is everything the simulation queued for it.
  private begin(room: number, beats: Beat[]) {
    const things = this.level.rooms[room]!.things;
    let floor = Math.floor(room / this.level.w) - 1;
    const column = room % this.level.w;
    while (floor >= 0 && this.cell(column, floor) < 0) floor -= 1;
    this.move = {
      room, beats, from: { ...this.heroAt },
      // A fight that was queued carries the number it was fought at. A thing the move never
      // reached is still at the number the simulation gives now.
      values: things.map((_, i) => beats.find((b) => b.kind === "fight" && b.thing === i)?.n ?? this.sim.growerValue(room, i)),
      landing: floor >= 0 ? this.layout.base + floor * this.layout.cellH + WALL / 2 : GROUND,
    };
  }

  /// Which beat of the move is playing and how far through it is. Before the first beat has begun
  /// that is the start of the first, and once all have played it is the count of beats.
  private cursor(move: Move): { k: number; t: number } {
    const beat = this.sim.beat;
    const k = beat ? move.beats.indexOf(beat) : -1;
    if (k >= 0) return { k, t: this.sim.beatProgress };
    return this.sim.timeline.length > 0 ? { k: 0, t: 0 } : { k: move.beats.length, t: 0 };
  }

  /// What the player sees and hears as a beat begins.
  private began(beat: Beat) {
    const fx = this.fx, view = this.views[beat.room]!, at = this.heroAt;
    if (beat.kind === "unlock" && view.lock) fx.burst(view.lock.x, Y(view.lockY), SPARKS);
    else if (beat.kind === "break") {
      fx.burst(view.inside.x + view.inside.w / 2, view.inside.y, SPLINTERS);
      fx.shake(5, 0.3);
    } else if (beat.kind === "lose") fx.burst(at.x, at.y + this.figure * 0.4, SEEING_STARS);
    else if (beat.kind === "win") fx.confetti();
  }

  /// The moment inside a beat when the two sides meet: the bump lands, or the pickup arrives.
  private meet(beat: Beat) {
    const fx = this.fx, move = this.move;
    if (!move || beat.thing === undefined) return;
    const thing = this.views[beat.room]!.things[beat.thing], spot = this.heroSpot(beat.room, beat.thing);
    const chest = spot.y + this.figure * 0.25, over = spot.y + this.figure * HEAD.hero + this.heroPlate.tall + 14;
    if (beat.kind === "fight") {
      if (beat.won) {
        const colour = thing.thing.kind === "grower" ? Pigment.sap : thing.thing.kind === "boss" ? Pigment.clay : Pigment.violet;
        fx.burst(thing.home.x, thing.home.y + this.figure * 0.25, { ...SCUFFLE, color: colour });
        fx.text(spot.x, over, `+${beat.n}`, { color: Pigment.sap, size: 22 });
        fx.shake(thing.thing.kind === "boss" ? 5 : 3, 0.2);
      } else {
        fx.burst(spot.x, chest, LOSS);
        fx.shake(5, 0.3);
      }
    } else if (beat.kind === "gain") {
      // A mirror shows its work on the plate itself: the digits turn over.
      if (beat.op === "mirror") { fx.ring(spot.x, chest, Pigment.sky); return; }
      const good = beat.op === "plus" || beat.op === "times";
      fx.text(spot.x, over, opText(thing.thing) ?? "", { color: good ? Pigment.sap : Pigment.rose, size: 22 });
      fx.burst(spot.x, chest, good ? GAIN : LOSS);
      if (!good) fx.shake(3, 0.2);
    } else {
      fx.ring(spot.x, chest, Pigment.ochre);
      fx.burst(spot.x, chest, SPARKS);
    }
  }

  /// Where the hero is and what he is doing at one moment of one beat.
  private beatPose(move: Move, k: number, t: number, still: boolean): Pose {
    const beat = move.beats[k], here = this.standSpot(move, k), before = k > 0 ? this.standSpot(move, k - 1) : move.from;
    switch (beat.kind) {
      case "walk": {
        // Along the floor to a room on the same level, and in an arc to one above or below.
        const e = still ? t : smooth(t), rise = here.y - move.from.y;
        const hop = still || Math.abs(rise) < 2 ? 0 : (14 + 0.1 * Math.abs(rise)) * 4 * t * (1 - t);
        return { x: lerp(move.from.x, here.x, e), y: lerp(move.from.y, here.y, e) + hop, clip: "clawd_band_run", face: here.x >= move.from.x ? 1 : -1 };
      }
      case "break": {
        // He stands a moment on the planking, then goes down with it.
        const fall = clamp01((t - 0.3) / 0.7);
        return { x: here.x, y: lerp(here.y, move.landing, still ? fall : fall * fall), clip: fall > 0 ? "clawd_band_ko" : "clawd_band_idle", face: 1 };
      }
      case "fight": {
        const x = lerp(before.x, here.x, smooth(clamp01(t / 0.2)));
        const lunge = (this.views[move.room]!.things[beat.thing ?? 0].home.x - here.x) * 0.45;
        let lean = 0, back = 0;
        if (!still) {
          if (t >= 0.2 && t < MEET.fight) lean = lunge * ((t - 0.2) / (MEET.fight - 0.2));
          else if (t >= MEET.fight && beat.won) lean = lunge * (1 - clamp01((t - MEET.fight) / 0.25));
          else if (t >= MEET.fight) {
            // The loser is thrown back, and stays there.
            back = clamp01((t - MEET.fight) / 0.4);
            lean = lunge * (1 - back);
          }
        }
        // Thrown back as far as the room allows: he stays inside its walls.
        const room = this.views[move.room]!.inside, thrown = Math.min(12, Math.max(0, x - room.x - this.figure * 0.45));
        return {
          x: x - thrown * back, y: here.y + 40 * back * (1 - back), lean,
          clip: !beat.won && t >= MEET.fight ? "clawd_band_ko" : "clawd_band_determined", face: 1,
        };
      }
      case "gain": case "item":
        return { x: lerp(before.x, here.x, smooth(clamp01(t / 0.25))), y: here.y, clip: "clawd_band_idle", face: 1 };
      case "lose": {
        const last = k > 0 ? this.beatPose(move, k - 1, 1, still) : { ...here };
        return { x: last.x, y: last.y, clip: "clawd_band_ko", face: 1 };
      }
      case "win": {
        // A hop on the spot as the boss goes down.
        const since = t * beat.seconds;
        const stretch = still ? 1 : since < 0.1 ? 1 + 1.8 * since : since < 0.22 ? 1.18 - 1.5 * (since - 0.1) : 1;
        return { x: here.x, y: here.y, clip: "clawd_band_excited", face: 1, stretch };
      }
      default:
        return { x: here.x, y: here.y, clip: "clawd_band_idle", face: 1 };
    }
  }

  private pose(still: boolean): Pose {
    const move = this.move, start = this.layout.start;
    if (!move) return { x: start.x, y: start.y, clip: "clawd_band_idle", face: 1 };
    const { k, t } = this.cursor(move);
    if (k < move.beats.length) return this.beatPose(move, k, t, still);
    // The move has played out. After a win or a loss he holds his last pose. Otherwise he walks
    // to the middle of the room, which is his now.
    if (this.sim.outcome) return this.beatPose(move, move.beats.length - 1, 1, still);
    const inside = this.views[move.room]!.inside;
    return { x: inside.x + inside.w / 2, y: inside.y, clip: "clawd_band_idle", face: 1, settle: true };
  }

  // MARK: drawing

  draw(dt: number) {
    const sim = this.sim, still = reducedMotion(), move = this.move;
    this.clock += dt;
    const cursor = move ? this.cursor(move) : { k: 0, t: 0 };
    const playing = move !== null && cursor.k < move.beats.length;
    const options = new Set(sim.busy ? [] : sim.options());
    // Lights come up and go down over a moment, so a move does not flash the whole tower.
    const ease = still ? 1 : Math.min(1, dt * 9);
    const breath = still ? 1 : 0.78 + 0.22 * Math.sin((this.clock * 2 * Math.PI) / 1.8);

    const pose = this.pose(still);
    if (pose.settle && !still) {
      const k = Math.min(1, dt * 10);
      this.heroAt.x += (pose.x - this.heroAt.x) * k;
      this.heroAt.y += (pose.y - this.heroAt.y) * k;
    } else {
      this.heroAt.x = pose.x;
      this.heroAt.y = pose.y;
    }
    const hero = this.hero, at = this.heroAt;
    if (hero.current !== pose.clip) hero.play(pose.clip);
    hero.facing = pose.face;
    hero.fit(pose.stretch ?? 1);
    hero.position.set(at.x + (pose.lean ?? 0), Y(at.y));

    for (const view of this.views) {
      if (!view) continue;
      // The move being played, when it is into this room.
      const mine = move && move.room === view.index ? move : null;
      // The room he is fighting in stays lit until the move has played out.
      const lit = options.has(view.index) || (mine !== null && playing);
      const cleared = sim.cleared.has(view.index) && !(mine !== null && playing);
      view.glow += ((lit ? 1 : 0) - view.glow) * ease;
      view.fade += ((cleared ? 1 : 0) - view.fade) * ease;
      // A locked room looks shut until its padlock has gone.
      const shut = view.lock !== null && !cleared && !(mine !== null && cursor.k > mine.beats.findIndex((b) => b.kind === "unlock"));
      view.wash.tint = mix(mix(shut ? Wash.locked : Wash.plain, Wash.open, view.glow), Wash.cleared, view.fade);
      view.outline.visible = options.has(view.index);
      view.outline.alpha = breath;

      if (view.lock) {
        // The padlock hangs until its beat, then drops away.
        const k = mine ? mine.beats.findIndex((b) => b.kind === "unlock") : -1;
        const fall = !mine ? (cleared ? 1 : 0) : k < 0 || cursor.k < k ? 0 : cursor.k > k ? 1 : still ? 1 : cursor.t;
        view.lock.visible = fall < 1;
        view.lock.y = view.lockY + fall * fall * 70;
        view.lock.rotation = fall * 0.9;
        view.lock.alpha = 1 - clamp01((fall - 0.6) / 0.4);
      }
      if (view.floor.length > 0) {
        const k = mine ? mine.beats.findIndex((b) => b.kind === "break") : -1;
        const open = k < 0 || cursor.k < k ? 0 : cursor.k > k || still ? 1 : smooth(clamp01(cursor.t / 0.3));
        view.floor[0].rotation = open * 1.25;
        view.floor[1].rotation = -open * 1.25;
      }
      for (const thing of view.things) this.drawThing(thing, mine, cursor, cleared, still, dt);
    }

    // His number rides over his head, with the keys he holds beside it: on the left, clear of
    // whatever he is facing.
    const beat = sim.beat;
    let shown = sim.shownPower, turn = 1;
    if (beat?.kind === "gain" && beat.op === "mirror" && beat.from !== undefined && beat.to !== undefined) {
      // The digits turn over like a card: the old number closes and the new one opens.
      shown = cursor.t < 0.5 ? beat.from : beat.to;
      turn = still ? 1 : Math.max(0.05, Math.abs(Math.cos(Math.PI * cursor.t)));
    }
    this.heroPlate.set(String(shown));
    // A floor he is too heavy for right now says so in rose.
    for (const view of this.views) if (view?.limit) view.limit.tone(shown > view.room.max! ? Pigment.rose : Pigment.cream);
    this.heroPlate.scale.x = turn;
    const keySize = Math.round(15 * this.layout.figure);
    while (this.heroKeys.length < sim.shownKeys) {
      const key = new Sprite(art.texture("item_key"));
      key.anchor.set(0.5);
      key.width = key.height = keySize;
      this.heroKeys.push(key);
      this.heroTag.addChild(key);
    }
    this.heroKeys.forEach((key, i) => {
      key.visible = i < sim.shownKeys;
      key.x = -(this.heroPlate.wide / 2 + 2 + keySize / 2 + i * keySize * 0.8);
    });
    this.heroTag.position.set(at.x, Y(at.y + this.figure * HEAD.hero + 3 + this.heroPlate.tall / 2));

    for (const clip of this.clips) clip.tick(dt);
    if (!still) {
      const frame = art.texture(Math.floor(this.clock / 0.08) % 2 === 0 ? "saw_a" : "saw_b");
      for (const saw of this.saws) saw.texture = frame;
    }
    if (this.explainer && move) {
      // The explaining is over once he has made a move.
      this.explainer.alpha -= dt / (still ? 0.1 : 0.2);
      if (this.explainer.alpha <= 0) { this.explainer.destroy({ children: true }); this.explainer = null; }
    }
    this.fx.tick(dt);
    this.root.position.set(this.fx.offset.x, this.fx.offset.y);

    if (this.marks.length > 0) {
      this.markAge += dt;
      // The rings pulse for four seconds and then fade. A room that has been cleared drops its ring.
      const fade = still ? 0.1 : 0.3, left = HINT_SECONDS + fade - this.markAge;
      for (const mark of this.marks) {
        mark.node.visible = !sim.cleared.has(mark.room);
        mark.node.alpha = Math.min(1, Math.max(0, left / fade));
        mark.ring.scale.set(still ? 1 : 1 + 0.1 * Math.sin((this.markAge * 2 * Math.PI) / 0.7));
      }
      if (left <= 0) this.clearMarks();
    }
  }

  /// One thing: standing, meeting the hero, or gone. `move` is the move being played when it is
  /// into this thing's room, and `cleared` says the room was emptied by an earlier move.
  private drawThing(view: ThingView, move: Move | null, cursor: { k: number; t: number }, cleared: boolean, still: boolean, dt: number) {
    const { thing, node, body, labels } = view, sim = this.sim;
    const own = move ? move.beats.findIndex((b) => b.thing === view.index) : -1;
    const beat = own >= 0 ? move!.beats[own] : null;
    // Before its beat it stands. In its beat it meets him, from 0 to 1. After it, it is done.
    const t = !beat ? 0 : cursor.k < own ? 0 : cursor.k > own ? 1 : cursor.t;
    const done = beat ? cursor.k > own : cleared;

    let value = view.value;
    if (thing.kind === "grower") value = move ? move.values[view.index] : sim.growerValue(view.room, view.index);
    if (value !== view.value) { view.value = value; view.sinceChange = 0; view.plate?.set(String(value)); }
    view.sinceChange += dt;
    // A rival he cannot beat at this moment shows its number on rose: a tie is a loss too.
    if (view.plate && (thing.kind === "enemy" || thing.kind === "grower" || thing.kind === "boss")) {
      view.plate.tone(value >= sim.shownPower ? Pigment.rose : Pigment.cream);
    }
    // A grower's plate jumps when its number goes up.
    labels.scale.set(still || view.sinceChange > 0.25 ? 1 : 1 + 0.25 * (1 - view.sinceChange / 0.25));

    if (body instanceof ClipSprite) {
      const boss = thing.kind === "boss", fell = beat?.kind === "fight" && beat.won === true && t >= MEET.fight;
      const out = fell && !boss ? (done ? 1 : clamp01((t - 0.55) / (still ? 0.1 : 0.45))) : !beat && done ? 1 : 0;
      const clip = !fell ? (boss ? "clawd_boss_idle" : thing.kind === "grower" ? "clawd_grower_idle" : "clawd_foe_idle")
        : boss ? "clawd_boss_hit" : thing.kind === "grower" ? "clawd_grower_ko" : "clawd_foe_ko";
      if (body.current !== clip) body.play(clip);
      node.visible = out < 1;
      node.alpha = 1 - out;
      // The loser is knocked back as it goes.
      body.x = still ? 0 : 10 * out;
      // The boss keeps its number to the end. A beaten rival's goes with it.
      labels.visible = !fell || boss;
      return;
    }
    // An item: it rises into him, shrinking as it goes, and its label goes first.
    const item = ITEMS[thing.kind as keyof typeof ITEMS], f = this.layout.figure;
    if (!beat) {
      node.visible = !done;
      node.alpha = 1;
      return;
    }
    const taken = still ? 0 : smooth(clamp01((t - 0.05) / (MEET.gain - 0.05)));
    const chest = { x: this.heroAt.x - view.home.x, y: -(this.heroAt.y - view.home.y) - this.figure * 0.25 };
    node.visible = t < 1;
    body.x = chest.x * taken;
    body.y = lerp(-item.lift * f, chest.y, taken);
    body.scale.set(view.scale * (1 - 0.5 * taken));
    body.alpha = still ? 1 - clamp01(t / 0.25) : 1 - clamp01((t - MEET.gain + 0.1) / 0.15);
    labels.alpha = 1 - clamp01(t / 0.25);
  }

  // MARK: hints

  /// Ring the first `step` rooms of the stored solution, each with its place in the order.
  private mark(step: number) {
    this.clearMarks();
    (this.level.solution ?? []).slice(0, Math.max(1, step)).forEach((room, i) => {
      const view = this.views[room];
      if (!view) return;
      const node = new Container();
      // Ochre over a wider ink line, so the ring has the ink edge everything else has.
      const ring = new Graphics().circle(0, 0, 17).stroke({ color: Pigment.ink, width: 6 }).circle(0, 0, 17).stroke({ color: Pigment.ochre, width: 3.5 });
      const plate = new Graphics().circle(0, 0, 13).fill(Pigment.cream);
      node.addChild(plate, ring, marker(String(i + 1), 17));
      // High in the room, over the heads and under the lock and the weight limit.
      node.position.set(view.inside.x + view.inside.w / 2, Y(view.inside.y + view.inside.h * 0.74));
      node.zIndex = 32;
      this.root.addChild(node);
      this.marks.push({ room, node, ring });
    });
    this.markAge = 0;
  }

  private clearMarks() {
    for (const mark of this.marks) mark.node.destroy({ children: true });
    this.marks.length = 0;
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
