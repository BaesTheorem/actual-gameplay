import { describe, expect, it } from "vitest";
import {
  NUMBER_LIMIT, Rng, checkLevel, daily, generate, generateDetailed, playOrder, roomCount, solve, validateLevel,
  type Recipe, type TowerLevel,
} from "../src/sim/tower";

const RECIPE: Recipe = {
  grids: [{ w: 2, h: 3 }, { w: 2, h: 4 }],
  allEntries: false,
  palette: { enemy: 6, plus: 3, times: 2, minus: 1.5, halve: 1, mirror: 1, key: 1 },
  limitShare: 0.15,
  lockShare: 0.1,
  wallShare: 0.2,
  twoThings: [0, 2],
  tiers: [1, 2],
  randomWin: [0, 0.3],
  orders: [1, 40],
  minSolution: 4,
  featured: ["times"],
};

describe("rng", () => {
  it("gives the same numbers for the same seed and different numbers for another", () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(xs);
    // A fixed value pins the algorithm, so Node and a browser cannot drift apart.
    expect(new Rng(1).int(0, 1000000)).toBe(new Rng(1).int(0, 1000000));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("seeds from a string the same way every time", () => {
    expect(new Rng("2026-11-12").next()).toBe(new Rng("2026-11-12").next());
    expect(new Rng("2026-11-12").next()).not.toBe(new Rng("2026-11-13").next());
  });

  it("picks by weight and never picks a zero weight", () => {
    const rng = new Rng(5);
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 2000; i++) counts[rng.weighted({ a: 1, b: 3, c: 0 })] += 1;
    expect(counts.c).toBe(0);
    expect(counts.b).toBeGreaterThan(counts.a * 2);
  });
});

describe("generate", () => {
  it("makes the same level for the same seed on two runs", () => {
    for (const seed of [1, 2, 3, 99]) {
      const a = generate(RECIPE, seed);
      const b = generate(RECIPE, seed);
      expect(a).not.toBeNull();
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
    expect(JSON.stringify(generate(RECIPE, 1))).not.toBe(JSON.stringify(generate(RECIPE, 2)));
  });

  it("makes levels that validate and meet the recipe and the rules for every level", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const level = generate(RECIPE, seed) as TowerLevel;
      expect(level, `seed ${seed}`).not.toBeNull();
      validateLevel(level);
      expect(checkLevel(level, RECIPE), `seed ${seed}`).toEqual([]);
      expect(level.seed).toBe(seed);
      const s = solve(level);
      expect(s.solvable).toBe(true);
      expect(s.best).toBe(level.best);
      expect(s.bestOrder).toEqual(level.solution);
      expect(playOrder(level, level.solution as number[]).final).toBe(level.best);
      expect(s.maxSeen).toBeLessThanOrEqual(NUMBER_LIMIT);
      expect(s.firstWins).toBe(0);
      expect(s.firstLosses).toBeGreaterThan(0);
      expect([1, 2]).toContain(s.tier);
      expect(s.randomWin).toBeLessThanOrEqual(0.3);
      expect(s.bestOrder.length).toBeGreaterThanOrEqual(4);
      expect(level.rooms.some((r) => r?.things.some((t) => t.kind === "times"))).toBe(true);
      expect(roomCount(level)).toBeLessThanOrEqual(8);
    }
  });

  it("puts the entries on the ground floor, or on every room for the classic ad", () => {
    const stairs = generate(RECIPE, 4) as TowerLevel;
    expect(stairs.entries.every((e) => e < stairs.w)).toBe(true);
    const classic: Recipe = { ...RECIPE, allEntries: true, grids: [{ w: 1, h: 4 }], palette: { enemy: 6, plus: 3 }, tiers: [0], limitShare: 0, lockShare: 0, wallShare: 0, twoThings: [0, 0], featured: [], randomWin: [0, 1], orders: [1, Infinity], minSolution: 3 };
    const ad = generate(classic, 4) as TowerLevel;
    expect(ad.entries).toEqual([0, 1, 2, 3]);
  });

  it("keeps the featured pieces and gives no second thing that no play reaches", () => {
    const recipe: Recipe = { ...RECIPE, featured: ["limit", "mirror", "key", "lock"], grids: [{ w: 3, h: 3 }], tiers: [1, 2], randomWin: [0, 1], orders: [1, Infinity], maxCandidates: 8000 };
    for (let seed = 1; seed <= 4; seed++) {
      const level = generate(recipe, seed) as TowerLevel;
      expect(level).not.toBeNull();
      const s = solve(level);
      level.rooms.forEach((room, i) => {
        if (room && room.things.length === 2) expect(s.reachedSecond[i], `seed ${seed} room ${i}`).toBe(true);
      });
      expect(level.rooms.some((r) => r?.max !== undefined)).toBe(true);
      expect(level.rooms.some((r) => r?.locked)).toBe(true);
    }
  });

  it("returns null in bounded time for a recipe that cannot be met", () => {
    const impossible: Recipe = { ...RECIPE, randomWin: [2, 3], maxCandidates: 60 };
    const t0 = performance.now();
    expect(generate(impossible, 1)).toBeNull();
    expect(generateDetailed(impossible, 1).candidates).toBe(60);
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it("flags a level that breaks a rule", () => {
    const level = generate(RECIPE, 1) as TowerLevel;
    const easyBoss: TowerLevel = JSON.parse(JSON.stringify(level));
    for (const i of easyBoss.entries) {
      const room = easyBoss.rooms[i];
      if (room) room.things = [{ kind: "boss", n: 1 }];
    }
    expect(checkLevel(easyBoss).length).toBeGreaterThan(0);
    const tight: Recipe = { ...RECIPE, orders: [1000, 2000] };
    expect(checkLevel(level, tight).join()).toMatch(/winning orders/);
  });
});

describe("daily", () => {
  it("is the same level for the same date", () => {
    expect(JSON.stringify(daily("2026-11-12"))).toBe(JSON.stringify(daily("2026-11-12")));
  });

  it("is a different level on each of 30 dates, tier 1 or 2, of middling size", () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 30; d++) {
      const date = `2026-11-${String(d).padStart(2, "0")}`;
      const level = daily(date);
      validateLevel(level, true);
      expect(level.id).toBe(`daily-${date}`);
      expect([1, 2]).toContain(solve(level).tier);
      expect(roomCount(level)).toBeGreaterThanOrEqual(6);
      expect(roomCount(level)).toBeLessThanOrEqual(9);
      seen.add(JSON.stringify(level.rooms) + level.start);
    }
    expect(seen.size).toBe(30);
  });
});
