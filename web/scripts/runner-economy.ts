// Crowd Run's upgrade economy, worked out by playing the real simulation. There is no model
// beside it: every number here comes from runs the generator made and a bot steered.
//
//   npx tsx scripts/runner-economy.ts           the tables and a report, and whether economy.ts holds them
//   npx tsx scripts/runner-economy.ts --write   write the tables into src/sim/runner/economy.ts
//
// The reference player is the skilled bot with a stated error rate: it takes the worse gate one
// time in five and does not see a hazard coming one time in five. Which gates and which hazards
// is decided by a seed, and the same seed is used at every upgrade state, so two states are
// compared on the same mistakes.
//
// The player walks the runs in order and saves for one level at a time, always the upgrade
// that is furthest behind, so the starting crowd gets two levels for each level of the others.
// When it starts to save for a level, the next PRICE_WINDOW runs are played PLAYS times each
// with the levels it owns and with one more level of each upgrade that buys win odds. The
// j-th level bought costs ramp(j) wins of income on average, 4 for the first and 8 for the
// last, which has the last level bought near run 300. Each level that buys odds costs that
// times its own gain over the average gain. So every such level costs the same number of wins
// of income for each point of win odds, within the SPREAD limits, and the gain it was priced
// on is the one the shop quotes. A level of the coin bonus costs the extra coins it earns over
// 5 x ramp(j) wins. Prices never fall from one level to the next.
//
// A track is checked for fairness at the upgrades the reference player owns by that run, so
// the tracks depend on the prices and the prices on the tracks. The walk settles that as it
// goes: the runs it plays to bank coins are built for the levels it owns then, which are the
// levels the finished tables give for those runs, and the runs it looks ahead at are built for
// the levels it owns at the moment it looks.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  RunnerEconomy, RunnerGenerator, Skilled, Upgrade, parOf, playTrack,
  type Levels, type Tier, type TierTables, type Track,
} from "../src/sim/runner";

// MARK: the reference player and the measurement

/// The seed of every mistake the reference player makes.
export const SEED = 20261113;
/// Times each run is played at each upgrade state.
export const PLAYS = 30;
/// The reference player's error rates: the worse gate, and a hazard it does not see.
export const GATE_ERROR = 0.2, DODGE_ERROR = 0.2;
/// Runs a level's gain is measured over, from the run the player starts to save for it. The
/// price and the line in the shop both come from that one measurement. The coin bonus is
/// quoted over the ten runs after it is bought.
export const PRICE_WINDOW = 30, WINDOW = 10;
/// A level that buys odds costs between these multiples of the ramp, whatever its gain.
export const SPREAD = [0.3, 2.5] as const;

/// The upgrades in the order the player buys them when two are equally far behind.
const ORDER: Upgrade[] = ["startCrowd", "memberPower", "fireRate", "coinMultiplier"];
/// The ones that change a run, and how much each counts in the average gain: the starting crowd
/// has twice the levels, so it is bought twice as often.
const ODDS: [Upgrade, number][] = [["startCrowd", 2], ["memberPower", 1], ["fireRate", 1]];
const TOTAL = ORDER.reduce((sum, upgrade) => sum + Upgrade.maxLevel(upgrade), 0);

/// Wins of income the j-th purchase costs on average: 4 for the first, 8 for the last.
const ramp = (j: number): number => 4 + (4 * j) / (TOTAL - 1);

/// A price that reads as one: fives to 100, tens to 1000, fifties to 10000, hundreds after.
const nice = (x: number): number => {
  const step = x < 100 ? 5 : x < 1000 ? 10 : x < 10000 ? 50 : 100;
  return Math.max(step, Math.round(x / step) * step);
};

const bump = (levels: Levels, upgrade: Upgrade): Levels => ({ ...levels, [upgrade]: (levels[upgrade] ?? 0) + 1 });
/// The levels that change a run, as a key. The coin bonus changes only what a run pays.
const runKey = (levels: Levels): string => `${levels.startCrowd ?? 0}/${levels.memberPower ?? 0}/${levels.fireRate ?? 0}`;

/// What PLAYS plays of one run at one upgrade state came to.
interface Played { won: boolean[]; stars: number[]; found: number[] }
/// What a run is worth to the reference player at one upgrade state.
export interface Measured {
  /// The share of plays that win.
  odds: number;
  /// Coins a win pays, on average.
  perWin: number;
  /// Coins banked for each run cleared: a win, and the crate coins of the losses before it.
  income: number;
}

export class Model {
  private tracks = new Map<string, Track>();
  private played = new Map<string, Played>();
  plays = 0;

  /// The track for a run as the generator builds it when the reference player owns `owned`.
  track(level: number, owned: Levels): Track {
    const assumed = RunnerEconomy.assumed(level, owned), key = `${level}:${runKey(assumed.levels)}`;
    let track = this.tracks.get(key);
    if (!track) {
      track = RunnerGenerator.makeTrack(level, assumed);
      this.tracks.set(key, track);
    }
    return track;
  }

  /// The run built for `owned`, played with `mine`.
  private play(level: number, owned: Levels, mine: Levels): Played {
    const assumed = RunnerEconomy.assumed(level, owned), key = `${level}:${runKey(assumed.levels)}:${runKey(mine)}`;
    let played = this.played.get(key);
    if (played) return played;
    const track = this.track(level, owned), economy = new RunnerEconomy({ ...mine, coinMultiplier: 0 });
    const par = parOf(track, economy);
    played = { won: [], stars: [], found: [] };
    for (let k = 0; k < PLAYS; k++) {
      const seed = BigInt(SEED) * 1_000_003n + BigInt(level) * 7_919n + BigInt(k);
      const sim = playTrack(track, economy, new Skilled(track, { gate: GATE_ERROR, dodge: DODGE_ERROR, seed }), { par });
      const outcome = sim.outcome;
      played.won.push(outcome?.won === true);
      played.stars.push(outcome?.won === true ? outcome.stars : 0);
      played.found.push(sim.found);
    }
    this.plays += PLAYS;
    this.played.set(key, played);
    return played;
  }

  measure(level: number, owned: Levels, mine: Levels): Measured {
    const played = this.play(level, owned, mine), economy = new RunnerEconomy(mine);
    let wins = 0, winCoins = 0, lossCoins = 0;
    for (let k = 0; k < PLAYS; k++) {
      if (played.won[k]) { wins += 1; winCoins += economy.coins(level, played.stars[k]!, played.found[k]!); }
      else lossCoins += economy.consolation(played.found[k]!);
    }
    // A run nobody won in PLAYS tries is taken as won once in twice that many, at one star.
    const odds = wins / PLAYS, floor = Math.max(odds, 1 / (2 * PLAYS));
    const perWin = wins > 0 ? winCoins / wins : economy.coins(level, 1);
    const perLoss = wins < PLAYS ? lossCoins / (PLAYS - wins) : 0;
    return { odds, perWin, income: perWin + (1 / floor - 1) * perLoss };
  }

  /// A measurement averaged over `width` runs from `level`, all built for `owned`.
  mean(level: number, width: number, owned: Levels, mine: Levels): Measured {
    const sum = { odds: 0, perWin: 0, income: 0 };
    for (let i = level; i < level + width; i++) {
      const m = this.measure(i, owned, mine);
      sum.odds += m.odds;
      sum.perWin += m.perWin;
      sum.income += m.income;
    }
    return { odds: sum.odds / width, perWin: sum.perWin / width, income: sum.income / width };
  }
}

// MARK: the walk

export interface Plan {
  upgrade: Upgrade;
  /// The level bought, 1 for the first.
  level: number;
  cost: number;
  /// The run the reference player first plays with it, counted from 1.
  run: number;
  /// The price in wins of the income earned while saving for it.
  wins: number;
  /// Odds points over the PRICE_WINDOW runs it was priced on; coins a win for the coin bonus.
  gain: number;
  /// Wins of income for each point of odds, for a level that buys odds.
  rate: number;
}

/// Price every level from what it buys the reference player at the moment it is bought.
export const design = (model = new Model()): { tables: TierTables; plans: Plan[] } => {
  let owned: Levels = { startCrowd: 0, memberPower: 0, fireRate: 0, coinMultiplier: 0 };
  let level = 0, bank = 0;
  const tables: TierTables = { startCrowd: [], memberPower: [], coinMultiplier: [], fireRate: [] };
  const plans: Plan[] = [];
  const gain = new Map<Upgrade, number>(ODDS.map(([upgrade]) => [upgrade, 0]));
  for (let j = 0; j < TOTAL; j++) {
    // The upgrade furthest behind, by the share of its levels that are owned.
    const open = ORDER.filter((u) => owned[u]! < Upgrade.maxLevel(u));
    const upgrade = open.reduce((a, b) => (owned[b]! / Upgrade.maxLevel(b) < owned[a]! / Upgrade.maxLevel(a) ? b : a));
    const k = ramp(j);
    const here = model.mean(level, PRICE_WINDOW, owned, owned).odds;
    for (const [u] of ODDS) {
      // An upgrade that is at its last level keeps its last reading.
      if (owned[u]! < Upgrade.maxLevel(u)) gain.set(u, model.mean(level, PRICE_WINDOW, owned, bump(owned, u)).odds - here);
    }
    const weight = ODDS.reduce((sum, [, w]) => sum + w, 0);
    const average = ODDS.reduce((sum, [u, w]) => sum + w * gain.get(u)!, 0) / weight;
    let wins: number;
    if (upgrade === "coinMultiplier") {
      const before = new RunnerEconomy(owned).coinMultiplier, after = new RunnerEconomy(bump(owned, upgrade)).coinMultiplier;
      wins = 5 * k * (after / before - 1);
    } else {
      wins = average > 0 ? Math.min(SPREAD[1] * k, Math.max(SPREAD[0] * k, (k * gain.get(upgrade)!) / average)) : k;
    }
    const saving = Math.max(1, Math.round(wins));
    const income = model.mean(level, saving, owned, owned).income;
    const tiers = tables[upgrade];
    let cost = nice(wins * income);
    if (tiers.length > 0) cost = Math.max(cost, nice(tiers[tiers.length - 1]!.cost * 1.05));
    // The player clears runs until the level is paid for.
    while (bank < cost) {
      bank += model.measure(level, owned, owned).income;
      level += 1;
    }
    bank -= cost;
    const after = bump(owned, upgrade);
    // The shop quotes the gain the price came from. The coin bonus changes no run, so its
    // gain is the same plays paid at the new rate, over the ten runs after it is bought.
    const shown = upgrade === "coinMultiplier"
      ? model.mean(level, WINDOW, after, after).perWin - model.mean(level, WINDOW, after, owned).perWin
      : 100 * gain.get(upgrade)!;
    // A level that changed no result in the plays is quoted at a tenth of a point, not at nothing.
    const tier: Tier = { cost, run: level + 1, gain: Math.max(0.1, Math.round(shown * 10) / 10) };
    tiers.push(tier);
    plans.push({
      upgrade, level: after[upgrade]!, cost, run: tier.run, wins: cost / income, gain: tier.gain,
      rate: upgrade === "coinMultiplier" || average <= 0 ? 0 : k / (100 * average),
    });
    owned = after;
  }
  return { tables, plans };
};

// MARK: the file

const NAMES: [Upgrade, string][] = [
  ["startCrowd", "startCrowdTiers"], ["memberPower", "memberPowerTiers"],
  ["coinMultiplier", "coinMultiplierTiers"], ["fireRate", "fireRateTiers"],
];
const BEGIN = "// BEGIN TIERS\n", END = "// END TIERS\n";

/// The tables as they stand in economy.ts, between its two markers.
export const render = (tables: TierTables): string =>
  NAMES.map(([upgrade, name]) =>
    `const ${name}: Tier[] = [\n${tables[upgrade].map((t) => `  tier(${t.cost}, ${t.run}, ${t.gain.toFixed(1)}),\n`).join("")}];\n`).join("");

const ECONOMY = fileURLToPath(new URL("../src/sim/runner/economy.ts", import.meta.url));

const write = (tables: TierTables) => {
  const text = readFileSync(ECONOMY, "utf8");
  const head = text.slice(0, text.indexOf(BEGIN) + BEGIN.length), tail = text.slice(text.indexOf(END));
  writeFileSync(ECONOMY, head + render(tables) + tail);
};

/// The tables economy.ts holds now.
export const baked = (): TierTables => ({
  startCrowd: Upgrade.tiers("startCrowd"), memberPower: Upgrade.tiers("memberPower"),
  coinMultiplier: Upgrade.tiers("coinMultiplier"), fireRate: Upgrade.tiers("fireRate"),
});

// MARK: the report

const SHORT: Record<Upgrade, string> = { startCrowd: "start crowd", memberPower: "strength", fireRate: "fire rate", coinMultiplier: "coin bonus" };

const report = (plans: Plan[], tables: TierTables, model: Model, seconds: number) => {
  console.log(`Reference player: the skilled bot, the worse gate ${GATE_ERROR * 100}% of the time and a hazard unseen ${DODGE_ERROR * 100}% of the time.`);
  console.log(`${PLAYS} plays of each run at each upgrade state, seed ${SEED}: ${model.plays} plays in ${seconds.toFixed(1)} s.\n`);
  console.log("   upgrade      lv    cost   run   wins    gain   wins/pt");
  for (const p of plans) {
    const rate = p.upgrade === "coinMultiplier" ? "" : p.rate.toFixed(2);
    console.log(`   ${SHORT[p.upgrade].padEnd(12)} ${String(p.level).padStart(2)} ${String(p.cost).padStart(7)} ${String(p.run).padStart(5)} ${p.wins.toFixed(1).padStart(6)} ${p.gain.toFixed(1).padStart(7)}   ${rate}`);
  }
  for (const upgrade of ORDER) console.log(`   ${SHORT[upgrade].padEnd(12)} to max: ${tables[upgrade].reduce((sum, t) => sum + t.cost, 0)} coins`);
  // The reference player's odds on the walk, by stretch of runs, with the levels the tables give it.
  console.log("\n   runs      odds of the reference player, with what it owns by then");
  for (const [a, b] of [[1, 5], [6, 10], [11, 20], [21, 40], [41, 80], [81, 160], [161, 300]] as const) {
    let sum = 0;
    for (let level = a - 1; level < b; level++) {
      const owned = RunnerEconomy.reference(level, tables).levels;
      // The walk owns what it has bought even in the first world, where the tracks assume nothing.
      const mine: Levels = {};
      for (const upgrade of ORDER) mine[upgrade] = tables[upgrade].filter((t) => t.run <= level + 1).length;
      sum += model.measure(level, owned, mine).odds;
    }
    console.log(`   ${`${a}-${b}`.padEnd(9)} ${(100 * sum / (b - a + 1)).toFixed(0)}%`);
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const started = performance.now(), model = new Model();
  const { tables, plans } = design(model);
  const seconds = (performance.now() - started) / 1000;
  report(plans, tables, model, seconds);
  const same = render(tables) === render(baked());
  if (process.argv.includes("--write")) {
    write(tables);
    console.log(`\nwrote ${plans.length} levels into src/sim/runner/economy.ts${same ? " (no change)" : ""}`);
  } else {
    console.log(`\nThe tables in economy.ts ${same ? "are these" : "DIFFER from these: run with --write"}`);
    if (!same) process.exitCode = 1;
  }
}
