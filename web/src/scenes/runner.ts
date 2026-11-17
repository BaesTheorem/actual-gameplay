// Crowd Run on screen: the simulation in sim/runner.ts, drawn.
import { CanvasTextMetrics, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import * as art from "../app/art";
import type { Cue } from "../sim/clock";
import {
  BLAST_RADIUS, BRIDGE_HALF, GateOp, Gates, Hammer, Hazard, Projection, ROAD_HALF, RUNNER_HEIGHT, Reward, RunnerEconomy, RunnerSim, startRun,
  type Crowd, type Item, type Label, type Leaver, type Member, type Piece,
} from "../sim/runner";
import type { Vec } from "../sim/sk";
import { ClipSprite, Fx, MARKER, Pigment, W, Y, paper, reducedMotion, sprite, type BurstOptions, type Scene } from "./kit";

export const RUNNER_ART = [
  "paper", "background_color_hills", "clawd_run", "clawd_foe_run", "clawd_foe_idle", "clawd_boss_idle", "clawd_boss_hit",
  "block_danger", "saw_a", "saw_b", "spikes", "block_planks", "bomb", "item_potion", "coin_gold",
];

/// What a world looks like: flat washes. `sky` is a wash over the paper above the horizon, and
/// `hills` are two tones drawn in code; the meadow keeps the painted hills and the bare paper.
interface Look { ground: number; road: number; pit: number; sky: number | null; hills: [number, number] | null; lights: boolean }
const LOOKS: Look[] = [
  // Meadow: sap mixed into the paper for the verge, a dusty path.
  { ground: 0xa9c48f, road: 0xcdb894, pit: Pigment.teal, sky: null, hills: null, lights: false },
  // Dunes: sand, a packed track, ochre dunes.
  { ground: 0xe6cf9a, road: 0xc99e6e, pit: Pigment.clayDark, sky: null, hills: [0xd9b36a, Pigment.ochre], lights: false },
  // Snow: snow, slush on the road, ice hills.
  { ground: 0xe6eff2, road: 0xc4cfd8, pit: Pigment.teal, sky: null, hills: [0xbbd7e4, Pigment.sky], lights: false },
  // Night: an indigo verge under a night sky, and a road pale enough for ink to read on.
  { ground: Pigment.indigo, road: 0xa5a2bd, pit: Pigment.night, sky: Pigment.night, hills: [0x3a4580, Pigment.indigo], lights: true },
];

const Palette = {
  edge: Pigment.ink,
  stripe: Pigment.ink,
  good: Pigment.sap,
  bad: 0xe2476e,
  bossBar: Pigment.clay,
  bossTrack: Pigment.night,
  label: Pigment.ink,
  plank: 0xa9734a,
};

const PANEL_W = Projection.halfRoad - 8, PANEL_H = 96;
const BOSS_HEIGHT = 110;
/// No text on the stage is smaller than this, in points. A label on something far up the road
/// stops shrinking here, and is hidden once the thing is too small to carry it.
const MIN_TEXT = 13;
/// Things further up the road than this carry no words. A crate shows what it holds as a
/// picture from there, and adds the number once it is this near.
const TEXT_FAR = 22, CONTENTS_NEAR = 10;
/// The size of the word on a rate or range gate, over its number.
const CAPTIONED = 24;
/// Pellets drawn at once, at most, and thrown each second, at most. A phone keeps 60 frames a second with these.
const PELLETS = 48, PELLET_RATE = 44;
/// How long a pellet flies, in seconds.
const PELLET_FLIGHT = 0.26;

// What each moment looks like. Small and short: the road has to stay readable through it.
const UP = Math.PI / 2;
const GAIN: BurstOptions = { count: 7, color: Palette.good, shape: "star", speed: 120, life: 0.45, size: 3.2, gravity: 160, angle: UP, spread: 2.4 };
const LOSS: BurstOptions = { count: 7, color: Pigment.rose, shape: "shard", speed: 140, life: 0.4, size: 2.8, gravity: 380, angle: UP, spread: 2.8 };
const DUST: BurstOptions = { count: 9, color: Pigment.cream, shape: "dot", speed: 110, life: 0.45, size: 3, gravity: -40 };
const CHIPS: BurstOptions = { count: 5, color: Palette.plank, shape: "shard", speed: 90, life: 0.35, size: 2.2, gravity: 420, angle: UP, spread: 2.6 };
const PLANKS: BurstOptions = { count: 10, color: Palette.plank, shape: "paper", speed: 170, life: 0.5, size: 4, gravity: 480, angle: UP, spread: 3 };
const BLAST: BurstOptions = { count: 10, color: Pigment.ochre, shape: "shard", speed: 220, life: 0.45, size: 4, gravity: 300 };
const EMBERS: BurstOptions = { count: 8, color: Pigment.clay, shape: "dot", speed: 150, life: 0.5, size: 2.6, gravity: -60 };
const RIVALS: BurstOptions = { count: 8, color: Pigment.violet, shape: "dot", speed: 120, life: 0.4, size: 3, gravity: 300, angle: UP, spread: 2.6 };
const SPARKS: BurstOptions = { count: 10, color: Pigment.ochre, shape: "star", speed: 180, life: 0.5, size: 3.6, gravity: 200 };
const SPLAT: BurstOptions = { count: 1, color: Pigment.ink, shape: "dot", speed: 40, life: 0.18, size: 1.4, outline: false };

/// A label in Permanent Marker. `baseline` puts the text's baseline on its position, as the
/// count labels sit; without it the text is centred on the position.
const marker = (size: number, baseline: boolean, fill: number = Palette.label): Text => {
  const label = new Text({ text: "", style: { fontFamily: MARKER, fontSize: size, fill }, resolution: 3 });
  let anchorY = 0.5;
  if (baseline) {
    const m = CanvasTextMetrics.measureFont(`${size}px "${MARKER}"`);
    if (m.ascent + m.descent > 0) anchorY = m.ascent / (m.ascent + m.descent);
  }
  label.anchor.set(0.5, anchorY);
  return label;
};

/// Keep a label of `size` points readable inside a node drawn at depth scale `s`: it shrinks
/// with the node until it would be under MIN_TEXT points on the stage, and holds there.
const legible = (label: Container, size: number, s: number) => {
  label.scale.set(Math.max(1, MIN_TEXT / (size * s)));
};

/// A number on a cream plate with an ink edge. The plate fits its number.
class Plate extends Container {
  private g = new Graphics();
  private number: Text;
  private shown = "";

  constructor(private size: number) {
    super();
    this.number = marker(size, false);
    this.addChild(this.g, this.number);
  }

  set(text: string) {
    if (text === this.shown) return;
    this.shown = text;
    this.number.text = text;
    const w = Math.max(this.size * 1.4, this.number.width + 10), h = this.size + 6;
    this.g.clear().roundRect(-w / 2, -h / 2, w, h, 6).fill(Pigment.cream).stroke({ color: Pigment.ink, width: 2 });
  }
}

/// One runner on screen: a plain sprite that steps through the clip's shared frames.
interface Runner {
  sprite: Sprite;
  /// The frame it started on, and the moment on the draw clock it was made.
  start: number;
  born: number;
}

/// The sprites of one crowd. Every runner shares the clip's frame textures, so the whole crowd
/// draws as one batch whatever frame each runner is on.
class CrowdView {
  private readonly frames: Texture[];
  private readonly fps: number;
  /// Sprite scale at depth scale 1.
  private readonly base: number;
  private readonly anchor: [number, number];
  private members = new Map<Member, Runner>();
  private leavers = new Map<Leaver, Runner>();
  private spare: Sprite[] = [];
  private clock = 0;

  constructor(private crowd: Crowd, clip: string, private layer: Container) {
    const e = art.entry(clip);
    this.frames = art.textures(clip);
    // A runner is drawn at a sixth of the size it was painted, or smaller. Mipmaps keep the ink
    // lines and the pale brush flecks from turning into speckle at that size.
    const source = this.frames[0].source;
    if (!source.autoGenerateMipmaps) {
      source.autoGenerateMipmaps = true;
      source.update();
    }
    this.fps = Math.max(1, e?.fps ?? 10);
    this.base = RUNNER_HEIGHT / (e?.h ?? this.frames[0].height);
    // The manifest measures the anchor from the bottom edge.
    this.anchor = [e?.anchor[0] ?? 0.5, 1 - (e?.anchor[1] ?? 0)];
  }

  private make(index: number): Runner {
    const s = this.spare.pop() ?? new Sprite();
    s.anchor.set(this.anchor[0], this.anchor[1]);
    s.visible = true;
    s.alpha = 1;
    this.layer.addChild(s);
    // Each runner starts on a different frame of the cycle.
    return { sprite: s, start: (index * 5) % this.frames.length, born: this.clock };
  }

  private retire(runner: Runner) {
    runner.sprite.removeFromParent();
    this.spare.push(runner.sprite);
  }

  draw(dt: number, hidden: boolean, short: boolean) {
    const crowd = this.crowd;
    this.clock += dt;
    // Runners that left the formation since the last draw. A leaver takes over its runner's sprite.
    const gone: [Member, Runner][] = [];
    if (this.members.size !== crowd.members.length || crowd.members.some((m) => !this.members.has(m))) {
      const live = new Set(crowd.members);
      for (const pair of this.members) {
        if (!live.has(pair[0])) { gone.push(pair); this.members.delete(pair[0]); }
      }
    }
    for (const leaver of crowd.leavers) {
      if (this.leavers.has(leaver)) continue;
      const at = gone.findIndex(([m]) => m.phase === leaver.phase);
      this.leavers.set(leaver, at >= 0 ? gone.splice(at, 1)[0][1] : this.make(Math.round(leaver.phase / 0.7)));
    }
    for (const [, runner] of gone) this.retire(runner);
    if (this.leavers.size > 0) {
      const leaving = new Set(crowd.leavers);
      for (const [leaver, runner] of this.leavers) {
        if (!leaving.has(leaver)) { this.retire(runner); this.leavers.delete(leaver); }
      }
    }

    const fadeIn = short ? 0.1 : 0.15;
    for (const member of crowd.members) {
      let runner = this.members.get(member);
      if (!runner) {
        runner = this.make(member.index);
        this.members.set(member, runner);
      }
      const pose = crowd.pose(member), s = runner.sprite;
      s.visible = !hidden;
      if (hidden) continue;
      s.texture = this.frame(runner);
      s.position.set(pose.position.x, Y(pose.position.y));
      s.scale.set(this.base * pose.xScale, this.base * pose.yScale);
      s.zIndex = pose.zPosition;
      s.alpha = member.fadeIn ? Math.min(1, member.age / fadeIn) : 1;
    }
    // A leaver stays where it left, drops and fades.
    for (const [leaver, runner] of this.leavers) {
      const s = runner.sprite, t = Math.min(1, leaver.age / leaver.duration);
      const scale = Projection.scale(leaver.z), at = Projection.point(leaver.x, leaver.z);
      s.visible = !hidden;
      s.texture = this.frame(runner);
      s.position.set(at.x, Y(at.y - leaver.drop * t));
      s.scale.set(this.base * scale * crowd.facing, this.base * scale);
      s.zIndex = 100 - leaver.z;
      s.alpha = 1 - t;
    }
  }

  /// A point among the front runners, for a pellet to leave from.
  muzzle(pick: number): Vec {
    const members = this.crowd.members;
    if (members.length === 0) return Projection.point(this.crowd.anchorX, this.crowd.anchorZ);
    const pose = this.crowd.pose(members[Math.floor(pick * members.length) % members.length]);
    return { x: pose.position.x, y: pose.position.y + 16 };
  }

  private frame(runner: Runner): Texture {
    return this.frames[(runner.start + Math.floor((this.clock - runner.born) * this.fps)) % this.frames.length];
  }
}

/// One piece on screen. `words` are the labels that keep a readable size, with the size each
/// was made at. `tick` brings whatever moves by itself up to date.
interface PieceView {
  item: Item;
  node: Container;
  words: [Container, number][];
  tick?: (sim: RunnerSim, s: number, short: boolean) => void;
  /// A gate pair is two panels placed one by one; everything else is one node on its middle.
  panels?: { left: Container; right: Container };
}

let pelletTexture: Texture | null = null;
/// A pellet: an ink dot with a cream core, drawn once and shared by every pellet.
const pelletArt = (): Texture => {
  if (pelletTexture) return pelletTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 24;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2b2233";
  ctx.beginPath(); ctx.arc(12, 12, 10, 0, 7); ctx.fill();
  ctx.fillStyle = "#fff5e2";
  ctx.beginPath(); ctx.arc(12, 12, 3.4, 0, 7); ctx.fill();
  pelletTexture = Texture.from(canvas);
  return pelletTexture;
};

interface Pellet { s: Sprite; age: number; from: Vec; to: Vec; live: boolean }

/// The pellet glyph for a label: the same dot, with two ink ticks behind it for speed.
const pelletGlyph = (r: number): Graphics =>
  new Graphics().circle(0, 0, r).fill(Pigment.ink).circle(0, 0, r * 0.42).fill(Pigment.cream)
    .moveTo(-r * 1.5, -r * 0.5).lineTo(-r * 2.6, -r * 0.5).moveTo(-r * 1.5, r * 0.5).lineTo(-r * 2.3, r * 0.5).stroke({ color: Pigment.ink, width: Math.max(1.2, r * 0.3), cap: "round" });

export class RunnerScene implements Scene {
  readonly root = new Container();
  readonly sim: RunnerSim;
  readonly title: string;
  private cues: Cue[] = [];
  private stripes: Graphics[] = [];
  private views: PieceView[] = [];
  private bridges = new Graphics();
  private slamWash = new Graphics();
  private crowd: CrowdView;
  private enemy: CrowdView | null = null;
  private boss: Container | null = null;
  private bossSprite: ClipSprite | null = null;
  private bossBar: Graphics | null = null;
  private countLabel = marker(22, true);
  private enemyLabel = marker(20, true);
  private pellets: Pellet[] = [];
  private pelletLayer = new Container();
  private pelletDebt = 0;
  private pelletPick = 0.37;
  private fx = new Fx(210);
  private look: Look;

  /// `level` is the 0-based run.
  constructor(level: number, economy: RunnerEconomy, private onCue: (cue: Cue) => void) {
    this.sim = startRun(level, economy, (cue) => this.cues.push(cue));
    this.sim.reducedMotion = reducedMotion();
    this.title = this.sim.hud.title;
    this.look = LOOKS[this.sim.world.look];
    this.root.sortableChildren = true;
    this.crowd = new CrowdView(this.sim.crowd, "clawd_run", this.root);
    this.build();
  }

  private build() {
    const { sim, root, look } = this;
    root.addChild(paper("paper"));
    if (look.sky !== null) {
      const sky = new Graphics().rect(0, 0, W, Y(Projection.horizonY)).fill(look.sky);
      sky.zIndex = -21;
      root.addChild(sky);
    }
    if (look.lights) root.addChild(nightLights());
    root.addChild(look.hills ? hills(look.hills) : sprite("background_color_hills", 201, Projection.horizonY + 130 - 60, 402, 260, -20));
    const ground = new Graphics().rect(0, Y(Projection.horizonY), W, Projection.horizonY).fill(look.ground);
    ground.zIndex = -19;
    const road = new Graphics().poly(Projection.roadPolygon.flatMap((p) => [p.x, Y(p.y)]))
      .fill(look.road).stroke({ color: Palette.edge, width: 2 });
    road.zIndex = -18;
    const horizon = new Graphics().rect(0, Y(Projection.horizonY) - 0.75, W, 1.5).fill(Palette.edge);
    this.bridges.zIndex = -17;
    this.slamWash.zIndex = -16;
    root.addChild(ground, road, horizon, this.bridges, this.slamWash);
    for (let i = 0; i < sim.stripes.length; i++) {
      const stripe = new Graphics().rect(-3, -10, 6, 20).fill({ color: Palette.stripe, alpha: 0.45 });
      stripe.zIndex = 1;
      this.stripes.push(stripe);
      root.addChild(stripe);
    }
    for (const item of sim.items) {
      const view = pieceView(item);
      if (!view) continue;
      view.node.visible = false;
      this.views.push(view);
      root.addChild(view.node);
    }
    if (sim.enemy) this.enemy = new CrowdView(sim.enemy, "clawd_foe_run", root);
    if (sim.boss) {
      const node = new Container();
      const body = new ClipSprite("clawd_boss_idle", BOSS_HEIGHT);
      const track = new Graphics().roundRect(-45, -96 - 4.5, 90, 9, 4.5).fill(Palette.bossTrack).stroke({ color: Palette.edge, width: 1.5 });
      const bar = new Graphics().rect(0, -3, 87, 6).fill(Palette.bossBar);
      bar.position.set(-43.5, -96);
      node.addChild(body, track, bar);
      this.boss = node;
      this.bossSprite = body;
      this.bossBar = bar;
      root.addChild(node);
    }
    for (let i = 0; i < PELLETS; i++) {
      const s = new Sprite(pelletArt());
      s.anchor.set(0.5);
      s.visible = false;
      this.pelletLayer.addChild(s);
      this.pellets.push({ s, age: 0, from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, live: false });
    }
    this.pelletLayer.zIndex = 150;
    this.countLabel.zIndex = this.enemyLabel.zIndex = 200;
    root.addChild(this.pelletLayer, this.countLabel, this.enemyLabel, this.fx.layer);
    this.draw(0);
  }

  readout() { return this.sim.hud.readout; }
  progress() { return Math.min(1, this.sim.travel / this.sim.track.finaleZ); }
  outcome() { return this.sim.outcome; }

  /// A drag steers the crowd. Only the finger's x matters.
  pointer(type: "down" | "move" | "up", point: Vec) {
    if (type === "down") this.sim.dragBegan(point.x);
    else if (type === "move") this.sim.dragMoved(point.x);
    else this.sim.dragEnded();
  }

  step() {
    this.sim.frame();
    for (const cue of this.cues) {
      if (cue.type === "fx") this.effect(cue.name, cue.x, cue.y, cue.n ?? 0);
      else if (cue.type !== "mood") this.onCue(cue);
    }
    this.cues.length = 0;
  }

  /// What the player sees for each moment the simulation reports. `n` is the number that goes
  /// with it: a change in the crowd, what a crate gave, how far a blast reaches.
  private effect(name: string, x: number, y: number, n: number) {
    const fx = this.fx;
    // A change in the crowd floats up from just over the crowd's own count.
    const over = this.sim.countLabel.position.y + 26;
    const lost = (size = 22) => { if (n !== 0) fx.text(x, over, `${n}`, { color: Pigment.rose, size }); fx.burst(x, y + 14, LOSS); };
    switch (name) {
      case "gate":
        if (n === 0) return;
        fx.text(x, over, n > 0 ? `+${n}` : `${n}`, { color: n > 0 ? Palette.good : Pigment.rose, size: 24 });
        return fx.burst(x, y + 14, n > 0 ? GAIN : LOSS);
      case "gateRate":
        fx.text(x, over, `${n > 0 ? "+" : ""}${n}% fire`, { color: n > 0 ? Palette.good : Pigment.rose, size: 20 });
        return fx.burst(x, y + 14, n > 0 ? GAIN : LOSS);
      case "gateRange":
        fx.text(x, over, `+${n} range`, { color: Palette.good, size: 20 });
        return fx.burst(x, y + 14, GAIN);
      case "crateCrack": return fx.burst(x, y, CHIPS);
      case "crateAllies": case "crateTimes": case "crateRate": case "crateCoins": {
        const words = name === "crateAllies" ? `+${n}` : name === "crateTimes" ? `×${n}` : name === "crateRate" ? `+${n}% fire` : `+${n} coins`;
        fx.burst(x, y, PLANKS);
        fx.ring(x, y, Pigment.cream);
        return fx.text(x, y + 18, words, { color: name === "crateCoins" ? Pigment.ochre : Palette.good, size: 22 });
      }
      case "blast":
        fx.burst(x, y, BLAST);
        fx.burst(x, y, EMBERS);
        fx.ring(x, y, Pigment.ochre, n);
        return fx.shake(5, 0.3);
      case "squadDown": return fx.burst(x, y, RIVALS);
      case "squadTrade": lost(); fx.burst(x, y + 24, RIVALS); return fx.shake(3, 0.2);
      case "hazard": case "hammerHit": case "bridgeFall": lost(); return fx.shake(3, 0.2);
      case "hammer": fx.burst(x, y, DUST); return fx.shake(2 + 3 * n, 0.2);
      case "slam":
        fx.burst(x, y, DUST);
        fx.ring(x, y, Pigment.rose, 90);
        if (n < 0) fx.text(this.sim.countLabel.position.x, over, `${n}`, { color: Pigment.rose, size: 24 });
        return fx.shake(5, 0.3);
      case "bossDown": fx.burst(x, y, SPARKS); return fx.ring(x, y, Pigment.ochre, 50);
      case "finale":
        fx.ring(x, y + 10, Pigment.cream);
        fx.burst(x, y + 10, DUST);
        return fx.shake(4, 0.25);
      case "win": return fx.confetti();
    }
  }

  draw(dt: number) {
    const sim = this.sim, short = reducedMotion();
    sim.stripes.forEach((z, i) => {
      const stripe = this.stripes[i], at = Projection.point(0, z);
      stripe.position.set(at.x, Y(at.y));
      stripe.scale.set(Projection.scale(z));
      stripe.visible = z > 1;
    });
    this.bridges.clear();
    for (const view of this.views) {
      const { item, node } = view;
      // A crate that broke, and anything a blast or the crowd cleared, is gone at once: the effect marks the spot.
      const show = item.visible && item.ended === null;
      node.visible = show && item.kind !== "bridge";
      if (item.kind === "bridge" && item.visible) this.drawBridge(item);
      if (!node.visible) continue;
      const s = Projection.scale(item.ahead), near = item.ahead < TEXT_FAR;
      node.zIndex = 100 - item.ahead;
      for (const [label, size] of view.words) {
        // A label that is holding its smallest size on a thing too small for it is left off. A
        // gate's two-line label is the widest, and needs its panel 60 points across.
        label.visible = near && (size === CAPTIONED ? s >= 0.37 : size * s * 2.2 >= MIN_TEXT);
        if (near) legible(label, size, s);
      }
      if (view.panels && item.piece.kind === "gates") {
        const divider = Gates.divider(item.piece, sim.time);
        const l = Projection.point(divider - 0.5, item.ahead), r = Projection.point(divider + 0.5, item.ahead);
        view.panels.left.position.set(l.x, Y(l.y));
        view.panels.right.position.set(r.x, Y(r.y));
        view.panels.left.scale.set(s);
        view.panels.right.scale.set(s);
        if (item.tookLeft !== null) {
          // The taken panel holds for a moment, then both fade over 0.3 s.
          const since = sim.time - item.endedAt;
          const held = 1 - Math.min(1, Math.max(0, (since - 0.05) / 0.3)), plain = 1 - Math.min(1, since / 0.3);
          view.panels.left.alpha = item.tookLeft ? held : plain;
          view.panels.right.alpha = item.tookLeft ? plain : held;
        }
        continue;
      }
      const span = item.target ? { lo: item.lo, hi: item.hi } : Hazard.span(item.piece, sim.time);
      const at = Projection.point(item.kind === "hammer" ? 0 : (span.lo + span.hi) / 2, item.ahead);
      node.position.set(at.x, Y(at.y));
      node.scale.set(s);
      view.tick?.(sim, s, short);
    }
    this.drawSlam();
    this.crowd.draw(dt, false, short);
    this.enemy?.draw(dt, sim.enemyHidden, short);
    if (this.boss && sim.boss && this.bossSprite && this.bossBar) {
      const at = Projection.point(0, sim.boss.z);
      this.boss.visible = sim.boss.visible;
      this.boss.position.set(at.x, Y(at.y));
      this.boss.scale.set(Projection.scale(sim.boss.z));
      this.boss.zIndex = 100 - sim.boss.z;
      this.bossSprite.play(sim.boss.clip);
      this.bossSprite.tick(dt);
      this.bossBar.scale.x = Math.max(0, Math.min(1, sim.boss.bar));
    }
    this.drawPellets(dt, short);
    place(this.countLabel, sim.countLabel);
    place(this.enemyLabel, sim.enemyLabel);
    this.fx.tick(dt);
    this.root.position.set(this.fx.offset.x, this.fx.offset.y);
  }

  /// A bridge: the road's two outer thirds are gone for its length, and the middle is planked.
  private drawBridge(item: Item) {
    if (item.piece.kind !== "bridge") return;
    const g = this.bridges, a = Math.max(item.ahead, 0), b = Math.min(item.ahead + item.piece.length, Projection.farZ);
    if (b <= a) return;
    const quad = (x0: number, x1: number) => [Projection.point(x0, a), Projection.point(x1, a), Projection.point(x1, b), Projection.point(x0, b)].flatMap((p) => [p.x, Y(p.y)]);
    g.poly(quad(-1, -BRIDGE_HALF)).fill(this.look.pit).stroke({ color: Pigment.ink, width: 2 });
    g.poly(quad(BRIDGE_HALF, 1)).fill(this.look.pit).stroke({ color: Pigment.ink, width: 2 });
    g.poly(quad(-BRIDGE_HALF, BRIDGE_HALF)).fill({ color: Palette.plank, alpha: 0.55 });
    // A plank line for every lane unit of bridge, where the planks were laid.
    for (let z = Math.ceil(a - item.ahead); item.ahead + z <= b; z++) {
      const l = Projection.point(-BRIDGE_HALF, item.ahead + z), r = Projection.point(BRIDGE_HALF, item.ahead + z);
      g.moveTo(l.x, Y(l.y)).lineTo(r.x, Y(r.y));
    }
    g.stroke({ color: Pigment.ink, width: 1.2, alpha: 0.55 });
  }

  /// The boss's warning: a rose wash on the half of the road its slam will land on.
  private drawSlam() {
    const g = this.slamWash, slam = this.sim.slam;
    g.clear();
    if (!slam || slam.stage !== "warned" || !this.sim.boss) return;
    const far = Math.min(this.sim.boss.z, Projection.farZ), x0 = slam.side < 0 ? -1 : 0, x1 = slam.side < 0 ? 0 : 1;
    const points = [Projection.point(x0, 0), Projection.point(x1, 0), Projection.point(x1, far), Projection.point(x0, far)].flatMap((p) => [p.x, Y(p.y)]);
    // It beats four times in its second, so it reads as a warning and not as paint. Under reduced motion it holds.
    const beat = reducedMotion() ? 1 : 0.75 + 0.25 * Math.cos((this.sim.time - slam.warnedAt) * Math.PI * 8);
    g.poly(points).fill({ color: Pigment.rose, alpha: 0.6 * beat }).stroke({ color: Pigment.ink, width: 2 });
  }

  /// Pellets from the crowd to whatever the simulation says is being shot. The stream is as
  /// dense as the firepower, up to a cap.
  private drawPellets(dt: number, short: boolean) {
    const sim = this.sim;
    let to: Vec | null = null;
    if (sim.shooting && !sim.finished) {
      const item = sim.shooting, at = Projection.point((item.lo + item.hi) / 2, item.ahead);
      to = { x: at.x, y: at.y + 22 * Projection.scale(item.ahead) };
    } else if (sim.shootingFinale && !sim.finished) {
      const z = sim.finaleAt - sim.travel, at = Projection.point(0, z);
      to = { x: at.x, y: at.y + (sim.boss ? 50 : 16) * Projection.scale(z) };
    }
    if (to) {
      const rate = Math.min(PELLET_RATE, 16 + 1.1 * sim.crowd.count * sim.rate) * (short ? 0.5 : 1);
      this.pelletDebt = Math.min(4, this.pelletDebt + rate * dt);
      while (this.pelletDebt >= 1) {
        this.pelletDebt -= 1;
        const pellet = this.pellets.find((p) => !p.live);
        if (!pellet) break;
        this.pelletPick = (this.pelletPick * 7.13 + 0.31) % 1;
        pellet.live = true;
        pellet.age = 0;
        pellet.from = this.crowd.muzzle(this.pelletPick);
        // Each lands a little off the middle, so the stream has some width.
        pellet.to = { x: to.x + (this.pelletPick - 0.5) * 14 * Projection.scale(sim.shooting?.ahead ?? 8), y: to.y };
        pellet.s.visible = true;
      }
    }
    for (const pellet of this.pellets) {
      if (!pellet.live) continue;
      pellet.age += dt;
      const t = pellet.age / PELLET_FLIGHT;
      if (t >= 1) {
        pellet.live = false;
        pellet.s.visible = false;
        if (!short) this.fx.burst(pellet.to.x, pellet.to.y, SPLAT);
        continue;
      }
      const x = pellet.from.x + (pellet.to.x - pellet.from.x) * t, y = pellet.from.y + (pellet.to.y - pellet.from.y) * t;
      pellet.s.position.set(x, Y(y + 10 * Math.sin(Math.PI * t)));
      // A pellet shrinks as it goes up the road: 9 points across when it leaves, 5 when it lands.
      pellet.s.scale.set((9 - 4 * t) / 24);
    }
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}

const place = (text: Text, label: Label) => {
  text.visible = !label.hidden;
  if (label.hidden) return;
  if (text.text !== label.text) text.text = label.text;
  text.position.set(label.position.x, Y(label.position.y));
};

/// Hills as two flat washes with an ink line, for the worlds that are not painted.
const hills = (tones: [number, number]): Container => {
  const node = new Container(), base = Y(Projection.horizonY);
  const ridge = (g: Graphics, heights: number[], color: number) => {
    g.moveTo(0, base);
    heights.forEach((h, i) => {
      const x = (W * i) / (heights.length - 1);
      if (i === 0) g.lineTo(0, base - h);
      else {
        const px = (W * (i - 1)) / (heights.length - 1), ph = heights[i - 1];
        g.quadraticCurveTo((px + x) / 2, base - Math.max(h, ph) - 14, x, base - h);
      }
    });
    g.lineTo(W, base).closePath().fill(color).stroke({ color: Pigment.ink, width: 1.5 });
  };
  const back = new Graphics(), front = new Graphics();
  ridge(back, [30, 58, 24, 66, 36], tones[1]);
  ridge(front, [46, 14, 40, 10, 30], tones[0]);
  node.addChild(back, front);
  node.zIndex = -20;
  return node;
};

/// The night sky: a moon and a few stars, flat cream.
const nightLights = (): Graphics => {
  const g = new Graphics().circle(318, 150, 20).fill(Pigment.cream).stroke({ color: Pigment.ink, width: 1.5 });
  for (const [x, y] of [[44, 120], [96, 170], [150, 112], [212, 150], [262, 196], [364, 205], [28, 205], [186, 208]]) g.circle(x, y, 1.6).fill(Pigment.cream);
  g.zIndex = -20.5;
  return g;
};

/// One gate panel: a wash of colour, an ink frame, the operation, and for a rate or range gate
/// the word for it and the pellet glyph.
const panel = (op: GateOp, words: [Container, number][]): Container => {
  const node = new Container();
  const fill = new Graphics().rect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H)
    .fill({ color: GateOp.isGood(op) ? Palette.good : Palette.bad, alpha: 0.8 });
  const frame = new Graphics().roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 6).stroke({ color: Palette.edge, width: 2.5 });
  const text = new Container(), label = marker(36, false);
  label.text = GateOp.label(op);
  text.addChild(label);
  const caption = GateOp.caption(op);
  if (caption) {
    const small = marker(CAPTIONED, false);
    small.text = caption;
    label.y = 16;
    small.y = -24;
    text.addChild(small);
    if (op.kind === "rate") {
      const glyph = pelletGlyph(7);
      glyph.position.set(-small.width / 2 - 6, -24);
      small.x = 12;
      text.addChild(glyph);
    }
  }
  node.addChild(fill, frame, text);
  // The caption is the smaller of the two, so it is what the whole label is kept readable by.
  words.push([text, caption ? CAPTIONED : 36]);
  return node;
};

/// What a crate holds, as a small picture and its number, to stand over the crate.
const contents = (reward: Reward): { node: Container; near: (yes: boolean) => void } => {
  const node = new Container(), label = marker(20, false);
  label.text = Reward.label(reward);
  let picture: Container;
  if (reward.kind === "rate") picture = pelletGlyph(7);
  else {
    const name = reward.kind === "allies" ? "clawd_run" : reward.kind === "times" ? "item_potion" : "coin_gold";
    const s = new Sprite(art.texture(name)), size = art.size(name), tall = reward.kind === "allies" ? 30 : 24;
    s.anchor.set(0.5);
    s.scale.set(tall / size.h / art.PIXELS_PER_POINT);
    picture = s;
  }
  // The picture and the number sit side by side on one plate.
  const wide = reward.kind === "allies" ? 30 : reward.kind === "rate" ? 26 : 22, total = wide + 4 + label.width;
  picture.x = -total / 2 + wide / 2 + (reward.kind === "rate" ? 5 : 0);
  label.x = total / 2 - label.width / 2;
  const plate = new Graphics().roundRect(-total / 2 - 7, -16, total + 14, 32, 6).fill(Pigment.cream).stroke({ color: Pigment.ink, width: 2 });
  node.addChild(plate, picture, label);
  const home = picture.x;
  // Far up the road there is room for the picture and no more. The number joins it on a plate
  // once the crate is near enough to carry both.
  const near = (yes: boolean) => {
    plate.visible = label.visible = yes;
    picture.x = yes ? home : 0;
  };
  return { node, near };
};

/// The view of one piece, drawn around its own origin at depth scale 1.
const pieceView = (item: Item): PieceView | null => {
  const node = new Container(), piece: Piece = item.piece, words: [Container, number][] = [];
  const width = (item.hi - item.lo) * Projection.halfRoad;
  const tile = (name: string, x: number, y: number, w: number, h: number) => {
    const s = sprite(name, x, 0, w, h);
    s.y = y;
    node.addChild(s);
    return s;
  };
  switch (piece.kind) {
    case "gates": {
      const left = panel(piece.left, words), right = panel(piece.right, words);
      node.addChild(left, right);
      return { item, node, words, panels: { left, right } };
    }
    case "crate": {
      // Plank tiles side by side with an ink edge, cracks that show as it is shot, the hit
      // points on a plate on its face, and what it holds on a plate above it.
      const tall = 46, tiles = Math.max(1, Math.round(width / tall));
      for (let i = 0; i < tiles; i++) tile("block_planks", -width / 2 + (width / tiles) * (i + 0.5), -tall / 2, width / tiles, tall);
      node.addChild(new Graphics().rect(-width / 2, -tall, width, tall).stroke({ color: Pigment.ink, width: 2.5 }));
      const cracks = [new Graphics(), new Graphics()];
      cracks[0].moveTo(-width * 0.3, -tall).lineTo(-width * 0.18, -tall * 0.62).lineTo(-width * 0.3, -tall * 0.3).stroke({ color: Pigment.ink, width: 2 });
      cracks[1].moveTo(width * 0.34, -tall).lineTo(width * 0.2, -tall * 0.5).lineTo(width * 0.32, -tall * 0.12).lineTo(width * 0.22, 0).stroke({ color: Pigment.ink, width: 2 });
      const plate = new Plate(20), holds = contents(piece.holds);
      plate.y = -tall / 2;
      holds.node.y = -tall - 21;
      node.addChild(...cracks, plate, holds.node);
      words.push([plate, 20], [holds.node, 20]);
      return {
        item, node, words, tick: () => {
          plate.set(String(item.shown));
          holds.near(item.ahead < CONTENTS_NEAR);
          cracks[0].visible = item.cracks >= 1;
          cracks[1].visible = item.cracks >= 2;
        },
      };
    }
    case "barrel": {
      // The reach of its blast is a dashed ochre line on the road around it.
      const reach = (BLAST_RADIUS / ROAD_HALF) * Projection.halfRoad, ring = new Graphics();
      for (let i = 0; i < 20; i += 2) ring.arc(0, 0, reach, (i * Math.PI) / 10, ((i + 1) * Math.PI) / 10).stroke({ color: Pigment.ochre, width: 3 });
      ring.scale.y = 0.3;
      tile("bomb", 0, -22, 46, 46);
      const plate = new Plate(16);
      plate.y = -50;
      node.addChild(ring, plate);
      node.setChildIndex(ring, 0);
      words.push([plate, 16]);
      return { item, node, words, tick: () => plate.set(String(item.shown)) };
    }
    case "squad": {
      // A block of violet runners. It thins as it is shot, and its count is on a plate over it.
      const frame = art.texture("clawd_foe_idle", 2), size = art.size("clawd_foe_idle"), e = art.entry("clawd_foe_idle");
      const columns = Math.max(2, Math.min(9, Math.round(width / 30))), rows = 2, runners: Sprite[] = [];
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const s = new Sprite(frame);
          s.anchor.set(e?.anchor[0] ?? 0.5, 1 - (e?.anchor[1] ?? 0));
          s.scale.set(-RUNNER_HEIGHT / size.h / art.PIXELS_PER_POINT, RUNNER_HEIGHT / size.h / art.PIXELS_PER_POINT);
          s.position.set(-width / 2 + (width / columns) * (column + 0.5 + (row % 2) * 0.25 - 0.125), -row * 9);
          runners.push(s);
        }
      }
      // The back row is added first, so the front row stands over it.
      for (const s of [...runners].reverse()) node.addChild(s);
      const plate = new Plate(20);
      plate.y = -58;
      node.addChild(plate);
      words.push([plate, 20]);
      return {
        item, node, words, tick: () => {
          plate.set(`×${item.shown}`);
          const standing = Math.max(1, Math.ceil(runners.length * (item.hp / item.max)));
          runners.forEach((s, i) => { s.visible = i < standing; });
        },
      };
    }
    case "wall":
      for (let i = 0; i < 3; i++) tile("block_danger", -width / 3 + (width / 3) * i, 0, width / 3 + 1, 44);
      return { item, node, words };
    case "spikes":
      for (let i = 0; i < 4; i++) tile("spikes", -width * 0.375 + (width / 4) * i, 0, width / 4, 24);
      return { item, node, words };
    case "blade": {
      const saw = tile("saw_a", 0, 0, 64, 64);
      return { item, node, words, tick: (sim, _s, short) => { if (!short) saw.texture = art.texture(Math.floor(sim.time / 0.08) % 2 === 0 ? "saw_a" : "saw_b"); } };
    }
    case "hammer": {
      // A post on the middle line and a mallet that lies on one half of the road. On each beat
      // it lifts over the post and lands on the other half.
      const half = Projection.halfRoad, head = new Container();
      head.addChild(
        new Graphics().rect(0, -16, half * 0.5, 8).fill(Palette.plank).stroke({ color: Pigment.ink, width: 2 }),
        new Graphics().roundRect(half * 0.42, -30, half * 0.56, 34, 6).fill(Pigment.stone).stroke({ color: Pigment.ink, width: 2.5 }),
        new Graphics().rect(half * 0.5, -30, 8, 34).rect(half * 0.86, -30, 8, 34).fill(Pigment.ink),
      );
      const post = new Graphics().roundRect(-7, -44, 14, 46, 3).fill(Pigment.stone).stroke({ color: Pigment.ink, width: 2.5 });
      node.addChild(head, post);
      return {
        item, node, words, tick: (sim, _s, short) => {
          const side = Hammer.side(piece, sim.time), since = (sim.time + piece.offset) % piece.beat;
          const t = short ? 1 : Math.min(1, since / 0.16);
          // The swing: the head turns over from the old side to the new one, and is highest half way.
          head.scale.x = side * (2 * t - 1) || 0.01;
          head.y = -46 * Math.sin(Math.PI * t);
        },
      };
    }
    case "bridge": return { item, node, words };
  }
};
