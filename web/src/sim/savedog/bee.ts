// The swarm: bees leave the hives on a schedule and are steered every frame.
import type * as planck from "planck";
import { SKWorld, applyImpulse, clampSpeed, position, setVelocity, speed, velocity, type Vec } from "../sk";
import { BEE_RADIUS, BeeCrew, Swarm, type CrewBody } from "./beecrew";
import type { FlowField, Solid } from "./flowfield";
import { add, distance, dot, minBy, normalized, perpendicular, scale, sub, type Rect } from "./geometry";
import { FLAME_BERTH, type Hive } from "./level";
import { Cat } from "./stroke";

/// The generator the hives draw their jitter from (SplitMix64). The same seed gives the same swarm.
export class SeededRNG {
  private state: bigint;

  constructor(seed: number | bigint) { this.state = BigInt.asUintN(64, BigInt(seed)); }

  next(): bigint {
    this.state = BigInt.asUintN(64, this.state + 0x9e3779b97f4a7c15n);
    let z = this.state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    return z ^ (z >> 31n);
  }

  /// Uniform in [0, 1).
  unit(): number { return Number(this.next() >> 11n) / 2 ** 53; }
}

/// What a bee is doing this frame: following a way in, working with the crew, or leaning on the shield alone.
export type BeeMode = "route" | "crew" | "press";

/// One bee: a small fast body that hunts the nearest dog.
export class Bee {
  /// 1 facing right, -1 facing left.
  facing = 1;
  mode: BeeMode = "route";

  constructor(readonly body: planck.Body, readonly phase: number, readonly bornAt: number) {}

  get position(): Vec { return position(this.body); }
  get velocity(): Vec { return velocity(this.body); }
  /// The direction it is flying, in radians, or its facing when it is still.
  get heading(): number {
    const v = this.velocity;
    return Math.hypot(v.x, v.y) > 1 ? Math.atan2(v.y, v.x) : this.facing > 0 ? 0 : Math.PI;
  }
}

/// Spawns bees from the level's hives on schedule and steers the live ones every frame.
///
/// With a route to the dog (the flow field), a bee follows it, which takes it around walls and
/// through any gap it fits through. With no route, it joins the crew (`BeeCrew`): the stuck bees
/// pick the weakest loose part of the shield they can reach, spread along it, and heave on it
/// together. A stuck bee the crew has no place for yet presses on whatever is between it and the
/// dog, crawls sideways along the surface looking for a way in, and shoves on the old beat.
/// Steering is a force, not a set velocity, so contacts resolve properly and a heave is a real
/// push the shield's mass and footing have to answer.
export class BeeSwarm {
  readonly crew = new BeeCrew();
  bees: Bee[] = [];
  spawned = 0;
  shoving = false;
  /// The flames of the level. A bee does not fly into one.
  flames: Rect[] = [];
  readonly total: number;
  private schedule: { time: number; at: Vec }[];
  private rng = new SeededRNG(99);

  constructor(private sk: SKWorld, hives: Hive[]) {
    const plan: { time: number; at: Vec }[] = [];
    for (const hive of hives) {
      const interval = hive.interval ?? 0.12;
      for (let i = 0; i < hive.count; i++) plan.push({ time: (hive.delay ?? 0) + i * interval, at: { x: hive.x, y: hive.y } });
    }
    this.schedule = plan.map((entry, order) => ({ entry, order }))
      .sort((a, b) => a.entry.time - b.entry.time || a.order - b.order).map((item) => item.entry);
    this.total = plan.length;
  }

  get alive(): number { return this.bees.length; }

  /// A bee is gone: a fire or a blast took it.
  remove(bee: Bee) {
    this.sk.remove(bee.body);
    this.bees = this.bees.filter((other) => other !== bee);
  }

  /// A bee keeps clear of a flame it has come up to: whatever part of its speed points into the
  /// flame is taken away, so by its own flying it slides along the flame and never into it.
  /// Only something that pushes it can put it in.
  private shy(body: planck.Body) {
    const at = position(body);
    for (const flame of this.flames) {
      const near = { x: Math.min(Math.max(at.x, flame.x), flame.x + flame.w), y: Math.min(Math.max(at.y, flame.y), flame.y + flame.h) };
      const gap = distance(at, near);
      if (gap === 0 || gap >= BEE_RADIUS + FLAME_BERTH) continue;
      const out = scale(sub(at, near), 1 / gap), v = velocity(body), into = dot(v, out);
      if (into < 0) setVelocity(body, sub(v, scale(out, into)));
    }
  }

  /// With every flow field rebuild: who is stuck outside, and what they could shift.
  survey(bodies: CrewBody[], anchors: Solid[], dogs: Vec[], field: FlowField) {
    const stuck = this.bees.filter((bee) => field.nearbyDirection(bee.position) === null);
    this.crew.plan(bodies, anchors, dogs, stuck, field);
  }

  private spawn(at: Vec, now: number) {
    const jitter = { x: (this.rng.unit() - 0.5) * 28, y: (this.rng.unit() - 0.5) * 16 };
    const phase = this.rng.unit() * 6.28;
    // Damping near zero: the speed clamp below is the terminal velocity. It flies, so gravity is off
    // and the steering push is the whole story.
    const body = this.sk.circle({
      kind: "bee", position: add(at, jitter), density: 0.6, friction: 0.1, restitution: 0.2, linearDamping: 0.05,
      gravityScale: 0, fixedRotation: true, bullet: true, category: Cat.bee,
      collision: Cat.wall | Cat.drawn | Cat.actor | Cat.killer | Cat.prop,
      contactTest: Cat.actor,
    }, BEE_RADIUS);
    this.bees.push(new Bee(body, phase, now));
    this.spawned += 1;
  }

  /// `now` is seconds since the swarm was released.
  update(dt: number, now: number, targets: Vec[], field: FlowField | null) {
    while (this.schedule.length > 0 && now >= this.schedule[0].time) {
      this.spawn(this.schedule.shift()!.at, now);
    }
    if (targets.length === 0) return;
    this.crew.tick(now, this.bees);
    // The old beat is for stuck bees without a place; with a crew out, the heave is the shove.
    const beat = now > 2 && now % Swarm.shovePeriod < Swarm.shoveLength;
    this.shoving = this.crew.active ? this.crew.phase === "heave" : beat;
    for (const bee of this.bees) {
      const body = bee.body;
      const at = bee.position;
      const route = field ? field.nearbyDirection(at) : null;
      const orders = route === null ? this.crew.steer(bee, bee.velocity, field) : null;
      if (orders) {
        // As an impulse per frame, the same mass times acceleration times dt as below.
        bee.mode = "crew";
        applyImpulse(body, scale(orders, body.getMass() * dt));
      } else {
        const target = minBy(targets, (t) => distance(t, at))!;
        const direct = normalized(sub(target, at));
        const pace = speed(body);
        const age = now - bee.bornAt;
        let desired: Vec;
        let strength = Swarm.cruise;
        if (route) {
          // A way in exists: follow it, with a little pull straight at the dog so the path
          // does not read as a grid walk.
          bee.mode = "route";
          desired = normalized(add(scale(route, 0.85), scale(direct, 0.15)));
          if (pace < 25 && age > 0.6) strength = Swarm.press * 1.5;   // nudged off a corner
        } else {
          // No way in and no place in the crew yet. Lean on the structure, probe along it,
          // shove on the beat.
          bee.mode = "press";
          const probe = scale(perpendicular(direct), Math.sin(now * 2.2 + bee.phase) * 0.7);
          desired = normalized(add(direct, probe));
          const pressing = pace < 25 && age > 0.6;
          strength = pressing ? (beat ? Swarm.shove : Swarm.press) : Swarm.cruise;
        }
        const wobble = scale(perpendicular(desired), Math.sin(now * 7 + bee.phase) * 0.25);
        // As an impulse per frame: strength is an acceleration in pt/s^2, so this is mass times it times dt.
        applyImpulse(body, scale(normalized(add(desired, wobble)), strength * body.getMass() * dt));
      }
      clampSpeed(body, Swarm.topSpeed);
      if (this.flames.length > 0) this.shy(body);
      const vx = bee.velocity.x;
      if (Math.abs(vx) > 10) bee.facing = vx < 0 ? -1 : 1;
    }
  }
}
