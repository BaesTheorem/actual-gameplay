import { describe, expect, it } from "vitest";
import type { Vec } from "../src/sim/sk";
import { FlowField, circle, cuts, rect, segment } from "../src/sim/savedog/flowfield";
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

  it("gives a dog on a thin plank no cells on the far side of it", () => {
    // A plank 6 points thick that falls 32 degrees, a dog standing on it, and a closed shield
    // over him with both feet on the plank.
    const fall = 0.625, top = (x: number) => 200 - fall * (x - 20);
    const plank = segment({ x: 20, y: top(20) }, { x: 280, y: top(280) }, 3);
    const lean = Math.atan(fall);
    const on = { center: { x: 150 + 18 * Math.sin(lean), y: top(150) + 18 * Math.cos(lean) }, radius: 18 };
    const { x, y } = on.center;
    const left = { x: x - 44, y: top(x - 44) + 5 }, right = { x: x + 40, y: top(x + 40) + 5 };
    const outline = [left, { x: left.x + 2, y: y + 30 }, { x: x - 20, y: y + 52 }, { x: x + 8, y: y + 50 }, { x: x + 34, y: y + 28 }, { x: right.x, y: y - 4 }, right];
    const shield = outline.slice(1).map((p, i) => segment(outline[i], p, 4));
    const under = { x: x + 14, y: y - 40 }, outside = { x: 40, y: 280 }, inside = { x, y: y + 26 };

    // Told what the ground is, the map keeps his cells on his side of the plank: no way in.
    const field = new FlowField(bounds);
    field.rebuild([plank, ...shield], [on], 6, [plank]);
    expect(field.direction(under), "under the plank").toBeNull();
    expect(field.direction(outside), "outside the shield").toBeNull();
    expect(field.direction(inside), "inside the shield").not.toBeNull();

    // Not told, it opens the cells within reach of him on both sides of the wood, and the ones
    // underneath lead out: every cell of the level then has a way in through the plank.
    const leaky = new FlowField(bounds);
    leaky.rebuild([plank, ...shield], [on], 6);
    expect(leaky.direction(under)).not.toBeNull();
    expect(leaky.direction(outside)).not.toBeNull();
  });

  it("knows when a line passes through a shape", () => {
    const slab = rect({ x: 0, y: 0, w: 100, h: 20 });
    // Down into it, along its top edge, and over it.
    expect(cuts(slab, { x: 50, y: 40 }, { x: 50, y: 10 })).toBe(true);
    expect(cuts(slab, { x: 10, y: 20 }, { x: 90, y: 20 })).toBe(false);
    expect(cuts(slab, { x: 10, y: 30 }, { x: 90, y: 30 })).toBe(false);
    const plank = segment({ x: 0, y: 0 }, { x: 100, y: 0 }, 3);
    expect(cuts(plank, { x: 50, y: 20 }, { x: 50, y: -20 })).toBe(true);
    expect(cuts(plank, { x: 50, y: 20 }, { x: 50, y: 4 })).toBe(false);
    expect(cuts(plank, { x: 50, y: 20 }, { x: 50, y: 2 })).toBe(true);
    const ball = circle({ x: 0, y: 0 }, 10);
    expect(cuts(ball, { x: -20, y: 5 }, { x: 20, y: 5 })).toBe(true);
    expect(cuts(ball, { x: -20, y: 12 }, { x: 20, y: 12 })).toBe(false);
  });
});
