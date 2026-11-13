// The painted art, for the DOM screens and for the scenes. scripts/build-assets.mjs packs every
// clip into one sheet and writes art.json, which says where each frame sits. Files are drawn at
// three pixels to the point.
import { Assets, Rectangle, Texture } from "pixi.js";
import manifest from "../generated/art.json";

export interface ArtEntry { file: string; frames: number; fps: number; w: number; h: number; cols: number; anchor: number[] }
const art = manifest as unknown as Record<string, ArtEntry>;
export const PIXELS_PER_POINT = 3;
const base = import.meta.env.BASE_URL;

export const entry = (name: string): ArtEntry | undefined => art[name];
export const exists = (name: string) => name in art;
export const url = (name: string) => `${base}art/${art[name]?.file ?? name + ".webp"}`;
/// Point size of an asset at its native scale.
export const size = (name: string) => {
  const e = art[name];
  return e ? { w: e.w / PIXELS_PER_POINT, h: e.h / PIXELS_PER_POINT } : { w: 32, h: 32 };
};

// MARK: scenes

const frames = new Map<string, Texture[]>();

/// Load the sheets a scene needs before it builds. Names the manifest does not know are skipped,
/// and the scene draws a magenta square for them so the gap shows.
export const load = async (names: string[]) => {
  const wanted = [...new Set(names)].filter((n) => exists(n) && !frames.has(n));
  await Promise.all(wanted.map(async (name) => {
    const e = art[name];
    const sheet = (await Assets.load(url(name))) as Texture;
    const list: Texture[] = [];
    for (let i = 0; i < e.frames; i++) {
      list.push(e.frames === 1 ? sheet : new Texture({
        source: sheet.source,
        frame: new Rectangle((i % e.cols) * e.w, Math.floor(i / e.cols) * e.h, e.w, e.h),
      }));
    }
    frames.set(name, list);
  }));
};

let missing: Texture | null = null;
const magenta = () => {
  if (!missing) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, 8, 8);
    missing = Texture.from(canvas);
  }
  return missing;
};

export const textures = (name: string): Texture[] => frames.get(name) ?? [magenta()];
export const texture = (name: string, frame = 0): Texture => {
  const list = textures(name);
  return list[Math.min(frame, list.length - 1)];
};

// MARK: DOM

/// Show one frame of an asset in an element, at the given height in points.
export const paint = (el: HTMLElement, name: string, height: number, frame = 0) => {
  const e = art[name];
  if (!e) { el.style.background = "#ff00ff"; return; }
  const k = height / e.h;
  const rows = Math.ceil(e.frames / e.cols);
  el.classList.add("sprite");
  el.style.width = `${e.w * k}px`;
  el.style.height = `${height}px`;
  el.style.backgroundImage = `url(${url(name)})`;
  el.style.backgroundSize = `${e.cols * e.w * k}px ${rows * e.h * k}px`;
  el.style.backgroundPosition = `${-(frame % e.cols) * e.w * k}px ${-Math.floor(frame / e.cols) * height}px`;
};

/// An element that plays a clip at the rate it was drawn for. It stops by itself once it leaves the page.
export const clip = (name: string, height: number): HTMLElement => {
  const el = document.createElement("div");
  const e = art[name];
  paint(el, name, height);
  if (e && e.frames > 1) {
    const started = performance.now();
    const timer = setInterval(() => {
      if (!el.isConnected && performance.now() - started > 1000) { clearInterval(timer); return; }
      paint(el, name, height, Math.floor(((performance.now() - started) / 1000) * e.fps) % e.frames);
    }, 1000 / e.fps);
  }
  return el;
};

/// A painted 9-slice frame (cards and buttons) behind an element, stretching to any size.
/// An inset is capped short of half the piece, so there is always a middle band left to stretch.
export const frame = <T extends HTMLElement>(el: T, name = "ui_card", insets = 20): T => {
  const e = art[name];
  if (!e) return el;
  const v = Math.min(insets, (e.h / PIXELS_PER_POINT) * 0.375), h = Math.min(insets, (e.w / PIXELS_PER_POINT) * 0.375);
  el.classList.add("painted");
  el.style.borderImage = `url(${url(name)}) ${v * PIXELS_PER_POINT} ${h * PIXELS_PER_POINT} fill / ${v}px ${h}px stretch`;
  return el;
};
