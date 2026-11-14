import { describe, expect, it } from "vitest";
import { NOISE, NOISE_SEEDS, noise, nudge, playNoisy, soak } from "../scripts/pin-suite";
import { PinSim, playOut, type PinLevel } from "../src/sim/pinpull";
import { position } from "../src/sim/sk";
import { FLOOR, cup, doorPin, level } from "./pin-v2-kit";

// A level with one of everything that can move: water over a goblin behind a door, a boulder and
// a crate out of the way, the hero and the gem. Its stored solution floods the goblin and opens the door.
const water = cup("p1", 200, 220, 60);
const lvl: PinLevel = level({
  parPins: 2, walls: water.walls, pins: [water.pin, doorPin("p2", 150)],
  pools: [{ liquid: "water", ...water.inside, count: 24 }],
  boulders: [{ x: 60, y: FLOOR + 18 }], bombs: [{ x: 346, y: FLOOR + 12 }],
  actors: { hero: { x: 100, y: FLOOR + 16 }, treasure: { x: 300, y: FLOOR + 11 }, foes: [{ x: 230, y: FLOOR + 16 }] },
  solution: ["p1", "p2"],
});

/// Where every body that can move is, in the order the helper visits them.
const places = (sim: PinSim) => [
  ...sim.particles.map((p) => p.body), sim.hero!, sim.treasure!, ...sim.foes.map((foe) => foe.body),
  ...sim.boulders.map((b) => b.body), ...sim.bombs.map((b) => b.body),
].map(position);

describe("the noise replay", () => {
  it("moves every body that can move, and none of them farther than the amount", () => {
    const plain = places(new PinSim(lvl)), shaken = new PinSim(lvl);
    nudge(shaken, 3);
    const moved = places(shaken);
    expect(moved.length).toBe(24 + 5);
    moved.forEach((at, i) => {
      expect(Math.abs(at.x - plain[i].x)).toBeLessThanOrEqual(NOISE + 1e-9);
      expect(Math.abs(at.y - plain[i].y)).toBeLessThanOrEqual(NOISE + 1e-9);
      expect(at.x !== plain[i].x || at.y !== plain[i].y).toBe(true);
    });
  });

  it("is the same every time for one seed, and not the same start for another", () => {
    const a = new PinSim(lvl), b = new PinSim(lvl), c = new PinSim(lvl);
    nudge(a, 5);
    nudge(b, 5);
    nudge(c, 6);
    expect(places(a)).toEqual(places(b));
    expect(places(a)).not.toEqual(places(c));
    expect(playNoisy(lvl, lvl.solution!, 5)).toEqual(playNoisy(lvl, lvl.solution!, 5));
  });

  it("with no noise is the plain replay", () => {
    expect(playNoisy(lvl, lvl.solution!, 1, 0)).toEqual(playOut(lvl, lvl.solution!));
    expect(playNoisy(lvl, ["p2"], 1, 0)).toEqual(playOut(lvl, ["p2"]));
  });

  it("counts the wins over its eight seeds", () => {
    expect(NOISE_SEEDS).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(noise(lvl)).toEqual({ wins: 8, lost: [] });
    // The door alone lets the goblin through, from every start.
    const doomed = noise({ ...lvl, solution: ["p2"] });
    expect(doomed.wins).toBe(0);
    expect(doomed.lost.map((l) => l.how)).toEqual(Array(8).fill("The goblin got the hero."));
  });

  it("has a wider sweep that names every wait and every seed that lost", () => {
    expect(soak(lvl, [0, 0.5, 2], 12)).toEqual({ holds: [], seeds: [] });
    // Pulled the other way round, the goblin is let out dry at every wait and from every start.
    expect(soak({ ...lvl, solution: ["p2", "p1"] }, [0, 2], 3)).toEqual({ holds: [0, 2], seeds: [1, 2, 3] });
    // A wait is between pulls, so a solution of one pull has none to try.
    expect(soak({ ...lvl, solution: ["p2"] }, [0, 2], 2)).toEqual({ holds: [], seeds: [1, 2] });
  });
});
