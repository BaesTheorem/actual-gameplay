// Pull the Pin: chambers of water, lava and goblins held up on pins. Pull order is the puzzle.
// This is the whole game with no drawing in it; the browser scene and the Node replay both step it.
import type * as planck from "planck";
import { Clock, type Emit } from "./clock";
import {
  PLAYFIELD, STEP, SKWorld, clampSpeed, pair, position, setPosition, speed, tagOf,
  type ContactEvent, type Outcome, type Vec,
} from "./sk";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Decor { sprite: string; x: number; y: number; w: number; h: number }
export interface PinSpec { id: string; x: number; y: number; w: number; side: string; angle?: number }
export interface PinLevel {
  id: string;
  name: string;
  hint?: string;
  /// Pulls the intended solution needs. Three stars at or under it, two for one extra pull.
  parPins: number;
  /// treasureReachesHero, heroReachesGoal, treasureReachesGoal, or both.
  winWhen: string;
  frame?: boolean;
  walls?: Rect[];
  slabs?: { x1: number; y1: number; x2: number; y2: number; t?: number }[];
  pins: PinSpec[];
  pools?: (Rect & { liquid: string; count: number })[];
  drains?: Rect[];
  grates?: Rect[];
  decor?: Decor[];
  actors: { hero?: Vec; treasure?: Vec; goal?: Rect; foes?: Vec[] };
  solution?: string[];
  settleSeconds?: number;
}

export const Cat = {
  wall: 1 << 0,
  pin: 1 << 1,
  water: 1 << 2,
  lava: 1 << 3,
  hero: 1 << 4,
  treasure: 1 << 5,
  goal: 1 << 6,
  drain: 1 << 7,
  /// Swallows liquid like a drain, but the hero and the treasure fall straight through it.
  grate: 1 << 8,
  /// A goblin: water or lava ends him, and he ends the hero.
  foe: 1 << 9,
  liquid: (1 << 2) | (1 << 3),
};

export const PIN_THICKNESS = 14;
export const KNOB_OFFSET = 26;
export const FRAME_THICKNESS = 14;
export const LIQUID_RADIUS = 3.5;
const LIQUID_MAX_SPEED = 700;
export const HERO_RADIUS = 16;

export const stars = (level: PinLevel, pulls: number) =>
  pulls <= level.parPins ? 3 : pulls === level.parPins + 1 ? 2 : 1;

/// Corners of the rectangle that thickens segment a-b, counterclockwise in a y-up space.
export const segmentQuad = (a: Vec, b: Vec, halfWidth: number): Vec[] => {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const n = { x: (-dy / len) * halfWidth, y: (dx / len) * halfWidth };
  return [
    { x: a.x - n.x, y: a.y - n.y }, { x: b.x - n.x, y: b.y - n.y },
    { x: b.x + n.x, y: b.y + n.y }, { x: a.x + n.x, y: a.y + n.y },
  ];
};

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

export interface Foe { body: planck.Body; active: boolean; gone: boolean; state: "idle" | "ko" | "sink"; since: number }
export interface Particle { body: planck.Body; kind: "water" | "lava"; lastSpeed: number }

export class PinSim {
  readonly sk = new SKWorld(-6);
  readonly clock = new Clock();
  readonly pins: Pin[] = [];
  readonly pulled: string[] = [];
  particles: Particle[] = [];
  hero: planck.Body | null = null;
  heroState: "idle" | "ko" | "excited" = "idle";
  heroStateSince = 0;
  treasure: planck.Body | null = null;
  treasureMelting = -1;
  foes: Foe[] = [];
  outcome: Outcome | null = null;
  dying = false;
  winLatchedAt: number | null = null;
  elapsed = 0;

  private latched = new Set<string>();
  private calmFrames = 0;
  private lastPullTime = -10;
  private replayArmed = false;
  private replayQueue: string[] = [];
  private steamBudget = 0;
  private splashArmed = false;
  private lastSizzle = -10;

  constructor(readonly level: PinLevel, private emit: Emit = () => {}) {
    this.build();
  }

  get finished() { return this.outcome !== null; }
  get remaining() { return this.pins.filter((p) => !p.pulled).length; }

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
    const sensor = (kind: string, category: number, contactTest: number, r: Rect) =>
      sk.box({ kind, dynamic: false, category, collision: 0, contactTest }, r.w, r.h, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
    for (const drain of level.drains ?? []) sensor("drain", Cat.drain, Cat.liquid | Cat.treasure, drain);
    for (const grate of level.grates ?? []) sensor("grate", Cat.grate, Cat.liquid, grate);
    if (level.actors.goal) sensor("goal", Cat.goal, Cat.hero | Cat.treasure, level.actors.goal);

    for (const spec of level.pins) {
      const pin = new Pin(spec);
      pin.body = sk.box(
        { kind: "pin", dynamic: false, friction: 0.3, restitution: 0, category: Cat.pin, position: pin.home, angle: pin.angle, ref: pin },
        spec.w, PIN_THICKNESS,
      );
      this.pins.push(pin);
    }
    for (const pool of level.pools ?? []) this.spawn(pool, pool.count, pool.liquid === "lava" ? "lava" : "water");

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
      const foe: Foe = { body: null as unknown as planck.Body, active: true, gone: false, state: "idle", since: 0 };
      foe.body = sk.circle({
        kind: "foe", position: spot, friction: 0.8, restitution: 0.05, linearDamping: 0.2,
        fixedRotation: true, bullet: true, category: Cat.foe,
        collision: solid | Cat.hero | Cat.treasure | Cat.foe,
        contactTest: Cat.liquid | Cat.hero | Cat.drain, ref: foe,
      }, HERO_RADIUS);
      this.foes.push(foe);
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

  /// Fill a rectangle with particles from the bottom up, in offset rows.
  private spawn(rect: Rect, count: number, kind: "water" | "lava") {
    const r = LIQUID_RADIUS, dx = 2 * r * 0.95, dy = dx * 0.866;
    let y = rect.y + r, row = 0, made = 0;
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
      y += dy;
      row += 1;
    }
  }

  private addParticle(kind: "water" | "lava", at: Vec) {
    const body = this.sk.circle({
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

  pull(id: string): boolean {
    const pin = this.pins.find((p) => p.id === id);
    if (this.finished || this.dying || !pin || pin.pulled) return false;
    pin.pulled = true;
    this.pulled.push(id);
    this.lastPullTime = this.elapsed;
    this.calmFrames = 0;
    this.emit({ type: "haptic", name: "thud" });
    this.emit({ type: "sound", name: "pinPull" });
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
    const events = this.sk.step(dt);
    if (events.length > 0) this.handle(events);
  }

  private tick(dt: number) {
    this.elapsed += dt;
    this.steamBudget = 6;
    let fastest = 0, landings = 0;
    for (const p of this.particles) {
      const s = speed(p.body);
      // 200 pt/s is a fall of about 20 pt; losing most of it in one step is an impact.
      if (p.kind === "water" && p.lastSpeed > 200 && s < p.lastSpeed * 0.4) landings += 1;
      p.lastSpeed = s;
      if (s > LIQUID_MAX_SPEED) clampSpeed(p.body, LIQUID_MAX_SPEED);
      fastest = Math.max(fastest, Math.min(s, LIQUID_MAX_SPEED));
    }
    // A few particles, not one stray drop.
    if (this.splashArmed && landings >= 3) {
      this.splashArmed = false;
      this.emit({ type: "sound", name: "splash" });
    }
    // A goblin still falling is as unsettled as the hero: he may be about to land on him.
    const movers = [this.hero, this.treasure, ...this.foes.filter((f) => f.active).map((f) => f.body)];
    for (const body of movers) if (body && !tagOf(body).removed) fastest = Math.max(fastest, speed(body));
    // 6 pt/s: a settled pile reads below it, a treasure creeping down a slab reads above it.
    this.calmFrames = fastest < 6 ? this.calmFrames + 1 : 0;

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

  private handle(events: ContactEvent[]) {
    if (this.finished || this.dying) return;
    let heroBurned = false, treasureLost = false, treasureMelted = false;
    const catchers: Foe[] = [];
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
      }
    }
    this.particles = this.particles.filter((p) => !tagOf(p.body).removed);
    // A goblin the flood reached in the same frame he reached the hero is already out of it.
    const caught = catchers.some((f) => f.active);
    if (heroBurned) {
      this.heroDies("The hero got cooked.", "sizzle");
    } else if (caught) {
      this.heroDies("The goblin got the hero.", "caught");
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
  private knockOut(foe: Foe) {
    if (!foe.active) return;
    this.retire(foe, "ko");
    this.clock.after(1.1, () => { foe.gone = true; this.sk.remove(foe.body); });
    this.emit({ type: "sound", name: "hit" });
    const at = position(foe.body);
    for (const [dx, dy] of [[-10, 4], [0, 14], [10, 4]]) this.emit({ type: "puff", x: at.x + dx, y: at.y + dy });
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
    }
    if (this.steamBudget > 0) {
      this.steamBudget -= 1;
      this.emit({ type: "puff", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  }

  private get winConditionMet(): boolean {
    switch (this.level.winWhen) {
      case "heroReachesGoal": return this.latched.has("heroGoal");
      case "treasureReachesGoal": return this.latched.has("treasureGoal");
      case "both": return this.latched.has("treasureHero") && this.latched.has("heroGoal");
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
    this.clock.after(0.5, () => this.lose("The treasure melted."));
  }

  private heroDies(reason: string, sound: string) {
    if (!this.hero || this.dying) return;
    this.dying = true;
    this.heroState = "ko";
    this.heroStateSince = this.elapsed;
    this.emit({ type: "haptic", name: "slam" });
    this.emit({ type: "sound", name: "cooked" });
    this.emit({ type: "sound", name: sound });
    // A beat on the knocked-out pose, then the fade, then the result.
    this.clock.after(1.1, () => this.lose(reason));
  }

  private win() {
    this.heroState = "excited";
    this.heroStateSince = this.elapsed;
    this.emit({ type: "haptic", name: "success" });
    this.emit({ type: "sound", name: "win" });
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

/// Step a level until it ends, with the given pins pulled in order. The replay suite and the audit both use this.
export const playOut = (level: PinLevel, pins: string[], maxSeconds = 120): { outcome: Outcome | null; seconds: number; pulled: number } => {
  const sim = new PinSim(level);
  sim.replay(pins);
  const frames = Math.ceil(maxSeconds / STEP);
  for (let i = 0; i < frames && !sim.finished; i++) sim.frame();
  return { outcome: sim.outcome, seconds: sim.elapsed, pulled: sim.pulled.length };
};
