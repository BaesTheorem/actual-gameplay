import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURE_RUNS, fixture } from "../scripts/runner-fixture";
import {
  FAIR_TRIES, GateOp, LAZY, MAX_MULTIPLIES, RunnerEconomy, RunnerGenerator, Skilled, isBossRun, isFair, lazyPilot, playTrack,
  segmentsOf, wave, worldOf, worldPieces, worldTitle, type PieceKind, type Track,
} from "../src/sim/runner";

/// Runs of the first sixty that no seed made fair, and that ship as the best candidate. None.
const EXCEPTIONS: number[] = [];

describe("runner generator", () => {
  it("makes the same track for the same run, twice", () => {
    for (const level of [0, 7, 23, 61]) {
      expect(RunnerGenerator.makeTrack(level), `run ${level + 1}`).toEqual(RunnerGenerator.makeTrack(level));
    }
    expect(RunnerGenerator.makeTrack(7)).not.toEqual(RunnerGenerator.makeTrack(8));
  });

  // The simulation is add, multiply, divide and square root, which are the same on every
  // processor, and the generator's layout is integer draws. So the tracks are pinned exactly.
  it("makes runs 1 to 30 as the stored fixture has them", () => {
    const stored = JSON.parse(readFileSync(new URL("./fixtures/runner-tracks-v2.json", import.meta.url), "utf8")) as Track[];
    expect(stored.length).toBe(FIXTURE_RUNS);
    const made = JSON.parse(JSON.stringify(fixture())) as Track[];
    made.forEach((track, level) => expect(track, `run ${level + 1}`).toEqual(stored[level]));
  });

  it("makes runs the skilled bot wins and the three lazy bots lose", () => {
    for (let level = 0; level < 60; level++) {
      const track = RunnerGenerator.makeTrack(level), reference = RunnerEconomy.reference(level);
      const skilled = playTrack(track, reference, new Skilled(track)).outcome?.won === true;
      const lazy = LAZY.filter((name) => playTrack(track, reference, lazyPilot(name, track)).outcome?.won === true);
      // The check is played again here, not read off the track.
      expect({ skilled, lazy }, `run ${level + 1}`).toEqual(track.fairness);
      expect(track.attempt, `run ${level + 1}`).toBeLessThan(FAIR_TRIES);
      if (EXCEPTIONS.includes(level + 1)) expect(isFair(track), `run ${level + 1} is listed as an exception`).toBe(false);
      else expect(isFair(track), `run ${level + 1}: ${JSON.stringify(track.fairness)}`).toBe(true);
      expect(track.par, `run ${level + 1}`).toBeGreaterThan(0);
    }
  });

  it("assumes no upgrades in the first world and the reference player's after it", () => {
    for (let level = 0; level < 5; level++) expect(RunnerEconomy.reference(level)).toBe(RunnerEconomy.base);
    const late = RunnerEconomy.reference(299);
    expect([late.level("startCrowd"), late.level("memberPower"), late.level("fireRate"), late.level("coinMultiplier")]).toEqual([20, 10, 10, 0]);
    let last = 0;
    for (let level = 0; level < 300; level++) {
      const r = RunnerEconomy.reference(level), owned = r.level("startCrowd") + r.level("memberPower") + r.level("fireRate");
      expect(owned).toBeGreaterThanOrEqual(last);
      last = owned;
    }
  });

  it("lays every run out in order, with a way through", () => {
    for (let level = 0; level < 120; level++) {
      const track = RunnerGenerator.makeTrack(level), where = `run ${level + 1}`;
      expect(segmentsOf(track.pieces).end.length, where).toBe(RunnerGenerator.segments(level));
      let lastZ = 0, multiplies = 0;
      for (const piece of track.pieces) {
        expect(piece.z, where).toBeGreaterThanOrEqual(lastZ);
        lastZ = piece.z;
        if (piece.kind === "gates") {
          expect(GateOp.isGood(piece.left) || GateOp.isGood(piece.right), `${where}: a gate pair needs a good side`).toBe(true);
          expect(piece.left, `${where}: identical gates`).not.toEqual(piece.right);
          if (piece.left.kind === "multiply" || piece.right.kind === "multiply") multiplies += 1;
        }
        if ("lo" in piece) {
          expect(piece.lo, where).toBeLessThan(piece.hi);
          expect(piece.lo, where).toBeGreaterThanOrEqual(-1.1);
          expect(piece.hi, where).toBeLessThanOrEqual(1.1);
        }
        if ("hp" in piece) expect(piece.hp, where).toBeGreaterThan(0);
      }
      expect(multiplies, where).toBeLessThanOrEqual(MAX_MULTIPLIES);
      expect(track.finaleZ, where).toBeGreaterThan(lastZ + 9);
      expect(track.finale.type, where).toBe(isBossRun(level) ? "boss" : "crowd");
      expect(track.speed, where).toBe(Math.min(7 + 0.15 * level, 12));
    }
    // The first thing in the first run is the crate of 30 that holds eight allies.
    expect(RunnerGenerator.makeTrack(0).pieces[0]).toEqual({ kind: "crate", z: 14, lo: -0.25, hi: 0.25, hp: 30, holds: { kind: "allies", n: 8 } });
  });
});

describe("worlds", () => {
  it("are five runs each, in four looks that come round again", () => {
    expect([0, 4, 5, 9, 10, 15, 19, 20, 39].map((level) => worldOf(level).name))
      .toEqual(["Meadow", "Meadow", "Dunes", "Dunes", "Snow", "Night", "Night", "Meadow", "Night"]);
    expect([0, 5, 19, 20].map((level) => worldOf(level).index)).toEqual([0, 1, 3, 4]);
    expect(worldTitle(6)).toBe("World 2, Dunes. Run 7");
    expect([3, 4, 9, 10].map(isBossRun)).toEqual([false, true, true, false]);
  });

  it("hold only the pieces they are meant to", () => {
    const seen: Set<string>[] = [new Set(), new Set(), new Set(), new Set()];
    for (let level = 0; level < 40; level++) {
      const world = Math.min(worldOf(level).index, 3), has = worldPieces(worldOf(level).index);
      for (const piece of RunnerGenerator.makeTrack(level).pieces) {
        seen[world]!.add(piece.kind);
        if (piece.kind === "gates") {
          for (const op of [piece.left, piece.right]) {
            if (op.kind === "rate") { seen[world]!.add("rate gate"); expect(has.rateGates, `run ${level + 1}`).toBe(true); }
            if (op.kind === "range") { seen[world]!.add("range gate"); expect(has.rangeGates, `run ${level + 1}`).toBe(true); }
          }
          if (piece.slide) { seen[world]!.add("sliding gate"); expect(has.slidingGates, `run ${level + 1}`).toBe(true); }
        }
        if (piece.kind === "crate" && piece.holds.kind === "rate") expect(has.rateCrates, `run ${level + 1}`).toBe(true);
      }
    }
    const kinds = (world: number, names: (PieceKind | string)[]) => names.filter((name) => seen[world]!.has(name));
    // World 1 teaches gates and crates and has nothing else.
    expect([...seen[0]!].sort()).toEqual(["crate", "gates"]);
    expect(kinds(1, ["squad", "rate gate", "sliding gate"])).toEqual(["squad", "rate gate", "sliding gate"]);
    expect(kinds(1, ["barrel", "hammer", "bridge", "blade", "range gate"])).toEqual([]);
    expect(kinds(2, ["barrel", "hammer", "bridge"])).toEqual(["barrel", "hammer", "bridge"]);
    expect(kinds(3, ["squad", "barrel", "hammer", "bridge", "wall", "spikes", "blade"]).length).toBe(7);
    // Runs grow longer: seven segments at first, sixteen in the end.
    expect([0, 3, 15, 27, 200].map(RunnerGenerator.segments)).toEqual([7, 8, 12, 16, 16]);
  });
});

describe("the arithmetic every device shares", () => {
  it("has a sine made of plain arithmetic", () => {
    expect([wave(0), wave(0.25), wave(0.5), wave(0.75), wave(1.25), wave(-0.25)]).toEqual([0, 1, -0, -1, 1, -1]);
    for (let i = 0; i <= 200; i++) expect(Math.abs(wave(i / 200) - Math.sin((2 * Math.PI * i) / 200))).toBeLessThan(0.002);
  });

  // Math.sin and its kin differ in the last digit between engines, and the generator plays each
  // track to decide whether to keep it. Only drawing may use them: the projection, and the pose
  // of a runner, which is in crowd.ts and marked.
  it("uses no function in the simulation that differs between engines", () => {
    const dir = new URL("../src/sim/runner/", import.meta.url);
    const banned = /Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt|sinh|cosh|tanh|random)\b|[^*]\*\*[^*]/;
    for (const file of readdirSync(dir)) {
      if (file === "projection.ts" || file === "rng.ts") continue;
      readFileSync(new URL(file, dir), "utf8").split("\n").forEach((line, i) => {
        if (line.includes("drawing only")) return;
        expect(banned.test(line.replace(/\/\/.*$/, "")), `${file}:${i + 1} ${line.trim()}`).toBe(false);
      });
    }
  });
});
