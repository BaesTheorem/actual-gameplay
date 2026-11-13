// Pull the Pin: chambers of water, lava and goblins held up on pins. Pull order is the puzzle.
// This is the whole game with no drawing in it; the browser scene and the Node replay both step it.
import type * as planck from "planck";
import { Clock, type Emit } from "./clock";
import {
  PLAYFIELD, STEP, SKWorld, applyImpulse, clampSpeed, pair, position, setPosition, setVelocity, speed, tagOf, velocity,
  type ContactEvent, type Outcome, type Vec,
} from "./sk";
import {
  BLAST_KICK, BLAST_RADIUS, BOMB_FUSE, BOMB_SIZE, BOULDER_RADIUS, CRUSH_SPEED, Cat, DOOR_SECONDS, FOE_WALK, FRAME_THICKNESS,
  FRIEND_RADIUS, HERO_RADIUS, HERO_WALK, KNOB_OFFSET, LIQUID_RADIUS, PIN_THICKNESS, PLATE_HEIGHT, segmentQuad, stars,
  type DoorSpec, type PinLevel, type PinSpec, type PlateSpec, type Rect,
} from "./pinpull/level";
import { ROUTE_EVERY, findRoute, floorUnder, inCorridor } from "./pinpull/route";

export * from "./pinpull/level";
export * from "./pinpull/route";

const LIQUID_MAX_SPEED = 700;

/// The rules a level asks for with `"rules": 2`: characters walk, and the level can carry
/// boulders, bombs, cracked walls, linked pins, plates, doors, gas, vents and a friend.
const WALKING_RULES = 2;
/// Whether a level plays by the walking rules. This is the one place the flag is read.
export const walks = (level: PinLevel): boolean => level.rules === WALKING_RULES;

/// A level that did not ask for the walking rules, with every field those rules added taken out
/// of it, so it plays exactly as it did before they existed.
const firstRules = (level: PinLevel): PinLevel => ({
  ...level,
  pins: level.pins.map(({ group: _, ...pin }) => pin),
  pools: level.pools?.map((pool) => (pool.liquid === "gas" ? { ...pool, liquid: "water" } : pool)),
  actors: { ...level.actors, friend: undefined },
  cracked: undefined, boulders: undefined, bombs: undefined, plates: undefined, doors: undefined, vents: undefined,
});

// A boulder is heavy and rolls. The damping is what stops it on a flat floor: with none it would
// roll for twenty seconds and the world would never be calm.
const BOULDER_DENSITY = 4, BOULDER_FRICTION = 0.6, BOULDER_LINEAR_DAMPING = 0.2, BOULDER_ANGULAR_DAMPING = 2.5;
/// A boulder that loses half its speed in one frame, from this speed or more, has landed hard.
const BOULDER_THUD = 150;
/// How deep the band along the top of the playfield is, where gas is taken out of the level.
const SKY = 16;
/// A body is in a doorway when it reaches this far into the door's own rectangle. The engine's
/// overlap test has a skin of a point and a half, and something resting against the frame beside
/// the doorway is not in it.
const DOORWAY_INSET = 2;

export class Pin {
  pulled = false;
  gone = false;
  readonly direction: number;
  readonly angle: number;
  readonly home: Vec;
  /// How far along its slide the pin is, 0 to 1.
  slide = 0;
  body!: planck.Body;

  constructor(readonly spec: PinSpec) {
    this.direction = spec.side === "left" ? -1 : 1;
    this.angle = ((spec.angle ?? 0) * Math.PI) / 180;
    this.home = { x: spec.x + spec.w / 2, y: spec.y + PIN_THICKNESS / 2 };
  }

  get id() { return this.spec.id; }
  /// The group this pin is pulled with, if it has one.
  get group() { return this.spec.group; }

  /// Where the knob sits while the pin is in place: off the end of the bar, outside the chamber wall.
  get knob(): Vec {
    const reach = this.direction * (this.spec.w / 2 + KNOB_OFFSET);
    return { x: this.home.x + reach * Math.cos(this.angle), y: this.home.y + reach * Math.sin(this.angle) };
  }

  /// Where the bar's centre is now.
  get center(): Vec {
    // Ease in: slow off the mark, fastest as it clears the wall.
    const travel = this.direction * (this.spec.w + 60) * this.slide * this.slide;
    return { x: this.home.x + travel * Math.cos(this.angle), y: this.home.y + travel * Math.sin(this.angle) };
  }

  /// Whether a tap at this canvas point lands on the pin: the bar with slack, or the knob.
  /// Tested in the pin's own frame, so a tilted pin takes taps along its length.
  hits(point: Vec): boolean {
    const dx = point.x - this.home.x, dy = point.y - this.home.y;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    const x = dx * c + dy * s, y = -dx * s + dy * c;
    const hw = this.spec.w / 2;
    if (Math.abs(x) <= hw && Math.abs(y) <= PIN_THICKNESS / 2 + 14) return true;
    const kx = this.direction * (hw + KNOB_OFFSET);
    return Math.abs(x - kx) <= 22 && Math.abs(y) <= 22;
  }
}

/// A goblin. `walking` and `facing` are for whoever draws him: whether he is on his way to
/// someone, and which way (1 is toward the right of the canvas).
export interface Foe {
  body: planck.Body; active: boolean; gone: boolean; state: "idle" | "ko" | "sink"; since: number;
  walking: boolean; facing: number;
}
export interface Particle { body: planck.Body; kind: "water" | "lava" | "gas"; lastSpeed: number }
export interface Boulder { body: planck.Body; radius: number; lastSpeed: number }
/// A crate of powder. `since` is when it took its present state: lit, soaked or gone off.
export interface Bomb { body: planck.Body; state: "dry" | "lit" | "wet" | "gone"; since: number }
export interface Cracked { rect: Rect; body: planck.Body; gone: boolean }
export interface Plate { spec: PlateSpec; body: planck.Body; pressed: boolean }
/// A sliding wall. `open` runs from 0, shut, to 1, slid clear by its own length.
export interface Door { spec: DoorSpec; body: planck.Body; plates: Plate[]; open: number; latched: boolean; closing: boolean }

/// Where a door is now.
export const doorRect = (door: Door): Rect => {
  const { spec, open } = door;
  const dx = spec.slide === "left" ? -spec.w : spec.slide === "right" ? spec.w : 0;
  const dy = spec.slide === "down" ? -spec.h : spec.slide === "up" ? spec.h : 0;
  return { x: spec.x + dx * open, y: spec.y + dy * open, w: spec.w, h: spec.h };
};

const middle = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
/// How far a point is from the nearest point of a rectangle. 0 inside it.
const gap = (p: Vec, r: Rect) => Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.w), Math.max(r.y - p.y, 0, p.y - r.y - r.h));

export class PinSim {
  readonly sk = new SKWorld(-6);
  readonly clock = new Clock();
  /// The level as it is played: the file itself under the walking rules, and otherwise the file
  /// with everything those rules added left out.
  readonly level: PinLevel;
  readonly pins: Pin[] = [];
  readonly pulled: string[] = [];
  particles: Particle[] = [];
  hero: planck.Body | null = null;
  heroState: "idle" | "ko" | "excited" = "idle";
  heroStateSince = 0;
  /// Whether the hero is on his way somewhere, and which way he faces: 1 is toward the right of the canvas.
  heroWalking = false;
  heroFacing = 1;
  treasure: planck.Body | null = null;
  treasureMelting = -1;
  foes: Foe[] = [];
  friend: planck.Body | null = null;
  friendState: "idle" | "happy" | "ko" = "idle";
  friendStateSince = 0;
  boulders: Boulder[] = [];
  bombs: Bomb[] = [];
  cracked: Cracked[] = [];
  plates: Plate[] = [];
  doors: Door[] = [];
  outcome: Outcome | null = null;
  dying = false;
  winLatchedAt: number | null = null;
  elapsed = 0;

  /// True under the walking rules. The constructor sets it and tick() reads it, and nothing else in here asks.
  private readonly walkingRules: boolean;
  private latched = new Set<string>();
  private calmFrames = 0;
  private lastPullTime = -10;
  private replayArmed = false;
  private replayQueue: string[] = [];
  private steamBudget = 0;
  private splashArmed = false;
  private lastSizzle = -10;
  private ticks = 0;
  /// Which way each walker's route runs, -1, 0 or 1, as of the last look.
  private heading = new Map<planck.Body, number>();
  /// The velocity each boulder and each character had before the step that is running.
  private before = new Map<planck.Body, Vec>();
  private doorsMoved = false;

  constructor(level: PinLevel, private emit: Emit = () => {}) {
    this.walkingRules = walks(level);
    this.level = this.walkingRules ? level : firstRules(level);
    this.build();
  }

  get finished() { return this.outcome !== null; }
  /// Pulls left to make. A group of pins is one pull.
  get remaining() {
    const groups = new Set<string>();
    let single = 0;
    for (const pin of this.pins) {
      if (pin.pulled) continue;
      if (pin.group === undefined) single += 1; else groups.add(pin.group);
    }
    return single + groups.size;
  }

  /// Pull these pins in order as the world allows.
  replay(pins: string[]) {
    this.replayArmed = true;
    this.replayQueue = [...pins];
  }

  // MARK: build

  private wallSpec = { kind: "wall", dynamic: false, friction: 0.4, restitution: 0, category: Cat.wall };

  private build() {
    const level = this.level, sk = this.sk;
    const f = PLAYFIELD;
    sk.edgeLoop({ ...this.wallSpec, kind: "bounds" }, [
      { x: f.x, y: f.y }, { x: f.x + f.w, y: f.y }, { x: f.x + f.w, y: f.y + f.h }, { x: f.x, y: f.y + f.h },
    ]);
    for (const wall of this.walls()) {
      sk.box(this.wallSpec, wall.w, wall.h, { x: wall.x + wall.w / 2, y: wall.y + wall.h / 2 });
    }
    for (const slab of level.slabs ?? []) {
      sk.polygon(this.wallSpec, segmentQuad({ x: slab.x1, y: slab.y1 }, { x: slab.x2, y: slab.y2 }, (slab.t ?? FRAME_THICKNESS) / 2));
    }
    // Cracked walls and doors are stone to everything that meets them: the same category as a wall.
    for (const rect of level.cracked ?? []) {
      this.cracked.push({ rect, gone: false, body: sk.box({ ...this.wallSpec, kind: "cracked" }, rect.w, rect.h, middle(rect)) });
    }
    const sensor = (kind: string, category: number, contactTest: number, r: Rect) =>
      sk.box({ kind, dynamic: false, category, collision: 0, contactTest }, r.w, r.h, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
    for (const drain of level.drains ?? []) sensor("drain", Cat.drain, Cat.liquid | Cat.treasure, drain);
    for (const grate of level.grates ?? []) sensor("grate", Cat.grate, Cat.liquid, grate);
    if (level.actors.goal) sensor("goal", Cat.goal, Cat.hero | Cat.treasure, level.actors.goal);
    for (const vent of level.vents ?? []) sensor("vent", Cat.vent, Cat.gas, vent);
    // Gas that rises to the top of the playfield has left the level: the top edge takes it as a vent would.
    if ((level.pools ?? []).some((pool) => pool.liquid === "gas")) {
      sensor("vent", Cat.vent, Cat.gas, { x: f.x, y: f.y + f.h - SKY, w: f.w, h: SKY });
    }
    // A plate is a strip just over its floor. Solid things that touch it press it; liquids do not.
    for (const spec of level.plates ?? []) {
      const body = sensor("plate", Cat.plate, Cat.boulder | Cat.bomb | Cat.treasure | Cat.hero | Cat.foe | Cat.friend,
        { x: spec.x, y: spec.y, w: spec.w, h: PLATE_HEIGHT });
      this.plates.push({ spec, body, pressed: false });
    }
    for (const spec of level.doors ?? []) {
      // The body is placed by its position, as a pin's is, so it can be slid.
      const body = sk.box({ ...this.wallSpec, kind: "door", position: middle(spec) }, spec.w, spec.h);
      this.doors.push({ spec, body, plates: this.plates.filter((plate) => plate.spec.opens.includes(spec.id)), open: 0, latched: false, closing: false });
    }

    for (const spec of level.pins) {
      const pin = new Pin(spec);
      pin.body = sk.box(
        { kind: "pin", dynamic: false, friction: 0.3, restitution: 0, category: Cat.pin, position: pin.home, angle: pin.angle, ref: pin },
        spec.w, PIN_THICKNESS,
      );
      this.pins.push(pin);
    }
    for (const pool of level.pools ?? []) this.spawn(pool, pool.count, pool.liquid === "lava" ? "lava" : pool.liquid === "gas" ? "gas" : "water");

    const solid = Cat.wall | Cat.pin | Cat.water | Cat.lava;
    if (level.actors.hero) {
      // Friction high enough that arriving liquid does not shove him along a pin; slabs he must
      // slide down are cut steep enough to beat the mixed friction with the wall's 0.4.
      this.hero = sk.circle({
        kind: "hero", position: level.actors.hero, friction: 0.8, restitution: 0.05, linearDamping: 0.2,
        fixedRotation: true, bullet: true, category: Cat.hero,
        collision: solid | Cat.treasure | Cat.foe,
        contactTest: Cat.goal | Cat.treasure | Cat.lava | Cat.foe,
      }, HERO_RADIUS);
    }
    if (level.actors.treasure) {
      this.treasure = sk.box({
        kind: "treasure", position: level.actors.treasure, friction: 0.6, restitution: 0.05, linearDamping: 0.1,
        bullet: true, category: Cat.treasure,
        collision: solid | Cat.hero | Cat.treasure | Cat.foe,
        contactTest: Cat.goal | Cat.hero | Cat.drain | Cat.lava,
      }, 26, 22);
    }
    for (const spot of level.actors.foes ?? []) {
      const foe: Foe = { body: null as unknown as planck.Body, active: true, gone: false, state: "idle", since: 0, walking: false, facing: 1 };
      foe.body = sk.circle({
        kind: "foe", position: spot, friction: 0.8, restitution: 0.05, linearDamping: 0.2,
        fixedRotation: true, bullet: true, category: Cat.foe,
        collision: solid | Cat.hero | Cat.treasure | Cat.foe,
        contactTest: Cat.liquid | Cat.hero | Cat.drain, ref: foe,
      }, HERO_RADIUS);
      this.foes.push(foe);
    }

    // The newer pieces name the older ones in their own masks, and a pair meets when either side
    // lists the other. So nothing above had to change for them.
    const bodies = Cat.hero | Cat.treasure | Cat.foe | Cat.friend | Cat.boulder | Cat.bomb;
    if (level.actors.friend) {
      this.friend = sk.circle({
        kind: "friend", position: level.actors.friend, friction: 0.8, restitution: 0.05, linearDamping: 0.2,
        fixedRotation: true, bullet: true, category: Cat.friend,
        collision: solid | bodies,
        contactTest: Cat.lava | Cat.gas | Cat.hero | Cat.foe | Cat.boulder,
      }, FRIEND_RADIUS);
    }
    for (const spec of level.boulders ?? []) {
      const boulder: Boulder = { body: null as unknown as planck.Body, radius: spec.r ?? BOULDER_RADIUS, lastSpeed: 0 };
      boulder.body = sk.circle({
        kind: "boulder", position: spec, density: BOULDER_DENSITY, friction: BOULDER_FRICTION, restitution: 0.05,
        linearDamping: BOULDER_LINEAR_DAMPING, angularDamping: BOULDER_ANGULAR_DAMPING, category: Cat.boulder,
        collision: solid | bodies | Cat.gas,
        contactTest: Cat.hero | Cat.foe | Cat.friend, ref: boulder,
      }, boulder.radius);
      this.boulders.push(boulder);
    }
    for (const spot of level.bombs ?? []) {
      const bomb: Bomb = { body: null as unknown as planck.Body, state: "dry", since: 0 };
      bomb.body = sk.box({
        kind: "bomb", position: spot, density: 1, friction: 0.6, restitution: 0.05, category: Cat.bomb,
        collision: solid | bodies | Cat.gas,
        contactTest: Cat.liquid, ref: bomb,
      }, BOMB_SIZE, BOMB_SIZE);
      this.bombs.push(bomb);
    }
  }

  /// Every wall rectangle, the standard frame included.
  walls(): Rect[] {
    const t = FRAME_THICKNESS;
    const frame = this.level.frame ?? true
      ? [{ x: 24, y: 54, w: t, h: 660 }, { x: 364, y: 54, w: t, h: 660 }, { x: 24, y: 54, w: 354, h: t }]
      : [];
    return [...frame, ...(this.level.walls ?? [])];
  }

  /// Fill a rectangle with particles in offset rows. Water and lava stand on the bottom of the
  /// rectangle and are stacked upward. Gas hangs from the top of it and is stacked downward.
  private spawn(rect: Rect, count: number, kind: Particle["kind"]) {
    const r = LIQUID_RADIUS, dx = 2 * r * 0.95, dy = dx * 0.866;
    const gas = kind === "gas";
    let y = gas ? rect.y + rect.h - r : rect.y + r, row = 0, made = 0;
    while (made < count) {
      let x = rect.x + r + (row % 2 === 1 ? dx / 2 : 0);
      let placed = false;
      while (x + r <= rect.x + rect.w && made < count) {
        this.addParticle(kind, { x, y });
        made += 1;
        placed = true;
        x += dx;
      }
      if (!placed) break;
      y += gas ? -dy : dy;
      row += 1;
    }
  }

  private addParticle(kind: Particle["kind"], at: Vec) {
    const body = kind === "gas"
      // Gas falls upward. It is stopped by stone, pins, boulders and crates and by itself, and
      // goes through liquids, characters and the gem.
      ? this.sk.circle({
        kind, position: at, friction: 0.05, restitution: 0, linearDamping: 0.2, angularDamping: 0,
        fixedRotation: true, density: 1, gravityScale: -1, category: Cat.gas,
        collision: Cat.wall | Cat.pin | Cat.gas | Cat.boulder | Cat.bomb,
        contactTest: Cat.hero | Cat.foe | Cat.friend | Cat.vent,
      }, LIQUID_RADIUS)
      : this.sk.circle({
        kind, position: at, friction: 0.05, restitution: 0, linearDamping: 0.2, angularDamping: 0,
        fixedRotation: true, density: 1, category: kind === "water" ? Cat.water : Cat.lava,
        collision: Cat.wall | Cat.pin | Cat.water | Cat.lava | Cat.hero | Cat.treasure,
        contactTest: kind === "water" ? Cat.lava | Cat.drain : Cat.water | Cat.hero | Cat.drain,
      }, LIQUID_RADIUS);
    this.particles.push({ body, kind, lastSpeed: 0 });
  }

  // MARK: input

  pinAt(point: Vec): Pin | null {
    return this.pins.find((p) => !p.pulled && p.hits(point)) ?? null;
  }

  /// Pull a pin, and with it every pin of its group. A group is one pull, recorded under the pin that was named.
  pull(id: string): boolean {
    const pin = this.pins.find((p) => p.id === id);
    if (this.finished || this.dying || !pin || pin.pulled) return false;
    const together = pin.group === undefined ? [pin] : this.pins.filter((p) => p.group === pin.group);
    for (const each of together) each.pulled = true;
    this.pulled.push(id);
    this.lastPullTime = this.elapsed;
    this.calmFrames = 0;
    this.emit({ type: "haptic", name: "thud" });
    this.emit({ type: "sound", name: "pinPull" });
    for (const each of together) this.emit({ type: "fx", name: "pin", ...each.knob });
    this.splashArmed = true;
    return true;
  }

  // MARK: simulation

  /// One frame: game logic, the moving parts, the physics step, then the contacts it produced.
  frame(dt = STEP) {
    this.tick(dt);
    this.clock.advance(dt);
    for (const pin of this.pins) {
      if (!pin.pulled || pin.gone) continue;
      pin.slide = Math.min(1, pin.slide + dt / 0.25);
      if (pin.slide >= 1) {
        pin.gone = true;
        this.sk.remove(pin.body);
      } else {
        setPosition(pin.body, pin.center);
      }
    }
    // What a boulder does to someone depends on how fast the two met, and the step is about to change that.
    if (this.boulders.length > 0) {
      this.before.clear();
      for (const body of [this.hero, this.friend, ...this.foes.map((f) => f.body), ...this.boulders.map((b) => b.body)]) {
        if (body && !tagOf(body).removed) this.before.set(body, velocity(body));
      }
    }
    const events = this.sk.step(dt);
    if (events.length > 0) this.handle(events);
  }

  private tick(dt: number) {
    this.elapsed += dt;
    this.steamBudget = 6;
    let fastest = 0, landings = 0, landedX = 0, landedY = 0;
    for (const p of this.particles) {
      const s = speed(p.body);
      // 200 pt/s is a fall of about 20 pt; losing most of it in one step is an impact.
      if (p.kind === "water" && p.lastSpeed > 200 && s < p.lastSpeed * 0.4) {
        const at = position(p.body);
        landings += 1;
        landedX += at.x;
        landedY += at.y;
      }
      p.lastSpeed = s;
      if (s > LIQUID_MAX_SPEED) clampSpeed(p.body, LIQUID_MAX_SPEED);
      fastest = Math.max(fastest, Math.min(s, LIQUID_MAX_SPEED));
    }
    // A few particles, not one stray drop.
    if (this.splashArmed && landings >= 3) {
      this.splashArmed = false;
      this.emit({ type: "sound", name: "splash" });
      this.emit({ type: "fx", name: "splash", x: landedX / landings, y: landedY / landings });
    }
    this.machinery(dt);
    // A goblin still falling is as unsettled as the hero: he may be about to land on him.
    // So is a friend, a boulder or a crate.
    const movers = [
      this.hero, this.treasure, this.friend, ...this.foes.filter((f) => f.active).map((f) => f.body),
      ...this.boulders.map((b) => b.body), ...this.bombs.filter((b) => b.state !== "gone").map((b) => b.body),
    ];
    for (const body of movers) if (body && !tagOf(body).removed) fastest = Math.max(fastest, speed(body));
    // A fuse that is burning and a door that is sliding are about to change the world, however still it is.
    const pending = this.doorsMoved || this.bombs.some((b) => b.state === "lit");
    // 6 pt/s: a settled pile reads below it, a treasure creeping down a slab reads above it.
    this.calmFrames = fastest < 6 && !pending ? this.calmFrames + 1 : 0;

    if (this.walkingRules) this.walk();
    this.ticks += 1;
    if (this.finished || this.dying) return;
    // The goal is met, but lava may still be on its way. The win lands when the world has
    // settled, or after a few seconds if it never quite does. Lava that arrives first still
    // ends him. This comes before any replayed pull so a settled win is not undone by the next tap.
    if (this.winLatchedAt !== null) {
      if (this.calmFrames >= 30 || this.elapsed - this.winLatchedAt > 4) this.win();
      return;
    }
    if (this.replayArmed && this.replayQueue.length > 0) {
      const since = this.elapsed - this.lastPullTime;
      const ready = this.pulled.length === 0 ? this.elapsed >= 0.8 : since >= 1.0 && (this.calmFrames >= 30 || since >= 8.0);
      if (ready) this.pull(this.replayQueue.shift()!);
    }
    const settled = this.calmFrames >= 45 && this.elapsed - this.lastPullTime > 1.5;
    if (this.pins.length > 0 && this.pins.every((p) => p.pulled) && settled) {
      this.lose("Nothing left to pull.");
      return;
    }
    // A replay has no more moves; once the world stops, its outcome is known.
    if (this.replayArmed && this.replayQueue.length === 0 && settled && this.elapsed > 3) {
      this.lose("Settled short of the goal.");
    }
  }

  /// The parts that move by rule and not by physics: plates read what rests on them, doors
  /// slide, and a boulder that has just landed is heard. A level with none of them has nothing to do here.
  private machinery(dt: number) {
    // A fuse is counted in game time from the frame it was lit. The slack is for the arithmetic:
    // forty-two sixtieths of a second do not quite add up to 0.7.
    for (const bomb of this.bombs) if (bomb.state === "lit" && this.elapsed - bomb.since >= BOMB_FUSE - 1e-6) this.blast(bomb);
    for (const plate of this.plates) {
      const pressed = this.sk.touching(plate.body).length > 0;
      if (pressed === plate.pressed) continue;
      plate.pressed = pressed;
      this.emit({ type: "sound", name: "plate" });
      this.emit({ type: "fx", name: pressed ? "plateDown" : "plateUp", x: plate.spec.x + plate.spec.w / 2, y: plate.spec.y });
    }
    this.doorsMoved = false;
    for (const door of this.doors) {
      const held = door.plates.some((plate) => plate.pressed);
      if (held && door.spec.latch) door.latched = true;
      const was = door.open;
      // Fifteen frames each way. The last step lands on the end exactly, whatever the sum came to.
      if (held || door.latched) {
        door.closing = false;
        door.open += dt / DOOR_SECONDS;
        if (door.open > 1 - 1e-6) door.open = 1;
      } else if (door.open > 0) {
        // It will not start to shut on something standing in its doorway. Once it has started, it finishes.
        if (!door.closing && this.sk.movingIn(inset(door.spec, DOORWAY_INSET)).length === 0) door.closing = true;
        if (door.closing) door.open -= dt / DOOR_SECONDS;
        if (door.open < 1e-6) { door.open = 0; door.closing = false; }
      }
      if (door.open === was) continue;
      this.doorsMoved = true;
      setPosition(door.body, middle(doorRect(door)));
      // One sound per slide, as it starts.
      if (was === 0 || was === 1) this.emit({ type: "sound", name: "door" });
    }
    for (const boulder of this.boulders) {
      const s = speed(boulder.body);
      if (boulder.lastSpeed >= BOULDER_THUD && s < boulder.lastSpeed * 0.5) {
        const at = position(boulder.body);
        this.emit({ type: "haptic", name: "thud" });
        this.emit({ type: "sound", name: "boulderLand" });
        this.emit({ type: "fx", name: "thud", x: at.x, y: at.y - boulder.radius });
      }
      boulder.lastSpeed = s;
    }
  }

  // MARK: walking

  /// Characters walk. Every sixth frame each one looks for a route to what it wants, and on every
  /// frame one that has a route and stands on something is given its walking speed along the
  /// floor. One with no route is left alone, so physics moves it as it always did.
  private walk() {
    const live = !this.finished && !this.dying, look = this.ticks % ROUTE_EVERY === 0;
    if (this.hero) {
      if (!live) this.heading.set(this.hero, 0);
      else if (look) this.heading.set(this.hero, this.heroRoute(this.hero));
      const dir = this.heading.get(this.hero) ?? 0;
      this.stride(this.hero, dir, HERO_WALK, this.heroWalking);
      this.heroWalking = dir !== 0;
      if (dir !== 0) this.heroFacing = dir;
    }
    for (const foe of this.foes) {
      // A goblin that has been knocked out stops where he is, with his grip back.
      if (!live || !foe.active) this.heading.set(foe.body, 0);
      else if (look) this.heading.set(foe.body, this.foeRoute(foe));
      const dir = this.heading.get(foe.body) ?? 0;
      if (!tagOf(foe.body).removed) this.stride(foe.body, dir, FOE_WALK, foe.walking);
      foe.walking = dir !== 0;
      if (dir !== 0) foe.facing = dir;
    }
  }

  /// One frame of a walk. `dir` is the way the walker's route runs, or 0 for none, and `was`
  /// says whether it was walking a frame ago.
  ///
  /// A walker is given its speed along the floor on every frame it stands on something, and in
  /// the air it is left to fall. While it walks it has no grip: its contacts are solved without
  /// friction, so the floor does not hold it back, and a kerb or a slope the probe allowed turns
  /// its push into a climb where friction would pin it in place. The grip comes back the moment
  /// it stops, and that is what stops it.
  private stride(body: planck.Body, dir: number, pace: number, was: boolean) {
    if (dir === 0 && !was) return;
    for (let edge = body.getContactList(); edge; edge = edge.next) {
      if (dir === 0) edge.contact.resetFriction(); else edge.contact.setFriction(0);
    }
    if (dir === 0) return;
    const at = position(body);
    if (!was) this.emit({ type: "fx", name: "walk", x: at.x, y: at.y - HERO_RADIUS });
    if (floorUnder(this.sk, at, HERO_RADIUS) === null) return;
    setVelocity(body, { x: dir * pace, y: velocity(body).y });
  }

  /// What the hero is after now, as a rectangle: the gem, the exit or the friend, by the level's
  /// goal. Null once he has it, and in a level where the gem does the travelling.
  private heroWants(): Rect | null {
    const point = (body: planck.Body | null): Rect | null => (body && !tagOf(body).removed ? { ...position(body), w: 0, h: 0 } : null);
    const gem = this.latched.has("treasureHero") ? null : point(this.treasure);
    const exit = this.latched.has("heroGoal") ? null : this.level.actors.goal ?? null;
    switch (this.level.winWhen) {
      case "heroReachesGoal": return exit;
      case "both": return gem ?? (this.latched.has("treasureHero") ? exit : null);
      case "heroReachesFriend": return this.latched.has("heroFriend") ? null : point(this.friend);
      case "treasureReachesGoal": return null;
      default: return gem;
    }
  }

  /// Which way the hero should walk, or 0. He is careful: a route with lava or gas on it, a lit
  /// bomb, or a goblin still on his feet is no route to him. Water does not stop him.
  private heroRoute(hero: planck.Body): number {
    const wants = this.heroWants();
    const route = wants && findRoute(this.sk, position(hero), HERO_RADIUS, wants);
    if (!route || route.dir === 0) return 0;
    for (const p of this.particles) if (p.kind !== "water" && inCorridor(route, position(p.body), LIQUID_RADIUS)) return 0;
    for (const bomb of this.bombs) if (bomb.state === "lit" && inCorridor(route, position(bomb.body), BOMB_SIZE / 2)) return 0;
    for (const foe of this.foes) if (foe.active && inCorridor(route, position(foe.body), HERO_RADIUS)) return 0;
    return route.dir;
  }

  /// Which way a goblin should walk, or 0. He wants the hero or the friend, whichever he has a
  /// route to, and the nearer of the two if he has both. He is not careful about anything.
  private foeRoute(foe: Foe): number {
    const at = position(foe.body);
    let best = 0, nearest = Infinity;
    for (const prey of [this.hero, this.friend]) {
      if (!prey || tagOf(prey).removed) continue;
      const there = position(prey), route = findRoute(this.sk, at, HERO_RADIUS, { ...there, w: 0, h: 0 });
      if (!route || Math.abs(there.x - at.x) >= nearest) continue;
      nearest = Math.abs(there.x - at.x);
      best = route.dir;
    }
    return best;
  }

  // MARK: contacts

  private handle(events: ContactEvent[]) {
    if (this.finished || this.dying) return;
    let heroBurned = false, treasureLost = false, treasureMelted = false;
    let heroGassed = false, heroCrushed = false, friendCooked = false, friendGassed = false, friendCrushed = false;
    const catchers: Foe[] = [], friendCatchers: Foe[] = [], lit: Bomb[] = [], soaked: Bomb[] = [];
    let hit: [planck.Body, planck.Body] | null;
    for (const event of events) {
      if (pair(event, Cat.lava, Cat.hero)) {
        heroBurned = true;
      } else if ((hit = pair(event, Cat.foe, Cat.liquid))) {
        this.knockOut(tagOf(hit[0]).ref as Foe);
      } else if ((hit = pair(event, Cat.foe, Cat.hero))) {
        catchers.push(tagOf(hit[0]).ref as Foe);
      } else if ((hit = pair(event, Cat.foe, Cat.drain))) {
        this.sink(tagOf(hit[0]).ref as Foe);
      } else if (pair(event, Cat.lava, Cat.treasure)) {
        treasureMelted = true;
      } else if ((hit = pair(event, Cat.water, Cat.lava))) {
        this.annihilate(hit[0], hit[1]);
      } else if ((hit = pair(event, Cat.liquid, Cat.drain | Cat.grate))) {
        this.removeParticle(hit[0]);
      } else if (pair(event, Cat.treasure, Cat.drain)) {
        treasureLost = true;
      } else if (pair(event, Cat.hero, Cat.goal)) {
        this.latched.add("heroGoal");
      } else if (pair(event, Cat.treasure, Cat.hero)) {
        this.latch("treasureHero");
      } else if (pair(event, Cat.treasure, Cat.goal)) {
        this.latch("treasureGoal");
      } else if ((hit = pair(event, Cat.gas, Cat.vent))) {
        this.removeParticle(hit[0]);
      } else if (pair(event, Cat.gas, Cat.hero)) {
        heroGassed = true;
      } else if ((hit = pair(event, Cat.gas, Cat.foe))) {
        this.gasReaches(tagOf(hit[1]).ref as Foe);
      } else if (pair(event, Cat.gas, Cat.friend)) {
        friendGassed = true;
      } else if (pair(event, Cat.lava, Cat.friend)) {
        friendCooked = true;
      } else if ((hit = pair(event, Cat.foe, Cat.friend))) {
        friendCatchers.push(tagOf(hit[0]).ref as Foe);
      } else if (pair(event, Cat.hero, Cat.friend)) {
        this.reachFriend();
      } else if ((hit = pair(event, Cat.lava, Cat.bomb))) {
        lit.push(tagOf(hit[1]).ref as Bomb);
      } else if ((hit = pair(event, Cat.water, Cat.bomb))) {
        soaked.push(tagOf(hit[1]).ref as Bomb);
      } else if ((hit = pair(event, Cat.boulder, Cat.hero | Cat.foe | Cat.friend))) {
        if (!this.crushes(hit[0], hit[1])) continue;
        const struck = tagOf(hit[1]);
        if (struck.category === Cat.hero) heroCrushed = true;
        else if (struck.category === Cat.friend) friendCrushed = true;
        else this.knockOut(struck.ref as Foe);
      }
    }
    this.particles = this.particles.filter((p) => !tagOf(p.body).removed);
    // Water and lava that reach a dry crate in the same frame: the water wins, and it is a dud.
    for (const bomb of soaked) this.soak(bomb);
    for (const bomb of lit) this.light(bomb);
    // A goblin the flood reached in the same frame he reached the hero is already out of it.
    const caught = catchers.some((f) => f.active);
    if (heroBurned) {
      this.heroDies("The hero got cooked.", "sizzle");
    } else if (heroGassed) {
      this.heroDies("He breathed the gas.", "gas", "gassed");
    } else if (heroCrushed) {
      this.heroDies("Flattened by a boulder.", "hit", "crush");
    } else if (caught) {
      this.heroDies("The goblin got the hero.", "caught");
    } else if (friendCooked) {
      this.friendDies("Your friend got cooked.", "sizzle", "burn");
    } else if (friendGassed) {
      this.friendDies("Your friend breathed the gas.", "gas", "gassed");
    } else if (friendCrushed) {
      this.friendDies("Your friend was flattened.", "hit", "crush");
    } else if (friendCatchers.some((f) => f.active)) {
      this.friendDies("The goblin got your friend.", "caught", "caught");
    } else if (treasureMelted) {
      this.treasureMelts();
    } else if (treasureLost) {
      this.lose("The treasure went down the drain.");
    } else if (this.winConditionMet && this.winLatchedAt === null) {
      this.winLatchedAt = this.elapsed;
      this.calmFrames = 0;
    }
  }

  private latch(name: string) {
    if (this.latched.has(name)) return;
    this.latched.add(name);
    this.emit({ type: "sound", name: "gemLand" });
    if (this.treasure) this.emit({ type: "fx", name: "gem", ...position(this.treasure) });
  }

  /// The hero has touched his friend. That part of the win is kept, whatever happens next.
  private reachFriend() {
    if (this.latched.has("heroFriend") || !this.friend) return;
    this.latched.add("heroFriend");
    this.friendState = "happy";
    this.friendStateSince = this.elapsed;
    this.emit({ type: "sound", name: "gateGood" });
    this.emit({ type: "fx", name: "friend", ...position(this.friend) });
  }

  private removeParticle(body: planck.Body) {
    this.sk.remove(body);
  }

  /// Take a goblin out of play: nothing touches him any more, but he still rests on the stone while he goes.
  private retire(foe: Foe, state: "ko" | "sink") {
    foe.active = false;
    foe.state = state;
    foe.since = this.elapsed;
    this.sk.remask(foe.body, { category: 0, contactTest: 0, collision: Cat.wall | Cat.pin });
  }

  /// Water or lava on a goblin: he is out of play this frame, with a puff where he stood.
  /// A boulder, a blast and gas put him out the same way.
  private knockOut(foe: Foe) {
    if (!foe.active) return;
    this.retire(foe, "ko");
    this.clock.after(1.1, () => { foe.gone = true; this.sk.remove(foe.body); });
    this.emit({ type: "sound", name: "hit" });
    const at = position(foe.body);
    for (const [dx, dy] of [[-10, 4], [0, 14], [10, 4]]) this.emit({ type: "puff", x: at.x + dx, y: at.y + dy });
    this.emit({ type: "fx", name: "knockout", x: at.x, y: at.y });
  }

  private gasReaches(foe: Foe) {
    if (!foe.active) return;
    this.emit({ type: "sound", name: "gas" });
    this.emit({ type: "fx", name: "gassed", ...position(foe.body) });
    this.knockOut(foe);
  }

  /// Down the drain: he shrinks into it and is gone.
  private sink(foe: Foe) {
    if (!foe.active) return;
    this.retire(foe, "sink");
    this.sk.remove(foe.body);
    this.clock.after(0.35, () => { foe.gone = true; });
  }

  private annihilate(water: planck.Body, lava: planck.Body) {
    if (tagOf(water).removed || tagOf(lava).removed) return;
    const a = position(water), b = position(lava);
    this.sk.remove(water);
    this.sk.remove(lava);
    // Water meeting lava hisses, and again every 0.8 s for as long as the reaction lasts.
    if (this.elapsed - this.lastSizzle > 0.8) {
      this.lastSizzle = this.elapsed;
      this.emit({ type: "sound", name: "sizzle" });
      this.emit({ type: "fx", name: "steam", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    if (this.steamBudget > 0) {
      this.steamBudget -= 1;
      this.emit({ type: "puff", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  }

  // MARK: boulders and bombs

  /// Whether a boulder met someone hard enough to flatten him: 120 points a second or more
  /// between the two, by the speeds they had before the step in which they touched.
  private crushes(boulder: planck.Body, body: planck.Body): boolean {
    const a = this.before.get(boulder), b = this.before.get(body);
    return a !== undefined && b !== undefined && Math.hypot(a.x - b.x, a.y - b.y) >= CRUSH_SPEED;
  }

  /// Lava on a dry crate lights it. The blast comes when the fuse has burned, in machinery().
  private light(bomb: Bomb) {
    if (bomb.state !== "dry") return;
    bomb.state = "lit";
    bomb.since = this.elapsed;
    this.emit({ type: "sound", name: "fuse" });
    this.emit({ type: "fx", name: "fuse", ...position(bomb.body) });
  }

  /// Water on a crate that is not lit makes it a dud for good. It stays where it is, a solid crate.
  private soak(bomb: Bomb) {
    if (bomb.state !== "dry") return;
    bomb.state = "wet";
    bomb.since = this.elapsed;
    this.emit({ type: "sound", name: "pop" });
    this.emit({ type: "fx", name: "soak", ...position(bomb.body) });
  }

  /// A crate goes off. Cracked walls within reach are gone first. Then the blast touches
  /// whatever has its middle within reach and nothing solid (a wall, a slab, a pin or a door)
  /// on the straight line to it: goblins are knocked out, the hero and the friend are killed,
  /// dry crates are lit, and everything loose is thrown outward.
  private blast(bomb: Bomb) {
    if (bomb.state !== "lit") return;
    const at = position(bomb.body);
    bomb.state = "gone";
    bomb.since = this.elapsed;
    this.sk.remove(bomb.body);
    this.emit({ type: "haptic", name: "slam" });
    this.emit({ type: "sound", name: "blast" });
    this.emit({ type: "fx", name: "blast", x: at.x, y: at.y, n: BLAST_RADIUS });
    for (const wall of this.cracked) {
      if (wall.gone || gap(at, wall.rect) > BLAST_RADIUS) continue;
      wall.gone = true;
      this.sk.remove(wall.body);
      this.emit({ type: "sound", name: "wallBreak" });
      // Rubble along the wall's length, a handful every twenty points or so.
      const { rect } = wall, along = rect.w >= rect.h, pieces = Math.max(1, Math.round(Math.max(rect.w, rect.h) / 20));
      for (let i = 0; i < pieces; i++) {
        const t = (i + 0.5) / pieces;
        this.emit({ type: "fx", name: "rubble", x: along ? rect.x + rect.w * t : rect.x + rect.w / 2, y: along ? rect.y + rect.h / 2 : rect.y + rect.h * t });
      }
    }
    /// How strongly the blast reaches a body, from 1 at the bomb to 0 at the edge. 0 when it does not reach it.
    const reach = (body: planck.Body | null): number => {
      if (!body || tagOf(body).removed) return 0;
      const to = position(body), far = Math.hypot(to.x - at.x, to.y - at.y);
      if (far > BLAST_RADIUS || this.sk.rayCast(at, to, Cat.wall | Cat.pin)) return 0;
      return 1 - far / BLAST_RADIUS;
    };
    const live = !this.finished && !this.dying;
    if (live) {
      for (const foe of this.foes) if (foe.active && reach(foe.body) > 0) this.knockOut(foe);
      if (reach(this.hero) > 0) this.heroDies("Too close to the blast.", "hit", "blasted");
      else if (reach(this.friend) > 0) this.friendDies("Your friend was too close to the blast.", "hit", "blasted");
    }
    for (const other of this.bombs) if (other.state === "dry" && reach(other.body) > 0) this.light(other);
    const loose = [this.treasure, ...this.boulders.map((b) => b.body), ...this.bombs.filter((b) => b.state !== "gone").map((b) => b.body), ...this.particles.map((p) => p.body)];
    for (const body of loose) {
      const strength = reach(body);
      if (strength <= 0 || !body) continue;
      const to = position(body), far = Math.hypot(to.x - at.x, to.y - at.y);
      // Straight away from the bomb. Something sitting exactly on it goes up.
      const ux = far > 0.01 ? (to.x - at.x) / far : 0, uy = far > 0.01 ? (to.y - at.y) / far : 1;
      const push = body.getMass() * BLAST_KICK * strength;
      applyImpulse(body, { x: ux * push, y: uy * push });
    }
  }

  private get winConditionMet(): boolean {
    switch (this.level.winWhen) {
      case "heroReachesGoal": return this.latched.has("heroGoal");
      case "treasureReachesGoal": return this.latched.has("treasureGoal");
      case "both": return this.latched.has("treasureHero") && this.latched.has("heroGoal");
      case "heroReachesFriend": return this.latched.has("heroFriend");
      default: return this.latched.has("treasureHero");
    }
  }

  /// Gold does not survive lava. The level ends after the treasure has visibly gone.
  private treasureMelts() {
    if (!this.treasure || this.dying) return;
    this.dying = true;
    this.treasureMelting = this.elapsed;
    this.emit({ type: "haptic", name: "slam" });
    this.emit({ type: "sound", name: "melt" });
    this.emit({ type: "fx", name: "melt", ...position(this.treasure) });
    this.clock.after(0.5, () => this.lose("The treasure melted."));
  }

  /// `fx` names what the scene draws for the death. Lava burns him and a goblin catches him, and
  /// those two are told apart by the sound alone.
  private heroDies(reason: string, sound: string, fx = sound === "caught" ? "caught" : "burn") {
    if (!this.hero || this.dying) return;
    this.dying = true;
    this.heroState = "ko";
    this.heroStateSince = this.elapsed;
    this.emit({ type: "haptic", name: "slam" });
    this.emit({ type: "sound", name: "cooked" });
    this.emit({ type: "sound", name: sound });
    this.emit({ type: "fx", name: fx, ...position(this.hero) });
    // A beat on the knocked-out pose, then the fade, then the result.
    this.clock.after(1.1, () => this.lose(reason));
  }

  /// The friend goes the way the hero does, and the level is lost the same way.
  private friendDies(reason: string, sound: string, fx: string) {
    if (!this.friend || this.dying) return;
    this.dying = true;
    this.friendState = "ko";
    this.friendStateSince = this.elapsed;
    this.emit({ type: "haptic", name: "slam" });
    this.emit({ type: "sound", name: "cooked" });
    this.emit({ type: "sound", name: sound });
    this.emit({ type: "fx", name: fx, ...position(this.friend) });
    this.clock.after(1.1, () => this.lose(reason));
  }

  private win() {
    this.heroState = "excited";
    this.heroStateSince = this.elapsed;
    this.emit({ type: "haptic", name: "success" });
    this.emit({ type: "sound", name: "win" });
    const star = this.hero ?? this.treasure;
    if (star) this.emit({ type: "fx", name: "win", ...position(star) });
    this.outcome = { won: true, stars: stars(this.level, this.pulled.length), coins: 0, score: this.pulled.length };
  }

  private lose(reason: string) {
    if (this.finished) return;
    this.emit({ type: "haptic", name: "failure" });
    this.emit({ type: "sound", name: "lose" });
    this.outcome = { won: false, reason };
  }

  /// The line under the title in the HUD.
  get readout(): string {
    let text = `pins ${this.remaining} left   pulled ${this.pulled.length}   par ${this.level.parPins}`;
    if (this.winLatchedAt !== null && !this.finished) text += "   waiting for calm";
    return text;
  }
}

/// A rectangle drawn in from each edge, and never to nothing.
const inset = (r: Rect, by: number): Rect => {
  const dx = Math.min(by, r.w / 2 - 0.1), dy = Math.min(by, r.h / 2 - 0.1);
  return { x: r.x + dx, y: r.y + dy, w: r.w - 2 * dx, h: r.h - 2 * dy };
};

/// Step a level until it ends, with the given pins pulled in order. The replay suite and the audit both use this.
export const playOut = (level: PinLevel, pins: string[], maxSeconds = 120): { outcome: Outcome | null; seconds: number; pulled: number } => {
  const sim = new PinSim(level);
  sim.replay(pins);
  const frames = Math.ceil(maxSeconds / STEP);
  for (let i = 0; i < frames && !sim.finished; i++) sim.frame();
  return { outcome: sim.outcome, seconds: sim.elapsed, pulled: sim.pulled.length };
};
