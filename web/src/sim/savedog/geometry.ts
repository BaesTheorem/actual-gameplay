// Plain 2D geometry for the draw mode: vector helpers, polyline tools and the rectangle rules the
// levels were authored against. Everything is in canvas points with y up.
import type { Vec } from "../sk";

export interface Rect { x: number; y: number; w: number; h: number }

export const ZERO: Vec = { x: 0, y: 0 };

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const length = (a: Vec): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec, b: Vec): number => Math.hypot(b.x - a.x, b.y - a.y);
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const isZero = (a: Vec): boolean => a.x === 0 && a.y === 0;
export const same = (a: Vec, b: Vec): boolean => a.x === b.x && a.y === b.y;

/// Unit vector, or zero for a zero vector.
export const normalized = (a: Vec): Vec => {
  const l = length(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};

/// Left-hand normal in a y-up space.
export const perpendicular = (a: Vec): Vec => ({ x: -a.y, y: a.x });

export const rotated = (p: Vec, angle: number): Vec => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

/// `p` cut down to `max` long when it is longer.
export const limited = (p: Vec, max: number): Vec => (length(p) > max ? scale(normalized(p), max) : p);

/// Whether a point is in a rectangle. The low edges are inside and the high edges are not.
export const contains = (r: Rect, p: Vec): boolean =>
  p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

/// Whether `inner` lies wholly inside `outer`, edges included.
export const containsRect = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/// Shrink a rectangle by dx and dy on each side. Negative values grow it.
export const inset = (r: Rect, dx: number, dy: number): Rect => ({ x: r.x + dx, y: r.y + dy, w: r.w - 2 * dx, h: r.h - 2 * dy });

export const polylineLength = (points: Vec[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
};

export const distanceToSegment = (p: Vec, a: Vec, b: Vec): number => {
  const ab = sub(b, a);
  const len2 = ab.x * ab.x + ab.y * ab.y;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2));
  return distance(p, add(a, scale(ab, t)));
};

/// Ramer-Douglas-Peucker, iterative so a long stroke cannot blow the stack.
export const simplify = (points: Vec[], epsilon: number): Vec[] => {
  if (points.length <= 2) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  let top: [number, number] | undefined;
  while ((top = stack.pop())) {
    const [s, e] = top;
    if (e <= s + 1) continue;
    let maxDistance = 0, index = s;
    for (let i = s + 1; i < e; i++) {
      const d = distanceToSegment(points[i], points[s], points[e]);
      if (d > maxDistance) { maxDistance = d; index = i; }
    }
    if (maxDistance > epsilon) {
      keep[index] = true;
      stack.push([s, index]);
      stack.push([index, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
};

/// Drop interior points that would make a segment shorter than `minLength`. Endpoints always survive.
export const mergeShortSegments = (points: Vec[], minLength: number): Vec[] => {
  if (points.length <= 2) return points;
  const out = [points[0]];
  for (const p of points.slice(1, -1)) {
    if (distance(p, out[out.length - 1]) >= minLength) out.push(p);
  }
  const last = points[points.length - 1];
  if (out.length > 1 && distance(last, out[out.length - 1]) < minLength) out[out.length - 1] = last;
  else out.push(last);
  return out;
};

/// Points spaced `spacing` apart along a polyline, endpoints included.
export const resample = (points: Vec[], spacing: number): Vec[] => {
  if (points.length <= 1 || spacing <= 0) return points;
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const segment = distance(a, b);
    if (segment <= 0) continue;
    let d = spacing - carry;
    while (d <= segment) {
      out.push(add(a, scale(sub(b, a), d / segment)));
      d += spacing;
    }
    carry = segment - (d - spacing);
  }
  const last = points[points.length - 1];
  if (!same(out[out.length - 1], last)) out.push(last);
  return out;
};

/// Corners of the rectangle that thickens segment a-b, counterclockwise in a y-up space.
export const segmentQuad = (a: Vec, b: Vec, halfWidth: number): Vec[] => {
  const n = scale(perpendicular(normalized(sub(b, a))), halfWidth);
  return [sub(a, n), sub(b, n), add(b, n), add(a, n)];
};

export const signedArea = (polygon: Vec[]): number => {
  if (polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};

export const isCounterClockwise = (polygon: Vec[]): boolean => signedArea(polygon) > 0;

export const isConvex = (polygon: Vec[]): boolean => {
  if (polygon.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], c = polygon[(i + 2) % polygon.length];
    const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(turn) < 1e-9) continue;
    const s = turn > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
};

export const centroid = (points: Vec[]): Vec => {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x * (1 / points.length), y: y * (1 / points.length) };
};

/// The first element with the smallest key, or undefined for an empty list.
export const minBy = <T>(items: readonly T[], key: (item: T) => number): T | undefined => {
  let best: T | undefined, bestKey = 0;
  for (const item of items) {
    const k = key(item);
    if (best === undefined || k < bestKey) { best = item; bestKey = k; }
  }
  return best;
};

/// The first element with the largest key, or undefined for an empty list.
export const maxBy = <T>(items: readonly T[], key: (item: T) => number): T | undefined => {
  let best: T | undefined, bestKey = 0;
  for (const item of items) {
    const k = key(item);
    if (best === undefined || k > bestKey) { best = item; bestKey = k; }
  }
  return best;
};
