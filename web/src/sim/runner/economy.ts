// The four permanent upgrades and what they do to a run. The prices and the shop's odds line
// come from scripts/runner-economy.ts, which plays the real simulation: a reference player (the
// skilled bot, which takes the worse gate one time in five and misses a dodge one time in five)
// walks runs 1 to 300 and buys every level in turn. Each level is priced in wins of income, and
// the levels that buy win odds all cost the same number of wins for each point of odds at the
// moment the player starts to save for them. The script writes the tier tables below between
// the two markers, and a test runs it again and compares.
import { RUNS_PER_WORLD } from "./worlds";

/// The crowd a run starts with before upgrades.
export const BASE_CROWD = 5;

/// What one level of each upgrade adds: runners, member power, the coin multiplier, fire rate.
export const CROWD_STEP = 2, POWER_STEP = 0.15, COIN_STEP = 0.2, RATE_STEP = 0.1;

/// One level of an upgrade: its price, and what it did for the reference player, who buys it
/// just before `run`. `gain` is the win odds it adds, in points, over the thirty runs it was
/// priced on; for the coin bonus, coins a win over the ten runs after it is bought.
export interface Tier { cost: number; run: number; gain: number }

export type Upgrade = "startCrowd" | "memberPower" | "coinMultiplier" | "fireRate";
export type Levels = Partial<Record<Upgrade, number>>;
export type TierTables = Record<Upgrade, Tier[]>;

const tier = (cost: number, run: number, gain: number): Tier => ({ cost, run, gain });

// BEGIN TIERS
const startCrowdTiers: Tier[] = [
  tier(230, 8, 3.0),
  tier(500, 24, 2.2),
  tier(530, 28, 1.1),
  tier(560, 57, 0.1),
  tier(840, 59, 0.7),
  tier(880, 78, 0.1),
  tier(920, 81, 0.1),
  tier(1400, 103, 0.3),
  tier(3600, 106, 1.3),
  tier(6050, 131, 3.0),
  tier(6350, 138, 2.2),
  tier(10000, 161, 1.7),
  tier(10500, 167, 0.4),
  tier(11000, 192, 1.6),
  tier(11600, 199, 1.6),
  tier(12200, 226, 0.7),
  tier(12800, 230, 0.1),
  tier(25100, 260, 2.7),
  tier(26400, 269, 2.4),
  tier(27700, 299, 0.3),
];
const memberPowerTiers: Tier[] = [
  tier(370, 13, 1.7),
  tier(2150, 39, 4.0),
  tier(3250, 66, 2.3),
  tier(4200, 88, 2.4),
  tier(4950, 114, 2.8),
  tier(5200, 143, 2.3),
  tier(6600, 171, 1.7),
  tier(11500, 205, 2.2),
  tier(16100, 238, 1.8),
  tier(28100, 279, 2.2),
];
const coinMultiplierTiers: Tier[] = [
  tier(450, 21, 22.8),
  tier(900, 55, 44.3),
  tier(1300, 76, 53.7),
  tier(2000, 101, 77.9),
  tier(3450, 127, 85.3),
  tier(3600, 154, 114.5),
  tier(4950, 186, 121.5),
  tier(5200, 221, 161.1),
  tier(8650, 253, 173.4),
  tier(17700, 292, 203.2),
];
const fireRateTiers: Tier[] = [
  tier(230, 16, 1.9),
  tier(2400, 51, 2.7),
  tier(2800, 72, 2.4),
  tier(5300, 98, 3.7),
  tier(9300, 123, 3.3),
  tier(19200, 151, 4.8),
  tier(30900, 183, 4.9),
  tier(32700, 218, 4.9),
  tier(34300, 250, 4.0),
  tier(36000, 289, 2.3),
];
// END TIERS

const TABLES: TierTables = {
  startCrowd: startCrowdTiers,
  memberPower: memberPowerTiers,
  coinMultiplier: coinMultiplierTiers,
  fireRate: fireRateTiers,
};

export const Upgrade = {
  allCases: ["startCrowd", "memberPower", "fireRate", "coinMultiplier"] as Upgrade[],

  title(upgrade: Upgrade): string {
    switch (upgrade) {
      case "startCrowd": return "Starting crowd";
      case "memberPower": return "Member strength";
      case "coinMultiplier": return "Coin bonus";
      case "fireRate": return "Fire rate";
    }
  },

  maxLevel: (upgrade: Upgrade): number => (upgrade === "startCrowd" ? 20 : 10),

  /// Entry n is the step from level n to n + 1.
  tiers: (upgrade: Upgrade): Tier[] => TABLES[upgrade],

  cost(upgrade: Upgrade, level: number): number {
    const tiers = Upgrade.tiers(upgrade);
    return tiers[Math.min(Math.max(level, 0), tiers.length - 1)]!.cost;
  },

  effectText(upgrade: Upgrade, level: number): string {
    switch (upgrade) {
      case "startCrowd": return `${BASE_CROWD + CROWD_STEP * level} runners`;
      case "memberPower": return `${(1 + POWER_STEP * level).toFixed(2)}x damage`;
      case "coinMultiplier": return `${(1 + COIN_STEP * level).toFixed(1)}x coins`;
      case "fireRate": return `${Math.round(100 * (1 + RATE_STEP * level))}% fire rate`;
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

  /// Share of the purse by stars: a scrappy win pays half, a clean one all of it.
  static readonly starShare = [0, 0.5, 0.75, 1];

  constructor(readonly levels: Levels = {}) {}

  level(upgrade: Upgrade): number { return this.levels[upgrade] ?? 0; }

  get startCrowd(): number { return BASE_CROWD + CROWD_STEP * this.level("startCrowd"); }
  get memberPower(): number { return 1 + POWER_STEP * this.level("memberPower"); }
  get coinMultiplier(): number { return 1 + COIN_STEP * this.level("coinMultiplier"); }
  /// Pellets thrown at the start of a run, as a multiple of the base rate.
  get fireRate(): number { return 1 + RATE_STEP * this.level("fireRate"); }

  /// A three-star win of 0-based run `level` pays this before the coin bonus. It follows the run,
  /// not the crowd: gates multiply a crowd, so paying per survivor made one lucky track worth a
  /// hundred others.
  static purse(level: number): number { return 30 + 3 * level; }

  /// What a win pays: the purse by stars, and the coins found in crates, both times the coin bonus.
  coins(level: number, stars: number, found = 0): number {
    const share = RunnerEconomy.starShare[Math.min(Math.max(stars, 0), 3)]!;
    return Math.round((RunnerEconomy.purse(level) * share + found) * this.coinMultiplier);
  }

  /// What a loss pays: the coins found in crates before it, times the coin bonus.
  consolation(found: number): number { return Math.round(found * this.coinMultiplier); }

  /// The upgrades a track is checked at when the reference player owns `owned`: none in the
  /// first world, and after it the ones that change a run. The coin bonus changes none.
  static assumed(level: number, owned: Levels): RunnerEconomy {
    if (level < RUNS_PER_WORLD) return RunnerEconomy.base;
    return new RunnerEconomy({ startCrowd: owned.startCrowd ?? 0, memberPower: owned.memberPower ?? 0, fireRate: owned.fireRate ?? 0 });
  }

  /// The upgrades the fairness check assumes for 0-based run `level`: what the reference player
  /// owns by then, read from the `run` column of the tier tables.
  static reference(level: number, tables: TierTables = TABLES): RunnerEconomy {
    const owned = (upgrade: Upgrade) => tables[upgrade].filter((t) => t.run <= level + 1).length;
    return RunnerEconomy.assumed(level, { startCrowd: owned("startCrowd"), memberPower: owned("memberPower"), fireRate: owned("fireRate") });
  }
}
