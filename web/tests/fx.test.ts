import { beforeEach, describe, expect, it, vi } from "vitest";

// The kit draws with the painted art and asks the browser about reduced motion. Neither is here,
// and the effects need neither: they are flat shapes drawn in code.
vi.mock("../src/app/art", () => ({ PIXELS_PER_POINT: 3, texture: () => undefined, textures: () => [], size: () => ({ w: 1, h: 1 }), entry: () => undefined }));
let reduced = false;
vi.stubGlobal("matchMedia", () => ({ matches: reduced }));

const { Fx } = await import("../src/scenes/kit");

/// Run the effects on until everything that was started has ended.
const settle = (fx: InstanceType<typeof Fx>, seconds = 3) => {
  for (let i = 0; i < seconds * 60; i++) fx.tick(1 / 60);
};
const showing = (fx: InstanceType<typeof Fx>) => fx.layer.children.filter((child) => child.visible).length;

describe("the effects kit", () => {
  beforeEach(() => { reduced = false; });

  it("uses its pieces again, so a burst after the first makes nothing new", () => {
    const fx = new Fx();
    fx.burst(100, 100, { count: 12 });
    expect(fx.layer.children.length).toBe(12);
    settle(fx);
    expect(showing(fx)).toBe(0);
    fx.burst(50, 50, { count: 12, shape: "star", color: 0xe8aa38 });
    fx.burst(60, 60, { count: 5, shape: "drop", gravity: 500 });
    expect(fx.layer.children.length).toBe(17);
    settle(fx);
    fx.burst(70, 70, { count: 17, shape: "shard", outline: false });
    expect(fx.layer.children.length).toBe(17);
  });

  it("ends every piece, ring and shake", () => {
    const fx = new Fx();
    fx.burst(100, 100, { count: 8, life: 0.4 });
    fx.ring(100, 100, 0xffffff);
    fx.confetti();
    fx.shake(5, 0.3);
    fx.tick(1 / 60);
    expect(showing(fx)).toBeGreaterThan(0);
    expect(Math.abs(fx.offset.x) + Math.abs(fx.offset.y)).toBeGreaterThan(0);
    settle(fx);
    expect(showing(fx)).toBe(0);
    expect(fx.offset).toEqual({ x: 0, y: 0 });
  });

  it("keeps a shake inside the amount asked for", () => {
    const fx = new Fx();
    fx.shake(4, 0.25);
    for (let i = 0; i < 20; i++) {
      fx.tick(1 / 60);
      expect(Math.abs(fx.offset.x)).toBeLessThanOrEqual(4);
      expect(Math.abs(fx.offset.y)).toBeLessThanOrEqual(4);
    }
  });

  it("draws a third of a burst, no confetti and no shake under reduced motion", () => {
    reduced = true;
    const fx = new Fx();
    fx.burst(100, 100, { count: 12 });
    expect(fx.layer.children.length).toBe(4);
    fx.confetti();
    expect(fx.layer.children.length).toBe(4);
    fx.shake(5, 0.3);
    fx.tick(1 / 60);
    expect(fx.offset).toEqual({ x: 0, y: 0 });
  });
});
