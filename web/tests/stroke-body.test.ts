import { describe, expect, it } from "vitest";
import { SKWorld, tagOf } from "../src/sim/sk";
import { isConvex, isCounterClockwise, segmentQuad, signedArea } from "../src/sim/savedog/geometry";
import { Cat, Stroke, mass } from "../src/sim/savedog/stroke";

describe("StrokeBody", () => {
  it("builds a segment quad that is convex and counterclockwise", () => {
    const quad = segmentQuad({ x: 0, y: 0 }, { x: 30, y: 10 }, 4);
    expect(quad.length).toBe(4);
    expect(isConvex(quad)).toBe(true);
    expect(isCounterClockwise(quad)).toBe(true);
    expect(Math.abs(signedArea(quad) - 8 * Math.hypot(30, 10))).toBeLessThanOrEqual(0.01);
  });

  it("gives a stroke the mass of its length", () => {
    expect(Math.abs(mass(200) - (200 * 8) / 22_500)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(mass(0) - (8 * 8) / 22_500)).toBeLessThanOrEqual(1e-9);
  });

  it("centres the body on the centroid of the points", () => {
    const points = [{ x: 100, y: 100 }, { x: 160, y: 100 }, { x: 160, y: 160 }];
    const stroke = new Stroke(1, points, true, new SKWorld(-9.8));
    expect(stroke.position.x).toBeCloseTo(140, 9);
    expect(stroke.position.y).toBeCloseTo(120, 9);
    const body = stroke.body!;
    expect(body).not.toBeNull();
    expect(body.isDynamic()).toBe(true);
    expect(tagOf(body).category).toBe(Cat.drawn);
    expect(Math.abs(body.getMass() - mass(120))).toBeLessThanOrEqual(1e-6);
  });

  it("makes pinned ink static", () => {
    const stroke = new Stroke(1, [{ x: 0, y: 0 }, { x: 50, y: 0 }], false, new SKWorld(-9.8));
    expect(stroke.body!.isDynamic()).toBe(false);
  });

  it("makes a dot from a single point", () => {
    const stroke = new Stroke(1, [{ x: 20, y: 30 }], true, new SKWorld(-9.8));
    expect(stroke.position.x).toBeCloseTo(20, 9);
    expect(stroke.position.y).toBeCloseTo(30, 9);
    expect(Math.abs(stroke.body!.getMass() - mass(0))).toBeLessThanOrEqual(1e-6);
  });
});
