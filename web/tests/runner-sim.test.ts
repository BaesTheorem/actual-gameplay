import { describe, expect, it } from "vitest";
import {
  BASE_RANGE, CHARGE_GAP, Crowd, FinaleFight, GateOp, Gates, Hammer, PELLET, RunnerEconomy, RunnerGenerator, RunnerSim, Skilled, playTrack, trackOf,
  type Finale, type Piece, type Pilot,
} from "../src/sim/runner";

const FAR: Finale = { type: "crowd", count: 1 };
const hold = (x: number): Pilot => ({ steer: () => x });
/// A run of hand-placed pieces with no screen, steered to one lane. The finale is far off unless one is given.
const run = (pieces: Piece[], x = 0, economy = RunnerEconomy.base, finale: Finale = FAR, finaleZ = 400) => {
  const sim = new RunnerSim(trackOf(pieces, finale, { finaleZ }), economy, null, { view: false });
  sim.fly(hold(x));
  return sim;
};
const step = (sim: RunnerSim, seconds: number) => { for (let i = 0; i < Math.round(seconds * 60) && !sim.finished; i++) sim.frame(); };
const crate = (z: number, lo: number, hi: number, hp: number, holds: Extract<Piece, { kind: "crate" }>["holds"] = { kind: "allies", n: 8 }): Piece =>
  ({ kind: "crate", z, lo, hi, hp, holds });

describe("shooting", () => {
  it("takes count x fire rate x PELLET hit points a second off the target", () => {
    const sim = run([crate(12, -0.25, 0.25, 1000)]);
    step(sim, 1);
    expect(1000 - sim.items[0]!.hp).toBeCloseTo(5 * PELLET, 6);
    const faster = run([crate(12, -0.25, 0.25, 1000)], 0, new RunnerEconomy({ startCrowd: 5, fireRate: 5 }));
    step(faster, 1);
    expect(1000 - faster.items[0]!.hp).toBeCloseTo(15 * 1.5 * PELLET, 6);
    expect(faster.firepower).toBeCloseTo(15 * 1.5 * PELLET, 9);
  });

  it("breaks the first run's crate of 30 a little before the crowd reaches it", () => {
    const sim = run([crate(14, -0.25, 0.25, 30)]);
    let broke = 0;
    while (sim.items[0]!.live) { sim.frame(); broke = sim.time; }
    // 30 hit points at 24 a second is 1.25 s, from the moment the crate comes into range.
    const inRange = (14 - 2 - BASE_RANGE) / 7, reached = (14 - 2) / 7;
    expect(broke - inRange).toBeGreaterThan(1.2);
    expect(broke - inRange).toBeLessThan(1.3);
    expect(broke).toBeLessThan(reached);
    expect(sim.count).toBe(13);
  });

  it("reaches no further than its range", () => {
    const sim = run([crate(30, -0.25, 0.25, 1000)]);
    step(sim, 2);
    // After two seconds the crowd is 16 along and reaches to 26.
    expect(sim.items[0]!.hp).toBe(1000);
    step(sim, 1);
    expect(sim.items[0]!.hp).toBeLessThan(1000);
  });

  it("hits only the nearest target in the crowd's own width", () => {
    const sim = run([crate(8, 0.5, 0.9, 1000), crate(9, -0.25, 0.25, 1000), crate(10, -0.25, 0.25, 1000)]);
    step(sim, 0.5);
    const [beside, nearest, behind] = sim.items;
    expect(beside!.hp).toBe(1000);
    expect(nearest!.hp).toBeLessThan(1000);
    expect(behind!.hp).toBe(1000);
    expect(sim.shooting).toBe(nearest);
  });
});

describe("crates", () => {
  it("gives what it holds when it is broken", () => {
    const allies = run([crate(8, -0.25, 0.25, 10, { kind: "allies", n: 8 })]);
    step(allies, 1);
    expect(allies.items[0]!.ended).toBe("broken");
    expect(allies.count).toBe(13);
    const times = run([crate(8, -0.25, 0.25, 10, { kind: "times", n: 2 })]);
    step(times, 1);
    expect(times.count).toBe(10);
    const rate = run([crate(8, -0.25, 0.25, 10, { kind: "rate", n: 25 })]);
    step(rate, 1);
    expect(rate.rate).toBe(1.25);
    expect(rate.count).toBe(5);
    const coins = run([crate(8, -0.25, 0.25, 10, { kind: "coins", n: 12 })]);
    step(coins, 1);
    expect(coins.found).toBe(12);
  });

  it("is a wall when it is reached unbroken, and gives nothing", () => {
    const sim = run([crate(8, -0.25, 0.25, 1e6)]);
    step(sim, 2);
    expect(sim.outcome).toEqual({ won: false, reason: "Nobody got past the crate." });
    const beside = run([crate(8, -0.25, 0.25, 1e6)], 0.7);
    step(beside, 2);
    expect(beside.count).toBe(5);
    expect(beside.items[0]!.passed).toBe(true);
  });

  it("pays its coins on a win and keeps them on a loss", () => {
    const won = run([crate(8, -0.25, 0.25, 10, { kind: "coins", n: 12 })], 0, new RunnerEconomy({ coinMultiplier: 5 }), FAR, 30);
    step(won, 20);
    expect(won.outcome).toMatchObject({ won: true, coins: (30 + 12) * 2 });
    const lost = run([crate(8, -0.25, 0.25, 10, { kind: "coins", n: 12 }), crate(16, -0.25, 0.25, 1e6)]);
    step(lost, 20);
    expect(lost.outcome).toEqual({ won: false, reason: "Nobody got past the crate.", coins: 12 });
  });
});

describe("barrels", () => {
  it("takes the squads and crates within its radius, and they give nothing", () => {
    const sim = run([
      { kind: "barrel", z: 9, lo: -0.13, hi: 0.13, hp: 5 },
      crate(9, -0.8, -0.3, 1e5),
      { kind: "squad", z: 11, lo: 0.2, hi: 0.95, count: 500 },
      { kind: "squad", z: 20, lo: -0.95, hi: 0.95, count: 500 },
    ]);
    step(sim, 0.5);
    const [barrel, box, near, far] = sim.items;
    expect(barrel!.ended).toBe("burst");
    expect(box!.ended).toBe("blown");
    expect(near!.ended).toBe("blown");
    expect(far!.live).toBe(true);
    expect(sim.count).toBe(5);
  });

  it("costs the runners in its span when it is run into unshot", () => {
    const sim = run([{ kind: "barrel", z: 8, lo: -0.13, hi: 0.13, hp: 1e6 }]);
    step(sim, 2);
    expect(sim.count).toBeLessThan(5);
    expect(sim.items[0]!.live).toBe(true);
  });
});

describe("rival squads", () => {
  it("costs nothing once pellets have cleared it", () => {
    const sim = run([{ kind: "squad", z: 12, lo: -0.95, hi: 0.95, count: 20 }]);
    step(sim, 2);
    expect(sim.items[0]!.ended).toBe("cleared");
    expect(sim.count).toBe(5);
  });

  it("trades what is left of it against the crowd, divided by member power", () => {
    // It is reached on the first step, after one step of pellets: 4.6 less 0.4 shows as 5 rivals.
    const strong = run([{ kind: "squad", z: 2.05, lo: -0.95, hi: 0.95, count: 4.6 }], 0, new RunnerEconomy({ memberPower: 4 }));
    strong.frame();
    expect(strong.items[0]!.ended).toBe("traded");
    expect(strong.count).toBe(5 - Math.ceil(5 / 1.6));
    const plain = run([{ kind: "squad", z: 2.05, lo: -0.95, hi: 0.95, count: 2.6 }]);
    plain.frame();
    expect(plain.count).toBe(2);
    const wiped = run([{ kind: "squad", z: 2.05, lo: -0.95, hi: 0.95, count: 900 }]);
    wiped.frame();
    expect(wiped.outcome).toEqual({ won: false, reason: "The squad was bigger." });
  });

  it("trades nothing with a crowd that passes beside it", () => {
    const sim = run([{ kind: "squad", z: 6, lo: -0.95, hi: -0.08, count: 900 }], 0.5);
    step(sim, 1);
    expect(sim.count).toBe(5);
    expect(sim.items[0]!.live).toBe(true);
  });
});

describe("gates", () => {
  const pair = (left: GateOp, right: GateOp): Piece => ({ kind: "gates", z: 6, left, right });

  it("changes the fire rate and the range", () => {
    const fire = run([pair(GateOp.rate(25), GateOp.range(2))], -0.5);
    step(fire, 1);
    expect([fire.rate, fire.range, fire.count]).toEqual([1.25, BASE_RANGE, 5]);
    const reach = run([pair(GateOp.rate(25), GateOp.range(2))], 0.5);
    step(reach, 1);
    expect([reach.rate, reach.range]).toEqual([1, BASE_RANGE + 2]);
    const more = run([pair(GateOp.rate(50), GateOp.rate(-25))], -0.5);
    step(more, 1);
    expect(more.rate).toBe(1.5);
    const less = run([pair(GateOp.rate(50), GateOp.rate(-25)), { kind: "gates", z: 8, left: GateOp.add(1), right: GateOp.rate(-25) },
      { kind: "gates", z: 10, left: GateOp.add(1), right: GateOp.rate(-25) }, { kind: "gates", z: 12, left: GateOp.add(1), right: GateOp.rate(-25) }], 0.5);
    step(less, 2);
    // Four gates of -25% would leave nothing. The rate stops at a quarter.
    expect(less.rate).toBe(0.25);
  });

  it("applies and labels every operation", () => {
    expect(GateOp.apply(GateOp.add(5), 10)).toBe(15);
    expect(GateOp.apply(GateOp.subtract(12), 10)).toBe(0);
    expect(GateOp.apply(GateOp.multiply(3), 4)).toBe(12);
    expect(GateOp.apply(GateOp.divide(2), 9)).toBe(4);
    expect(GateOp.apply(GateOp.rate(25), 9)).toBe(9);
    expect(GateOp.isGood(GateOp.multiply(2)) && GateOp.isGood(GateOp.rate(25)) && GateOp.isGood(GateOp.range(2))).toBe(true);
    expect(GateOp.isGood(GateOp.divide(2)) || GateOp.isGood(GateOp.rate(-25))).toBe(false);
    expect([GateOp.rate(25), GateOp.rate(-25), GateOp.range(2)].map((op) => `${GateOp.caption(op)} ${GateOp.label(op)}`))
      .toEqual(["FIRE +25%", "FIRE -25%", "RANGE +2"]);
  });

  it("slides: the line between the two gates moves as a sine", () => {
    const slide = { amplitude: 0.4, period: 2, phase: 0 };
    expect(Gates.divider({ slide }, 0)).toBe(0);
    expect(Gates.divider({ slide }, 0.5)).toBeCloseTo(0.4, 12);
    expect(Gates.divider({ slide }, 1)).toBeCloseTo(0, 12);
    expect(Gates.divider({ slide }, 1.5)).toBeCloseTo(-0.4, 12);
    expect(Gates.divider({ slide }, 2.25)).toBeCloseTo(Gates.divider({ slide }, 0.25), 12);
    expect(Gates.divider({}, 0.7)).toBe(0);
    // The crowd is at 0.2. A pair reached when its line is at 0.4 gives the left gate, and one
    // reached when the line is at -0.4 gives the right.
    const left = run([{ kind: "gates", z: 2 + 7 * 0.5, left: GateOp.add(1), right: GateOp.add(100), slide }], 0.2);
    left.anchorX = 0.2;
    step(left, 1);
    expect(left.count).toBe(6);
    const right = run([{ kind: "gates", z: 2 + 7 * 1.5, left: GateOp.add(1), right: GateOp.add(100), slide }], 0.2);
    step(right, 2);
    expect(right.count).toBe(105);
  });
});

describe("hazards", () => {
  it("has a hammer that changes sides on its beat", () => {
    const hammer = { beat: 0.9, offset: 0 };
    expect([0, 0.89, 0.91, 1.79, 1.81, 2.71].map((t) => Hammer.side(hammer, t))).toEqual([-1, -1, 1, 1, -1, 1]);
    expect(Hammer.side({ beat: 0.9, offset: 0.9 }, 0)).toBe(1);
    // Reached at 0.5 s it lies on the left half: a crowd there is lost, and one on the right is not.
    const piece: Piece = { kind: "hammer", z: 2 + 7 * 0.5, beat: 0.9, offset: 0 };
    const under = run([piece], -0.5);
    under.anchorX = -0.5;
    step(under, 1);
    expect(under.outcome).toEqual({ won: false, reason: "Nobody made it past the hazard." });
    const clear = run([piece], 0.5);
    clear.anchorX = 0.5;
    step(clear, 1);
    expect(clear.count).toBe(5);
  });

  it("has a bridge that drops the runners outside its middle third", () => {
    const bridge: Piece = { kind: "bridge", z: 6, length: 10 };
    const off = run([bridge], 0.6);
    off.anchorX = 0.6;
    step(off, 1);
    expect(off.outcome).toEqual({ won: false, reason: "Everybody fell off the bridge." });
    const on = run([bridge], 0);
    step(on, 1);
    expect(on.count).toBe(5);
    expect(on.onBridge).toBe(true);
    // On the bridge the crowd cannot be steered over the edge.
    on.fly(hold(0.85));
    step(on, 0.5);
    expect(Math.abs(on.anchorX) + on.crowd.radius).toBeLessThanOrEqual(1 / 3 + 1e-9);
    step(on, 1.5);
    expect(on.onBridge).toBe(false);
    // A crowd wider than the bridge loses its edges even on the middle line.
    const wide = run([{ kind: "gates", z: 4, left: GateOp.multiply(30), right: GateOp.multiply(30) }, bridge]);
    step(wide, 1);
    expect(wide.count).toBe(150 - Crowd.losses(150, 0, { lo: -1 / 3, hi: 1 / 3 }, true));
    expect(wide.count).toBeLessThan(120);
  });

  it("still has the wall, the spikes and the blade", () => {
    const wall = run([{ kind: "wall", z: 6, lo: -0.3, hi: 0.3 }]);
    step(wall, 1);
    expect(wall.finished).toBe(true);
    const spikes = run([{ kind: "spikes", z: 6, lo: 0.4, hi: 0.72 }]);
    step(spikes, 1);
    expect(spikes.count).toBe(5);
    // The blade is on the middle line at time zero and half a turn later.
    const blade: Piece = { kind: "blade", z: 2.05, center: 0, halfWidth: 0.2, amplitude: 0.55, speed: 1.4 };
    const cut = run([blade]);
    cut.frame();
    expect(cut.finished).toBe(true);
  });
});

describe("the finale", () => {
  const boss = (hp: number, slam = -1): Finale => ({ type: "boss", hp, slam });

  it("warns of the slam for a second, lands it on one half, and then comes at the crowd", () => {
    const sim = run([], -0.5, RunnerEconomy.base, boss(1e6), 40);
    sim.anchorX = -0.5;
    while (sim.slam!.stage === "waiting") sim.frame();
    // The warning starts a second's run short of where the boss starts its charge.
    expect(sim.finaleAt - sim.front).toBeCloseTo(CHARGE_GAP + 7, 0);
    expect(sim.charging).toBe(false);
    const warned = sim.time;
    while (sim.slam!.stage === "warned") sim.frame();
    expect(sim.time - warned).toBeCloseTo(1, 1);
    // The crowd stood on the left half, where it landed.
    expect(sim.outcome).toEqual({ won: false, reason: "The slam took everyone." });
    const safe = run([], 0.5, RunnerEconomy.base, boss(1e6), 40);
    safe.anchorX = 0.5;
    while (safe.slam!.stage !== "landed") safe.frame();
    expect(safe.count).toBe(5);
    safe.frame();
    expect(safe.charging).toBe(true);
    expect(safe.finaleAt).toBeLessThan(40);
  });

  it("takes pellets on its bar as it comes into range, and fights with what is left", () => {
    // The crowd keeps to the left, clear of a slam on the right and still in front of the boss.
    const crowd = new RunnerEconomy({ startCrowd: 20 });
    const sim = run([], -0.4, crowd, boss(100, 1), 40);
    while (!sim.fighting && !sim.finished) sim.frame();
    // 45 runners take 216 a second, and the boss is in range for a third of a second.
    expect(sim.count).toBe(45);
    expect(sim.finaleDamage).toBeGreaterThan(30);
    expect(sim.finaleDamage).toBeLessThan(100);
    expect(sim.rivals).toBe(Math.ceil(100 - sim.finaleDamage - 1e-9));
    expect(sim.boss!.bar).toBeCloseTo(sim.rivals / 100, 1);
    const left = sim.rivals;
    step(sim, 10);
    expect(sim.outcome).toMatchObject({ won: true, score: FinaleFight.survivors(45, left, 1) });
    const tough = run([], -0.4, crowd, boss(5000, 1), 40);
    step(tough, 30);
    expect(tough.outcome).toEqual({ won: false, reason: "The boss was too much." });
    // A boss with few enough hit points is finished by pellets, with no fight.
    const soft = run([], -0.4, crowd, boss(20, 1), 40);
    step(soft, 30);
    expect(soft.fighting).toBe(false);
    expect(soft.outcome).toMatchObject({ won: true, score: 45 });
  });

  it("thins a rival crowd the same way, and fights it as before", () => {
    const sim = run([], 0, RunnerEconomy.base, { type: "crowd", count: 9 }, 40);
    while (!sim.fighting && !sim.finished) sim.frame();
    expect(sim.rivals).toBeLessThan(9);
    expect(sim.rivals).toBeGreaterThan(0);
    const left = sim.rivals;
    step(sim, 10);
    expect(sim.outcome).toMatchObject({ won: true, score: FinaleFight.survivors(5, left, 1) });
  });

  it("measures a crowd against a finale that cannot be worn down", () => {
    const sim = new RunnerSim(trackOf([], boss(1, 1), { finaleZ: 40 }), RunnerEconomy.base, null, { view: false, probe: true });
    sim.fly(hold(-0.4));
    step(sim, 30);
    expect(sim.outcome).toMatchObject({ won: true, score: 5 });
    expect(sim.finaleDamage).toBeGreaterThan(0);
  });
});

describe("a run with a screen and a run without", () => {
  it("end the same way", () => {
    for (let level = 0; level < 12; level++) {
      const track = RunnerGenerator.makeTrack(level), economy = RunnerEconomy.reference(level);
      const blind = playTrack(track, economy, new Skilled(track));
      const seen = new RunnerSim(track, economy, () => {});
      seen.fly(new Skilled(track));
      for (let i = 0; i < 60 * 60 && !seen.finished; i++) seen.frame();
      expect(seen.outcome, `run ${level + 1}`).toEqual(blind.outcome);
      expect(seen.time, `run ${level + 1}`).toBe(blind.time);
    }
  });
});
