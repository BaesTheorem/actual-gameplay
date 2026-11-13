// Ink: the stroke being drawn, the clean-up a finished stroke gets, and the rigid body it becomes.
import type * as planck from "planck";
import { SKWorld, position, setMass, type Vec } from "../sk";
import {
  add, centroid, contains, distance, mergeShortSegments, polylineLength, scale, segmentQuad, simplify, sub, type Rect,
} from "./geometry";

export const Cat = {
  wall: 1 << 0,
  drawn: 1 << 1,
  actor: 1 << 2,
  killer: 1 << 3,
  bee: 1 << 4,
  prop: 1 << 5,
  /// Water and lava pits: nothing rests on them, he dies in them, bees fly over them.
  liquid: 1 << 6,
};

export const WIDTH = 8;
export const MIN_SEGMENT = 4;
/// Shorter than this and the stroke becomes a dot.
export const MIN_LENGTH = 6;
export const EPSILON = 1.5;
export const DOT_COST = 8;

/// Natural mass at density 1 for a stroke of this length. A compound body counts its overlaps
/// twice, so the mass is set outright instead of trusting what the shapes add up to.
export const mass = (length: number): number => (Math.max(length, WIDTH) * WIDTH) / 22_500;

/// Simplified, de-jittered points for a raw touch polyline. A single point means "dot".
export const prepare = (raw: Vec[]): Vec[] => {
  if (raw.length === 0) return [];
  const first = raw[0];
  if (polylineLength(raw) < MIN_LENGTH) return [first];
  const merged = mergeShortSegments(simplify(raw, EPSILON), MIN_SEGMENT);
  return merged.length >= 2 ? merged : [first];
};

export const inkCost = (rawLength: number): number => (rawLength < MIN_LENGTH ? DOT_COST : rawLength);

/// One piece of committed ink. The renderer draws `local` at `position` turned by `angle`.
export class Stroke {
  /// The points in the stroke's own frame, about the centroid it was drawn with.
  readonly local: Vec[];
  /// Null once a saw or a pit has taken the stroke.
  body: planck.Body | null;
  /// It has made its landing sound.
  landed = false;
  state: "live" | "cut" | "sunk" = "live";
  /// When it was cut or sank, in level seconds.
  since = 0;
  /// False once the fade that follows a cut or a sinking is over.
  attached = true;
  private rest: Vec;
  private restAngle = 0;

  constructor(readonly id: number, readonly points: Vec[], readonly dynamic: boolean, sk: SKWorld) {
    const center = centroid(points);
    this.local = points.map((p) => sub(p, center));
    this.rest = center;
    this.body = makeBody(sk, center, this.local, dynamic, this);
  }

  get position(): Vec { return this.body ? position(this.body) : this.rest; }
  get angle(): number { return this.body ? this.body.getAngle() : this.restAngle; }

  /// The points where they are now, in canvas coordinates.
  get world(): Vec[] {
    const at = this.position, c = Math.cos(this.angle), s = Math.sin(this.angle);
    return this.local.map((p) => ({ x: at.x + p.x * c - p.y * s, y: at.y + p.x * s + p.y * c }));
  }

  /// Leave the physics: the stroke stays where it is for the fade and nothing touches it again.
  release(sk: SKWorld, state: "cut" | "sunk", now: number) {
    if (!this.body) return;
    this.rest = position(this.body);
    this.restAngle = this.body.getAngle();
    sk.remove(this.body);
    this.body = null;
    this.state = state;
    this.since = now;
  }

  /// A sinking stroke drops 14 points over its fade.
  sinkBy(dy: number) { this.rest = { x: this.rest.x, y: this.rest.y - dy }; }
}

/// One convex quad per segment plus a disc at each interior joint, combined into one body.
/// The drawn stroke and the quads come from the same points, so the visible stroke and the
/// collision silhouette coincide. Below about a point the engine's slop tolerances take over,
/// hence the minimum segment length and width.
export const makeBody = (sk: SKWorld, center: Vec, local: Vec[], dynamic: boolean, ref?: unknown): planck.Body => {
  const spec = {
    kind: "stroke", dynamic, position: center, friction: 0.9, restitution: 0.05, linearDamping: 0.1, angularDamping: 0.1,
    category: Cat.drawn,
    collision: Cat.wall | Cat.drawn | Cat.actor | Cat.killer | Cat.bee | Cat.prop,
    contactTest: Cat.killer,
    ref,
  };
  const body = sk.body(spec);
  if (local.length === 1) {
    sk.addCircle(body, WIDTH / 2, local[0], spec);
  } else {
    for (let i = 1; i < local.length; i++) {
      sk.addPolygon(body, segmentQuad(local[i - 1], local[i], WIDTH / 2), spec);
      if (i < local.length - 1) sk.addCircle(body, WIDTH / 2, local[i], spec);
    }
  }
  if (dynamic) setMass(body, mass(polylineLength(local)));
  return body;
};

/// Owns the stroke being drawn: samples touch points and meters ink, then hands the finished
/// polyline back. Replayed strokes skip this and go straight to the commit path, which is the
/// same code a finished touch stroke runs through.
export class StrokeCapture {
  static readonly sampleSpacing = 1.5;

  inkUsed = 0;
  isDrawing = false;
  /// The live stroke, for the renderer.
  points: Vec[] = [];

  constructor(readonly drawArea: Rect, readonly budget: number) {}

  /// Ink still available, counting the stroke in progress.
  get inkLeft(): number {
    return Math.max(0, this.budget - this.inkUsed - (this.isDrawing ? polylineLength(this.points) : 0));
  }

  begin(p: Vec) {
    if (this.isDrawing || !contains(this.drawArea, p) || this.budget - this.inkUsed < 1) return;
    this.isDrawing = true;
    this.points = [p];
  }

  move(p: Vec) {
    if (!this.isDrawing || this.points.length === 0) return;
    const last = this.points[this.points.length - 1];
    const a = this.drawArea;
    const clamped = { x: Math.min(Math.max(p.x, a.x), a.x + a.w), y: Math.min(Math.max(p.y, a.y), a.y + a.h) };
    const d = distance(last, clamped);
    if (d < StrokeCapture.sampleSpacing) return;
    const remaining = this.budget - this.inkUsed - polylineLength(this.points);
    if (remaining <= 0) return;
    this.points.push(d > remaining ? add(last, scale(sub(clamped, last), remaining / d)) : clamped);
  }

  /// Ends the stroke and returns the raw sampled polyline, or null if nothing was in progress.
  end(): Vec[] | null {
    if (!this.isDrawing) return null;
    this.isDrawing = false;
    const points = this.points;
    this.points = [];
    return points;
  }

  cancel() {
    this.isDrawing = false;
    this.points = [];
  }

  spend(ink: number) { this.inkUsed += ink; }
}
