// A thin layer over planck.js that keeps the conventions the levels were
// authored against: canvas points, y up, and SpriteKit's three bit masks per
// body (category, collision, contact test). Nothing in here touches the DOM,
// so the same code runs in the browser and in the Node replay suite.
import * as planck from "planck";

export type Vec = { x: number; y: number };

/// SpriteKit's gravity of 9.8 lands at about 1470 pt/s^2, so one of its metres is 150 points.
export const PPM = 150;
/// The scenes ran at 60 frames a second with one physics step per frame.
export const STEP = 1 / 60;
export const CANVAS = { w: 402, h: 874 };
/// Canvas minus the top band and the bottom band.
export const PLAYFIELD = { x: 0, y: 34, w: 402, h: 874 - 34 - 60 };

export const ALL = 0xffffffff;

export interface Tag {
  /// What the game calls this body: "hero", "water", ...
  kind: string;
  category: number;
  collision: number;
  contactTest: number;
  /// Anything the owning simulation wants to find again from a contact.
  ref?: unknown;
  removed?: boolean;
}

export interface BodySpec {
  kind: string;
  dynamic?: boolean;
  position?: Vec;
  angle?: number;
  category: number;
  collision?: number;
  contactTest?: number;
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
  density?: number;
  fixedRotation?: boolean;
  bullet?: boolean;
  ref?: unknown;
}

export interface ContactEvent {
  a: planck.Body;
  b: planck.Body;
}

export const tagOf = (body: planck.Body): Tag => body.getUserData() as Tag;

const responds = (a: Tag, b: Tag) => (a.collision & b.category) !== 0 || (b.collision & a.category) !== 0;
const reports = (a: Tag, b: Tag) => (a.contactTest & b.category) !== 0 || (b.contactTest & a.category) !== 0;

export class SKWorld {
  readonly world: planck.World;
  private events: ContactEvent[] = [];
  private seen = new Set<string>();
  private ids = new WeakMap<planck.Body, number>();
  private nextId = 1;
  private doomed: planck.Body[] = [];

  constructor(gravityY: number) {
    // No sleeping. A liquid here is a pile of slow circles, and a body that sleeps the moment it
    // slows stops a spread short: level 06 depends on lava creeping the last few points to the hero.
    this.world = new planck.World({ gravity: planck.Vec2(0, gravityY), allowSleep: false });
    this.world.on("begin-contact", (contact) => {
      const a = contact.getFixtureA().getBody(), b = contact.getFixtureB().getBody();
      const ta = tagOf(a), tb = tagOf(b);
      if (ta.removed || tb.removed || !reports(ta, tb)) return;
      const ia = this.ids.get(a)!, ib = this.ids.get(b)!;
      const key = ia < ib ? ia + ":" + ib : ib + ":" + ia;
      if (this.seen.has(key)) return;
      this.seen.add(key);
      this.events.push({ a, b });
    });
    // A pair that only reports (a drain, a goal) must not push anything.
    this.world.on("pre-solve", (contact) => {
      const ta = tagOf(contact.getFixtureA().getBody()), tb = tagOf(contact.getFixtureB().getBody());
      if (ta.removed || tb.removed || !responds(ta, tb)) contact.setEnabled(false);
    });
  }

  body(spec: BodySpec): planck.Body {
    const body = this.world.createBody({
      type: spec.dynamic === false ? "static" : "dynamic",
      position: spec.position ? planck.Vec2(spec.position.x / PPM, spec.position.y / PPM) : planck.Vec2(0, 0),
      angle: spec.angle ?? 0,
      linearDamping: spec.linearDamping ?? 0.1,
      angularDamping: spec.angularDamping ?? 0.1,
      fixedRotation: spec.fixedRotation ?? false,
      bullet: spec.bullet ?? false,
    });
    const tag: Tag = {
      kind: spec.kind,
      category: spec.category,
      collision: spec.collision ?? ALL,
      contactTest: spec.contactTest ?? 0,
      ref: spec.ref,
    };
    body.setUserData(tag);
    this.ids.set(body, this.nextId++);
    return body;
  }

  /// Fixture defaults follow SpriteKit's body defaults: friction 0.2, restitution 0.2, density 1.
  private fixture(body: planck.Body, shape: planck.Shape, spec: BodySpec) {
    const fixture = body.createFixture({
      shape,
      friction: spec.friction ?? 0.2,
      restitution: spec.restitution ?? 0.2,
      density: spec.density ?? 1,
    });
    // The pair rule is SpriteKit's, not Box2D's: two bodies meet when either one lists the other.
    fixture.shouldCollide = (that: planck.Fixture) => {
      const ta = tagOf(body), tb = tagOf(that.getBody());
      if (ta.removed || tb.removed) return false;
      return responds(ta, tb) || reports(ta, tb);
    };
    return fixture;
  }

  circle(spec: BodySpec, radius: number): planck.Body {
    const body = this.body(spec);
    this.fixture(body, new planck.Circle(radius / PPM), spec);
    return body;
  }

  /// A box centred on `center` in the body's own frame.
  box(spec: BodySpec, w: number, h: number, center: Vec = { x: 0, y: 0 }): planck.Body {
    const body = this.body(spec);
    this.fixture(body, new planck.Box(w / 2 / PPM, h / 2 / PPM, planck.Vec2(center.x / PPM, center.y / PPM), 0), spec);
    return body;
  }

  polygon(spec: BodySpec, points: Vec[]): planck.Body {
    const body = this.body(spec);
    this.addPolygon(body, points, spec);
    return body;
  }

  addPolygon(body: planck.Body, points: Vec[], spec: BodySpec) {
    this.fixture(body, new planck.Polygon(points.map((p) => planck.Vec2(p.x / PPM, p.y / PPM))), spec);
  }

  addCircle(body: planck.Body, radius: number, center: Vec, spec: BodySpec) {
    this.fixture(body, new planck.Circle(planck.Vec2(center.x / PPM, center.y / PPM), radius / PPM), spec);
  }

  /// A closed loop of zero-thickness edges (SpriteKit's edge loop).
  edgeLoop(spec: BodySpec, points: Vec[]): planck.Body {
    const body = this.body({ ...spec, dynamic: false });
    this.fixture(body, new planck.Chain(points.map((p) => planck.Vec2(p.x / PPM, p.y / PPM)), true), spec);
    return body;
  }

  /// An open chain of edges.
  edgeChain(spec: BodySpec, points: Vec[]): planck.Body {
    const body = this.body({ ...spec, dynamic: false });
    this.fixture(body, new planck.Chain(points.map((p) => planck.Vec2(p.x / PPM, p.y / PPM)), false), spec);
    return body;
  }

  /// Take a body out of the world. Safe at any time: the body stops colliding at once and is
  /// destroyed after the step that is running.
  remove(body: planck.Body) {
    const tag = tagOf(body);
    if (tag.removed) return;
    tag.removed = true;
    this.doomed.push(body);
  }

  /// Rewrite a body's masks; the change applies to contacts it already has.
  remask(body: planck.Body, masks: Partial<Pick<Tag, "category" | "collision" | "contactTest">>) {
    Object.assign(tagOf(body), masks);
    for (let f = body.getFixtureList(); f; f = f.getNext()) f.refilter();
  }

  /// One physics step, then the contacts that began in it, one per pair of bodies.
  step(dt = STEP): ContactEvent[] {
    this.flush();
    this.world.step(dt, 8, 3);
    const events = this.events;
    this.events = [];
    this.seen.clear();
    return events;
  }

  flush() {
    if (this.doomed.length === 0) return;
    for (const body of this.doomed) this.world.destroyBody(body);
    this.doomed = [];
  }
}

export const position = (body: planck.Body): Vec => {
  const p = body.getPosition();
  return { x: p.x * PPM, y: p.y * PPM };
};

export const setPosition = (body: planck.Body, p: Vec, angle = body.getAngle()) => {
  body.setTransform(planck.Vec2(p.x / PPM, p.y / PPM), angle);
};

export const velocity = (body: planck.Body): Vec => {
  const v = body.getLinearVelocity();
  return { x: v.x * PPM, y: v.y * PPM };
};

export const setVelocity = (body: planck.Body, v: Vec) => {
  body.setLinearVelocity(planck.Vec2(v.x / PPM, v.y / PPM));
};

/// Linear speed in points per second.
export const speed = (body: planck.Body): number => {
  const v = body.getLinearVelocity();
  return Math.hypot(v.x, v.y) * PPM;
};

export const clampSpeed = (body: planck.Body, max: number) => {
  const s = speed(body);
  if (s <= max) return;
  const v = body.getLinearVelocity();
  body.setLinearVelocity(planck.Vec2((v.x * max) / s, (v.y * max) / s));
};

/// Both bodies ordered to match the given category masks, or null if the pair does not match.
export const pair = (event: ContactEvent, maskA: number, maskB: number): [planck.Body, planck.Body] | null => {
  const ca = tagOf(event.a).category, cb = tagOf(event.b).category;
  if ((ca & maskA) !== 0 && (cb & maskB) !== 0) return [event.a, event.b];
  if ((cb & maskA) !== 0 && (ca & maskB) !== 0) return [event.b, event.a];
  return null;
};

/// The outcome every mode reports, once per attempt.
export type Outcome =
  | { won: true; stars: number; coins: number; score: number }
  | { won: false; reason: string };
