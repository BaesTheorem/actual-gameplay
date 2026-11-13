// The Number Tower solver. The state of a play is the cleared set and the hero's number; the keys
// and the turn follow from the cleared set, so one memo table over those two numbers holds the
// count of winning orders, the best final number and the chance that a random player wins.
import { playBot } from "./bots";
import type { TowerLevel } from "./level";
import {
  LOSS, MOVE, WIN, execute, options, out, startState, type Probe,
} from "./rules";

/// Winning orders are counted exactly up to this many.
export const ORDER_CAP = 100000;

export interface Solution {
  solvable: boolean;
  /// The best final number any order reaches, 0 when no order wins.
  best: number;
  bestOrder: number[];
  /// The number of distinct complete winning orders, counted up to ORDER_CAP.
  winningOrders: number;
  /// True when there are more winning orders than ORDER_CAP.
  capped: boolean;
  /// The chance that a player who picks uniformly among the options at every step beats the boss.
  randomWin: number;
  bots: { smallest: boolean; wise: boolean };
  /// 0 when the "smallest" player wins, 1 when only the "wise" player wins, 2 when neither does.
  tier: 0 | 1 | 2;
  /// The largest number the hero holds in any play, apart from the gain of beating the boss.
  maxSeen: number;
  /// For each room, whether any play reaches its second thing.
  reachedSecond: boolean[];
  /// How many of the first moves win at once, and how many end the game.
  firstWins: number;
  firstLosses: number;
  /// How many states the search visited.
  states: number;
}

interface Node {
  count: number;
  best: number;
  prob: number;
  next: number;
}

const EMPTY: Node = { count: 0, best: -1, prob: 0, next: -1 };

/// A memo table keyed by the cleared set and the number.
class Memo<T> {
  private small = new Map<number, T>();
  private big = new Map<string, T>();
  size = 0;

  get(mask: number, power: number): T | undefined {
    if (power < 4194304) return this.small.get(mask * 4194304 + power);
    return this.big.get(`${mask}:${power}`);
  }

  set(mask: number, power: number, value: T) {
    this.size += 1;
    if (power < 4194304) this.small.set(mask * 4194304 + power, value);
    else this.big.set(`${mask}:${power}`, value);
  }
}

class Overflow extends Error {}

/// Solve a level by exhaustive search with memo.
export function solve(level: TowerLevel): Solution {
  return solveWithin(level, Infinity) as Solution;
}

/// Solve a level, or give up with null at once when any play makes the hero's number larger than
/// `limit`. The generator uses it to drop towers whose numbers run away before the search grows.
export function solveWithin(level: TowerLevel, limit: number): Solution | null {
  try {
    return search(level, limit);
  } catch (error) {
    if (error instanceof Overflow) return null;
    throw error;
  }
}

function search(level: TowerLevel, limit: number): Solution {
  const n = level.rooms.length;
  const probe: Probe = { max: level.start, second: new Uint8Array(n) };
  const memo = new Memo<Node>();

  const visit = (mask: number, power: number, keys: number, turn: number): Node => {
    const hit = memo.get(mask, power);
    if (hit) return hit;
    const opts = options(level, { power, keys, mask, turn });
    if (opts.length === 0) return EMPTY;
    let count = 0, best = -1, prob = 0, next = -1;
    for (const room of opts) {
      const status = execute(level, power, keys, turn, room, null, probe);
      if (probe.max > limit) throw new Overflow();
      if (status === WIN) {
        count += 1; prob += 1;
        if (out.power > best) { best = out.power; next = room; }
      } else if (status === MOVE) {
        const p2 = out.power, k2 = out.keys;
        const child = visit(mask | (1 << room), p2, k2, turn + 1);
        count += child.count; prob += child.prob;
        if (child.best > best) { best = child.best; next = room; }
      }
      if (count > ORDER_CAP + 1) count = ORDER_CAP + 1;
    }
    const node: Node = { count, best, prob: prob / opts.length, next };
    memo.set(mask, power, node);
    return node;
  };

  const root = visit(0, level.start, 0, 0);

  // The best order, followed through the memo.
  const bestOrder: number[] = [];
  if (root.best >= 0) {
    let mask = 0, power = level.start, keys = 0, turn = 0;
    for (;;) {
      const node = memo.get(mask, power);
      if (!node || node.next < 0) break;
      bestOrder.push(node.next);
      const status = execute(level, power, keys, turn, node.next);
      if (status !== MOVE) break;
      power = out.power; keys = out.keys; mask |= 1 << node.next; turn += 1;
    }
  }

  // First moves.
  let firstWins = 0, firstLosses = 0;
  for (const room of options(level, startState(level))) {
    const status = execute(level, level.start, 0, 0, room);
    if (status === WIN) firstWins += 1;
    else if (status === LOSS) firstLosses += 1;
    else if (options(level, { power: out.power, keys: out.keys, mask: 1 << room, turn: 1 }).length === 0) firstLosses += 1;
  }

  const bots = { smallest: playBot(level, "smallest").won, wise: playBot(level, "wise").won };
  return {
    solvable: root.best >= 0,
    best: Math.max(0, root.best),
    bestOrder,
    winningOrders: Math.min(root.count, ORDER_CAP),
    capped: root.count > ORDER_CAP,
    randomWin: root.prob,
    bots,
    tier: bots.smallest ? 0 : bots.wise ? 1 : 2,
    maxSeen: probe.max,
    reachedSecond: Array.from(probe.second, (v) => v === 1),
    firstWins,
    firstLosses,
    states: memo.size,
  };
}

/// The largest number the hero can hold just before he fights the boss, over every play. Zero
/// when no play reaches the boss. The boss must be too big to beat (the generator gives it a
/// huge number first), so that every approach ends in a lost fight that this search can read.
export function bossApproach(level: TowerLevel, limit = Infinity): number {
  const seen = new Memo<true>();
  let top = 0;
  let over = false;
  const visit = (mask: number, power: number, keys: number, turn: number) => {
    if (over || seen.get(mask, power)) return;
    seen.set(mask, power, true);
    for (const room of options(level, { power, keys, mask, turn })) {
      const status = execute(level, power, keys, turn, room);
      if (out.power > limit) { over = true; return; }
      if (status === MOVE) visit(mask | (1 << room), out.power, out.keys, turn + 1);
      else if (status === LOSS && out.cause === "fight" && out.boss && out.b > top) top = out.b;
    }
  };
  visit(0, level.start, 0, 0);
  return over ? 0 : top;
}
