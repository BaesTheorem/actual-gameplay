// Pull the Pin's replay, audit and odds with no browser. Nothing runs when this file is imported.
//   replay()       play every level's stored solution; the regression suite for physics and level files
//   auditLevel()   every pull sequence up to par, pruned at wins and deaths: the level is UNIQUE
//                  or the other winning orders are listed
//   odds()         the share of random pull orders that win, for the level statistics
// The audit and the odds decide which sequences to play and ask for each through a `Play`
// function, so the caller chooses where the simulations run: here, or in a pool of processes.
// A move is a pin or a group of linked pins, which one tap pulls together: both count a group once.
//
// Run as a script, it tries one level, from the campaign by id or from any level file:
//   npx tsx scripts/pin-suite.ts play    <level id | file.json> [p1,p2,...]   pull these in order and say how it ends
//   npx tsx scripts/pin-suite.ts audit   <level id | file.json>               the audit's line for this level
//   npx tsx scripts/pin-suite.ts odds    <level id | file.json>               the share of random play that wins it
//   npx tsx scripts/pin-suite.ts delayed <level id | file.json> [1.5,4]       the stored solution played slowly: each pull after
//                                                                             the first waits this many seconds past calm
//   npx tsx scripts/pin-suite.ts noise   <level id | file.json>               the stored solution eight times, with every body that
//                                                                             can move started a hair off its place: wins of 8
//   npx tsx scripts/pin-suite.ts soak    <level id | file.json>               the wider look for an edge: 61 waits and 96 noisy starts
//   npx tsx scripts/pin-suite.ts still   <level id | file.json>               six seconds with no pull: nothing may happen
//   npx tsx scripts/pin-suite.ts tree    <level id | file.json>               every pull order and how it ends
//   npx tsx scripts/pin-suite.ts check   <level id | file.json>               all of the above, and the level's size
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as planck from "planck";
import { folderOf } from "../src/app/modetable";
import { FRIEND_RADIUS, HERO_RADIUS, LIQUID_RADIUS, PinSim, moveOf, moves, playOut, type PinLevel } from "../src/sim/pinpull";
import { SeededRNG } from "../src/sim/runner/rng";
import { STEP, position, setPosition, speed, tagOf, type Outcome } from "../src/sim/sk";
import { idNumber, load, loadLevel } from "./levels";

export const FOLDER = folderOf("pinPull");

const STALL = "Settled short of the goal.";

/// How a pull sequence ended: it won, it ended in a way no further pull can change (a death, a
/// melt, a drain, no pins left), or the world settled with the goal unmet and pins still in place.
export type End = "won" | "lost" | "open";
const endOf = (outcome: Outcome | null): End =>
  outcome?.won ? "won" : outcome === null || outcome.reason === STALL ? "open" : "lost";

/// Play one pull sequence on a level from scratch and say how it ended.
export type Play = (level: PinLevel, pins: string[]) => Promise<End>;
export const playHere: Play = async (level, pins) => endOf(playOut(level, pins).outcome);

/// The same, by level id: the call a child process makes.
export const play = (id: string, pins: string[]): End => endOf(playOut(loadLevel<PinLevel>(FOLDER, id), pins).outcome);

/// A level of the campaign by its id, or any level file by its path.
export const levelFrom = (ref: string): PinLevel =>
  ref.endsWith(".json") ? JSON.parse(readFileSync(ref, "utf8")) as PinLevel : loadLevel<PinLevel>(FOLDER, ref);

const row = (level: PinLevel) => `${level.id.padEnd(20)} ${level.name.padEnd(22)}`;

export const replay = (): { passed: number; total: number } => {
  let passed = 0, total = 0;
  for (const level of load<PinLevel>(FOLDER)) {
    total += 1;
    const t0 = performance.now();
    const run = playOut(level, level.solution ?? []);
    const ok = run.outcome?.won === true;
    if (ok) passed += 1;
    const detail = run.outcome === null ? "no result" : run.outcome.won ? `${run.outcome.stars} stars` : run.outcome.reason;
    console.log(`${ok ? "PASS" : "FAIL"}  ${row(level)} ${detail}  (${run.seconds.toFixed(1)} s game, ${(performance.now() - t0).toFixed(0)} ms)`);
  }
  return { passed, total };
};

// MARK: the audit

/// Search pull sequences up to par, extending only the ones that neither won nor died.
/// A sequence that stalled (everything settled, nothing won) can still be extended; one that
/// ended in a death, a melt or a drain cannot, and one that won needs no more pulls.
const exhaustive = async (level: PinLevel, playOne: Play) => {
  const ids = moves(level);
  let frontier: string[][] = [[]];
  const winners: string[][] = [];
  let tried = 0;
  for (let k = 1; k <= level.parPins; k++) {
    const sequences = frontier.flatMap((prefix) => ids.filter((pin) => !prefix.includes(pin)).map((pin) => [...prefix, pin]));
    tried += sequences.length;
    const ends = await Promise.all(sequences.map((seq) => playOne(level, seq)));
    winners.push(...sequences.filter((_, i) => ends[i] === "won"));
    frontier = sequences.filter((_, i) => ends[i] === "open");
  }
  return { winners, tried };
};

/// Audit one level. The line is what the audit prints for it.
export const auditLevel = async (level: PinLevel, playOne: Play = playHere): Promise<{ line: string; flagged: boolean }> => {
  const { winners, tried } = await exhaustive(level, playOne);
  // A stored solution may name any pin of a group. The search names a group by its first pin.
  const solution = (level.solution ?? []).map((id) => moveOf(level, id)).join("+");
  const won = winners.map((w) => w.join("+"));
  let verdict: string;
  if (won.length === 0) verdict = "UNWINNABLE within par";
  else if (won.length === 1 && won[0] === solution) verdict = "UNIQUE";
  else if (won.includes(solution)) verdict = `NOT UNIQUE: also ${won.filter((w) => w !== solution).join(", ")}`;
  else verdict = `BROKEN: solution does not win; winners ${won.join(", ")}`;
  return {
    line: `${row(level)} par ${level.parPins}  ${String(tried).padStart(3)} sequences  ${verdict}`,
    flagged: verdict !== "UNIQUE",
  };
};

// MARK: the odds

/// What the statistics record for a level: the share of random play that wins, how many plays or
/// sequences that share was counted from, and whether it is the exact figure or an estimate.
export interface Odds { randomWin: number; sample: number; exact: boolean; detail: string }

/// The most sequences the exact count plays before it gives up and samples.
export const TREE_LIMIT = 400;
export const PLAYOUTS = 300;

/// The share of random play that wins a level.
///
/// The random player pulls one of the pins still in place, each as likely as the next, every time
/// the world has settled, and keeps going past par until the level is won or lost. Every pull
/// order is played from scratch: one that ends in a win or a loss is a leaf, and one that settles
/// short of the goal branches into each pin that is left. The share is the sum, over the orders
/// that win, of the chance of pulling exactly that order: one over the pins left, at each pull.
///
/// A level whose tree passes `limit` sequences is sampled: 300 random pull orders from a generator
/// seeded by the level's id, each followed down the same tree, and the share of them that win.
export const odds = async (level: PinLevel, playOne: Play = playHere, limit = TREE_LIMIT): Promise<Odds> => {
  const ids = moves(level);
  // Each sequence is played once, whoever asks for it and however often.
  const played = new Map<string, Promise<End>>();
  const end = (seq: string[]): Promise<End> => {
    const key = seq.join("+");
    let found = played.get(key);
    if (!found) {
      found = playOne(level, seq);
      played.set(key, found);
    }
    return found;
  };

  // The tree, a depth at a time. Every sequence at a depth has to be played for an exact answer,
  // so the tree is known to pass the limit before the depth that takes it past is played.
  let share = 0, winners = 0;
  let frontier: { seq: string[]; chance: number }[] = [{ seq: [], chance: 1 }];
  while (frontier.length > 0) {
    const next = frontier.flatMap(({ seq, chance }) => {
      const left = ids.filter((pin) => !seq.includes(pin));
      return left.map((pin) => ({ seq: [...seq, pin], chance: chance / left.length }));
    });
    if (played.size + next.length > limit) break;
    const ends = await Promise.all(next.map((node) => end(node.seq)));
    frontier = [];
    next.forEach((node, i) => {
      if (ends[i] === "won") { share += node.chance; winners += 1; }
      else if (ends[i] === "open") frontier.push(node);
    });
  }
  if (frontier.length === 0) {
    return { randomWin: share, sample: played.size, exact: true, detail: `${winners} of ${played.size} pull orders win` };
  }

  // Too big to count. A random pull order is a random shuffle of the pins, followed until it ends.
  const rng = new SeededRNG(idNumber(level.id));
  const orders: string[][] = [];
  for (let i = 0; i < PLAYOUTS; i++) {
    const order = [...ids];
    for (let k = order.length - 1; k > 0; k--) {
      const j = rng.int(0, k);
      [order[k], order[j]] = [order[j], order[k]];
    }
    orders.push(order);
  }
  const results = await Promise.all(orders.map(async (order) => {
    for (let k = 1; k <= order.length; k++) {
      const result = await end(order.slice(0, k));
      if (result !== "open") return result;
    }
    return "lost";
  }));
  const wins = results.filter((r) => r === "won").length;
  return { randomWin: wins / PLAYOUTS, sample: PLAYOUTS, exact: false, detail: `${wins} of ${PLAYOUTS} random pull orders won` };
};

// MARK: what a new level has to pass

/// The most moves a level may offer, and the most particles it may carry.
export const MOST_MOVES = 6;
export const MOST_PARTICLES = 420;
/// The waits a stored solution has to survive: every pull after the first held back this long.
export const HOLDS = [1.5, 4];

/// Play a level's stored solution slowly. Each pull after the first waits `hold` seconds past the
/// moment the replay would have made it, so an answer that only works on the first calm frame fails here.
export const delayed = (level: PinLevel, hold: number): { won: boolean; how: string; seconds: number } => {
  const { outcome, seconds } = playOut(level, level.solution ?? [], 240, hold);
  return { won: outcome?.won === true, how: outcome === null ? "no result" : outcome.won ? `won, ${outcome.stars} stars` : `lost: ${outcome.reason}`, seconds };
};

/// How far a noise replay moves each body from its place, in points, in x and in y.
export const NOISE = 0.05;
/// The seeds a stored solution is replayed under. Every one of them has to win.
export const NOISE_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/// Move every body of a level that can move a little off its place: each particle, the hero, the
/// gem, each goblin, the friend, each boulder and each crate, up to `amount` points in x and in
/// y, from a random source seeded by `seed`. With an amount of 0 nothing is touched.
export const nudge = (sim: PinSim, seed: number, amount = NOISE) => {
  if (amount === 0) return;
  const rng = new SeededRNG(seed);
  const bodies = [
    ...sim.particles.map((p) => p.body), sim.hero, sim.treasure, ...sim.foes.map((foe) => foe.body), sim.friend,
    ...sim.boulders.map((b) => b.body), ...sim.bombs.map((b) => b.body),
  ];
  for (const body of bodies) {
    if (!body) continue;
    const at = position(body);
    setPosition(body, { x: at.x + (rng.unit() * 2 - 1) * amount, y: at.y + (rng.unit() * 2 - 1) * amount });
  }
};

/// Play a pull order from a start that is a hair off the level file. The same simulation comes
/// out slightly differently on different processors, where the last bit of a sine is rounded
/// another way, so an order that only wins from the exact starting places is on an edge. A stored
/// solution has to win from every one of the eight seeded starts. With an amount of 0 this is
/// the plain replay.
export const playNoisy = (level: PinLevel, pins: string[], seed: number, amount = NOISE, maxSeconds = 120): { outcome: Outcome | null; seconds: number; pulled: number } => {
  const sim = new PinSim(level);
  nudge(sim, seed, amount);
  sim.replay(pins);
  const frames = Math.ceil(maxSeconds / STEP);
  for (let i = 0; i < frames && !sim.finished; i++) sim.frame();
  return { outcome: sim.outcome, seconds: sim.elapsed, pulled: sim.pulled.length };
};

/// The noise replay of a level's stored solution: how many of the eight seeded starts win, and
/// how each one that did not win ended.
export const noise = (level: PinLevel): { wins: number; lost: { seed: number; how: string }[] } => {
  const lost: { seed: number; how: string }[] = [];
  for (const seed of NOISE_SEEDS) {
    const { outcome } = playNoisy(level, level.solution ?? [], seed);
    if (outcome?.won !== true) lost.push({ seed, how: outcome === null ? "no result" : outcome.won ? "won" : outcome.reason });
  }
  return { wins: NOISE_SEEDS.length - lost.length, lost };
};

/// The waits of the soak: every pull after the first held 0 to 6 seconds past calm, in steps of a tenth.
export const SOAK_HOLDS = Array.from({ length: 61 }, (_, i) => i / 10);
/// How many noisy starts the soak tries, seeds 1 upward, at the noise replay's own amount.
export const SOAK_SEEDS = 96;

/// The wider look for an edge. Two waits and eight seeds can miss a solution that fails one time
/// in ten: a drop that rolls to the wrong place only when the pull comes two seconds late, or a
/// rock that meets its second goblin a little too slowly from one start in thirty. This plays the
/// stored solution at every wait of SOAK_HOLDS and from SOAK_SEEDS noisy starts and returns the
/// ones that did not win. It is some 160 replays, so it is run by hand and is no part of `check`.
export const soak = (level: PinLevel, holds = SOAK_HOLDS, seeds = SOAK_SEEDS): { holds: number[]; seeds: number[] } => {
  const solution = level.solution ?? [];
  // A wait changes nothing in a solution of one pull.
  const lostHolds = solution.length < 2 ? [] : holds.filter((hold) => !delayed(level, hold).won);
  const lostSeeds: number[] = [];
  for (let seed = 1; seed <= seeds; seed++) if (playNoisy(level, solution, seed).outcome?.won !== true) lostSeeds.push(seed);
  return { holds: lostHolds, seeds: lostSeeds };
};

/// How near anything deadly in flight came to someone during a level's stored solution: the
/// smallest gap, in points, between a moving bit of lava or gas and the hero, the friend or the
/// gem, edge to edge. A solution that wins with a gap of a point or two is one splash from losing.
export const margin = (level: PinLevel): number => {
  const sim = new PinSim(level);
  sim.replay(level.solution ?? []);
  let nearest = Infinity;
  for (let i = 0; i < Math.ceil(120 / STEP) && !sim.finished; i++) {
    sim.frame();
    const victims: [planck.Body | null, number][] = [[sim.hero, HERO_RADIUS], [sim.friend, FRIEND_RADIUS], [sim.treasure, 13]];
    for (const p of sim.particles) {
      if (p.kind === "water" || speed(p.body) < 30) continue;
      const at = position(p.body);
      for (const [body, radius] of victims) {
        if (!body || tagOf(body).removed) continue;
        const to = position(body);
        nearest = Math.min(nearest, Math.hypot(to.x - at.x, to.y - at.y) - radius - LIQUID_RADIUS);
      }
    }
  }
  return nearest;
};

/// What happened in a level that was left alone.
export interface Stillness {
  /// Who walked, who died or what ended, and which solid things moved more than a few points.
  events: string[];
  /// Particles at the start and at the end, the fastest of them over the last two seconds, and
  /// the farthest any of them travelled after the first two.
  particles: number; left: number; fastest: number; drift: number;
}

/// Leave a level alone for some seconds and report everything that happened. A level that is
/// ready has nothing to report: nobody walks, nothing dies, and the liquid lies where it was put.
export const stillness = (level: PinLevel, seconds = 6): Stillness => {
  const sim = new PinSim(level);
  const solids = (): [string, planck.Body | null][] => [
    ["the hero", sim.hero], ["the gem", sim.treasure], ["the friend", sim.friend],
    ...sim.foes.map((foe, i): [string, planck.Body] => [`goblin ${i + 1}`, foe.body]),
    ...sim.boulders.map((boulder, i): [string, planck.Body] => [`boulder ${i + 1}`, boulder.body]),
    ...sim.bombs.map((bomb, i): [string, planck.Body] => [`bomb ${i + 1}`, bomb.body]),
  ];
  const events = new Set<string>();
  const start = new Map(solids().filter(([, body]) => body).map(([name, body]) => [name, position(body!)]));
  const particles = sim.particles.length;
  let fastest = 0, drift = 0;
  let settled: Map<planck.Body, { x: number; y: number }> | null = null;
  let doorsAt: number[] | null = null;
  const frames = Math.ceil(seconds / STEP);
  for (let i = 0; i < frames && !sim.finished; i++) {
    sim.frame();
    if (sim.heroWalking) events.add("the hero walked");
    sim.foes.forEach((foe, n) => { if (foe.walking) events.add(`goblin ${n + 1} walked`); if (!foe.active) events.add(`goblin ${n + 1} was knocked out`); });
    if (sim.dying) events.add("someone died");
    // A door whose plate starts with a weight on it slides open as the level begins. That is
    // part of the level coming to rest, as a pool settling is. One that moves later is an event.
    if (sim.elapsed >= 1 && doorsAt === null) doorsAt = sim.doors.map((door) => door.open);
    if (doorsAt !== null && sim.doors.some((door, n) => door.open !== doorsAt![n])) events.add("a door moved");
    if (sim.bombs.some((bomb) => bomb.state !== "dry")) events.add("a bomb was lit or soaked");
    if (sim.cracked.some((wall) => wall.gone)) events.add("a cracked wall went");
    if (sim.elapsed >= 2 && settled === null) settled = new Map(sim.particles.map((p) => [p.body, position(p.body)]));
    if (sim.elapsed >= seconds - 2) for (const p of sim.particles) fastest = Math.max(fastest, speed(p.body));
  }
  if (sim.outcome) events.add(sim.outcome.won ? "the level was won" : `the level was lost: ${sim.outcome.reason}`);
  for (const [name, body] of solids()) {
    const from = start.get(name);
    if (!body || !from) continue;
    if (tagOf(body).removed) { events.add(`${name} is gone`); continue; }
    const to = position(body), by = Math.hypot(to.x - from.x, to.y - from.y);
    if (by > 3) events.add(`${name} moved ${by.toFixed(0)} points`);
  }
  for (const p of sim.particles) {
    const from = settled?.get(p.body);
    if (!from) continue;
    const to = position(p.body);
    drift = Math.max(drift, Math.hypot(to.x - from.x, to.y - from.y));
  }
  return { events: [...events], particles, left: sim.particles.length, fastest, drift };
};

/// One pull order of a level's tree: how it ended, and the loss in the game's own words.
export interface Branch { pins: string[]; end: End; reason: string }

/// Every pull order of a level, played out: one that wins or loses is a leaf, and one that
/// settles short of the goal goes on to each pin that is left. This is the tree the odds are
/// counted on, with each ending kept. It stops at `limit` orders.
export const tree = (level: PinLevel, limit = TREE_LIMIT): { branches: Branch[]; share: number; complete: boolean } => {
  const ids = moves(level), branches: Branch[] = [];
  let share = 0, frontier: { pins: string[]; chance: number }[] = [{ pins: [], chance: 1 }];
  while (frontier.length > 0 && branches.length < limit) {
    const next: typeof frontier = [];
    for (const { pins, chance } of frontier) {
      const left = ids.filter((pin) => !pins.includes(pin));
      for (const pin of left) {
        if (branches.length >= limit) break;
        const order = [...pins, pin], outcome = playOut(level, order).outcome, end = endOf(outcome);
        branches.push({ pins: order, end, reason: outcome === null ? "no result" : outcome.won ? "won" : outcome.reason });
        if (end === "won") share += chance / left.length;
        else if (end === "open") next.push({ pins: order, chance: chance / left.length });
      }
    }
    frontier = next;
  }
  return { branches, share, complete: frontier.length === 0 };
};

/// Everything a new level is held to, as lines to print, and whether it passed all of it.
const check = (level: PinLevel): { lines: string[]; passed: boolean } => {
  const lines: string[] = [], problems: string[] = [];
  const ids = moves(level), solution = level.solution ?? [], count = (level.pools ?? []).reduce((sum, pool) => sum + pool.count, 0);
  lines.push(`${level.id}  "${level.name}"  par ${level.parPins}  ${ids.length} moves  ${count} particles  ${level.winWhen}`);
  lines.push(`hint: ${level.hint ?? "(none)"}`);
  if (ids.length > MOST_MOVES) problems.push(`${ids.length} moves, and ${MOST_MOVES} is the most`);
  if (count > MOST_PARTICLES) problems.push(`${count} particles, and ${MOST_PARTICLES} is the most`);
  if (solution.length !== level.parPins) problems.push(`the solution has ${solution.length} pulls and par is ${level.parPins}`);

  const quiet = stillness(level);
  lines.push(`still: ${quiet.events.length === 0 ? "nothing happened" : quiet.events.join("; ")}  (${quiet.left} of ${quiet.particles} particles left, fastest ${quiet.fastest.toFixed(1)}, drift ${quiet.drift.toFixed(1)})`);
  if (quiet.events.length > 0) problems.push("the start is not still");
  if (quiet.left !== quiet.particles) problems.push("liquid was lost before any pull");
  if (quiet.fastest >= 6 || quiet.drift > 6) problems.push("the liquid does not settle");

  const { branches, share, complete } = tree(level);
  const named = solution.map((id) => moveOf(level, id)).join("+");
  const within = branches.filter((b) => b.end === "won" && b.pins.length <= level.parPins).map((b) => b.pins.join("+"));
  const verdict = within.length === 0 ? "UNWINNABLE within par" : within.length === 1 && within[0] === named ? "UNIQUE"
    : within.includes(named) ? `NOT UNIQUE: also ${within.filter((w) => w !== named).join(", ")}` : `BROKEN: solution does not win; winners ${within.join(", ")}`;
  const toPar = branches.filter((b) => b.pins.length <= level.parPins || b.end === "won");
  for (const b of toPar) lines.push(`  ${b.pins.join("+").padEnd(18)} ${b.end === "won" ? (b.pins.length <= level.parPins ? "WON" : "won over par") : b.end === "open" ? "open" : b.reason}`);
  const endings = new Map<string, number>();
  for (const b of branches) if (b.end !== "open") endings.set(b.reason, (endings.get(b.reason) ?? 0) + 1);
  lines.push(`endings: ${[...endings].map(([reason, n]) => `${n} ${reason}`).join(" | ")}`);
  lines.push(`audit: ${verdict}  (${branches.filter((b) => b.pins.length <= level.parPins).length} sequences to par, ${branches.length} in all${complete ? "" : ", tree cut short"})`);
  lines.push(`odds: ${(share * 100).toFixed(1)}%${complete ? "" : " at least"}`);
  if (verdict !== "UNIQUE") problems.push(verdict);
  const firsts = branches.filter((b) => b.pins.length === 1 && b.pins[0] !== moveOf(level, solution[0] ?? ""));
  const losses = new Set([...endings.keys()].filter((reason) => reason !== "won"));
  lines.push(`ways to lose: ${losses.size}  wrong first moves: ${firsts.map((b) => `${b.pins[0]} ${b.end === "open" ? "open" : b.end === "won" ? "WON" : b.reason}`).join(" | ")}`);

  const gap = margin(level);
  lines.push(`margin: ${Number.isFinite(gap) ? `moving lava or gas came within ${gap.toFixed(0)} points of someone during the solution` : "nothing deadly moved during the solution"}`);
  for (const hold of HOLDS) {
    const slow = delayed(level, hold);
    lines.push(`delayed ${hold} s: ${slow.how}  (${slow.seconds.toFixed(1)} s)`);
    if (!slow.won) problems.push(`the solution loses when each pull waits ${hold} s`);
  }
  const shaken = noise(level);
  lines.push(`noise: ${shaken.wins} of ${NOISE_SEEDS.length}${shaken.lost.map((l) => `  seed ${l.seed}: ${l.how}`).join("")}`);
  if (shaken.wins < NOISE_SEEDS.length) problems.push("the solution loses from a start a hair off its place");
  lines.push(problems.length === 0 ? "PASS" : `FAIL: ${problems.join("; ")}`);
  return { lines, passed: problems.length === 0 };
};

// MARK: one level from the command line

const run = async (verb: string, ref: string, pulls: string) => {
  if (!["play", "audit", "odds", "delayed", "noise", "soak", "still", "tree", "check"].includes(verb) || !ref) {
    console.error("usage: npx tsx scripts/pin-suite.ts play|audit|odds|delayed|noise|soak|still|tree|check <level id | file.json> [p1,p2,...]");
    process.exitCode = 1;
    return;
  }
  const level = levelFrom(ref);
  if (verb === "check") {
    const { lines, passed } = check(level);
    console.log(lines.join("\n"));
    if (!passed) process.exitCode = 1;
  } else if (verb === "delayed") {
    for (const hold of pulls ? pulls.split(",").map(Number) : HOLDS) {
      const slow = delayed(level, hold);
      console.log(`${row(level)} ${(level.solution ?? []).join("+")}  each pull held ${hold} s  ${slow.how}  (${slow.seconds.toFixed(2)} s game)`);
      if (!slow.won) process.exitCode = 1;
    }
  } else if (verb === "noise") {
    const shaken = noise(level);
    console.log(`${row(level)} ${(level.solution ?? []).join("+")}  ${shaken.wins} of ${NOISE_SEEDS.length}${shaken.lost.map((l) => `  seed ${l.seed}: ${l.how}`).join("")}`);
    if (shaken.wins < NOISE_SEEDS.length) process.exitCode = 1;
  } else if (verb === "soak") {
    const lost = soak(level);
    const waits = (level.solution ?? []).length < 2 ? 0 : SOAK_HOLDS.length;
    console.log(`${row(level)} ${(level.solution ?? []).join("+")}  waits ${waits - lost.holds.length} of ${waits}  noise ${SOAK_SEEDS - lost.seeds.length} of ${SOAK_SEEDS}`
      + `${lost.holds.length ? `  lost at waits ${lost.holds.join(" ")}` : ""}${lost.seeds.length ? `  lost from seeds ${lost.seeds.join(" ")}` : ""}`);
    if (lost.holds.length + lost.seeds.length > 0) process.exitCode = 1;
  } else if (verb === "still") {
    const quiet = stillness(level);
    console.log(`${row(level)} ${quiet.events.length === 0 ? "nothing happened" : quiet.events.join("; ")}  (${quiet.left} of ${quiet.particles} particles left, fastest ${quiet.fastest.toFixed(1)} pt/s, drift ${quiet.drift.toFixed(1)} pt)`);
    if (quiet.events.length > 0 || quiet.left !== quiet.particles) process.exitCode = 1;
  } else if (verb === "tree") {
    const { branches, share, complete } = tree(level);
    for (const b of branches) console.log(`${b.pins.join("+").padEnd(24)} ${b.end.padEnd(5)} ${b.end === "lost" ? b.reason : ""}`);
    console.log(`${row(level)} ${(share * 100).toFixed(1)}%  ${branches.length} pull orders${complete ? "" : ", cut short"}`);
  } else if (verb === "play") {
    const pins = pulls ? pulls.split(",") : [];
    const { outcome, seconds, pulled } = playOut(level, pins);
    const how = outcome === null ? "no result" : outcome.won ? `won, ${outcome.stars} stars` : `lost: ${outcome.reason}`;
    console.log(`${row(level)} ${pins.join("+") || "no pulls"}  ${how}  (${pulled} pulled, ${seconds.toFixed(2)} s game, ${endOf(outcome)})`);
  } else if (verb === "audit") {
    console.log((await auditLevel(level)).line);
  } else {
    const found = await odds(level);
    console.log(`${row(level)} ${(found.randomWin * 100).toFixed(1)}%  ${found.exact ? "exact" : "estimate"}  ${found.detail}`);
  }
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run(process.argv[2] ?? "", process.argv[3] ?? "", process.argv[4] ?? "");
}
