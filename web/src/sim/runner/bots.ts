// The players that are not people. The generator plays every track with them before it accepts
// it, the suite replays and audits runs with them, and the economy script prices the upgrades
// with them. All of them steer the real simulation and nothing else.
//
// The skilled bot reads the next two segments of the road. For each lane it could hold it works
// out, in plain arithmetic, what its pellets would break in the time there is and what the
// crowd would be after: it takes the gate that leaves it with more firepower times count, aims
// at a crate when the crate will break before the crowd reaches it, shoots a barrel when the
// blast is worth more than what it burns, dodges hazards, and steps off a boss's slam.
// The three lazy bots never look: one never steers, one keeps left, one picks a side at random
// for every segment.
import { STEP } from "../sk";
import { Crowd } from "./crowd";
import { RunnerEconomy } from "./economy";
import { SeededRNG } from "./rng";
import { BLAST_RADIUS, PELLET, ROAD_HALF, RunnerSim, STEER_LIMIT, type Pilot, type SimOptions } from "./sim";
import { BRIDGE_HALF, GateOp, Gates, Hazard, type Piece, type Track } from "./track";

/// Pieces whose places along the road are this close belong to one segment.
export const SEGMENT_GAP = 5;

/// Where each segment starts in a track's pieces, and the segment each piece is in.
export const segmentsOf = (pieces: Piece[]): { of: number[]; end: number[] } => {
  const of: number[] = [], end: number[] = [];
  let startZ = -Infinity;
  pieces.forEach((piece, i) => {
    if (i === 0 || piece.z - startZ > SEGMENT_GAP) {
      if (i > 0) end.push(i);
      startZ = piece.z;
    }
    // A bridge is as long as it is: nothing on it or just past it is in its segment.
    if (piece.kind === "bridge") startZ = -Infinity;
    of.push(end.length);
  });
  if (pieces.length > 0) end.push(pieces.length);
  return { of, end };
};

// MARK: the lazy bots

export type LazyName = "straight" | "left" | "random";
export const LAZY: LazyName[] = ["straight", "left", "random"];

/// The lane a lazy bot keeps when it keeps one: half way to the edge.
const LAZY_LANE = 0.5;

/// Picks left or right at random for each segment and holds it until the next.
class Wanderer implements Pilot {
  private readonly picks: number[];
  private readonly of: number[];

  constructor(track: Track, seed: number) {
    const segments = segmentsOf(track.pieces), rng = new SeededRNG(seed);
    this.of = segments.of;
    this.picks = segments.end.map(() => (rng.unit() < 0.5 ? -LAZY_LANE : LAZY_LANE));
  }

  steer(sim: RunnerSim): number {
    if (this.picks.length === 0) return 0;
    return this.picks[this.of[Math.min(sim.next, this.of.length - 1)]!]!;
  }
}

export const lazyPilot = (name: LazyName, track: Track): Pilot =>
  name === "straight" ? { steer: () => 0 } : name === "left" ? { steer: () => -LAZY_LANE } : new Wanderer(track, 7);

// MARK: the skilled bot

/// How often a player errs, for the economy's reference player: the share of gate pairs at
/// which it takes the worse gate, the share of hazards it does not see coming, and the seed
/// that decides which ones.
export interface Sloppiness { gate: number; dodge: number; seed: number | bigint }

/// The bot keeps this far from the line between two gates, and heads this far into a side.
const GATE_MARGIN = 0.12, GATE_LANE = 0.45;
/// It keeps this far from the edge of anything that kills.
const DODGE_MARGIN = 0.06;
/// It thinks again this many steps after it last did, and at once when the road or the crowd changes.
const THINK_EVERY = 20;
/// Two lanes whose results are this close are the same to it, and it keeps the nearer one.
const NEAR_BEST = 0.995;
/// What a coin is worth beside firepower times count: enough to break a tie, never to lose a runner.
const COIN_WEIGHT = 0.0005;
/// Seconds it allows itself to change lanes between two segments.
const SHIFT_TIME = 0.2;

export class Skilled implements Pilot {
  private readonly of: number[];
  private readonly end: number[];
  /// Gate pairs at which this player takes the worse gate, and hazards it does not see.
  private readonly wrongGate: boolean[];
  private readonly blind: boolean[];
  private readonly blindSlam: boolean;

  // What a lane would leave the crowd with, as the arithmetic runs: the crowd, its rate and
  // range, coins found, seconds from now, and the hit points of everything in the two segments.
  private c = 0;
  private rate = 0;
  private range = 0;
  private coins = 0;
  private t = 0;
  /// The pieces the arithmetic knows about just now: from the next one to the end of the second segment.
  private windowEnd = 0;
  private readonly hp: Float64Array;
  private readonly alive: Uint8Array;
  private readonly hpKept: Float64Array;
  private readonly aliveKept: Uint8Array;

  private lane = 0;
  private thoughtAt = -1;
  private seenNext = -1;
  private seenCount = -1;
  private seenRate = -1;
  private seenFound = -1;
  private seenShooting: unknown = null;
  private seenStage = "";
  private readonly lanes1: number[] = [];
  private readonly lanes2: number[] = [];
  private readonly scores: number[] = [];
  private readonly blocked: number[] = [];

  constructor(track: Track, sloppy: Sloppiness | null = null) {
    const segments = segmentsOf(track.pieces), n = track.pieces.length;
    this.of = segments.of;
    this.end = segments.end;
    this.hp = new Float64Array(n);
    this.alive = new Uint8Array(n);
    this.hpKept = new Float64Array(n);
    this.aliveKept = new Uint8Array(n);
    this.wrongGate = new Array<boolean>(n).fill(false);
    this.blind = new Array<boolean>(n).fill(false);
    let blindSlam = false;
    if (sloppy) {
      // One draw for each gate pair and each hazard, in road order, and one for the slam. They
      // are made here, before the run, so the same seed errs at the same places whatever the
      // upgrades are.
      const rng = new SeededRNG(sloppy.seed);
      track.pieces.forEach((piece, i) => {
        if (piece.kind === "gates") this.wrongGate[i] = rng.unit() < sloppy.gate;
        else if (piece.kind !== "crate" && piece.kind !== "barrel" && piece.kind !== "squad") this.blind[i] = rng.unit() < sloppy.dodge;
      });
      blindSlam = rng.unit() < sloppy.dodge;
    }
    this.blindSlam = blindSlam;
  }

  steer(sim: RunnerSim): number {
    const step = Math.round(sim.time / STEP), stage = sim.slam ? sim.slam.stage : "";
    // It thinks when something it planned around has changed, and every so often besides.
    if (
      step - this.thoughtAt >= THINK_EVERY || sim.next !== this.seenNext || sim.crowd.count !== this.seenCount
      || sim.rate !== this.seenRate || sim.found !== this.seenFound || sim.shooting !== this.seenShooting || stage !== this.seenStage
    ) {
      this.thoughtAt = step;
      this.seenNext = sim.next;
      this.seenCount = sim.crowd.count;
      this.seenRate = sim.rate;
      this.seenFound = sim.found;
      this.seenShooting = sim.shooting;
      this.seenStage = stage;
      this.lane = this.think(sim);
    }
    return this.lane;
  }

  private think(sim: RunnerSim): number {
    const slam = sim.slam, r = sim.crowd.radius;
    // A slam is warned of for a second. The bot steps just off that half, which keeps the boss
    // in its line of fire.
    if (slam && slam.stage === "warned" && !this.blindSlam) return -slam.side * Math.min(STEER_LIMIT, r + DODGE_MARGIN);
    const first = sim.next, n = sim.items.length;
    // Past the last piece the finale is straight ahead.
    if (first >= n) return 0;
    const b1 = this.end[this.of[first]!]!, b2 = b1 < n ? this.end[this.of[b1]!]! : b1;
    const lanes1 = this.lanes1, lanes2 = this.lanes2, scores = this.scores;
    this.findLanes(sim, first, b1, lanes1);
    this.findLanes(sim, b1, b2, lanes2);
    // A lane for the next segment is worth taking now if this segment allows it.
    for (const x of lanes2) addLane(lanes1, x);
    addLane(lanes1, sim.targetX);

    // First, what each lane leaves the crowd with after this segment.
    scores.length = 0;
    let best = -Infinity;
    for (const x of lanes1) {
      this.begin(sim, first, b2);
      this.hold(sim, x, first, b1, b2, 0);
      const score = this.worth();
      scores.push(score);
      if (score > best) best = score;
    }
    // A player who errs at this gate pair takes the worse gate, by its own reckoning.
    const gate = sim.items[first]!;
    if (gate.piece.kind === "gates" && this.wrongGate[first]) {
      const divider = Gates.divider(gate.piece, sim.time + (gate.z - sim.front) / sim.track.speed);
      let left = -Infinity, right = -Infinity;
      lanes1.forEach((x, i) => { if (x < divider) left = Math.max(left, scores[i]!); else right = Math.max(right, scores[i]!); });
      if (left > -Infinity && right > -Infinity && left !== right) {
        const worseIsLeft = left < right;
        best = worseIsLeft ? left : right;
        lanes1.forEach((x, i) => { if ((x < divider) !== worseIsLeft) scores[i] = -Infinity; });
      }
    }

    // Then, among the lanes that do as well as the best one, what each leaves after the segment
    // that follows, with the best lane there.
    const floor = best >= 0 ? best * NEAR_BEST : best;
    let bestAfter = -Infinity;
    lanes1.forEach((x, i) => {
      if (scores[i]! < floor) { scores[i] = -Infinity; return; }
      if (b2 > b1) {
        this.begin(sim, first, b2);
        this.hold(sim, x, first, b1, b2, 0);
        const after = this.keep(first, b2);
        // Staying in lane is always one of the choices.
        this.hold(sim, x, b1, b2, b2, 0);
        let score = this.worth();
        for (const x2 of lanes2) {
          if (Math.abs(x2 - x) <= 0.05) continue;
          this.restore(first, b2, after);
          this.hold(sim, x2, b1, b2, b2, SHIFT_TIME);
          score = Math.max(score, this.worth());
        }
        scores[i] = score;
      }
      if (scores[i]! > bestAfter) bestAfter = scores[i]!;
    });
    // Of the lanes that are as good as each other, the one nearest to where the crowd already
    // heads. The last segment has the finale after it, which stands in the middle of the road.
    const enough = bestAfter >= 0 ? bestAfter * NEAR_BEST : bestAfter;
    let pick = sim.targetX, pickDistance = Infinity;
    lanes1.forEach((x, i) => {
      if (scores[i]! < enough) return;
      const distance = b2 > b1 ? Math.abs(x - sim.targetX) : Math.abs(x) + 0.01 * Math.abs(x - sim.targetX);
      if (distance < pickDistance) { pick = x; pickDistance = distance; }
    });
    return pick;
  }

  /// Firepower times count, with range and coins counted in. A crowd that is gone is worth nothing.
  private worth(): number {
    if (this.c <= 0) return -1;
    return this.c * this.c * this.rate * this.range * (1 + this.coins * COIN_WEIGHT);
  }

  // MARK: lanes

  /// The lanes worth trying for pieces `from` to `to`: each side of a gate pair, the middle of
  /// each thing that can be shot, and the room between the things that kill.
  private findLanes(sim: RunnerSim, from: number, to: number, lanes: number[]) {
    lanes.length = 0;
    if (to <= from) return;
    const items = sim.items, r = sim.crowd.radius, blocked = this.blocked;
    blocked.length = 0;
    for (let i = from; i < to; i++) {
      const item = items[i]!, piece = item.piece;
      const at = sim.time + (item.z - sim.front) / sim.track.speed;
      if (piece.kind === "gates") {
        const divider = Gates.divider(piece, at);
        const left = Math.min(divider - GATE_MARGIN, Math.max(-STEER_LIMIT, divider - GATE_LANE));
        const right = Math.max(divider + GATE_MARGIN, Math.min(STEER_LIMIT, divider + GATE_LANE));
        if (left >= -STEER_LIMIT) addLane(lanes, left);
        if (right <= STEER_LIMIT) addLane(lanes, right);
      } else if (item.target) {
        if (!item.live) continue;
        addLane(lanes, clampLane((item.lo + item.hi) / 2));
        blocked.push(item.lo, item.hi);
      } else if (piece.kind === "bridge") {
        addLane(lanes, 0);
        blocked.push(-9, -BRIDGE_HALF, BRIDGE_HALF, 9);
      } else if (!this.blind[i]) {
        const span = Hazard.span(piece, at);
        blocked.push(span.lo, span.hi);
      }
    }
    if (blocked.length === 0) return;
    // The room for the crowd's middle: the road less every span, each widened by the crowd's radius.
    const pad = r + DODGE_MARGIN;
    let cursor = -STEER_LIMIT;
    for (;;) {
      // The nearest span that starts at or after the cursor, and how far a span that covers the cursor reaches.
      let nextLo = Infinity, cover = -Infinity;
      for (let k = 0; k < blocked.length; k += 2) {
        const lo = blocked[k]! - pad, hi = blocked[k + 1]! + pad;
        if (lo <= cursor && hi > cursor) cover = Math.max(cover, hi);
        else if (lo > cursor && lo < nextLo) nextLo = lo;
      }
      if (cover > -Infinity) { cursor = cover; if (cursor >= STEER_LIMIT) break; continue; }
      const open = Math.min(nextLo, STEER_LIMIT);
      // Free from the cursor to `open`: the nearest point to where the crowd heads, and the middle.
      addLane(lanes, Math.min(open, Math.max(cursor, sim.targetX)));
      addLane(lanes, (cursor + open) / 2);
      if (nextLo >= STEER_LIMIT) break;
      cursor = nextLo;
    }
  }

  // MARK: the arithmetic

  /// Start from the run as it is now.
  private begin(sim: RunnerSim, from: number, to: number) {
    this.c = sim.crowd.count;
    this.rate = sim.rate;
    this.range = sim.range;
    this.coins = sim.found;
    this.t = 0;
    this.windowEnd = to;
    for (let i = from; i < to; i++) {
      const item = sim.items[i]!;
      this.hp[i] = item.hp;
      this.alive[i] = item.live ? 1 : 0;
    }
  }

  private keep(from: number, to: number): { c: number; rate: number; range: number; coins: number; t: number } {
    for (let i = from; i < to; i++) { this.hpKept[i] = this.hp[i]!; this.aliveKept[i] = this.alive[i]!; }
    return { c: this.c, rate: this.rate, range: this.range, coins: this.coins, t: this.t };
  }

  private restore(from: number, to: number, kept: { c: number; rate: number; range: number; coins: number; t: number }) {
    for (let i = from; i < to; i++) { this.hp[i] = this.hpKept[i]!; this.alive[i] = this.aliveKept[i]!; }
    this.c = kept.c;
    this.rate = kept.rate;
    this.range = kept.range;
    this.coins = kept.coins;
    this.t = kept.t;
  }

  /// Hold lane `x` until pieces `from` to `to` are behind the crowd. Pellets go to the nearest
  /// live target in the lane among pieces `from` to `targetsTo`, as they do in the run. `wait`
  /// is time spent changing lanes first, when nothing is shot.
  private hold(sim: RunnerSim, x: number, from: number, to: number, targetsTo: number, wait: number) {
    const items = sim.items, front = sim.front, speed = sim.track.speed;
    this.t += wait;
    for (let i = from; i < to && this.c > 0; i++) {
      const item = items[i]!, contact = (item.z - front) / speed;
      if (contact > this.t) this.fire(sim, x, from, targetsTo, contact);
      this.meet(sim, i, x, sim.time + contact);
      if (contact > this.t) this.t = contact;
    }
  }

  /// Pellets from now until `until` seconds from now, from lane `x`.
  private fire(sim: RunnerSim, x: number, from: number, to: number, until: number) {
    const items = sim.items, front = sim.front, speed = sim.track.speed;
    while (this.t < until && this.c > 0) {
      const r = Crowd.radiusOf(this.c), lo = x - r, hi = x + r;
      let target = -1, contact = 0;
      for (let i = from; i < to; i++) {
        const item = items[i]!;
        if (!item.target || this.alive[i] === 0 || !(item.lo < hi && item.hi > lo)) continue;
        contact = (item.z - front) / speed;
        if (contact <= this.t) continue;
        target = i;
        break;
      }
      if (target < 0) break;
      // It comes into range `range` road units before the crowd reaches it.
      const start = Math.max(this.t, contact - this.range / speed);
      if (start >= until) break;
      const firepower = this.c * this.rate * PELLET;
      const broken = start + this.hp[target]! / firepower;
      if (broken > until) {
        this.hp[target] = this.hp[target]! - firepower * (until - start);
        break;
      }
      this.t = broken;
      this.down(sim, target);
    }
    this.t = until;
  }

  /// Pellets took a target's last hit point.
  private down(sim: RunnerSim, i: number) {
    this.alive[i] = 0;
    const item = sim.items[i]!, piece = item.piece;
    if (piece.kind === "crate") {
      const holds = piece.holds;
      if (holds.kind === "allies") this.c += holds.n;
      else if (holds.kind === "times") this.c *= holds.n;
      else if (holds.kind === "rate") this.rate += holds.n / 100;
      else this.coins += holds.n;
    } else if (piece.kind === "barrel") {
      const middle = (item.lo + item.hi) / 2, items = sim.items;
      for (let k = sim.next; k < this.windowEnd; k++) {
        const other = items[k]!;
        if (other.z > item.z + BLAST_RADIUS) break;
        if (this.alive[k] === 0 || (other.kind !== "squad" && other.kind !== "crate")) continue;
        const across = (middle < other.lo ? other.lo - middle : middle > other.hi ? middle - other.hi : 0) * ROAD_HALF;
        const along = other.z - item.z;
        if (across * across + along * along <= BLAST_RADIUS * BLAST_RADIUS) this.alive[k] = 0;
      }
    }
  }

  /// The crowd reaches piece `i` in lane `x` at game time `at`.
  private meet(sim: RunnerSim, i: number, x: number, at: number) {
    const item = sim.items[i]!, piece = item.piece, r = Crowd.radiusOf(this.c);
    switch (piece.kind) {
      case "gates": {
        const op = x < Gates.divider(piece, at) ? piece.left : piece.right;
        if (op.kind === "rate") this.rate = GateOp.applyTo(op, { count: this.c, rate: this.rate, range: this.range }).rate;
        else if (op.kind === "range") this.range += op.n;
        else this.c = GateOp.apply(op, this.c);
        return;
      }
      case "crate": case "barrel":
        if (this.alive[i] !== 0) this.c -= Math.round(this.c * shareIn(x, r, item.lo, item.hi));
        return;
      case "squad":
        if (this.alive[i] !== 0 && item.lo < x + r && item.hi > x - r) {
          this.c -= Math.min(this.c, Math.ceil(Math.ceil(this.hp[i]! - 1e-9) / sim.economy.memberPower));
          this.alive[i] = 0;
        }
        return;
      case "bridge":
        this.c -= Math.round(this.c * (1 - shareIn(x, r, -BRIDGE_HALF, BRIDGE_HALF)));
        return;
      default: {
        if (this.blind[i]) return;
        const span = Hazard.span(piece, at);
        this.c -= Math.round(this.c * shareIn(x, r, span.lo, span.hi));
      }
    }
  }
}

const clampLane = (x: number): number => Math.min(STEER_LIMIT, Math.max(-STEER_LIMIT, x));

/// Add a lane to a list unless one within 0.04 of it is there already.
const addLane = (lanes: number[], x: number) => {
  const lane = clampLane(x);
  for (const other of lanes) if (Math.abs(other - lane) < 0.04) return;
  lanes.push(lane);
};

/// The share of a crowd of radius `r` centred on `x` that stands between `lo` and `hi`, taking
/// the crowd as even across its width. The bot plans with it; the run counts places.
const shareIn = (x: number, r: number, lo: number, hi: number): number => {
  if (r <= 0) return x >= lo && x <= hi ? 1 : 0;
  return Math.min(1, Math.max(0, (Math.min(hi, x + r) - Math.max(lo, x - r)) / (2 * r)));
};

// MARK: playing a track

/// Play one track to its end with a bot at the wheel, with no screen. The generator, the suite
/// and the economy script all play this way.
export const playTrack = (track: Track, economy: RunnerEconomy, pilot: Pilot, options: SimOptions = {}): RunnerSim => {
  const sim = new RunnerSim(track, economy, null, { view: false, ...options });
  sim.fly(pilot);
  const frames = Math.ceil((sim.replayWait + 2) / STEP);
  for (let i = 0; i < frames && !sim.finished; i++) sim.frame();
  return sim;
};

/// The crowd the skilled bot finishes a track with at these upgrades, 0 if it loses. A win's
/// stars are measured against it.
export const parOf = (track: Track, economy: RunnerEconomy): number => {
  const outcome = playTrack(track, economy, new Skilled(track)).outcome;
  return outcome?.won === true ? outcome.score : 0;
};
