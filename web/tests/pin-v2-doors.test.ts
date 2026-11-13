import { describe, expect, it } from "vitest";
import { BOULDER_RADIUS, DOOR_SECONDS, doorRect, type PinLevel } from "../src/sim/pinpull";
import { STEP, position } from "../src/sim/sk";
import { FLOOR, level, play } from "./pin-v2-kit";

// A door 60 points tall between the hero and the gem. It slides up.
const DOOR = { id: "d", x: 220, y: FLOOR, w: 14, h: 60, slide: "up" as const };
const WALKERS = { hero: { x: 170, y: FLOOR + 16 }, treasure: { x: 320, y: FLOOR + 11 } };

describe("a plate and its door", () => {
  // A boulder on a pin, in a bay of its own at the left, over a plate on the floor.
  const dropped: PinLevel = level({
    walls: [{ x: 110, y: 150, w: 14, h: 80 }], pins: [{ id: "p1", x: 38, y: 150, w: 72, side: "left" }],
    boulders: [{ x: 74, y: 150 + 14 + BOULDER_RADIUS }], plates: [{ id: "a", x: 50, y: FLOOR, w: 48, opens: ["d"] }], doors: [DOOR],
    actors: WALKERS, solution: ["p1"],
  });

  it("the door is a wall while its plate is up", () => {
    let walked = false;
    const run = play(dropped, [], { seconds: 3, each: (sim) => { walked ||= sim.heroWalking; } });
    expect(run.sim.plates[0].pressed).toBe(false);
    expect(run.sim.doors[0].open).toBe(0);
    expect(walked).toBe(false);
  });

  it("a boulder on the plate opens the door, over a quarter of a second, and the hero walks through", () => {
    let pressedAt = -1, openAt = -1;
    const run = play(dropped, ["p1"], {
      each: (sim) => {
        if (pressedAt < 0 && sim.plates[0].pressed) pressedAt = sim.elapsed;
        if (openAt < 0 && sim.doors[0].open === 1) openAt = sim.elapsed;
      },
    });
    expect(pressedAt).toBeGreaterThan(1);
    expect(run.when("plateDown")).toBeCloseTo(pressedAt, 5);
    expect(Math.round((openAt - pressedAt) / STEP)).toBe(Math.round(DOOR_SECONDS / STEP) - 1);
    // Open, it has moved up by its own height.
    expect(doorRect(run.sim.doors[0])).toEqual({ x: 220, y: FLOOR + 60, w: 14, h: 60 });
    expect(run.won).toBe(true);
    expect(position(run.sim.hero!).x).toBeGreaterThan(260);
  });

  it("liquid does not press a plate", () => {
    const run = play(level({
      walls: [{ x: 110, y: FLOOR, w: 14, h: 162 }], pins: [{ id: "p1", x: 38, y: 150, w: 72, side: "left" }],
      pools: [{ liquid: "water", x: 40, y: 164, w: 68, h: 40, count: 60 }], plates: [{ id: "a", x: 50, y: FLOOR, w: 48, opens: ["d"] }], doors: [DOOR],
    }), ["p1"], { seconds: 5 });
    expect(run.sim.particles.filter((p) => position(p.body).y < FLOOR + 20).length).toBeGreaterThan(10);
    expect(run.sim.plates[0].pressed).toBe(false);
    expect(run.sim.doors[0].open).toBe(0);
  });

  it("the gem, a crate and a living character press it, and a goblin that is knocked out does not", () => {
    const pressedBy = (parts: Partial<PinLevel>) =>
      play(level({ plates: [{ id: "a", x: 50, y: FLOOR, w: 48, opens: ["d"] }], doors: [DOOR], ...parts }), [], { seconds: 1 }).sim.plates[0].pressed;
    expect(pressedBy({ actors: { treasure: { x: 74, y: FLOOR + 11 } } })).toBe(true);
    expect(pressedBy({ bombs: [{ x: 74, y: FLOOR + 12 }] })).toBe(true);
    expect(pressedBy({ actors: { hero: { x: 74, y: FLOOR + 16 } } })).toBe(true);
    expect(pressedBy({ actors: { friend: { x: 74, y: FLOOR + 13 } } })).toBe(true);
    expect(pressedBy({ actors: { foes: [{ x: 74, y: FLOOR + 16 }] } })).toBe(true);
    expect(pressedBy({})).toBe(false);
    // A goblin standing on the plate under a cup of water: the water knocks him out, and the plate comes up.
    const drowned = play(level({
      walls: [{ x: 36, y: 200, w: 14, h: 50 }, { x: 98, y: 200, w: 14, h: 50 }, { x: 110, y: FLOOR, w: 14, h: 40 }],
      pins: [{ id: "p1", x: 50, y: 200, w: 48, side: "right" }], pools: [{ liquid: "water", x: 52, y: 214, w: 44, h: 30, count: 12 }],
      plates: [{ id: "a", x: 50, y: FLOOR, w: 48, opens: ["d"] }], doors: [DOOR], actors: { foes: [{ x: 74, y: FLOOR + 16 }] },
    }), ["p1"], { seconds: 5 });
    expect(drowned.sim.foes[0].state).toBe("ko");
    expect(drowned.when("plateUp")).toBeGreaterThan(drowned.when("knockout") - STEP);
    expect(drowned.sim.plates[0].pressed).toBe(false);
  });
});

describe("a door whose plate is let go", () => {
  /// A boulder resting on a plate that lies on pin p1, over a pit. The door is open from the
  /// start, and pulling the pin takes the boulder off the plate.
  const resting = (door: object, more: Partial<PinLevel> = {}): PinLevel => level({
    walls: [{ x: 110, y: FLOOR, w: 14, h: 162 }], pins: [{ id: "p1", x: 38, y: 150, w: 72, side: "left" }],
    boulders: [{ x: 74, y: 150 + 14 + BOULDER_RADIUS }], plates: [{ id: "a", x: 50, y: 150 + 14, w: 48, opens: ["d"] }],
    doors: [{ ...DOOR, ...door }], ...more,
  });

  it("is open while the boulder rests on the plate", () => {
    const run = play(resting({}), [], { seconds: 0.7 });
    expect(run.sim.plates[0].pressed).toBe(true);
    expect(run.sim.doors[0].open).toBe(1);
  });

  it("shuts when the boulder leaves", () => {
    const run = play(resting({}), ["p1"], { seconds: 4 });
    expect(position(run.sim.boulders[0].body).y).toBeLessThan(FLOOR + BOULDER_RADIUS + 4);
    expect(run.when("plateUp")).toBeGreaterThan(0.8);
    expect(run.sim.plates[0].pressed).toBe(false);
    expect(run.sim.doors[0].open).toBe(0);
    expect(doorRect(run.sim.doors[0])).toEqual({ x: 220, y: FLOOR, w: 14, h: 60 });
  });

  it("stays open when it has a latch", () => {
    const run = play(resting({ latch: true }), ["p1"], { seconds: 4 });
    expect(run.sim.plates[0].pressed).toBe(false);
    expect(run.sim.doors[0].open).toBe(1);
  });

  it("does not start to shut while something is in its doorway", () => {
    // The door slides down into the floor here, and a second boulder waits on pin p2 over the doorway.
    const blocked = resting({ h: 40, slide: "down" }, {
      parPins: 2, walls: [{ x: 110, y: FLOOR, w: 14, h: 162 }, { x: 170, y: 150, w: 14, h: 80 }, { x: 250, y: 150, w: 14, h: 80 }],
      pins: [{ id: "p1", x: 38, y: 150, w: 72, side: "left" }, { id: "p2", x: 184, y: 150, w: 66, side: "right" }],
      boulders: [{ x: 74, y: 150 + 14 + BOULDER_RADIUS }, { x: 227, y: 150 + 14 + BOULDER_RADIUS }],
    });
    // The second boulder comes down into the open doorway and stays. Then the plate is let go.
    const held = play(blocked, ["p2", "p1"], { seconds: 8 });
    expect(Math.abs(position(held.sim.boulders[1].body).x - 227)).toBeLessThan(18);
    expect(held.sim.plates[0].pressed).toBe(false);
    expect(held.sim.doors[0].open).toBe(1);
    // With the doorway empty, the same door shuts.
    const empty = play(blocked, ["p1"], { seconds: 4 });
    expect(empty.sim.doors[0].open).toBe(0);
  });
});
