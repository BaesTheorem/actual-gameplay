import { describe, expect, it } from "vitest";
import type { Vec } from "../src/sim/sk";
import { FlowField, rect, segment } from "../src/sim/savedog/flowfield";
import { contains, distance, inset } from "../src/sim/savedog/geometry";

const bounds = { x: 0, y: 0, w: 300, h: 300 };
const dog = { center: { x: 150, y: 40 }, radius: 18 };

/// Follow the field from `start` for a while; true if it arrives within reach of the dog.
const arrives = (field: FlowField, start: Vec): boolean => {
  let p = start;
  for (let i = 0; i < 600; i++) {
    const d = field.direction(p);
    if (!d) return false;
    p = { x: p.x + d.x * 3, y: p.y + d.y * 3 };
    if (distance(p, dog.center) <= dog.radius + 8) return true;
  }
  return false;
};

describe("FlowField", () => {
  it("routes straight to the dog across an open field", () => {
    const field = new FlowField(bounds);
    field.rebuild([], [dog], 6);
    expect(arrives(field, { x: 150, y: 280 })).toBe(true);
    expect(arrives(field, { x: 20, y: 200 })).toBe(true);
  });

  it("leaves no route through a closed shield", () => {
    // A box around the dog: floor plus three strokes.
    const floor = rect({ x: 0, y: 0, w: 300, h: 20 });
    const left = segment({ x: 100, y: 20 }, { x: 100, y: 120 }, 4);
    const top = segment({ x: 100, y: 120 }, { x: 200, y: 120 }, 4);
    const right = segment({ x: 200, y: 120 }, { x: 200, y: 20 }, 4);
    const field = new FlowField(bounds);
    field.rebuild([floor, left, top, right], [dog], 6);
    expect(field.direction({ x: 150, y: 280 }), "outside the box there must be no route").toBeNull();
    expect(field.direction({ x: 150, y: 90 }), "inside the box the dog is reachable").not.toBeNull();
    expect(arrives(field, { x: 150, y: 280 })).toBe(false);
  });

  it("finds a gap wide enough for a bee", () => {
    const floor = rect({ x: 0, y: 0, w: 300, h: 20 });
    const left = segment({ x: 100, y: 20 }, { x: 100, y: 120 }, 4);
    // The top has a 30 pt hole in it.
    const topA = segment({ x: 100, y: 120 }, { x: 135, y: 120 }, 4);
    const topB = segment({ x: 165, y: 120 }, { x: 200, y: 120 }, 4);
    const right = segment({ x: 200, y: 120 }, { x: 200, y: 20 }, 4);
    const field = new FlowField(bounds);
    field.rebuild([floor, left, topA, topB, right], [dog], 6);
    expect(arrives(field, { x: 40, y: 280 }), "the bee should route through the hole").toBe(true);
  });

  it("does not route through a gap too narrow for a bee", () => {
    const floor = rect({ x: 0, y: 0, w: 300, h: 20 });
    const left = segment({ x: 100, y: 20 }, { x: 100, y: 120 }, 4);
    // 12 pt between stroke centres: 4 pt of ink each side leaves 4 pt of air, not a bee's 12.
    const topA = segment({ x: 100, y: 120 }, { x: 144, y: 120 }, 4);
    const topB = segment({ x: 156, y: 120 }, { x: 200, y: 120 }, 4);
    const right = segment({ x: 200, y: 120 }, { x: 200, y: 20 }, 4);
    const field = new FlowField(bounds);
    field.rebuild([floor, left, topA, topB, right], [dog], 6);
    expect(field.direction({ x: 150, y: 280 })).toBeNull();
  });

  it("routes around a wall instead of through it", () => {
    const slab = { x: 60, y: 100, w: 180, h: 14 };
    const field = new FlowField(bounds);
    field.rebuild([rect(slab)], [dog], 6);
    let p = { x: 150, y: 250 };
    let crossedThroughWall = false;
    for (let i = 0; i < 600; i++) {
      const d = field.direction(p);
      if (!d) break;
      p = { x: p.x + d.x * 3, y: p.y + d.y * 3 };
      if (contains(inset(slab, -2, -2), p)) crossedThroughWall = true;
      if (distance(p, dog.center) <= dog.radius + 8) break;
    }
    expect(crossedThroughWall).toBe(false);
    expect(distance(p, dog.center), "should still arrive, around the end of the wall").toBeLessThanOrEqual(dog.radius + 8);
  });
});
