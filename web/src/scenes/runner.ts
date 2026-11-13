// Crowd Run on screen: the simulation in sim/runner.ts, drawn.
import { CanvasTextMetrics, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import * as art from "../app/art";
import type { Cue } from "../sim/clock";
import {
  GateOp, Projection, RUNNER_HEIGHT, RunnerEconomy, RunnerSim,
  type Crowd, type GateState, type Label, type Leaver, type Member, type ObstacleState,
} from "../sim/runner";
import type { Vec } from "../sim/sk";
import { ClipSprite, MARKER, Pigment, W, Y, paper, reducedMotion, sprite, type Scene } from "./kit";

export const RUNNER_ART = [
  "paper", "background_color_hills", "clawd_run", "clawd_foe_run", "clawd_boss_idle", "clawd_boss_hit",
  "block_danger", "saw_a", "saw_b", "spikes",
];

const Palette = {
  /// A dusty path: light enough that brush flecks near the runners vanish and the violet rivals read.
  road: 0xcdb894,
  edge: Pigment.ink,
  /// Sap mixed into the paper, so the verge sits behind the road.
  ground: 0xa9c48f,
  stripe: Pigment.ink,
  good: Pigment.sap,
  bad: 0xe2476e,
  bossBar: Pigment.clay,
  bossTrack: Pigment.night,
  label: Pigment.ink,
};

const PANEL_W = Projection.halfRoad - 8, PANEL_H = 96;
const BOSS_HEIGHT = 110;

/// A label in Permanent Marker. `baseline` puts the text's baseline on its position, as the
/// count labels sit; without it the text is centred on the position.
const marker = (size: number, baseline: boolean): Text => {
  const label = new Text({ text: "", style: { fontFamily: MARKER, fontSize: size, fill: Palette.label }, resolution: 3 });
  let anchorY = 0.5;
  if (baseline) {
    const m = CanvasTextMetrics.measureFont(`${size}px "${MARKER}"`);
    if (m.ascent + m.descent > 0) anchorY = m.ascent / (m.ascent + m.descent);
  }
  label.anchor.set(0.5, anchorY);
  return label;
};

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

  private frame(runner: Runner): Texture {
    return this.frames[(runner.start + Math.floor((this.clock - runner.born) * this.fps)) % this.frames.length];
  }
}

interface GateView { state: GateState; node: Container; left: Container; right: Container }
interface ObstacleView { state: ObstacleState; node: Container; saw: Sprite | null }

export class RunnerScene implements Scene {
  readonly root = new Container();
  readonly sim: RunnerSim;
  readonly title: string;
  private cues: Cue[] = [];
  private stripes: Graphics[] = [];
  private gates: GateView[] = [];
  private obstacles: ObstacleView[] = [];
  private crowd: CrowdView;
  private enemy: CrowdView | null = null;
  private boss: Container | null = null;
  private bossSprite: ClipSprite | null = null;
  private bossBar: Graphics | null = null;
  private countLabel = marker(22, true);
  private enemyLabel = marker(20, true);

  /// `level` is the 0-based run.
  constructor(level: number, economy: RunnerEconomy, private onCue: (cue: Cue) => void) {
    this.sim = new RunnerSim(level, economy, (cue) => this.cues.push(cue));
    this.sim.reducedMotion = reducedMotion();
    this.title = this.sim.hud.title;
    this.root.sortableChildren = true;
    this.crowd = new CrowdView(this.sim.crowd, "clawd_run", this.root);
    this.build();
  }

  private build() {
    const { sim, root } = this;
    root.addChild(paper("paper"));
    root.addChild(sprite("background_color_hills", 201, Projection.horizonY + 130 - 60, 402, 260, -20));
    const ground = new Graphics().rect(0, Y(Projection.horizonY), W, Projection.horizonY).fill(Palette.ground);
    ground.zIndex = -19;
    const road = new Graphics().poly(Projection.roadPolygon.flatMap((p) => [p.x, Y(p.y)]))
      .fill(Palette.road).stroke({ color: Palette.edge, width: 2 });
    road.zIndex = -18;
    const horizon = new Graphics().rect(0, Y(Projection.horizonY) - 0.75, W, 1.5).fill(Palette.edge);
    root.addChild(ground, road, horizon);
    for (let i = 0; i < sim.stripes.length; i++) {
      const stripe = new Graphics().rect(-3, -10, 6, 20).fill({ color: Palette.stripe, alpha: 0.45 });
      stripe.zIndex = 1;
      this.stripes.push(stripe);
      root.addChild(stripe);
    }
    for (const state of sim.gates) {
      const node = new Container(), left = panel(state.pair.left), right = panel(state.pair.right);
      node.addChild(left, right);
      node.visible = false;
      this.gates.push({ state, node, left, right });
      root.addChild(node);
    }
    for (const state of sim.obstacles) {
      const view = obstacle(state);
      view.node.visible = false;
      this.obstacles.push(view);
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
    this.countLabel.zIndex = this.enemyLabel.zIndex = 200;
    root.addChild(this.countLabel, this.enemyLabel);
    this.draw(0);
  }

  readout() { return this.sim.hud.readout; }
  progress() { return this.sim.hud.progress; }
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
      if (cue.type !== "mood") this.onCue(cue);
    }
    this.cues.length = 0;
  }

  draw(dt: number) {
    const sim = this.sim, short = reducedMotion();
    sim.stripes.forEach((z, i) => {
      const stripe = this.stripes[i], at = Projection.point(0, z);
      stripe.position.set(at.x, Y(at.y));
      stripe.scale.set(Projection.scale(z));
      stripe.visible = z > 1;
    });
    for (const { state, node, left, right } of this.gates) {
      node.visible = state.visible;
      if (!state.visible) continue;
      const s = Projection.scale(state.z), l = Projection.point(-0.5, state.z), r = Projection.point(0.5, state.z);
      left.position.set(l.x, Y(l.y));
      right.position.set(r.x, Y(r.y));
      left.scale.set(s);
      right.scale.set(s);
      node.zIndex = 100 - state.z;
      if (state.consumedAt !== null) {
        // The taken panel holds for a moment, then both fade over 0.3 s.
        const since = sim.time - state.consumedAt;
        const held = 1 - Math.min(1, Math.max(0, (since - 0.05) / 0.3)), plain = 1 - Math.min(1, since / 0.3);
        left.alpha = state.tookLeft ? held : plain;
        right.alpha = state.tookLeft ? plain : held;
      }
    }
    for (const { state, node, saw } of this.obstacles) {
      node.visible = state.visible;
      if (!state.visible) continue;
      const s = Projection.scale(state.z), at = Projection.point(state.center, state.z);
      node.position.set(at.x, Y(at.y));
      if (saw) {
        node.scale.set(s);
        if (!short) saw.texture = art.texture(Math.floor(sim.time / 0.08) % 2 === 0 ? "saw_a" : "saw_b");
      } else {
        node.scale.set(state.widthPoints / 100, s);
      }
      node.zIndex = 100 - state.z;
    }
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
      this.bossBar.scale.x = Math.max(0, sim.boss.bar);
    }
    place(this.countLabel, sim.countLabel);
    place(this.enemyLabel, sim.enemyLabel);
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

/// One gate panel: a wash of colour, an ink frame and the operation.
const panel = (op: GateOp): Container => {
  const node = new Container();
  const fill = new Graphics().rect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H)
    .fill({ color: GateOp.isGood(op) ? Palette.good : Palette.bad, alpha: 0.8 });
  const frame = new Graphics().roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 6).stroke({ color: Palette.edge, width: 2.5 });
  const label = marker(36, false);
  label.text = GateOp.label(op);
  node.addChild(fill, frame, label);
  return node;
};

/// A hazard, drawn 100 points wide so a wall or a spike row stretches to the lane it covers.
const obstacle = (state: ObstacleState): ObstacleView => {
  const node = new Container(), kind = state.obstacle.hazard.kind;
  let saw: Sprite | null = null;
  if (kind === "wall") {
    for (let i = 0; i < 3; i++) node.addChild(sprite("block_danger", -33 + i * 33, 0, 34, 44));
  } else if (kind === "blade") {
    saw = sprite("saw_a", 0, 0, 64, 64);
    node.addChild(saw);
  } else {
    for (let i = 0; i < 4; i++) node.addChild(sprite("spikes", -37.5 + i * 25, 0, 25, 24));
  }
  // sprite() places its sprite on the canvas; here each one sits around the hazard's own origin.
  for (const child of node.children) child.y = 0;
  return { state, node, saw };
};
