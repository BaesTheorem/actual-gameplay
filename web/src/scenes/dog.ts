// Save the Clawd on screen: the simulation in sim/savedog.ts, drawn.
import { Container, Graphics, Sprite, Text } from "pixi.js";
import * as art from "../app/art";
import type { Cue } from "../sim/clock";
import { DogSim, type Dog, type DogLevel, type Effect, type Prop } from "../sim/savedog";
import type { Bee } from "../sim/savedog/bee";
import { DOG_RADIUS } from "../sim/savedog/beecrew";
import { resample } from "../sim/savedog/geometry";
import { solutionStrokes } from "../sim/savedog/level";
import { WIDTH, type Stroke } from "../sim/savedog/stroke";
import type { Vec } from "../sim/sk";
import {
  ClipSprite, Fx, MARKER, Pigment, Y, hintLabel, paper, reducedMotion, sprite, terrain,
  type BurstOptions, type Scene,
} from "./kit";

const TILES = ["block_center", "block_top", "block_left", "block_right", "block_top_left", "block_top_right",
  "horizontal_left", "horizontal_middle", "horizontal_right"];
export const DOG_ART = [
  "paper", "background_color_hills", "cloud_1", "cloud_2", "cloud_3", "ui_hive", "bee_a", "bee_b", "saw_a", "saw_b",
  "spikes", "rock", "block_planks", "clawd_nervous", "clawd_scared", "clawd_excited", "clawd_ko",
  ...["grass", "stone", "dirt", "purple"].flatMap((skin) => TILES.map((part) => `terrain_${skin}_${part}`)),
];

/// The dark wood of the painted planks and posts.
const WOOD = 0x7a4b31;
/// A dog's clip frame leaves room above him for emotes, so a 58 pt frame makes his body as wide as his 36 pt circle.
const DOG_HEIGHT = 58;

/// How long a hint stays up, in seconds, before it fades.
const HINT_SECONDS = 4;

// What each moment looks like. Small and short: the level has to stay readable through it.
const UP = Math.PI / 2;
const FLECKS: BurstOptions = { count: 6, color: Pigment.ink, shape: "dot", speed: 90, life: 0.3, size: 1.6, gravity: 420, angle: UP, spread: 2.4, outline: false };
const CHIPS: BurstOptions = { count: 7, color: Pigment.ink, shape: "shard", speed: 160, life: 0.35, size: 2.4, gravity: 520, angle: UP, spread: 2, outline: false };
// A pit throws drops the colour of its own rim, so they show against the pit as well as the sky.
const SPLASH: BurstOptions = { count: 8, color: Pigment.sky, shape: "drop", speed: 170, life: 0.5, size: 3, gravity: 620, angle: UP, spread: 1.7 };
const SPIT: BurstOptions = { count: 8, color: Pigment.ochre, shape: "drop", speed: 150, life: 0.5, size: 3, gravity: 560, angle: UP, spread: 1.7 };
const STING: BurstOptions = { count: 8, color: Pigment.ochre, shape: "shard", speed: 150, life: 0.4, size: 2.8 };
const HURT: BurstOptions = { count: 8, color: Pigment.rose, shape: "shard", speed: 150, life: 0.4, size: 2.8, gravity: 300, angle: UP, spread: 2.6 };
const CHEER: BurstOptions = { count: 6, color: Pigment.ochre, shape: "star", speed: 110, life: 0.5, size: 3.4, gravity: 140, angle: UP, spread: 2.2 };

/// Decorative motion runs full length normally and near-instant under reduced motion.
const decorative = (full: number) => (reducedMotion() ? Math.min(full, 0.1) : full);

/// A polyline as one round-capped, round-joined line. Points are in a y-up frame about the origin.
const inkLine = (g: Graphics, points: Vec[], color: number, width: number, alpha = 1) => {
  g.moveTo(points[0].x, -points[0].y);
  for (const p of points.slice(1)) g.lineTo(p.x, -p.y);
  g.stroke({ color, width, alpha, cap: "round", join: "round" });
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

const label = (text: string, size: number, color: number, alpha = 1): Text => {
  const t = new Text({ text, style: { fontFamily: MARKER, fontSize: size, fill: color }, resolution: 3 });
  t.anchor.set(0.5);
  t.alpha = alpha;
  return t;
};

interface DogNode { holder: Container; clip: ClipSprite; mood: string; since: number }
interface EffectNode { node: Container; text?: Text }

export class DogScene implements Scene {
  readonly root = new Container();
  readonly sim: DogSim;
  readonly title: string;
  private cues: Cue[] = [];
  private time = 0;
  private clouds: { node: Sprite; x: number; reach: number; period: number }[] = [];
  private hiveNodes: Container[] = [];
  private hiveAlpha = 1;
  private saws: Sprite[] = [];
  private props = new Map<Prop, Sprite>();
  private strokes = new Map<Stroke, Graphics>();
  private live = new Graphics();
  private dogs = new Map<Dog, DogNode>();
  private bees = new Map<Bee, Sprite>();
  private beeLayer = new Container();
  private effects = new Map<Effect, EffectNode>();
  private fx = new Fx(20);
  private ghost: Graphics | null = null;
  private ghostAge = 0;
  /// Only a level that stores its solution can show the way.
  hint?: (step: number) => void;

  /// `label` is the level's place in its chapter, "1-3".
  constructor(readonly level: DogLevel, label: string, private onCue: (cue: Cue) => void) {
    this.title = `${label} ${level.name}`;
    this.sim = new DogSim(level, (cue) => this.cues.push(cue));
    this.root.sortableChildren = true;
    if (solutionStrokes(level).length > 0) this.hint = () => this.showGhost();
    this.build();
  }

  private build() {
    const { sim, root } = this;
    root.addChild(paper("paper"));
    // The hills stand on the horizon line and three clouds drift above them.
    const hills = new Sprite(art.texture("background_color_hills"));
    hills.anchor.set(0.5, 1);
    hills.position.set(201, Y(74));
    hills.width = 402;
    hills.height = 260;
    hills.zIndex = -10;
    root.addChild(hills);
    ["cloud_1", "cloud_3", "cloud_2"].forEach((name, i) => {
      const native = art.size(name), k = 0.35 + 0.1 * i;
      const node = sprite(name, 60 + i * 140, 660 - i * 60, native.w * k, native.h * k, -9);
      node.alpha = 0.85;
      root.addChild(node);
      this.clouds.push({ node, x: 60 + i * 140, reach: 12 + i * 4, period: 6 + i });
    });
    for (const d of sim.decor) {
      if (art.exists(d.sprite)) root.addChild(sprite(d.sprite, d.x, d.y, d.w, d.h, 1));
    }
    for (const item of sim.terrain) {
      if (item.type === "rect") {
        const node = terrain(item.rect, item.skin);
        node.zIndex = 2;
        root.addChild(node);
      } else if (item.type === "circle") {
        root.addChild(sprite("rock", item.center.x, item.center.y, item.radius * 2.1, item.radius * 2.1, 2));
      } else {
        // A branch: wood over a slightly wider ink line, which gives it the painted props' outline.
        const g = new Graphics();
        inkLine(g, item.points, Pigment.ink, 9);
        inkLine(g, item.points, WOOD, 6);
        g.position.set(0, Y(0));
        g.zIndex = 2;
        root.addChild(g);
      }
    }
    for (const pit of sim.liquids) root.addChild(this.liquid(pit.rect, pit.kind === "lava"));
    for (const r of sim.spikes) root.addChild(this.spikeStrip(r));
    for (const saw of sim.saws) {
      const node = sprite("saw_a", saw.x, saw.y, saw.r * 2.3, saw.r * 2.3, 7);
      this.saws.push(node);
      root.addChild(node);
    }
    for (const prop of sim.props) {
      const node = prop.shape === "ball"
        ? sprite("rock", 0, 0, prop.radius * 2.15, prop.radius * 2.15, 6)
        : sprite("block_planks", 0, 0, prop.size.w, prop.size.h, 6);
      this.props.set(prop, node);
      root.addChild(node);
    }
    for (const r of sim.forbidden) root.addChild(this.noInk(r));
    for (const hive of sim.hives) {
      const marker = sprite("ui_hive", hive.x, hive.y, 30, 30, 4);
      const count = label(String(hive.count), 13, Pigment.ink);
      count.position.set(hive.x, Y(hive.y - 23));
      count.zIndex = 4;
      marker.alpha = 0.9;
      this.hiveNodes.push(marker, count);
      root.addChild(marker, count);
    }
    for (const dog of sim.dogs) {
      const holder = new Container();
      const clip = new ClipSprite("clawd_nervous", DOG_HEIGHT);
      // He stands on the bottom of his body circle, and the holder turns about its centre.
      clip.position.set(0, DOG_RADIUS);
      holder.addChild(clip);
      holder.zIndex = 8;
      this.dogs.set(dog, { holder, clip, mood: dog.mood, since: 0 });
      root.addChild(holder);
    }
    this.beeLayer.zIndex = 12;
    this.live.zIndex = 50;
    root.addChild(this.beeLayer, this.live, this.fx.layer);
    const hint = hintLabel(this.level.hint);
    if (hint) root.addChild(hint);
    this.draw(0);
  }

  /// A pit of water or lava: a flat wash with a wavy line along the top.
  private liquid(r: { x: number; y: number; w: number; h: number }, lava: boolean): Graphics {
    const g = new Graphics().rect(r.x, Y(r.y + r.h), r.w, r.h).fill(lava ? Pigment.clay : Pigment.teal);
    const top = r.y + r.h, right = r.x + r.w;
    g.moveTo(r.x, Y(top));
    let up = true;
    for (let x = r.x; x < right;) {
      const nx = Math.min(x + 12, right);
      g.quadraticCurveTo((x + nx) / 2, Y(top + (up ? 4 : -3)), nx, Y(top));
      x = nx;
      up = !up;
    }
    g.stroke({ color: lava ? Pigment.ochre : Pigment.sky, width: 3 });
    g.zIndex = 3;
    return g;
  }

  /// A row of spike tiles across the top of a rect, on a stone base.
  private spikeStrip(r: { x: number; y: number; w: number; h: number }): Container {
    const node = new Container();
    const baseHeight = Math.max(4, r.h * 0.4);
    node.addChild(terrain({ x: r.x, y: r.y, w: r.w, h: baseHeight }, "stone"));
    const tile = r.h * 0.6, top = Y(r.y + baseHeight + tile);
    const row = new Container();
    for (let x = r.x; x < r.x + r.w; x += tile) {
      const s = new Sprite(art.texture("spikes"));
      s.position.set(x, top);
      s.width = s.height = tile;
      row.addChild(s);
    }
    const mask = new Graphics().rect(r.x, top, r.w, tile).fill(0xffffff);
    row.addChild(mask);
    row.mask = mask;
    node.addChild(row);
    node.zIndex = 2;
    return node;
  }

  /// A no-ink zone: a rose wash, a dashed edge and its label.
  private noInk(r: { x: number; y: number; w: number; h: number }): Container {
    const node = new Container();
    const top = Y(r.y + r.h);
    const wash = new Graphics().rect(r.x, top, r.w, r.h).fill({ color: Pigment.rose, alpha: 0.18 });
    const edge = new Graphics();
    dashedRect(edge, r.x, top, r.w, r.h, 6, 4);
    edge.stroke({ color: Pigment.ink, width: 1.5, alpha: 0.75 });
    const text = label("no ink", 13, Pigment.ink, 0.75);
    text.position.set(r.x + r.w / 2, top + 15);
    node.addChild(wash, edge, text);
    node.zIndex = 3;
    return node;
  }

  readout() { return this.sim.readout; }
  progress() { return this.sim.progress; }
  outcome() { return this.sim.outcome; }

  pointer(type: "down" | "move" | "up", point: Vec) {
    if (type === "down") this.sim.begin(point);
    else if (type === "move") this.sim.extend(point);
    else this.sim.end();
  }

  step() {
    this.sim.frame();
    // Moods are read from the dogs when drawing, and a cut has its own effect.
    for (const cue of this.cues) {
      if (cue.type === "fx") this.effect(cue.name, cue.x, cue.y);
      else if (cue.type !== "puff" && cue.type !== "mood") this.onCue(cue);
    }
    this.cues.length = 0;
  }

  /// What the player sees for each moment the simulation reports.
  private effect(name: string, x: number, y: number) {
    const fx = this.fx;
    if (name === "land") fx.burst(x, y, FLECKS);
    else if (name === "cut") fx.burst(x, y, CHIPS);
    else if (name === "sink") fx.burst(x, y, this.lavaAt(x) ? SPIT : SPLASH);
    else if (name === "drown") { fx.burst(x, y, this.lavaAt(x) ? SPIT : SPLASH); fx.shake(5, 0.3); }
    else if (name === "sting") { fx.burst(x, y, STING); fx.ring(x, y, Pigment.rose); fx.shake(5, 0.3); }
    else if (name === "hurt") { fx.burst(x, y, HURT); fx.shake(5, 0.3); }
    else if (name === "win") {
      fx.confetti();
      for (const dog of this.sim.dogs) fx.burst(dog.position.x, dog.position.y + 22, CHEER);
    }
  }

  /// Whether the pit nearest to a canvas x is lava. A splash takes its colour from the pit it came out of.
  private lavaAt(x: number): boolean {
    let nearest: { kind: string } | null = null, best = Infinity;
    for (const pit of this.sim.liquids) {
      const gap = Math.max(pit.rect.x - x, x - (pit.rect.x + pit.rect.w), 0);
      if (gap < best) { best = gap; nearest = pit; }
    }
    return nearest?.kind === "lava";
  }

  /// The stored solution as a dotted ghost: where the ink goes, for four seconds.
  private showGhost() {
    this.ghost?.destroy();
    const g = new Graphics();
    for (const stroke of solutionStrokes(this.level)) {
      for (const p of stroke.length === 1 ? stroke : resample(stroke, 9)) g.circle(p.x, Y(p.y), 2.2);
    }
    g.fill({ color: Pigment.ink, alpha: 0.6 });
    g.zIndex = 45;
    this.root.addChild(g);
    this.ghost = g;
    this.ghostAge = 0;
  }

  draw(dt: number) {
    const sim = this.sim, still = reducedMotion();
    this.time += dt;
    if (!still) {
      for (const c of this.clouds) {
        // Out and back with an ease at each end.
        const phase = (this.time % (2 * c.period)) / c.period;
        const t = phase < 1 ? phase : 2 - phase;
        c.node.x = c.x + c.reach * (t * t * (3 - 2 * t));
      }
      const picture = sim.sawFrame === 0 ? "saw_a" : "saw_b";
      for (const saw of this.saws) saw.texture = art.texture(picture);
    }
    if (sim.released && this.hiveAlpha > 0.35) {
      this.hiveAlpha = Math.max(0.35, this.hiveAlpha - (0.65 * dt) / 0.3);
      this.hiveNodes.forEach((node, i) => { node.alpha = this.hiveAlpha * (i % 2 === 0 ? 0.9 : 1); });
    }
    this.drawProps();
    this.drawStrokes();
    this.drawLive();
    this.drawDogs(dt, still);
    this.drawBees(still);
    this.drawEffects();
    this.fx.tick(dt);
    this.root.position.set(this.fx.offset.x, this.fx.offset.y);
    if (this.ghost) {
      this.ghostAge += dt;
      const left = HINT_SECONDS + decorative(0.4) - this.ghostAge;
      this.ghost.alpha = Math.min(1, Math.max(0, left / decorative(0.4)));
      if (left <= 0) { this.ghost.destroy(); this.ghost = null; }
    }
  }

  private drawProps() {
    const sim = this.sim;
    for (const [prop, node] of this.props) {
      if (!prop.attached) { node.destroy(); this.props.delete(prop); continue; }
      const at = prop.position;
      node.position.set(at.x, Y(at.y));
      node.rotation = -prop.angle;
      if (prop.state === "sunk") node.alpha = 1 - Math.min(1, (sim.elapsed - prop.since) / decorative(0.35));
    }
  }

  private drawStrokes() {
    const sim = this.sim;
    for (const stroke of sim.strokes) {
      if (this.strokes.has(stroke)) continue;
      // Pinned ink is indigo, so a stroke that will not fall reads as a different ink.
      const color = stroke.dynamic ? Pigment.ink : Pigment.indigo;
      const g = new Graphics();
      if (stroke.local.length === 1) g.circle(0, 0, WIDTH / 2).fill(color);
      else inkLine(g, stroke.local, color, WIDTH);
      g.zIndex = 10;
      this.strokes.set(stroke, g);
      this.root.addChild(g);
    }
    for (const [stroke, g] of this.strokes) {
      if (!stroke.attached) { g.destroy(); this.strokes.delete(stroke); continue; }
      const at = stroke.position;
      g.position.set(at.x, Y(at.y));
      g.rotation = -stroke.angle;
      if (stroke.state === "cut") {
        const t = Math.min(1, (sim.elapsed - stroke.since) / 0.2);
        g.alpha = 1 - Math.min(1, (sim.elapsed - stroke.since) / decorative(0.2));
        g.scale.set(1 - 0.1 * t);
      } else if (stroke.state === "sunk") {
        g.alpha = 1 - Math.min(1, (sim.elapsed - stroke.since) / decorative(0.35));
      }
    }
  }

  private drawLive() {
    const points = this.sim.liveStroke;
    this.live.clear();
    if (points.length === 0) return;
    // A single point still shows, as a dot the width of the pen.
    const path = points.length === 1 ? [points[0], points[0]] : points;
    this.live.moveTo(path[0].x, Y(path[0].y));
    for (const p of path.slice(1)) this.live.lineTo(p.x, Y(p.y));
    this.live.stroke({ color: Pigment.ink, width: WIDTH, alpha: 0.7, cap: "round", join: "round" });
  }

  private drawDogs(dt: number, still: boolean) {
    for (const [dog, node] of this.dogs) {
      if (dog.mood !== node.mood) {
        node.mood = dog.mood;
        node.since = this.time;
        node.clip.play(`clawd_${dog.mood}`);
      }
      const at = dog.position, since = this.time - node.since;
      node.holder.position.set(at.x, Y(at.y));
      // The bees are out: he shakes, a tilt each way every 0.06 s.
      node.holder.rotation = dog.mood === "scared" && !still ? 0.15 * Math.sin((since / 0.12) * 2 * Math.PI) : 0;
      // Saved: one quick stretch, up over 0.12 s and back over 0.12 s.
      let stretch = 1;
      if (dog.mood === "excited" && !still && since < 0.24) stretch = 1 + 0.15 * (since < 0.12 ? since / 0.12 : (0.24 - since) / 0.12);
      node.clip.fit(stretch);
      node.clip.tick(dt);
    }
  }

  private drawBees(still: boolean) {
    const sim = this.sim;
    const picture = still || Math.floor(this.time / 0.08) % 2 === 0 ? "bee_a" : "bee_b";
    for (const bee of sim.bees) {
      let node = this.bees.get(bee);
      if (!node) {
        node = sprite("bee_a", 0, 0, 20, 20);
        this.bees.set(bee, node);
        this.beeLayer.addChild(node);
      }
      const at = bee.position;
      node.texture = art.texture(picture);
      node.position.set(at.x, Y(at.y));
      node.scale.x = Math.abs(node.scale.x) * bee.facing;
    }
  }

  private drawEffects() {
    const sim = this.sim, now = sim.elapsed;
    for (const effect of sim.effects) {
      // Sawdust is a burst from the effects kit, set off by the cut itself.
      if (effect.kind !== "chips" && !this.effects.has(effect)) this.effects.set(effect, this.effectNode(effect));
    }
    const liveSet = new Set(sim.effects);
    for (const [effect, entry] of this.effects) {
      const age = now - effect.at;
      if (!liveSet.has(effect)) { entry.node.destroy({ children: true }); this.effects.delete(effect); continue; }
      if (effect.kind === "trim") {
        // The dots hold for 0.2 s, then fade.
        entry.node.alpha = 1 - Math.min(1, Math.max(0, (age - 0.2) / decorative(0.4)));
      } else if (effect.kind === "reject") {
        // The refused ink holds for 0.15 s and fades; its reason stays a little longer.
        entry.node.children[0].alpha = 1 - Math.min(1, Math.max(0, (age - 0.15) / decorative(0.35)));
        if (entry.text) entry.text.alpha = 1 - Math.min(1, Math.max(0, (age - 0.7) / 0.3));
      }
    }
  }

  private effectNode(effect: Exclude<Effect, { kind: "chips" }>): EffectNode {
    const node = new Container();
    node.zIndex = 60;
    this.root.addChild(node);
    if (effect.kind === "trim") {
      const g = new Graphics();
      for (const p of effect.points) g.circle(p.x, Y(p.y), 2);
      g.fill({ color: Pigment.rose, alpha: 0.8 });
      node.addChild(g);
      return { node };
    }
    const g = new Graphics(), first = effect.points[0];
    if (effect.points.length === 1) g.circle(first.x, Y(first.y), 4).fill(Pigment.rose);
    else {
      g.position.set(0, Y(0));
      inkLine(g, effect.points, Pigment.rose, WIDTH);
    }
    const text = label(effect.reason, 14, Pigment.clayDark);
    text.position.set(effect.label.x, Y(effect.label.y) - 5);
    node.addChild(g, text);
    return { node, text };
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
