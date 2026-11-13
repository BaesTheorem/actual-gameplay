// Lane space to screen. x runs across the road in [-1, 1]; z is depth ahead of the camera in
// lane units. A plain perspective divide gives the trapezoid road and depth-scaled sprites.
import type { Vec } from "../sk";

export const Projection = {
  near: 6,
  nearY: 140,
  horizonY: 640,
  halfRoad: 170,
  centerX: 201,
  farZ: 40,
  /// Where the player's crowd sits, a little up the road so gates approach from above.
  anchorZ: 2,

  scale: (z: number): number => Projection.near / (Projection.near + Math.max(z, -4)),

  point(x: number, z: number): Vec {
    const s = Projection.scale(z);
    return {
      x: Projection.centerX + x * Projection.halfRoad * s,
      y: Projection.nearY + (Projection.horizonY - Projection.nearY) * (1 - s),
    };
  },

  /// Screen points per lane unit at depth z.
  laneWidth: (z: number): number => Projection.halfRoad * Projection.scale(z),

  get roadPolygon(): Vec[] {
    const far = Projection.farZ;
    return [Projection.point(-1, 0), Projection.point(1, 0), Projection.point(1, far), Projection.point(-1, far)];
  },
};
