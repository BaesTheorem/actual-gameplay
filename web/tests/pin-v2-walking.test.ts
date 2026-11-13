import { describe, expect, it } from "vitest";
import { position } from "../src/sim/sk";
import { FLOOR, cup, doorPin, level, play, ramp } from "./pin-v2-kit";

const HERO = { x: 80, y: FLOOR + 16 }, GEM = { x: 320, y: FLOOR + 11 };

/// A floor with a dip in the middle of it, eight points deep: the most a walker steps down or up.
/// The dip holds a puddle where it is, between x 150 and x 250.
const DIP = [{ x: 38, y: FLOOR, w: 112, h: 32 }, { x: 150, y: FLOOR, w: 100, h: 24 }, { x: 250, y: FLOOR, w: 114, h: 32 }];
const DIP_TOP = FLOOR + 32;
const puddle = (liquid: string) => ({ liquid, x: 152, y: FLOOR + 24, w: 96, h: 8, count: 14 });

describe("the hero walks", () => {
  const behindADoor = level({ pins: [doorPin("p1", 200)], actors: { hero: HERO, treasure: GEM }, solution: ["p1"] });

  it("stays where he is while a pin stands between him and the gem", () => {
    let walked = false;
    const run = play(behindADoor, [], { each: (sim) => { walked ||= sim.heroWalking; } });
    expect(walked).toBe(false);
    expect(position(run.sim.hero!).x).toBeCloseTo(80, 0);
    expect(run.reason).toBe("Settled short of the goal.");
  });

  it("walks to the gem when the door pin is pulled, and the level is won", () => {
    let facing = 0;
    const run = play(behindADoor, ["p1"], { each: (sim) => { if (sim.heroWalking) facing = sim.heroFacing; } });
    expect(run.won).toBe(true);
    expect(facing).toBe(1);
    // The pin goes at 0.8 s and takes a quarter second to clear. He sets off just after.
    expect(run.when("walk")).toBeGreaterThan(1.0);
    expect(run.when("walk")).toBeLessThan(1.3);
    expect(run.when("gem")).toBeGreaterThan(run.when("walk"));
    expect(position(run.sim.hero!).x).toBeGreaterThan(280);
    expect(run.sim.heroWalking).toBe(false);
  });

  it("covers 70 points of floor in a second", () => {
    const at: number[] = [];
    play(behindADoor, ["p1"], { each: (sim) => { if (sim.elapsed > 2 && sim.elapsed < 3.0001) at.push(position(sim.hero!).x); } });
    expect(at[at.length - 1] - at[0]).toBeGreaterThan(66);
    expect(at[at.length - 1] - at[0]).toBeLessThan(71);
  });

  it("refuses a route with lava on it, and takes it once water has cancelled the lava", () => {
    const water = cup("p1", 150, 200, 100);
    const lvl = level({
      walls: [...DIP, ...water.walls], pins: [water.pin],
      pools: [puddle("lava"), { liquid: "water", ...water.inside, count: 30 }],
      actors: { hero: { x: 70, y: DIP_TOP + 16 }, treasure: { x: 330, y: DIP_TOP + 11 } }, solution: ["p1"],
    });
    let walked = false;
    const waiting = play(lvl, [], { each: (sim) => { walked ||= sim.heroWalking; } });
    expect(walked).toBe(false);
    expect(waiting.reason).toBe("Settled short of the goal.");

    // With the water let down: on every frame he walks, there is no lava left in the dip.
    let walkedOverLava = false;
    const run = play(lvl, ["p1"], { each: (sim) => { if (sim.heroWalking && sim.particles.some((p) => p.kind === "lava")) walkedOverLava = true; } });
    expect(walkedOverLava).toBe(false);
    expect(run.when("walk")).toBeGreaterThan(run.when("steam"));
    // He wades through what is left of the water and steps up out of the dip.
    expect(run.sim.particles.some((p) => p.kind === "water")).toBe(true);
    expect(run.won).toBe(true);
  });

  it("refuses while a goblin stands on his route", () => {
    const withGoblin = (foes: { x: number; y: number }[], walls = [] as { x: number; y: number; w: number; h: number }[]) =>
      level({ walls, actors: { hero: HERO, treasure: GEM, foes } });
    // Nobody in the way: he sets off at once.
    const clear = play(withGoblin([]));
    expect(clear.when("walk")).toBeLessThan(0.2);
    expect(clear.won).toBe(true);
    // A goblin on a shelf over the far wall is not on the route. He walks under it.
    const above = play(withGoblin([{ x: 340, y: 216 }], [{ x: 300, y: 186, w: 64, h: 14 }]));
    expect(above.won).toBe(true);
    // A goblin on the floor between him and the gem: he never takes a step, and the goblin comes for him.
    let walked = false;
    const blocked = play(withGoblin([{ x: 200, y: FLOOR + 16 }]), [], { each: (sim) => { walked ||= sim.heroWalking; } });
    expect(walked).toBe(false);
    expect(blocked.reason).toBe("The goblin got the hero.");
  });

  it("does not walk off a ledge, and does walk down a slab", () => {
    const shelf = { x: 38, y: FLOOR, w: 112, h: 82 };
    const onAShelf = { hero: { x: 80, y: FLOOR + 82 + 16 }, treasure: { x: 330, y: FLOOR + 11 } };
    let walked = false;
    const ledge = play(level({ walls: [shelf], actors: onAShelf }), [], { seconds: 4, each: (sim) => { walked ||= sim.heroWalking; } });
    expect(walked).toBe(false);
    expect(position(ledge.sim.hero!).x).toBeCloseTo(80, 0);
    expect(position(ledge.sim.hero!).y).toBeGreaterThan(FLOOR + 82);

    // The same shelf with a slab from its edge to the floor, at 34 degrees.
    const slab = play(level({ walls: [shelf], slabs: [ramp(150, FLOOR + 82, 271.6, FLOOR)], actors: onAShelf }));
    expect(slab.won).toBe(true);
    expect(position(slab.sim.hero!).y).toBeLessThan(FLOOR + 20);
  });

  it("walks up a slope of 52 degrees and stops at one of 56", () => {
    const climb = (degrees: number) => {
      const run = 82 / Math.tan((degrees * Math.PI) / 180);
      return play(level({
        walls: [{ x: 38, y: FLOOR, w: 112, h: 82 }], slabs: [ramp(150, FLOOR + 82, 150 + run, FLOOR)],
        actors: { hero: { x: 330, y: FLOOR + 16 }, treasure: { x: 70, y: FLOOR + 82 + 11 } },
      }), [], { seconds: 8 });
    };
    expect(climb(34).won).toBe(true);
    expect(climb(52).won).toBe(true);
    expect(climb(56).won).toBe(false);
  });

  it("steps up eight points and not nine", () => {
    const step = (h: number) => play(level({
      walls: [{ x: 200, y: FLOOR, w: 164, h }],
      actors: { hero: HERO, treasure: { x: 330, y: FLOOR + h + 11 } },
    }), [], { seconds: 8 });
    expect(step(8).won).toBe(true);
    expect(step(9).won).toBe(false);
  });

  it("goes for the gem and then for the exit when the level asks for both", () => {
    const run = play(level({
      winWhen: "both", pins: [doorPin("p1", 140)],
      actors: { hero: HERO, treasure: { x: 200, y: FLOOR + 11 }, goal: { x: 300, y: FLOOR, w: 64, h: 50 } },
    }), ["p1"]);
    expect(run.won).toBe(true);
    expect(run.when("gem")).toBeGreaterThan(0);
    // He ends up at the exit, having pushed the gem ahead of him.
    expect(position(run.sim.hero!).x).toBeGreaterThan(260);
  });

  it("wants nothing in a level where the gem does the travelling", () => {
    let walked = false;
    play(level({ winWhen: "treasureReachesGoal", actors: { hero: HERO, treasure: GEM, goal: { x: 38, y: 300, w: 40, h: 40 } } }),
      [], { seconds: 2, each: (sim) => { walked ||= sim.heroWalking; } });
    expect(walked).toBe(false);
  });
});

describe("the hero and his friend", () => {
  it("wins by reaching the friend", () => {
    const run = play(level({ winWhen: "heroReachesFriend", pins: [doorPin("p1", 200)], actors: { hero: HERO, friend: { x: 330, y: FLOOR + 13 } } }), ["p1"]);
    expect(run.won).toBe(true);
    expect(run.sim.friendState).toBe("happy");
    expect(run.when("friend")).toBeGreaterThan(run.when("walk"));
    // The friend never walked to meet him.
    expect(position(run.sim.friend!).x).toBeGreaterThan(325);
  });

  it("loses the level when a goblin reaches the friend", () => {
    // The hero is up on a block with no way down. The goblin is let out and has only the friend to go for.
    const run = play(level({
      winWhen: "heroReachesFriend", walls: [{ x: 38, y: FLOOR, w: 60, h: 60 }], pins: [doorPin("p1", 200)],
      actors: { hero: { x: 70, y: FLOOR + 60 + 16 }, friend: { x: 330, y: FLOOR + 13 }, foes: [{ x: 140, y: FLOOR + 16 }] },
    }), ["p1"]);
    expect(run.reason).toBe("The goblin got your friend.");
    expect(run.sim.friendState).toBe("ko");
  });

  it("loses the level when lava reaches the friend", () => {
    const lava = cup("p1", 290, 200, 60);
    const run = play(level({
      winWhen: "heroReachesFriend", walls: [...lava.walls, { x: 240, y: FLOOR, w: 14, h: 60 }], pins: [lava.pin],
      pools: [{ liquid: "lava", ...lava.inside, count: 20 }],
      actors: { hero: HERO, friend: { x: 320, y: FLOOR + 13 } },
    }), ["p1"]);
    expect(run.reason).toBe("Your friend got cooked.");
  });
});

describe("goblins walk", () => {
  it("a goblin reaches the hero when nothing is in the way", () => {
    let facing = 0;
    const run = play(level({ winWhen: "heroReachesGoal", actors: { hero: { x: 330, y: FLOOR + 16 }, foes: [{ x: 70, y: FLOOR + 16 }], goal: { x: 38, y: 300, w: 40, h: 40 } } }),
      [], { each: (sim) => { if (sim.foes[0].walking) facing = sim.foes[0].facing; } });
    expect(run.reason).toBe("The goblin got the hero.");
    expect(facing).toBe(1);
    // 228 points at 55 a second is a little over four seconds, and the hero takes 1.1 s to go.
    expect(run.sim.elapsed).toBeGreaterThan(4.8);
    expect(run.sim.elapsed).toBeLessThan(5.8);
  });

  it("a goblin charges and dies in lava", () => {
    let charged = false;
    const run = play(level({
      winWhen: "heroReachesGoal", walls: DIP, pools: [puddle("lava")],
      actors: { hero: { x: 330, y: DIP_TOP + 16 }, foes: [{ x: 70, y: DIP_TOP + 16 }], goal: { x: 38, y: 300, w: 40, h: 40 } },
    }), [], { each: (sim) => { charged ||= sim.foes[0].walking; } });
    expect(charged).toBe(true);
    expect(run.sim.foes[0].state).toBe("ko");
    expect(run.when("knockout")).toBeGreaterThan(1);
    // The hero is untouched, and the lava that saved him is still there.
    expect(run.sim.heroState).toBe("idle");
    expect(run.reason).toBe("Settled short of the goal.");
  });

  it("a goblin goes for whichever of the hero and the friend is nearer", () => {
    // The hero is far to the left of him and the friend near on the right, both on his floor.
    const run = play(level({
      winWhen: "heroReachesFriend",
      actors: { hero: { x: 60, y: FLOOR + 16 }, friend: { x: 340, y: FLOOR + 13 }, foes: [{ x: 250, y: FLOOR + 16 }] },
    }));
    expect(run.reason).toBe("The goblin got your friend.");
  });
});
