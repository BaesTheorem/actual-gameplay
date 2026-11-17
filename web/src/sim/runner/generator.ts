// Deterministic tracks from the run number: the same run is the same track on every device.
//
// A track is laid out from a seed, sized for the crowd a good player would have at each point,
// and then played before it is accepted. The skilled bot has to win it and the three lazy bots
// (never steer, keep left, pick sides at random) all have to lose it, at the upgrades the
// economy's reference player owns by that run (none in the first world). A layout that fails is
// thrown away and the run's next seed is tried, FAIR_TRIES times at most; if none passes, the
// best of them is used.
import { LAZY, Skilled, lazyPilot, playTrack } from "./bots";
import { Crowd } from "./crowd";
import { BASE_CROWD, RunnerEconomy } from "./economy";
import { SeededRNG } from "./rng";
import { BASE_RANGE, CHARGE_GAP, PELLET, SLAM_TELEGRAPH } from "./sim";
import {
  BRIDGE_HALF, GateOp, isFair, type Fairness, type Finale, type Piece, type Reward, type Slide, type Stats, type Track,
} from "./track";
import { isBossRun, worldOf, worldPieces, type WorldPieces } from "./worlds";

const MASK = (1n << 64n) - 1n;

// MARK: tuning

/// Seeds tried for a run before the best layout so far is taken as it is.
export const FAIR_TRIES = 12;
/// Where the first segment stands, and how far apart segments are, in lane units.
export const START_Z = 14, SPACING = 8;
/// From the last segment to the finale line: the finale charges two lane units after the last
/// segment is behind the crowd. A boss stands further off, by the road the crowd covers while
/// it warns of its slam.
export const FINALE_GAP = CHARGE_GAP + 2;
export const BRIDGE_LENGTH = 10;
/// The share of segments that are gate pairs, at least.
const GATE_SHARE = 0.4;
/// A sliding pair's line swings this far each way, and takes between these many seconds a swing.
const SLIDE_AMPLITUDE = 0.4, SLIDE_PERIOD = [2.2, 3.4] as const;
/// A hammer changes sides this often, in seconds.
export const HAMMER_BEAT = 0.9;
/// A run offers to multiply the crowd this many times at most, gates and crates together.
/// Without the cap one lucky track ends with a crowd of ten thousand and numbers nobody can read.
export const MAX_MULTIPLIES = 2;
/// An add gate, a subtract gate and a crate of allies each carry a share of the crowd they are
/// sized for on top of their fixed number, so they still matter when the crowd is in the hundreds.
/// An add or a subtract takes up to this share; allies take between the two, or the big share
/// for a crate that is guarded.
const ADD_SHARE = 0.15, SUBTRACT_SHARE = 0.15, ALLIES_SHARE = [0.1, 0.25] as const, BIG_ALLIES_SHARE = 0.35;
/// The first crate of the first run: 30 hit points and eight allies, straight ahead.
export const FIRST_CRATE = { hp: 30, allies: 8 };
/// The finale's strength as a share of what the skilled bot brings to it: its crowd times member
/// power, plus what its pellets do on the way in. A rival crowd starts at the first number and
/// gains the second each run up to the cap; a boss is always the last.
const CROWD_RATIO = 0.6, CROWD_RATIO_STEP = 0.02, CROWD_RATIO_RUNS = 12, BOSS_RATIO = 0.75;

/// The three lanes a crate or a squad can stand in, and the widths that go across more of the road.
const LANES: [number, number][] = [[-0.8, -0.3], [-0.25, 0.25], [0.3, 0.8]];
const THIRDS: [number, number][] = [[-0.9, -0.32], [-0.29, 0.29], [0.32, 0.9]];
const HALVES: [number, number][] = [[-0.95, -0.08], [0.08, 0.95]];
const FULL: [number, number] = [-0.95, 0.95];

type Beat = "gates" | "crates" | "squad" | "barrel" | "wall" | "spikes" | "blade" | "hammer" | "bridge";
const HAZARDS: Beat[] = ["wall", "spikes", "blade", "hammer", "bridge"];

/// How often each kind of segment comes up, for the pieces a world has.
const beatWeights = (has: WorldPieces, world: number): [Beat, number][] => [
  ["gates", 40],
  ["crates", world === 0 ? 34 : 20],
  ["squad", has.squads ? 14 : 0],
  ["barrel", has.barrels ? 9 : 0],
  ["wall", has.walls ? 6 : 0],
  ["spikes", has.spikes ? 5 : 0],
  ["blade", has.blades ? 5 : 0],
  ["hammer", has.hammers ? 6 : 0],
  ["bridge", has.bridges ? 6 : 0],
];

/// One of a weighted list, by one draw.
const pick = <T>(rng: SeededRNG, weighted: [T, number][]): T => {
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.unit() * total;
  for (const [value, weight] of weighted) {
    if (weight <= 0) continue;
    roll -= weight;
    if (roll < 0) return value;
  }
  return weighted.find(([, weight]) => weight > 0)![0];
};

/// Hit points as a number that reads at a glance: fives up to 100, tens up to 1000, fifties after.
const round = (hp: number): number => {
  const step = hp < 100 ? 5 : hp < 1000 ? 10 : 50;
  return Math.max(step, Math.round(hp / step) * step);
};

/// What the bot goes by: firepower times count, with range counted in.
const worth = (stats: Stats): number => stats.count * stats.count * stats.rate * stats.range;

const randomOp = (rng: SeededRNG, tier: number, layout: Layout, has: WorldPieces, forceGood = false): GateOp => {
  const par = layout.par, multiply = layout.multiplies < MAX_MULTIPLIES;
  const kind = pick<string>(rng, forceGood
    ? [["add", 55], ["multiply", multiply ? 25 : 0], ["rateUp", has.rateGates ? 14 : 0], ["range", has.rangeGates ? 6 : 0]]
    : [["add", 34], ["subtract", 22], ["multiply", multiply ? 16 : 0], ["divide", 13], ["rateUp", has.rateGates ? 8 : 0],
      ["rateDown", has.rateGates ? 4 : 0], ["range", has.rangeGates ? 3 : 0]]);
  switch (kind) {
    // Gates grow with the crowd they are for, so an add still matters late in a long run.
    case "add": return GateOp.add(rng.int(3 + 2 * tier, 10 + 5 * tier) + Math.round(par.count * ADD_SHARE * rng.unit()));
    case "subtract": return GateOp.subtract(rng.int(2 + tier, 6 + 3 * tier) + Math.round(par.count * SUBTRACT_SHARE * rng.unit()));
    case "multiply": return GateOp.multiply(tier >= 3 && rng.unit() < 0.3 ? 3 : 2);
    case "divide": return GateOp.divide(rng.unit() < 0.7 ? 2 : 3);
    case "rateUp": return GateOp.rate(rng.unit() < 0.7 ? 25 : 50);
    case "rateDown": return GateOp.rate(-25);
    default: return GateOp.range(2);
  }
};

const randomReward = (rng: SeededRNG, layout: Layout, has: WorldPieces, level: number, big = false): Reward => {
  const par = layout.par, times = layout.multiplies < MAX_MULTIPLIES;
  const kind = pick<string>(rng, big
    ? [["allies", 70], ["times", times ? 30 : 0]]
    : [["allies", 50], ["times", times ? 12 : 0], ["rate", has.rateCrates ? 20 : 0], ["coins", 18]]);
  switch (kind) {
    case "allies": return { kind: "allies", n: rng.int(4, 8) + Math.round(par.count * (big ? BIG_ALLIES_SHARE : ALLIES_SHARE[0] + (ALLIES_SHARE[1] - ALLIES_SHARE[0]) * rng.unit())) };
    case "times": return { kind: "times", n: 2 };
    case "rate": return { kind: "rate", n: 25 };
    default: return { kind: "coins", n: Math.max(5, Math.round((RunnerEconomy.purse(level) * (0.15 + 0.15 * rng.unit())) / 5) * 5) };
  }
};

/// How much of the time between two segments the skilled crowd needs to break a crate, by what it holds.
const toughness = (rng: SeededRNG, reward: Reward): number => {
  switch (reward.kind) {
    case "allies": return 0.55 + 0.35 * rng.unit();
    case "times": return 0.95 + 0.2 * rng.unit();
    case "rate": return 0.6 + 0.3 * rng.unit();
    case "coins": return 0.45 + 0.3 * rng.unit();
  }
};

const applyReward = (reward: Reward, stats: Stats): Stats => {
  if (reward.kind === "allies") return { ...stats, count: stats.count + reward.n };
  if (reward.kind === "times") return { ...stats, count: stats.count * reward.n };
  if (reward.kind === "rate") return { ...stats, rate: stats.rate + reward.n / 100 };
  return stats;
};

/// A layout as it is built: the pieces so far, where the next segment goes, and the crowd a
/// good player would have by there. That crowd sizes everything: a crate's hit points and a
/// squad's count are shares of what its pellets do in the time between two segments.
interface Layout {
  pieces: Piece[];
  z: number;
  par: Stats;
  /// Hit points the par crowd's pellets take off a target between one segment and the next.
  volley: number;
  /// How many times the run has offered to multiply the crowd so far.
  multiplies: number;
  betterSide: number;
  sameSideRun: number;
}

const layGates = (rng: SeededRNG, layout: Layout, tier: number, has: WorldPieces) => {
  const par = layout.par;
  let left = randomOp(rng, tier, layout, has);
  let right = randomOp(rng, tier, layout, has, !GateOp.isGood(left));
  let tries = 0;
  while (GateOp.equals(right, left) && tries < 20) {
    right = randomOp(rng, tier, layout, has, !GateOp.isGood(left));
    tries += 1;
  }
  if (left.kind === "multiply" || right.kind === "multiply") layout.multiplies += 1;
  // Never let the better gate sit on the same side three times running: a player hugging one
  // wall should not stumble through a run.
  let side = worth(GateOp.applyTo(right, par)) >= worth(GateOp.applyTo(left, par)) ? 1 : -1;
  if (side === layout.betterSide && layout.sameSideRun >= 2) {
    [left, right] = [right, left];
    side = -side;
  }
  layout.sameSideRun = side === layout.betterSide ? layout.sameSideRun + 1 : 1;
  layout.betterSide = side;
  const a = GateOp.applyTo(left, par), b = GateOp.applyTo(right, par);
  layout.par = worth(a) >= worth(b) ? a : b;
  let slide: Slide | undefined;
  if (has.slidingGates && rng.unit() < 0.35) {
    slide = { amplitude: SLIDE_AMPLITUDE, period: SLIDE_PERIOD[0] + (SLIDE_PERIOD[1] - SLIDE_PERIOD[0]) * rng.unit(), phase: rng.unit() };
  }
  layout.pieces.push(slide ? { kind: "gates", z: layout.z, left, right, slide } : { kind: "gates", z: layout.z, left, right });
};

const layCrates = (rng: SeededRNG, layout: Layout, has: WorldPieces, level: number) => {
  const shape = pick<string>(rng, [["single", 40], ["pair", 40], ["row", 20]]);
  const spans = shape === "row" ? THIRDS : LANES;
  // Which lanes hold a crate: one, two, or all three.
  const first = rng.int(0, 2), skip = rng.int(0, 2);
  const lanes = shape === "single" ? [first] : shape === "pair" ? [0, 1, 2].filter((lane) => lane !== skip) : [0, 1, 2];
  const crates: { reward: Reward; tough: number }[] = [];
  for (const lane of lanes) {
    let reward = randomReward(rng, layout, has, level);
    // Two crates side by side hold different things, so there is something to choose.
    for (let tries = 0; tries < 8 && crates.some((crate) => crate.reward.kind === reward.kind); tries++) {
      reward = randomReward(rng, layout, has, level);
    }
    // A row has to be shot through, so each crate in it is lighter.
    const tough = toughness(rng, reward) * (shape === "row" ? 0.6 : 1);
    crates.push({ reward, tough });
    layout.pieces.push({ kind: "crate", z: layout.z, lo: spans[lane]![0], hi: spans[lane]![1], hp: round(tough * layout.volley), holds: reward });
  }
  if (crates.some((crate) => crate.reward.kind === "times")) layout.multiplies += 1;
  // The good player breaks the one that is worth most.
  let best = layout.par;
  for (const crate of crates) {
    const after = applyReward(crate.reward, layout.par);
    if (worth(after) > worth(best)) best = after;
  }
  layout.par = best;
};

const laySquad = (rng: SeededRNG, layout: Layout, has: WorldPieces, level: number) => {
  const shape = pick<string>(rng, [["half", 45], ["full", 35], ["guard", 20]]);
  const z = layout.z, volley = layout.volley;
  if (shape === "half") {
    // Half the road: go round it, or stand in front of it and shoot.
    const [lo, hi] = HALVES[rng.int(0, 1)]!;
    layout.pieces.push({ kind: "squad", z, lo, hi, count: Math.max(6, Math.round(volley * (0.7 + 0.6 * rng.unit()))) });
  } else if (shape === "full") {
    // The whole road: there is no way round, so it is a test of firepower.
    layout.pieces.push({ kind: "squad", z, lo: FULL[0], hi: FULL[1], count: Math.max(6, Math.round(volley * (0.3 + 0.3 * rng.unit()))) });
  } else {
    // A small squad in front of a crate that is worth the trouble.
    const [lo, hi] = LANES[rng.int(0, 2)]!;
    const reward = randomReward(rng, layout, has, level, true);
    if (reward.kind === "times") layout.multiplies += 1;
    layout.pieces.push({ kind: "squad", z, lo: lo - 0.08, hi: hi + 0.08, count: Math.max(4, Math.round(volley * (0.25 + 0.15 * rng.unit()))) });
    layout.pieces.push({ kind: "crate", z: z + 2.5, lo, hi, hp: round(volley * (0.35 + 0.2 * rng.unit())), holds: reward });
    layout.par = applyReward(reward, layout.par);
  }
};

const layBarrel = (rng: SeededRNG, layout: Layout, has: WorldPieces, level: number) => {
  const z = layout.z, volley = layout.volley;
  const hp = round(volley * 0.15);
  if (rng.unit() < 0.6) {
    // A barrel in the middle with a squad on each side just behind it: one blast clears the road.
    layout.pieces.push({ kind: "barrel", z, lo: -0.13, hi: 0.13, hp });
    for (const [lo, hi] of [[-0.95, -0.2], [0.2, 0.95]] as const) {
      layout.pieces.push({ kind: "squad", z: z + 2, lo, hi, count: Math.max(8, Math.round(volley * (0.8 + 0.5 * rng.unit()))) });
    }
  } else {
    // A barrel on one side, a crate on the other, and a squad across the road behind both. The
    // blast clears the squad and burns the crate; the crate has to be broken first to keep it.
    const side = rng.unit() < 0.5 ? -1 : 1;
    const reward = randomReward(rng, layout, has, level, true);
    if (reward.kind === "times") layout.multiplies += 1;
    const crate = side < 0 ? LANES[2]! : LANES[0]!;
    layout.pieces.push({ kind: "barrel", z, lo: side * 0.55 - 0.13, hi: side * 0.55 + 0.13, hp });
    layout.pieces.push({ kind: "crate", z, lo: crate[0], hi: crate[1], hp: round(volley * (0.4 + 0.2 * rng.unit())), holds: reward });
    layout.pieces.push({ kind: "squad", z: z + 3, lo: FULL[0], hi: FULL[1], count: Math.max(8, Math.round(volley * (0.9 + 0.4 * rng.unit()))) });
  }
};

const layHazard = (rng: SeededRNG, layout: Layout, beat: Beat, tier: number) => {
  const z = layout.z;
  if (beat === "wall") {
    const width = 0.5 + 0.08 * tier, center = rng.unit() - 0.5;
    layout.pieces.push({ kind: "wall", z, lo: center - width / 2, hi: center + width / 2 });
  } else if (beat === "spikes") {
    const center = rng.unit() * 1.2 - 0.6;
    layout.pieces.push({ kind: "spikes", z, lo: center - 0.16, hi: center + 0.16 });
  } else if (beat === "blade") {
    layout.pieces.push({ kind: "blade", z, center: 0, halfWidth: 0.18 + 0.02 * tier, amplitude: 0.55, speed: 1.4 + 0.2 * tier });
  } else if (beat === "hammer") {
    layout.pieces.push({ kind: "hammer", z, beat: HAMMER_BEAT, offset: 2 * HAMMER_BEAT * rng.unit() });
  } else {
    layout.pieces.push({ kind: "bridge", z, length: BRIDGE_LENGTH });
    // A crowd wider than the bridge loses its edges however well it is steered.
    const par = layout.par;
    layout.par = { ...par, count: par.count - Crowd.losses(par.count, 0, { lo: -BRIDGE_HALF, hi: BRIDGE_HALF }, true) };
    layout.z += BRIDGE_LENGTH - 2;
  }
};

export const RunnerGenerator = {
  /// How many runs the replay suite drives.
  replayLevels: 10,

  /// The crowd a run starts with before upgrades.
  baseCrowd: BASE_CROWD,

  /// The seed of a run's layout. `attempt` is 0 for the first layout tried.
  seed: (level: number, attempt = 0): bigint => (1_000_003n * BigInt(level + 1) + 7_919n * BigInt(attempt)) & MASK,

  speed: (level: number): number => Math.min(7 + 0.15 * level, 12),

  /// How many segments a run has: seven at first, one more every third run, sixteen at most.
  segments: (level: number): number => Math.min(7 + Math.trunc(level / 3), 16),

  /// The finale's strength as a share of what the skilled bot brings to it.
  ratio: (level: number): number =>
    isBossRun(level) ? BOSS_RATIO : CROWD_RATIO + CROWD_RATIO_STEP * Math.min(level, CROWD_RATIO_RUNS),

  /// One layout for a run, with a finale too big to matter. `reference` is the upgrades it is sized for.
  layout(level: number, attempt: number, reference: RunnerEconomy): { pieces: Piece[]; finaleZ: number; slam: number } {
    const rng = new SeededRNG(RunnerGenerator.seed(level, attempt));
    const world = worldOf(level), has = worldPieces(world.index), speed = RunnerGenerator.speed(level);
    const count = RunnerGenerator.segments(level), tier = Math.min(world.index, 4);
    const layout: Layout = {
      pieces: [], z: START_Z, volley: 0, multiplies: 0, betterSide: 0, sameSideRun: 0,
      par: { count: reference.startCrowd, rate: reference.fireRate, range: BASE_RANGE },
    };
    const weights = beatWeights(has, world.index);
    let gates = 0, bridges = 0, last: Beat | null = null;
    for (let i = 0; i < count; i++) {
      const left = count - i, needed = Math.ceil(GATE_SHARE * count) - gates;
      let beat: Beat;
      if (level === 0 && i === 0) beat = "crates";
      else if (i === 0 || needed >= left) beat = "gates";
      else {
        beat = pick(rng, weights);
        // Nothing that kills comes twice running, the run does not end on one, and two bridges are enough.
        const hazard = HAZARDS.includes(beat);
        if (hazard && (i === count - 1 || (last !== null && HAZARDS.includes(last)) || (beat === "bridge" && bridges >= 2))) beat = "gates";
      }
      layout.volley = layout.par.count * layout.par.rate * PELLET * (SPACING / speed);
      if (beat === "gates") { layGates(rng, layout, tier, has); gates += 1; }
      else if (beat === "crates" && level === 0 && i === 0) {
        // The first thing a new player meets: a crate straight ahead that breaks just before the crowd gets there.
        const reward: Reward = { kind: "allies", n: FIRST_CRATE.allies };
        layout.pieces.push({ kind: "crate", z: layout.z, lo: LANES[1]![0], hi: LANES[1]![1], hp: FIRST_CRATE.hp, holds: reward });
        layout.par = applyReward(reward, layout.par);
      }
      else if (beat === "crates") layCrates(rng, layout, has, level);
      else if (beat === "squad") laySquad(rng, layout, has, level);
      else if (beat === "barrel") layBarrel(rng, layout, has, level);
      else { layHazard(rng, layout, beat, tier); if (beat === "bridge") bridges += 1; }
      last = beat;
      layout.z += SPACING;
    }
    // The finale stands past the last segment. A boss needs room to warn of its slam and land it.
    const lastZ = layout.z - SPACING;
    const room = isBossRun(level) ? Math.ceil(speed * SLAM_TELEGRAPH) : 0;
    return { pieces: layout.pieces, finaleZ: lastZ + FINALE_GAP + room, slam: rng.unit() < 0.5 ? -1 : 1 };
  },

  /// One candidate track: a layout, the finale sized from the skilled bot's own run of it, and
  /// what the four bots then made of it.
  candidate(level: number, attempt: number, reference: RunnerEconomy): Track {
    const { pieces, finaleZ, slam } = RunnerGenerator.layout(level, attempt, reference);
    const boss = isBossRun(level);
    const sized = (strength: number): Finale => (boss ? { type: "boss", hp: strength, slam } : { type: "crowd", count: strength });
    const track: Track = {
      level, pieces, finaleZ, speed: RunnerGenerator.speed(level), attempt,
      finale: sized(1), fairness: { skilled: false, lazy: [] }, par: 0,
    };
    // The skilled bot runs the layout up to the fight against a finale that cannot be worn
    // down. The finale is then a share of what it brought: its crowd times member power, plus
    // what its pellets did on the way in.
    const probe = playTrack(track, reference, new Skilled(track), { probe: true });
    if (probe.outcome?.won !== true) return track;
    const brought = probe.crowd.count * reference.memberPower + probe.finaleDamage;
    track.finale = sized(Math.max(1, Math.floor(RunnerGenerator.ratio(level) * brought)));
    track.fairness = RunnerGenerator.judge(track, reference);
    return track;
  },

  /// Play a track with the skilled bot and the three lazy ones, and say who won. It also notes
  /// the skilled bot's surviving crowd on the track as its par.
  judge(track: Track, reference: RunnerEconomy): Fairness {
    const skilled = playTrack(track, reference, new Skilled(track)).outcome;
    track.par = skilled?.won === true ? skilled.score : 0;
    const lazy = LAZY.filter((name) => playTrack(track, reference, lazyPilot(name, track)).outcome?.won === true);
    return { skilled: skilled?.won === true, lazy };
  },

  /// The track for a run. `reference` is the upgrades the fairness check assumes, which are the
  /// reference player's for that run unless a tool asks for others.
  makeTrack(level: number, reference: RunnerEconomy = RunnerEconomy.reference(level)): Track {
    let best: Track | null = null, bestScore = -Infinity;
    for (let attempt = 0; attempt < FAIR_TRIES; attempt++) {
      const track = RunnerGenerator.candidate(level, attempt, reference);
      if (isFair(track)) return track;
      // The best of the unfair ones: one the skilled bot wins, with the fewest lazy winners.
      const score = (track.fairness.skilled ? 10 : 0) - track.fairness.lazy.length;
      if (score > bestScore) { best = track; bestScore = score; }
    }
    return best!;
  },
};
