// Pull the Pin's level file: every field a level can carry, the collision categories, and the
// sizes and speeds the rules are written in. Lengths are canvas points and times are seconds.
import type { Vec } from "../sk";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Decor { sprite: string; x: number; y: number; w: number; h: number }

/// A pin: a bar `w` long whose left end is at x and whose underside is at y, with its knob on
/// `side` ("left" or "right"), which is also the way it slides out. `angle` tilts it, in degrees
/// counterclockwise about its middle. Pins that share a `group` are pulled by one tap on any of
/// them, and count as one pull.
export interface PinSpec { id: string; x: number; y: number; w: number; side: string; angle?: number; group?: string }

/// A pool of `count` particles filling a rectangle. `liquid` is "water", "lava" or "gas". Water
/// and lava fill the rectangle from the bottom up. Gas fills it from the top down, because gas
/// rises and rests against what is over it, so the top of a gas pool goes against its lid.
export interface PoolSpec extends Rect { liquid: string; count: number }

/// A round rock that rolls. `r` is 18 when left out.
export interface BoulderSpec { x: number; y: number; r?: number }

/// A strip on a floor: `y` is the floor's top, and the floor can be a pin. While a boulder, a
/// crate, the gem or a living character touches the strip, every door named in `opens` is held
/// open. Liquids and gas do not press it.
export interface PlateSpec { id: string; x: number; y: number; w: number; opens: string[] }

/// A wall that slides out of the way along `slide`, by its own length, while one of its plates
/// is pressed, and slides back when none is. It does not start back while anything that can move
/// is in its doorway. With `latch` it stays open for good from the first moment a plate of its
/// is pressed.
export interface DoorSpec extends Rect { id: string; slide: "up" | "down" | "left" | "right"; latch?: boolean }

export interface PinLevel {
  id: string;
  name: string;
  hint?: string;
  /// 2 for the rules with walking characters and the newer pieces (boulders, bombs, cracked walls,
  /// linked pins, plates, doors, gas, vents, the friend). A level without it plays by the first
  /// rules, and every newer field in it is ignored.
  rules?: number;
  /// Pulls the intended solution needs. Three stars at or under it, two for one extra pull.
  parPins: number;
  /// treasureReachesHero, heroReachesGoal, treasureReachesGoal, both, or heroReachesFriend.
  winWhen: string;
  frame?: boolean;
  walls?: Rect[];
  slabs?: { x1: number; y1: number; x2: number; y2: number; t?: number }[];
  pins: PinSpec[];
  pools?: PoolSpec[];
  drains?: Rect[];
  grates?: Rect[];
  decor?: Decor[];
  actors: { hero?: Vec; treasure?: Vec; goal?: Rect; foes?: Vec[]; friend?: Vec };
  /// Walls like any other until a blast takes them out.
  cracked?: Rect[];
  /// Round rocks, placed by their centre.
  boulders?: BoulderSpec[];
  /// Crates of powder, each 24 points square, placed by their centre. Lava lights one, and water
  /// on one that is not lit makes it a dud.
  bombs?: Vec[];
  plates?: PlateSpec[];
  doors?: DoorSpec[];
  /// Openings that swallow gas and nothing else.
  vents?: Rect[];
  /// The pull order that wins. It names one pin of a group.
  solution?: string[];
  settleSeconds?: number;
}

export const Cat = {
  wall: 1 << 0,
  pin: 1 << 1,
  water: 1 << 2,
  lava: 1 << 3,
  hero: 1 << 4,
  treasure: 1 << 5,
  goal: 1 << 6,
  drain: 1 << 7,
  /// Swallows liquid like a drain, but the hero and the treasure fall straight through it.
  grate: 1 << 8,
  /// A goblin: water or lava ends him, and he ends the hero.
  foe: 1 << 9,
  liquid: (1 << 2) | (1 << 3),
  /// The one to reach. He never walks, and whatever ends the hero ends him.
  friend: 1 << 10,
  boulder: 1 << 11,
  bomb: 1 << 12,
  /// Rises, passes through liquids and characters, and ends whoever breathes it.
  gas: 1 << 13,
  vent: 1 << 14,
  plate: 1 << 15,
};

export const PIN_THICKNESS = 14;
export const KNOB_OFFSET = 26;
export const FRAME_THICKNESS = 14;
export const LIQUID_RADIUS = 3.5;
export const HERO_RADIUS = 16;
/// The friend is drawn at four fifths of the hero's size, and his body is smaller to match.
export const FRIEND_RADIUS = 13;
export const BOULDER_RADIUS = 18;
export const BOMB_SIZE = 24;

/// How fast a character walks, in points per second.
export const HERO_WALK = 70;
export const FOE_WALK = 55;

/// A boulder that meets a character at this speed or more, measured between the two in the frame
/// before they touch, flattens him. Slower than this it only pushes.
export const CRUSH_SPEED = 120;

/// Seconds from the moment a bomb is lit to its blast.
export const BOMB_FUSE = 0.7;
/// How far a blast reaches from the middle of its bomb.
export const BLAST_RADIUS = 64;
/// The speed a blast adds to a loose thing at its centre, in points per second. It falls in a
/// straight line to nothing at the edge of the blast. At this figure a boulder beside the bomb
/// rolls about its own width, and the gem hops a few points and stays in its chamber.
export const BLAST_KICK = 100;

/// Seconds a door takes to slide open or shut.
export const DOOR_SECONDS = 0.25;
/// How far a plate's strip stands above its floor. Whatever touches the strip presses the plate.
export const PLATE_HEIGHT = 5;

export const stars = (level: PinLevel, pulls: number) =>
  pulls <= level.parPins ? 3 : pulls === level.parPins + 1 ? 2 : 1;

/// The moves a level offers, each named by one pin: a pin on its own, or the first pin of a
/// group. Pulling that pin pulls its whole group, so the audit and the random-play model count
/// a group once.
export const moves = (level: PinLevel): string[] => {
  const seen = new Set<string>();
  return level.pins.filter((pin) => {
    if (pin.group === undefined) return true;
    if (seen.has(pin.group)) return false;
    seen.add(pin.group);
    return true;
  }).map((pin) => pin.id);
};

/// The move a pin belongs to: itself, or the first pin of its group.
export const moveOf = (level: PinLevel, id: string): string => {
  const pin = level.pins.find((p) => p.id === id);
  if (!pin || pin.group === undefined) return id;
  return level.pins.find((p) => p.group === pin.group)!.id;
};

/// Corners of the rectangle that thickens segment a-b, counterclockwise in a y-up space.
export const segmentQuad = (a: Vec, b: Vec, halfWidth: number): Vec[] => {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const n = { x: (-dy / len) * halfWidth, y: (dx / len) * halfWidth };
  return [
    { x: a.x - n.x, y: a.y - n.y }, { x: b.x - n.x, y: b.y - n.y },
    { x: b.x + n.x, y: b.y + n.y }, { x: a.x + n.x, y: a.y + n.y },
  ];
};
