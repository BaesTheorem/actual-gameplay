import { describe, expect, it } from "vitest";
import type { Vec } from "../src/sim/sk";
import { distance, mergeShortSegments, polylineLength, resample, simplify } from "../src/sim/savedog/geometry";
import { DOT_COST, inkCost, prepare } from "../src/sim/savedog/stroke";

describe("Stroke geometry", () => {
  it("collapses a nearly straight line", () => {
    const points: Vec[] = [];
    for (let i = 0; i <= 100; i++) points.push({ x: i * 2, y: 100 + (i % 2 === 0 ? 0.4 : -0.4) });
    const simplified = simplify(points, 1.5);
    expect(simplified.length).toBe(2);
    expect(simplified[0]).toEqual(points[0]);
    expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1]);
  });

  it("keeps corners when it simplifies", () => {
    const corner = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 }];
    expect(simplify(corner, 1.5)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  });

  it("keeps the endpoints when it merges short segments", () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 30, y: 0 }, { x: 31, y: 0 }];
    const merged = mergeShortSegments(points, 4);
    expect(merged[0]).toEqual(points[0]);
    expect(merged[merged.length - 1]).toEqual(points[points.length - 1]);
    for (let i = 1; i < merged.length; i++) {
      expect(distance(merged[i - 1], merged[i])).toBeGreaterThanOrEqual(4 - 0.001);
    }
  });

  it("resamples at the spacing asked for", () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }];
    const samples = resample(line, 6);
    expect(samples[0]).toEqual(line[0]);
    expect(samples[samples.length - 1]).toEqual(line[line.length - 1]);
    for (let i = 1; i < samples.length; i++) {
      expect(distance(samples[i - 1], samples[i])).toBeLessThanOrEqual(6.001);
    }
    expect(polylineLength(line)).toBe(140);
  });

  it("turns a tiny stroke into a dot", () => {
    const tiny = [{ x: 10, y: 10 }, { x: 12, y: 11 }, { x: 13, y: 12 }];
    expect(prepare(tiny).length).toBe(1);
    expect(inkCost(polylineLength(tiny))).toBe(DOT_COST);
  });
});
