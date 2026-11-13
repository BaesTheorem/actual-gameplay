import { describe, expect, it } from "vitest";
import { BLAST_IMPULSE, BLAST_RADIUS, BOMB_RADIUS } from "../src/sim/savedog/level";
import { distance } from "../src/sim/savedog/geometry";
import { STEP } from "../src/sim/sk";
import { GROUND, RELEASE, level, lying, play } from "./dog-v2-kit";

// A bomb lying on the grass at x 60.
const BOMB = { x: 60, y: GROUND + BOMB_RADIUS };

describe("a bomb", () => {
  it("lies where it is put and goes off at its time", () => {
    const lvl = level({ bombs: [{ ...BOMB, at: 2.5 }] });
    let before = { x: 0, y: 0 };
    const run = play(lvl, [lying(200, 60)], { seconds: 6, each: (sim) => { if (sim.bombs.length === 1) before = sim.bombs[0].position; } });
    // It rests on the grass, the engine's hair of a gap above it.
    expect(Math.abs(before.x - 60)).toBeLessThan(1);
    expect(Math.abs(before.y - (GROUND + BOMB_RADIUS))).toBeLessThan(1.5);
    // The blast comes 2.5 s after the bees came out, in the first frame at or past that time.
    const waited = run.when("blast") - run.sim.launchedAt!;
    expect(waited).toBeGreaterThanOrEqual(2.5 - 1e-9);
    expect(waited).toBeLessThan(2.5 + STEP);
    expect(run.sim.bombs.length).toBe(0);
    expect(run.sounds).toContain("blast");
    expect(run.count("blast")).toBe(1);
    expect([BLAST_RADIUS, BOMB_RADIUS, BLAST_IMPULSE]).toEqual([70, 12, 36]);
  });

  it("kills him in the open, inside its reach", () => {
    // He stands 50 points from it with nothing between.
    const lvl = level({ dogs: [{ id: "clawd", x: 110, y: GROUND + 18 }], bombs: [{ ...BOMB, at: 1 }] });
    const run = play(lvl, [lying(250, 60)], { seconds: 6 });
    expect(run.reason).toBe("Too close to the blast.");
    expect(run.when("blasted")).toBeCloseTo(RELEASE + 1, 1);
  });

  it("does not reach him past its reach", () => {
    // 80 points away, with nothing between.
    const lvl = level({ dogs: [{ id: "clawd", x: 140, y: GROUND + 18 }], bombs: [{ ...BOMB, at: 1 }] });
    const run = play(lvl, [lying(250, 60)], { seconds: 6 });
    expect(run.when("blast")).toBeGreaterThan(0);
    expect(run.sim.finished).toBe(false);
  });

  it("does not kill him behind ink", () => {
    // The same 50 points, and a post of pinned ink standing between them.
    const lvl = level({ pinnedInk: true, dogs: [{ id: "clawd", x: 110, y: GROUND + 18 }], bombs: [{ ...BOMB, at: 1 }] });
    const run = play(lvl, [[{ x: 84, y: GROUND + 5 }, { x: 84, y: GROUND + 50 }]], { seconds: 6 });
    expect(run.when("blast")).toBeGreaterThan(0);
    expect(run.when("blasted")).toBe(-1);
    expect(run.sim.finished).toBe(false);
  });

  it("does not kill him behind ink that falls, either, though it throws the ink", () => {
    const lvl = level({ dogs: [{ id: "clawd", x: 110, y: GROUND + 18 }], bombs: [{ ...BOMB, at: 1 }] });
    // A post standing between them. It is loose, so the blast knocks it away, and he lives.
    let at = 0;
    const run = play(lvl, [[{ x: 84, y: GROUND + 5 }, { x: 84, y: GROUND + 45 }]], {
      seconds: 3.2,
      each: (sim) => { if (sim.bombs.length === 1 && sim.strokes[0]) at = sim.strokes[0].position.x; },
    });
    expect(run.when("blasted")).toBe(-1);
    expect(run.sim.finished).toBe(false);
    expect(Math.abs(run.sim.strokes[0].position.x - at) + Math.abs(run.sim.strokes[0].angle) * 20).toBeGreaterThan(10);
  });

  it("does not kill him behind terrain", () => {
    const statics = [{ type: "rect", x: 0, y: 34, w: 402, h: 40, skin: "grass" }, { type: "rect", x: 80, y: GROUND, w: 10, h: 50, skin: "stone" }];
    const lvl = level({ statics, dogs: [{ id: "clawd", x: 112, y: GROUND + 18 }], bombs: [{ ...BOMB, at: 1 }] });
    const run = play(lvl, [lying(250, 60)], { seconds: 6 });
    expect(run.when("blast")).toBeGreaterThan(0);
    expect(run.sim.finished).toBe(false);
  });

  it("throws a loose bar about the width of Clawd, and leaves a pinned one where it is", () => {
    // A 150 point bar on the grass with the bomb at its end.
    const bar = lying(76, 150);
    const thrown = (pinnedInk: boolean) => {
      let start = 0;
      const run = play(level({ pinnedInk, bombs: [{ ...BOMB, at: 0.5 }] }), [bar], { seconds: 5, each: (sim) => { if (sim.bombs.length === 1 && sim.strokes[0]) start = sim.strokes[0].position.x; } });
      return run.sim.strokes[0].position.x - start;
    };
    const loose = thrown(false);
    expect(loose).toBeGreaterThan(30);
    expect(loose).toBeLessThan(50);
    expect(thrown(true)).toBe(0);
  });

  it("pushes a light bar further than a heavy one, and nothing beyond its reach", () => {
    const moved = (x: number, length: number) => {
      let start = 0;
      const run = play(level({ bombs: [{ ...BOMB, at: 0.5 }] }), [lying(x, length)], { seconds: 5, each: (sim) => { if (sim.bombs.length === 1 && sim.strokes[0]) start = sim.strokes[0].position.x; } });
      return run.sim.strokes[0].position.x - start;
    };
    expect(moved(76, 100)).toBeGreaterThan(2 * moved(76, 150));
    expect(moved(76, 150)).toBeGreaterThan(2 * moved(76, 228));
    // A bar whose nearest end is 72 points from the bomb's middle does not stir.
    expect(Math.abs(moved(132, 100))).toBeLessThan(0.01);
  });

  it("holds a wedged shape", () => {
    // A bar lying in a slot between two stone blocks, the bomb beside the near block: the blast
    // reaches the bar's end through the open top, and the far block stops it.
    const statics = [
      { type: "rect", x: 0, y: 34, w: 402, h: 40, skin: "grass" },
      { type: "rect", x: 196, y: GROUND, w: 20, h: 30, skin: "stone" },
    ];
    let start = 0;
    const run = play(level({ statics, bombs: [{ ...BOMB, at: 0.5 }] }), [lying(76, 118)], { seconds: 5, each: (sim) => { if (sim.bombs.length === 1 && sim.strokes[0]) start = sim.strokes[0].position.x; } });
    // Loose on open grass this bar goes more than 60 points. Against the block it goes nowhere.
    expect(Math.abs(run.sim.strokes[0].position.x - start)).toBeLessThan(3);
  });

  it("takes the bees inside its reach and no others", () => {
    // Bees come out one every 0.12 s beside the bomb, which goes off 0.3 s after the first.
    const lvl = level({ bombs: [{ ...BOMB, at: 0.3 }], hives: [{ x: 60, y: GROUND + 60, count: 8 }] });
    let near = 0, far = 0;
    const run = play(lvl, [lying(200, 60)], {
      seconds: RELEASE + 0.5,
      each: (sim) => {
        if (sim.bombs.length === 0) return;
        near = sim.bees.filter((bee) => distance(bee.position, sim.bombs[0].position) <= BLAST_RADIUS).length;
        far = sim.bees.length - near;
      },
    });
    expect(near).toBe(3);
    expect(far).toBe(0);
    expect(run.count("beeGone")).toBe(3);
    // The ones that came out after it are flying.
    expect(run.sim.swarm.alive).toBeGreaterThan(0);
    expect(run.sim.swarm.spawned - run.sim.swarm.alive).toBe(3);
  });

  it("never goes off once a pit has taken it, and burns no ink", () => {
    // It starts over water and sinks when the world starts.
    const sunk = level({ killers: [{ x: 20, y: GROUND, w: 80, h: 20, kind: "water" }], bombs: [{ x: 60, y: GROUND + 40, at: 2 }] });
    const run = play(sunk, [lying(200, 60)], { seconds: 6 });
    expect(run.when("sink")).toBeGreaterThan(0);
    expect(run.when("blast")).toBe(-1);

    const blast = play(level({ bombs: [{ ...BOMB, at: 0.5 }] }), [lying(76, 150)], { seconds: 5 });
    expect(blast.sim.strokes[0].alight).toBe(false);
    expect(blast.sim.strokes[0].length).toBeCloseTo(150, 6);
    expect(blast.when("catch")).toBe(-1);
  });
});
