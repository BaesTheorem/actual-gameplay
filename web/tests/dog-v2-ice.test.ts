import { describe, expect, it } from "vitest";
import { ICE_FRICTION } from "../src/sim/savedog/level";
import { SKWorld, position, velocity } from "../src/sim/sk";
import { level, play } from "./dog-v2-kit";

// A slope that falls 80 points over 280, which is 16 degrees. Ink grips grass at 0.79, far more
// than the 0.29 a slope like this asks for, and ice at 0.02, far less.
const slope = (skin: string) => ({ type: "chain", points: [[40, 220], [320, 140]], skin });
// A 100 point bar laid along the slope, a little above it.
const bar = [{ x: 100, y: 210 }, { x: 196, y: 182.6 }];

describe("ice", () => {
  it("lets a bar slide that grass holds", () => {
    const run = (skin: string) => {
      let landed = { x: 0, y: 0 };
      const played = play(level({ statics: [{ type: "rect", x: 0, y: 34, w: 402, h: 40, skin: "grass" }, slope(skin)] }), [bar], {
        seconds: 1.5,
        each: (sim) => { if (Math.abs(sim.elapsed - 0.6) < 0.01) landed = sim.strokes[0].position; },
      });
      const now = played.sim.strokes[0].position;
      return Math.hypot(now.x - landed.x, now.y - landed.y);
    };
    expect(run("grass")).toBeLessThan(1);
    expect(run("stone")).toBeLessThan(1);
    // On ice it is off down the slope: 0.9 seconds at about 380 points a second every second.
    expect(run("ice")).toBeGreaterThan(100);
  });

  it("has a friction of 0.02 for everything that touches it", () => {
    expect(ICE_FRICTION).toBe(0.02);
    // A box sent along a flat floor at 300 points a second. The floor's own friction is 0.7 and
    // the box's is 0.9; on a floor with a surface of 0.02 the box slows at 0.02 times gravity.
    const slide = (surface?: number) => {
      const sk = new SKWorld(-9.8);
      sk.box({ kind: "floor", dynamic: false, category: 1, friction: 0.7, restitution: 0, ...(surface === undefined ? {} : { surface }) }, 4000, 20, { x: 0, y: -10 });
      const box = sk.box({ kind: "box", position: { x: 0, y: 5.5 }, category: 1, friction: 0.9, restitution: 0, linearDamping: 0 }, 20, 10);
      for (let i = 0; i < 30; i++) sk.step();
      box.setLinearVelocity({ x: 2, y: 0 });
      for (let i = 0; i < 30; i++) sk.step();
      return { speed: velocity(box).x, x: position(box).x };
    };
    const ice = slide(ICE_FRICTION), stone = slide();
    // Half a second at 0.02 times 1470 is 14.7 points a second lost.
    expect(300 - ice.speed).toBeCloseTo(14.7, 0);
    // Stone stops it within the half second.
    expect(stone.speed).toBeCloseTo(0, 1);
    expect(ice.x).toBeGreaterThan(3 * stone.x);
  });

  it("is ground like any other in every other way", () => {
    // He stands on it, a bar rests on it, and bees treat it as the wall it is.
    const icy = level({ statics: [{ type: "rect", x: 0, y: 34, w: 402, h: 40, skin: "ice" }] });
    const run = play(icy, [[{ x: 100, y: 80.3 }, { x: 200, y: 80.3 }]], { seconds: 3 });
    expect(Math.abs(run.sim.dogs[0].position.y - 92)).toBeLessThan(1.5);
    expect(Math.abs(run.sim.strokes[0].position.y - 80.3)).toBeLessThan(1.5);
    expect(run.sim.terrain[0]).toMatchObject({ type: "rect", skin: "ice", solid: true });
  });
});
