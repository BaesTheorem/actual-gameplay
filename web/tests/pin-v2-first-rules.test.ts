import { describe, expect, it } from "vitest";
import { load } from "../scripts/levels";
import { FOLDER } from "../scripts/pin-suite";
import { PinSim, playOut, type PinLevel } from "../src/sim/pinpull";
import { STEP, position } from "../src/sim/sk";
import { FLOOR, level } from "./pin-v2-kit";

// The twelve levels that shipped before the walking rules, and how each one's stored solution
// played then: its stars, its pulls, and its length in frames of game time. Then the same for
// the solution pulled backwards, which loses every level but the first. A level that does not
// ask for the walking rules has to play exactly as it did, so every number here is pinned.
const SHIPPED: [id: string, stars: number, pulls: number, frames: number, backwards: string, backwardsFrames: number][] = [
  ["two-ways-down", 3, 1, 240, "won", 240],
  ["wash-him-out", 3, 2, 436, "The goblin got the hero.", 158],
  ["clear-the-landing", 3, 2, 206, "The hero got cooked.", 171],
  ["the-slide", 3, 2, 394, "The hero got cooked.", 181],
  ["down-the-chute", 3, 2, 358, "The hero got cooked.", 147],
  ["mind-the-hole", 3, 2, 288, "The hero got cooked.", 209],
  ["down-the-well", 3, 2, 233, "The goblin got the hero.", 158],
  ["the-side-door", 3, 3, 449, "The hero got cooked.", 174],
  ["two-taps", 3, 2, 451, "The hero got cooked.", 179],
  ["gem-in-the-flood", 3, 2, 430, "The goblin got the hero.", 151],
  ["ride-the-pin", 3, 3, 492, "Settled short of the goal.", 485],
  ["the-whole-tower", 3, 3, 546, "The goblin got the hero.", 151],
];

const frames = (seconds: number) => Math.round(seconds / STEP);

describe("the levels that shipped before the walking rules", () => {
  const levels = load<PinLevel>(FOLDER);
  const shipped = levels.filter((lvl) => SHIPPED.some(([id]) => id === lvl.id));

  it("are all still here, and none of them asks for the walking rules", () => {
    expect(shipped.map((lvl) => lvl.id)).toEqual(SHIPPED.map(([id]) => id));
    for (const lvl of shipped) expect(lvl.rules, lvl.id).toBeUndefined();
  });

  for (const [id, stars, pulls, length, backwards, backwardsLength] of SHIPPED) {
    it(`${id} plays out as it did`, () => {
      const lvl = shipped.find((l) => l.id === id)!;
      const run = playOut(lvl, lvl.solution ?? []);
      expect(run.outcome).toEqual({ won: true, stars, coins: 0, score: pulls });
      expect(run.pulled).toBe(pulls);
      expect(frames(run.seconds)).toBe(length);

      const back = playOut(lvl, [...(lvl.solution ?? [])].reverse());
      expect(back.outcome?.won ? "won" : back.outcome?.reason).toBe(backwards);
      expect(frames(back.seconds)).toBe(backwardsLength);
    });
  }
});

describe("a level that does not ask for the walking rules", () => {
  // Everything the walking rules added, in a level without the flag.
  const everything: PinLevel = {
    ...level({
      pins: [{ id: "p1", x: 100, y: 300, w: 60, side: "left", group: "a" }, { id: "p2", x: 200, y: 300, w: 60, side: "right", group: "a" }],
      cracked: [{ x: 250, y: FLOOR, w: 14, h: 40 }], boulders: [{ x: 300, y: 200 }], bombs: [{ x: 330, y: 120 }],
      plates: [{ id: "a", x: 40, y: FLOOR, w: 30, opens: ["d"] }], doors: [{ id: "d", x: 200, y: FLOOR, w: 14, h: 40, slide: "up" }],
      vents: [{ x: 40, y: 500, w: 40, h: 12 }],
      actors: { hero: { x: 80, y: FLOOR + 16 }, treasure: { x: 160, y: FLOOR + 11 }, friend: { x: 340, y: FLOOR + 13 } },
    }),
    rules: undefined,
  };

  it("has none of the newer pieces, and its pins are not linked", () => {
    const sim = new PinSim(everything);
    expect(sim.boulders.length + sim.bombs.length + sim.cracked.length + sim.plates.length + sim.doors.length).toBe(0);
    expect(sim.friend).toBeNull();
    expect(sim.level.vents).toBeUndefined();
    expect(sim.pins.map((pin) => pin.group)).toEqual([undefined, undefined]);
    // The file itself is not touched.
    expect(everything.boulders?.length).toBe(1);
  });

  it("has a hero who stands where he is put, with the gem in plain sight", () => {
    const sim = new PinSim(everything);
    for (let i = 0; i < 120; i++) sim.frame();
    expect(sim.heroWalking).toBe(false);
    expect(position(sim.hero!).x).toBeCloseTo(80, 6);
    // The same level with the flag: he goes and gets it.
    const walking = new PinSim({ ...everything, rules: 2 });
    for (let i = 0; i < 120; i++) walking.frame();
    expect(position(walking.hero!).x).toBeGreaterThan(100);
  });
});
