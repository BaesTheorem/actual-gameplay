// Drawing pieces every scene shares. The simulations work in canvas points with y up, as the
// levels are written; the screen has y down, so everything passes through Y() on its way out.
import { Container, Graphics, GraphicsContext, Sprite, Text } from "pixi.js";
import * as art from "../app/art";
import type { Outcome, Vec } from "../sim/sk";

export const W = 402, H = 874;
export const Y = (y: number) => H - y;

export const Pigment = {
  paper: 0xf3ebdc, ink: 0x2b2233, clay: 0xd97757, clayDark: 0xa84d33, clayLight: 0xf2a283, cream: 0xfff5e2,
  sky: 0x8ec3e6, sap: 0x6e9f58, rose: 0xe27a92, ochre: 0xe8aa38, teal: 0x3a9c98, violet: 0x7b5ca8,
  indigo: 0x2f3c7a, night: 0x1f2550, stone: 0x88859f,
};
export const MARKER = "Permanent Marker";

/// What the game container needs from a mode's scene.
export interface Scene {
  root: Container;
  title: string;
  readout(): string;
  /// 0 to 1 for the bar under the HUD, or null for no bar.
  progress(): number | null;
  outcome(): Outcome | null;
  /// One fixed step of the simulation.
  step(): void;
  /// Bring the drawing in line with the simulation. `dt` is real seconds since the last draw.
  draw(dt: number): void;
  pointer?(type: "down" | "move" | "up", point: Vec): void;
  /// Show the way, on a level that stores its solution: `step` is 1 for the first hint taken on
  /// the level, 2 for the second, and so on. A scene with nothing to show leaves this out.
  hint?(step: number): void;
  destroy(): void;
}

/// A sprite at a canvas point, sized in points.
export const sprite = (name: string, x: number, y: number, w: number, h: number, z = 0): Sprite => {
  const s = new Sprite(art.texture(name));
  s.anchor.set(0.5);
  s.position.set(x, Y(y));
  s.width = w;
  s.height = h;
  s.zIndex = z;
  return s;
};

/// A sprite that plays painted clips: a looping idle, a one-shot reaction, and clean switches
/// between them. Its anchor comes from the manifest, so the ground point stays put when the clip changes.
export class ClipSprite extends Sprite {
  current = "";
  private frames = art.textures("");
  private fps = 1;
  private time = 0;
  private loop = true;
  /// 1 faces the way the clip was drawn (screen right), -1 mirrors it.
  facing = 1;
  clipScale: number;

  /// `height` sizes the first clip in points; later clips keep the same scale.
  constructor(name: string, height: number) {
    super();
    this.clipScale = height / Math.max(1, art.size(name).h);
    this.play(name);
  }

  play(name: string, loop = true, startFrame = 0) {
    if (name === this.current && loop) return;
    const e = art.entry(name);
    if (!e) return;
    this.current = name;
    this.loop = loop;
    this.frames = art.textures(name);
    this.fps = Math.max(1, e.fps);
    this.time = startFrame / this.fps;
    // The manifest measures the anchor from the bottom edge.
    this.anchor.set(e.anchor[0], 1 - e.anchor[1]);
    this.texture = this.frames[startFrame % this.frames.length];
    this.fit();
  }

  /// Size the sprite for its clip. `stretchY` squashes or stretches it about the ground point.
  fit(stretchY = 1) {
    const k = this.clipScale / art.PIXELS_PER_POINT;
    this.scale.set(k * this.facing, k * stretchY);
  }

  tick(dt: number) {
    if (this.frames.length < 2) return;
    this.time += dt;
    const i = Math.floor(this.time * this.fps);
    this.texture = this.frames[this.loop ? i % this.frames.length : Math.min(i, this.frames.length - 1)];
  }
}

/// The sheet a scene is painted on, behind everything. The paper is landscape, so it stands on
/// end and scales to cover the canvas.
export const paper = (name: string): Sprite => {
  const s = new Sprite(art.texture(name));
  const native = art.size(name);
  const scale = Math.max(W / native.h, H / native.w);
  s.anchor.set(0.5);
  s.width = native.w * scale;
  s.height = native.h * scale;
  s.rotation = -Math.PI / 2;
  s.position.set(W / 2, H / 2);
  s.zIndex = -100;
  return s;
};

const SKINS = ["grass", "stone", "dirt", "purple"];
/// Terrain out of tiles: a one-tile strip for thin platforms, a block grid for anything thicker,
/// cropped to the exact rectangle so level geometry stays the authority. `rect` is in canvas points, y up.
export const terrain = (rect: { x: number; y: number; w: number; h: number }, skinName?: string): Container => {
  const skin = SKINS.includes(skinName ?? "") ? skinName! : "grass";
  const node = new Container();
  const top = Y(rect.y + rect.h), left = rect.x;
  const tileAt = (part: string, x: number, y: number, size: number) => {
    const s = new Sprite(art.texture(`terrain_${skin}_${part}`));
    s.position.set(x, y);
    s.width = s.height = size;
    node.addChild(s);
  };
  if (rect.w <= 36 && rect.h > 36) {
    for (let y = top; y < top + rect.h; y += rect.w) tileAt("block_center", left, y, rect.w);
  } else if (rect.h <= 36) {
    const tile = rect.h, count = Math.ceil(rect.w / tile);
    for (let i = 0, x = left; x < left + rect.w; i++, x += tile) {
      tileAt(i === 0 ? "horizontal_left" : i === count - 1 ? "horizontal_right" : "horizontal_middle", x, top, tile);
    }
  } else {
    const tile = 32, columns = Math.ceil(rect.w / tile), rows = Math.ceil(rect.h / tile);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const isTop = row === 0, isLeft = column === 0, isRight = column === columns - 1;
        let part = isTop ? "block_top" : "block_center";
        if (columns > 1) {
          if (isTop && isLeft) part = "block_top_left";
          else if (isTop && isRight) part = "block_top_right";
          else if (!isTop && isLeft) part = "block_left";
          else if (!isTop && isRight) part = "block_right";
        }
        tileAt(part, left + column * tile, top + row * tile, tile);
      }
    }
  }
  const mask = new Graphics().rect(left, top, rect.w, rect.h).fill(0xffffff);
  node.addChild(mask);
  node.mask = mask;
  return node;
};

/// Where the hint's first line starts. The band between the HUD and that line is where the
/// sticker with the level's measured difficulty sits, at the right (see .sticker in style.css).
const HINT_TOP = 724;

/// A two-line hint under the HUD, on a plate so tall geometry cannot swallow it.
export const hintLabel = (text: string | undefined, color = Pigment.ink, backdrop = Pigment.cream): Container | null => {
  if (!text) return null;
  const node = new Container();
  const label = new Text({
    text,
    style: { fontFamily: MARKER, fontSize: 13, fill: color, wordWrap: true, wordWrapWidth: 350, align: "center", lineHeight: 17 },
    resolution: 3,
  });
  label.anchor.set(0.5, 0);
  label.position.set(201, Y(HINT_TOP));
  const plate = new Graphics()
    .roundRect(201 - label.width / 2 - 10, Y(HINT_TOP) - 6, label.width + 20, label.height + 12, 6)
    .fill(backdrop).stroke({ color: Pigment.ink, width: 1 });
  node.addChild(plate, label);
  node.zIndex = 30;
  return node;
};

/// A puff of steam or dust: it rises, swells and fades.
export class Puffs {
  readonly layer = new Container();
  private live: { g: Graphics; age: number }[] = [];

  constructor(z: number) { this.layer.zIndex = z; }

  add(x: number, y: number, color = Pigment.cream) {
    const g = new Graphics().circle(0, 0, 4).fill({ color, alpha: 0.85 }).stroke({ color: Pigment.ink, width: 1, alpha: 0.5 });
    g.position.set(x, Y(y));
    this.layer.addChild(g);
    this.live.push({ g, age: 0 });
  }

  tick(dt: number, duration = 0.45) {
    for (const p of this.live) {
      p.age += dt;
      const t = Math.min(1, p.age / duration);
      p.g.y -= (14 / duration) * dt;
      p.g.scale.set(1 + t);
      p.g.alpha = 1 - t;
      if (t >= 1) p.g.destroy();
    }
    this.live = this.live.filter((p) => p.age < duration);
  }
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// MARK: effects

export type FxShape = "dot" | "drop" | "shard" | "paper" | "star";
const SHAPES: FxShape[] = ["dot", "drop", "shard", "paper", "star"];

/// How a burst looks and moves. Speeds are in points per second and sizes in points.
export interface BurstOptions {
  count?: number;
  color?: number;
  /// Speed at the start. Each piece gets between half of it and all of it.
  speed?: number;
  /// Seconds a piece lasts. It fades over the last third.
  life?: number;
  /// Half the width of a piece.
  size?: number;
  /// Pull toward the bottom of the screen, in points per second squared. A negative pull rises.
  gravity?: number;
  shape?: FxShape;
  /// The ink line around each piece. On unless it is turned off.
  outline?: boolean;
  /// The middle of the fan the pieces fly out in, in radians counterclockwise from screen right,
  /// and how wide the fan is. Without them the pieces go every way.
  angle?: number;
  spread?: number;
}

/// Each shape is drawn once per colour, one point in radius, and every piece of that shape and
/// colour shares the drawing. A piece is the drawing scaled to its size.
const shapeContexts = new Map<number, GraphicsContext>();
const shapeContext = (shape: number, color: number, outline: boolean): GraphicsContext => {
  const key = color * 16 + shape * 2 + (outline ? 1 : 0);
  let ctx = shapeContexts.get(key);
  if (ctx) return ctx;
  ctx = new GraphicsContext();
  const name = SHAPES[shape];
  if (name === "dot") ctx.circle(0, 0, 1);
  // A drop falls round end first; its tail points back the way it came.
  else if (name === "drop") ctx.moveTo(0, -1.9).bezierCurveTo(0.35, -1.1, 1, -0.5, 1, 0.2).arc(0, 0.2, 1, 0, Math.PI).bezierCurveTo(-1, -0.5, -0.35, -1.1, 0, -1.9).closePath();
  else if (name === "shard") ctx.poly([-1.1, -0.6, 1.2, -0.15, -0.25, 1]);
  else if (name === "paper") ctx.rect(-1, -0.6, 2, 1.2);
  else {
    // A four-point sparkle, like the ones painted beside Clawd.
    const points: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? 1.35 : 0.42, a = (i * Math.PI) / 4;
      points.push(r * Math.sin(a), -r * Math.cos(a));
    }
    ctx.poly(points);
  }
  ctx.fill(color);
  if (outline) ctx.stroke({ color: Pigment.ink, width: 0.3, join: "round" });
  shapeContexts.set(key, ctx);
  return ctx;
};

let ringContext: GraphicsContext | null = null;
/// A ring ten points in radius, white so each ring can take its own colour as a tint.
const ringShape = () => (ringContext ??= new GraphicsContext().circle(0, 0, 10).stroke({ color: 0xffffff, width: 1.6 }));

interface Piece {
  g: Graphics;
  x: number; y: number; vx: number; vy: number;
  gravity: number; age: number; life: number; size: number;
  /// Radians per second, for a piece that tumbles. A drop points along its path instead.
  spin: number;
  drop: boolean;
  /// A paper bit turns over as it falls: this is where in the turn it started.
  flutter: number;
}
interface Ring { g: Graphics; age: number; reach: number }
interface Label { t: Text; age: number; y: number }

const RING_LIFE = 0.35, LABEL_LIFE = 0.9;
/// How far a ring opens when it is given no reach: 24 points from its middle.
const RING_REACH = 24;
const CONFETTI = [Pigment.clay, Pigment.sap, Pigment.sky, Pigment.ochre, Pigment.rose, Pigment.teal, Pigment.violet];

/// Small effects for the moments that matter: a burst of flat pieces, a ring, a number that
/// floats up, confetti for a win, and a shake of the whole scene. Everything is a flat wash with
/// an ink line, lasts well under a second (confetti takes two), and is drawn on one layer the
/// scene places itself. Pieces, rings and labels are kept and used again, so once a scene has
/// shown its busiest moment a burst makes nothing new.
///
/// Under reduced motion there is no shake and no confetti, and a burst has a third of its pieces.
export class Fx {
  readonly layer = new Container();
  /// How far the scene is shaken this frame. The scene adds it to its root's position.
  readonly offset = { x: 0, y: 0 };
  private pieces: Piece[] = [];
  private livePieces = 0;
  private rings: Ring[] = [];
  private liveRings = 0;
  private labels: Label[] = [];
  private liveLabels = 0;
  private shakeAmount = 0;
  private shakeFor = 0;
  private shakeLeft = 0;
  private seed = 0x2f6e2b1;

  constructor(z = 0) { this.layer.zIndex = z; }

  /// The same numbers every time, so an effect looks the same on every run.
  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private piece(): Piece {
    if (this.livePieces === this.pieces.length) {
      const g = new Graphics(shapeContext(0, Pigment.ink, false));
      this.layer.addChild(g);
      this.pieces.push({ g, x: 0, y: 0, vx: 0, vy: 0, gravity: 0, age: 0, life: 1, size: 1, spin: 0, drop: false, flutter: 0 });
    }
    return this.pieces[this.livePieces++];
  }

  /// Pieces flying out from a canvas point.
  burst(x: number, y: number, options: BurstOptions = {}) {
    const shape = Math.max(0, SHAPES.indexOf(options.shape ?? "dot"));
    const speed = options.speed ?? 120, life = options.life ?? 0.4, size = options.size ?? 3;
    const angle = options.angle ?? 0, spread = options.spread ?? 2 * Math.PI;
    const context = shapeContext(shape, options.color ?? Pigment.ink, options.outline ?? true);
    const count = reducedMotion() ? Math.max(1, Math.round((options.count ?? 8) / 3)) : options.count ?? 8;
    for (let i = 0; i < count; i++) {
      const p = this.piece(), a = angle + (this.random() - 0.5) * spread, v = speed * (0.5 + 0.5 * this.random());
      p.g.context = context;
      p.g.visible = true;
      p.x = x;
      p.y = Y(y);
      p.vx = Math.cos(a) * v;
      p.vy = -Math.sin(a) * v;
      p.gravity = options.gravity ?? 0;
      p.age = 0;
      p.life = life * (0.7 + 0.3 * this.random());
      p.size = size * (0.75 + 0.5 * this.random());
      p.drop = SHAPES[shape] === "drop";
      p.spin = p.drop || shape === 0 ? 0 : (this.random() - 0.5) * 14;
      p.flutter = SHAPES[shape] === "paper" ? this.random() * 6.3 : -1;
      p.g.rotation = this.random() * 6.3;
      p.g.position.set(p.x, p.y);
      p.g.scale.set(p.size);
      p.g.alpha = 0;
    }
  }

  /// A ring that opens out from a canvas point and fades. `reach` is how far from the point it
  /// gets, in points, for a ring that has to show a size: the edge of a blast, say.
  ring(x: number, y: number, color: number, reach = RING_REACH) {
    if (this.liveRings === this.rings.length) {
      const g = new Graphics(ringShape());
      this.layer.addChild(g);
      this.rings.push({ g, age: 0, reach: RING_REACH });
    }
    const ring = this.rings[this.liveRings++];
    ring.age = 0;
    ring.reach = reach > 0 ? reach : RING_REACH;
    ring.g.tint = color;
    ring.g.visible = true;
    ring.g.position.set(x, Y(y));
    ring.g.scale.set((0.5 * ring.reach) / RING_REACH);
    ring.g.alpha = 1;
  }

  /// A word or a number that floats up from a canvas point and fades.
  text(x: number, y: number, text: string, options: { color?: number; size?: number } = {}) {
    if (this.liveLabels === this.labels.length) {
      const t = new Text({
        text: "",
        style: { fontFamily: MARKER, fontSize: 20, fill: Pigment.ink, stroke: { color: Pigment.ink, width: 2.5, join: "round" } },
        resolution: 3,
      });
      t.anchor.set(0.5);
      this.layer.addChild(t);
      this.labels.push({ t, age: 0, y: 0 });
    }
    const label = this.labels[this.liveLabels++];
    label.age = 0;
    label.y = Y(y);
    label.t.style.fontSize = options.size ?? 20;
    label.t.style.fill = options.color ?? Pigment.cream;
    label.t.text = text;
    label.t.visible = true;
    label.t.position.set(x, label.y);
  }

  /// Paper bits in the palette, falling across the stage. For a win.
  confetti() {
    if (reducedMotion()) return;
    for (let i = 0; i < 40; i++) {
      const p = this.piece();
      p.g.context = shapeContext(3, CONFETTI[i % CONFETTI.length], true);
      p.g.visible = false;
      p.x = this.random() * W;
      // They start anywhere in the top third, so the shower is on the stage from its first moment.
      p.y = 30 + this.random() * 260;
      p.vx = (this.random() - 0.5) * 90;
      p.vy = 80 + this.random() * 140;
      p.gravity = 420;
      // A negative age is a wait. The bits start at different moments, which makes it a shower.
      p.age = -this.random() * 0.35;
      p.life = 1.3 + this.random() * 0.35;
      p.size = 3.5 + this.random() * 1.5;
      p.drop = false;
      p.spin = (this.random() - 0.5) * 9;
      p.flutter = this.random() * 6.3;
      p.g.rotation = this.random() * 6.3;
    }
  }

  /// Shake the scene: `amount` points at the start, dying away over `seconds`.
  shake(amount: number, seconds: number) {
    if (reducedMotion() || seconds <= 0) return;
    this.shakeAmount = amount;
    this.shakeFor = this.shakeLeft = seconds;
  }

  /// Move everything on by `dt` real seconds.
  tick(dt: number) {
    for (let i = this.livePieces - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.age += dt;
      if (p.age < 0) continue;
      if (p.age >= p.life) {
        p.g.visible = false;
        // The last live piece takes this one's place, so the live ones stay at the front.
        this.pieces[i] = this.pieces[--this.livePieces];
        this.pieces[this.livePieces] = p;
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.age / p.life;
      p.g.visible = true;
      p.g.position.set(p.x, p.y);
      // In over the first moment, out over the last third.
      p.g.alpha = Math.min(1, p.age / 0.08, (1 - t) * 3);
      if (p.drop) p.g.rotation = Math.atan2(-p.vx, p.vy);
      else p.g.rotation += p.spin * dt;
      p.g.scale.set(p.size, p.flutter < 0 ? p.size : p.size * Math.cos(p.flutter + p.age * 9));
    }
    for (let i = this.liveRings - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.age += dt;
      const t = ring.age / RING_LIFE;
      if (t >= 1) {
        ring.g.visible = false;
        this.rings[i] = this.rings[--this.liveRings];
        this.rings[this.liveRings] = ring;
        continue;
      }
      // The shape is ten points in radius: it opens from half of that to 2.4 times it, which is 24 points.
      ring.g.scale.set(((0.5 + 1.9 * t) * ring.reach) / RING_REACH);
      ring.g.alpha = 1 - t * t;
    }
    for (let i = this.liveLabels - 1; i >= 0; i--) {
      const label = this.labels[i];
      label.age += dt;
      const t = label.age / LABEL_LIFE;
      if (t >= 1) {
        label.t.visible = false;
        this.labels[i] = this.labels[--this.liveLabels];
        this.labels[this.liveLabels] = label;
        continue;
      }
      // Quick off the mark, slow at the top.
      label.t.y = label.y - 34 * (1 - (1 - t) * (1 - t));
      label.t.alpha = t < 0.6 ? 1 : (1 - t) * 2.5;
    }
    if (this.shakeLeft > 0) {
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      const since = this.shakeFor - this.shakeLeft, k = this.shakeAmount * (this.shakeLeft / this.shakeFor);
      this.offset.x = k * Math.sin(since * 170);
      this.offset.y = 0.6 * k * Math.cos(since * 221);
    } else {
      this.offset.x = this.offset.y = 0;
    }
  }
}
