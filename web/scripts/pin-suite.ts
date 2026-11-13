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
//   npx tsx scripts/pin-suite.ts play  <level id | file.json> [p1,p2,...]   pull these in order and say how it ends
//   npx tsx scripts/pin-suite.ts audit <level id | file.json>               the audit's line for this level
//   npx tsx scripts/pin-suite.ts odds  <level id | file.json>               the share of random play that wins it
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { folderOf } from "../src/app/modetable";
import { moveOf, moves, playOut, type PinLevel } from "../src/sim/pinpull";
import { SeededRNG } from "../src/sim/runner/rng";
import type { Outcome } from "../src/sim/sk";
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

// MARK: one level from the command line

const run = async (verb: string, ref: string, pulls: string) => {
  if (!["play", "audit", "odds"].includes(verb) || !ref) {
    console.error("usage: npx tsx scripts/pin-suite.ts play|audit|odds <level id | file.json> [p1,p2,...]");
    process.exitCode = 1;
    return;
  }
  const level = levelFrom(ref);
  if (verb === "play") {
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
