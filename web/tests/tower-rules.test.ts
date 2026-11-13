import { describe, expect, it } from "vitest";
import {
  enter, mirrorOf, options, playOrder, startState, starsFor, validateLevel,
  type EnterResult, type Room, type Thing, type TowerLevel, type TowerState,
} from "../src/sim/tower";

/// A row of rooms, one floor high, every room an entry unless told otherwise.
const row = (rooms: (Thing[] | null)[], start: number, extra: Partial<TowerLevel> = {}, flags: Record<number, Partial<Room>> = {}): TowerLevel => ({
  start, w: rooms.length, h: 1,
  rooms: rooms.map((things, i) => (things ? { things, ...flags[i] } : null)),
  walls: [], entries: rooms.flatMap((r, i) => (r ? [i] : [])),
  ...extra,
});

const first = (level: TowerLevel, room: number): EnterResult => enter(level, startState(level), room);
const power = (r: EnterResult): number => {
  if (r.result === "loss") throw new Error(`lost: ${r.reason}`);
  return r.state.power;
};
const BOSS: Thing = { kind: "boss", n: 1000 };

describe("things", () => {
  it("an enemy adds its number when the hero is bigger", () => {
    expect(power(first(row([[{ kind: "enemy", n: 5 }], [BOSS]], 6), 0))).toBe(11);
  });

  it("an enemy beats a smaller hero and a tie is a loss", () => {
    const lose = first(row([[{ kind: "enemy", n: 14 }], [BOSS]], 12), 0);
    expect(lose).toMatchObject({ result: "loss", cause: "fight", reason: "A 14 beats your 12." });
    const tie = first(row([[{ kind: "enemy", n: 12 }], [BOSS]], 12), 0);
    expect(tie).toMatchObject({ result: "loss", cause: "fight" });
    expect((tie as { reason: string }).reason).toContain("tie");
  });

  it("beating the boss wins at once and adds its number", () => {
    const r = first(row([[{ kind: "boss", n: 5 }]], 6), 0);
    expect(r).toMatchObject({ result: "win", final: 11 });
    const lost = first(row([[{ kind: "boss", n: 9 }]], 6), 0);
    expect(lost).toMatchObject({ result: "loss", cause: "fight", reason: "The 9 boss beats your 6." });
  });

  it("a grower is n plus grow times the rooms already entered", () => {
    const level = row([[{ kind: "plus", n: 1 }], [{ kind: "plus", n: 1 }], [{ kind: "grower", n: 3, grow: 2 }], [BOSS]], 8);
    let state = startState(level);
    state = (enter(level, state, 0) as { state: TowerState }).state;
    state = (enter(level, state, 1) as { state: TowerState }).state;
    expect(state.turn).toBe(2);
    // 3 + 2 * 2 = 7, and the hero is 10.
    expect(power(enter(level, state, 2))).toBe(17);
    const small = row([[{ kind: "plus", n: 1 }], [{ kind: "plus", n: 1 }], [{ kind: "grower", n: 3, grow: 2 }], [BOSS]], 5);
    let s2 = startState(small);
    s2 = (enter(small, s2, 0) as { state: TowerState }).state;
    s2 = (enter(small, s2, 1) as { state: TowerState }).state;
    // The hero is 7 and the grower is 7: a tie is a loss.
    expect(enter(small, s2, 2)).toMatchObject({ result: "loss", cause: "fight" });
  });

  it("a grower uses the turn before its own entry is counted", () => {
    const level = row([[{ kind: "grower", n: 3, grow: 2 }], [BOSS]], 4);
    expect(power(first(level, 0))).toBe(7);
  });

  it("plus, times, minus and halve change the number", () => {
    expect(power(first(row([[{ kind: "plus", n: 4 }], [BOSS]], 3), 0))).toBe(7);
    expect(power(first(row([[{ kind: "times", k: 3 }], [BOSS]], 4), 0))).toBe(12);
    expect(power(first(row([[{ kind: "minus", n: 3 }], [BOSS]], 4), 0))).toBe(1);
    expect(power(first(row([[{ kind: "halve", k: 2 }], [BOSS]], 7), 0))).toBe(3);
  });

  it("minus that reaches zero or below is a loss", () => {
    expect(first(row([[{ kind: "minus", n: 5 }], [BOSS]], 5), 0)).toMatchObject({ result: "loss", cause: "drain" });
    expect(first(row([[{ kind: "minus", n: 9 }], [BOSS]], 5), 0)).toMatchObject({ result: "loss", cause: "drain" });
  });

  it("halve rounds down and a halve to nothing is a loss", () => {
    expect(first(row([[{ kind: "halve", k: 3 }], [BOSS]], 1), 0)).toMatchObject({ result: "loss", cause: "halve", reason: "Halved to nothing." });
    expect(first(row([[{ kind: "halve", k: 2 }], [BOSS]], 1), 0)).toMatchObject({ result: "loss", reason: "Halved to nothing." });
    expect(power(first(row([[{ kind: "halve", k: 2 }], [BOSS]], 3), 0))).toBe(1);
  });

  it("a mirror reverses the digits", () => {
    expect(mirrorOf(12)).toBe(21);
    expect(mirrorOf(20)).toBe(2);
    expect(mirrorOf(100)).toBe(1);
    expect(mirrorOf(7)).toBe(7);
    for (const [from, to] of [[12, 21], [20, 2], [100, 1]] as const) {
      expect(power(first(row([[{ kind: "mirror" }], [BOSS]], from), 0))).toBe(to);
    }
  });

  it("a key adds a key", () => {
    const level = row([[{ kind: "key" }], [BOSS]], 3);
    const r = first(level, 0);
    expect(r.result === "move" && r.state.keys).toBe(1);
  });
});

describe("rooms", () => {
  it("the things in a room resolve left to right", () => {
    const plusFirst = row([[{ kind: "plus", n: 5 }, { kind: "enemy", n: 10 }], [BOSS]], 6);
    expect(power(first(plusFirst, 0))).toBe(21);
    const enemyFirst = row([[{ kind: "enemy", n: 10 }, { kind: "plus", n: 5 }], [BOSS]], 6);
    expect(first(enemyFirst, 0)).toMatchObject({ result: "loss", cause: "fight" });
  });

  it("a halve before a plus differs from a plus before a halve", () => {
    expect(power(first(row([[{ kind: "halve", k: 2 }, { kind: "plus", n: 4 }], [BOSS]], 10), 0))).toBe(9);
    expect(power(first(row([[{ kind: "plus", n: 4 }, { kind: "halve", k: 2 }], [BOSS]], 10), 0))).toBe(7);
  });

  it("a weight limit drops a hero above it and lets one at it through", () => {
    const level = row([[{ kind: "plus", n: 1 }], [BOSS]], 21, {}, { 0: { max: 13 } });
    expect(first(level, 0)).toMatchObject({ result: "loss", cause: "floor", reason: "That floor holds 13. You are 21." });
    const at = row([[{ kind: "plus", n: 1 }], [BOSS]], 13, {}, { 0: { max: 13 } });
    expect(power(first(at, 0))).toBe(14);
  });

  it("the weight limit is checked before the things", () => {
    const level = row([[{ kind: "halve", k: 2 }], [BOSS]], 20, {}, { 0: { max: 15 } });
    expect(first(level, 0)).toMatchObject({ cause: "floor" });
  });

  it("a locked room is not an option without a key and uses one when entered", () => {
    const level = row([[{ kind: "key" }], [{ kind: "plus", n: 2 }], [BOSS]], 5, { entries: [0, 2] }, { 1: { locked: true } });
    // Room 1 is not an entry: it needs a doorway to a cleared room (room 0) and a key.
    expect(options(level, startState(level))).toEqual([0, 2]);
    const afterKey = (first(level, 0) as { state: TowerState }).state;
    expect(afterKey.keys).toBe(1);
    expect(options(level, afterKey)).toEqual([1, 2]);
    const inside = enter(level, afterKey, 1);
    expect(inside.result === "move" && inside.state.keys).toBe(0);
    expect(inside.events[0]).toEqual({ kind: "unlock" });
  });

  it("a locked room with a key still follows the doorway rule", () => {
    const level = row([[{ kind: "key" }], [{ kind: "plus", n: 2 }], [{ kind: "plus", n: 2 }], [BOSS]], 5, { entries: [0] }, { 2: { locked: true } });
    const afterKey = (first(level, 0) as { state: TowerState }).state;
    expect(options(level, afterKey)).toEqual([1]);
  });

  it("a lock uses its key even when the floor then gives way", () => {
    const level = row([[BOSS]], 30, {}, { 0: { locked: true, max: 10 } });
    const withKey: TowerState = { power: 30, keys: 1, mask: 0, turn: 0 };
    const r = enter(level, withKey, 0);
    expect(r).toMatchObject({ result: "loss", cause: "floor" });
    expect(r.events[0]).toEqual({ kind: "unlock" });
  });

  it("with no options left the hero loses", () => {
    const level = row([[{ kind: "plus", n: 1 }], [BOSS]], 4, { entries: [0], walls: [[0, 1]] });
    expect(first(level, 0)).toMatchObject({ result: "loss", cause: "stuck", reason: "No room left to enter." });
  });

  it("a wall blocks a doorway and a doorway lets the hero walk on", () => {
    const open = row([[{ kind: "plus", n: 1 }], [{ kind: "plus", n: 1 }], [BOSS]], 4, { entries: [0] });
    const s0 = (first(open, 0) as { state: TowerState }).state;
    expect(options(open, s0)).toEqual([1]);
    const walled = row([[{ kind: "plus", n: 1 }], [{ kind: "plus", n: 1 }], [BOSS]], 4, { entries: [0], walls: [[0, 1]] });
    expect(first(walled, 0)).toMatchObject({ result: "loss", cause: "stuck" });
  });

  it("an empty cell is never an option and nothing connects through it", () => {
    const level = row([[{ kind: "plus", n: 1 }], null, [BOSS]], 4, { entries: [0] });
    expect(first(level, 0)).toMatchObject({ result: "loss", cause: "stuck" });
    const both = row([[{ kind: "plus", n: 1 }], null, [BOSS]], 4, { entries: [0, 2] });
    expect(options(both, startState(both))).toEqual([0, 2]);
  });

  it("rooms connect up and down by floor", () => {
    // Two columns, two floors; room 2 sits above room 0.
    const level: TowerLevel = {
      start: 5, w: 2, h: 2,
      rooms: [{ things: [{ kind: "plus", n: 1 }] }, { things: [{ kind: "plus", n: 1 }] }, { things: [{ kind: "plus", n: 1 }] }, { things: [BOSS] }],
      walls: [], entries: [0],
    };
    const s0 = (first(level, 0) as { state: TowerState }).state;
    expect(options(level, s0)).toEqual([1, 2]);
  });

  it("only entries are options at the start, and a cleared room is not an option again", () => {
    const level = row([[{ kind: "plus", n: 1 }], [{ kind: "plus", n: 1 }], [BOSS]], 4, { entries: [1] });
    expect(options(level, startState(level))).toEqual([1]);
    const s1 = (first(level, 1) as { state: TowerState }).state;
    expect(options(level, s1)).toEqual([0, 2]);
  });

  it("entering a room that is not an option throws", () => {
    const level = row([[{ kind: "plus", n: 1 }], [BOSS]], 4, { entries: [0] });
    expect(() => enter(level, startState(level), 1)).toThrow(/not an option/);
  });

  it("the turn counts rooms entered", () => {
    const level = row([[{ kind: "plus", n: 1 }], [{ kind: "plus", n: 1 }], [BOSS]], 4);
    const s1 = (first(level, 0) as { state: TowerState }).state;
    const s2 = (enter(level, s1, 1) as { state: TowerState }).state;
    expect([s1.turn, s2.turn]).toEqual([1, 2]);
  });

  it("stars: three at the best number, two at 60 percent, else one", () => {
    expect(starsFor(100, 100)).toBe(3);
    expect(starsFor(60, 100)).toBe(2);
    expect(starsFor(59, 100)).toBe(1);
  });

  it("playOrder reports a win, a loss and an order that ends early", () => {
    const level = row([[{ kind: "plus", n: 1 }], [{ kind: "boss", n: 3 }]], 4);
    expect(playOrder(level, [0, 1])).toMatchObject({ won: true, final: 8 });
    expect(playOrder(level, [0])).toMatchObject({ won: false });
    expect(playOrder(level, [1, 0])).toMatchObject({ won: true, final: 7 });
  });
});

describe("validation", () => {
  const good = (): TowerLevel => row([[{ kind: "plus", n: 1 }], [{ kind: "boss", n: 3 }]], 4);

  it("accepts a good level", () => {
    expect(() => validateLevel(good())).not.toThrow();
  });

  it("names what is wrong", () => {
    const bad = (change: (l: TowerLevel) => void, message: RegExp) => {
      const level = good();
      change(level);
      expect(() => validateLevel(level)).toThrow(message);
    };
    bad((l) => { l.start = 0; }, /start must be/);
    bad((l) => { l.rooms.pop(); }, /rooms must list/);
    bad((l) => { l.rooms[0] = { things: [] }; }, /one or two things/);
    bad((l) => { l.rooms[0] = { things: [{ kind: "boss", n: 2 }, { kind: "plus", n: 2 }] }; }, /boss.*last/);
    bad((l) => { l.rooms[0] = { things: [{ kind: "boss", n: 2 }] }; }, /exactly one boss/);
    bad((l) => { l.rooms[0] = { things: [{ kind: "times", k: 1 }] }; }, /times/);
    bad((l) => { l.entries = []; }, /at least one entry/);
    bad((l) => { l.entries = [5]; }, /not a room/);
    bad((l) => { l.walls = [[0, 7]]; }, /no room/);
    bad((l) => { l.rooms.push({ things: [{ kind: "plus", n: 1 }] }); l.w = 3; l.walls = [[0, 2]]; }, /do not touch/);
  });
});
