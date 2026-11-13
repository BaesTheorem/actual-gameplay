import { describe, expect, it } from "vitest";
import { LIQUID_RADIUS, PinSim, type PinLevel } from "../src/sim/pinpull";
import { position } from "../src/sim/sk";
import { FLOOR, level, play } from "./pin-v2-kit";

// A shaft with gas trapped in it under a pin. Whoever stands on the pin is over the gas.
const SHAFT = [{ x: 86, y: FLOOR, w: 14, h: 200 }, { x: 200, y: FLOOR, w: 14, h: 200 }];
const LID = { id: "p1", x: 100, y: 150, w: 100, side: "right" };
const GAS = { liquid: "gas", x: 100, y: 110, w: 100, h: 40, count: 45 };
const ON_LID = { x: 150, y: 150 + 14 + 16 };
const FAR_EXIT = { x: 38, y: 300, w: 40, h: 40 };

const heights = (sim: PinSim, kind: string) => sim.particles.filter((p) => p.kind === kind).map((p) => position(p.body).y);
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

describe("gas", () => {
  const trapped: PinLevel = level({ walls: SHAFT, pins: [LID], pools: [GAS] });

  it("hangs under what is over it, filled from the top of its pool down", () => {
    const sim = new PinSim(trapped);
    // The top row of the pool touches the top of its rectangle, which is the underside of the pin.
    expect(Math.max(...heights(sim, "gas"))).toBeCloseTo(150 - LIQUID_RADIUS, 6);
    for (let i = 0; i < 90; i++) sim.frame();
    expect(heights(sim, "gas").length).toBe(45);
    expect(Math.max(...heights(sim, "gas"))).toBeLessThan(150);
    expect(Math.min(...heights(sim, "gas"))).toBeGreaterThan(110);
  });

  it("rises when the pin goes, and is gone once it reaches the top of the playfield", () => {
    let highest = 0;
    const run = play(trapped, ["p1"], { seconds: 6, each: (sim) => { highest = Math.max(highest, ...heights(sim, "gas")); } });
    expect(highest).toBeGreaterThan(700);
    expect(heights(run.sim, "gas").length).toBe(0);
  });

  it("kills the hero", () => {
    const run = play(level({ ...trapped, winWhen: "heroReachesGoal", actors: { hero: ON_LID, goal: FAR_EXIT } }), ["p1"]);
    expect(run.reason).toBe("He breathed the gas.");
    expect(run.when("gassed")).toBeGreaterThan(0.8);
  });

  it("kills the friend", () => {
    const run = play(level({ ...trapped, winWhen: "heroReachesFriend", actors: { hero: { x: 300, y: FLOOR + 16 }, friend: { x: 150, y: 150 + 14 + 13 } } }), ["p1"]);
    expect(run.reason).toBe("Your friend breathed the gas.");
  });

  it("knocks out a goblin", () => {
    const run = play(level({ ...trapped, winWhen: "heroReachesGoal", actors: { hero: { x: 300, y: FLOOR + 16 }, foes: [ON_LID], goal: FAR_EXIT } }), ["p1"], { seconds: 5 });
    expect(run.sim.foes[0].state).toBe("ko");
    expect(run.when("gassed")).toBeGreaterThan(0.8);
    expect(run.sim.heroState).toBe("idle");
  });

  it("passes through water, and a vent swallows it", () => {
    // Water lies on the pin over the gas, and there is a vent up the shaft.
    const run = play(level({
      ...trapped, pools: [GAS, { liquid: "water", x: 102, y: 164, w: 96, h: 30, count: 40 }], vents: [{ x: 100, y: 400, w: 100, h: 16 }],
    }), ["p1"], { seconds: 5, each: (sim) => { for (const y of heights(sim, "gas")) expect(y).toBeLessThan(420); } });
    // They began with the water on top. The water is now at the bottom and all of it is there.
    expect(heights(run.sim, "water").length).toBe(40);
    expect(mean(heights(run.sim, "water"))).toBeLessThan(FLOOR + 30);
    // Every bit of gas went up through it and into the vent. None got past.
    expect(heights(run.sim, "gas").length).toBe(0);
  });

  it("is left alone by a grate and by a drain, which still takes the water", () => {
    // The shaft is carried up to a roof here, so the gas has nowhere to go but through the grate.
    const tall = SHAFT.map((wall) => ({ ...wall, h: 446 }));
    const run = play(level({
      ...trapped, walls: [...tall, { x: 86, y: 500, w: 128, h: 14 }],
      pools: [GAS, { liquid: "water", x: 102, y: 164, w: 96, h: 30, count: 40 }],
      grates: [{ x: 100, y: 300, w: 100, h: 12 }], drains: [{ x: 100, y: FLOOR, w: 100, h: 12 }],
    }), ["p1"], { seconds: 6 });
    // The gas went up through the grate and is held under the roof over the shaft. The water went down the drain.
    expect(heights(run.sim, "gas").length).toBe(45);
    expect(Math.min(...heights(run.sim, "gas"))).toBeGreaterThan(440);
    expect(heights(run.sim, "water").length).toBe(0);
  });

  it("is stopped by a boulder and goes through the gem", () => {
    // Two ledges leave a gap 20 points wide in the shaft, over the gas. What rests across the gap plugs it, or does not.
    const plugged = (parts: Partial<PinLevel>) => play(level({
      ...trapped, walls: [...SHAFT, { x: 100, y: 250, w: 40, h: 14 }, { x: 160, y: 250, w: 40, h: 14 }], ...parts,
    }), ["p1"], { seconds: 6 }).sim;
    const underBoulder = plugged({ boulders: [{ x: 150, y: 250 + 14 + 15 }] });
    expect(heights(underBoulder, "gas").length).toBe(45);
    expect(Math.max(...heights(underBoulder, "gas"))).toBeLessThan(position(underBoulder.boulders[0].body).y);
    // The gem lies across the same gap and stops nothing. Most of the gas goes up through it and
    // away, and what is left is caught under the two ledges.
    const underGem = plugged({ actors: { treasure: { x: 150, y: 250 + 14 + 11 } } });
    expect(position(underGem.treasure!).y).toBeGreaterThan(250 + 14);
    expect(heights(underGem, "gas").length).toBeLessThan(25);
    for (const p of underGem.particles) expect(Math.abs(position(p.body).x - 150)).toBeGreaterThan(10);
  });
});

describe("gas in a level that does not ask for the walking rules", () => {
  it("is water, as any liquid the first rules did not know was", () => {
    const sim = new PinSim({ ...level({ walls: SHAFT, pins: [LID], pools: [GAS] }), rules: undefined });
    expect(sim.particles.every((p) => p.kind === "water")).toBe(true);
  });
});
