import { describe, expect, it } from "vitest";
import { auditLevel, odds, type End, type Play } from "../scripts/pin-suite";
import { PinSim, moveOf, moves, type PinLevel } from "../src/sim/pinpull";
import { FLOOR, doorPin, level, play } from "./pin-v2-kit";

// Two doors between the hero and the gem, linked as group "a", and a third pin that holds lava over the gem.
const lavaCup = [{ x: 286, y: 200, w: 14, h: 50 }, { x: 350, y: 200, w: 14, h: 50 }];
const linked: PinLevel = level({
  walls: lavaCup,
  pins: [doorPin("p1", 150, "a"), doorPin("p2", 230, "a"), { id: "p3", x: 300, y: 200, w: 50, side: "right" }],
  pools: [{ liquid: "lava", x: 302, y: 214, w: 46, h: 30, count: 14 }],
  actors: { hero: { x: 80, y: FLOOR + 16 }, treasure: { x: 325, y: FLOOR + 11 } },
  solution: ["p2"],
});

describe("linked pins", () => {
  it("are pulled together by a tap on any one of them, at the same instant", () => {
    const sim = new PinSim(linked);
    expect(sim.remaining).toBe(2);
    expect(sim.pull("p2")).toBe(true);
    expect(sim.pins.map((pin) => pin.pulled)).toEqual([true, true, false]);
    expect(sim.pulled).toEqual(["p2"]);
    expect(sim.remaining).toBe(1);
    // The other pin of the group has gone already: a tap on it is not a second pull.
    expect(sim.pull("p1")).toBe(false);
    expect(sim.pulled.length).toBe(1);
    for (let i = 0; i < 20; i++) sim.frame();
    expect(sim.pins[0].gone).toBe(true);
    expect(sim.pins[1].gone).toBe(true);
    expect(sim.pins[2].gone).toBe(false);
  });

  it("count as one pull for the stars", () => {
    const run = play(linked, ["p1"]);
    expect(run.won).toBe(true);
    expect(run.sim.outcome).toMatchObject({ stars: 3, score: 1 });
  });

  it("report a burst at every knob of the group", () => {
    const bursts: number[] = [];
    const sim = new PinSim(linked, (cue) => { if (cue.type === "fx" && cue.name === "pin") bursts.push(cue.x); });
    sim.pull("p1");
    expect(bursts).toEqual([sim.pins[0].knob.x, sim.pins[1].knob.x]);
  });

  it("are one move, named by the first pin of the group", () => {
    expect(moves(linked)).toEqual(["p1", "p3"]);
    expect(moveOf(linked, "p2")).toBe("p1");
    expect(moveOf(linked, "p3")).toBe("p3");
  });

  it("are ignored in a level that does not ask for the walking rules", () => {
    const sim = new PinSim({ ...linked, rules: undefined });
    sim.pull("p2");
    expect(sim.pins.map((pin) => pin.pulled)).toEqual([false, true, false]);
    expect(sim.remaining).toBe(2);
  });
});

describe("the audit and the odds on a level with a group", () => {
  /// How each pull order ends is read from a table, and every order asked for is kept.
  const table = (ends: Record<string, End>): { play: Play; asked: string[] } => {
    const asked: string[] = [];
    return { asked, play: async (_level, pins) => { asked.push(pins.join("+")); return ends[pins.join("+")] ?? "lost"; } };
  };

  it("the audit tries a group once, and knows a solution that names its second pin", async () => {
    const { play: byTable, asked } = table({ p1: "won", p3: "lost" });
    const verdict = await auditLevel(linked, byTable);
    expect(asked).toEqual(["p1", "p3"]);
    expect(verdict.line).toMatch(/par 1\s+2 sequences\s+UNIQUE$/);
    expect(verdict.flagged).toBe(false);
  });

  it("the odds give a group the chance of one move", async () => {
    // Two moves. The group wins at once. The third pin settles, and then the group wins.
    const { play: byTable, asked } = table({ p1: "won", p3: "open", "p3+p1": "won" });
    const found = await odds(linked, byTable);
    expect([...asked].sort()).toEqual(["p1", "p3", "p3+p1"]);
    expect(found.randomWin).toBeCloseTo(1, 12);
    expect(found.detail).toBe("2 of 3 pull orders win");
  });

  it("both play the real level the same way", async () => {
    // The doors win it. The lava pin melts the gem, whenever it is pulled.
    const verdict = await auditLevel(linked);
    expect(verdict.line).toMatch(/2 sequences\s+UNIQUE$/);
    const found = await odds(linked);
    expect(found.exact).toBe(true);
    expect(found.randomWin).toBeCloseTo(0.5, 12);
    expect(found.sample).toBe(2);
  });
});
