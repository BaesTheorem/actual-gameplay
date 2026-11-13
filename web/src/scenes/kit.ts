// Drawing pieces every scene shares. The simulations work in canvas points with y up, as the
// levels are written; the screen has y down, so everything passes through Y() on its way out.
import { Container, Graphics, Sprite, Text } from "pixi.js";
import * as art from "../app/art";
import type { Outcome, Vec } from "../sim/sk";

export const W = 402, H = 874;
export const Y = (y: number) => H - y;

export const Pigment = {
  paper: 0xf3ebdc, ink: 0x2b2233, clay: 0xd97757, clayDark: 0xa84d33, clayLight: 0xf2a283, cream: 0xfff5e2,
  sky: 0x8ec3e6, sap: 0x6e9f58, rose: 0xe27a92, ochre: 0xe8aa38, teal: 0x3a9c98, violet: 0x7b5ca8,
  indigo: 0x2f3c7a, night: 0x1f2550,
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
  label.position.set(201, Y(724));
  const plate = new Graphics()
    .roundRect(201 - label.width / 2 - 10, Y(724) - 6, label.width + 20, label.height + 12, 6)
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
