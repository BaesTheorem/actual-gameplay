import { describe, expect, it } from "vitest";
import type { Cue } from "../src/sim/clock";
import { BEAT_SECONDS, TowerSim, playThrough, type Thing, type TowerLevel } from "../src/sim/tower";

const row = (rooms: Thing[][], start: number, flags: Record<number, { max?: number; locked?: boolean }> = {}, best?: number): TowerLevel => ({
  start, w: rooms.length, h: 1,
  rooms: rooms.map((things, i) => ({ things, ...flags[i] })),
  walls: [], entries: rooms.map((_, i) => i),
  ...(best === undefined ? {} : { best }),
});

const settle = (sim: TowerSim, limit = 60) => {
  for (let t = 0; t < limit && (sim.busy || (!sim.outcome && sim.options().length === 0)); t += 1 / 60) sim.frame(1 / 60);
};

const sounds = (cues: Cue[]) => cues.filter((c) => c.type === "sound").map((c) => (c as { name: string }).name);
const haptics = (cues: Cue[]) => cues.filter((c) => c.type === "haptic").map((c) => (c as { name: string }).name);

describe("TowerSim", () => {
  it("resolves the rules at once and queues beats", () => {
    const sim = new TowerSim(row([[{ kind: "plus", n: 3 }], [{ kind: "boss", n: 5 }]], 4));
    expect(sim.busy).toBe(false);
    expect(sim.options()).toEqual([0, 1]);
    expect(sim.enter(0)).toBe(true);
    // The rules are settled, the drawing is not.
    expect(sim.power).toBe(7);
    expect(sim.turn).toBe(1);
    expect(sim.cleared.has(0)).toBe(true);
    expect(sim.shownPower).toBe(4);
    expect(sim.busy).toBe(true);
    expect(sim.at).toBeNull();
    expect(sim.timeline.map((b) => b.kind)).toEqual(["walk", "gain"]);
  });

  it("refuses a move while one is playing, and a room that is not an option", () => {
    const sim = new TowerSim(row([[{ kind: "plus", n: 3 }], [{ kind: "boss", n: 5 }]], 4));
    sim.enter(0);
    expect(sim.enter(1)).toBe(false);
    settle(sim);
    expect(sim.enter(0)).toBe(false);
    expect(sim.enter(9)).toBe(false);
    expect(sim.enter(1)).toBe(true);
  });

  it("plays beats in time and counts the number up", () => {
    const sim = new TowerSim(row([[{ kind: "plus", n: 4 }], [{ kind: "boss", n: 5 }]], 4));
    sim.enter(0);
    sim.frame(BEAT_SECONDS.walk);
    expect(sim.at).toBe(0);
    expect(sim.shownPower).toBe(4);
    sim.frame(BEAT_SECONDS.gain / 2);
    expect(sim.shownPower).toBe(6);
    expect(sim.busy).toBe(true);
    sim.frame(BEAT_SECONDS.gain / 2 + 0.001);
    expect(sim.shownPower).toBe(8);
    expect(sim.busy).toBe(false);
  });

  it("wins when the last beat ends, with stars from the best number", () => {
    const level = row([[{ kind: "plus", n: 3 }], [{ kind: "boss", n: 5 }]], 4, {}, 12);
    const sim = new TowerSim(level);
    sim.enter(0);
    settle(sim);
    sim.enter(1);
    expect(sim.outcome).toBeNull();
    const total = BEAT_SECONDS.walk + BEAT_SECONDS.fight + BEAT_SECONDS.win;
    sim.frame(total - 0.05);
    expect(sim.outcome).toBeNull();
    sim.frame(0.1);
    expect(sim.outcome).toEqual({ won: true, stars: 3, coins: 0, score: 12 });
    expect(sim.options()).toEqual([]);
  });

  it("gives fewer stars for a lower final number", () => {
    const make = (best: number) => row([[{ kind: "plus", n: 3 }], [{ kind: "boss", n: 3 }]], 4, {}, best);
    expect(playThrough(make(20), [1]).sim.outcome).toMatchObject({ won: true, stars: 1, score: 7 });
    expect(playThrough(make(11), [1]).sim.outcome).toMatchObject({ stars: 2 });
    expect(playThrough(make(7), [1]).sim.outcome).toMatchObject({ stars: 3 });
  });

  it("loses with a full sentence that names the numbers", () => {
    const { sim } = playThrough(row([[{ kind: "enemy", n: 14 }], [{ kind: "boss", n: 5 }]], 12), [0]);
    expect(sim.outcome).toEqual({ won: false, reason: "A 14 beats your 12." });
    const floor = playThrough(row([[{ kind: "plus", n: 1 }], [{ kind: "boss", n: 50 }]], 21, { 0: { max: 13 } }), [0]).sim;
    expect(floor.outcome).toEqual({ won: false, reason: "That floor holds 13. You are 21." });
    const halve = playThrough(row([[{ kind: "halve", k: 2 }], [{ kind: "boss", n: 50 }]], 1), [0]).sim;
    expect(halve.outcome).toEqual({ won: false, reason: "Halved to nothing." });
    const stuck = new TowerSim({ ...row([[{ kind: "plus", n: 1 }], [{ kind: "boss", n: 50 }]], 4), entries: [0], walls: [[0, 1]] });
    stuck.enter(0);
    settle(stuck);
    expect(stuck.outcome).toEqual({ won: false, reason: "No room left to enter." });
  });

  it("sets the outcome only after the losing beats have played", () => {
    const sim = new TowerSim(row([[{ kind: "enemy", n: 14 }], [{ kind: "boss", n: 5 }]], 12));
    sim.enter(0);
    expect(sim.timeline.map((b) => b.kind)).toEqual(["walk", "fight", "lose"]);
    sim.frame(0.1);
    expect(sim.outcome).toBeNull();
    settle(sim);
    expect(sim.outcome).not.toBeNull();
  });

  it("emits sound and haptic cues by name", () => {
    const cues: Cue[] = [];
    const level = row(
      [[{ kind: "key" }], [{ kind: "plus", n: 2 }], [{ kind: "enemy", n: 3 }], [{ kind: "boss", n: 5 }]], 8,
      { 1: { locked: true } },
    );
    playThrough(level, [0, 1, 2, 3], (c) => cues.push(c));
    expect(new Set(sounds(cues))).toEqual(new Set(["step", "key", "unlock", "gain", "hit", "win"]));
    expect(new Set(haptics(cues))).toEqual(new Set(["tap", "thud", "success"]));

    const lost: Cue[] = [];
    playThrough(row([[{ kind: "plus", n: 1 }], [{ kind: "boss", n: 50 }]], 21, { 0: { max: 13 } }), [0], (c) => lost.push(c));
    expect(sounds(lost)).toEqual(["step", "crack", "lose"]);
    expect(haptics(lost)).toEqual(["tap", "thud", "failure"]);
  });

  it("tracks keys and shows them in the readout", () => {
    const level = row([[{ kind: "key" }], [{ kind: "plus", n: 2 }], [{ kind: "boss", n: 99 }]], 12, { 1: { locked: true } }, 49);
    const sim = new TowerSim(level);
    expect(sim.readout).toBe("power 12   keys 0   best 49");
    sim.enter(0);
    settle(sim);
    expect(sim.readout).toBe("power 12   keys 1   best 49");
    expect(sim.keys).toBe(1);
    sim.enter(1);
    settle(sim);
    expect(sim.readout).toBe("power 14   keys 0   best 49");
  });

  it("finds best from the solver when the level has none", () => {
    const sim = new TowerSim(row([[{ kind: "plus", n: 3 }], [{ kind: "boss", n: 5 }]], 4));
    expect(sim.readout).toBe("power 4   keys 0   best 12");
  });

  it("gives a grower's number for the turn it is", () => {
    const sim = new TowerSim(row([[{ kind: "plus", n: 1 }], [{ kind: "grower", n: 3, grow: 2 }], [{ kind: "boss", n: 99 }]], 10));
    expect(sim.growerValue(1)).toBe(3);
    sim.enter(0);
    expect(sim.growerValue(1)).toBe(5);
    expect(sim.growerValue(0)).toBe(0);
  });

  it("replays an order, entering each room when the last move has finished", () => {
    const level = row([[{ kind: "plus", n: 3 }], [{ kind: "enemy", n: 2 }], [{ kind: "boss", n: 5 }]], 4, {}, 14);
    const sim = new TowerSim(level);
    sim.replay([0, 1, 2]);
    let t = 0;
    while (!sim.outcome && t < 30) { sim.frame(1 / 60); t += 1 / 60; }
    expect(sim.outcome).toMatchObject({ won: true, score: 14 });
    expect(sim.cleared.size).toBe(3);
  });

  it("sets the number being shown at a loss and at a break", () => {
    const sim = new TowerSim(row([[{ kind: "enemy", n: 14 }], [{ kind: "boss", n: 5 }]], 12));
    sim.enter(0);
    sim.frame(BEAT_SECONDS.walk + BEAT_SECONDS.fight / 2);
    expect(sim.shownPower).toBe(12);
  });
});
