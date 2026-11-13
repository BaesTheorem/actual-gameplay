// What each piece of Number Tower does, in one dry line, and which pieces a level is the first to
// show. A level file carries one hint, and no hint says what a mirror or a saw does, so the game
// says each of these once: in the first level of the campaign that has the piece.
import type { ThingKind, TowerLevel } from "./level";

/// Something a player has to learn: a kind of thing, a weight limit, a lock, a solid wall, or
/// the way into a room.
export type Explained = ThingKind | "limit" | "lock" | "wall" | "entry";

/// Every piece, in the order its line is shown: how to move first, then what fights, then what
/// changes a number, then the rules of the house.
export const EXPLAINED: readonly Explained[] = [
  "entry", "enemy", "boss", "plus", "times", "minus", "halve", "mirror", "key", "lock", "limit", "grower", "wall",
];

export const EXPLAINERS: Record<Explained, string> = {
  entry: "Tap a room with a dashed outline to walk in.",
  enemy: "A smaller rival adds its number to yours. A tie is a loss. A rose plate beats you right now.",
  boss: "Beat the boss to clear the tower.",
  plus: "A sword adds its number.",
  times: "A potion multiplies your number.",
  minus: "Spikes subtract their number. Zero or less is a loss.",
  halve: "A saw divides your number and rounds down.",
  mirror: "A mirror reverses your digits. 12 becomes 21.",
  key: "A key opens one locked room.",
  lock: "A locked room needs a key.",
  limit: "A weak floor holds its number. Anything bigger falls through.",
  grower: "A green rival grows by its green badge each time you enter any room.",
  wall: "A wall with no gap is solid. Find another way round.",
};

/// The pieces a level has, in the order of EXPLAINED. Every level has a way in, so every level
/// has "entry"; "wall" is a level with at least one solid wall between two rooms.
export const explainedIn = (level: TowerLevel): Explained[] => {
  const seen = new Set<Explained>(["entry"]);
  for (const room of level.rooms) {
    if (!room) continue;
    for (const thing of room.things) seen.add(thing.kind);
    if (room.max !== undefined) seen.add("limit");
    if (room.locked) seen.add("lock");
  }
  if (level.walls.length > 0) seen.add("wall");
  return EXPLAINED.filter((piece) => seen.has(piece));
};

/// For each level of a campaign, in play order, the pieces no level before it has. A piece is
/// in exactly one of the lists: the one for the first level that has it.
export const firstAppearances = (levels: readonly TowerLevel[]): Explained[][] => {
  const known = new Set<Explained>();
  return levels.map((level) => {
    const fresh = explainedIn(level).filter((piece) => !known.has(piece));
    for (const piece of fresh) known.add(piece);
    return fresh;
  });
};
