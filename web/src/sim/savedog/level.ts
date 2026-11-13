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
  /// Terrain look: grass (default), stone, dirt, purple.
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
  dogs: DogSpot[];
  hives: Hive[];
  solution?: StrokeSolution;
}

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
