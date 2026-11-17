// The track as data: gates, crates, barrels, rival squads, hazards, the finale, and the finale
// fight as arithmetic.
//
// Everything here, and everything in the simulation that decides a run, is built from add,
// subtract, multiply, divide and square root. Those give the same double on every processor and
// in every browser, which the generator depends on: it plays each track before it accepts it,
// so a device that computed one step differently would be handed a different track.

/// A sine wave from plain arithmetic: one turn for each whole number, -1 to 1, zero at 0 and at
/// a half. It is Bhaskara's quotient, within 0.002 of a true sine. Math.sin is not used for
/// anything that decides a run, because its last digit differs between engines.
export const wave = (turns: number): number => {
  const u = turns - Math.floor(turns);
  const h = u < 0.5 ? u : u - 0.5;
  const q = h * (1 - 2 * h);
  const s = (32 * q) / (5 - 8 * q);
  return u < 0.5 ? s : -s;
};
/// Radians in a turn, for speeds that are written in radians a second.
export const TAU = 6.283185307179586;

/// What a crowd carries down the road besides its place on it.
export interface Stats { count: number; rate: number; range: number }

/// Fire rate never falls below this, whatever gates the crowd takes.
export const RATE_FLOOR = 0.25;

export type GateOp =
  | { kind: "add"; n: number }
  | { kind: "subtract"; n: number }
  | { kind: "multiply"; n: number }
  | { kind: "divide"; n: number }
  /// Fire rate up or down by `n` hundredths of the starting rate: 25 is "+25%".
  | { kind: "rate"; n: number }
  /// Reach further up the road by `n` road units.
  | { kind: "range"; n: number };

export const GateOp = {
  add: (n: number): GateOp => ({ kind: "add", n }),
  subtract: (n: number): GateOp => ({ kind: "subtract", n }),
  multiply: (n: number): GateOp => ({ kind: "multiply", n }),
  divide: (n: number): GateOp => ({ kind: "divide", n }),
  rate: (n: number): GateOp => ({ kind: "rate", n }),
  range: (n: number): GateOp => ({ kind: "range", n }),

  /// The crowd's count after the gate. A rate or range gate leaves the count alone.
  apply(op: GateOp, count: number): number {
    switch (op.kind) {
      case "add": return count + op.n;
      case "subtract": return Math.max(0, count - op.n);
      case "multiply": return count * op.n;
      case "divide": return Math.max(0, Math.trunc(count / op.n));
      default: return count;
    }
  },

  /// Everything the gate changes.
  applyTo(op: GateOp, stats: Stats): Stats {
    if (op.kind === "rate") return { ...stats, rate: Math.max(RATE_FLOOR, stats.rate + op.n / 100) };
    if (op.kind === "range") return { ...stats, range: stats.range + op.n };
    return { ...stats, count: GateOp.apply(op, stats.count) };
  },

  label(op: GateOp): string {
    switch (op.kind) {
      case "add": return `+${op.n}`;
      case "subtract": return `-${op.n}`;
      case "multiply": return `×${op.n}`;
      case "divide": return `÷${op.n}`;
      case "rate": return `${op.n > 0 ? "+" : ""}${op.n}%`;
      case "range": return `+${op.n}`;
    }
  },

  /// The word that goes with the number on a gate that does not change the count.
  caption: (op: GateOp): string => (op.kind === "rate" ? "FIRE" : op.kind === "range" ? "RANGE" : ""),

  isGood: (op: GateOp): boolean =>
    op.kind === "add" || op.kind === "multiply" || op.kind === "range" || (op.kind === "rate" && op.n > 0),

  equals: (a: GateOp, b: GateOp): boolean => a.kind === b.kind && a.n === b.n,
};

/// What a crate holds. It is painted on the crate from the start.
export type Reward =
  | { kind: "allies"; n: number }
  | { kind: "times"; n: number }
  /// Fire rate up by `n` hundredths of the starting rate.
  | { kind: "rate"; n: number }
  | { kind: "coins"; n: number };

export const Reward = {
  label(reward: Reward): string {
    switch (reward.kind) {
      case "allies": return `+${reward.n}`;
      case "times": return `×${reward.n}`;
      case "rate": return `+${reward.n}%`;
      case "coins": return `+${reward.n}`;
    }
  },
};

/// A closed stretch of lane, both ends included. x runs across the road from -1 to 1.
export interface Span { lo: number; hi: number }

/// A gate pair that slides from side to side: the line between the two gates is at
/// `amplitude` times a sine with this period in seconds, `phase` turns into it at time zero.
export interface Slide { amplitude: number; period: number; phase: number }

/// One thing on the road. `z` is its place along the road in lane units.
export type Piece =
  | { kind: "gates"; z: number; left: GateOp; right: GateOp; slide?: Slide }
  /// A crate has hit points. Broken by pellets it gives what it holds; reached unbroken it is a wall.
  | { kind: "crate"; z: number; lo: number; hi: number; hp: number; holds: Reward }
  /// A barrel blows up when it is shot down, and takes the squads and crates near it.
  | { kind: "barrel"; z: number; lo: number; hi: number; hp: number }
  /// Rivals standing in the road, one hit point each.
  | { kind: "squad"; z: number; lo: number; hi: number; count: number }
  | { kind: "wall"; z: number; lo: number; hi: number }
  | { kind: "spikes"; z: number; lo: number; hi: number }
  /// A saw that slides across the road. `speed` is in radians a second.
  | { kind: "blade"; z: number; center: number; halfWidth: number; amplitude: number; speed: number }
  /// A hammer that lies on one half of the road and swings to the other every `beat` seconds.
  | { kind: "hammer"; z: number; beat: number; offset: number }
  /// The road narrows to its middle third for `length` lane units.
  | { kind: "bridge"; z: number; length: number };

export type PieceKind = Piece["kind"];

/// The hammer's head stops this far short of the middle line, so the line itself is never hit.
export const HAMMER_GAP = 0.04;
/// Half the width of a bridge: the middle third of the road.
export const BRIDGE_HALF = 1 / 3;
/// A span that reaches past both edges of the road.
const PAST_EDGE = 4;

export const Gates = {
  /// Where the line between the two gates is at a moment in time. Left of it is the left gate.
  divider(piece: { slide?: Slide }, time: number): number {
    const slide = piece.slide;
    return slide ? slide.amplitude * wave(time / slide.period + slide.phase) : 0;
  },
};

export const Hammer = {
  /// How many times the hammer has landed by `time`.
  beats: (piece: { beat: number; offset: number }, time: number): number => Math.floor((time + piece.offset) / piece.beat),
  /// The half it lies on: -1 for the left, 1 for the right.
  side: (piece: { beat: number; offset: number }, time: number): number => (Hammer.beats(piece, time) % 2 === 0 ? -1 : 1),
};

/// One half of the road as a span, the middle line left out: -1 for the left half, 1 for the right.
export const halfRoad = (side: number, gap = 1e-9): Span => (side < 0 ? { lo: -PAST_EDGE, hi: -gap } : { lo: gap, hi: PAST_EDGE });

export const Hazard = {
  /// The deadly stretch of lane at a moment in time, for a piece that kills where it stands.
  span(piece: Piece, time: number): Span {
    switch (piece.kind) {
      case "blade": {
        const x = piece.center + piece.amplitude * wave((time * piece.speed) / TAU);
        return { lo: x - piece.halfWidth, hi: x + piece.halfWidth };
      }
      case "hammer": return halfRoad(Hammer.side(piece, time), HAMMER_GAP);
      case "gates": case "bridge": return { lo: 0, hi: 0 };
      default: return { lo: piece.lo, hi: piece.hi };
    }
  },
};

export type Finale =
  | { type: "crowd"; count: number }
  /// A boss slams one half of the road before the fight: `slam` is -1 for the left half, 1 for the right.
  | { type: "boss"; hp: number; slam: number };

/// Both finales resolve as attrition against this many hit points.
export const finaleStrength = (finale: Finale): number =>
  finale.type === "crowd" ? finale.count : finale.hp;

export type FightOutcome =
  | { type: "going" }
  | { type: "won"; survivors: number }
  | { type: "lost"; lastRunner: boolean };

/// The finale as arithmetic, one 0.05 s tick at a time: both sides lose a thirtieth of the bigger
/// side, ours divided by member power. The fraction of a runner that division leaves is carried to
/// the next tick, so power counts in a fight of any size; at power 1 nothing is ever carried.
export class FinaleFight {
  private owed = 0;

  constructor(public mine: number, public theirs: number, readonly power: number) {}

  tick(): FightOutcome {
    const before = { mine: this.mine, theirs: this.theirs };
    const slice = Math.max(1, Math.ceil(Math.max(this.mine, this.theirs) / 30));
    this.owed += slice / this.power;
    const loss = Math.floor(this.owed);
    this.owed -= loss;
    this.theirs = Math.max(0, this.theirs - slice);
    this.mine = Math.max(0, this.mine - loss);
    if (this.theirs <= 0 && this.mine > 0) return { type: "won", survivors: this.mine };
    if (this.mine <= 0 && this.theirs > 0) return { type: "lost", lastRunner: false };
    if (this.mine <= 0 && this.theirs <= 0) {
      return before.mine * this.power >= before.theirs ? { type: "won", survivors: 1 } : { type: "lost", lastRunner: true };
    }
    return { type: "going" };
  }

  /// Survivors of the whole fight, 0 for a loss.
  static survivors(mine: number, theirs: number, power: number): number {
    const fight = new FinaleFight(mine, theirs, power);
    for (;;) {
      const outcome = fight.tick();
      if (outcome.type === "won") return outcome.survivors;
      if (outcome.type === "lost") return 0;
    }
  }
}

/// What the generator found when it played a track before accepting it.
export interface Fairness {
  /// The skilled bot won.
  skilled: boolean;
  /// The lazy bots that won: "straight", "left", "random". Empty for a fair track.
  lazy: string[];
}

export interface Track {
  /// The run, counted from 0.
  level: number;
  /// Everything on the road, nearest first.
  pieces: Piece[];
  finale: Finale;
  finaleZ: number;
  speed: number;
  /// Which layout this is: 0 for the first seed the generator tried for the run.
  attempt: number;
  fairness: Fairness;
  /// The crowd the skilled bot finishes with at the upgrades the fairness check assumes.
  par: number;
}

/// True when the track passed the fairness check: the skilled bot won and every lazy bot lost.
export const isFair = (track: Track): boolean => track.fairness.skilled && track.fairness.lazy.length === 0;

/// A track from its parts, for the tests and for the generator's candidates. Pieces are put in
/// road order, and the finale stands 12 lane units past the last one unless it is given a place.
export const trackOf = (
  pieces: Piece[], finale: Finale, options: { level?: number; speed?: number; finaleZ?: number } = {},
): Track => {
  const sorted = [...pieces].sort((a, b) => a.z - b.z);
  const last = sorted.length > 0 ? sorted[sorted.length - 1]! : null;
  const end = last === null ? 0 : last.kind === "bridge" ? last.z + last.length : last.z;
  return {
    level: options.level ?? 0,
    pieces: sorted,
    finale,
    finaleZ: options.finaleZ ?? end + 12,
    speed: options.speed ?? 7,
    attempt: 0,
    fairness: { skilled: true, lazy: [] },
    par: 0,
  };
};
