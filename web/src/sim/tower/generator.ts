// The Number Tower level generator. It builds a random candidate, sizes the boss from the best
// number a hero can bring to it, solves the candidate, and keeps it only when it meets the recipe
// and the rules every level must meet. The same recipe and seed give the same level in Node and
// in a browser, because the only source of numbers is the seeded generator.
import {
  roomCount, validateLevel,
  type Piece, type Room, type Thing, type ThingKind, type TowerLevel,
} from "./level";
import { Rng, hashSeed } from "./rng";
import { mirrorOf, options } from "./rules";
import { ORDER_CAP, bossApproach, solve, solveWithin, type Solution } from "./solver";

export type PaletteKind = Exclude<ThingKind, "boss">;

export interface Recipe {
  /// The grid sizes a level can have: w columns by h floors.
  grids: { w: number; h: number }[];
  /// True when every room is an entry (the classic ad). False when only ground floor rooms are.
  allEntries: boolean;
  /// Weight of each kind of thing in the rooms other than the boss.
  palette: Partial<Record<PaletteKind, number>>;
  /// The chance that a room carries a weight limit, and the chance that it is locked.
  limitShare?: number;
  lockShare?: number;
  /// The share of doorways that get a wall, where the tower stays connected.
  wallShare: number;
  /// The chance that a cell is empty.
  holes?: number;
  /// How many rooms hold two things, from lo to hi.
  twoThings: [number, number];
  /// The tiers a level can have.
  tiers: (0 | 1 | 2)[];
  /// The band for the chance that a random player wins.
  randomWin: [number, number];
  /// The band for the number of winning orders. Use Infinity for no top.
  orders: [number, number];
  /// The fewest rooms in the best order.
  minSolution: number;
  /// Pieces that must appear in the level.
  featured?: Piece[];
  /// The hero's starting number, from lo to hi. Default 3 to 8.
  start?: [number, number];
  /// The boss's number as a share of the best number reachable before it. Default 0.8 to 0.97.
  bossShare?: [number, number];
  /// How many candidates to try before giving up. Default 3000.
  maxCandidates?: number;
}

export const NUMBER_LIMIT = 999;
export const BEST_LIMIT = 9999;
const BOSS_SENTINEL = 1000000000;

// MARK: structure

const connected = (w: number, h: number, live: boolean[], walls: Set<number>, entries: number[]): boolean => {
  const n = w * h;
  const seen = new Array<boolean>(n).fill(false);
  const stack = [...entries];
  for (const e of stack) seen[e] = true;
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const near: number[] = [];
    if (i % w > 0) near.push(i - 1);
    if (i % w < w - 1) near.push(i + 1);
    if (i >= w) near.push(i - w);
    if (i + w < n) near.push(i + w);
    for (const j of near) {
      if (live[j] && !seen[j] && !walls.has(i * 64 + j)) { seen[j] = true; stack.push(j); }
    }
  }
  return live.every((l, i) => !l || seen[i]);
};

/// The rooms that can be reached from the entries through doorways, ignoring locks and numbers.
export const reachable = (level: TowerLevel): boolean[] => {
  const walls = new Set<number>();
  for (const [a, b] of level.walls) { walls.add(a * 64 + b); walls.add(b * 64 + a); }
  const n = level.w * level.h;
  const seen = new Array<boolean>(n).fill(false);
  const stack = [...level.entries];
  for (const e of stack) seen[e] = true;
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const near: number[] = [];
    if (i % level.w > 0) near.push(i - 1);
    if (i % level.w < level.w - 1) near.push(i + 1);
    if (i >= level.w) near.push(i - level.w);
    if (i + level.w < n) near.push(i + level.w);
    for (const j of near) {
      if (level.rooms[j] && !seen[j] && !walls.has(i * 64 + j)) { seen[j] = true; stack.push(j); }
    }
  }
  return seen;
};

// MARK: numbers

const placeholder = (kind: ThingKind): Thing => {
  switch (kind) {
    case "enemy": return { kind, n: 0 };
    case "boss": return { kind, n: BOSS_SENTINEL };
    case "grower": return { kind, n: 0, grow: 1 };
    case "plus": return { kind, n: 0 };
    case "minus": return { kind, n: 0 };
    case "times": return { kind, k: 2 };
    case "halve": return { kind, k: 2 };
    case "mirror": return { kind };
    case "key": return { kind };
  }
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/// Give a thing a number that suits a hero of this size, as if he walked in now.
const size = (rng: Rng, kind: ThingKind, power: number, turn: number): Thing => {
  switch (kind) {
    case "enemy": return { kind, n: clamp(Math.floor(power * rng.range(0.3, 0.95)), 1, Math.max(1, power - 1)) };
    case "grower": {
      const grow = rng.int(1, 3);
      const aim = Math.floor(power * rng.range(0.3, 0.9));
      return { kind, n: Math.max(1, aim - grow * turn), grow };
    }
    case "plus": return { kind, n: Math.max(1, Math.floor(power * rng.range(0.2, 0.8))) };
    case "minus": return { kind, n: clamp(Math.floor(power * rng.range(0.15, 0.5)), 1, Math.max(1, power - 1)) };
    case "times": { const roll = rng.next(); return { kind, k: roll < 0.6 ? 2 : roll < 0.9 ? 3 : 4 }; }
    case "halve": return { kind, k: rng.chance(0.7) ? 2 : 3 };
    default: return placeholder(kind);
  }
};

/// What the hero's number becomes after a thing, for sizing only (the rules are in rules.ts).
const after = (t: Thing, power: number, turn: number): number => {
  switch (t.kind) {
    case "enemy": return power + t.n;
    case "grower": return power + t.n + t.grow * turn;
    case "plus": return power + t.n;
    case "times": return power * t.k;
    case "minus": return Math.max(1, power - t.n);
    case "halve": return Math.max(1, Math.floor(power / t.k));
    case "mirror": return mirrorOf(power);
    default: return power;
  }
};

// MARK: building

const build = (rng: Rng, recipe: Recipe): TowerLevel | null => {
  const { w, h } = rng.pick(recipe.grids);
  const n = w * h;
  const bossIdx = (h - 1) * w + rng.int(0, w - 1);
  const live = new Array<boolean>(n).fill(true);
  if (recipe.holes) {
    for (let i = 0; i < n; i++) if (i !== bossIdx && rng.chance(recipe.holes)) live[i] = false;
  }
  const ground = [];
  for (let i = 0; i < w; i++) if (live[i]) ground.push(i);
  if (ground.length === 0) return null;
  const entries = recipe.allEntries ? live.flatMap((l, i) => (l ? [i] : [])) : ground;
  const liveRooms = live.flatMap((l, i) => (l ? [i] : []));

  // Which rooms hold two things.
  const twoCount = Math.min(rng.int(recipe.twoThings[0], recipe.twoThings[1]), liveRooms.length);
  const two = new Set(rng.shuffle(liveRooms).slice(0, twoCount));

  const kinds: ThingKind[][] = new Array(n).fill(null).map(() => []);
  for (const i of liveRooms) {
    const count = two.has(i) ? 2 : 1;
    for (let j = 0; j < count; j++) {
      kinds[i]?.push(i === bossIdx && j === count - 1 ? "boss" : rng.weighted(recipe.palette));
    }
  }
  const limited = new Array<boolean>(n).fill(false);
  const locked = new Array<boolean>(n).fill(false);
  const others = liveRooms.filter((i) => i !== bossIdx);
  for (const i of liveRooms) {
    if (recipe.limitShare && rng.chance(recipe.limitShare)) limited[i] = true;
    if (recipe.lockShare && rng.chance(recipe.lockShare)) locked[i] = true;
  }
  // Make sure every featured piece is there, and that every locked room has a key to open it in a
  // room that is not locked itself.
  const free = others.filter((i) => !locked[i]);
  for (const piece of recipe.featured ?? []) {
    if (others.length === 0) break;
    if (piece === "limit") { if (!limited.some(Boolean)) limited[rng.pick(others)] = true; }
    else if (piece === "lock") { if (!locked.some(Boolean)) locked[rng.pick(others)] = true; }
    else if (!kinds.some((list) => list.includes(piece))) {
      const pool = piece === "key" && free.length > 0 ? free : others;
      (kinds[rng.pick(pool)] as ThingKind[])[0] = piece;
    }
  }
  const keyCount = () => kinds.reduce((c, list, i) => c + (locked[i] ? 0 : list.filter((k) => k === "key").length), 0);
  const lockCount = () => locked.filter(Boolean).length;
  const keyRooms = others.filter((i) => !locked[i]);
  for (let attempt = 0; attempt < 12 && keyCount() < lockCount() && keyRooms.length > 0; attempt++) {
    (kinds[rng.pick(keyRooms)] as ThingKind[])[0] = "key";
  }

  // Walls, kept only where the whole tower stays connected.
  const walls = new Set<number>();
  const wallList: [number, number][] = [];
  const pairs: [number, number][] = [];
  for (const i of liveRooms) {
    if (i % w < w - 1 && live[i + 1]) pairs.push([i, i + 1]);
    if (i + w < n && live[i + w]) pairs.push([i, i + w]);
  }
  if (recipe.wallShare > 0) {
    for (const [a, b] of rng.shuffle(pairs)) {
      if (!rng.chance(recipe.wallShare)) continue;
      walls.add(a * 64 + b); walls.add(b * 64 + a);
      if (connected(w, h, live, walls, entries)) wallList.push(a < b ? [a, b] : [b, a]);
      else { walls.delete(a * 64 + b); walls.delete(b * 64 + a); }
    }
  }
  if (!connected(w, h, live, walls, entries)) return null;
  wallList.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  const rooms: (Room | null)[] = new Array(n).fill(null);
  for (const i of liveRooms) {
    const room: Room = { things: (kinds[i] as ThingKind[]).map(placeholder) };
    if (locked[i]) room.locked = true;
    rooms[i] = room;
  }
  const level: TowerLevel = { start: rng.int(recipe.start?.[0] ?? 3, recipe.start?.[1] ?? 8), w, h, rooms, walls: wallList, entries };

  // Walk the tower in a random order, sizing each room for the hero who arrives there.
  let power = level.start, keys = 0, mask = 0, turn = 0;
  const done = new Array<boolean>(n).fill(false);
  const visit = (idx: number) => {
    const room = rooms[idx] as Room;
    done[idx] = true;
    if (room.locked) keys -= 1;
    if (limited[idx]) room.max = Math.max(1, power + Math.floor(power * rng.range(0, 0.35)));
    room.things = room.things.map((t) => {
      if (t.kind === "boss") return t;
      const sized = size(rng, t.kind, power, turn);
      power = after(sized, power, turn);
      if (sized.kind === "key") keys += 1;
      return sized;
    });
  };
  for (;;) {
    const opts = options(level, { power, keys, mask, turn }).filter((i) => i !== bossIdx);
    if (opts.length === 0) break;
    const idx = rng.pick(opts);
    visit(idx);
    mask |= 1 << idx;
    turn += 1;
  }
  for (const i of liveRooms) if (!done[i]) visit(i);

  // The boss: as strong as most of the best number a hero can bring to it.
  const approach = bossApproach(level, NUMBER_LIMIT);
  if (approach < 3) return null;
  const share = rng.range(recipe.bossShare?.[0] ?? 0.8, recipe.bossShare?.[1] ?? 0.97);
  const bossN = clamp(Math.floor(approach * share), 1, approach - 1);
  const boss = (rooms[bossIdx] as Room).things.length - 1;
  (rooms[bossIdx] as Room).things[boss] = { kind: "boss", n: bossN };
  return level;
};

// MARK: checking

/// Every number printed in the level, as the largest one a player can read on a room.
const largestPrinted = (level: TowerLevel): number => {
  let top = level.start;
  const floors = level.rooms.length;
  for (const room of level.rooms) {
    if (!room) continue;
    if (room.max !== undefined) top = Math.max(top, room.max);
    for (const t of room.things) {
      if (t.kind === "grower") top = Math.max(top, t.n + t.grow * (floors - 1));
      else if ("n" in t) top = Math.max(top, t.n);
      else if ("k" in t) top = Math.max(top, t.k);
    }
  }
  return top;
};

/// The problems with a level, empty when it is fine. These are the rules every level must meet.
/// With a recipe it also checks the level against the recipe.
export function checkLevel(level: TowerLevel, recipe?: Recipe, solution?: Solution): string[] {
  try {
    validateLevel(level);
  } catch (error) {
    return [(error as Error).message];
  }
  const problems: string[] = [];
  const seen = reachable(level);
  level.rooms.forEach((room, i) => { if (room && !seen[i]) problems.push(`room ${i} cannot be reached`); });
  if (problems.length > 0) return problems;
  const printed = largestPrinted(level);
  if (printed > NUMBER_LIMIT) problems.push(`a printed number reaches ${printed}`);
  const s = solution ?? solve(level);
  if (!s.solvable) return [...problems, "no order wins"];
  if (s.maxSeen > NUMBER_LIMIT) problems.push(`the hero's number reaches ${s.maxSeen}`);
  if (s.best > BEST_LIMIT) problems.push(`best reaches ${s.best}`);
  if (s.firstWins > 0) problems.push("the boss can be beaten on the first move");
  if (s.firstLosses === 0) problems.push("no first move loses");
  level.rooms.forEach((room, i) => {
    if (room && room.things.length === 2 && !s.reachedSecond[i]) problems.push(`room ${i} has a second thing no play can reach`);
  });
  if (recipe) {
    const count = s.capped ? ORDER_CAP + 1 : s.winningOrders;
    if (!recipe.grids.some((g) => g.w === level.w && g.h === level.h)) problems.push(`grid ${level.w}x${level.h} is not in the recipe`);
    const live = roomCount(level);
    const ground = level.rooms.flatMap((r, i) => (r && i < level.w ? [i] : []));
    const wanted = recipe.allEntries ? level.rooms.flatMap((r, i) => (r ? [i] : [])) : ground;
    if (level.entries.length !== wanted.length || !wanted.every((e) => level.entries.includes(e))) {
      problems.push(recipe.allEntries ? "not every room is an entry" : "entries are not the ground floor");
    }
    if (!recipe.tiers.includes(s.tier)) problems.push(`tier ${s.tier} is not wanted`);
    if (s.randomWin < recipe.randomWin[0] || s.randomWin > recipe.randomWin[1]) problems.push(`randomWin ${s.randomWin.toFixed(3)} is outside the band`);
    if (count < recipe.orders[0] || count > recipe.orders[1]) problems.push(`${s.capped ? "more than " : ""}${s.winningOrders} winning orders is outside the band`);
    if (s.bestOrder.length < recipe.minSolution) problems.push(`the best order enters ${s.bestOrder.length} rooms, fewer than ${recipe.minSolution}`);
    const missing = (recipe.featured ?? []).filter((p) => {
      if (p === "limit") return !level.rooms.some((r) => r?.max !== undefined);
      if (p === "lock") return !level.rooms.some((r) => r?.locked);
      return !level.rooms.some((r) => r?.things.some((t) => t.kind === p));
    });
    if (missing.length > 0) problems.push(`featured pieces missing: ${missing.join(", ")}`);
    if (recipe.featured?.includes("lock") && !s.bestOrder.some((i) => level.rooms[i]?.locked)) {
      problems.push("the best order never opens a lock");
    }
    if (live > 30) problems.push("too many rooms");
  }
  return problems;
}

// MARK: generating

export interface Generation {
  level: TowerLevel | null;
  /// How many candidates were built, including the one kept.
  candidates: number;
}

/// Build candidates from the seed until one meets the recipe, or give up. The level carries the
/// best order, its final number and the seed; a caller adds the id, name and hint.
export function generateDetailed(recipe: Recipe, seed: number): Generation {
  const limit = recipe.maxCandidates ?? 3000;
  const rng = new Rng(seed);
  for (let c = 1; c <= limit; c++) {
    const candidate = build(rng, recipe);
    if (!candidate) continue;
    // Cheap rules first: a boss that falls on the first move or a printed number over the limit.
    if (largestPrinted(candidate) > NUMBER_LIMIT) continue;
    const s = solveWithin(candidate, NUMBER_LIMIT);
    if (!s) continue;
    if (checkLevel(candidate, recipe, s).length > 0) continue;
    const level: TowerLevel = { ...candidate, solution: s.bestOrder, best: s.best, seed };
    return { level, candidates: c };
  }
  return { level: null, candidates: limit };
}

export function generate(recipe: Recipe, seed: number): TowerLevel | null {
  return generateDetailed(recipe, seed).level;
}

// MARK: the daily level

const DAILY: Recipe = {
  grids: [{ w: 2, h: 3 }, { w: 3, h: 2 }, { w: 2, h: 4 }, { w: 3, h: 3 }],
  allEntries: false,
  palette: { enemy: 6, plus: 3, times: 2, minus: 1.5, halve: 1, mirror: 1, key: 1, grower: 1 },
  limitShare: 0.15,
  lockShare: 0.08,
  wallShare: 0.2,
  twoThings: [0, 2],
  tiers: [1, 2],
  randomWin: [0, 0.4],
  orders: [1, 200],
  minSolution: 4,
  maxCandidates: 4000,
};

/// One tier 1 or 2 tower of middling size for a date such as "2026-11-12". Everyone gets the
/// same tower on the same date. It is generated at call time.
export function daily(dateString: string): TowerLevel {
  const seed = hashSeed(`number-tower-daily-${dateString}`);
  const level = generate(DAILY, seed)
    ?? generate({ ...DAILY, randomWin: [0, 1], orders: [1, Infinity], minSolution: 3 }, seed);
  if (!level) throw new Error(`No daily tower for ${dateString}.`);
  return {
    id: `daily-${dateString}`,
    name: `Daily ${dateString}`,
    hint: "The same tower for everyone today.",
    ...level,
  };
}

export const DAILY_RECIPE = DAILY;
