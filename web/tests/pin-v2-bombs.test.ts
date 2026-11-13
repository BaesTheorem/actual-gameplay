import { describe, expect, it } from "vitest";
import { BLAST_RADIUS, BOMB_FUSE, BOULDER_RADIUS, PinSim, type Bomb, type PinLevel } from "../src/sim/pinpull";
import { STEP, position } from "../src/sim/sk";
import { FLOOR, cup, level, play } from "./pin-v2-kit";

// A crate on the floor at x 200, under a cup of lava. The lava is let down by pin p1.
const CRATE = { x: 200, y: FLOOR + 12 };
const lava = cup("p1", 178, 200, 44);
const LAVA = { liquid: "lava", ...lava.inside, count: 12 };

describe("a bomb", () => {
  // A plain wall 36 points to its left and a cracked one 36 points to its right, both well inside the blast.
  const plain = { x: 150, y: FLOOR, w: 14, h: 60 }, cracked = { x: 236, y: FLOOR, w: 14, h: 60 };
  const walled = level({
    walls: [...lava.walls, plain], cracked: [cracked], pins: [lava.pin], pools: [LAVA], bombs: [CRATE],
    actors: { hero: { x: 80, y: FLOOR + 16 }, treasure: { x: 330, y: FLOOR + 11 } },
  });
  const stone = (sim: PinSim, rect: { x: number; y: number; w: number; h: number }) =>
    sim.sk.bodiesAt({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }).length > 0;

  it("is a crate that sits where it is put and does nothing by itself", () => {
    const run = play(walled, [], { seconds: 2 });
    expect(run.sim.bombs[0].state).toBe("dry");
    expect(position(run.sim.bombs[0].body).y).toBeCloseTo(FLOOR + 12, -1);
    expect(stone(run.sim, cracked)).toBe(true);
  });

  it("is lit by lava, goes off 0.7 s later, and takes a cracked wall with it but not a plain one", () => {
    const run = play(walled, ["p1"], { seconds: 4 });
    expect(run.when("fuse")).toBeGreaterThan(1);
    expect(run.when("blast") - run.when("fuse")).toBeCloseTo(BOMB_FUSE, 1);
    expect(Math.round((run.when("blast") - run.when("fuse")) / STEP)).toBe(Math.round(BOMB_FUSE / STEP));
    expect(run.sim.bombs[0].state).toBe("gone");
    expect(run.sim.cracked[0].gone).toBe(true);
    expect(stone(run.sim, cracked)).toBe(false);
    expect(stone(run.sim, plain)).toBe(true);
    expect(run.when("rubble")).toBeCloseTo(run.when("blast"), 5);
    // The hero was 120 points away, out of its reach.
    expect(run.sim.heroState).toBe("idle");
  });

  it("is a dud for good once water has reached it first", () => {
    // Two cups side by side over the crate: water in the left one on pin p1, lava in the right one on pin p2.
    const both = level({
      ...walled, parPins: 2,
      walls: [{ x: 146, y: 200, w: 14, h: 50 }, { x: 194, y: 200, w: 12, h: 50 }, { x: 240, y: 200, w: 14, h: 50 }, plain],
      pins: [{ id: "p1", x: 160, y: 200, w: 34, side: "left" }, { id: "p2", x: 206, y: 200, w: 34, side: "right" }],
      pools: [{ liquid: "water", x: 162, y: 214, w: 30, h: 30, count: 12 }, { liquid: "lava", x: 208, y: 214, w: 30, h: 30, count: 12 }],
    });
    let everLit = false;
    const wet = play(both, ["p1", "p2"], { seconds: 8, each: (sim) => { everLit ||= sim.bombs[0].state === "lit"; } });
    expect(wet.when("soak")).toBeGreaterThan(1);
    expect(everLit).toBe(false);
    expect(wet.sim.bombs[0].state).toBe("wet");
    expect(wet.when("blast")).toBe(-1);
    expect(stone(wet.sim, cracked)).toBe(true);
    // It is still a solid crate, standing on the floor.
    expect(wet.sim.sk.bodiesAt(position(wet.sim.bombs[0].body)).length).toBe(1);

    // The other way round, the lava lights it and the water that follows changes nothing.
    const lit = play(both, ["p2", "p1"], { seconds: 8 });
    expect(lit.when("blast")).toBeGreaterThan(1);
    expect(lit.when("soak")).toBe(-1);
    expect(stone(lit.sim, cracked)).toBe(false);
  });
});

describe("a blast", () => {
  // The hero stands on a shelf 62 points from the crate, in plain sight of it. The lava cannot reach him there.
  const shelf = { x: 236, y: FLOOR, w: 128, h: 30 };
  const watching = (walls: { x: number; y: number; w: number; h: number }[]) => level({
    winWhen: "heroReachesGoal", walls: [...lava.walls, shelf, ...walls], pins: [lava.pin], pools: [LAVA], bombs: [CRATE],
    actors: { hero: { x: 252, y: FLOOR + 30 + 16 }, goal: { x: 38, y: 300, w: 40, h: 40 } },
  });

  it("kills the hero when he is inside its reach with nothing in between", () => {
    const run = play(watching([]), ["p1"]);
    expect(run.reason).toBe("Too close to the blast.");
    expect(run.sim.heroStateSince).toBeCloseTo(run.when("blast"), 5);
  });

  it("does not kill him behind a wall", () => {
    // The same, with a wall from the floor to the cup standing between the crate and the shelf.
    const run = play(watching([{ x: 222, y: FLOOR, w: 14, h: 132 }]), ["p1"], { seconds: 6 });
    expect(run.when("blast")).toBeGreaterThan(1);
    expect(run.sim.heroState).toBe("idle");
    expect(run.reason).not.toBe("Too close to the blast.");
  });

  it("does not kill him outside its reach", () => {
    const far = watching([]);
    far.actors.hero = { x: 300, y: FLOOR + 30 + 16 };
    const run = play(far, ["p1"], { seconds: 6 });
    expect(Math.hypot(300 - CRATE.x, FLOOR + 46 - CRATE.y)).toBeGreaterThan(BLAST_RADIUS);
    expect(run.when("blast")).toBeGreaterThan(1);
    expect(run.sim.heroState).toBe("idle");
  });

  it("knocks out a goblin and kills the friend", () => {
    const goblin = watching([]);
    goblin.actors = { hero: { x: 340, y: FLOOR + 46 }, foes: [{ x: 252, y: FLOOR + 46 }], goal: { x: 38, y: 300, w: 40, h: 40 } };
    // The goblin sets off for the hero, away from the crate, so it is put off with a wall behind him.
    goblin.walls = [...goblin.walls!, { x: 270, y: FLOOR + 30, w: 14, h: 60 }];
    expect(play(goblin, ["p1"], { seconds: 6 }).sim.foes[0].state).toBe("ko");

    const friend = watching([]);
    friend.winWhen = "heroReachesFriend";
    friend.actors = { hero: { x: 340, y: FLOOR + 46 }, friend: { x: 252, y: FLOOR + 43 } };
    friend.walls = [...friend.walls!, { x: 270, y: FLOOR + 30, w: 14, h: 60 }];
    expect(play(friend, ["p1"]).reason).toBe("Your friend was too close to the blast.");
  });

  it("lights a second bomb, which goes off 0.7 s after the first", () => {
    // The second crate is on a shelf, 54 points from the first and out of the lava's way. The
    // cracked wall is within reach of the second crate only.
    const chain = level({
      walls: [...lava.walls, { x: 233, y: FLOOR, w: 131, h: 30 }], cracked: [{ x: 300, y: FLOOR + 30, w: 14, h: 60 }],
      pins: [lava.pin], pools: [LAVA], bombs: [CRATE, { x: 245, y: FLOOR + 30 + 12 }],
      actors: { hero: { x: 80, y: FLOOR + 16 }, treasure: { x: 284, y: FLOOR + 30 + 11 } },
    });
    const blasts: number[] = [];
    const run = play(chain, ["p1"], { seconds: 6 });
    for (const moment of run.moments) if (moment.name === "blast") blasts.push(moment.at);
    expect(blasts.length).toBe(2);
    expect(blasts[1] - blasts[0]).toBeCloseTo(BOMB_FUSE, 1);
    expect(run.sim.bombs.map((b) => b.state)).toEqual(["gone", "gone"]);
    expect(run.sim.cracked[0].gone).toBe(true);
    // The gem was 39 points from the second blast. It is still a gem, and still on its shelf.
    expect(run.sim.treasureMelting).toBe(-1);
    expect(position(run.sim.treasure!).y).toBeGreaterThan(FLOOR + 30);
  });

  it("rolls a boulder beside it about its own width, and moves the gem a few points", () => {
    // No lava here: the crate is lit by hand, so nothing but the blast moves anything.
    const lvl: PinLevel = level({ bombs: [CRATE], boulders: [{ x: CRATE.x + 12 + BOULDER_RADIUS + 1, y: FLOOR + BOULDER_RADIUS }], actors: { treasure: { x: CRATE.x - 26, y: FLOOR + 11 } } });
    const sim = new PinSim(lvl);
    for (let i = 0; i < 30; i++) sim.frame();
    const boulder = position(sim.boulders[0].body).x, gem = position(sim.treasure!);
    (sim as unknown as { light(bomb: Bomb): void }).light(sim.bombs[0]);
    let top = 0;
    for (let i = 0; i < 60 * 5; i++) {
      sim.frame();
      top = Math.max(top, position(sim.treasure!).y);
    }
    const rolled = position(sim.boulders[0].body).x - boulder;
    expect(rolled).toBeGreaterThan(BOULDER_RADIUS * 1.4);
    expect(rolled).toBeLessThan(BOULDER_RADIUS * 2.8);
    expect(gem.x - position(sim.treasure!).x).toBeGreaterThan(1);
    expect(gem.x - position(sim.treasure!).x).toBeLessThan(26);
    expect(top - gem.y).toBeLessThan(10);
  });
});
