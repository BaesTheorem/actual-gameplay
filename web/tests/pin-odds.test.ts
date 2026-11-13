import { describe, expect, it } from "vitest";
import { PLAYOUTS, auditLevel, odds, type End, type Play } from "../scripts/pin-suite";
import type { PinLevel } from "../src/sim/pinpull";

/// A level that is only its pins, and a stand-in for the simulation: how each pull order ends is
/// read from a table, and an order the table does not list ends in a loss.
const level = (pins: string[], parPins: number, solution: string[]): PinLevel =>
  ({ id: "a-level", name: "A level", parPins, winWhen: "heroReachesGoal", pins: pins.map((id) => ({ id, x: 0, y: 0, w: 10, side: "left" })), actors: {}, solution });
const table = (ends: Record<string, End>): { play: Play; asked: string[] } => {
  const asked: string[] = [];
  return { asked, play: async (_level, pins) => { asked.push(pins.join("+")); return ends[pins.join("+")] ?? "lost"; } };
};

describe("the share of random pull orders that win", () => {
  it("adds up the chance of every winning order", async () => {
    // a wins at once: 1/3. b settles, and then a wins: 1/3 of 1/2. b then c settles, and a is too late.
    const { play, asked } = table({ a: "won", b: "open", "b+a": "won", "b+c": "open" });
    const found = await odds(level(["a", "b", "c"], 1, ["a"]), play);
    expect(found.exact).toBe(true);
    expect(found.randomWin).toBeCloseTo(1 / 3 + 1 / 6, 12);
    // Six orders were played: a, b, c, then b+a and b+c, then b+c+a. Nothing follows a win or a loss.
    expect(found.sample).toBe(6);
    expect([...asked].sort()).toEqual(["a", "b", "b+a", "b+c", "b+c+a", "c"]);
    expect(found.detail).toBe("2 of 6 pull orders win");
  });

  it("goes on past par", async () => {
    const { play } = table({ a: "open", b: "open", "a+b": "won", "b+a": "lost" });
    const found = await odds(level(["a", "b"], 1, ["a"]), play);
    expect(found.randomWin).toBeCloseTo(0.5, 12);
    expect(found.exact).toBe(true);
  });

  it("samples a tree that is too big to count, the same way every time", async () => {
    const ends: Record<string, End> = { a: "won", b: "open", "b+a": "won", "b+c": "open" };
    const first = await odds(level(["a", "b", "c"], 1, ["a"]), table(ends).play, 4);
    const second = await odds(level(["a", "b", "c"], 1, ["a"]), table(ends).play, 4);
    expect(first.exact).toBe(false);
    expect(first.sample).toBe(PLAYOUTS);
    expect(first).toEqual(second);
    // The true share is a half; 300 random orders land near it.
    expect(first.randomWin).toBeGreaterThan(0.4);
    expect(first.randomWin).toBeLessThan(0.6);
  });

  it("plays each order once however many random orders pass through it", async () => {
    const { play, asked } = table({ a: "open", b: "open", c: "open", "a+b": "open", "a+c": "open", "b+a": "open", "b+c": "open", "c+a": "open", "c+b": "open" });
    await odds(level(["a", "b", "c"], 1, ["a"]), play, 2);
    expect(new Set(asked).size).toBe(asked.length);
    expect(asked.length).toBeLessThanOrEqual(3 + 6 + 6);
  });
});

describe("the pin audit", () => {
  it("calls a level unique when only the stored order wins within par", async () => {
    const { play, asked } = table({ a: "open", b: "open", "a+b": "won" });
    const verdict = await auditLevel(level(["a", "b"], 2, ["a", "b"]), play);
    expect(verdict.flagged).toBe(false);
    expect(verdict.line).toMatch(/par 2\s+4 sequences\s+UNIQUE$/);
    expect(asked.length).toBe(4);
  });

  it("lists another order that wins", async () => {
    const { play } = table({ a: "open", b: "won", "a+b": "won" });
    const verdict = await auditLevel(level(["a", "b"], 2, ["a", "b"]), play);
    expect(verdict.flagged).toBe(true);
    expect(verdict.line).toMatch(/NOT UNIQUE: also b$/);
  });
});
