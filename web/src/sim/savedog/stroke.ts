// Ink: the stroke being drawn, the clean-up a finished stroke gets, and the rigid body it becomes.
import type * as planck from "planck";
import { SKWorld, position, setMass, type BodySpec, type Vec } from "../sk";
import {
  add, centroid, contains, distance, mergeShortSegments, pointAlong, polylineLength, scale, segmentQuad, simplify, slice, sub, type Rect,
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
  /// Falling boulders: they push ink and flatten him, and bees fly through them.
  rock: 1 << 7,
};

export const WIDTH = 8;
export const MIN_SEGMENT = 4;
/// Shorter than this and the stroke becomes a dot.
export const MIN_LENGTH = 6;
export const EPSILON = 1.5;
export const DOT_COST = 8;
/// A burning piece shorter than this is ash.
export const STUB = 2;

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
  /// The ink that is left, in the stroke's own frame, about the centroid it was drawn with.
  local: Vec[];
  /// Null once a saw, a pit or a fire has taken the stroke.
  body: planck.Body | null;
  /// It has made its landing sound.
  landed = false;
  state: "live" | "cut" | "sunk" | "burnt" = "live";
  /// When it was cut, sank or burned out, in level seconds.
  since = 0;
  /// False once the fade that follows a cut or a sinking is over.
  attached = true;
  /// The ends that are on fire. A burning end loses ink at the burn's speed until none is left.
  readonly burning = { start: false, end: false };
  /// Goes up each time the ink changes shape, so whoever draws it knows to draw it again.
  revision = 0;
  /// The stroke as it was made, and how far along it the ink that is left starts and stops.
  private readonly outline: Vec[];
  private from = 0;
  private to: number;
  private rest: Vec;
  private restAngle = 0;

  constructor(readonly id: number, readonly points: Vec[], readonly dynamic: boolean, sk: SKWorld) {
    const center = centroid(points);
    this.outline = points.map((p) => sub(p, center));
    this.local = this.outline;
    this.to = polylineLength(this.outline);
    this.rest = center;
    this.body = makeBody(sk, center, this.local, dynamic, this);
  }

  get position(): Vec { return this.body ? position(this.body) : this.rest; }
  get angle(): number { return this.body ? this.body.getAngle() : this.restAngle; }
  /// How much ink is left, along the stroke. A dot has none.
  get length(): number { return this.to - this.from; }
  /// The ink that is left as distances along the stroke as it was made.
  get span(): { from: number; to: number } { return { from: this.from, to: this.to }; }
  get alight(): boolean { return this.burning.start || this.burning.end; }

  /// A point of the stroke's own frame, where it is now on the canvas.
  toWorld(p: Vec): Vec {
    const at = this.position, c = Math.cos(this.angle), s = Math.sin(this.angle);
    return { x: at.x + p.x * c - p.y * s, y: at.y + p.x * s + p.y * c };
  }

  /// The points where they are now, in canvas coordinates.
  get world(): Vec[] { return this.local.map((p) => this.toWorld(p)); }

  /// The point this far along the stroke as it was made, where it is now on the canvas.
  worldAt(along: number): Vec { return this.toWorld(pointAlong(this.outline, along)); }

  /// Keep only the ink between two distances along the stroke as it was made. The body stays
  /// where it is and takes the shape and the weight of what is left.
  keep(sk: SKWorld, from: number, to: number) {
    this.from = Math.max(this.from, from);
    this.to = Math.min(this.to, to);
    if (!this.body || this.to - this.from < STUB) return;
    this.local = tidy(slice(this.outline, this.from, this.to));
    for (let fixture = this.body.getFixtureList(); fixture;) {
      const next = fixture.getNext();
      this.body.destroyFixture(fixture);
      fixture = next;
    }
    addShapes(sk, this.body, this.local, inkSpec(this.dynamic, this.rest, this));
    if (this.dynamic) setMass(this.body, mass(polylineLength(this.local)));
    this.revision += 1;
  }

  /// Leave the physics: the stroke stays where it is for the fade and nothing touches it again.
  release(sk: SKWorld, state: "cut" | "sunk" | "burnt", now: number) {
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

/// A polyline fit to be a body: an end segment under a point long is dropped, because a sliver
/// that thin is lost in the engine's tolerances.
const tidy = (points: Vec[]): Vec[] => {
  const out = [...points];
  while (out.length > 2 && distance(out[0], out[1]) < 1) out.splice(0, 1);
  while (out.length > 2 && distance(out[out.length - 1], out[out.length - 2]) < 1) out.splice(out.length - 1, 1);
  return out;
};

const inkSpec = (dynamic: boolean, center: Vec, ref?: unknown): BodySpec => ({
  kind: "stroke", dynamic, position: center, friction: 0.9, restitution: 0.05, linearDamping: 0.1, angularDamping: 0.1,
  category: Cat.drawn,
  collision: Cat.wall | Cat.drawn | Cat.actor | Cat.killer | Cat.bee | Cat.prop | Cat.rock,
  contactTest: Cat.killer,
  ref,
});

/// One convex quad per segment plus a disc at each interior joint.
const addShapes = (sk: SKWorld, body: planck.Body, local: Vec[], spec: BodySpec) => {
  if (local.length === 1) {
    sk.addCircle(body, WIDTH / 2, local[0], spec);
    return;
  }
  for (let i = 1; i < local.length; i++) {
    sk.addPolygon(body, segmentQuad(local[i - 1], local[i], WIDTH / 2), spec);
    if (i < local.length - 1) sk.addCircle(body, WIDTH / 2, local[i], spec);
  }
};

/// One convex quad per segment plus a disc at each interior joint, combined into one body.
/// The drawn stroke and the quads come from the same points, so the visible stroke and the
/// collision silhouette coincide. Below about a point the engine's slop tolerances take over,
/// hence the minimum segment length and width.
export const makeBody = (sk: SKWorld, center: Vec, local: Vec[], dynamic: boolean, ref?: unknown): planck.Body => {
  const spec = inkSpec(dynamic, center, ref);
  const body = sk.body(spec);
  addShapes(sk, body, local, spec);
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
