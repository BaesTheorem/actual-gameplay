// Save the Clawd: draw a shield, then the bees come. Survive the swarm and he is safe.
// This is the whole game with no drawing in it; the browser scene and the Node replay both step it.
import type * as planck from "planck";
import { Clock, type Emit } from "./clock";
import {
  PLAYFIELD, PPM, STEP, SKWorld, angularVelocity, applyImpulseAt, position, setVelocity, speed, tagOf, velocity,
  type ContactEvent, type Outcome, type Vec,
} from "./sk";
import { Bee, BeeSwarm } from "./savedog/bee";
import { BEE_RADIUS, DOG_RADIUS, type CrewBody } from "./savedog/beecrew";
import { FlowField, circle, rect, segment, type Solid } from "./savedog/flowfield";
import {
  contains, distance, distanceToRect, inset, nearestOnPolyline, polylineLength, resample, rotated, slice, sub, type Rect,
} from "./savedog/geometry";
import {
  BLAST_IMPULSE, BLAST_RADIUS, BOMB_DENSITY, BOMB_RADIUS, BURN_SPEED, CRUSH_SPEED, FLAME_BERTH, FLAME_HEIGHT, FLAME_WIDTH,
  ICE_FRICTION, IDENTITY, ROCK_DENSITY, ROCK_RADIUS, THUD_SPEED, applyTransform, isLiquid, stars, strokePoints, surviveSeconds, swarmDelay,
  type Decor, type DogLevel, type Hive, type StrokeSolution, type StrokeTransform,
} from "./savedog/level";
import { Cat, MIN_LENGTH, STUB, Stroke, StrokeCapture, WIDTH, inkCost, prepare } from "./savedog/stroke";

export type { DogLevel } from "./savedog/level";
export { Cat } from "./savedog/stroke";

/// Where strokes may go: the playfield minus the HUD band at the top.
export const DRAW_AREA: Rect = { x: 0, y: 34, w: 402, h: 720 };

/// What a falling stroke can land on. Strokes report these as contacts, for the landing sound only.
const LANDING = Cat.wall | Cat.drawn | Cat.prop | Cat.actor | Cat.killer | Cat.rock;
/// What ink cannot be drawn through.
const SOLID = Cat.wall | Cat.actor | Cat.drawn | Cat.killer | Cat.prop | Cat.rock;
/// What stands between him and a blast.
const COVER = Cat.wall | Cat.drawn;
/// How far apart the points are at which ink is tested against a flame.
const BURN_SAMPLE = 2;
/// Seconds between the sparks a burning end throws.
const EMBER_GAP = 0.12;
/// A bomb's fuse is heard for this long before it goes off.
const FUSE_HISS = 0.7;

export type DogMood = "nervous" | "scared" | "excited" | "ko";

/// The one to protect. Heavy for his size so a landing shield does not launch him; never rolls.
export interface Dog { id: string; body: planck.Body; mood: DogMood; readonly position: Vec }

/// Static ground as the level file gives it, with the skin the renderer paints it in.
export type Terrain =
  | { type: "rect"; rect: Rect; skin: string; solid: boolean }
  | { type: "circle"; center: Vec; radius: number; skin: string; solid: boolean }
  | { type: "chain"; points: Vec[]; halfWidth: number; skin: string; solid: boolean };

export interface Saw { x: number; y: number; r: number; body: planck.Body }
export interface Liquid { rect: Rect; kind: "water" | "lava" }

/// A loose body the level supplies: a boulder to roll into a gap, a crate to drop.
export class Prop {
  body: planck.Body | null = null;
  state: "live" | "sunk" = "live";
  since = 0;
  attached = true;
  private rest: Vec;
  private restAngle = 0;

  constructor(readonly id: string, readonly shape: "ball" | "box", readonly radius: number, readonly size: { w: number; h: number }, at: Vec) {
    this.rest = at;
  }

  get position(): Vec { return this.body ? position(this.body) : this.rest; }
  get angle(): number { return this.body ? this.body.getAngle() : this.restAngle; }

  release(sk: SKWorld, now: number) {
    if (!this.body) return;
    this.rest = position(this.body);
    this.restAngle = this.body.getAngle();
    sk.remove(this.body);
    this.body = null;
    this.state = "sunk";
    this.since = now;
  }

  sinkBy(dy: number) { this.rest = { x: this.rest.x, y: this.rest.y - dy }; }
}

/// A boulder that is held still at its point until its time and then let go. It pushes ink like
/// any heavy body and flattens him if it meets him fast. Bees fly through it.
export class Rock extends Prop {
  held = true;

  /// `releaseAt` is in seconds after the bees are out.
  constructor(id: string, radius: number, at: Vec, readonly releaseAt: number) {
    super(id, "ball", radius, { w: 2 * radius, h: 2 * radius }, at);
  }
}

/// A bomb: a ball that lies where it is put, and can be rolled, until it goes off.
export class Bomb extends Prop {
  /// Its fuse has been heard hissing down its last stretch.
  hissed = false;

  /// `blastAt` is in seconds after the bees are out.
  constructor(id: string, at: Vec, readonly blastAt: number) {
    super(id, "ball", BOMB_RADIUS, { w: 2 * BOMB_RADIUS, h: 2 * BOMB_RADIUS }, at);
  }
}

/// Something brief for the renderer to draw: ink that was refused, the parts of a stroke that
/// were trimmed away, sawdust where a blade took a stroke. `at` is the level time it happened.
export type Effect =
  | { kind: "reject"; at: number; points: Vec[]; reason: string; label: Vec }
  | { kind: "trim"; at: number; points: Vec[] }
  | { kind: "chips"; at: number; point: Vec };

const capitalized = (id: string) => id.charAt(0).toUpperCase() + id.slice(1).toLowerCase();

/// A category the pair helpers can trust: a body that has left the world matches nothing.
const categoryOf = (body: planck.Body): number => {
  const tag = tagOf(body);
  return tag.removed ? 0 : tag.category;
};

const match = (event: ContactEvent, maskA: number, maskB: number): [planck.Body, planck.Body] | null => {
  const ca = categoryOf(event.a), cb = categoryOf(event.b);
  if ((ca & maskA) !== 0 && (cb & maskB) !== 0) return [event.a, event.b];
  if ((cb & maskA) !== 0 && (ca & maskB) !== 0) return [event.b, event.a];
  return null;
};

export class DogSim {
  /// One-sided collisions are on: bees bounce off the dog and the props, and neither is pushed by a bee.
  readonly sk = new SKWorld(-9.8, { oneSided: true });
  readonly clock = new Clock();
  readonly capture: StrokeCapture;
  readonly terrain: Terrain[] = [];
  readonly spikes: Rect[] = [];
  readonly liquids: Liquid[] = [];
  readonly saws: Saw[] = [];
  /// Each flame as the rectangle it stands in.
  readonly flames: Rect[] = [];
  rocks: Rock[] = [];
  bombs: Bomb[] = [];
  readonly decor: Decor[];
  readonly forbidden: Rect[];
  readonly hives: Hive[];
  readonly dogs: Dog[] = [];
  readonly swarm: BeeSwarm;
  readonly field = new FlowField(PLAYFIELD);
  /// Committed ink still in the level, the pieces a saw or a pit took included until their fade ends.
  strokes: Stroke[] = [];
  props: Prop[] = [];
  /// The points of every piece of ink committed so far, as it was drawn.
  committed: Vec[][] = [];
  effects: Effect[] = [];
  outcome: Outcome | null = null;
  /// Nothing moves until the first stroke lands.
  frozen = true;
  elapsed = 0;
  calmFrames = 0;
  /// Level time the bees are due, once a stroke has landed, and the time they came out.
  launchAt: number | null = null;
  launchedAt: number | null = null;
  /// Some bee has a way in to a dog.
  routeOpen = false;

  private fieldCountdown = 0;
  /// How fast each body that can flatten him was going before the last step, and how fast he was.
  private before = new Map<planck.Body, Vec>();
  private emberCountdown = 0;
  private wasShoving = false;
  private nextStroke = 1;
  private touching = false;
  private inkSinceTick = 0;
  private scratchLevel = 0;
  private loops = new Map<string, number>();
  private replayTemplate: { time: number; points: Vec[] }[] = [];
  private pendingReplay: { time: number; points: Vec[] }[] = [];

  constructor(readonly level: DogLevel, private emit: Emit = () => {}) {
    this.capture = new StrokeCapture(DRAW_AREA, level.inkBudget);
    this.decor = level.decor ?? [];
    this.forbidden = (level.forbidden ?? []).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    this.hives = level.hives;
    this.build();
    this.swarm = new BeeSwarm(this.sk, level.hives);
    this.swarm.flames = this.flames;
  }

  get finished() { return this.outcome !== null; }
  get pinnedInk() { return this.level.pinnedInk ?? false; }
  get inkUsed() { return this.capture.inkUsed; }
  get inkLeft() { return this.capture.inkLeft; }
  get inkBudget() { return this.level.inkBudget; }
  /// Ink lines for three and two stars.
  get starLines() { return this.level.stars; }
  get bees(): Bee[] { return this.swarm.bees; }
  /// The stroke under the finger, for the renderer.
  get liveStroke(): Vec[] { return this.capture.isDrawing ? this.capture.points : []; }
  get replaying() { return this.replayTemplate.length > 0; }
  get replayDrained() { return this.pendingReplay.length === 0; }
  /// The bees are out.
  get released() { return this.launchedAt !== null; }
  /// Seconds left to survive, or the full count before the bees are out.
  get timeLeft(): number {
    const total = surviveSeconds(this.level);
    return this.launchedAt === null ? total : Math.max(0, total - (this.elapsed - this.launchedAt));
  }
  /// Seconds since the bees came out, or 0 before they have.
  get beeClock(): number { return this.launchedAt === null ? 0 : this.elapsed - this.launchedAt; }
  /// The share of a timed hazard's wait that is left, from 1 down to 0. `at` is its time on the bees' clock.
  waitLeft(at: number): number { return at <= 0 ? 0 : Math.min(1, Math.max(0, 1 - this.beeClock / at)); }
  /// Where ink is burning right now: the canvas point of every burning end.
  get embers(): Vec[] {
    const out: Vec[] = [];
    for (const stroke of this.strokes) {
      if (!stroke.body || !stroke.alight) continue;
      const { from, to } = stroke.span;
      if (stroke.burning.start) out.push(stroke.worldAt(from));
      if (stroke.burning.end) out.push(stroke.worldAt(to));
    }
    return out;
  }
  /// The saws swap between their two pictures every 0.06 s.
  get sawFrame(): number { return Math.floor(this.elapsed / 0.06) % 2; }
  /// A turn for a renderer that spins one saw picture instead: a quarter turn per picture swap.
  get sawAngle(): number { return -(this.elapsed / 0.06) * (Math.PI / 2); }
  /// How long a replay may take before whoever is running it gives up.
  get replayWait(): number {
    return (this.level.solution?.delay ?? 0) + swarmDelay(this.level) + surviveSeconds(this.level) + 4;
  }

  // MARK: replay

  /// Play a stored solution: each stroke lands at its own time, nudged by `transform`.
  replay(solution: StrokeSolution, transform: StrokeTransform = IDENTITY) {
    let time = solution.delay ?? 0;
    const template: { time: number; points: Vec[] }[] = [];
    for (const stroke of solution.strokes) {
      time += stroke.delay ?? 0;
      template.push({ time, points: applyTransform(transform, strokePoints(stroke)) });
    }
    this.replayTemplate = template;
    this.pendingReplay = [...template];
  }

  /// Play arbitrary strokes, 0.4 s apart. The audit uses this for its naive attempts.
  replayStrokes(strokes: Vec[][]) {
    this.replayTemplate = strokes.map((points, i) => ({ time: 0.3 + 0.4 * i, points }));
    this.pendingReplay = [...this.replayTemplate];
  }

  // MARK: build

  private build() {
    const level = this.level, sk = this.sk;
    // Left wall, ceiling under the HUD, right wall. No floor: falling out is real.
    const f = PLAYFIELD;
    sk.edgeChain({ kind: "bounds", friction: 0.6, restitution: 0.1, category: Cat.wall }, [
      { x: f.x, y: -300 }, { x: f.x, y: f.y + f.h }, { x: f.x + f.w, y: f.y + f.h }, { x: f.x + f.w, y: -300 },
    ]);
    const earth = { kind: "wall", dynamic: false, friction: 0.7, restitution: 0.05, category: Cat.wall };
    for (const item of level.statics ?? []) {
      const solid = item.solid ?? true, skin = item.skin ?? "grass";
      // Ice is ground like any other, except that nothing grips it.
      const ground = skin === "ice" ? { ...earth, surface: ICE_FRICTION } : earth;
      if (item.type === "rect") {
        const r = { x: item.x ?? 0, y: item.y ?? 0, w: item.w ?? 10, h: item.h ?? 10 };
        this.terrain.push({ type: "rect", rect: r, skin, solid });
        if (solid) sk.box(ground, r.w, r.h, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
      } else if (item.type === "circle") {
        const radius = item.r ?? 10, center = { x: item.x ?? 0, y: item.y ?? 0 };
        this.terrain.push({ type: "circle", center, radius, skin, solid });
        if (solid) sk.circle({ ...ground, position: center }, radius);
      } else if (item.type === "chain") {
        const points = (item.points ?? []).map(([x, y]) => ({ x, y }));
        if (points.length < 2) continue;
        this.terrain.push({ type: "chain", points, halfWidth: 3, skin, solid });
        if (solid) sk.edgeChain(ground, points);
      }
    }
    for (const r of level.killers ?? []) {
      const box = { x: r.x, y: r.y, w: r.w, h: r.h };
      const center = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      if (isLiquid(r)) {
        // A pit of water or lava. Strokes fall through it and are gone from the puzzle, so it cannot
        // be footing, and he does not survive touching it. Bees are not fooled: it is not solid to them.
        const kind = r.kind === "lava" ? "lava" : "water";
        this.liquids.push({ rect: box, kind });
        sk.box({ kind, dynamic: false, category: Cat.liquid, collision: 0, contactTest: Cat.actor | Cat.drawn | Cat.prop | Cat.rock }, r.w, r.h, center);
      } else {
        this.spikes.push(box);
        sk.box({ kind: "spikes", dynamic: false, friction: 0.8, category: Cat.killer }, r.w, r.h, center);
      }
    }
    for (const saw of level.saws ?? []) {
      // A blade that spins in place. Strokes that touch it are cut; the dog does not survive it.
      const body = sk.circle({
        kind: "saw", dynamic: false, position: { x: saw.x, y: saw.y }, friction: 0.2, category: Cat.killer,
        contactTest: Cat.drawn | Cat.actor,
      }, saw.r);
      this.saws.push({ x: saw.x, y: saw.y, r: saw.r, body });
    }
    for (const spec of level.props ?? []) {
      const ball = spec.shape === "ball";
      const prop = new Prop(spec.id, ball ? "ball" : "box", spec.r ?? 16, { w: spec.w ?? 32, h: spec.h ?? 32 }, { x: spec.x, y: spec.y });
      const body = {
        kind: "prop", position: { x: spec.x, y: spec.y }, friction: ball ? 0.4 : 0.6, restitution: 0, density: spec.density ?? 2,
        linearDamping: 0.1, angularDamping: 0.2, bullet: true, category: Cat.prop,
        collision: Cat.wall | Cat.drawn | Cat.actor | Cat.prop | Cat.killer | Cat.rock, contactTest: Cat.killer, ref: prop,
      };
      prop.body = ball ? sk.circle(body, prop.radius) : sk.box(body, prop.size.w, prop.size.h);
      this.props.push(prop);
    }
    for (const fire of level.fires ?? []) {
      // A flame has no body: ink falls through it, burning. What it does is worked out from where things are.
      this.flames.push({ x: fire.x - FLAME_WIDTH / 2, y: fire.y, w: FLAME_WIDTH, h: FLAME_HEIGHT });
    }
    (level.rocks ?? []).forEach((spec, i) => {
      // Held still until its time: it is part of the ground until then, and a boulder after.
      const rock = new Rock(`rock${i + 1}`, spec.r ?? ROCK_RADIUS, { x: spec.x, y: spec.y }, spec.at);
      rock.body = sk.circle({
        kind: "rock", dynamic: false, position: { x: spec.x, y: spec.y }, friction: 0.4, restitution: 0, density: ROCK_DENSITY,
        linearDamping: 0.1, angularDamping: 0.2, bullet: true, category: Cat.rock,
        collision: Cat.wall | Cat.drawn | Cat.actor | Cat.prop | Cat.killer | Cat.rock,
        contactTest: Cat.wall | Cat.drawn | Cat.prop | Cat.killer, ref: rock,
      }, rock.radius);
      this.rocks.push(rock);
    });
    (level.bombs ?? []).forEach((spec, i) => {
      const bomb = new Bomb(`bomb${i + 1}`, { x: spec.x, y: spec.y }, spec.at);
      bomb.body = sk.circle({
        kind: "bomb", position: { x: spec.x, y: spec.y }, friction: 0.4, restitution: 0, density: BOMB_DENSITY,
        linearDamping: 0.1, angularDamping: 0.2, bullet: true, category: Cat.prop,
        collision: Cat.wall | Cat.drawn | Cat.actor | Cat.prop | Cat.killer | Cat.rock, contactTest: Cat.killer, ref: bomb,
      }, bomb.radius);
      this.bombs.push(bomb);
    });
    for (const spot of level.dogs) {
      const body = sk.circle({
        kind: "dog", position: { x: spot.x, y: spot.y }, density: 3, friction: 0.9, restitution: 0, linearDamping: 0.3,
        fixedRotation: true, category: Cat.actor,
        collision: Cat.wall | Cat.drawn | Cat.killer | Cat.actor | Cat.prop | Cat.rock,
        contactTest: Cat.bee | Cat.killer | Cat.liquid | Cat.prop | Cat.rock,
      }, DOG_RADIUS);
      const dog: Dog = { id: spot.id, body, mood: "nervous", get position() { return position(body); } };
      tagOf(body).ref = dog;
      this.dogs.push(dog);
    }
  }

  // MARK: input

  /// A finger went down at a canvas point. One stroke at a time.
  begin(point: Vec) {
    if (this.finished || this.touching) return;
    this.touching = true;
    this.capture.begin(point);
    this.inkSinceTick = 0;
    this.scratchLevel = 0;
    if (this.capture.isDrawing) this.loop("scratch", 0);
  }

  extend(point: Vec) {
    if (!this.touching) return;
    const before = this.capture.inkLeft;
    this.capture.move(point);
    this.inkSinceTick += Math.max(0, before - this.capture.inkLeft);
  }

  /// The finger lifted: the stroke is committed, trimmed around whatever it crossed.
  end() {
    if (!this.touching) return;
    this.touching = false;
    this.stopLoop("scratch");
    const raw = this.capture.end();
    if (raw) this.commit(raw);
  }

  cancel() {
    if (!this.touching) return;
    this.touching = false;
    this.stopLoop("scratch");
    this.capture.cancel();
  }

  /// The one path every stroke takes, drawn by a finger or replayed from a level file.
  ///
  /// Parts of the stroke that cross a body or a no-ink zone are cut out rather than refusing the
  /// whole stroke: a shield drawn a hair into the ground still becomes a shield. Bodies that
  /// start overlapping explode, so the pieces also step back a little from whatever they touched.
  commit(raw: Vec[]): boolean {
    if (this.finished || raw.length === 0) return false;
    const points = prepare(raw);
    const requested = inkCost(polylineLength(raw));
    if (!(requested <= this.capture.inkLeft + 0.5)) {
      this.reject(points, "out of ink");
      return false;
    }
    const { pieces, removed, hitForbidden } = this.trim(points);
    if (pieces.length === 0) {
      this.reject(points, hitForbidden ? "no ink here" : "blocked");
      return false;
    }
    if (removed.length > 0) this.effects.push({ kind: "trim", at: this.elapsed, points: removed });
    let cost = 0;
    for (const piece of pieces) {
      const stroke = new Stroke(this.nextStroke++, piece, !this.pinnedInk, this.sk);
      if (!this.pinnedInk && stroke.body) this.sk.remask(stroke.body, { contactTest: Cat.killer | LANDING });
      this.strokes.push(stroke);
      cost += inkCost(polylineLength(piece));
      this.committed.push(piece);
    }
    this.capture.spend(Math.min(cost, requested));
    this.frozen = false;
    this.calmFrames = 0;
    this.emit({ type: "haptic", name: "tap" });
    // Pinned ink never falls, so it lands where it is drawn.
    if (this.pinnedInk) {
      this.emit({ type: "sound", name: "strokeLand" });
      for (const piece of pieces) this.emit({ type: "fx", name: "land", ...piece[Math.floor(piece.length / 2)] });
    }
    if (this.launchAt === null) this.launchAt = this.elapsed + swarmDelay(this.level);
    return true;
  }

  /// Split a stroke into the runs that lie clear of bodies and no-ink zones.
  private trim(points: Vec[]): { pieces: Vec[][]; removed: Vec[]; hitForbidden: boolean } {
    const blocked = (p: Vec): [boolean, boolean] => {
      const forbid = this.forbidden.some((r) => contains(r, p));
      return [forbid || this.overlapsBody(p), forbid];
    };
    if (points.length === 1) {
      const [bad, forbid] = blocked(points[0]);
      return bad ? { pieces: [], removed: points, hitForbidden: forbid } : { pieces: [points], removed: [], hitForbidden: false };
    }
    const samples = resample(points, 3);
    const flags: boolean[] = [];
    let hitForbidden = false;
    for (const sample of samples) {
      const [bad, forbid] = blocked(sample);
      flags.push(bad);
      if (forbid) hitForbidden = true;
    }
    if (!flags.includes(true)) return { pieces: [points], removed: [], hitForbidden: false };
    const widened = [...flags];
    flags.forEach((flag, i) => {
      if (!flag) return;
      for (let j = Math.max(0, i - 2); j <= Math.min(flags.length - 1, i + 2); j++) widened[j] = true;
    });
    const pieces: Vec[][] = [];
    let run: Vec[] = [];
    samples.forEach((sample, i) => {
      if (widened[i]) {
        if (polylineLength(run) >= MIN_LENGTH) pieces.push(prepare(run));
        run = [];
      } else {
        run.push(sample);
      }
    });
    if (polylineLength(run) >= MIN_LENGTH) pieces.push(prepare(run));
    const removed = samples.filter((_, i) => widened[i]);
    return { pieces: pieces.filter((piece) => piece.length > 0), removed, hitForbidden };
  }

  private overlapsBody(point: Vec): boolean {
    return this.sk.bodiesAt(point).some((body) => (tagOf(body).category & SOLID) !== 0);
  }

  private reject(points: Vec[], reason: string) {
    if (points.length === 0) return;
    const first = points[0];
    this.effects.push({
      kind: "reject", at: this.elapsed, points, reason,
      label: { x: Math.min(Math.max(first.x, 40), 362), y: Math.min(first.y + 24, 740) },
    });
    this.emit({ type: "haptic", name: "thud" });
    this.emit({ type: "sound", name: "strokeRejected" });
  }

  // MARK: sound

  private loop(name: string, volume: number) {
    if (this.loops.get(name) === volume) return;
    this.loops.set(name, volume);
    this.emit({ type: "loop", name, on: true, volume });
  }

  private stopLoop(name: string) {
    if (!this.loops.delete(name)) return;
    this.emit({ type: "loop", name, on: false, volume: 0 });
  }

  /// The pen scratch follows the ink: louder the faster it flows, silent while the finger rests or the
  /// pot is dry. About 800 pt of ink a second is full level.
  private updateScratch(dt: number) {
    if (!this.capture.isDrawing || this.finished || dt <= 0) return;
    const flow = Math.sqrt(Math.min(1, this.inkSinceTick / dt / 800));
    this.inkSinceTick = 0;
    this.scratchLevel += (flow - this.scratchLevel) * Math.min(1, dt * 25);
    if (this.loops.has("scratch")) this.loop("scratch", this.scratchLevel);
  }

  /// The buzz grows with the swarm, as the square root of the bees out (a dozen is full), and a
  /// shove that is really pushing on something gets a whoosh as it starts: a crew heave, or the
  /// stuck bees' beat when nothing has a way in.
  private updateSwarmSound() {
    this.loop("buzz", Math.min(1, Math.sqrt(this.swarm.alive / 12)));
    if (this.swarm.shoving && !this.wasShoving && (this.swarm.crew.active || !this.routeOpen)) this.emit({ type: "sound", name: "heave" });
    this.wasShoving = this.swarm.shoving;
  }

  // MARK: simulation

  /// One frame: game logic, the timed changes, the physics step, then the contacts it produced.
  frame(dt = STEP) {
    this.tick(dt);
    this.clock.advance(dt);
    for (const piece of [...this.strokes, ...this.props, ...this.rocks, ...this.bombs]) {
      if (piece.state === "sunk" && piece.attached) piece.sinkBy((14 * dt) / 0.35);
    }
    if (this.frozen) return;
    this.before.clear();
    for (const body of this.heavyBodies()) this.before.set(body, velocity(body));
    const events = this.sk.step(dt);
    if (events.length > 0) this.handle(events);
  }

  /// He, and every body that can flatten him: the props, the bombs and the boulders that have been let go.
  private heavyBodies(): planck.Body[] {
    const out = this.dogs.map((dog) => dog.body);
    for (const piece of [...this.props, ...this.bombs, ...this.rocks]) if (piece.body) out.push(piece.body);
    return out;
  }

  private tick(dt: number) {
    this.elapsed += dt;
    if (this.effects.length > 0) this.effects = this.effects.filter((e) => this.elapsed - e.at < 1.2);
    this.updateScratch(dt);
    while (this.pendingReplay.length > 0 && this.elapsed >= this.pendingReplay[0].time) {
      this.commit(this.pendingReplay.shift()!.points);
    }
    if (this.finished) return;
    if (!this.frozen) {
      let fastest = 0;
      for (const body of this.looseBodies()) fastest = Math.max(fastest, speed(body), Math.abs(angularVelocity(body)) * 20);
      this.calmFrames = fastest < 6 ? this.calmFrames + 1 : 0;
    }
    if (this.saws.length > 0) this.loop("saw", 1);
    // The flames crackle, and louder while ink is burning.
    if (this.flames.length > 0) this.loop("fire", this.strokes.some((stroke) => stroke.alight) ? 1 : 0.45);
    if (this.launchAt !== null && this.launchedAt === null && this.elapsed >= this.launchAt) this.release();
    if (this.launchedAt !== null) {
      const now = this.elapsed - this.launchedAt;
      const targets = this.dogs.map((dog) => dog.position);
      this.fieldCountdown -= dt;
      if (this.fieldCountdown <= 0) {
        this.rebuildField();
        this.fieldCountdown = 0.4;
      }
      this.swarm.update(dt, now, targets, this.field);
      this.updateSwarmSound();
      this.onTheClock(now);
      if (this.finished) return;
      if (now >= surviveSeconds(this.level)) {
        this.win();
        return;
      }
    }
    if (!this.frozen && this.flames.length > 0) {
      this.fire(dt);
      if (this.finished) return;
    }
    for (const dog of this.dogs) {
      if (dog.position.y < -60) {
        this.lose(`${capitalized(dog.id)} fell out of the world.`);
        return;
      }
    }
  }

  /// Every body gravity can move: ink that falls, the props and the dogs. Bees are not counted.
  private looseBodies(): planck.Body[] {
    const out: planck.Body[] = [];
    for (const stroke of this.strokes) if (stroke.body && stroke.dynamic) out.push(stroke.body);
    for (const prop of this.props) if (prop.body) out.push(prop.body);
    for (const bomb of this.bombs) if (bomb.body) out.push(bomb.body);
    for (const rock of this.rocks) if (rock.body && !rock.held) out.push(rock.body);
    for (const dog of this.dogs) out.push(dog.body);
    return out;
  }

  /// Every solid a bee has to get around, in canvas coordinates, wherever it has ended up.
  solids(): Solid[] {
    const out: Solid[] = [];
    for (const item of this.terrain) {
      if (!item.solid) continue;
      if (item.type === "rect") out.push(rect(item.rect));
      else if (item.type === "circle") out.push(circle(item.center, item.radius));
      else for (let i = 1; i < item.points.length; i++) out.push(segment(item.points[i - 1], item.points[i], item.halfWidth));
    }
    for (const r of this.spikes) out.push(rect(r));
    for (const saw of this.saws) out.push(circle({ x: saw.x, y: saw.y }, saw.r));
    // A flame is a wall to a bee, and a little more: the bee keeps a berth from it. Boulders are
    // not here at all, because bees fly through them.
    for (const flame of this.flames) out.push(rect(inset(flame, -FLAME_BERTH, -FLAME_BERTH)));
    for (const bomb of this.bombs) if (bomb.body) out.push(circle(bomb.position, bomb.radius));
    for (const prop of this.props) {
      if (!prop.body) continue;
      if (prop.shape === "ball") {
        out.push(circle(prop.position, prop.radius));
      } else {
        const at = prop.position, hw = prop.size.w / 2, hh = prop.size.h / 2;
        const corners = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }].map((p) => {
          const q = rotated(p, prop.angle);
          return { x: at.x + q.x, y: at.y + q.y };
        });
        for (let i = 0; i < 4; i++) out.push(segment(corners[i], corners[(i + 1) % 4], 1));
      }
    }
    for (const stroke of this.strokes) {
      if (!stroke.body) continue;
      const points = stroke.world;
      if (points.length === 1) out.push(circle(points[0], WIDTH / 2));
      else for (let i = 1; i < points.length; i++) out.push(segment(points[i - 1], points[i], WIDTH / 2));
    }
    return out;
  }

  /// What a crew can see: every loose body it could shift, and every fixed surface a body can
  /// stand on (walls, spikes, pinned ink, the edges of the playfield).
  crewSurvey(): { bodies: CrewBody[]; anchors: Solid[] } {
    const f = PLAYFIELD, top = f.y + f.h, right = f.x + f.w;
    const anchors: Solid[] = [
      segment({ x: f.x, y: -300 }, { x: f.x, y: top }, 0),
      segment({ x: f.x, y: top }, { x: right, y: top }, 0),
      segment({ x: right, y: top }, { x: right, y: -300 }, 0),
    ];
    const bodies: CrewBody[] = [];
    for (const item of this.terrain) {
      if (!item.solid) continue;
      if (item.type === "rect") anchors.push(rect(item.rect));
      else if (item.type === "circle") anchors.push(circle(item.center, item.radius));
      else for (let i = 1; i < item.points.length; i++) anchors.push(segment(item.points[i - 1], item.points[i], item.halfWidth));
    }
    for (const r of this.spikes) anchors.push(rect(r));
    for (const saw of this.saws) anchors.push(circle({ x: saw.x, y: saw.y }, saw.r));
    for (const prop of this.props) {
      if (!prop.body) continue;
      if (prop.shape === "ball") {
        bodies.push({ node: prop, mass: prop.body.getMass(), spine: [{ x: 0, y: 0 }], closed: false, thickness: prop.radius });
      } else {
        const hw = prop.size.w / 2, hh = prop.size.h / 2;
        const corners = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
        bodies.push({ node: prop, mass: prop.body.getMass(), spine: corners, closed: true, thickness: 0 });
      }
    }
    for (const stroke of this.strokes) {
      if (!stroke.body) continue;
      if (stroke.dynamic) {
        bodies.push({ node: stroke, mass: stroke.body.getMass(), spine: stroke.local, closed: false, thickness: WIDTH / 2 });
      } else {
        const points = stroke.world;
        if (points.length === 1) anchors.push(circle(points[0], WIDTH / 2));
        for (let i = 1; i < points.length; i++) anchors.push(segment(points[i - 1], points[i], WIDTH / 2));
      }
    }
    return { bodies, anchors };
  }

  /// The bees' map: everything solid, inflated by a bee, flooded from the dogs. The bees with no
  /// route re-plan their crew work on the same map.
  private rebuildField() {
    const dogs = this.dogs.map((dog) => dog.position);
    this.field.rebuild(this.solids(), dogs.map((center) => ({ center, radius: DOG_RADIUS })), BEE_RADIUS);
    this.routeOpen = this.swarm.bees.some((bee) => this.field.nearbyDirection(bee.position) !== null);
    const { bodies, anchors } = this.crewSurvey();
    this.swarm.survey(bodies, anchors, dogs, this.field);
  }

  private release() {
    this.launchedAt = this.elapsed;
    this.rebuildField();
    this.fieldCountdown = 0.4;
    for (const dog of this.dogs) this.setMood(dog, "scared");
    this.emit({ type: "haptic", name: "slam" });
    // Every bomb's fuse is lit as the bees come out.
    for (const bomb of this.bombs) if (bomb.body) this.emit({ type: "fx", name: "lit", ...bomb.position });
  }

  private setMood(dog: Dog, mood: DogMood) {
    dog.mood = mood;
    this.emit({ type: "mood", who: dog, clip: `clawd_${mood}` });
  }

  private handle(events: ContactEvent[]) {
    if (this.finished) return;
    // A stroke's first touch on anything solid is its landing: one knock per stroke. A saw is not a
    // landing; it cuts the stroke, and that has its own sound.
    let landed = false;
    for (const event of events) {
      for (const [a, b] of [[event.a, event.b], [event.b, event.a]]) {
        if (categoryOf(a) !== Cat.drawn || (categoryOf(b) & LANDING) === 0 || tagOf(b).kind === "saw") continue;
        const stroke = tagOf(a).ref as Stroke;
        if (stroke.landed) continue;
        stroke.landed = true;
        landed = true;
        this.emit({ type: "fx", name: "land", ...(event.point ?? stroke.position) });
      }
    }
    if (landed) this.emit({ type: "sound", name: "strokeLand" });

    let hit: [planck.Body, planck.Body] | null;
    for (const event of events) {
      if ((hit = match(event, Cat.drawn, Cat.killer)) && tagOf(hit[1]).kind === "saw") {
        this.cut(tagOf(hit[0]).ref as Stroke, event.point);
        continue;
      }
      if ((hit = match(event, Cat.drawn | Cat.prop | Cat.rock, Cat.liquid))) {
        this.sink(tagOf(hit[0]).ref as Stroke | Prop, event.point);
        continue;
      }
      if ((hit = match(event, Cat.rock, Cat.wall | Cat.drawn | Cat.prop | Cat.killer))) {
        // A boulder coming down hard is heard and felt. A slow roll onto something is not.
        const fall = this.before.get(hit[0]);
        if (fall && Math.hypot(fall.x, fall.y) >= THUD_SPEED) {
          const at = event.point ?? position(hit[0]);
          this.emit({ type: "sound", name: "boulderLand" });
          this.emit({ type: "haptic", name: "thud" });
          this.emit({ type: "fx", name: "thud", x: at.x, y: at.y });
        }
        continue;
      }
      if ((hit = match(event, Cat.actor, Cat.prop | Cat.rock))) {
        if (!this.crushes(hit[1], hit[0])) continue;
        const dog = tagOf(hit[0]).ref as Dog;
        this.emit({ type: "sound", name: "boulderLand" });
        this.emit({ type: "fx", name: "flattened", ...dog.position });
        this.lose("Flattened.");
        return;
      }
      if ((hit = match(event, Cat.actor, Cat.liquid))) {
        const dog = tagOf(hit[0]).ref as Dog;
        this.emit({ type: "sound", name: "splash" });
        this.emit({ type: "fx", name: "drown", ...dog.position });
        this.lose(tagOf(hit[1]).kind === "lava" ? `${capitalized(dog.id)} went into the lava.` : `${capitalized(dog.id)} went under.`);
        return;
      }
      if ((hit = match(event, Cat.actor, Cat.bee))) {
        const dog = tagOf(hit[0]).ref as Dog;
        this.emit({ type: "sound", name: "caught" });
        this.emit({ type: "fx", name: "sting", ...dog.position });
        this.lose(`The bees got ${dog.id}.`);
        return;
      }
      if ((hit = match(event, Cat.actor, Cat.killer))) {
        const dog = tagOf(hit[0]).ref as Dog;
        this.emit({ type: "sound", name: "caught" });
        this.emit({ type: "fx", name: "hurt", ...dog.position });
        this.lose(tagOf(hit[1]).kind === "saw" ? `${capitalized(dog.id)} met the saw.` : `${capitalized(dog.id)} landed on the spikes.`);
        return;
      }
    }
  }

  /// Whether something heavy met him hard enough to flatten him: 120 points a second or more
  /// between the two, by the speeds they had before the step in which they touched.
  private crushes(heavy: planck.Body, dog: planck.Body): boolean {
    const a = this.before.get(heavy), b = this.before.get(dog);
    return a !== undefined && b !== undefined && Math.hypot(a.x - b.x, a.y - b.y) >= CRUSH_SPEED;
  }

  // MARK: hazards

  /// What happens at a set time on the bees' clock: a boulder is let go, a bomb goes off.
  private onTheClock(now: number) {
    for (const rock of this.rocks) {
      if (!rock.held || !rock.body || now < rock.releaseAt) continue;
      rock.held = false;
      rock.body.setDynamic();
      rock.body.setAwake(true);
      this.emit({ type: "sound", name: "rockLoose" });
      this.emit({ type: "haptic", name: "tap" });
      // The moment is where it leaves its bracket: under it.
      this.emit({ type: "fx", name: "loose", x: rock.position.x, y: rock.position.y - rock.radius });
    }
    for (const bomb of [...this.bombs]) {
      if (!bomb.body) continue;
      if (!bomb.hissed && now >= bomb.blastAt - FUSE_HISS) {
        // The hiss is as long as the last of the fuse, so it runs into the blast.
        bomb.hissed = true;
        this.emit({ type: "sound", name: "fuse" });
        this.emit({ type: "fx", name: "fuse", ...bomb.position });
      }
      if (now >= bomb.blastAt) this.blast(bomb);
      if (this.finished) return;
    }
  }

  /// A bomb goes off. Every loose stroke and every loose prop with a part inside its reach is
  /// thrown straight away from it, harder the nearer that part is. The bees inside its reach
  /// are gone. He does not survive it within its reach unless ink or ground stands on the
  /// straight line between its middle and his. Nothing catches fire.
  private blast(bomb: Bomb) {
    const at = bomb.position;
    bomb.release(this.sk, this.elapsed);
    bomb.attached = false;
    this.bombs = this.bombs.filter((b) => b !== bomb);
    this.emit({ type: "haptic", name: "slam" });
    this.emit({ type: "sound", name: "blast" });
    this.emit({ type: "fx", name: "blast", x: at.x, y: at.y, n: BLAST_RADIUS });
    /// Throw a body by the point of it nearest the bomb, `gap` away.
    const fling = (body: planck.Body, point: Vec, gap: number) => {
      if (gap > BLAST_RADIUS) return;
      const push = BLAST_IMPULSE * (1 - gap / BLAST_RADIUS), away = sub(point, at), far = Math.hypot(away.x, away.y);
      // Something lying right on the bomb goes up.
      const way = far > 0.01 ? { x: away.x / far, y: away.y / far } : { x: 0, y: 1 };
      applyImpulseAt(body, { x: way.x * push, y: way.y * push }, point);
    };
    for (const stroke of this.strokes) {
      if (!stroke.body || !stroke.dynamic) continue;
      const near = nearestOnPolyline(stroke.world, at);
      fling(stroke.body, near.point, near.distance);
    }
    for (const piece of [...this.props, ...this.bombs, ...this.rocks]) {
      if (!piece.body || !piece.body.isDynamic()) continue;
      const centre = piece.position, far = distance(centre, at);
      // A ball is thrown through its middle, by how near its skin is. A crate is close enough to one.
      fling(piece.body, centre, Math.max(0, far - (piece.shape === "ball" ? piece.radius : Math.min(piece.size.w, piece.size.h) / 2)));
    }
    for (const bee of [...this.swarm.bees]) {
      if (distance(bee.position, at) > BLAST_RADIUS) continue;
      this.emit({ type: "fx", name: "beeGone", ...bee.position });
      this.swarm.remove(bee);
    }
    this.fieldCountdown = 0;
    for (const dog of this.dogs) {
      if (distance(dog.position, at) > BLAST_RADIUS || this.sk.rayCast(at, dog.position, COVER)) continue;
      this.emit({ type: "fx", name: "blasted", ...dog.position });
      this.lose("Too close to the blast.");
      return;
    }
  }

  /// One frame of the flames. He does not survive touching one, a bee that is pushed into one
  /// is gone, and ink that touches one catches there: that part is gone at once, and the burn
  /// runs along what is left in both directions. Burning ink lights nothing else.
  private fire(dt: number) {
    for (const dog of this.dogs) {
      if (!this.flames.some((flame) => distanceToRect(dog.position, flame) <= DOG_RADIUS)) continue;
      this.emit({ type: "sound", name: "sizzle" });
      this.emit({ type: "fx", name: "burned", ...dog.position });
      this.lose(`${capitalized(dog.id)} got burned.`);
      return;
    }
    for (const bee of [...this.swarm.bees]) {
      const at = bee.position;
      if (!this.flames.some((flame) => distanceToRect(at, flame) <= BEE_RADIUS)) continue;
      this.emit({ type: "sound", name: "sizzle" });
      this.emit({ type: "haptic", name: "tap" });
      this.emit({ type: "fx", name: "singe", x: at.x, y: at.y });
      this.swarm.remove(bee);
    }
    // The ends already burning lose their ink first, then whatever touches a flame now catches.
    const burnt = BURN_SPEED * dt;
    this.emberCountdown -= dt;
    const spark = this.emberCountdown <= 0;
    if (spark) this.emberCountdown = EMBER_GAP;
    for (const stroke of [...this.strokes]) {
      if (!stroke.body || !stroke.alight) continue;
      const { from, to } = stroke.span;
      this.keepInk(stroke, from + (stroke.burning.start ? burnt : 0), to - (stroke.burning.end ? burnt : 0));
      if (!stroke.body || !spark) continue;
      const left = stroke.span;
      if (stroke.burning.start) this.emit({ type: "fx", name: "ember", ...stroke.worldAt(left.from) });
      if (stroke.burning.end) this.emit({ type: "fx", name: "ember", ...stroke.worldAt(left.to) });
    }
    for (const stroke of [...this.strokes]) if (stroke.body) this.catchFire(stroke);
  }

  /// Cut a stroke down to the ink between two distances along it, or take it out of the level
  /// when what is left is too short to be anything.
  private keepInk(stroke: Stroke, from: number, to: number) {
    if (to - from >= STUB) {
      stroke.keep(this.sk, from, to);
      return;
    }
    const at = stroke.worldAt((stroke.span.from + stroke.span.to) / 2);
    stroke.release(this.sk, "burnt", this.elapsed);
    this.detach(stroke);
    this.emit({ type: "haptic", name: "tap" });
    this.emit({ type: "fx", name: "ash", x: at.x, y: at.y });
    this.fieldCountdown = 0;
  }

  /// Light a stroke wherever it touches a flame. A touch at an end sets that end burning. A
  /// touch in the middle makes two pieces of it, each burning at the end the flame made.
  private catchFire(stroke: Stroke) {
    const { from, to } = stroke.span, lit: [number, number][] = [];
    if (stroke.local.length === 1) {
      if (this.flames.some((flame) => distanceToRect(stroke.position, flame) <= WIDTH / 2)) lit.push([from, to]);
    } else {
      // Walk the ink a little at a time and gather the runs of it that reach a flame.
      let run: [number, number] | null = null;
      for (let along = from; ; along = Math.min(to, along + BURN_SAMPLE)) {
        const point = stroke.worldAt(along);
        if (this.flames.some((flame) => distanceToRect(point, flame) <= WIDTH / 2)) {
          if (run) run[1] = along;
          else run = [along, along];
        } else if (run) {
          lit.push(run);
          run = null;
        }
        if (along >= to) break;
      }
      if (run) lit.push(run);
    }
    if (lit.length === 0) return;
    const middle = stroke.worldAt((lit[0][0] + lit[0][1]) / 2);
    // An end that is already burning and falls further into the flame is the same fire, not a new one.
    let fresh = false;
    // From the far end back, so the distances of the runs not yet handled stay true.
    for (const [a, b] of lit.reverse()) {
      if (!stroke.body) break;
      const span = stroke.span, low = a - BURN_SAMPLE / 2, high = b + BURN_SAMPLE / 2;
      const atStart = low <= span.from + STUB, atEnd = high >= span.to - STUB;
      if (atStart && atEnd) {
        fresh = true;
        this.keepInk(stroke, 0, 0);
      } else if (atStart) {
        fresh ||= !stroke.burning.start;
        stroke.burning.start = true;
        this.keepInk(stroke, high, span.to);
      } else if (atEnd) {
        fresh ||= !stroke.burning.end;
        stroke.burning.end = true;
        this.keepInk(stroke, span.from, low);
      } else {
        fresh = true;
        this.split(stroke, low, high);
      }
    }
    if (!fresh) return;
    this.emit({ type: "sound", name: "burn" });
    this.emit({ type: "haptic", name: "tap" });
    this.emit({ type: "fx", name: "catch", x: middle.x, y: middle.y });
    this.fieldCountdown = 0;
  }

  /// Burn a hole in the middle of a stroke: the ink before `low` stays this stroke, and the ink
  /// after `high` becomes a new piece that moves as this one was moving. Both burn at the hole.
  private split(stroke: Stroke, low: number, high: number) {
    const body = stroke.body!, span = stroke.span;
    if (span.to - high >= STUB) {
      // The far piece keeps the corners the stroke was drawn with.
      const piece = new Stroke(this.nextStroke++, slice(stroke.world, high - span.from, span.to - span.from), stroke.dynamic, this.sk);
      if (piece.body) {
        if (stroke.dynamic) {
          this.sk.remask(piece.body, { contactTest: Cat.killer | LANDING });
          // It goes on as that part of the stroke was going: the same turn, and the speed of that point.
          const at = piece.position, v = body.getLinearVelocityFromWorldPoint({ x: at.x / PPM, y: at.y / PPM });
          setVelocity(piece.body, { x: v.x * PPM, y: v.y * PPM });
          piece.body.setAngularVelocity(angularVelocity(body));
        }
        piece.landed = true;
        piece.burning.start = true;
        piece.burning.end = stroke.burning.end;
        this.strokes.push(piece);
      }
    }
    stroke.burning.end = true;
    this.keepInk(stroke, span.from, low);
  }

  /// Ink or a prop went into a pit. It sinks out of the puzzle: no footing, no plug, gone.
  private sink(piece: Stroke | Prop, point: Vec | undefined) {
    if (!piece.attached || !piece.body) return;
    const at = point ?? piece.position;
    if (piece instanceof Stroke) piece.release(this.sk, "sunk", this.elapsed);
    else piece.release(this.sk, this.elapsed);
    this.emit({ type: "sound", name: "splash" });
    this.emit({ type: "fx", name: "sink", x: at.x, y: at.y });
    this.clock.after(0.35, () => this.detach(piece));
  }

  /// A saw took a stroke. It goes in a puff of sawdust and the map is rebuilt at once.
  private cut(stroke: Stroke, point: Vec | undefined) {
    if (!stroke.attached) return;
    const at = point ?? stroke.position;
    stroke.release(this.sk, "cut", this.elapsed);
    this.clock.after(0.2, () => this.detach(stroke));
    this.effects.push({ kind: "chips", at: this.elapsed, point: at });
    this.emit({ type: "puff", x: at.x, y: at.y });
    this.emit({ type: "haptic", name: "thud" });
    this.emit({ type: "sound", name: "strokeCut" });
    this.emit({ type: "fx", name: "cut", x: at.x, y: at.y });
    this.fieldCountdown = 0;
  }

  /// The fade is over: the piece is out of the level.
  private detach(piece: Stroke | Prop) {
    piece.attached = false;
    if (piece instanceof Stroke) this.strokes = this.strokes.filter((s) => s !== piece);
    else if (piece instanceof Rock) this.rocks = this.rocks.filter((r) => r !== piece);
    else if (piece instanceof Bomb) this.bombs = this.bombs.filter((b) => b !== piece);
    else this.props = this.props.filter((p) => p !== piece);
  }

  private stopAllLoops() {
    for (const name of [...this.loops.keys()]) this.stopLoop(name);
  }

  private win() {
    const ink = this.inkUsed;
    for (const dog of this.dogs) this.setMood(dog, "excited");
    this.emit({ type: "haptic", name: "success" });
    this.emit({ type: "sound", name: "win" });
    // The survive timer ran out with everyone still here.
    if (this.dogs.length > 0) this.emit({ type: "fx", name: "win", ...this.dogs[0].position });
    this.outcome = { won: true, stars: stars(this.level, ink), coins: 0, score: ink };
    this.stopAllLoops();
  }

  private lose(reason: string) {
    if (this.finished) return;
    for (const dog of this.dogs) this.setMood(dog, "ko");
    this.emit({ type: "haptic", name: "failure" });
    this.emit({ type: "sound", name: "lose" });
    this.outcome = { won: false, reason };
    this.stopAllLoops();
  }

  // MARK: HUD

  /// The line under the title in the HUD.
  get readout(): string {
    let text = `ink ${Math.round(this.inkLeft)}`;
    if (this.launchedAt !== null) {
      text += `   ${this.timeLeft.toFixed(1)}s   ${this.swarm.alive} bees`;
      if (this.swarm.shoving) text += this.swarm.crew.active ? "   heave!" : "   shove!";
      else if (this.routeOpen) text += "   way in!";
    } else if (this.launchAt !== null) {
      text += `   bees in ${Math.max(0, this.launchAt - this.elapsed).toFixed(1)}`;
    } else {
      text += "   draw a shield";
    }
    return text;
  }

  /// The HUD bar: ink left before the bees are out, then the share of the wait that is over.
  get progress(): number {
    if (this.launchedAt !== null) return Math.min(1, (this.elapsed - this.launchedAt) / surviveSeconds(this.level));
    return this.inkLeft / Math.max(1, this.level.inkBudget);
  }
}

/// What to draw in a headless run: the stored solution (nudged or not), or strokes of the caller's own.
export type Attempt = { transform?: StrokeTransform } | { strokes: Vec[][] };

/// Step a level until it ends or its replay runs out of time. The replay suite and the audit both use this.
export const playOut = (level: DogLevel, attempt: Attempt = {}): { outcome: Outcome | null; seconds: number; ink: number } => {
  const sim = new DogSim(level);
  if ("strokes" in attempt) sim.replayStrokes(attempt.strokes);
  else if (level.solution) sim.replay(level.solution, attempt.transform ?? IDENTITY);
  const frames = Math.ceil((sim.replayWait + 2) / STEP);
  for (let i = 0; i < frames && !sim.finished; i++) sim.frame();
  return { outcome: sim.outcome, seconds: sim.elapsed, ink: sim.inkUsed };
};
