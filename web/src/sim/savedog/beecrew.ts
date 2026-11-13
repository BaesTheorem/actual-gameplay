// How the bees work together once the flow field says there is no way in.
//
// Pressing wherever they land spreads the swarm over the whole shield, and a shield only ever has
// to out-weigh the few bees on any one side of it. A crew instead picks the least secure loose
// body it can reach (light, little fixed footing under it, or resting on the dog), spreads along
// the side of it that faces the swarm, backs off together, hits it together, and eases off
// together. Each heave goes somewhere the last one did not: the far end instead of the middle,
// since torque tips what a straight push cannot slide, and every other pair tilted 30 degrees up,
// since lifting takes the friction away. Two proper heaves in a row that move nothing, and the
// crew moves on to the next weakest body. Bees in different pockets of open air (the two holes
// under the floor of Holes below) are separate crews with their own targets.
//
// Nothing here is random: every choice follows from the physics state, so a replay stays
// reproducible.
import type { Vec } from "../sk";
import { FlowField, nearest, type Solid } from "./flowfield";
import {
  add, centroid, cross, distance, dot, isZero, limited, maxBy, minBy, normalized, perpendicular, resample, rotated, scale, sub,
} from "./geometry";

/// The swarm's accelerations, in points per second squared (times mass gives the impulse per second).
export const Swarm = {
  cruise: 720,        // open air: 0 to the 260 pt/s clamp in about a third of a second
  press: 220,         // steady lean on a surface
  shove: 900,         // the burst
  shovePeriod: 3.0,
  shoveLength: 0.6,
  topSpeed: 260,
};

export const BEE_RADIUS = 6;
export const DOG_RADIUS = 18;

/// Something the crew can stand against: where it is, how it is turned, and whether it is still in the level.
export interface CrewNode { readonly position: Vec; readonly angle: number; readonly attached: boolean }

/// What the crew needs of a bee.
export interface CrewBee { readonly position: Vec }

/// A loose body as the crew sees it.
export interface CrewBody {
  node: CrewNode;
  mass: number;
  /// Points along the middle of the body in its own frame: a stroke's polyline, a box's
  /// corners (closed), a ball's centre.
  spine: Vec[];
  closed: boolean;
  /// From the spine to the surface: half a stroke's width, a ball's radius, 0 for a box outline.
  thickness: number;
}

export type Phase = "gather" | "windup" | "heave" | "ease";

/// One bee's orders: where to stand, in the body's own frame so the place rides along when the
/// body moves, and which way the crew pushes.
interface Post { node: CrewNode; local: Vec; push: Vec }

/// What the crew remembers about a body it has worked on.
interface CrewRecord {
  play: number;
  misses: number;
  done: boolean;
  reach: number;
  pose: { position: Vec; angle: number } | null;
  /// Half its crew was in position at the wind-up, so the heave was a fair test.
  fair: boolean;
}

/// A place a bee could stand against a body.
interface Face {
  spot: Vec;
  contact: Vec;
  normal: Vec;
  region: number | null;
  /// The dog's map reaches this side: the body is part of what keeps the bees out.
  inside: boolean;
}

interface Assessment { body: CrewBody; center: Vec; reach: number; security: number; faces: Face[] }

/// A point in `node`'s frame, in canvas coordinates.
const toWorld = (p: Vec, node: CrewNode): Vec => add(node.position, rotated(p, node.angle));
const toLocal = (p: Vec, node: CrewNode): Vec => rotated(sub(p, node.position), -node.angle);

export class BeeCrew {
  /// Between neighbours on a face: a bee is 12 pt across.
  static readonly spacing = 12;
  /// This close to its place a bee counts as in position.
  static readonly ready = 24;
  /// Heave once half the living bees are in position, but lean at least this long first, and
  /// never wait longer than `patience` for stragglers.
  static readonly settle = 0.6;
  static readonly patience = 2.5;
  static readonly windup = 0.5;
  static readonly backOff = 14;
  static readonly heaveLength = 0.6;
  /// After a heave the crew eases off rather than letting go. A body rocked by a heave and
  /// dropped all at once rocks back past where it started: an L whose outer corner is only about
  /// 1.3 pt of lift from going over rolled out of its cave mouth that way.
  static readonly easeLength = 0.4;
  /// The coordinated shove, in pt/s^2 per bee like the swarm's other accelerations. Seven bees
  /// under a 56 pt bar outweigh it, and a crew that lifts at the far end tips it, which sets the
  /// ceiling: 1.2 times the swarm's shove never lost that level, 1.3 lost it twice.
  static readonly heave = Swarm.shove * 1.15;
  /// A heave that shifts the body less than this (points, rotation counted at its far end) did nothing.
  static readonly budged = 10;
  static readonly tilt = Math.PI / 6;

  /// The order a crew tries things on one body, one step per heave. Moving a body is not the
  /// same as opening it (a lid on the dog rocks every time it is pushed straight down), so the
  /// crew keeps changing its angle for as long as it stays on a body. Starting with the far end
  /// measured worse: pushing the top of an L down and in pries its outer corner up.
  private static readonly plays: { far: boolean; up: boolean }[] = [
    { far: false, up: false }, { far: true, up: true }, { far: false, up: true }, { far: true, up: false },
  ];

  phase: Phase = "gather";
  private phaseStart = 0;
  /// Share of the heave still in the push while easing off, 1 down to 0.
  private easing = 0;
  private posts = new Map<CrewBee, Post>();
  private records = new Map<CrewNode, CrewRecord>();
  /// Bodies with a crew on them this cycle, in plan order.
  private working: CrewNode[] = [];

  get active(): boolean { return this.posts.size > 0; }

  /// Where a bee has been told to stand, in canvas coordinates, or null when it has no orders.
  placeOf(bee: CrewBee): Vec | null {
    const post = this.posts.get(bee);
    return post ? toWorld(post.local, post.node) : null;
  }

  private record(node: CrewNode): CrewRecord {
    let record = this.records.get(node);
    if (!record) {
      record = { play: 0, misses: 0, done: false, reach: 0, pose: null, fair: false };
      this.records.set(node, record);
    }
    return record;
  }

  // MARK: planning

  /// Re-read the level and hand out places. Runs with every flow field rebuild while the crew
  /// gathers; through a wind-up, heave and ease the places stay put so everyone hits the same thing.
  plan(bodies: CrewBody[], anchors: Solid[], dogs: Vec[], stuck: CrewBee[], field: FlowField) {
    if (this.phase !== "gather") return;
    this.posts = new Map();
    this.working = [];
    const places: Vec[] = [];
    if (stuck.length > 0 && bodies.length > 0 && dogs.length > 0) {
      field.markRegions(stuck.map((bee) => bee.position));
      const groups: { region: number; bees: CrewBee[] }[] = [];
      for (const bee of stuck) {
        const region = field.regionNear(bee.position);
        if (region === null) continue;
        const group = groups.find((g) => g.region === region);
        if (group) group.bees.push(bee);
        else groups.push({ region, bees: [bee] });
      }
      const assessed = bodies.map((body) => this.assess(body, anchors, dogs, field));
      for (const group of groups) {
        const order = this.orders(group.bees, group.region, assessed, dogs, field);
        if (!order) continue;
        const node = order.target.body.node;
        this.record(node).reach = order.target.reach;
        if (!this.working.includes(node)) this.working.push(node);
        this.assign(group.bees, order.spots, node, order.push);
        places.push(...order.spots);
      }
    }
    field.routeCrew(places);
  }

  /// How hard a body would be to shift, and every place a bee could push it from.
  private assess(body: CrewBody, anchors: Solid[], dogs: Vec[], field: FlowField): Assessment {
    const node = body.node;
    const world = body.spine.map((p) => toWorld(p, node));
    const path = body.closed ? [...world, world[0]] : world;
    const samples = path.length > 1 ? resample(path, 4) : world;
    const center = body.closed || world.length === 1 ? node.position : centroid(samples);
    let far = 0;
    for (const s of samples) far = Math.max(far, distance(s, center));
    const reach = far + body.thickness;

    // Footing: where fixed things hold it up from below, and whether the dog is one of them.
    const supports: number[] = [];
    let onDog = false;
    for (const s of samples) {
      for (const anchor of anchors) {
        const { point: c, distance: gap } = nearest(anchor, s);
        if (gap <= body.thickness + 2.5 && c.y < center.y - 2 && c.y <= s.y + 1) supports.push(c.x);
      }
      if (dogs.some((dog) => distance(dog, s) <= DOG_RADIUS + body.thickness + 2.5)) onDog = true;
    }
    let footing = 0.2;   // held up only by the dog or by other loose ink
    if (supports.length > 0) {
      // Balanced over a single point or overhanging its support is a tip waiting to happen;
      // a centre of mass well inside a wide stance is not.
      const lo = Math.min(...supports), hi = Math.max(...supports);
      const margin = Math.min(center.x - lo, hi - center.x);
      footing = margin < 3 ? 0.5 : 1 + margin / 20;
    }
    if (onDog) footing *= 0.5;

    const faces: Face[] = [];
    const standoff = body.thickness + BEE_RADIUS + 1;
    const probe = body.thickness + BEE_RADIUS + field.cell;
    const face = (s: Vec, n: Vec) => {
      const out = add(s, scale(n, probe));
      faces.push({
        spot: add(s, scale(n, standoff)), contact: add(s, scale(n, body.thickness)), normal: n,
        region: field.regionAt(out), inside: field.direction(out) !== null,
      });
    };
    if (world.length === 1) {
      const count = Math.max(8, Math.round((2 * Math.PI * standoff) / 6));
      for (let k = 0; k < count; k++) {
        const a = (2 * Math.PI * k) / count;
        face(world[0], { x: Math.cos(a), y: Math.sin(a) });
      }
    } else {
      const points = resample(path, 6);
      points.forEach((p, i) => {
        const t = normalized(sub(points[Math.min(points.length - 1, i + 1)], points[Math.max(0, i - 1)]));
        if (isZero(t)) return;
        const n = perpendicular(t);
        if (body.closed) {
          face(p, dot(n, sub(p, center)) >= 0 ? n : scale(n, -1));
        } else {
          face(p, n);
          face(p, scale(n, -1));
        }
      });
      if (!body.closed && points.length > 1) {
        // The ends: a bar can be pushed lengthways or tipped from its corner.
        const first = points[0], last = points[points.length - 1];
        const ends: [Vec, Vec][] = [
          [first, normalized(sub(first, points[1]))],
          [last, normalized(sub(last, points[points.length - 2]))],
        ];
        for (const [p, t] of ends) {
          if (isZero(t)) continue;
          face(p, t);
          face(p, rotated(t, Math.PI / 4));
          face(p, rotated(t, -Math.PI / 4));
        }
      }
    }
    return { body, center, reach, security: body.mass * footing, faces };
  }

  /// The target, places and push direction for one crew, or null if it can reach nothing loose.
  private orders(bees: CrewBee[], region: number, assessed: Assessment[], dogs: Vec[], field: FlowField):
    { target: Assessment; spots: Vec[]; push: Vec } | null {
    const reachable = assessed.filter((a) => a.faces.some((f) => f.region === region));
    // Bodies that also face the dog are the ones keeping the bees out. Anything else the crew
    // can touch (an outer layer, a stray stroke) is only worth a push when nothing better is left.
    const sealing = reachable.filter((a) => a.faces.some((f) => f.inside));
    let pool = sealing.length === 0 ? reachable : sealing;
    if (pool.length === 0) return null;
    const done = (a: Assessment) => this.records.get(a.body.node)?.done === true;
    if (pool.every(done)) {
      for (const a of pool) {
        const record = this.records.get(a.body.node);
        if (record) record.done = false;
      }
    }
    pool = pool.filter((a) => !done(a));
    const target = minBy(pool, (a) => a.security);
    if (!target) return null;
    const dog = minBy(dogs, (d) => distance(d, target.center));
    if (!dog) return null;

    const play = BeeCrew.plays[(this.records.get(target.body.node)?.play ?? 0) % BeeCrew.plays.length];
    const toward = normalized(sub(dog, target.center));
    const faces = target.faces.filter((f) => f.region === region);
    const pressing = faces.filter((f) => dot(scale(f.normal, -1), toward) > 0.2);
    const usable = pressing.length === 0 ? faces : pressing;
    const middle = centroid(bees.map((bee) => bee.position));
    // Lever arm about the centre of mass for a push toward the dog; ties go to the higher
    // point (tips rather than slides) and then to the side the crew is already on.
    const lever = (f: Face) => Math.abs(cross(sub(f.contact, target.center), toward));
    const tipping = (f: Face) => lever(f) + 0.02 * f.contact.y - 0.01 * distance(f.spot, middle);
    const centred = (f: Face) => lever(f) + 0.01 * distance(f.spot, middle);
    const anchor = play.far ? maxBy(usable, tipping) : minBy(usable, centred);
    if (!anchor) return null;
    let push = normalized(sub(dog, anchor.contact));
    if (isZero(push)) push = toward;
    if (play.up) push = BeeCrew.tilted(push);

    // Places along the face nearest the push point, a bee's width apart, then rows behind
    // them for a crew bigger than the face.
    const lined = faces.filter((f) => dot(scale(f.normal, -1), push) > 0.2);
    const candidates = [...(lined.length === 0 ? usable : lined)]
      .map((f) => ({ f, gap: distance(f.spot, anchor.spot) }))
      .sort((a, b) => a.gap - b.gap)
      .map((entry) => entry.f);
    const spots: Vec[] = [];
    for (const f of candidates) {
      if (spots.length >= bees.length) break;
      if (spots.every((s) => distance(s, f.spot) >= BeeCrew.spacing)) spots.push(f.spot);
    }
    const front = [...spots];
    for (let row = 1; row <= 3 && spots.length < bees.length; row++) {
      for (const spot of front) {
        if (spots.length >= bees.length) break;
        const p = sub(spot, scale(push, BeeCrew.spacing * row));
        if (field.regionAt(p) === region && spots.every((s) => distance(s, p) >= BeeCrew.spacing * 0.9)) spots.push(p);
      }
    }
    if (spots.length === 0) return null;
    return { target, spots, push };
  }

  /// Nearest bee to nearest place first; a crew bigger than its places doubles up.
  private assign(bees: CrewBee[], spots: Vec[], node: CrewNode, push: Vec) {
    const pairs: { gap: number; bee: number; spot: number }[] = [];
    bees.forEach((bee, b) => {
      spots.forEach((spot, s) => pairs.push({ gap: distance(bee.position, spot), bee: b, spot: s }));
    });
    pairs.sort((p, q) => p.gap - q.gap || p.bee - q.bee || p.spot - q.spot);
    const given = new Array<number | null>(bees.length).fill(null);
    const taken = new Array<boolean>(spots.length).fill(false);
    for (const pair of pairs) {
      if (given[pair.bee] !== null || taken[pair.spot]) continue;
      given[pair.bee] = pair.spot;
      taken[pair.spot] = true;
    }
    bees.forEach((bee, b) => {
      let s = given[b];
      if (s === null) {
        s = 0;
        for (let k = 1; k < spots.length; k++) {
          if (distance(bee.position, spots[k]) < distance(bee.position, spots[s])) s = k;
        }
      }
      this.posts.set(bee, { node, local: toLocal(spots[s], node), push });
    });
  }

  // MARK: the heave cycle

  /// Advance gather, wind-up, heave and ease. Call every frame with every living bee.
  tick(now: number, bees: CrewBee[]) {
    switch (this.phase) {
      case "gather": {
        if (!this.active) {
          this.phaseStart = now;   // the wait only counts while there is a crew
          return;
        }
        const waited = now - this.phaseStart;
        if (waited < BeeCrew.settle) return;
        const placed = bees.filter((bee) => this.inPosition(bee)).length;
        if (!(placed * 2 >= bees.length || waited >= BeeCrew.patience)) return;
        for (const node of this.working) {
          const crew = bees.filter((bee) => this.posts.get(bee)?.node === node);
          const record = this.record(node);
          record.pose = { position: node.position, angle: node.angle };
          record.fair = crew.filter((bee) => this.inPosition(bee)).length * 2 >= crew.length;
        }
        this.phase = "windup";
        this.phaseStart = now;
        break;
      }
      case "windup":
        if (now - this.phaseStart >= BeeCrew.windup) {
          this.phase = "heave";
          this.phaseStart = now;
        }
        break;
      case "heave":
        if (now - this.phaseStart >= BeeCrew.heaveLength) {
          this.phase = "ease";
          this.phaseStart = now;
          this.easing = 1;
        }
        break;
      case "ease":
        this.easing = Math.max(0, 1 - (now - this.phaseStart) / BeeCrew.easeLength);
        if (now - this.phaseStart >= BeeCrew.easeLength) {
          this.judge();
          this.phase = "gather";
          this.phaseStart = now;
        }
        break;
    }
  }

  /// Did each target move? After two proper heaves in a row that did nothing, give the body up
  /// for the next weakest.
  private judge() {
    for (const node of this.working) {
      const record = this.records.get(node);
      if (!record || !record.pose) continue;
      const pose = record.pose;
      const turned = Math.abs(Math.atan2(Math.sin(node.angle - pose.angle), Math.cos(node.angle - pose.angle)));
      const moved = distance(node.position, pose.position) + turned * record.reach;
      record.play += 1;
      if (moved > BeeCrew.budged || !node.attached) {
        record.misses = 0;
      } else if (record.fair) {
        record.misses += 1;
        if (record.misses >= 2) {
          record.done = true;
          record.misses = 0;
        }
      }
      record.pose = null;
    }
  }

  private inPosition(bee: CrewBee): boolean {
    const post = this.posts.get(bee);
    if (!post) return false;
    return distance(bee.position, toWorld(post.local, post.node)) <= BeeCrew.ready;
  }

  // MARK: steering

  /// This frame's acceleration (pt/s^2) for a bee with orders, or null when it has none.
  steer(bee: CrewBee, velocity: Vec, field: FlowField | null): Vec | null {
    const post = this.posts.get(bee);
    if (!post || !post.node.attached) return null;
    const spot = toWorld(post.local, post.node);
    const v = velocity;
    const gap = distance(bee.position, spot);
    // In position: back off together, hit together, ease off together. A bee still on its
    // way keeps going.
    if (gap < 30) {
      switch (this.phase) {
        case "heave": return scale(post.push, BeeCrew.heave);
        case "ease": return scale(post.push, Swarm.press + (BeeCrew.heave - Swarm.press) * this.easing);
        case "windup": return this.arrive(bee.position, v, sub(spot, scale(post.push, BeeCrew.backOff)));
        case "gather": break;
      }
    }
    // Far off: the crew map, which goes around the shield rather than into it.
    if (gap > BeeCrew.ready) {
      const route = field?.crewRoute(bee.position);
      if (route && route.steps > 2) {
        const want = scale(route.direction, Swarm.topSpeed);
        return limited(scale(sub(want, v), 6), Swarm.cruise);
      }
    }
    // Close: straight to the place, and lean on the body once there.
    let a = this.arrive(bee.position, v, spot);
    if (gap < 10) a = add(a, scale(post.push, Swarm.press));
    return a;
  }

  /// Fly to `target` and stop there: close the distance in about a sixth of a second, with the
  /// velocity error as the brake.
  private arrive(p: Vec, v: Vec, target: Vec): Vec {
    const want = limited(scale(sub(target, p), 6), Swarm.topSpeed);
    return limited(scale(sub(want, v), 10), Swarm.cruise);
  }

  /// `d` turned up to 30 degrees toward straight up, the short way round, without passing it.
  static tilted(d: Vec): Vec {
    const angle = Math.atan2(d.y, d.x);
    let delta = Math.PI / 2 - angle;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    const turned = angle + Math.max(-BeeCrew.tilt, Math.min(BeeCrew.tilt, delta));
    return { x: Math.cos(turned), y: Math.sin(turned) };
  }
}
