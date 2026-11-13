import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ORDER_CAP, Rng, enter, options, playBot, playOrder, solve, startState, validateLevel,
  type Room, type Thing, type TowerLevel, type TowerState,
} from "../src/sim/tower";

interface Reference {
  level: TowerLevel;
  solvable: boolean;
  best: number;
  bestOrder: number[];
  randomWin: number;
}

const reference = JSON.parse(readFileSync(new URL("./fixtures/tower-reference.json", import.meta.url), "utf8")) as Reference[];

describe("the reference fixture", () => {
  it("holds 160 towers", () => {
    expect(reference).toHaveLength(160);
  });

  it("agrees with the solver on solvable, best and randomWin, and the best order replays", () => {
    reference.forEach((entry, i) => {
      validateLevel(entry.level);
      const s = solve(entry.level);
      expect(s.solvable, `tower ${i}: solvable`).toBe(entry.solvable);
      expect(s.best, `tower ${i}: best`).toBe(entry.best);
      expect(Math.abs(s.randomWin - entry.randomWin), `tower ${i}: randomWin ${s.randomWin} vs ${entry.randomWin}`).toBeLessThan(1e-9);
      if (entry.solvable) {
        const played = playOrder(entry.level, s.bestOrder);
        expect(played.won, `tower ${i}: bestOrder wins`).toBe(true);
        expect(played.final, `tower ${i}: bestOrder reaches best`).toBe(entry.best);
        const theirs = playOrder(entry.level, entry.bestOrder);
        expect(theirs.final, `tower ${i}: their order replays`).toBe(entry.best);
      } else {
        expect(s.bestOrder).toEqual([]);
      }
    });
  });
});

// MARK: brute force

interface Brute { wins: number; best: number; prob: number }

/// Every order, with no memo, straight from the rules.
const brute = (level: TowerLevel, state: TowerState): Brute => {
  const opts = options(level, state);
  if (opts.length === 0) return { wins: 0, best: -1, prob: 0 };
  let wins = 0, best = -1, prob = 0;
  for (const room of opts) {
    const r = enter(level, state, room, false);
    if (r.result === "win") { wins += 1; best = Math.max(best, r.final); prob += 1; }
    else if (r.result === "move") {
      const child = brute(level, r.state);
      wins += child.wins; best = Math.max(best, child.best); prob += child.prob;
    }
  }
  return { wins, best, prob: prob / opts.length };
};

const randomTower = (rng: Rng): TowerLevel => {
  const w = rng.int(1, 3), h = rng.int(1, 3);
  const n = w * h;
  const cells = Array.from({ length: n }, () => (n > 2 && rng.chance(0.1) ? null : ({ things: [] as Thing[] } as Room | null)));
  const live = cells.flatMap((c, i) => (c ? [i] : []));
  if (live.length < 2) return randomTower(rng);
  const bossAt = rng.pick(live);
  const thing = (): Thing => {
    switch (rng.pick(["enemy", "enemy", "plus", "times", "minus", "halve", "mirror", "key", "grower"] as const)) {
      case "enemy": return { kind: "enemy", n: rng.int(1, 14) };
      case "plus": return { kind: "plus", n: rng.int(1, 12) };
      case "times": return { kind: "times", k: rng.int(2, 3) };
      case "minus": return { kind: "minus", n: rng.int(1, 8) };
      case "halve": return { kind: "halve", k: rng.int(2, 3) };
      case "mirror": return { kind: "mirror" };
      case "key": return { kind: "key" };
      default: return { kind: "grower", n: rng.int(1, 8), grow: rng.int(1, 3) };
    }
  };
  for (const i of live) {
    const room = cells[i] as Room;
    const count = rng.chance(0.25) ? 2 : 1;
    for (let j = 0; j < count; j++) room.things.push(thing());
    if (i === bossAt) room.things[room.things.length - 1] = { kind: "boss", n: rng.int(3, 20) };
    if (rng.chance(0.2)) room.max = rng.int(4, 40);
    if (rng.chance(0.08)) room.locked = true;
  }
  const walls: [number, number][] = [];
  for (const i of live) {
    if (i % w < w - 1 && cells[i + 1] && rng.chance(0.2)) walls.push([i, i + 1]);
    if (i + w < n && cells[i + w] && rng.chance(0.2)) walls.push([i, i + w]);
  }
  const entries = live.filter(() => rng.chance(0.6));
  if (entries.length === 0) entries.push(live[0] as number);
  return { start: rng.int(4, 16), w, h, rooms: cells, walls, entries };
};

describe("the solver against brute force", () => {
  it("counts winning orders, finds the best and gets the random chance right on 200 small towers", () => {
    const rng = new Rng(20240601);
    let solvable = 0;
    for (let i = 0; i < 200; i++) {
      const level = randomTower(rng);
      validateLevel(level);
      const s = solve(level);
      const b = brute(level, startState(level));
      expect(s.winningOrders, `tower ${i}: winning orders`).toBe(b.wins);
      expect(s.best, `tower ${i}: best`).toBe(Math.max(0, b.best));
      expect(s.solvable, `tower ${i}: solvable`).toBe(b.wins > 0);
      expect(Math.abs(s.randomWin - b.prob), `tower ${i}: randomWin`).toBeLessThan(1e-9);
      if (s.solvable) {
        solvable += 1;
        expect(playOrder(level, s.bestOrder).final).toBe(s.best);
      }
    }
    // The sample must hold both kinds of tower, or the check proves little.
    expect(solvable).toBeGreaterThan(30);
    expect(solvable).toBeLessThan(190);
  });

  const flat = (n: number, power: number): TowerLevel => ({
    start: power, w: n, h: 1,
    rooms: [...Array.from({ length: n - 1 }, () => ({ things: [{ kind: "plus", n: 1 } as Thing] })), { things: [{ kind: "boss", n: 1 }] }],
    walls: [], entries: Array.from({ length: n }, (_, i) => i),
  });

  it("counts small numbers of orders exactly", () => {
    const s = solve(flat(3, 100));
    expect(s.winningOrders).toBe(5);
    expect(s.capped).toBe(false);
    expect(s.randomWin).toBe(1);
  });

  it("reports a cap beyond 100000 winning orders", () => {
    const s = solve(flat(10, 100));
    expect(s.winningOrders).toBe(ORDER_CAP);
    expect(s.capped).toBe(true);
  });

  it("solves a dense 3 by 4 tower in well under a second", () => {
    const rng = new Rng(7);
    const rooms: Room[] = Array.from({ length: 12 }, (_, i) => ({
      things: [i === 11 ? { kind: "boss", n: 400 } : rng.pick<Thing>([{ kind: "plus", n: 3 }, { kind: "enemy", n: 2 }, { kind: "times", k: 2 }, { kind: "plus", n: 7 }])],
    }));
    const level: TowerLevel = { start: 5, w: 3, h: 4, rooms, walls: [], entries: [0, 1, 2] };
    const t0 = performance.now();
    const s = solve(level);
    const ms = performance.now() - t0;
    expect(s.states).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(1000);
  });
});

// MARK: the players

const open = (rooms: Thing[][], start: number, flags: Record<number, Partial<Room>> = {}): TowerLevel => ({
  start, w: rooms.length, h: 1,
  rooms: rooms.map((things, i) => ({ things, ...flags[i] })),
  walls: [], entries: rooms.map((_, i) => i),
});

describe("the heuristic players", () => {
  const far: Thing = { kind: "boss", n: 9999 };

  it("smallest goes good, times, smallest beatable enemy, rising mirror, curse, then the boss", () => {
    const level = open([[{ kind: "enemy", n: 5 }], [{ kind: "minus", n: 1 }], [{ kind: "mirror" }], [{ kind: "times", k: 2 }], [{ kind: "plus", n: 1 }], [far]], 6);
    expect(playBot(level, "smallest").order).toEqual([4, 3, 0, 2, 1, 5]);
  });

  it("wise goes good, then enemies and mirrors, times, curses, then the boss", () => {
    const level = open([[{ kind: "enemy", n: 5 }], [{ kind: "minus", n: 1 }], [{ kind: "mirror" }], [{ kind: "times", k: 2 }], [{ kind: "plus", n: 1 }], [far]], 6);
    expect(playBot(level, "wise").order).toEqual([4, 0, 2, 3, 1, 5]);
  });

  it("both take the boss as soon as they can beat it", () => {
    const level = open([[{ kind: "enemy", n: 1 }], [{ kind: "boss", n: 5 }]], 10);
    for (const kind of ["smallest", "wise"] as const) {
      const run = playBot(level, kind);
      expect(run.order).toEqual([1]);
      expect(run.final).toBe(15);
    }
  });

  it("smallest picks the smaller of two beatable enemies, ties to the lower room", () => {
    const level = open([[{ kind: "enemy", n: 4 }], [{ kind: "enemy", n: 3 }], [{ kind: "enemy", n: 3 }], [far]], 9);
    expect(playBot(level, "smallest").order.slice(0, 3)).toEqual([1, 2, 0]);
  });

  it("neither enters a room above its weight limit while another option exists", () => {
    const level = open([[{ kind: "plus", n: 1 }], [{ kind: "plus", n: 1 }], [far]], 10, { 0: { max: 5 } });
    expect(playBot(level, "smallest").order[0]).toBe(1);
    expect(playBot(level, "wise").order[0]).toBe(1);
  });

  it("wise beats a tower that smallest cannot, and tier says which", () => {
    // Smallest takes the plus first and is too heavy for the limit room; wise goes there while light.
    const level = open([[{ kind: "plus", n: 10 }], [{ kind: "times", k: 3 }], [{ kind: "boss", n: 20 }]], 5, { 1: { max: 5 } });
    expect(playBot(level, "smallest").won).toBe(false);
    expect(playBot(level, "wise").won).toBe(true);
    const s = solve(level);
    expect(s.bots).toEqual({ smallest: false, wise: true });
    expect(s.tier).toBe(1);
  });

  it("tier is 0 when smallest wins", () => {
    const easy = open([[{ kind: "plus", n: 3 }], [{ kind: "boss", n: 5 }]], 4);
    expect(solve(easy).tier).toBe(0);
  });

  it("tier is 2 when only a stranger order wins", () => {
    // Both players take the plus first and arrive too heavy for the times 3. The mirror has to
    // come first: 21 becomes 12, which the limit room lets through.
    const level = open([[{ kind: "plus", n: 10 }], [{ kind: "mirror" }], [{ kind: "times", k: 3 }], [{ kind: "boss", n: 40 }]], 21, { 2: { max: 15 } });
    const s = solve(level);
    expect(s.solvable).toBe(true);
    expect(s.tier).toBe(2);
  });
});
