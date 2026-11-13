import { describe, expect, it } from "vitest";
import { BEE_RADIUS, DOG_RADIUS } from "../src/sim/savedog/beecrew";
import { distanceToRect } from "../src/sim/savedog/geometry";
import { BURN_SPEED, FLAME_BERTH, FLAME_HEIGHT, FLAME_WIDTH } from "../src/sim/savedog/level";
import { STEP, setPosition } from "../src/sim/sk";
import { GROUND, MIDDLE, RELEASE, level, lying, play } from "./dog-v2-kit";

// A flame standing on the grass at x 100: it fills x 88 to 112 and y 74 to 106.
const FLAME = { x: 100, y: GROUND };

describe("a flame", () => {
  it("is 24 points wide and 32 tall, standing on its point", () => {
    const { sim } = play(level({ fires: [FLAME] }), [], { seconds: 0.1 });
    expect(sim.flames).toEqual([{ x: 100 - FLAME_WIDTH / 2, y: GROUND, w: FLAME_WIDTH, h: FLAME_HEIGHT }]);
    expect([FLAME_WIDTH, FLAME_HEIGHT, BURN_SPEED]).toEqual([24, 32, 40]);
  });

  it("burns ink that touches it, from the touch along the stroke at 40 points a second", () => {
    // A 200 point bar on the grass with its left end in the flame.
    const lengths: { at: number; left: number }[] = [];
    const run = play(level({ fires: [FLAME] }), [lying(110, 200)], {
      seconds: 7,
      each: (sim) => { if (sim.strokes.length === 1) lengths.push({ at: sim.elapsed, left: sim.strokes[0].length }); },
    });
    const caught = run.when("catch");
    // It caught in the frame it was drawn, because it was drawn into the flame.
    expect(caught).toBeCloseTo(0.3, 2);
    expect(run.sounds).toContain("burn");
    // The part in the flame went at once. After that, 40 points every second, from that end only.
    const after = (seconds: number) => lengths.find((l) => l.at >= caught + seconds - 1e-9)!.left;
    const start = after(0);
    expect(start).toBeGreaterThan(185);
    expect(start).toBeLessThan(200);
    expect(start - after(1)).toBeCloseTo(BURN_SPEED, 0);
    expect(start - after(3)).toBeCloseTo(3 * BURN_SPEED, 0);
    // Frame by frame it is the same speed.
    for (let i = 1; i < 60; i++) expect(lengths[i + 10].left - lengths[i + 11].left).toBeCloseTo(BURN_SPEED * STEP, 6);
    // All of it is gone a little under five seconds after it caught, and it left ash.
    expect(run.sim.strokes.length).toBe(0);
    expect(run.when("ash") - caught).toBeCloseTo(start / BURN_SPEED, 0);
    expect(run.count("catch")).toBe(1);
  });

  it("burns only the end that touched it", () => {
    let alight = { start: false, end: false }, embers = 0;
    play(level({ fires: [FLAME] }), [lying(110, 200)], {
      seconds: 2,
      each: (sim) => { if (sim.strokes.length === 1) { alight = { ...sim.strokes[0].burning }; embers = sim.embers.length; } },
    });
    expect(alight).toEqual({ start: true, end: false });
    expect(embers).toBe(1);
  });

  it("makes two pieces of a stroke it lights in the middle, and both go on burning", () => {
    // A 160 point bar on the grass with the flame at its middle.
    const run = play(level({ fires: [{ x: 200, y: GROUND }] }), [lying(120, 160)], { seconds: 1.4 });
    const pieces = run.sim.strokes;
    expect(pieces.length).toBe(2);
    const [left, right] = [...pieces].sort((a, b) => a.position.x - b.position.x);
    // Each burns at the end the flame made, and nowhere else.
    expect(left.burning).toEqual({ start: false, end: true });
    expect(right.burning).toEqual({ start: true, end: false });
    expect(run.sim.embers.length).toBe(2);
    // The flame took 32 points out of the middle (its own 24 and the ink's half width each side, to
    // the nearest sample) and each piece has since lost 40 points a second.
    const burning = run.sim.elapsed - run.when("catch");
    for (const piece of pieces) expect(piece.length).toBeCloseTo(63 - BURN_SPEED * burning, 0);
    // A second later each is 40 points shorter, and then they are gone.
    const later = play(level({ fires: [{ x: 200, y: GROUND }] }), [lying(120, 160)], { seconds: 3 });
    expect(later.sim.strokes.length).toBe(0);
    expect(later.count("ash")).toBe(2);
  });

  it("leaves ink alone that does not touch it, and burning ink lights no other ink", () => {
    // A bar that stops 10 points short of the flame.
    const near = play(level({ fires: [FLAME] }), [lying(126, 200)], { seconds: 4 });
    expect(near.sim.strokes.length).toBe(1);
    expect(near.sim.strokes[0].length).toBeCloseTo(200, 6);
    expect(near.sim.strokes[0].alight).toBe(false);
    expect(near.when("catch")).toBe(-1);

    // A bar with its end in the flame, and a second bar lying along the top of it, 70 points from the flame.
    const stacked = play(level({ fires: [FLAME] }), [lying(110, 120), [{ x: 180, y: 90 }, { x: 260, y: 90 }]], { seconds: 6 });
    // The lower bar burned away from under the upper one, which is whole and was never alight.
    expect(stacked.sim.strokes.length).toBe(1);
    expect(stacked.sim.strokes[0].length).toBeCloseTo(80, 6);
    expect(stacked.sim.strokes[0].alight).toBe(false);
    expect(stacked.sim.strokes[0].position.y).toBeLessThan(GROUND + 10);
    expect(stacked.count("catch")).toBe(1);
    expect(stacked.count("ash")).toBe(1);
  });

  it("ends the level when he touches it", () => {
    // He starts in the air over a flame and comes down onto it once the first stroke sets the world going.
    const lvl = level({ fires: [{ x: 201, y: GROUND }], dogs: [{ id: "clawd", x: 201, y: 150 }] });
    let gap = Infinity;
    const run = play(lvl, [lying(300, 40)], { seconds: 3, each: (sim) => { gap = distanceToRect(sim.dogs[0].position, sim.flames[0]); } });
    expect(run.reason).toBe("Clawd got burned.");
    expect(run.when("burned")).toBeGreaterThan(0.3);
    expect(gap).toBeLessThanOrEqual(DOG_RADIUS);
    expect(gap).toBeGreaterThan(DOG_RADIUS - 8);
    expect(run.sounds).toContain("sizzle");
  });
});

describe("bees and a flame", () => {
  // Clawd in a stone room whose only way in is a door on the right, 32 points high at the ground.
  const room = [
    { type: "rect", x: 150, y: GROUND, w: 14, h: 80, skin: "stone" },
    { type: "rect", x: 150, y: GROUND + 66, w: 114, h: 14, skin: "stone" },
    { type: "rect", x: 250, y: GROUND + 32, w: 14, h: 48, skin: "stone" },
  ];
  const statics = [{ type: "rect", x: 0, y: 34, w: 402, h: 40, skin: "grass" }, ...room];
  const hives = [{ x: 340, y: 300, count: 6 }];
  // A dot of ink far from everything sets the world going.
  const dot = [[{ x: 40, y: 200 }]];

  it("come in through an open door", () => {
    const run = play(level({ statics, hives, dogs: [MIDDLE] }), dot);
    expect(run.reason).toBe("The bees got clawd.");
  });

  it("have no route through a door with a flame in it, and do not fly into the flame", () => {
    let alive = 0, nearest = Infinity, routes = 0;
    const run = play(level({ statics, hives, dogs: [MIDDLE], fires: [{ x: 257, y: GROUND }] }), dot, {
      each: (sim) => {
        if (!sim.released) return;
        alive = sim.swarm.alive;
        if (sim.routeOpen) routes += 1;
        for (const bee of sim.bees) nearest = Math.min(nearest, distanceToRect(bee.position, sim.flames[0]));
      },
    });
    expect(run.won).toBe(true);
    expect(routes).toBe(0);
    // No cell outside the room has a way to him, and one inside it does.
    expect(run.sim.field.direction({ x: 340, y: 300 })).toBeNull();
    expect(run.sim.field.direction({ x: 300, y: 90 })).toBeNull();
    expect(run.sim.field.direction({ x: 180, y: 110 })).not.toBeNull();
    // All six are still flying, and none came nearer than its berth.
    expect(alive).toBe(6);
    expect(run.count("singe")).toBe(0);
    expect(nearest).toBeGreaterThanOrEqual(BEE_RADIUS + FLAME_BERTH - 0.5);
  });

  it("lose the bee that is pushed into a flame", () => {
    let pushed = false;
    const run = play(level({ statics, hives, dogs: [MIDDLE], fires: [{ x: 257, y: GROUND }] }), dot, {
      seconds: 6,
      each: (sim) => {
        // Nothing in this level can shove a bee, so one is put in the flame by hand.
        if (pushed || sim.bees.length < 6) return;
        setPosition(sim.bees[0].body, { x: 257, y: GROUND + 16 });
        pushed = true;
      },
    });
    expect(pushed).toBe(true);
    expect(run.sim.swarm.alive).toBe(5);
    expect(run.count("singe")).toBe(1);
    expect(run.when("singe")).toBeGreaterThan(RELEASE);
  });
});
