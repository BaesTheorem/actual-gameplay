import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { load } from "../scripts/levels";
import { randomStrokes } from "../scripts/savedog-suite";
import { folderOf } from "../src/app/modetable";
import { playOut, type DogLevel } from "../src/sim/savedog";
import { BeeCrew, Swarm } from "../src/sim/savedog/beecrew";
import { baseTransform } from "../src/sim/savedog/level";
import { Cat, makeBody } from "../src/sim/savedog/stroke";
import { SKWorld, STEP, applyImpulse, clampSpeed, position, velocity } from "../src/sim/sk";

// How strong the bees are, held to three things that are known from outside this engine: what
// the constants work out to by hand, what the iPhone build measured when its heave was tuned,
// and what its first audit with random strokes counted. A change that weakens or strengthens the
// bees moves at least one of them.

const campaign = load<DogLevel>(folderOf("saveDog"));
const attic = (number: string) => JSON.parse(readFileSync(new URL(`../../attic/dog-v2/${number}.json`, import.meta.url), "utf8")) as DogLevel;

describe("a bee's push", () => {
  // A bar lies on grass. Bees sit behind its end and are pushed as the swarm pushes them: the
  // heave's acceleration times a bee's mass, as an impulse every frame, then the speed clamp.
  // By hand, the bar and the bees speed up at (n mb a - mu m g) / (m + n mb), with a bee's mass
  // 0.6 pi 36 / 22500, the bar's 8 L / 22500, g 1470 and mu the root of 0.9 times 0.7.
  const push = (length: number, bees: number) => {
    const sk = new SKWorld(-9.8, { oneSided: true });
    sk.box({ kind: "wall", dynamic: false, friction: 0.7, restitution: 0.05, category: Cat.wall }, 2000, 40, { x: 500, y: 54 });
    const bar = makeBody(sk, { x: 200, y: 80.3 }, [{ x: -length / 2, y: 0 }, { x: length / 2, y: 0 }], true);
    for (let i = 0; i < 60; i++) sk.step();
    const swarm = Array.from({ length: bees }, () => sk.circle({
      kind: "bee", position: { x: 200 - length / 2 - 7, y: position(bar).y }, density: 0.6, friction: 0.1, restitution: 0.2, linearDamping: 0.05,
      gravityScale: 0, fixedRotation: true, bullet: true, category: Cat.bee, collision: Cat.wall | Cat.drawn | Cat.actor | Cat.killer | Cat.prop,
    }, 6));
    const mb = swarm[0].getMass(), m = bar.getMass(), force = bees * mb * BeeCrew.heave, grip = Math.sqrt(0.9 * 0.7) * m * 1470;
    const start = position(bar).x;
    let before = 0, after = 0;
    for (let i = 0; i < 36; i++) {
      for (const bee of swarm) { applyImpulse(bee, { x: BeeCrew.heave * bee.getMass() * STEP, y: 0 }); clampSpeed(bee, Swarm.topSpeed); }
      sk.step();
      if (i === 11) before = velocity(bar).x;
      if (i === 29) after = velocity(bar).x;
    }
    return { byHand: Math.max(0, force - grip) / (m + bees * mb), measured: (after - before) / (18 * STEP), moved: position(bar).x - start, mb, m };
  };

  it("has the masses and the heave the iPhone build has", () => {
    const { mb, m } = push(60, 1);
    expect(mb).toBeCloseTo((0.6 * Math.PI * 36) / 22_500, 9);
    expect(m).toBeCloseTo((60 * 8) / 22_500, 9);
    expect(BeeCrew.heave).toBeCloseTo(1035, 9);
    expect([Swarm.cruise, Swarm.press, Swarm.shove, Swarm.topSpeed]).toEqual([720, 220, 900, 260]);
  });

  it("moves a bar as fast as the constants say, to within a twentieth", () => {
    // Twelve bees on a 60 point bar: 37.5 of push against 24.9 of grip, 218 points a second every second.
    for (const [length, bees] of [[60, 12], [60, 9], [100, 16], [140, 20]]) {
      const { byHand, measured } = push(length, bees);
      expect(byHand).toBeGreaterThan(30);
      expect(Math.abs(measured - byHand) / byHand, `${bees} bees on ${length} pt: ${measured.toFixed(0)} against ${byHand.toFixed(0)} by hand`).toBeLessThan(0.05);
    }
    expect(push(60, 12).byHand).toBeCloseTo(218, 0);
  });

  it("starts a bar moving exactly where the push passes the grip", () => {
    // Eight bees on the 60 point bar push 25.0 against 24.9 and it creeps. Seven push 21.8 and it holds.
    expect(push(60, 8).moved).toBeGreaterThan(0.1);
    expect(push(60, 8).moved).toBeLessThan(2);
    expect(Math.abs(push(60, 7).moved)).toBeLessThan(0.05);
    expect(Math.abs(push(100, 12).moved)).toBeLessThan(0.05);
  });
});

describe("the crew's heave", () => {
  // The iPhone build tuned the heave on Holes below as it was then: seven bees under each of two
  // bars across two holes. With 56 point bars, 1.2 times the shove never lost in twelve replays,
  // 1.3 lost twice, and 1.6 lifted the bars off their ledges; 76 point bars held at 1.6. Seven
  // bees lift a 56 point bar when the heave passes 1.54 times the shove, by weight alone.
  const holes = attic("05");
  const bars = (length: number) => [138, 264].map((x) => [{ x: x - length / 2, y: 80 }, { x: x + length / 2, y: 80 }]);
  const wins = (length: number, times: number): boolean => {
    const shipped = BeeCrew.heave;
    (BeeCrew as unknown as { heave: number }).heave = Swarm.shove * times;
    try {
      return playOut(holes, { strokes: bars(length) }).outcome?.won === true;
    } finally {
      (BeeCrew as unknown as { heave: number }).heave = shipped;
    }
  };

  it("holds and lifts the same bars it held and lifted on the iPhone", () => {
    expect(wins(56, 1.0)).toBe(true);
    expect(wins(56, 1.15)).toBe(true);
    expect(wins(56, 1.2)).toBe(true);
    expect(wins(56, 1.6)).toBe(false);
    expect(wins(76, 1.15)).toBe(true);
    expect(wins(76, 1.6)).toBe(true);
    expect(BeeCrew.heave).toBeCloseTo(Swarm.shove * 1.15, 9);
  }, 60_000);
});

describe("the random strokes", () => {
  // The iPhone build's first audit with random strokes, on 2026-09-25, seeded its strokes with
  // 7000 plus the level's number. Three of today's levels are those levels byte for byte. It
  // counted 10 of 16 on First shield and 2 or 3 of 16 on Lid and on Roll it in.
  const count = (id: string, number: number) => {
    const level = campaign.find((l) => l.id === id)!;
    return randomStrokes(level, 16, 7, number).filter((stroke) => playOut(level, { strokes: [stroke.map(([x, y]) => ({ x, y }))] }).outcome?.won === true).length;
  };

  it("survive as often as they did on the iPhone, on the levels that have not changed since", () => {
    expect(count("first-shield", 1)).toBe(10);
    expect(count("lid", 2)).toBe(4);
    expect(count("roll-it-in", 6)).toBe(3);
  }, 120_000);

  it("survive as often on the old Holes below and the old Slope, where the iPhone counted 6 and 8", () => {
    const old = (number: string, seed: number) => {
      const level = attic(number);
      return randomStrokes(level, 16, 7, seed).filter((stroke) => playOut(level, { strokes: [stroke.map(([x, y]) => ({ x, y }))] }).outcome?.won === true).length;
    };
    expect(old("05", 5)).toBe(7);
    expect(old("07", 7)).toBe(9);
    expect(old("10", 10)).toBe(0);
  }, 120_000);
});

describe("the stored solutions", () => {
  // Every level's stored solution as it plays today: stars, and ink to the nearest point.
  const pinned: Record<string, [number, number]> = {
    "first-shield": [3, 236], lid: [3, 130], pedestal: [3, 129], "the-plug": [3, 46], "side-door": [3, 67], "roll-it-in": [3, 78],
    "two-cliffs": [3, 422], "across-the-water": [3, 319], "between-the-blades": [3, 180], "no-ink-overhead": [3, 588], "holes-below": [3, 112],
    slope: [3, 258], moat: [3, 145], "two-caves": [3, 218], "low-ceiling": [3, 158], saws: [3, 145],
  };

  it("win as they did, with the same stars and the same ink", () => {
    const found = campaign.filter((level) => pinned[level.id]);
    // The levels can change, and then their lines here change with them. They cannot all go unnoticed.
    expect(found.length).toBeGreaterThanOrEqual(12);
    for (const level of found) {
      const run = playOut(level, { transform: baseTransform(level) });
      const stars = run.outcome?.won ? run.outcome.stars : 0;
      expect([level.id, run.outcome?.won === true, stars, Math.round(run.ink)]).toEqual([level.id, true, ...pinned[level.id]]);
    }
  }, 60_000);
});
