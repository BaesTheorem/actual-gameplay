import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GateOp, Hazard, RunnerEconomy, RunnerGenerator, SeededRNG, Upgrade, finaleStrength, segmentZ,
  type Track,
} from "../src/sim/runner";

describe("runner generator", () => {
  it("makes the same track for the same level", () => {
    const a = RunnerGenerator.makeTrack(7, 5);
    const b = RunnerGenerator.makeTrack(7, 5);
    expect(a).toEqual(b);
    expect(a).not.toEqual(RunnerGenerator.makeTrack(8, 5));
  });

  it("makes every level survivable at base upgrades", () => {
    const economy = RunnerEconomy.base;
    for (let level = 0; level < 300; level++) {
      const track = RunnerGenerator.makeTrack(level, economy.startCrowd);
      expect(track.bestPath, `level ${level}: finale ${JSON.stringify(track.finale)} vs best ${track.bestPath}`)
        .toBeGreaterThan(finaleStrength(track.finale));
      expect(track.segments.length).toBeGreaterThanOrEqual(6);
      expect(track.segments.length).toBeLessThanOrEqual(14);
      const last = track.segments[track.segments.length - 1];
      expect(track.finaleZ).toBeGreaterThan(last ? segmentZ(last) : 0);
      let lastZ = 0;
      for (const segment of track.segments) {
        expect(segmentZ(segment), `level ${level}: segments must move away`).toBeGreaterThan(lastZ);
        lastZ = segmentZ(segment);
        if (segment.type === "gates") {
          const { left, right } = segment.pair;
          expect(GateOp.isGood(left) || GateOp.isGood(right), `level ${level}: a gate pair needs a good side`).toBe(true);
          expect(left, `level ${level}: identical gates`).not.toEqual(right);
        }
        if (segment.type === "obstacle") {
          const span = Hazard.span(segment.obstacle.hazard, 0);
          expect(span.lo).toBeGreaterThanOrEqual(-1.1);
          expect(span.hi).toBeLessThanOrEqual(1.1);
          expect(level, "obstacles only from level 3 on").toBeGreaterThanOrEqual(2);
        }
      }
      if ((level + 1) % 5 === 0) {
        expect(track.finale.type, `level ${level} should be a boss`).toBe("boss");
      }
    }
  });

  it("moves the better gate to the other side at least every third pair", () => {
    for (let level = 0; level < 300; level++) {
      const track = RunnerGenerator.makeTrack(level, 5);
      let running = 5;
      let lastSide = 0;
      let run = 0;
      for (const segment of track.segments) {
        if (segment.type !== "gates") continue;
        const { left, right } = segment.pair;
        const side = GateOp.apply(right, running) >= GateOp.apply(left, running) ? 1 : -1;
        run = side === lastSide ? run + 1 : 1;
        lastSide = side;
        expect(run, `level ${level}: better gate stayed on one side too long`).toBeLessThanOrEqual(2);
        running = Math.max(GateOp.apply(left, running), GateOp.apply(right, running));
      }
    }
  });

  it("does not grow the rivals with the start crowd", () => {
    for (let level = 0; level < 300; level++) {
      const base = RunnerGenerator.makeTrack(level, 5);
      const upgraded = RunnerGenerator.makeTrack(level, 45);
      expect(base.segments, `level ${level}`).toEqual(upgraded.segments);
      expect(base.finale, `level ${level}`).toEqual(upgraded.finale);
      expect(upgraded.bestPath, `level ${level}`).toBeGreaterThanOrEqual(base.bestPath);
    }
  });

  it("applies gate ops", () => {
    expect(GateOp.apply(GateOp.add(5), 10)).toBe(15);
    expect(GateOp.apply(GateOp.subtract(12), 10)).toBe(0);
    expect(GateOp.apply(GateOp.multiply(3), 4)).toBe(12);
    expect(GateOp.apply(GateOp.divide(2), 9)).toBe(4);
    expect(GateOp.isGood(GateOp.multiply(2))).toBe(true);
    expect(GateOp.isGood(GateOp.divide(2))).toBe(false);
  });

  it("follows the economy curves", () => {
    const base = RunnerEconomy.base;
    expect(base.startCrowd).toBe(5);
    expect(base.memberPower).toBe(1);
    expect(base.coins(0, 3)).toBe(30);
    const maxed = new RunnerEconomy({ startCrowd: 20, memberPower: 10, coinMultiplier: 10 });
    expect(maxed.startCrowd).toBe(45);
    expect(maxed.memberPower).toBeCloseTo(2.5, 9);
    for (const upgrade of Upgrade.allCases) {
      expect(Upgrade.cost(upgrade, 0), `${upgrade} costs should climb`).toBeLessThan(Upgrade.cost(upgrade, 3));
    }
  });
});

// The outside check. scripts/economy.py holds its own copy of the generator, and
// web/scripts/runner-fixture.py wrote these tracks from it. Every number must be the same double.
interface FixtureTrack {
  level: number;
  seed: string;
  segments: unknown[];
  boss: boolean;
  strength: number;
  finaleZ: number;
  speed: number;
  best: number;
  bestUpgraded: number;
}
interface Fixture {
  baseCrowd: number;
  upgradedCrowd: number;
  rng: { seed: string; next: string[]; unit: number[]; int: number[] }[];
  tracks: FixtureTrack[];
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/runner-tracks.json", import.meta.url), "utf8")) as Fixture;

const SYMBOL = { add: "+", subtract: "-", multiply: "x", divide: "/" } as const;
const op = (o: GateOp) => [SYMBOL[o.kind], o.n];

/// A track in the shape economy.py gives its own.
const pythonShape = (track: Track) => track.segments.map((segment) => {
  if (segment.type === "gates") return ["gates", segment.pair.z, op(segment.pair.left), op(segment.pair.right)];
  const h = segment.obstacle.hazard;
  const hazard = h.kind === "blade" ? ["blade", h.center, h.halfWidth, h.amplitude, h.speed] : [h.kind, h.x0, h.x1];
  return ["obstacle", segment.obstacle.z, hazard];
});

describe("runner generator against scripts/economy.py", () => {
  it("draws the same numbers from the seeded generator", () => {
    expect(fixture.rng.length).toBeGreaterThan(0);
    for (const row of fixture.rng) {
      const rng = new SeededRNG(BigInt(row.seed));
      expect(row.next.map(() => rng.next().toString()), `seed ${row.seed}`).toEqual(row.next);
      expect(row.unit.map(() => rng.unit()), `seed ${row.seed}`).toEqual(row.unit);
      expect(row.int.map(() => rng.int(3, 30)), `seed ${row.seed}`).toEqual(row.int);
    }
  });

  it("builds runs 0 to 60 segment for segment", () => {
    expect(fixture.baseCrowd).toBe(RunnerGenerator.baseCrowd);
    expect(fixture.tracks.map((t) => t.level)).toEqual(Array.from({ length: 61 }, (_, i) => i));
    for (const want of fixture.tracks) {
      const where = `level ${want.level}`;
      const track = RunnerGenerator.makeTrack(want.level, fixture.baseCrowd);
      expect(RunnerGenerator.seed(want.level).toString(), where).toBe(want.seed);
      const shape = pythonShape(track);
      expect(shape.length, where).toBe(want.segments.length);
      shape.forEach((segment, i) => expect(segment, `${where} segment ${i}`).toEqual(want.segments[i]));
      expect(track.finale.type === "boss", where).toBe(want.boss);
      expect(finaleStrength(track.finale), where).toBe(want.strength);
      expect(track.finaleZ, where).toBe(want.finaleZ);
      expect(track.speed, where).toBe(want.speed);
      expect(track.bestPath, where).toBe(want.best);
      expect(RunnerGenerator.makeTrack(want.level, fixture.upgradedCrowd).bestPath, where).toBe(want.bestUpgraded);
    }
  });
});
