// The bees' map of a level: which cells of a coarse grid are open, how far each is from a dog,
// and which way is downhill.
import type { Vec } from "../sk";
import { add, contains, distance, distanceToSegment, inset, length, normalized, scale, sub, type Rect } from "./geometry";

/// A shape the bees have to get around, in canvas coordinates.
export type Solid =
  | { kind: "segment"; a: Vec; b: Vec; radius: number }
  | { kind: "rect"; rect: Rect }
  | { kind: "circle"; center: Vec; radius: number };

export const segment = (a: Vec, b: Vec, radius: number): Solid => ({ kind: "segment", a, b, radius });
export const rect = (r: Rect): Solid => ({ kind: "rect", rect: r });
export const circle = (center: Vec, radius: number): Solid => ({ kind: "circle", center, radius });

/// The point on the shape's surface nearest `p`, and how far `p` is from it (0 inside).
export const nearest = (solid: Solid, p: Vec): { point: Vec; distance: number } => {
  switch (solid.kind) {
    case "segment": {
      const ab = sub(solid.b, solid.a);
      const len2 = ab.x * ab.x + ab.y * ab.y;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - solid.a.x) * ab.x + (p.y - solid.a.y) * ab.y) / len2));
      const core = add(solid.a, scale(ab, t));
      const away = sub(p, core);
      return { point: add(core, scale(normalized(away), solid.radius)), distance: Math.max(0, length(away) - solid.radius) };
    }
    case "rect": {
      const r = solid.rect;
      const c = { x: Math.min(Math.max(p.x, r.x), r.x + r.w), y: Math.min(Math.max(p.y, r.y), r.y + r.h) };
      return { point: c, distance: distance(p, c) };
    }
    case "circle": {
      const away = sub(p, solid.center);
      return { point: add(solid.center, scale(normalized(away), solid.radius)), distance: Math.max(0, length(away) - solid.radius) };
    }
  }
};

const FOUR: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/// A coarse distance map from the dogs through the open space of the level. Bees follow it
/// downhill, which routes them around walls and through any gap wide enough for a bee. Cells
/// with no route at all are where the shield is doing its job.
///
/// The same obstacles also carry two maps for the bees that have no route (see `BeeCrew`): which
/// pocket of open air each of them is in, and the way to their places on the structure.
export class FlowField {
  readonly cell: number;
  readonly origin: Vec;
  readonly columns: number;
  readonly rows: number;
  private blocked: Uint8Array;
  private distance: Int32Array;
  private directions: Vec[];
  private targets: { center: Vec; radius: number }[] = [];
  private regions: Int32Array;
  private crewDistance: Int32Array;
  private crewDirections: Vec[];

  constructor(bounds: Rect, cell = 6) {
    this.cell = cell;
    this.origin = { x: bounds.x, y: bounds.y };
    this.columns = Math.ceil(bounds.w / cell);
    this.rows = Math.ceil(bounds.h / cell);
    const n = this.columns * this.rows;
    this.blocked = new Uint8Array(n);
    this.distance = new Int32Array(n).fill(-1);
    this.directions = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
    this.regions = new Int32Array(n).fill(-1);
    this.crewDistance = new Int32Array(n).fill(-1);
    this.crewDirections = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
  }

  private index(c: number, r: number) { return r * this.columns + c; }

  /// The cell under a point, or -1 outside the grid. Truncation is toward zero, as the levels were tuned with.
  private cellOf(p: Vec): number {
    const c = Math.trunc((p.x - this.origin.x) / this.cell);
    const r = Math.trunc((p.y - this.origin.y) / this.cell);
    if (!(c >= 0 && c < this.columns && r >= 0 && r < this.rows)) return -1;
    return this.index(c, r);
  }

  private center(c: number, r: number): Vec {
    return { x: this.origin.x + (c + 0.5) * this.cell, y: this.origin.y + (r + 0.5) * this.cell };
  }

  /// Rasterize the solids (inflated by the bee radius), then flood from the targets.
  rebuild(solids: Solid[], targets: { center: Vec; radius: number }[], clearance: number) {
    this.blocked.fill(0);
    this.distance.fill(-1);
    // The playfield edges: a bee cannot center itself closer than its radius to a wall.
    for (let c = 0; c < this.columns; c++) {
      this.blocked[this.index(c, this.rows - 1)] = 1;
      this.blocked[this.index(c, 0)] = 1;
    }
    for (let r = 0; r < this.rows; r++) {
      this.blocked[this.index(0, r)] = 1;
      this.blocked[this.index(this.columns - 1, r)] = 1;
    }
    for (const solid of solids) {
      switch (solid.kind) {
        case "segment": {
          const { a, b, radius } = solid;
          const grow = radius + clearance;
          const box = inset({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }, -grow, -grow);
          this.mark(box, (p) => distanceToSegment(p, a, b) <= grow);
          break;
        }
        case "rect": {
          const grown = inset(solid.rect, -clearance, -clearance);
          this.mark(grown, (p) => contains(grown, p));
          break;
        }
        case "circle": {
          const c = solid.center, grown = solid.radius + clearance;
          this.mark({ x: c.x - grown, y: c.y - grown, w: 2 * grown, h: 2 * grown }, (p) => distance(p, c) <= grown);
          break;
        }
      }
    }
    this.targets = targets.map((t) => ({ center: t.center, radius: t.radius }));
    const queue: number[] = [];
    for (const target of targets) {
      const reach = target.radius + clearance;
      const box = { x: target.center.x - reach, y: target.center.y - reach, w: 2 * reach, h: 2 * reach };
      this.forEachCell(box, (c, r) => {
        if (distance(this.center(c, r), target.center) > reach) return;
        const i = this.index(c, r);
        this.blocked[i] = 0;
        if (this.distance[i] !== 0) {
          this.distance[i] = 0;
          queue.push(i);
        }
      });
    }
    this.flood(this.distance, queue);
    this.pointDownhill(this.distance, this.directions);
  }

  /// Breadth-first step counts through open cells, outward from `queue` (already at 0).
  private flood(dist: Int32Array, queue: number[]) {
    let head = 0;
    while (head < queue.length) {
      const i = queue[head];
      head += 1;
      const c = i % this.columns;
      const r = Math.floor(i / this.columns);
      const d = dist[i] + 1;
      for (const [dc, dr] of FOUR) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nc >= this.columns || nr < 0 || nr >= this.rows) continue;
        const n = this.index(nc, nr);
        if (this.blocked[n] || dist[n] >= 0) continue;
        dist[n] = d;
        queue.push(n);
      }
    }
  }

  /// Each reachable cell points at its lowest neighbour, diagonals included, for smooth paths.
  private pointDownhill(dist: Int32Array, directions: Vec[]) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        const i = this.index(c, r);
        const out = directions[i];
        out.x = 0;
        out.y = 0;
        if (dist[i] <= 0) continue;
        let best = dist[i];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dc === 0 && dr === 0) continue;
            const nc = c + dc, nr = r + dr;
            if (nc < 0 || nc >= this.columns || nr < 0 || nr >= this.rows) continue;
            const n = this.index(nc, nr);
            if (dist[n] < 0 || dist[n] >= best) continue;
            // A diagonal step must not cut a blocked corner.
            if (dc !== 0 && dr !== 0 && (this.blocked[this.index(c + dc, r)] || this.blocked[this.index(c, r + dr)])) continue;
            best = dist[n];
            const len = Math.hypot(dc, dr);
            out.x = dc / len;
            out.y = dr / len;
          }
        }
      }
    }
  }

  private forEachCell(box: Rect, body: (c: number, r: number) => void) {
    const c0 = Math.max(0, Math.trunc((box.x - this.origin.x) / this.cell));
    const c1 = Math.min(this.columns - 1, Math.trunc((box.x + box.w - this.origin.x) / this.cell));
    const r0 = Math.max(0, Math.trunc((box.y - this.origin.y) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.trunc((box.y + box.h - this.origin.y) / this.cell));
    if (c0 > c1 || r0 > r1) return;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) body(c, r);
    }
  }

  private mark(bbox: Rect, inside: (p: Vec) => boolean) {
    this.forEachCell(bbox, (c, r) => {
      if (inside(this.center(c, r))) this.blocked[this.index(c, r)] = 1;
    });
  }

  /// Unit direction to follow from `point`, or null when there is no route from here.
  direction(point: Vec): Vec | null {
    const i = this.cellOf(point);
    if (i < 0) return null;
    if (this.distance[i] === 0) {
      let target = point, best = Infinity;
      for (const t of this.targets) {
        const d = distance(t.center, point);
        if (d < best) { best = d; target = t.center; }
      }
      return normalized(sub(target, point));
    }
    if (this.distance[i] <= 0) return null;
    return this.directions[i];
  }

  /// Whether any open cell next to `point` has a route, for bees sitting in a blocked cell.
  nearbyDirection(point: Vec): Vec | null {
    const here = this.direction(point);
    if (here) return here;
    const s = this.cell;
    for (const [dx, dy] of [[s, 0], [-s, 0], [0, s], [0, -s], [s, s], [-s, s], [s, -s], [-s, -s]]) {
      const d = this.direction({ x: point.x + dx, y: point.y + dy });
      if (d) return d;
    }
    return null;
  }

  /// True when at least one cell away from the dogs has a route to one.
  get anyRoute(): boolean { return this.distance.some((d) => d > 0); }

  // MARK: crews

  private around(): [number, number][] {
    const s = this.cell;
    return [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s], [s, s], [-s, s], [s, -s], [-s, -s]];
  }

  /// The cell at `point` if it is open, else the first open neighbour: a bee pressed flat on a
  /// shield sits inside the shield's inflated border.
  private openCell(point: Vec): number {
    for (const [dx, dy] of this.around()) {
      const i = this.cellOf({ x: point.x + dx, y: point.y + dy });
      if (i >= 0 && !this.blocked[i]) return i;
    }
    return -1;
  }

  /// Split the open space into the pockets the given bees are in: every cell a bee at
  /// `seeds[k]` could fly to gets the smallest such k. Level 11's two holes under the floor come
  /// out as two regions, so each crew only plans around what its own bees can touch.
  markRegions(seeds: Vec[]) {
    this.regions.fill(-1);
    seeds.forEach((seed, label) => {
      const start = this.openCell(seed);
      if (start < 0 || this.regions[start] >= 0) return;
      this.regions[start] = label;
      const queue = [start];
      let head = 0;
      while (head < queue.length) {
        const i = queue[head];
        head += 1;
        const c = i % this.columns;
        const r = Math.floor(i / this.columns);
        for (const [dc, dr] of FOUR) {
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nc >= this.columns || nr < 0 || nr >= this.rows) continue;
          const n = this.index(nc, nr);
          if (this.blocked[n] || this.regions[n] >= 0) continue;
          this.regions[n] = label;
          queue.push(n);
        }
      }
    });
  }

  /// The region of the cell under `point`, or null for a blocked or unvisited cell.
  regionAt(point: Vec): number | null {
    const i = this.cellOf(point);
    if (i < 0) return null;
    return this.regions[i] >= 0 ? this.regions[i] : null;
  }

  /// The region a bee is in, looking one cell around it when it is pressed against something.
  regionNear(point: Vec): number | null {
    const i = this.openCell(point);
    if (i < 0) return null;
    return this.regions[i] >= 0 ? this.regions[i] : null;
  }

  /// Flood from the crew's places on a structure, through the same open space. A bee on its way
  /// to a place follows this; the dog's map would walk it into the shield instead.
  routeCrew(points: Vec[]) {
    this.crewDistance.fill(-1);
    const queue: number[] = [];
    for (const p of points) {
      const i = this.cellOf(p);
      if (i < 0) continue;
      if (this.crewDistance[i] !== 0) {
        this.crewDistance[i] = 0;
        queue.push(i);
      }
    }
    this.flood(this.crewDistance, queue);
    this.pointDownhill(this.crewDistance, this.crewDirections);
  }

  /// Direction toward the nearest crew place and how many cells away it is, looking one cell
  /// around for bees in a blocked cell. Null where no place can be reached.
  crewRoute(point: Vec): { direction: Vec; steps: number } | null {
    for (const [dx, dy] of this.around()) {
      const i = this.cellOf({ x: point.x + dx, y: point.y + dy });
      if (i >= 0 && this.crewDistance[i] >= 0) return { direction: this.crewDirections[i], steps: this.crewDistance[i] };
    }
    return null;
  }
}
