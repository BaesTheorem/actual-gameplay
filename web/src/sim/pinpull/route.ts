// How a character finds its way along a floor. A probe steps from under the character toward
// what it wants, feeling for floor under it and for anything solid ahead of it. There is no
// search and no jumping: a route is one walk along one floor, up and down slopes and never over
// a ledge. The simulation asks again every few frames, so a route that opens or closes is noticed.
import type { SKWorld, Vec } from "../sk";
import { Cat, type Rect } from "./level";

/// What a walker stands on and cannot pass: walls, slabs, pins, doors, cracked walls, boulders
/// and crates. Liquids, the gem and other characters are neither floor nor obstacle to the probe.
export const FOOTING = Cat.wall | Cat.pin | Cat.boulder | Cat.bomb;

/// How far the probe moves at a time, and how many times at most.
export const ROUTE_STEP = 6;
export const ROUTE_STEPS = 60;
/// How far below body height the probe looks for floor.
export const ROUTE_REACH = 30;
/// The most a floor may rise or fall from one step to the next. Six along and eight up is a
/// slope of 53 degrees, and anything sharper is a ledge.
export const ROUTE_LEDGE = 8;
/// The probe has arrived when it is this near the target in x, with the target no more than
/// this far above or below the height of a body standing there.
export const ROUTE_NEAR = 14;
export const ROUTE_RISE = 24;
/// Frames between one look for a route and the next.
export const ROUTE_EVERY = 6;
/// A character stands on something when there is footing within this distance under its feet.
/// The slack is wide on purpose. On a slope the floor straight under a body's middle is lower
/// than its feet, a body half way over the corner of a step rides well above the lower floor,
/// and one wading through a puddle is lifted by it. All three are still walking.
export const STAND_SLACK = 20;
/// The second level ray runs this far over the top of the head, so a walker never starts
/// under a ceiling it only just fits beneath.
export const HEAD_ROOM = 2;
/// A walker this near its target in x has nothing left to walk, and stands still.
const ARRIVED = 2;
/// A ray that runs exactly along the face of a block, or down the seam between two blocks, meets
/// neither. Levels are drawn on whole points and characters start on whole points, so that
/// happens. Every ray is moved this far off the line it would have run along. The same amount
/// is the room a step of exactly eight points is given.
const HAIR = 0.0137;

/// One piece of the space a route sweeps: the floor under one step, up to the walker's head.
export interface Band { x0: number; x1: number; y0: number; y1: number }

/// A route: which way to walk (0 when the walker is already there) and the corridor it runs through.
export interface Route { dir: -1 | 0 | 1; bands: Band[] }

/// The highest footing within `reach` points under a point, or null. Two rays a hair apart.
const footing = (sk: SKWorld, x: number, y: number, reach: number): number | null => {
  const left = sk.rayCast({ x: x - HAIR, y }, { x: x - HAIR, y: y - reach }, FOOTING);
  const right = sk.rayCast({ x: x + HAIR, y }, { x: x + HAIR, y: y - reach }, FOOTING);
  if (!left && !right) return null;
  return Math.max(left?.point.y ?? -Infinity, right?.point.y ?? -Infinity);
};

/// Whether anything a walker cannot pass crosses a level line at height y, between two x.
const blocked = (sk: SKWorld, x0: number, x1: number, y: number): boolean => sk.rayCast({ x: x0, y }, { x: x1, y }, FOOTING) !== null;

/// The height of the footing straight under a body's centre, or null when it stands on nothing.
export const floorUnder = (sk: SKWorld, center: Vec, radius: number): number | null =>
  footing(sk, center.x, center.y, radius + STAND_SLACK);

/// Look for a way along the floor from a body to a target. The target is a rectangle; a single
/// point is a rectangle with no size. Null when the body stands on nothing or there is no way.
///
/// The probe starts on the floor under the body and takes steps of six points toward the target.
/// At each step two level rays, one at the height of the body's middle and one two points over
/// its head, must reach the next point without meeting footing, and a ray straight down from
/// there must find footing within 30 points whose height is within 8 of the last step's. The
/// probe has arrived when it is within 14 points of the target in x, the target is no more than
/// 24 points above or below a body standing there, and nothing solid stands in those last points.
export const findRoute = (sk: SKWorld, center: Vec, radius: number, target: Rect): Route | null => {
  let floor = floorUnder(sk, center, radius);
  if (floor === null) return null;
  const goalX = Math.min(Math.max(center.x, target.x), target.x + target.w);
  const dir = goalX > center.x ? 1 : goalX < center.x ? -1 : 0;
  const bands: Band[] = [];
  let x = center.x;
  for (let step = 0; step <= ROUTE_STEPS; step++) {
    const middle = floor + radius + HAIR, head = floor + 2 * radius + HEAD_ROOM + HAIR;
    if (Math.abs(goalX - x) <= ROUTE_NEAR) {
      const goalY = Math.min(Math.max(middle, target.y), target.y + target.h);
      if (Math.abs(goalY - middle) > ROUTE_RISE) return null;
      if (goalX !== x && blocked(sk, x, goalX, middle)) return null;
      bands.push({ x0: Math.min(x, goalX), x1: Math.max(x, goalX), y0: floor, y1: floor + 2 * radius });
      return { dir: Math.abs(goalX - center.x) <= ARRIVED ? 0 : dir, bands };
    }
    if (step === ROUTE_STEPS) break;
    const next = x + dir * ROUTE_STEP;
    if (blocked(sk, x, next, middle) || blocked(sk, x, next, head)) return null;
    const under = footing(sk, next, middle, ROUTE_REACH);
    if (under === null || Math.abs(under - floor) > ROUTE_LEDGE + HAIR) return null;
    bands.push({ x0: Math.min(x, next), x1: Math.max(x, next), y0: Math.min(floor, under), y1: Math.max(floor, under) + 2 * radius });
    x = next;
    floor = under;
  }
  return null;
};

/// Whether a round thing at `point` reaches into a route's corridor.
export const inCorridor = (route: Route, point: Vec, radius: number): boolean =>
  route.bands.some((b) => point.x >= b.x0 - radius && point.x <= b.x1 + radius && point.y >= b.y0 - radius && point.y <= b.y1 + radius);
