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
  /// 0 for a body that flies. SpriteKit's affectedByGravity = false.
  gravityScale?: number;
  ref?: unknown;
}

export interface ContactEvent {
  a: planck.Body;
  b: planck.Body;
  /// Where the two first touched, in canvas points, when the engine has a contact point for the pair.
  point?: Vec;
}

export const tagOf = (body: planck.Body): Tag => body.getUserData() as Tag;

const responds = (a: Tag, b: Tag) => (a.collision & b.category) !== 0 || (b.collision & a.category) !== 0;
const reports = (a: Tag, b: Tag) => (a.contactTest & b.category) !== 0 || (b.contactTest & a.category) !== 0;

/// Worlds that asked for SpriteKit's one-sided collisions.
const oneSidedWorlds = new WeakSet<planck.World>();
let oneSidedInstalled = false;

interface ContactMasses { v_invMassA: number; v_invMassB: number; v_invIA: number; v_invIB: number; p_invMassA: number; p_invMassB: number; p_invIA: number; p_invIB: number }

/// SpriteKit lets each body choose what moves it: a body whose collision mask leaves the other out
/// is not pushed by it, while the other still bounces off. The solver has no such notion, so for
/// those pairs the body that takes no part is solved as if it could not be moved. This wraps the
/// engine's own contact set-up once, and only touches contacts in worlds that opted in.
const installOneSided = () => {
  if (oneSidedInstalled) return;
  oneSidedInstalled = true;
  const proto = planck.Contact.prototype;
  const init = proto.initConstraint;
  proto.initConstraint = function (this: planck.Contact, step) {
    init.call(this, step);
    const a = this.getFixtureA().getBody(), b = this.getFixtureB().getBody();
    if (!oneSidedWorlds.has(a.getWorld())) return;
    const ta = tagOf(a), tb = tagOf(b);
    const masses = this as unknown as ContactMasses;
    if ((ta.collision & tb.category) === 0) masses.v_invMassA = masses.v_invIA = masses.p_invMassA = masses.p_invIA = 0;
    if ((tb.collision & ta.category) === 0) masses.v_invMassB = masses.v_invIB = masses.p_invMassB = masses.p_invIB = 0;
  };
};

export class SKWorld {
  readonly world: planck.World;
  private events: ContactEvent[] = [];
  private seen = new Set<string>();
  private ids = new WeakMap<planck.Body, number>();
  private nextId = 1;
  private doomed: planck.Body[] = [];

  /// `oneSided` turns on SpriteKit's rule that a body is only pushed by what its own collision mask lists.
  constructor(gravityY: number, options: { oneSided?: boolean } = {}) {
    // No sleeping. A liquid here is a pile of slow circles, and a body that sleeps the moment it
    // slows stops a spread short: Mind the hole depends on lava creeping the last few points to the hero.
    this.world = new planck.World({ gravity: planck.Vec2(0, gravityY), allowSleep: false });
    if (options.oneSided) {
      installOneSided();
      oneSidedWorlds.add(this.world);
    }
    this.world.on("begin-contact", (contact) => {
      const a = contact.getFixtureA().getBody(), b = contact.getFixtureB().getBody();
      const ta = tagOf(a), tb = tagOf(b);
      if (ta.removed || tb.removed || !reports(ta, tb)) return;
      const ia = this.ids.get(a)!, ib = this.ids.get(b)!;
      const key = ia < ib ? ia + ":" + ib : ib + ":" + ia;
      if (this.seen.has(key)) return;
      this.seen.add(key);
      const manifold = contact.getManifold().pointCount > 0 ? contact.getWorldManifold(null) : undefined;
      const at = manifold?.points[0];
      this.events.push(at ? { a, b, point: { x: at.x * PPM, y: at.y * PPM } } : { a, b });
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
      gravityScale: spec.gravityScale ?? 1,
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

  /// Every live body with a solid shape under a canvas point (SpriteKit's enumerateBodies(at:)).
  /// Edge chains have no inside, so they never match.
  bodiesAt(point: Vec): planck.Body[] {
    const p = planck.Vec2(point.x / PPM, point.y / PPM);
    const found: planck.Body[] = [];
    this.world.queryAABB(new planck.AABB(p, p), (fixture) => {
      const body = fixture.getBody();
      if (!tagOf(body).removed && !found.includes(body) && fixture.testPoint(p)) found.push(body);
      return true;
    });
    return found;
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

  /// The first live body a straight line meets on its way from one canvas point to another, among
  /// the bodies whose category is in `mask`, and the point where it meets it. A shape that holds
  /// the starting point is not found.
  rayCast(from: Vec, to: Vec, mask: number): { body: planck.Body; point: Vec } | null {
    let found: { body: planck.Body; point: Vec } | null = null;
    this.world.rayCast(planck.Vec2(from.x / PPM, from.y / PPM), planck.Vec2(to.x / PPM, to.y / PPM), (fixture, point, _normal, fraction) => {
      const body = fixture.getBody(), tag = tagOf(body);
      // -1 passes over a fixture. A fraction cuts the line short there, so only nearer ones follow.
      if (tag.removed || (tag.category & mask) === 0) return -1;
      found = { body, point: { x: point.x * PPM, y: point.y * PPM } };
      return fraction;
    });
    return found;
  }

  /// Every live body whose shape touches this one's, as of the last step. Only pairs that collide
  /// or report are tracked, so a body the masks leave out is never found.
  touching(body: planck.Body): planck.Body[] {
    const found: planck.Body[] = [];
    for (let edge = body.getContactList(); edge; edge = edge.next) {
      const other = edge.other;
      if (other && edge.contact.isTouching() && !tagOf(other).removed && !found.includes(other)) found.push(other);
    }
    return found;
  }

  /// Every live body that can move and has a shape overlapping a canvas rectangle. The engine
  /// gives a rectangle a skin a point and a half thick, so a shape that near it counts as overlapping.
  movingIn(rect: { x: number; y: number; w: number; h: number }): planck.Body[] {
    const lower = planck.Vec2(rect.x / PPM, rect.y / PPM), upper = planck.Vec2((rect.x + rect.w) / PPM, (rect.y + rect.h) / PPM);
    const box = new planck.Box(rect.w / 2 / PPM, rect.h / 2 / PPM, planck.Vec2((rect.x + rect.w / 2) / PPM, (rect.y + rect.h / 2) / PPM), 0);
    const here = planck.Transform.identity();
    const found: planck.Body[] = [];
    this.world.queryAABB(new planck.AABB(lower, upper), (fixture) => {
      const body = fixture.getBody();
      if (body.isDynamic() && !tagOf(body).removed && !found.includes(body)
        && planck.testOverlap(box, 0, fixture.getShape(), 0, here, body.getTransform())) found.push(body);
      return true;
    });
    return found;
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

/// Set a body's mass outright, as SpriteKit's `mass` setter does: the density the shapes imply is
/// scaled, so the centre of mass stays put and the rotational inertia scales with the mass.
export const setMass = (body: planck.Body, mass: number) => {
  const data = { mass: 0, center: planck.Vec2(0, 0), I: 0 };
  body.getMassData(data);
  if (data.mass <= 0) return;
  body.setMassData({ mass, center: data.center, I: (data.I * mass) / data.mass });
};

/// An impulse through the centre of mass. `impulse` is mass times points per second, the scale
/// the scenes wrote their forces in, so an acceleration in pt/s^2 times `body.getMass()` times dt works.
export const applyImpulse = (body: planck.Body, impulse: Vec) => {
  body.applyLinearImpulse(planck.Vec2(impulse.x / PPM, impulse.y / PPM), body.getWorldCenter(), true);
};

/// Radians per second, counterclockwise positive.
export const angularVelocity = (body: planck.Body): number => body.getAngularVelocity();

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
