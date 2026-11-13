import { describe, expect, it } from "vitest";
import { Crowd, Projection } from "../src/sim/runner";

describe("projection", () => {
  it("moves depth up the screen and shrinks it", () => {
    let lastY = -1;
    let lastScale = 2;
    for (let z = 0; z <= Projection.farZ; z += 2) {
      const p = Projection.point(0, z);
      const s = Projection.scale(z);
      expect(p.y).toBeGreaterThan(lastY);
      expect(s).toBeLessThan(lastScale);
      expect(Math.abs(p.x - Projection.centerX)).toBeLessThanOrEqual(1e-9);
      lastY = p.y;
      lastScale = s;
    }
    expect(Projection.point(0, Projection.farZ).y).toBeLessThan(Projection.horizonY);
  });

  it("converges the lane edges", () => {
    const nearLeft = Projection.point(-1, 0);
    const farLeft = Projection.point(-1, Projection.farZ);
    expect(nearLeft.x).toBeLessThan(farLeft.x);
    expect(Math.abs(Projection.point(1, 0).x - nearLeft.x - 2 * Projection.halfRoad)).toBeLessThanOrEqual(1e-9);
    expect(Crowd.slot(0).dx).toBe(0);
    expect(Math.abs(Crowd.slot(50).dx) + Math.abs(Crowd.slot(50).dz)).toBeGreaterThan(0);
  });
});
