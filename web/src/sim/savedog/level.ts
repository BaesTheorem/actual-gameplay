// The shape of a Save the Clawd level file, and the numbers a level derives from it.
// Canvas coordinates (402 x 874, origin bottom-left).
import type { Vec } from "../sk";
import { centroid, polylineLength, type Rect } from "./geometry";

export interface DogSpot { id: string; x: number; y: number }

/// Where bees come from. They stream in `count` at a time, one every `interval` seconds.
export interface Hive {
  x: number;
  y: number;
  count: number;
  interval?: number;
  /// Seconds after the swarm starts before this hive opens.
  delay?: number;
}

/// A loose body the player can use: a boulder to roll into a gap, a crate to drop.
export interface PropSpec { id: string; shape: string; x: number; y: number; r?: number; w?: number; h?: number; density?: number }

/// A spinning blade. It ends the dog and cuts any stroke that touches it.
export interface SawSpec { x: number; y: number; r: number }

/// Scenery with no physics: a bush, a torch, a sign.
export interface Decor { sprite: string; x: number; y: number; w: number; h: number }

/// A flame, by the middle of its base. Ink that touches it burns, he does not survive it, and
/// bees keep out of it.
export interface FireSpec { x: number; y: number }

/// A boulder held still at its point until `at` seconds after the bees are out, then let go.
export interface RockSpec { x: number; y: number; r?: number; at: number }

/// A bomb lying where it is put. Its fuse is lit when the bees come out and it goes off `at` seconds later.
export interface BombSpec { x: number; y: number; at: number }

/// Static geometry. Rects give their bottom-left corner.
export interface LevelStatic {
  type: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  points?: number[][];
  /// False for scenery with no physics body.
  solid?: boolean;
  /// Terrain look: grass (default), stone, dirt, purple, ice. Ice is also slippery.
  skin?: string;
}

/// For killers: "spikes" (the default, solid), or "water" / "lava" (a pit; ink sinks, he does not swim).
export interface LevelRect extends Rect { kind?: string }

export interface SolutionStroke { delay?: number; points: number[][] }

/// A stored solution: strokes with optional delays.
export interface StrokeSolution { delay?: number; strokes: SolutionStroke[]; waitSeconds?: number }

export interface DogLevel {
  id: string;
  name: string;
  hint?: string;
  inkBudget: number;
  /// Ink thresholds for three and two stars.
  stars: number[];
  /// Seconds the dog has to survive once the bees are out.
  duration?: number;
  /// Seconds between the first stroke landing and the first bee.
  beeDelay?: number;
  /// Drawn strokes stay where they are put instead of falling.
  pinnedInk?: boolean;
  statics?: LevelStatic[];
  killers?: LevelRect[];
  saws?: SawSpec[];
  props?: PropSpec[];
  decor?: Decor[];
  forbidden?: LevelRect[];
  fires?: FireSpec[];
  rocks?: RockSpec[];
  bombs?: BombSpec[];
  dogs: DogSpot[];
  hives: Hive[];
  solution?: StrokeSolution;
}

// The numbers of the hazards. Every time is in seconds after the bees are released, which is the
// clock that counts the ten seconds, and every length is in canvas points.

/// A flame is this wide and this tall, standing on its point.
export const FLAME_WIDTH = 24, FLAME_HEIGHT = 32;
/// A burn runs along the ink this fast, in points per second, both ways from where it caught.
export const BURN_SPEED = 40;
/// A bee flying by itself comes no nearer to a flame than this, measured from its edge to the flame's.
export const FLAME_BERTH = 4;
/// A boulder with no radius of its own. Boulders are twice as dense as the level's other props.
export const ROCK_RADIUS = 16, ROCK_DENSITY = 4;
/// A boulder, a bomb or a prop that meets him at this speed or more, measured between the two in
/// the frame before they touch, flattens him. Slower than this it only pushes.
export const CRUSH_SPEED = 120;
/// A boulder that lands at this speed or more is heard and felt.
export const THUD_SPEED = 150;
/// A bomb is a ball this big, as dense as the other props.
export const BOMB_RADIUS = 12, BOMB_DENSITY = 2;
/// A blast reaches this far from the middle of its bomb.
export const BLAST_RADIUS = 70;
/// The push a blast gives a loose body at its centre, as an impulse (mass times points per
/// second). It falls in a straight line to nothing at the edge of the blast, and it is the same
/// push whatever the body weighs, so a light bar flies and a heavy dome shuffles. At this figure a
/// 150 point bar lying on grass with the bomb at its end is pushed 40 points, about the width of
/// Clawd. A 60 point bar is thrown across the level and a 300 point dome moves 5 points.
export const BLAST_IMPULSE = 36;
/// The friction of everything that touches ice.
export const ICE_FRICTION = 0.02;

export const surviveSeconds = (level: DogLevel): number => level.duration ?? 10;
export const swarmDelay = (level: DogLevel): number => level.beeDelay ?? 1.5;
export const totalBees = (level: DogLevel): number => level.hives.reduce((sum, hive) => sum + hive.count, 0);
export const isLiquid = (rect: LevelRect): boolean => rect.kind === "water" || rect.kind === "lava";

/// Three stars at or under the first ink line, two at or under the second.
export const stars = (level: DogLevel, ink: number): number => {
  if (level.stars.length > 0 && ink <= level.stars[0]) return 3;
  if (level.stars.length > 1 && ink <= level.stars[1]) return 2;
  return 1;
};

export const strokePoints = (stroke: SolutionStroke): Vec[] => stroke.points.map(([x, y]) => ({ x, y }));

export const solutionLength = (solution: StrokeSolution): number =>
  solution.strokes.reduce((sum, stroke) => sum + polylineLength(strokePoints(stroke)), 0);

/// A rigid nudge applied to a replayed stroke: shift it, or scale it about its own centroid.
export interface StrokeTransform { dx: number; dy: number; scale: number }

export const IDENTITY: StrokeTransform = { dx: 0, dy: 0, scale: 1 };

export const applyTransform = (t: StrokeTransform, points: Vec[]): Vec[] => {
  const c = centroid(points);
  return points.map((p) => ({ x: c.x + (p.x - c.x) * t.scale + t.dx, y: c.y + (p.y - c.y) * t.scale + t.dy }));
};

/// Stored solutions that need a nudge in this engine, as a shift of the level file's strokes, by level id.
///
/// roll-it-in: the boulder meets the pinned wall at 200 pt/s, comes back at 10 pt/s, and lands
/// 0.65 pt past the corner of the lip it has to lean on, so it rolls away from the wall. Measured
/// by moving the wall: the pass boundary is 0.2 pt right of the stored position, which is less
/// than the 0.75 pt the engine keeps between touching shapes. One point right wins, and so does
/// every quarter point from +0.25 to +6, so the shifted wall is not on an edge of its own.
export const WEB_SOLUTIONS: Record<string, StrokeTransform> = {
  "roll-it-in": { dx: 1, dy: 0, scale: 1 },
};

/// The solution this engine replays for a level: the stored one, moved when the table says so.
export const baseTransform = (level: DogLevel): StrokeTransform => WEB_SOLUTIONS[level.id] ?? IDENTITY;

/// The strokes of the solution this engine replays, as points on the canvas. Empty when the
/// level stores no solution.
export const solutionStrokes = (level: DogLevel): Vec[][] =>
  (level.solution?.strokes ?? []).map((stroke) => applyTransform(baseTransform(level), strokePoints(stroke)));

/// The sprite names a level's decor can use: the file stems of the bundled art.
export const SPRITES: ReadonlySet<string> = new Set([
  "dog", "bee_a", "bee_b", "bee_rest", "saw_a", "saw_b", "spikes", "bomb", "bush", "rock", "mushroom_red",
  "coin_gold", "gem_yellow", "gem_blue", "sign_exit", "flag_green_a", "flag_green_b",
  "torch_on_a", "torch_on_b", "block_planks", "block_danger",
  "character_green_idle", "character_green_jump", "character_green_hit", "character_green_front",
  "character_yellow_walk_a", "character_yellow_walk_b", "character_yellow_front",
  "character_pink_walk_a", "character_pink_walk_b", "character_pink_front",
  "character_purple_front", "character_purple_hit", "character_beige_front",
  "background_solid_sky", "background_clouds", "background_color_hills", "cloud_1", "cloud_2", "cloud_3",
]);
