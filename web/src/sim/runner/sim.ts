// Crowd Run: steer a crowd down a road. It throws ink pellets at whatever stands ahead of it,
// picks the better gate, dodges what kills, and fights what is left of the finale hand to hand.
// Pure kinematics in lane space, with no drawing in it. The browser scene steps it, and so do
// the generator's fairness check, the suite and the economy script, which play it with no screen.
import { Clock, type Emit } from "../clock";
import { STEP, type Outcome, type Vec } from "../sk";
import { Crowd } from "./crowd";
import { RunnerEconomy } from "./economy";
import { Projection } from "./projection";
import {
  BRIDGE_HALF, FinaleFight, GateOp, Gates, Hammer, Hazard, finaleStrength, halfRoad,
  type Piece, type PieceKind, type Reward, type Span, type Track,
} from "./track";
import { worldOf, type World } from "./worlds";

// MARK: tuning

/// Hit points one runner's pellets take off a target each second at fire rate 1. A starting
/// crowd of 5 takes 24 a second, so the first run's crate of 30 breaks in 1.25 s. It comes into
/// range 1.43 s before the crowd reaches it.
export const PELLET = 4.8;
/// How far ahead the crowd reaches before any range gate, in road units.
export const BASE_RANGE = 10;
/// Half the width of the road in lane units, for distances that run both across and along it.
export const ROAD_HALF = 4;
/// A barrel that blows up takes every squad and crate this near, in lane units.
export const BLAST_RADIUS = 4.5;
/// The finale stands on its line until the crowd is this near, in lane units, and then comes
/// at it this fast, in lane units a second. So it is in range of the pellets for about a third
/// of a second, which softens it and leaves most of it for the fight.
export const CHARGE_GAP = 12;
export const CHARGE_SPEED = 20;
/// The fight starts when the finale is this far ahead of the crowd.
export const FIGHT_DISTANCE = 2.5;
/// Half the width of a boss, as a target.
export const BOSS_HALF = 0.45;
/// A boss shows where its slam will land for this long. The slam lands as the boss starts its charge.
export const SLAM_TELEGRAPH = 1;
/// The crowd's middle stays this far inside the road's edges.
export const STEER_LIMIT = 0.85;
/// The crowd closes on where it is steered at this rate a second: a quarter second covers 95% of a move.
export const STEER_RATE = 12;
/// A win is three stars at this share of the skilled bot's crowd, and two at this one.
export const THREE_STARS = 0.85, TWO_STARS = 0.5;

/// Where the crowd runs, as lane units ahead of the camera.
const ANCHOR = Projection.anchorZ;

/// Crowd runners, in clip-frame points at depth scale 1.
export const RUNNER_HEIGHT = 40;

// MARK: state for the scene and the bots

/// How a piece stopped being in the way: a crate "broken" by pellets, anything "blown" up by a
/// barrel, a barrel "burst", a squad "cleared" by pellets or "traded" against the crowd.
export type ItemEnd = "broken" | "blown" | "burst" | "cleared" | "traded";

/// One piece on the road as the run has left it.
export class Item {
  readonly kind: PieceKind;
  readonly z: number;
  /// True for what pellets can hit: a crate, a barrel, a squad.
  readonly target: boolean;
  /// The stretch of lane it covers. A gate pair and a bridge cover the whole road.
  readonly lo: number;
  readonly hi: number;
  /// Hit points left, and at the start. A squad has one for each rival.
  hp: number;
  readonly max: number;
  /// True until it is broken, blown up, cleared or traded. A crate the crowd ran into stays live.
  live = true;
  /// True once the crowd has reached it.
  passed = false;
  ended: ItemEnd | null = null;
  /// The game time it ended, or for a gate pair the time it was taken.
  endedAt = 0;
  /// Which gate of a pair the crowd took.
  tookLeft: boolean | null = null;
  /// How many thirds of its hit points a crate has lost, for the cracks drawn on it.
  cracks = 0;
  /// Depth ahead of the camera now, and whether that is on screen.
  ahead = 0;
  visible = false;

  constructor(readonly piece: Piece, readonly index: number) {
    this.kind = piece.kind;
    this.z = piece.z;
    this.target = piece.kind === "crate" || piece.kind === "barrel" || piece.kind === "squad";
    const spans = "lo" in piece;
    this.lo = spans ? piece.lo : -1;
    this.hi = spans ? piece.hi : 1;
    this.max = piece.kind === "squad" ? piece.count : "hp" in piece ? piece.hp : 0;
    this.hp = this.max;
    this.ahead = piece.z;
  }

  /// Hit points as a whole number, as they are shown.
  get shown(): number { return Math.max(0, Math.ceil(this.hp - 1e-9)); }
}

export interface BossState {
  z: number;
  visible: boolean;
  /// The painted clip the boss plays: idle on the way in, hit for the whole fight.
  clip: "clawd_boss_idle" | "clawd_boss_hit";
  /// Health left as a share of the health it started with.
  bar: number;
}

/// A boss's slam: which half it lands on, and where it is in its three stages.
export interface SlamState {
  /// -1 for the left half of the road, 1 for the right.
  side: number;
  stage: "waiting" | "warned" | "landed";
  /// The game time the warning began, and the time it lands.
  warnedAt: number;
  landsAt: number;
}

export interface Label { text: string; position: Vec; hidden: boolean }
export interface HUD { title: string; readout: string; progress: number }

/// Whatever steers a run that no finger steers: a bot. It answers with where the crowd should
/// head, in lane units, each time the simulation asks.
export interface Pilot { steer(sim: RunnerSim): number }

export interface SimOptions {
  /// Off for a run nobody watches: no runners, no labels and no cues, and the same result.
  view?: boolean;
  /// The crowd the skilled bot finishes this track with at these upgrades, which is what the
  /// stars are measured against. Without it the track's own par is used.
  par?: number;
  /// A finale that cannot be worn down. The run ends when the fight would start, and
  /// `finaleDamage` says what the crowd's pellets did on the way in. The generator sizes a
  /// finale with it.
  probe?: boolean;
}

const STRIPES = 10;
const QUIET: Emit = () => {};

export class RunnerSim {
  readonly track: Track;
  readonly level: number;
  readonly world: World;
  readonly clock = new Clock();
  readonly crowd: Crowd;
  /// The rival crowd of a crowd finale, as drawn. Null for a boss, and for a run nobody watches.
  readonly enemy: Crowd | null = null;
  readonly boss: BossState | null = null;
  readonly slam: SlamState | null = null;
  readonly items: Item[];
  /// Depth of each centre-line stripe. A stripe nearer than z = 1 is not drawn.
  readonly stripes: number[] = new Array<number>(STRIPES).fill(0);
  readonly countLabel: Label = { text: "", position: { x: 0, y: 0 }, hidden: false };
  readonly enemyLabel: Label = { text: "", position: { x: 0, y: 0 }, hidden: true };
  hud: HUD = { title: "", readout: "", progress: 0 };
  outcome: Outcome | null = null;

  /// Distance run so far, in lane units.
  travel = 0;
  time = 0;
  anchorX = 0;
  targetX = 0;
  /// Pellets thrown, as a multiple of the base rate, and how far ahead they reach.
  rate: number;
  range = BASE_RANGE;
  /// Coins found in crates so far.
  found = 0;
  /// The first piece the crowd has not reached yet, as an index into `items`.
  next = 0;
  /// The piece being shot this step, or null. `shootingFinale` is set when it is the finale.
  shooting: Item | null = null;
  shootingFinale = false;
  /// What is left of the finale, in hit points, and what it started with.
  rivals: number;
  readonly finaleMax: number;
  /// Hit points the crowd's pellets have taken off the finale.
  finaleDamage = 0;
  /// Where the finale is along the track. It starts on the finale line and moves once it charges.
  finaleAt: number;
  charging = false;
  /// True while the crowd is on a bridge. `bridgeEnd` is where the one it is on ends.
  onBridge = false;
  bridgeEnd = 0;
  fighting = false;
  pilot: Pilot | null = null;
  /// Under reduced motion the runners squash half as much.
  reducedMotion = false;

  private readonly view: boolean;
  private readonly probe: boolean;
  private readonly par: number;
  private readonly emit: Emit;
  /// True when somebody listens for cues. A run played with no screen makes none.
  private readonly loud: boolean;
  private readonly power: number;
  private readonly finaleZ: number;
  private drag: { touchX: number; anchorX: number } | null = null;
  private clash: FinaleFight | null = null;
  private fightClock = 0;
  private lastHUD = "";
  private bossAnnounced = false;
  private popsLeft = 0;
  private nextPop = 0;
  private nextPellet = 0;
  private hammerBeats = new Map<Item, number>();

  constructor(track: Track, readonly economy: RunnerEconomy = RunnerEconomy.base, emit: Emit | null = null, options: SimOptions = {}) {
    this.track = track;
    this.level = track.level;
    this.world = worldOf(track.level);
    this.view = options.view ?? true;
    this.probe = options.probe ?? false;
    this.par = options.par ?? track.par;
    this.emit = emit ?? QUIET;
    this.loud = emit !== null && this.view;
    this.power = economy.memberPower;
    this.rate = economy.fireRate;
    this.finaleZ = track.finaleZ;
    this.items = track.pieces.map((piece, index) => new Item(piece, index));
    this.crowd = new Crowd(economy.startCrowd, ANCHOR, 1, this.view);
    this.finaleMax = finaleStrength(track.finale);
    this.rivals = this.probe ? Infinity : this.finaleMax;
    this.finaleAt = track.finaleZ;
    if (track.finale.type === "crowd") {
      // The rivals are mirrored so the two crowds face each other.
      if (this.view) this.enemy = new Crowd(track.finale.count, this.finaleAt, -1);
    } else {
      this.boss = { z: track.finaleZ, visible: false, clip: "clawd_boss_idle", bar: 1 };
      this.slam = { side: track.finale.slam < 0 ? -1 : 1, stage: "waiting", warnedAt: 0, landsAt: 0 };
    }
    if (this.view) {
      this.layoutTrack();
      this.pushHUD();
    }
  }

  get finished() { return this.outcome !== null; }
  /// Simulated seconds since the run began.
  get elapsed() { return this.time; }
  get count() { return this.crowd.count; }
  get levelID() { return String(this.level + 1).padStart(2, "0"); }
  get levelName() { return `Run ${this.level + 1}`; }
  /// How long a bot's run may take before the suite gives up on it.
  get replayWait() { return this.track.finaleZ / this.track.speed + 14; }
  /// True when the rival crowd is too far up the road to draw.
  get enemyHidden() { return this.enemy !== null && this.enemy.anchorZ > Projection.farZ; }
  /// The crowd's place along the track, in lane units from the start.
  get front() { return this.travel + ANCHOR; }
  /// Hit points the crowd's pellets take off a target each second.
  get firepower() { return this.crowd.count * this.rate * PELLET; }
  /// Half the width of the finale as a target: a boss, or a rival crowd of the size it is now.
  get finaleHalf() { return this.track.finale.type === "boss" ? BOSS_HALF : Crowd.radiusOf(Math.ceil(this.rivals)); }
  /// What is left of the finale as a whole number, as it is shown and as it is fought.
  get rivalsShown() { return Math.max(0, Math.ceil(this.rivals - 1e-9)); }

  /// Human wording for the score a win carries.
  static describe(score: number | null | undefined): string { return `survivors ${Math.round(score ?? 0)}`; }

  // MARK: input

  /// Hand the steering to a bot.
  fly(pilot: Pilot) { this.pilot = pilot; }

  /// A finger went down at canvas x. The drag steers relative to where the crowd was then.
  dragBegan(x: number) {
    if (this.finished) return;
    this.drag = { touchX: x, anchorX: this.anchorX };
  }

  dragMoved(x: number) {
    if (!this.drag) return;
    const dx = x - this.drag.touchX;
    this.steer(this.drag.anchorX + dx / Projection.laneWidth(ANCHOR));
  }

  dragEnded() { this.drag = null; }

  /// Set where the crowd heads, in lane units. The road's last 0.15 on each side is out of
  /// reach, and on a bridge so is everything the crowd would hang over the edge from.
  steer(targetX: number) {
    const limit = this.onBridge ? Math.max(0, BRIDGE_HALF - Math.min(this.crowd.radius, BRIDGE_HALF)) : STEER_LIMIT;
    this.targetX = Math.min(limit, Math.max(-limit, targetX));
  }

  // MARK: simulation

  /// One frame: game logic, then the timers and the pop sounds queued by it.
  frame(dt = STEP) {
    this.tick(dt);
    if (!this.loud) return;
    this.clock.advance(dt);
    while (this.popsLeft > 0 && this.time >= this.nextPop - 1e-9) {
      this.popsLeft -= 1;
      this.nextPop += 0.05;
      this.emit({ type: "sound", name: "pop" });
    }
  }

  private tick(dt: number) {
    this.time += dt;
    if (this.finished) return;
    if (!this.fighting) {
      this.travel += this.track.speed * dt;
      const front = this.travel + ANCHOR;
      if (this.onBridge && front > this.bridgeEnd) this.leaveBridge();
      if (this.pilot) this.steer(this.pilot.steer(this));
      else if (this.onBridge) this.steer(this.targetX);
      this.anchorX += (this.targetX - this.anchorX) * Math.min(1, STEER_RATE * dt);
      this.crowd.anchorX = this.anchorX;
      this.shoot(front, dt);
      if (!this.finished) this.cross(front);
      if (!this.finished) this.approach(front, dt);
    } else {
      this.fight(dt);
    }
    if (!this.view) return;
    const wobble = this.reducedMotion ? 0.03 : 0.06;
    this.crowd.anchorX = this.anchorX;
    this.crowd.update(dt, this.time, wobble);
    this.enemy?.update(dt, this.time, wobble);
    this.layoutTrack();
    this.pushHUD();
  }

  // MARK: shooting

  /// The crowd throws pellets all the time. Pellets are not tracked one by one: each step, the
  /// nearest live target ahead that is in range and whose span overlaps the crowd's own width
  /// loses count x fire rate x PELLET x dt hit points. Past the last piece that target is the finale.
  private shoot(front: number, dt: number) {
    const x = this.anchorX, r = this.crowd.radius, lo = x - r, hi = x + r, reach = front + this.range;
    const items = this.items;
    let target: Item | null = null;
    for (let i = this.next; i < items.length; i++) {
      const item = items[i]!;
      if (item.z > reach) break;
      if (item.target && item.live && item.lo < hi && item.hi > lo) { target = item; break; }
    }
    this.shooting = target;
    this.shootingFinale = false;
    const damage = this.crowd.count * this.rate * PELLET * dt;
    if (target) {
      target.hp -= damage;
      if (target.hp <= 0) this.shotDown(target);
      else if (this.loud) this.chip(target);
    } else if (this.finaleAt <= reach && this.rivals > 0) {
      const half = this.finaleHalf;
      if (-half < hi && half > lo) {
        this.shootingFinale = true;
        this.rivals -= damage;
        this.finaleDamage += damage;
        if (this.boss) this.boss.bar = Math.max(0, this.rivals) / Math.max(1, this.finaleMax);
        if (this.rivals <= 0) this.finaleDown();
      }
    }
    if (this.loud && (target || this.shootingFinale) && this.time >= this.nextPellet) {
      // Pellets landing are heard a few times a second, not once each.
      this.nextPellet = this.time + 0.16;
      this.emit({ type: "sound", name: "pellet" });
    }
  }

  /// A crate cracks as it loses each third of its hit points.
  private chip(item: Item) {
    if (item.kind !== "crate") return;
    const cracks = Math.min(2, Math.floor((1 - item.hp / item.max) * 3));
    if (cracks <= item.cracks) return;
    item.cracks = cracks;
    this.emit({ type: "sound", name: "crack" });
    this.emit({ type: "fx", name: "crateCrack", ...this.itemPoint(item) });
  }

  /// Pellets took a target's last hit point.
  private shotDown(item: Item) {
    item.hp = 0;
    item.live = false;
    item.endedAt = this.time;
    const piece = item.piece;
    if (piece.kind === "crate") {
      item.ended = "broken";
      this.give(piece.holds, item);
    } else if (piece.kind === "barrel") {
      item.ended = "burst";
      this.blast(item);
    } else {
      item.ended = "cleared";
      if (this.loud) {
        this.emit({ type: "sound", name: "pop" });
        this.emit({ type: "fx", name: "squadDown", ...this.itemPoint(item) });
      }
    }
  }

  /// A broken crate gives what it holds.
  private give(reward: Reward, item: Item) {
    const before = this.crowd.count;
    if (reward.kind === "allies") this.crowd.setCount(before + reward.n);
    else if (reward.kind === "times") this.crowd.setCount(before * reward.n);
    else if (reward.kind === "rate") this.rate += reward.n / 100;
    else this.found += reward.n;
    if (!this.loud) return;
    const names = { allies: "crateAllies", times: "crateTimes", rate: "crateRate", coins: "crateCoins" } as const;
    this.emit({ type: "haptic", name: "tap" });
    this.emit({ type: "sound", name: "wallBreak" });
    this.emit({ type: "sound", name: reward.kind === "coins" ? "coin" : "gateGood" });
    this.emit({ type: "fx", name: names[reward.kind], ...this.itemPoint(item), n: reward.n });
    this.pops(this.crowd.count - before);
  }

  /// A barrel went up. Every live squad and crate within BLAST_RADIUS of it goes with it, and a
  /// crate that goes this way gives nothing. The distance runs across the road and along it.
  private blast(barrel: Item) {
    const middle = (barrel.lo + barrel.hi) / 2;
    for (let i = this.next; i < this.items.length; i++) {
      const item = this.items[i]!;
      if (item.z > barrel.z + BLAST_RADIUS) break;
      if (!item.live || (item.kind !== "squad" && item.kind !== "crate")) continue;
      const across = (middle < item.lo ? item.lo - middle : middle > item.hi ? middle - item.hi : 0) * ROAD_HALF;
      const along = item.z - barrel.z;
      if (across * across + along * along > BLAST_RADIUS * BLAST_RADIUS) continue;
      item.live = false;
      item.ended = "blown";
      item.endedAt = this.time;
    }
    if (!this.loud) return;
    this.emit({ type: "haptic", name: "slam" });
    this.emit({ type: "sound", name: "blast" });
    // The ring opens to the edge of the blast as the road shows it at the barrel's depth.
    const reach = (BLAST_RADIUS / ROAD_HALF) * Projection.laneWidth(barrel.z - this.travel);
    this.emit({ type: "fx", name: "blast", ...this.itemPoint(barrel), n: reach });
  }

  /// Pellets took the last of the finale before the fight began.
  private finaleDown() {
    this.rivals = 0;
    this.enemy?.setCount(0);
    if (this.boss) {
      this.boss.bar = 0;
      this.setBossClip("clawd_boss_hit");
      if (this.loud) {
        const at = Projection.point(0, this.finaleAt - this.travel);
        this.emit({ type: "sound", name: "wallBreak" });
        this.emit({ type: "fx", name: "bossDown", x: at.x, y: at.y + 40 * Projection.scale(this.finaleAt - this.travel) });
      }
    }
    this.win(this.crowd.count);
  }

  // MARK: reaching things

  /// Everything the crowd has drawn level with this step, nearest first.
  private cross(front: number) {
    const items = this.items;
    while (this.next < items.length && items[this.next]!.z <= front) {
      const item = items[this.next++]!;
      item.passed = true;
      if (item.live) this.reach(item);
      if (this.finished) return;
    }
  }

  private reach(item: Item) {
    const piece = item.piece;
    switch (piece.kind) {
      case "gates": return this.takeGate(item, piece);
      case "crate":
        // A crate that was not broken in time is a wall, and it gives nothing.
        return this.hazard(item, { lo: item.lo, hi: item.hi }, "Nobody got past the crate.");
      case "barrel":
        // A barrel that was not shot costs runners as spikes do.
        return this.hazard(item, { lo: item.lo, hi: item.hi }, "Nobody got past the barrel.");
      case "squad": return this.trade(item);
      case "bridge": return this.enterBridge(item, piece.length);
      default:
        return this.hazard(item, Hazard.span(piece, this.time), "Nobody made it past the hazard.");
    }
  }

  private takeGate(item: Item, piece: Extract<Piece, { kind: "gates" }>) {
    const leftSide = this.anchorX < Gates.divider(piece, this.time);
    const op = leftSide ? piece.left : piece.right;
    const before = this.crowd.count;
    if (op.kind === "rate" || op.kind === "range") {
      const after = GateOp.applyTo(op, { count: before, rate: this.rate, range: this.range });
      this.rate = after.rate;
      this.range = after.range;
    } else {
      this.crowd.setCount(GateOp.apply(op, before));
    }
    item.tookLeft = leftSide;
    item.endedAt = this.time;
    if (this.loud) {
      const good = GateOp.isGood(op);
      this.emit({ type: "haptic", name: good ? "tap" : "thud" });
      this.emit({ type: "sound", name: good ? "gateGood" : "gateBad" });
      const name = op.kind === "rate" ? "gateRate" : op.kind === "range" ? "gateRange" : "gate";
      this.emit({ type: "fx", name, ...this.crowdPoint(), n: name === "gate" ? this.crowd.count - before : op.n });
      this.pops(this.crowd.count - before);
    }
    if (this.crowd.count === 0) this.lose("The gate wiped out the crowd.");
  }

  /// The runners whose places lie in a span are lost.
  private hazard(item: Item, span: Span, wiped: string) {
    const killed = this.crowd.kill(span);
    if (killed > 0 && this.loud) {
      this.emit({ type: "haptic", name: "thud" });
      this.emit({ type: "sound", name: "hit" });
      this.emit({ type: "fx", name: item.kind === "hammer" ? "hammerHit" : "hazard", ...this.crowdPoint(), n: -killed });
      this.pops(killed);
    }
    if (this.crowd.count === 0) this.lose(wiped);
  }

  /// The crowd met a squad that pellets did not clear. The two sides trade: the crowd loses the
  /// rivals that are left divided by member power, rounded up, and the squad is gone. A crowd
  /// that passes beside the squad trades nothing.
  private trade(item: Item) {
    const r = this.crowd.radius;
    if (!(item.lo < this.anchorX + r && item.hi > this.anchorX - r)) return;
    const loss = Math.min(this.crowd.count, Math.ceil(item.shown / this.power));
    item.live = false;
    item.ended = "traded";
    item.endedAt = this.time;
    this.crowd.setCount(this.crowd.count - loss);
    if (this.loud) {
      this.emit({ type: "haptic", name: "thud" });
      this.emit({ type: "sound", name: "hit" });
      this.emit({ type: "fx", name: "squadTrade", ...this.crowdPoint(), n: -loss });
      this.pops(loss);
    }
    if (this.crowd.count === 0) this.lose("The squad was bigger.");
  }

  /// The road narrows to its middle third. Runners whose places are outside it fall, and until
  /// the bridge ends the crowd cannot be steered off it.
  private enterBridge(item: Item, length: number) {
    const fell = this.crowd.kill({ lo: -BRIDGE_HALF, hi: BRIDGE_HALF }, true, true);
    this.onBridge = true;
    this.bridgeEnd = item.z + length;
    this.steer(this.targetX);
    if (this.view) this.crowd.squeezeToward(Math.min(1, (BRIDGE_HALF - 0.03) / Math.max(0.01, this.crowd.radius)));
    if (fell > 0 && this.loud) {
      this.emit({ type: "haptic", name: "thud" });
      this.emit({ type: "sound", name: "hit" });
      this.emit({ type: "fx", name: "bridgeFall", ...this.crowdPoint(), n: -fell });
      this.pops(fell);
    }
    if (this.crowd.count === 0) this.lose("Everybody fell off the bridge.");
  }

  private leaveBridge() {
    this.onBridge = false;
    if (this.view) this.crowd.squeezeToward(1);
  }

  // MARK: the finale

  /// The last stretch. A boss warns of its slam and lands it. Then the finale comes at the
  /// crowd, and the fight starts when the two meet.
  private approach(front: number, dt: number) {
    const slam = this.slam;
    if (slam) {
      if (slam.stage === "waiting" && this.finaleAt - front <= CHARGE_GAP + this.track.speed * SLAM_TELEGRAPH) {
        slam.stage = "warned";
        slam.warnedAt = this.time;
        slam.landsAt = this.time + SLAM_TELEGRAPH;
        if (this.loud) {
          this.emit({ type: "sound", name: "bossRoar" });
          this.emit({ type: "haptic", name: "tap" });
          this.emit({ type: "fx", name: "slamWarn", ...Projection.point(slam.side * 0.5, ANCHOR) });
        }
      } else if (slam.stage === "warned" && this.time >= slam.landsAt - 1e-9) {
        slam.stage = "landed";
        // Runners on that half of the road when it lands are lost. The middle line is on neither half.
        const killed = this.crowd.kill(halfRoad(slam.side));
        if (this.loud) {
          this.emit({ type: "haptic", name: "slam" });
          this.emit({ type: "sound", name: "boulderLand" });
          this.emit({ type: "fx", name: "slam", ...Projection.point(slam.side * 0.5, ANCHOR + 1), n: -killed });
          this.pops(killed);
        }
        if (this.crowd.count === 0) { this.lose("The slam took everyone."); return; }
      }
    }
    if (!this.charging && (slam === null || slam.stage === "landed") && this.finaleAt - front <= CHARGE_GAP) this.charging = true;
    if (this.charging) this.finaleAt -= CHARGE_SPEED * dt;
    if (this.finaleAt - front <= FIGHT_DISTANCE) this.startFight();
  }

  private startFight() {
    if (this.probe) {
      // A probe stops here: how big the crowd is, and what its pellets did, is what was asked.
      this.outcome = { won: true, stars: 0, coins: 0, score: this.crowd.count };
      return;
    }
    this.fighting = true;
    this.fightClock = 0;
    this.shooting = null;
    this.shootingFinale = false;
    this.rivals = this.rivalsShown;
    this.clash = new FinaleFight(this.crowd.count, this.rivals, this.power);
    // The crowd hits the boss from the first tick of the fight to the last.
    this.setBossClip("clawd_boss_hit");
    if (!this.loud) return;
    this.emit({ type: "haptic", name: "slam" });
    this.emit({ type: "sound", name: "hit" });
    // The two sides meet a little up the road from the crowd.
    this.emit({ type: "fx", name: "finale", ...Projection.point(this.anchorX / 2, ANCHOR + 0.75) });
  }

  /// Where the middle of the player's crowd is on the canvas.
  private crowdPoint(): Vec {
    return Projection.point(this.anchorX, ANCHOR);
  }

  /// Where the middle of a piece is on the canvas, a little above the road.
  private itemPoint(item: Item): Vec {
    const z = item.z - this.travel, at = Projection.point((item.lo + item.hi) / 2, z);
    return { x: at.x, y: at.y + 22 * Projection.scale(z) };
  }

  private setBossClip(clip: BossState["clip"]) {
    if (!this.boss) return;
    this.boss.clip = clip;
    this.emit({ type: "mood", who: this.boss, clip });
  }

  /// A pop for each runner gained or lost, six at most, 0.05 s apart. A new burst replaces one still playing.
  private pops(change: number) {
    const count = Math.min(Math.abs(change), 6);
    if (count <= 0) return;
    this.popsLeft = count;
    this.nextPop = this.time;
  }

  /// Attrition, a tick every 0.05 s (see FinaleFight). Whoever is larger after member strength wins.
  private fight(dt: number) {
    if (this.enemy) {
      this.enemy.anchorZ = Math.max(ANCHOR + 1.2, this.enemy.anchorZ - 8 * dt);
    }
    this.fightClock += dt;
    while (this.fightClock >= 0.05 && !this.finished && this.clash) {
      this.fightClock -= 0.05;
      const state = this.clash;
      const outcome = state.tick();
      this.rivals = state.theirs;
      this.crowd.setCount(state.mine);
      this.enemy?.setCount(this.rivals);
      if (this.boss) this.boss.bar = this.rivals / Math.max(1, this.finaleMax);
      if (this.loud) {
        this.emit({ type: "haptic", name: "tap" });
        // Runners popping against a crowd; blows landing on a boss.
        this.emit({ type: "sound", name: this.boss === null ? "pop" : "hit" });
      }
      if (outcome.type === "won") {
        if (this.boss && this.loud) {
          const z = this.boss.z, at = Projection.point(0, z);
          this.emit({ type: "fx", name: "bossDown", x: at.x, y: at.y + 40 * Projection.scale(z) });
        }
        this.win(outcome.survivors);
      } else if (outcome.type === "lost") {
        this.lose(outcome.lastRunner ? "It came down to the last runner." : this.boss === null ? "Their crowd was bigger." : "The boss was too much.");
      }
    }
  }

  private win(alive: number) {
    // Stars measure the run against the skilled bot's run on this track at these upgrades, so a
    // clean run is three stars at any upgrade level.
    const share = alive / Math.max(1, this.par);
    const stars = share >= THREE_STARS ? 3 : share >= TWO_STARS ? 2 : 1;
    const coins = this.economy.coins(this.level, stars, this.found);
    this.outcome = { won: true, stars, coins, score: alive };
    if (this.loud) {
      this.emit({ type: "haptic", name: "success" });
      this.emit({ type: "sound", name: "win" });
      this.emit({ type: "fx", name: "win", ...this.crowdPoint() });
      // The coins land after the fanfare, as the result card shows them.
      this.clock.after(0.5, () => this.emit({ type: "sound", name: "coin" }));
    }
    if (this.view) this.pushHUD();
  }

  private lose(reason: string) {
    this.setBossClip("clawd_boss_idle");
    // Coins found in crates are kept, win or lose.
    const coins = this.economy.consolation(this.found);
    this.outcome = coins > 0 ? { won: false, reason, coins } : { won: false, reason };
    if (this.loud) {
      this.emit({ type: "haptic", name: "failure" });
      this.emit({ type: "sound", name: "lose" });
    }
    if (this.view) this.pushHUD();
  }

  // MARK: layout

  /// Where everything on the road is this frame, for the draw layer. It also announces the boss
  /// the moment it comes over the horizon, and each landing of a hammer that is in sight.
  private layoutTrack() {
    const far = Projection.farZ;
    for (let i = 0; i < STRIPES; i++) {
      let z = (i * 4 - this.travel) % far;
      if (z < 0) z += far;
      this.stripes[i] = z;
    }
    for (const item of this.items) {
      item.ahead = item.z - this.travel;
      // A bridge is on screen for as long as any of it is.
      const tail = item.piece.kind === "bridge" ? item.piece.length : 0;
      item.visible = item.ahead + tail > -3 && item.ahead < far;
      if (item.visible && item.piece.kind === "hammer" && this.loud && !this.finished) this.hammerCue(item, item.piece);
    }
    if (this.enemy) {
      if (!this.fighting) this.enemy.anchorZ = this.finaleAt - this.travel;
      const p = Projection.point(0, this.enemy.anchorZ);
      this.enemyLabel.position = { x: p.x, y: p.y + 30 + 40 * Projection.scale(this.enemy.anchorZ) };
      this.enemyLabel.text = `×${this.rivalsShown}`;
      this.enemyLabel.hidden = this.enemy.anchorZ > far || this.rivalsShown === 0;
    }
    if (this.boss) {
      const z = this.fighting ? ANCHOR + 1.5 : this.finaleAt - this.travel;
      const s = Projection.scale(z);
      const p = Projection.point(0, z);
      this.boss.z = z;
      this.boss.visible = !(z > far);
      if (this.boss.visible && !this.bossAnnounced) {
        this.bossAnnounced = true;
        this.emit({ type: "sound", name: "bossRoar" });
      }
      this.enemyLabel.position = { x: p.x, y: p.y + 104 * s + 6 };
      this.enemyLabel.text = `HP ${this.rivalsShown}`;
      this.enemyLabel.hidden = !this.boss.visible;
    }
    const anchor = Projection.point(this.anchorX, ANCHOR);
    // A boss fights from just up the road, where the count would sit on its face; it drops below then.
    const countY = this.fighting && this.boss !== null ? anchor.y - 30 : anchor.y + 34 + this.crowd.radius * 90;
    this.countLabel.position = { x: anchor.x, y: countY };
    this.countLabel.text = `×${this.crowd.count}`;
  }

  /// A hammer in sight lands with a thud each time it changes sides.
  private hammerCue(item: Item, piece: Extract<Piece, { kind: "hammer" }>) {
    const beats = Hammer.beats(piece, this.time), seen = this.hammerBeats.get(item);
    this.hammerBeats.set(item, beats);
    if (seen === undefined || seen === beats || item.ahead < ANCHOR) return;
    const at = Projection.point(Hammer.side(piece, this.time) * 0.5, item.ahead);
    this.emit({ type: "sound", name: "boulderLand" });
    this.emit({ type: "fx", name: "hammer", x: at.x, y: at.y, n: Projection.scale(item.ahead) });
  }

  private pushHUD() {
    const progress = Math.min(1, this.travel / this.finaleZ);
    let readout = `crowd ×${this.crowd.count}`;
    if (this.fighting) readout += `   vs ${this.rivalsShown}`;
    else readout += `   fire ${Math.round(this.rate * 100)}%   range ${this.range}`;
    const key = readout + String(Math.trunc(progress * 1000));
    if (key === this.lastHUD) return;
    this.lastHUD = key;
    this.hud = { title: `Run ${this.level + 1}, ${this.world.name}`, readout, progress };
  }
}
