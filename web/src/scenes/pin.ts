// Pull the Pin on screen: the simulation in sim/pinpull.ts, drawn.
import { Container, Filter, GlProgram, Graphics, Rectangle, Sprite, Texture, defaultFilterVert } from "pixi.js";
import * as art from "../app/art";
import type { Cue } from "../sim/clock";
import {
  FRAME_THICKNESS, HERO_RADIUS, KNOB_OFFSET, LIQUID_RADIUS, PIN_THICKNESS, PinSim, segmentQuad,
  type Foe, type PinLevel, type Pin,
} from "../sim/pinpull";
import { position, tagOf, type Vec } from "../sim/sk";
import { ClipSprite, H, Pigment, Puffs, W, Y, hintLabel, paper, reducedMotion, sprite, terrain, type Scene } from "./kit";

export const PIN_ART = [
  "paper_cave", "pin_knob", "gem_yellow", "sign_exit", "clawd_hard_idle", "clawd_hard_ko", "clawd_hard_excited",
  "clawd_foe_idle", "clawd_foe_ko", "terrain_stone_block_center", "terrain_stone_block_top", "terrain_stone_block_left",
  "terrain_stone_block_right", "terrain_stone_block_top_left", "terrain_stone_block_top_right",
  "terrain_stone_horizontal_left", "terrain_stone_horizontal_middle", "terrain_stone_horizontal_right",
];

/// Each blob sprite extends this many physics radii; two particles merge when they are closer than about two diameters.
const BLOB_SCALE = 3;

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

export class PinScene implements Scene {
  readonly root = new Container();
  readonly sim: PinSim;
  readonly title: string;
  private cues: Cue[] = [];
  private pinNodes = new Map<Pin, Container>();
  private liquids = { water: new Container(), lava: new Container() };
  private blobs = new Map<unknown, Sprite>();
  private hero: ClipSprite | null = null;
  private gem: Sprite | null = null;
  private foes = new Map<Foe, ClipSprite>();
  private puffs = new Puffs(8);
  private clips: ClipSprite[] = [];

  constructor(readonly level: PinLevel, index: number, private onCue: (cue: Cue) => void) {
    this.title = `${index + 1}. ${level.name}`;
    this.sim = new PinSim(level, (cue) => this.cues.push(cue));
    this.root.sortableChildren = true;
    this.build();
  }

  private build() {
    const { level, sim, root } = this;
    root.addChild(paper("paper_cave"));
    for (const d of level.decor ?? []) {
      if (art.exists(d.sprite)) root.addChild(sprite(d.sprite, d.x, d.y, d.w, d.h, 1));
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
    for (const r of level.drains ?? []) {
      const g = new Graphics().rect(r.x, Y(r.y + r.h), r.w, r.h).fill({ color: Pigment.night, alpha: 0.55 }).stroke({ color: Pigment.ink, width: 2 });
      for (let x = r.x; x < r.x + r.w; x += 10) {
        g.moveTo(x, Y(r.y)).lineTo(Math.min(x + r.h, r.x + r.w), Y(Math.min(r.y + r.h, r.y + (r.x + r.w - x))));
      }
      g.stroke({ color: Pigment.ink, width: 1, alpha: 0.7 });
      root.addChild(g);
    }
    for (const r of level.grates ?? []) {
      const g = new Graphics().rect(r.x, Y(r.y + r.h), r.w, r.h).fill({ color: Pigment.night, alpha: 0.3 }).stroke({ color: Pigment.ink, width: 2 });
      for (let x = r.x + 5; x < r.x + r.w - 2; x += 8) g.moveTo(x, Y(r.y)).lineTo(x, Y(r.y + r.h));
      g.stroke({ color: Pigment.ink, width: 2 });
      g.zIndex = 3;
      root.addChild(g);
    }
    const goal = level.actors.goal;
    if (goal) {
      const g = new Graphics().rect(goal.x, Y(goal.y + goal.h), goal.w, goal.h).fill({ color: Pigment.clay, alpha: 0.12 });
      dashedRect(g, goal.x, Y(goal.y + goal.h), goal.w, goal.h, 7, 5);
      g.stroke({ color: Pigment.clay, width: 2 });
      root.addChild(g, sprite("sign_exit", goal.x + goal.w - 20, goal.y + 16, 30, 30, 1));
    }
    for (const pin of sim.pins) {
      const node = this.pinNode(pin);
      this.pinNodes.set(pin, node);
      root.addChild(node);
    }
    const layer = new Container();
    layer.zIndex = 5;
    this.liquids.water.filters = [surface(Pigment.teal, Pigment.sky)];
    this.liquids.lava.filters = [surface(Pigment.clay, Pigment.ochre)];
    for (const c of [this.liquids.water, this.liquids.lava]) {
      c.filterArea = new Rectangle(0, 0, W, H);
      layer.addChild(c);
    }
    root.addChild(layer);
    for (const p of sim.particles) this.addBlob(p.body, p.kind);

    if (sim.hero) {
      this.hero = new ClipSprite("clawd_hard_idle", 48);
      this.hero.zIndex = 6;
      this.clips.push(this.hero);
      root.addChild(this.hero);
    }
    if (sim.treasure) {
      this.gem = sprite("gem_yellow", 0, 0, 28, 24, 6);
      root.addChild(this.gem);
    }
    for (const foe of sim.foes) {
      const node = new ClipSprite("clawd_foe_idle", 48);
      node.zIndex = 6;
      this.foes.set(foe, node);
      this.clips.push(node);
      root.addChild(node);
    }
    root.addChild(this.puffs.layer);
    const hint = hintLabel(level.hint);
    if (hint) root.addChild(hint);
    this.draw(0);
  }

  /// A bar with a knob outside the chamber wall. The knob stays upright on a tilted pin.
  private pinNode(pin: Pin): Container {
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
    node.rotation = -pin.angle;
    node.zIndex = 4;
    return node;
  }

  private addBlob(body: unknown, kind: "water" | "lava") {
    const s = new Sprite(blobTexture());
    s.anchor.set(0.5);
    s.width = s.height = 2 * LIQUID_RADIUS * BLOB_SCALE;
    s.blendMode = "add";
    this.liquids[kind].addChild(s);
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
      if (cue.type === "puff") this.puffs.add(cue.x, cue.y); else this.onCue(cue);
    }
    this.cues.length = 0;
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
    if (this.hero && sim.hero) {
      const at = position(sim.hero), since = sim.elapsed - sim.heroStateSince;
      this.hero.position.set(at.x, Y(at.y - HERO_RADIUS));
      let stretch = 1;
      if (sim.heroState === "ko") {
        this.hero.play("clawd_hard_ko");
        // A beat on the knocked-out pose, so the take reads before he goes.
        const t = Math.min(1, Math.max(0, (since - 0.6) / (short ? 0.1 : 0.5)));
        this.hero.clipScale = 48 / art.size("clawd_hard_idle").h * (1 - 0.8 * t);
        this.hero.alpha = 1 - t;
      } else if (sim.heroState === "excited") {
        this.hero.play("clawd_hard_excited");
        if (!short) stretch = since < 0.1 ? 1 + 1.8 * since : since < 0.22 ? 1.18 - 1.5 * (since - 0.1) : 1;
      }
      this.hero.fit(stretch);
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
      }
      node.clipScale = 48 / art.size("clawd_foe_idle").h * (1 - shrink * t);
      node.alpha = 1 - t;
      node.fit();
    }
    for (const c of this.clips) c.tick(dt);
    this.puffs.tick(dt, short ? 0.1 : 0.45);
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}

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
