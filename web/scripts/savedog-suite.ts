// Save the Clawd's replay, audit and odds with no browser. Nothing runs when this file is imported.
//   replay()       play every level's stored solution; the regression suite for physics and level files
//   auditLevel()   the stored solution shifted and scaled eight ways, five naive strokes, and
//                  (with `random`) that many plausible random strokes for a difficulty number
//   odds()         the share of 48 plausible random strokes that survive, for the level statistics
import { folderOf } from "../src/app/modetable";
import { playOut, type Attempt, type DogLevel } from "../src/sim/savedog";
import { baseTransform } from "../src/sim/savedog/level";
import type { Vec } from "../src/sim/sk";
import { idNumber, load, loadLevel } from "./levels";

// The table of solutions this engine replays shifted is keyed by level id. It lives beside the
// level types, where the scene that draws a hint can read it too.
export { WEB_SOLUTIONS, baseTransform } from "../src/sim/savedog/level";

export const FOLDER = folderOf("saveDog");

const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);

export const replay = (): { passed: number; total: number } => {
  let passed = 0, total = 0;
  for (const level of load<DogLevel>(FOLDER)) {
    total += 1;
    const t0 = performance.now();
    const base = baseTransform(level);
    const run = playOut(level, { transform: base });
    const ok = run.outcome?.won === true;
    if (ok) passed += 1;
    const detail = run.outcome === null ? "no result" : run.outcome.won ? `${run.outcome.stars} stars, ink ${Math.round(run.ink)}` : run.outcome.reason;
    const shift = base.dx === 0 ? "" : `  (solution shifted ${signed(base.dx)} pt for this engine)`;
    console.log(`${ok ? "PASS" : "FAIL"}  ${level.id.padEnd(20)} ${level.name.padEnd(22)} ${detail}  (${run.seconds.toFixed(1)} s game, ${(performance.now() - t0).toFixed(0)} ms)${shift}`);
  }
  return { passed, total };
};

// MARK: the random strokes

/// Python's `random.Random`: the Mersenne Twister with CPython's seeding and its ways of drawing a
/// float, a choice and a uniform. The audit's random strokes are defined by that generator, so
/// the same seed has to give the same strokes here.
export class PyRandom {
  private mt = new Uint32Array(624);
  private index = 624;

  constructor(seed: number) {
    // CPython seeds from the integer's 32-bit words, low word first, through init_by_array.
    const key: number[] = [];
    let rest = Math.abs(Math.trunc(seed));
    do {
      key.push(rest % 2 ** 32);
      rest = Math.floor(rest / 2 ** 32);
    } while (rest > 0);
    const mt = this.mt;
    mt[0] = 19650218;
    for (let i = 1; i < 624; i++) mt[i] = (Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i) >>> 0;
    let i = 1, j = 0;
    for (let k = Math.max(624, key.length); k > 0; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
      i += 1;
      j += 1;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k > 0; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i) >>> 0;
      i += 1;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
    }
    mt[0] = 0x80000000;
  }

  private uint32(): number {
    const mt = this.mt;
    if (this.index >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
        mt[k] = mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.index = 0;
    }
    let y = mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /// A float in [0, 1) with 53 random bits.
  random(): number {
    const a = this.uint32() >>> 5, b = this.uint32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  uniform(a: number, b: number): number { return a + (b - a) * this.random(); }

  /// One of `items`, by rejection on the smallest number of bits that covers the count.
  choice<T>(items: readonly T[]): T {
    const n = items.length;
    const bits = 32 - Math.clz32(n);
    let r = this.uint32() >>> (32 - bits);
    while (r >= n) r = this.uint32() >>> (32 - bits);
    return items[r];
  }
}

/// Python's `round(x, 1)`: the nearest tenth of the exact value, and an exact half goes to the even digit.
const round1 = (x: number): number => {
  const up = Number(x.toFixed(1));
  // Only a quarter or three quarters is an exact half of a tenth in binary.
  if (Number.isInteger(x * 4) && Math.abs(x * 4) % 2 === 1) {
    const digit = Math.round(Math.abs(up) * 10) % 10;
    if (digit % 2 === 1) return Number((up - Math.sign(x) * 0.1).toFixed(1));
  }
  return up;
};

/// Plausible strokes a player might try: lines and arcs near him, within the ink budget.
///
/// The point is a difficulty number, not a solver. A level where a quarter of these win is easy;
/// one where none do is a puzzle that needs the idea, not a lucky scribble.
///
/// The generator is seeded with `seed` times a thousand plus a number for the level. That number
/// was the level's place in the list; it is now three digits of a hash of the level's id, so a
/// level keeps its strokes when the chapters are rearranged.
export const randomStrokes = (level: DogLevel, n: number, seed = 7): number[][][] => {
  const rng = new PyRandom(seed * 1000 + (idNumber(level.id) % 1000));
  if (level.dogs.length === 0) return [];
  const { x, y } = level.dogs[0];
  const budget = level.inkBudget ?? 200;
  const out: number[][][] = [];
  for (let k = 0; k < n; k++) {
    const kind = rng.choice(["bar", "bar", "arc", "arc", "arc", "wall", "l", "tent"] as const);
    const length = rng.uniform(0.45, 0.95) * budget;
    const cx = x + rng.uniform(-40, 40);
    const top = Math.min(y + rng.uniform(25, 90), 760);
    let pts: number[][];
    if (kind === "bar") {
      pts = [[cx - length / 2, top], [cx + length / 2, top]];
    } else if (kind === "arc") {
      const r = Math.min(length / Math.PI, 140);
      const lift = rng.uniform(0, 30);
      pts = [];
      for (let i = 0; i < 11; i++) {
        const a = (Math.PI * i) / 10;
        pts.push([cx + r * Math.cos(a), y - 10 + lift + r * Math.sin(a)]);
      }
    } else if (kind === "wall") {
      const side = rng.choice([-1, 1] as const);
      const x0 = cx + side * rng.uniform(28, 60);
      const x1 = cx + side * rng.uniform(28, 60);
      pts = [[x0, y - 14], [x1, y - 14 + Math.min(length, 140)]];
    } else if (kind === "l") {
      const side = rng.choice([-1, 1] as const);
      const h = Math.min(length * 0.45, 120);
      pts = [[cx - side * length * 0.35, top], [cx + side * 30, top], [cx + side * 30, top - h]];
    } else {
      const half = Math.min(length / 2.3, 120);
      pts = [[cx - half, y - 12], [cx, y - 12 + half * 0.9], [cx + half, y - 12]];
    }
    out.push(pts.map(([px, py]) => [round1(Math.min(Math.max(px, 8), 394)), round1(Math.min(Math.max(py, 40), 800))]));
  }
  return out;
};

// MARK: the audit

const toVec = (stroke: number[][]): Vec[] => stroke.map(([x, y]) => ({ x, y }));

/// Every trial the audit plays on one level, by name.
export const trials = (level: DogLevel, random = 0): Map<string, Attempt> => {
  const plan = new Map<string, Attempt>();
  // Every wobble starts from the solution this engine replays, so a shifted level is wobbled about its shift.
  const base = baseTransform(level);
  plan.set("solution", { transform: base });
  for (const [dx, dy] of [[-10, 0], [-5, 0], [5, 0], [10, 0], [0, -10], [0, 10]]) {
    plan.set(`jitter:${signed(dx)},${signed(dy)}`, { transform: { dx: base.dx + dx, dy: base.dy + dy, scale: base.scale } });
  }
  for (const scale of [0.85, 1.15]) plan.set(`scale:${scale}`, { transform: { ...base, scale: base.scale * scale } });
  if (level.dogs.length > 0) {
    const { x, y } = level.dogs[0];
    const top = Math.min(y + 60, 740);
    const dumb: Record<string, number[][]> = {
      drop: [[x - 20, top], [x + 20, top]],
      bar: [[x - 90, top], [x + 90, top]],
      "wall-left": [[x - 40, y - 12], [x - 40, y + 70]],
      "wall-right": [[x + 40, y - 12], [x + 40, y + 70]],
      roof: [[x - 60, y + 40], [x + 60, y + 40]],
    };
    for (const [name, stroke] of Object.entries(dumb)) plan.set(`dumb:${name}`, { strokes: [toVec(stroke)] });
  }
  randomStrokes(level, random).forEach((stroke, k) => {
    plan.set(`random:${String(k).padStart(2, "0")}`, { strokes: [toVec(stroke)] });
  });
  return plan;
};

/// The verdict for one level from which of its trials won.
export const verdict = (names: string[], won: Set<string>): string => {
  const flags: string[] = [];
  const jit = names.filter((n) => n.startsWith("jitter:") || n.startsWith("scale:"));
  const dumb = names.filter((n) => n.startsWith("dumb:"));
  const rnd = names.filter((n) => n.startsWith("random:"));
  if (!won.has("solution")) flags.push("BROKEN: stored solution does not win");
  if (jit.length > 0) {
    const wins = jit.filter((n) => won.has(n)).length;
    if (wins / jit.length < 0.5) flags.push(`FRAGILE: only ${wins}/${jit.length} perturbed solutions win`);
  }
  const dumbWins = dumb.filter((n) => won.has(n)).map((n) => n.slice(5)).sort();
  if (dumbWins.length > 0) flags.push(`TRIVIAL: dumb stroke wins (${dumbWins.join(", ")})`);
  if (rnd.length > 0) {
    const wins = rnd.filter((n) => won.has(n)).length;
    flags.push(`random strokes win ${wins}/${rnd.length}${wins / rnd.length >= 0.25 ? " EASY" : ""}`);
  }
  const real = flags.filter((f) => !f.startsWith("random strokes"));
  if (real.length > 0) return flags.join("; ");
  return flags.length > 0 ? `ok; ${flags.join("; ")}` : "ok";
};

/// Stress one level by id. The line is what the audit prints for it.
export const auditLevel = (id: string, random = 0): { line: string; flagged: boolean } => {
  const level = loadLevel<DogLevel>(FOLDER, id);
  const plan = trials(level, random);
  const won = new Set<string>();
  for (const [name, attempt] of plan) {
    if (playOut(level, attempt).outcome?.won === true) won.add(name);
  }
  const names = [...plan.keys()];
  const status = verdict(names, won);
  const detail = [...names].sort().map((n) => `${n}=${won.has(n) ? "W" : "x"}`).join(" ");
  return { line: `${level.id}  ${status}\n      ${detail}`, flagged: !status.startsWith("ok") };
};

// MARK: the odds

/// How many random strokes the statistics try on each level.
const DOODLES = 48;

/// The share of random play that survives a level: 48 plausible random strokes from the
/// generator above, each played as the only stroke of an attempt.
export const odds = (id: string): { randomWin: number; sample: number; exact: boolean; detail: string } => {
  const level = loadLevel<DogLevel>(FOLDER, id);
  const strokes = randomStrokes(level, DOODLES);
  const survived = strokes.filter((stroke) => playOut(level, { strokes: [toVec(stroke)] }).outcome?.won === true).length;
  return {
    randomWin: strokes.length === 0 ? 0 : survived / strokes.length,
    sample: strokes.length,
    exact: false,
    detail: `${survived} of ${strokes.length} random strokes survived`,
  };
};
