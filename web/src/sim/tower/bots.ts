// Two heuristic players, so that difficulty has a ladder. Both read only what a person can read on
// the screen: the rooms' things, limits and locks, and their own number. Both avoid a room whose
// weight limit they exceed while another option exists, and both take the boss as soon as they
// can beat it. Ties go to the lowest room index.
import type { Room, TowerLevel } from "./level";
import {
  enter, options, startState, thingValue, type TowerState,
} from "./rules";

export type BotKind = "smallest" | "wise";

export interface BotRun {
  won: boolean;
  /// The rooms entered, in order, including the room that ended the game.
  order: number[];
  final: number;
  /// Why the run ended in a loss, empty for a win.
  reason: string;
}

export type RoomClass = "enemy" | "curse" | "mirror" | "times" | "good";

/// What a room looks like from outside. An enemy room has an enemy, grower or boss; a curse room
/// has minus or halve and no enemy; then mirror, then times; a room with only plus and key is good.
export const classOf = (room: Room): RoomClass => {
  const kinds = room.things.map((t) => t.kind);
  if (kinds.some((k) => k === "enemy" || k === "grower" || k === "boss")) return "enemy";
  if (kinds.some((k) => k === "minus" || k === "halve")) return "curse";
  if (kinds.includes("mirror")) return "mirror";
  if (kinds.includes("times")) return "times";
  return "good";
};

/// The number of the first thing in the room that fights, as it stands this turn.
const fightNumber = (room: Room, turn: number): number => {
  for (const t of room.things) {
    if (t.kind === "enemy" || t.kind === "grower" || t.kind === "boss") return thingValue(t, turn);
  }
  return Infinity;
};

/// How a player ranks a room: a group (lower goes first) and a number inside the group.
type Rank = readonly [number, number];

const rankFor = (kind: BotKind, level: TowerLevel, state: TowerState, index: number): Rank => {
  const room = level.rooms[index] as Room;
  const cls = classOf(room);
  const trial = enter(level, state, index, false);
  const beatable = !(trial.result === "loss" && trial.cause === "fight");
  const raises = trial.result !== "loss" && (trial.result === "win" || trial.state.power > state.power);
  const light = room.max !== undefined && state.power <= room.max;
  const number = fightNumber(room, state.turn);
  if (kind === "smallest") {
    if (cls === "good") return [0, 0];
    if (cls === "times") return [1, 0];
    if (cls === "enemy" && beatable) return [2, number];
    if (cls === "mirror" && raises) return [3, 0];
    if (cls === "curse") return [4, 0];
    if (cls === "mirror") return [5, 0];
    return [6, number];
  }
  if (light && cls !== "curse" && (cls !== "enemy" || beatable)) return [0, 0];
  if (cls === "good") return [1, 0];
  if (cls === "mirror" && raises) return [2, 0];
  if (cls === "enemy" && beatable) return [3, number];
  if (cls === "times") return [4, 0];
  if (cls === "curse") return [5, 0];
  if (cls === "mirror") return [6, 0];
  return [7, number];
};

/// The room this player enters next from this state, or -1 when there is none.
export function botChoice(kind: BotKind, level: TowerLevel, state: TowerState): number {
  const opts = options(level, state);
  if (opts.length === 0) return -1;
  // The boss, as soon as it can be beaten.
  for (const room of opts) {
    if ((level.rooms[room] as Room).things.some((t) => t.kind === "boss") && enter(level, state, room, false).result === "win") return room;
  }
  const light = opts.filter((room) => {
    const max = (level.rooms[room] as Room).max;
    return max === undefined || state.power <= max;
  });
  const pool = light.length > 0 ? light : opts;
  let pick = -1, rank: Rank = [Infinity, Infinity];
  for (const room of pool) {
    const r = rankFor(kind, level, state, room);
    if (r[0] < rank[0] || (r[0] === rank[0] && r[1] < rank[1])) { pick = room; rank = r; }
  }
  return pick;
}

/// Play a whole level with one of the two players.
export function playBot(level: TowerLevel, kind: BotKind): BotRun {
  let state = startState(level);
  const order: number[] = [];
  for (;;) {
    const room = botChoice(kind, level, state);
    if (room < 0) return { won: false, order, final: state.power, reason: "No room left to enter." };
    order.push(room);
    const r = enter(level, state, room, false);
    if (r.result === "win") return { won: true, order, final: r.final, reason: "" };
    if (r.result === "loss") return { won: false, order, final: r.power, reason: r.reason };
    state = r.state;
  }
}
