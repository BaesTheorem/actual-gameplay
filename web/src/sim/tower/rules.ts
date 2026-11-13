// The rules of Number Tower as pure functions. A state is the hero's number, his keys and the set
// of cleared rooms. Nothing here keeps state of its own, so the solver, the bots, the generator
// and the play simulation all read the same rules.
import { MAX_ROOMS, type Room, type Thing, type TowerLevel } from "./level";

export interface TowerState {
  power: number;
  keys: number;
  /// Bit i is set when room i is cleared.
  mask: number;
  /// How many rooms have been entered so far.
  turn: number;
}

/// What happened in a room, in order, for whoever draws it.
export type Happening =
  | { kind: "unlock" }
  | { kind: "break"; max: number; power: number }
  | { kind: "fight"; thing: number; n: number; from: number; to: number; boss: boolean; won: boolean }
  | { kind: "gain"; thing: number; op: "plus" | "times" | "minus" | "halve" | "mirror"; from: number; to: number }
  | { kind: "item"; thing: number };

export type LossCause = "fight" | "floor" | "drain" | "halve" | "stuck";

export type EnterResult =
  | { result: "move"; state: TowerState; events: Happening[] }
  | { result: "win"; state: TowerState; events: Happening[]; final: number }
  | { result: "loss"; cause: LossCause; reason: string; power: number; events: Happening[] };

interface Compiled {
  n: number;
  rooms: (Room | null)[];
  /// For each room, the rooms it shares a doorway with.
  door: number[];
  entry: number;
  locked: number;
  exists: number;
}

const cache = new WeakMap<TowerLevel, Compiled>();

const compile = (level: TowerLevel): Compiled => {
  const hit = cache.get(level);
  if (hit && hit.rooms === level.rooms) return hit;
  const n = level.rooms.length;
  if (n > MAX_ROOMS) throw new Error(`A tower holds at most ${MAX_ROOMS} cells.`);
  const walled = new Set<number>();
  for (const [a, b] of level.walls) { walled.add(a * 64 + b); walled.add(b * 64 + a); }
  const door = new Array<number>(n).fill(0);
  let exists = 0, locked = 0, entry = 0;
  for (let i = 0; i < n; i++) {
    const room = level.rooms[i];
    if (!room) continue;
    exists |= 1 << i;
    if (room.locked) locked |= 1 << i;
    const col = i % level.w;
    const near: number[] = [];
    if (col > 0) near.push(i - 1);
    if (col < level.w - 1) near.push(i + 1);
    if (i >= level.w) near.push(i - level.w);
    if (i + level.w < n) near.push(i + level.w);
    for (const j of near) if (level.rooms[j] && !walled.has(i * 64 + j)) door[i] = (door[i] as number) | (1 << j);
  }
  for (const e of level.entries) entry |= 1 << e;
  const compiled: Compiled = { n, rooms: level.rooms, door, entry, locked, exists };
  cache.set(level, compiled);
  return compiled;
};

export const startState = (level: TowerLevel): TowerState => ({ power: level.start, keys: 0, mask: 0, turn: 0 });

export const countBits = (mask: number): number => {
  let c = 0;
  for (let m = mask; m !== 0; m &= m - 1) c += 1;
  return c;
};

const optionMask = (c: Compiled, mask: number, keys: number): number => {
  let reach = c.entry;
  for (let i = 0; i < c.n; i++) if (mask & (1 << i)) reach |= c.door[i] as number;
  reach &= ~mask & c.exists;
  if (keys <= 0) reach &= ~c.locked;
  return reach;
};

/// The rooms the hero can enter now, lowest index first. A room is an option when it is not
/// cleared, it is an entry or shares a doorway with a cleared room, and it is not locked or the
/// hero holds a key.
export const options = (level: TowerLevel, state: TowerState): number[] => {
  const c = compile(level);
  const reach = optionMask(c, state.mask, state.keys);
  const out: number[] = [];
  for (let i = 0; i < c.n; i++) if (reach & (1 << i)) out.push(i);
  return out;
};

/// The number of a fight thing right now. A grower adds `grow` for every room entered so far.
export const thingValue = (thing: Thing, turn: number): number => {
  if (thing.kind === "grower") return thing.n + thing.grow * turn;
  if (thing.kind === "enemy" || thing.kind === "boss" || thing.kind === "plus" || thing.kind === "minus") return thing.n;
  return 0;
};

/// A number with its decimal digits reversed: 12 becomes 21, 20 becomes 2, 100 becomes 1.
export const mirrorOf = (power: number): number => {
  let rest = power, out = 0;
  while (rest > 0) {
    out = out * 10 + (rest % 10);
    rest = Math.floor(rest / 10);
  }
  return out;
};

/// Scratch for the solver: the largest number seen while playing rooms, and which rooms ever
/// reached their second thing.
export interface Probe {
  /// The largest number the hero held, apart from the gain of beating the boss.
  max: number;
  second: Uint8Array;
}

export const MOVE = 0, WIN = 1, LOSS = 2;

/// The outcome of the last `execute` call. Read it at once; the next call overwrites it.
export const out = { power: 0, keys: 0, cause: "fight" as LossCause, a: 0, b: 0, boss: false };

/// Play a room without allocating, for the solver. Returns MOVE, WIN or LOSS and fills `out`.
/// With `events` it also records what happened.
export function execute(
  level: TowerLevel, power: number, keys: number, turn: number, room: number,
  events: Happening[] | null = null, probe: Probe | null = null,
): number {
  const r = compile(level).rooms[room] as Room;
  let p = power, k = keys;
  if (r.locked) {
    k -= 1;
    events?.push({ kind: "unlock" });
  }
  if (r.max !== undefined && p > r.max) {
    events?.push({ kind: "break", max: r.max, power: p });
    out.cause = "floor"; out.a = r.max; out.b = p; out.power = p; out.boss = false;
    return LOSS;
  }
  const things = r.things;
  for (let i = 0; i < things.length; i++) {
    const t = things[i] as Thing;
    if (i === 1 && probe) probe.second[room] = 1;
    switch (t.kind) {
      case "enemy": case "boss": case "grower": {
        const n = thingValue(t, turn);
        const boss = t.kind === "boss";
        if (p > n) {
          events?.push({ kind: "fight", thing: i, n, from: p, to: p + n, boss, won: true });
          p += n;
          if (boss) {
            out.power = p; out.keys = k;
            return WIN;
          }
        } else {
          events?.push({ kind: "fight", thing: i, n, from: p, to: p, boss, won: false });
          out.cause = "fight"; out.a = n; out.b = p; out.power = p; out.boss = boss;
          return LOSS;
        }
        break;
      }
      case "plus":
        events?.push({ kind: "gain", thing: i, op: "plus", from: p, to: p + t.n });
        p += t.n;
        break;
      case "times":
        events?.push({ kind: "gain", thing: i, op: "times", from: p, to: p * t.k });
        p *= t.k;
        break;
      case "minus":
        if (p - t.n <= 0) {
          events?.push({ kind: "gain", thing: i, op: "minus", from: p, to: 0 });
          out.cause = "drain"; out.a = t.n; out.b = p; out.power = p; out.boss = false;
          return LOSS;
        }
        events?.push({ kind: "gain", thing: i, op: "minus", from: p, to: p - t.n });
        p -= t.n;
        break;
      case "halve": {
        const half = Math.floor(p / t.k);
        if (half <= 0) {
          events?.push({ kind: "gain", thing: i, op: "halve", from: p, to: 0 });
          out.cause = "halve"; out.a = t.k; out.b = p; out.power = p; out.boss = false;
          return LOSS;
        }
        events?.push({ kind: "gain", thing: i, op: "halve", from: p, to: half });
        p = half;
        break;
      }
      case "mirror": {
        const m = mirrorOf(p);
        events?.push({ kind: "gain", thing: i, op: "mirror", from: p, to: m });
        p = m;
        break;
      }
      case "key":
        events?.push({ kind: "item", thing: i });
        k += 1;
        break;
    }
    if (probe && p > probe.max) probe.max = p;
  }
  out.power = p; out.keys = k;
  return MOVE;
}

const reasonOf = (cause: LossCause, a: number, b: number, boss: boolean): string => {
  switch (cause) {
    case "fight":
      if (boss) return a > b ? `The ${a} boss beats your ${b}.` : `The ${a} boss matches your ${b}. A tie is a loss.`;
      return a > b ? `A ${a} beats your ${b}.` : `A ${a} matches your ${b}. A tie is a loss.`;
    case "floor": return `That floor holds ${a}. You are ${b}.`;
    case "drain": return `Minus ${a} leaves nothing of your ${b}.`;
    case "halve": return "Halved to nothing.";
    case "stuck": return "No room left to enter.";
  }
};

export const NO_ROOM = reasonOf("stuck", 0, 0, false);

/// Enter a room. Returns the new state, a win, or a loss with its reason. With `trace` off the
/// list of events stays empty, which the bots use to try a room cheaply. Throws when the room is
/// not an option.
export function enter(level: TowerLevel, state: TowerState, room: number, trace = true): EnterResult {
  const c = compile(level);
  if (!(optionMask(c, state.mask, state.keys) & (1 << room))) {
    throw new Error(`Room ${room} is not an option here.`);
  }
  const events: Happening[] = [];
  const status = execute(level, state.power, state.keys, state.turn, room, trace ? events : null);
  if (status === LOSS) {
    return { result: "loss", cause: out.cause, reason: reasonOf(out.cause, out.a, out.b, out.boss), power: out.power, events };
  }
  const next: TowerState = { power: out.power, keys: out.keys, mask: state.mask | (1 << room), turn: state.turn + 1 };
  if (status === WIN) return { result: "win", state: next, events, final: next.power };
  if (optionMask(c, next.mask, next.keys) === 0) {
    return { result: "loss", cause: "stuck", reason: NO_ROOM, power: next.power, events };
  }
  return { result: "move", state: next, events };
}

/// Stars for a win: 3 at the best number any order reaches, 2 at 60 percent of it or more.
export const starsFor = (final: number, best: number): number =>
  final >= best ? 3 : final * 10 >= best * 6 ? 2 : 1;

/// Play a list of rooms from the start and report how it ended.
export function playOrder(level: TowerLevel, order: readonly number[]):
  { won: boolean; final: number; reason: string; entered: number } {
  let state = startState(level);
  for (let i = 0; i < order.length; i++) {
    if (!options(level, state).includes(order[i] as number)) {
      return { won: false, final: state.power, reason: `Room ${order[i]} is not an option here.`, entered: i };
    }
    const r = enter(level, state, order[i] as number, false);
    if (r.result === "loss") return { won: false, final: r.power, reason: r.reason, entered: i };
    if (r.result === "win") return { won: true, final: r.final, reason: "", entered: i + 1 };
    state = r.state;
  }
  return { won: false, final: state.power, reason: "The order ended before the boss.", entered: order.length };
}
