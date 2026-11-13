// The three permanent upgrades and what they do to a run. The prices and the shop's odds line
// come from scripts/economy.py, which plays the runs as arithmetic. The tier tables below are a
// copy of the ones in RunnerEconomy.swift, and a test compares the two files.
import { RunnerGenerator } from "./generator";

/// One level of an upgrade: its price, and what it did for the model's reference player (the
/// better gate and a clean dodge 80% of the time), who buys it just before `run`. `gain` is
/// the win odds it adds there, in points over the next ten runs; for the coin bonus, coins a win.
export interface Tier { cost: number; run: number; gain: number }

export type Upgrade = "startCrowd" | "memberPower" | "coinMultiplier";

const tier = (cost: number, run: number, gain: number): Tier => ({ cost, run, gain });

const startCrowdTiers: Tier[] = [
  tier(110, 5, 2.8),
  tier(280, 24, 1.2),
  tier(300, 27, 0.8),
  tier(570, 47, 1.6),
  tier(600, 50, 0.9),
  tier(1150, 70, 2.6),
  tier(1200, 74, 1.5),
  tier(1700, 96, 2.0),
  tier(1800, 100, 1.4),
  tier(2450, 122, 1.4),
  tier(2700, 127, 1.3),
  tier(3750, 151, 0.9),
  tier(3950, 156, 0.9),
  tier(5050, 180, 1.1),
  tier(5300, 186, 1.1),
  tier(6050, 211, 1.0),
  tier(8000, 219, 1.6),
  tier(8400, 246, 0.9),
  tier(8800, 253, 0.7),
  tier(9900, 279, 0.7),
];
const memberPowerTiers: Tier[] = [
  tier(500, 16, 4.6),
  tier(1250, 39, 5.1),
  tier(2200, 61, 5.4),
  tier(3550, 87, 5.2),
  tier(5150, 113, 3.6),
  tier(7450, 141, 3.1),
  tier(9900, 170, 3.1),
  tier(14400, 202, 2.3),
  tier(20700, 236, 2.1),
  tier(23200, 269, 1.4),
];
const coinMultiplierTiers: Tier[] = [
  tier(340, 21, 16.3),
  tier(640, 43, 25.0),
  tier(960, 66, 34.3),
  tier(1400, 91, 41.4),
  tier(1850, 117, 50.4),
  tier(2350, 145, 60.8),
  tier(2800, 174, 70.3),
  tier(3800, 205, 80.8),
  tier(4400, 240, 97.5),
  tier(5150, 273, 106.3),
];

export const Upgrade = {
  allCases: ["startCrowd", "memberPower", "coinMultiplier"] as Upgrade[],

  title(upgrade: Upgrade): string {
    switch (upgrade) {
      case "startCrowd": return "Starting crowd";
      case "memberPower": return "Member strength";
      case "coinMultiplier": return "Coin bonus";
    }
  },

  maxLevel: (upgrade: Upgrade): number => (upgrade === "startCrowd" ? 20 : 10),

  /// Entry n is the step from level n to n + 1.
  tiers(upgrade: Upgrade): Tier[] {
    switch (upgrade) {
      case "startCrowd": return startCrowdTiers;
      case "memberPower": return memberPowerTiers;
      case "coinMultiplier": return coinMultiplierTiers;
    }
  },

  cost(upgrade: Upgrade, level: number): number {
    const tiers = Upgrade.tiers(upgrade);
    return tiers[Math.min(Math.max(level, 0), tiers.length - 1)]!.cost;
  },

  effectText(upgrade: Upgrade, level: number): string {
    switch (upgrade) {
      case "startCrowd": return `${RunnerGenerator.baseCrowd + 2 * level} runners`;
      case "memberPower": return `${(1 + 0.15 * level).toFixed(2)}x damage`;
      case "coinMultiplier": return `${(1 + 0.2 * level).toFixed(1)}x coins`;
    }
  },

  /// What the next level buys, for the shop: "+3% odds at run 12", null once maxed.
  previewText(upgrade: Upgrade, level: number): string | null {
    if (level < 0 || level >= Upgrade.maxLevel(upgrade)) return null;
    const t = Upgrade.tiers(upgrade)[level]!;
    if (upgrade === "coinMultiplier") return `+${Math.round(t.gain)} coins a win at run ${t.run}`;
    const points = t.gain >= 2 ? `${Math.round(t.gain)}` : t.gain.toFixed(1);
    return `+${points}% odds at run ${t.run}`;
  },
};

export class RunnerEconomy {
  static readonly base = new RunnerEconomy();

  static readonly startCrowdTiers = startCrowdTiers;
  static readonly memberPowerTiers = memberPowerTiers;
  static readonly coinMultiplierTiers = coinMultiplierTiers;

  /// Share of the purse by stars: a scrappy win pays half, a clean one all of it.
  static readonly starShare = [0, 0.5, 0.75, 1];

  constructor(readonly levels: Partial<Record<Upgrade, number>> = {}) {}

  level(upgrade: Upgrade): number { return this.levels[upgrade] ?? 0; }

  get startCrowd(): number { return RunnerGenerator.baseCrowd + 2 * this.level("startCrowd"); }
  get memberPower(): number { return 1 + 0.15 * this.level("memberPower"); }
  get coinMultiplier(): number { return 1 + 0.2 * this.level("coinMultiplier"); }

  /// A three-star win of 0-based run `level` pays this before the coin bonus. It follows the run,
  /// not the crowd: gates multiply a crowd, so paying per survivor made one lucky track worth a
  /// hundred others.
  static purse(level: number): number { return 30 + 3 * level; }

  coins(level: number, stars: number): number {
    const share = RunnerEconomy.starShare[Math.min(Math.max(stars, 0), 3)]!;
    return Math.round(RunnerEconomy.purse(level) * share * this.coinMultiplier);
  }
}
