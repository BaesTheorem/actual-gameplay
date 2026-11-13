// The track as data: gates, hazards, the finale, and the finale fight as arithmetic.

export type GateOp =
  | { kind: "add"; n: number }
  | { kind: "subtract"; n: number }
  | { kind: "multiply"; n: number }
  | { kind: "divide"; n: number };

export const GateOp = {
  add: (n: number): GateOp => ({ kind: "add", n }),
  subtract: (n: number): GateOp => ({ kind: "subtract", n }),
  multiply: (n: number): GateOp => ({ kind: "multiply", n }),
  divide: (n: number): GateOp => ({ kind: "divide", n }),

  apply(op: GateOp, count: number): number {
    switch (op.kind) {
      case "add": return count + op.n;
      case "subtract": return Math.max(0, count - op.n);
      case "multiply": return count * op.n;
      case "divide": return Math.max(0, Math.trunc(count / op.n));
    }
  },

  label(op: GateOp): string {
    switch (op.kind) {
      case "add": return `+${op.n}`;
      case "subtract": return `-${op.n}`;
      case "multiply": return `×${op.n}`;
      case "divide": return `÷${op.n}`;
    }
  },

  isGood: (op: GateOp): boolean => op.kind === "add" || op.kind === "multiply",

  equals: (a: GateOp, b: GateOp): boolean => a.kind === b.kind && a.n === b.n,
};

export interface GatePair { z: number; left: GateOp; right: GateOp }

export type Hazard =
  | { kind: "wall"; x0: number; x1: number }
  | { kind: "blade"; center: number; halfWidth: number; amplitude: number; speed: number }
  | { kind: "spikes"; x0: number; x1: number };

/// A closed stretch of lane, both ends included.
export interface Span { lo: number; hi: number }

export const Hazard = {
  /// The deadly stretch of lane at a moment in time.
  span(hazard: Hazard, time: number): Span {
    if (hazard.kind === "blade") {
      const x = hazard.center + hazard.amplitude * Math.sin(time * hazard.speed);
      return { lo: x - hazard.halfWidth, hi: x + hazard.halfWidth };
    }
    return { lo: hazard.x0, hi: hazard.x1 };
  },
};

export interface Obstacle { z: number; hazard: Hazard }

export type Segment =
  | { type: "gates"; pair: GatePair }
  | { type: "obstacle"; obstacle: Obstacle };

export const segmentZ = (segment: Segment): number =>
  segment.type === "gates" ? segment.pair.z : segment.obstacle.z;

export type Finale =
  | { type: "crowd"; count: number }
  | { type: "boss"; hp: number };

/// Both finales resolve as attrition against this many "hit points".
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

export interface Track {
  level: number;
  segments: Segment[];
  finale: Finale;
  finaleZ: number;
  speed: number;
  startCrowd: number;
  /// The crowd a perfect run arrives with at these upgrades: best gate every time, no obstacle losses.
  bestPath: number;
}
