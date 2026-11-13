// The Number Tower level model and its validation. Nothing here draws or plays.

export type Thing =
  | { kind: "enemy"; n: number }
  | { kind: "boss"; n: number }
  | { kind: "grower"; n: number; grow: number }
  | { kind: "plus"; n: number }
  | { kind: "times"; k: number }
  | { kind: "minus"; n: number }
  | { kind: "halve"; k: number }
  | { kind: "mirror" }
  | { kind: "key" };

export type ThingKind = Thing["kind"];

export const THING_KINDS: readonly ThingKind[] = ["enemy", "boss", "grower", "plus", "times", "minus", "halve", "mirror", "key"];

export interface Room {
  /// One or two things, resolved left to right.
  things: Thing[];
  /// A weight limit: a hero above it falls through the floor.
  max?: number;
  locked?: boolean;
}

/// What a level needs to be played. The campaign files add the fields below the line.
export interface TowerLevel {
  start: number;
  w: number;
  h: number;
  /// Row-major from the ground floor: index = floor * w + column. Null is an empty cell.
  rooms: (Room | null)[];
  /// Pairs of adjacent room indices with no doorway between them.
  walls: [number, number][];
  /// Rooms that can be entered from outside.
  entries: number[];
  id?: string;
  name?: string;
  hint?: string;
  /// The room indices of the best order.
  solution?: number[];
  /// The final number that order reaches.
  best?: number;
  /// The generator seed that made the level.
  seed?: number;
}

/// The most rooms a level can have: the rules keep the cleared set in one 30 bit mask.
export const MAX_ROOMS = 30;

/// A piece a recipe can feature: a kind of thing, or one of the two room flags.
export type Piece = Exclude<ThingKind, "boss"> | "limit" | "lock";

export const floorOf = (level: { w: number }, room: number) => Math.floor(room / level.w);
export const columnOf = (level: { w: number }, room: number) => room % level.w;

export const roomCount = (level: TowerLevel) => level.rooms.reduce((n, r) => n + (r ? 1 : 0), 0);

export const bossRoom = (level: TowerLevel): number =>
  level.rooms.findIndex((r) => r?.things.some((t) => t.kind === "boss"));

/// The set of pieces a level uses, in a fixed order.
export const piecesOf = (level: TowerLevel): Piece[] => {
  const seen = new Set<Piece>();
  for (const room of level.rooms) {
    if (!room) continue;
    for (const t of room.things) if (t.kind !== "boss") seen.add(t.kind);
    if (room.max !== undefined) seen.add("limit");
    if (room.locked) seen.add("lock");
  }
  const order: Piece[] = ["enemy", "grower", "plus", "times", "minus", "halve", "mirror", "key", "limit", "lock"];
  return order.filter((p) => seen.has(p));
};

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/// Whether two room indices share an edge in the grid.
export const adjacent = (w: number, a: number, b: number): boolean => {
  const d = Math.abs(a - b);
  if (d === w) return true;
  return d === 1 && Math.floor(a / w) === Math.floor(b / w);
};

/// Throw an Error that says what is wrong with the level, or return the level typed. With
/// `campaign` the level must also carry the id, name, hint, solution, best and seed of a file.
export function validateLevel(input: unknown, campaign = false): TowerLevel {
  const label = (input as { id?: unknown } | null)?.id;
  const fail = (problem: string): never => {
    throw new Error(`Tower level${typeof label === "string" ? ` "${label}"` : ""}: ${problem}`);
  };
  if (typeof input !== "object" || input === null) return fail("the level is not an object");
  const level = input as TowerLevel;
  if (!isInt(level.start) || level.start <= 0) fail("start must be a whole number above 0");
  if (!isInt(level.w) || !isInt(level.h) || level.w < 1 || level.h < 1) fail("w and h must be whole numbers of at least 1");
  if (level.w * level.h > MAX_ROOMS) fail(`a level holds at most ${MAX_ROOMS} cells`);
  if (!Array.isArray(level.rooms) || level.rooms.length !== level.w * level.h) {
    fail(`rooms must list w * h = ${level.w * level.h} cells, ground floor first`);
  }
  let bosses = 0;
  level.rooms.forEach((room, i) => {
    if (room === null) return;
    if (typeof room !== "object" || !Array.isArray(room.things)) fail(`room ${i} has no list of things`);
    if (room.things.length < 1 || room.things.length > 2) fail(`room ${i} must hold one or two things`);
    if (room.max !== undefined && (!isInt(room.max) || room.max <= 0)) fail(`room ${i} has a weight limit that is not a whole number above 0`);
    if (room.locked !== undefined && typeof room.locked !== "boolean") fail(`room ${i} has a locked flag that is not true or false`);
    room.things.forEach((t, j) => {
      if (typeof t !== "object" || t === null || !THING_KINDS.includes(t.kind)) fail(`room ${i} thing ${j} has an unknown kind`);
      const need = (field: string, min: number) => {
        const v = (t as unknown as Record<string, unknown>)[field];
        if (!isInt(v) || v < min) fail(`room ${i} thing ${j} (${t.kind}) needs ${field} as a whole number of at least ${min}`);
      };
      switch (t.kind) {
        case "enemy": case "boss": case "plus": case "minus": need("n", 1); break;
        case "grower": need("n", 1); need("grow", 1); break;
        case "times": case "halve": need("k", 2); break;
        default: break;
      }
      if (t.kind === "boss") {
        bosses += 1;
        if (j !== room.things.length - 1) fail(`the boss in room ${i} must be the last thing in its room`);
      }
    });
  });
  if (bosses !== 1) fail(`a level needs exactly one boss, this one has ${bosses}`);
  const exists = (i: number) => isInt(i) && i >= 0 && i < level.rooms.length && level.rooms[i] !== null;
  if (!Array.isArray(level.entries) || level.entries.length === 0) fail("the tower needs at least one entry");
  for (const e of level.entries) if (!exists(e)) fail(`entry ${e} is not a room`);
  if (!Array.isArray(level.walls)) fail("walls must be a list of pairs");
  for (const wall of level.walls) {
    if (!Array.isArray(wall) || wall.length !== 2) fail("a wall must be a pair of room indices");
    const [a, b] = wall as [number, number];
    if (!exists(a) || !exists(b)) fail(`wall ${a}-${b} names a cell with no room`);
    if (!adjacent(level.w, a, b)) fail(`wall ${a}-${b} is between rooms that do not touch`);
  }
  if (campaign) {
    if (typeof level.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(level.id)) fail("id must be a kebab-case slug");
    if (typeof level.name !== "string" || level.name === "") fail("the level has no name");
    if (typeof level.hint !== "string" || level.hint === "") fail("the level has no hint");
    if (!isInt(level.seed)) fail("the level has no seed");
    if (!isInt(level.best) || level.best <= 0) fail("best must be a whole number above 0");
    const solution = level.solution;
    if (!Array.isArray(solution) || solution.length === 0 || !solution.every(exists)) return fail("solution must list room indices");
    if (new Set(solution).size !== solution.length) fail("the solution enters a room twice");
  }
  return level;
}
