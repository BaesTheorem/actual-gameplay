// Deterministic tracks from the level number. The same level is the same track on every device,
// and the finale is sized from the best run a player without upgrades could make, so a good player
// can always win and extra starting runners are a real edge.
import { SeededRNG } from "./rng";
import { GateOp, type Finale, type Hazard, type Segment, type Track } from "./track";

const MASK = (1n << 64n) - 1n;

const randomOp = (rng: SeededRNG, tier: number, forceGood = false): GateOp => {
  const roll = rng.unit();
  let kind: number;
  if (forceGood) kind = roll < 0.65 ? 0 : 2;
  else if (roll < 0.4) kind = 0;
  else if (roll < 0.65) kind = 1;
  else if (roll < 0.85) kind = 2;
  else kind = 3;
  switch (kind) {
    case 0: return GateOp.add(rng.int(3 + 2 * tier, 10 + 5 * tier));
    case 1: return GateOp.subtract(rng.int(2 + tier, 6 + 3 * tier));
    case 2: return GateOp.multiply(tier >= 2 && rng.unit() < 0.3 ? 3 : 2);
    default: return GateOp.divide(rng.unit() < 0.7 ? 2 : 3);
  }
};

const randomHazard = (rng: SeededRNG, tier: number): Hazard => {
  const roll = rng.unit();
  if (roll < 0.45) {
    const width = 0.5 + 0.08 * tier;
    const center = rng.unit() - 0.5;
    return { kind: "wall", x0: center - width / 2, x1: center + width / 2 };
  }
  if (roll < 0.75) {
    return { kind: "blade", center: 0, halfWidth: 0.18 + 0.02 * tier, amplitude: 0.55, speed: 1.4 + 0.2 * tier };
  }
  const center = rng.unit() * 1.2 - 0.6;
  return { kind: "spikes", x0: center - 0.16, x1: center + 0.16 };
};

export const RunnerGenerator = {
  /// How many runs the replay suite drives at base upgrades.
  replayLevels: 5,

  /// The crowd a run starts with before upgrades, and the one every finale is sized for.
  baseCrowd: 5,

  seed: (level: number): bigint => (1_000_003n * BigInt(level + 1)) & MASK,

  speed: (level: number): number => Math.min(7 + 0.15 * level, 12),

  makeTrack(level: number, startCrowd: number): Track {
    const rng = new SeededRNG(RunnerGenerator.seed(level));
    const count = Math.min(6 + Math.trunc(level / 2), 14);
    const tier = Math.min(Math.trunc(level / 5), 4);
    const segments: Segment[] = [];
    let z = 12;
    let running = RunnerGenerator.baseCrowd;
    let betterSide = 0; // +1 right, -1 left
    let sameSideRun = 0;
    for (let i = 0; i < count; i++) {
      const wantsGates = level < 2 || rng.unit() < 0.7;
      if (wantsGates) {
        let left = randomOp(rng, tier);
        let right = randomOp(rng, tier, !GateOp.isGood(left));
        let tries = 0;
        while (GateOp.equals(right, left) && tries < 20) {
          right = randomOp(rng, tier, !GateOp.isGood(left));
          tries += 1;
        }
        // Never let the better gate sit on the same side three times running: a player
        // hugging one wall should not stumble through a level.
        let side = GateOp.apply(right, running) >= GateOp.apply(left, running) ? 1 : -1;
        if (side === betterSide && sameSideRun >= 2) {
          [left, right] = [right, left];
          side = -side;
        }
        sameSideRun = side === betterSide ? sameSideRun + 1 : 1;
        betterSide = side;
        running = Math.max(GateOp.apply(left, running), GateOp.apply(right, running));
        segments.push({ type: "gates", pair: { z, left, right } });
      } else {
        segments.push({ type: "obstacle", obstacle: { z, hazard: randomHazard(rng, tier) } });
      }
      z += 6;
    }
    const finaleZ = z + 4;

    let best = startCrowd;
    let par = RunnerGenerator.baseCrowd;
    for (const segment of segments) {
      if (segment.type !== "gates") continue;
      const { left, right } = segment.pair;
      best = Math.max(GateOp.apply(left, best), GateOp.apply(right, best));
      par = Math.max(GateOp.apply(left, par), GateOp.apply(right, par));
    }
    best = Math.max(best, 2);
    par = Math.max(par, 2);

    // The rivals do not grow with the starting crowd: that is what the upgrade buys.
    let finale: Finale;
    if ((level + 1) % 5 === 0) {
      finale = { type: "boss", hp: Math.max(1, Math.min(par - 1, Math.floor(0.75 * par))) };
    } else {
      const ratio = 0.6 + 0.02 * Math.min(level, 12);
      finale = { type: "crowd", count: Math.max(1, Math.min(par - 1, Math.floor(par * ratio))) };
    }
    return { level, segments, finale, finaleZ, speed: RunnerGenerator.speed(level), startCrowd, bestPath: best };
  },
};
