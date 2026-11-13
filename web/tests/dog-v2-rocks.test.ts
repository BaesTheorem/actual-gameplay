import { describe, expect, it } from "vitest";
import { CRUSH_SPEED, ROCK_DENSITY, ROCK_RADIUS } from "../src/sim/savedog/level";
import { STEP, speed } from "../src/sim/sk";
import { DOME, GROUND, MIDDLE, RELEASE, level, lying, play } from "./dog-v2-kit";

describe("a boulder", () => {
  it("is held still at its point until its time, and then falls", () => {
    // Let go two seconds after the bees are out, 226 points above the grass.
    const lvl = level({ rocks: [{ x: 120, y: 300, at: 2 }] });
    const heights: { at: number; y: number; held: boolean }[] = [];
    const run = play(lvl, [lying(200, 60)], {
      seconds: 6,
      each: (sim) => heights.push({ at: sim.elapsed, y: sim.rocks[0].position.y, held: sim.rocks[0].held }),
    });
    const rock = run.sim.rocks[0];
    expect(rock.radius).toBe(ROCK_RADIUS);
    // A ball of radius 16 at four times the density of water on this canvas.
    expect(rock.body!.getMass()).toBeCloseTo((Math.PI * 16 * 16 * ROCK_DENSITY) / 22_500, 6);
    // Until its time it has not moved at all, and nothing reported it loose.
    const let_go = run.sim.launchedAt! + 2;
    for (const h of heights.filter((h) => h.at < let_go - 1e-6)) {
      expect(h.y).toBe(300);
      expect(h.held).toBe(true);
    }
    expect(run.when("loose")).toBeGreaterThanOrEqual(let_go - 1e-9);
    expect(run.when("loose")).toBeLessThan(let_go + STEP);
    // Then it falls as anything does: 1470 points a second every second.
    const after = (seconds: number) => heights.find((h) => h.at >= let_go + seconds - 1e-9)!.y;
    expect(300 - after(0.3)).toBeGreaterThan(55);
    expect(300 - after(0.3)).toBeLessThan(75);
    // It lands hard, is heard, and comes to rest on the grass.
    expect(run.when("thud")).toBeGreaterThan(let_go + 0.4);
    expect(run.sounds).toContain("rockLoose");
    expect(run.sounds).toContain("boulderLand");
    expect(Math.abs(rock.position.y - (GROUND + ROCK_RADIUS))).toBeLessThan(1.5);
    expect(rock.held).toBe(false);
  });

  it("holds up ink while it is held, and drops with it", () => {
    // A bar laid across the top of a held boulder stays there, 60 points over the grass.
    const lvl = level({ rocks: [{ x: 120, y: 150, at: 3 }] });
    let resting = 0;
    const run = play(lvl, [[{ x: 100, y: 172 }, { x: 140, y: 172 }]], {
      seconds: 7,
      each: (sim) => { if (Math.abs(sim.elapsed - (RELEASE + 2.5)) < 0.01) resting = sim.strokes[0].position.y; },
    });
    expect(resting).toBeGreaterThan(165);
    expect(run.sim.strokes[0].position.y).toBeLessThan(GROUND + 45);
  });

  it("flattens him when it meets him fast", () => {
    // Straight over his head, with nothing in between.
    const lvl = level({ dogs: [MIDDLE], rocks: [{ x: 201, y: 300, at: 1 }] });
    let fastest = 0;
    const run = play(lvl, [lying(300, 40)], { seconds: 8, each: (sim) => { if (sim.rocks[0]?.body) fastest = Math.max(fastest, speed(sim.rocks[0].body)); } });
    expect(run.reason).toBe("Flattened.");
    expect(fastest).toBeGreaterThan(CRUSH_SPEED);
    expect(run.when("flattened")).toBeGreaterThan(RELEASE + 1);
    expect(run.when("flattened")).toBeLessThan(RELEASE + 2);
  });

  it("does not flatten him when ink stops it first", () => {
    // The same boulder, and a dome over him. It lands on the dome and rolls off.
    const lvl = level({ dogs: [MIDDLE], rocks: [{ x: 201, y: 300, at: 1 }] });
    const run = play(lvl, [DOME], { seconds: 9 });
    expect(run.sim.finished).toBe(false);
    expect(run.when("flattened")).toBe(-1);
    expect(run.when("thud")).toBeGreaterThan(RELEASE + 1);
    // The dome is still over him.
    expect(Math.abs(run.sim.strokes[0].position.x - 201)).toBeLessThan(20);
  });

  it("only pushes him when it meets him slowly", () => {
    // Let go from 3 points above his head: it reaches him at about 90 points a second.
    const lvl = level({ dogs: [MIDDLE], rocks: [{ x: 201, y: GROUND + 36 + ROCK_RADIUS + 3, at: 1 }] });
    const run = play(lvl, [lying(300, 40)], { seconds: 8 });
    expect(run.when("flattened")).toBe(-1);
    expect(run.sim.finished).toBe(false);
  });

  it("flies through bees and they through it, and is no wall to them", () => {
    // A boulder resting in the only doorway of a stone room does not keep the bees out.
    const statics = [
      { type: "rect", x: 0, y: 34, w: 402, h: 40, skin: "grass" },
      { type: "rect", x: 150, y: GROUND, w: 14, h: 80, skin: "stone" },
      { type: "rect", x: 150, y: GROUND + 66, w: 114, h: 14, skin: "stone" },
      { type: "rect", x: 250, y: GROUND + 34, w: 14, h: 46, skin: "stone" },
    ];
    const lvl = level({ statics, dogs: [MIDDLE], rocks: [{ x: 257, y: GROUND + 17, at: 0 }], hives: [{ x: 340, y: 300, count: 6 }] });
    const run = play(lvl, [[{ x: 40, y: 200 }]]);
    expect(run.reason).toBe("The bees got clawd.");
  });
});
