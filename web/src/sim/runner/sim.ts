// Crowd Run: steer a crowd down a road, pick the better gate, dodge what kills, storm the finish.
// Pure kinematics in lane space, with no drawing in it; the browser scene and the Node suite both step it.
import { Clock, type Emit } from "../clock";
import { STEP, type Outcome, type Vec } from "../sk";
import { Crowd } from "./crowd";
import { RunnerEconomy } from "./economy";
import { RunnerGenerator } from "./generator";
import { Projection } from "./projection";
import { SeededRNG } from "./rng";
import { FinaleFight, GateOp, Hazard, finaleStrength, type GatePair, type Obstacle, type Track } from "./track";

/// How the autopilot steers. Greedy is the reference player; the others exist so the audit
/// can ask whether steering matters at all.
export type SteerPolicy = "greedy" | "straight" | "left" | "random";

/// Crowd runners, in clip-frame points at depth scale 1.
export const RUNNER_HEIGHT = 40;

/// One gate pair on the road. `z` is its depth ahead of the camera now.
export interface GateState {
  pair: GatePair;
  consumed: boolean;
  /// Which panel the crowd took, and when. The taken panel flashes and both fade over 0.3 s.
  tookLeft: boolean | null;
  consumedAt: number | null;
  z: number;
  visible: boolean;
}

/// One hazard on the road, with the lane it covers at this moment.
export interface ObstacleState {
  obstacle: Obstacle;
  resolved: boolean;
  z: number;
  visible: boolean;
  /// Middle of the deadly span in lane units, and its width in screen points at this depth.
  center: number;
  widthPoints: number;
}

export interface BossState {
  z: number;
  visible: boolean;
  /// The painted clip the boss plays: idle on the way in, hit for the whole fight.
  clip: "clawd_boss_idle" | "clawd_boss_hit";
  /// Health left as a share of the health it started with.
  bar: number;
}

export interface Label { text: string; position: Vec; hidden: boolean }
export interface HUD { title: string; readout: string; progress: number }

const STRIPES = 10;

export class RunnerSim {
  readonly track: Track;
  readonly clock = new Clock();
  readonly crowd: Crowd;
  /// The rival crowd of a crowd finale, null when the finale is a boss.
  readonly enemy: Crowd | null = null;
  readonly boss: BossState | null = null;
  readonly gates: GateState[] = [];
  readonly obstacles: ObstacleState[] = [];
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
  enemyStrength: number;
  fighting = false;
  policy: SteerPolicy = "greedy";
  autopilot = false;
  /// Under reduced motion the runners squash half as much.
  reducedMotion = false;

  private drag: { touchX: number; anchorX: number } | null = null;
  private clash: FinaleFight | null = null;
  private fightClock = 0;
  private lastHUD = "";
  private bossAnnounced = false;
  private randomPicks = new Map<GateState, number>();
  private rng = new SeededRNG(7);
  private popsLeft = 0;
  private nextPop = 0;

  constructor(readonly level: number, readonly economy: RunnerEconomy = RunnerEconomy.base, private emit: Emit = () => {}) {
    this.track = RunnerGenerator.makeTrack(level, economy.startCrowd);
    for (const segment of this.track.segments) {
      if (segment.type === "gates") {
        this.gates.push({ pair: segment.pair, consumed: false, tookLeft: null, consumedAt: null, z: segment.pair.z, visible: false });
      } else {
        this.obstacles.push({ obstacle: segment.obstacle, resolved: false, z: segment.obstacle.z, visible: false, center: 0, widthPoints: 0 });
      }
    }
    this.crowd = new Crowd(this.track.startCrowd, Projection.anchorZ);
    this.enemyStrength = finaleStrength(this.track.finale);
    if (this.track.finale.type === "crowd") {
      // The rivals are mirrored so the two crowds face each other.
      this.enemy = new Crowd(this.track.finale.count, this.track.finaleZ + 4, -1);
    } else {
      this.boss = { z: this.track.finaleZ, visible: false, clip: "clawd_boss_idle", bar: 1 };
    }
    this.layoutTrack();
    this.pushHUD();
  }

  get finished() { return this.outcome !== null; }
  /// Simulated seconds since the run began.
  get elapsed() { return this.time; }
  get levelID() { return String(this.level + 1).padStart(2, "0"); }
  get levelName() { return `Run ${this.level + 1}`; }
  /// How long an autopilot run may take before the suite gives up on it.
  get replayWait() { return this.track.finaleZ / this.track.speed + 14; }
  /// True when the rival crowd is too far up the road to draw.
  get enemyHidden() { return this.enemy !== null && this.enemy.anchorZ > Projection.farZ; }

  /// Human wording for the score a win carries.
  static describe(score: number | null | undefined): string { return `survivors ${Math.round(score ?? 0)}`; }

  // MARK: input

  /// Hand the steering to the greedy autopilot.
  startReplay() { this.autopilot = true; }

  configure(policy: SteerPolicy) {
    this.policy = policy;
    this.autopilot = true;
  }

  /// A finger went down at canvas x. The drag steers relative to where the crowd was then.
  dragBegan(x: number) {
    if (this.finished) return;
    this.drag = { touchX: x, anchorX: this.anchorX };
  }

  dragMoved(x: number) {
    if (!this.drag) return;
    const dx = x - this.drag.touchX;
    this.steer(this.drag.anchorX + dx / Projection.laneWidth(Projection.anchorZ));
  }

  dragEnded() { this.drag = null; }

  /// Set where the crowd heads, in lane units. The road's last 0.15 on each side is out of reach.
  steer(targetX: number) {
    this.targetX = Math.min(0.85, Math.max(-0.85, targetX));
  }

  // MARK: simulation

  /// One frame: game logic, then the timers and the pop sounds queued by it.
  frame(dt = STEP) {
    this.tick(dt);
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
      if (this.autopilot) this.targetX = this.autopilotTarget();
      this.anchorX += (this.targetX - this.anchorX) * Math.min(1, 12 * dt);
      this.crossGates();
      this.crossObstacles();
      if (this.track.finaleZ - this.travel <= Projection.anchorZ + 2.5) this.startFight();
    } else {
      this.fight(dt);
    }
    const wobble = this.reducedMotion ? 0.03 : 0.06;
    this.crowd.anchorX = this.anchorX;
    this.crowd.update(dt, this.time, wobble);
    this.enemy?.update(dt, this.time, wobble);
    this.layoutTrack();
    this.pushHUD();
  }

  private crossGates() {
    for (const gate of this.gates) {
      if (gate.consumed || gate.pair.z - this.travel > Projection.anchorZ) continue;
      const leftSide = this.anchorX < 0;
      const op = leftSide ? gate.pair.left : gate.pair.right;
      const before = this.crowd.count;
      this.crowd.setCount(GateOp.apply(op, this.crowd.count));
      gate.consumed = true;
      gate.tookLeft = leftSide;
      gate.consumedAt = this.time;
      const good = GateOp.isGood(op);
      this.emit({ type: "haptic", name: good ? "tap" : "thud" });
      this.emit({ type: "sound", name: good ? "gateGood" : "gateBad" });
      this.emit({ type: "fx", name: "gate", ...this.crowdPoint(), n: this.crowd.count - before });
      this.pops(this.crowd.count - before);
      if (this.crowd.count === 0) {
        this.lose("The gate wiped out the crowd.");
        return;
      }
    }
  }

  private crossObstacles() {
    for (const node of this.obstacles) {
      if (node.resolved || node.obstacle.z - this.travel > Projection.anchorZ) continue;
      node.resolved = true;
      const killed = this.crowd.kill(Hazard.span(node.obstacle.hazard, this.time));
      if (killed > 0) {
        this.emit({ type: "haptic", name: "thud" });
        this.emit({ type: "sound", name: "hit" });
        this.emit({ type: "fx", name: "hazard", ...this.crowdPoint(), n: -killed });
        this.pops(killed);
      }
      if (this.crowd.count === 0) {
        this.lose("Nobody made it past the hazard.");
        return;
      }
    }
  }

  private startFight() {
    this.fighting = true;
    this.fightClock = 0;
    this.clash = new FinaleFight(this.crowd.count, this.enemyStrength, this.economy.memberPower);
    // The crowd hits the boss from the first tick of the fight to the last.
    this.setBossClip("clawd_boss_hit");
    this.emit({ type: "haptic", name: "slam" });
    this.emit({ type: "sound", name: "hit" });
    // The two sides meet a little up the road from the crowd.
    this.emit({ type: "fx", name: "finale", ...Projection.point(this.anchorX / 2, Projection.anchorZ + 0.75) });
  }

  /// Where the middle of the player's crowd is on the canvas.
  private crowdPoint(): Vec {
    return Projection.point(this.anchorX, Projection.anchorZ);
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

  /// Attrition, a tick every 0.05 s (see FinaleFight). Whoever is larger after member strength
  /// wins, which is what the generator sized the finale for.
  private fight(dt: number) {
    if (this.enemy) {
      this.enemy.anchorZ = Math.max(Projection.anchorZ + 1.2, this.enemy.anchorZ - 8 * dt);
    }
    this.fightClock += dt;
    while (this.fightClock >= 0.05 && !this.finished && this.clash) {
      this.fightClock -= 0.05;
      const state = this.clash;
      const outcome = state.tick();
      this.enemyStrength = state.theirs;
      this.crowd.setCount(state.mine);
      this.enemy?.setCount(this.enemyStrength);
      if (this.boss) this.boss.bar = this.enemyStrength / Math.max(1, finaleStrength(this.track.finale));
      this.emit({ type: "haptic", name: "tap" });
      // Runners popping against a crowd; blows landing on a boss.
      this.emit({ type: "sound", name: this.boss === null ? "pop" : "hit" });
      if (outcome.type === "won") {
        this.win(outcome.survivors);
      } else if (outcome.type === "lost") {
        this.lose(outcome.lastRunner ? "It came down to the last runner." : this.boss === null ? "Their crowd was bigger." : "The boss was too much.");
      }
    }
  }

  private win(alive: number) {
    // Stars measure the run against the best a player with these upgrades could do: the
    // finale costs about strength / memberPower runners no matter how well you steer, so a
    // perfect run is three stars at any upgrade level.
    const fightCost = finaleStrength(this.track.finale) / this.economy.memberPower;
    const attainable = Math.max(1, this.track.bestPath - fightCost);
    const share = alive / attainable;
    const stars = share >= 0.85 ? 3 : share >= 0.5 ? 2 : 1;
    const coins = this.economy.coins(this.level, stars);
    this.emit({ type: "haptic", name: "success" });
    this.emit({ type: "sound", name: "win" });
    this.emit({ type: "fx", name: "win", ...this.crowdPoint() });
    // The coins land after the fanfare, as the result card shows them.
    this.clock.after(0.5, () => this.emit({ type: "sound", name: "coin" }));
    this.outcome = { won: true, stars, coins, score: alive };
    this.pushHUD();
  }

  private lose(reason: string) {
    this.setBossClip("clawd_boss_idle");
    this.emit({ type: "haptic", name: "failure" });
    this.emit({ type: "sound", name: "lose" });
    this.outcome = { won: false, reason };
    this.pushHUD();
  }

  // MARK: autopilot

  /// Steering for the replay suite and the demo: best gate, widest free lane.
  private autopilotTarget(): number {
    if (this.policy === "straight") return 0;
    const ahead = Projection.anchorZ - 0.5;
    let best: { z: number; target: number } | null = null;
    for (const gate of this.gates) {
      if (gate.consumed) continue;
      const z = gate.pair.z - this.travel;
      if (!(z > ahead && (best === null || z < best.z))) continue;
      let goLeft: boolean;
      if (this.policy === "left") {
        goLeft = true;
      } else if (this.policy === "random") {
        let pick = this.randomPicks.get(gate);
        if (pick === undefined) {
          pick = this.rng.unit() < 0.5 ? -0.5 : 0.5;
          this.randomPicks.set(gate, pick);
        }
        goLeft = pick < 0;
      } else {
        goLeft = GateOp.apply(gate.pair.left, this.crowd.count) >= GateOp.apply(gate.pair.right, this.crowd.count);
      }
      best = { z, target: goLeft ? -0.5 : 0.5 };
    }
    for (const node of this.obstacles) {
      if (node.resolved) continue;
      const z = node.obstacle.z - this.travel;
      if (!(z > ahead && (best === null || z < best.z))) continue;
      const eta = Math.max(0, (z - Projection.anchorZ) / this.track.speed);
      const span = Hazard.span(node.obstacle.hazard, this.time + eta);
      const radius = this.crowd.radius + 0.08;
      const leftRoom = span.lo - radius - -0.9;
      const rightRoom = 0.9 - (span.hi + radius);
      const target = leftRoom >= rightRoom
        ? Math.max(-0.85, (span.lo - radius - 0.9) / 2)
        : Math.min(0.85, (span.hi + radius + 0.9) / 2);
      best = { z, target };
    }
    return best?.target ?? 0;
  }

  // MARK: layout

  /// Where everything on the road is this frame, for the draw layer. It also announces the boss
  /// the moment it comes over the horizon.
  private layoutTrack() {
    const far = Projection.farZ;
    for (let i = 0; i < STRIPES; i++) {
      let z = (i * 4 - this.travel) % far;
      if (z < 0) z += far;
      this.stripes[i] = z;
    }
    for (const gate of this.gates) {
      gate.z = gate.pair.z - this.travel;
      gate.visible = gate.z > -3 && gate.z < far;
    }
    for (const node of this.obstacles) {
      node.z = node.obstacle.z - this.travel;
      node.visible = node.z > -3 && node.z < far;
      if (!node.visible) continue;
      const span = Hazard.span(node.obstacle.hazard, this.time);
      node.center = (span.lo + span.hi) / 2;
      node.widthPoints = (span.hi - span.lo) * Projection.laneWidth(node.z);
    }
    if (this.enemy) {
      if (!this.fighting) this.enemy.anchorZ = this.track.finaleZ + 4 - this.travel;
      const p = Projection.point(0, this.enemy.anchorZ);
      this.enemyLabel.position = { x: p.x, y: p.y + 30 + 40 * Projection.scale(this.enemy.anchorZ) };
      this.enemyLabel.text = `×${this.enemyStrength}`;
      this.enemyLabel.hidden = this.enemy.anchorZ > far;
    }
    if (this.boss) {
      const z = this.fighting ? Projection.anchorZ + 1.5 : this.track.finaleZ - this.travel;
      const s = Projection.scale(z);
      const p = Projection.point(0, z);
      this.boss.z = z;
      this.boss.visible = !(z > far);
      if (this.boss.visible && !this.bossAnnounced) {
        this.bossAnnounced = true;
        this.emit({ type: "sound", name: "bossRoar" });
      }
      this.enemyLabel.position = { x: p.x, y: p.y + 104 * s + 6 };
      this.enemyLabel.text = `HP ${this.enemyStrength}`;
      this.enemyLabel.hidden = !this.boss.visible;
    }
    const anchor = Projection.point(this.anchorX, Projection.anchorZ);
    // A boss fights from just up the road, where the count would sit on its face; it drops below then.
    const countY = this.fighting && this.boss !== null ? anchor.y - 30 : anchor.y + 34 + this.crowd.radius * 90;
    this.countLabel.position = { x: anchor.x, y: countY };
    this.countLabel.text = `×${this.crowd.count}`;
  }

  private pushHUD() {
    const progress = Math.min(1, this.travel / this.track.finaleZ);
    let readout = `crowd ×${this.crowd.count}`;
    if (this.fighting) readout += `   vs ${this.enemyStrength}`;
    const key = readout + String(Math.trunc(progress * 100));
    if (key === this.lastHUD) return;
    this.lastHUD = key;
    this.hud = { title: `Run ${this.level + 1}`, readout, progress };
  }
}

/// Play one run on autopilot until it ends or its time is up. The replay suite and the audit both use this.
export const playRun = (
  level: number, policy: SteerPolicy = "greedy", economy: RunnerEconomy = RunnerEconomy.base,
): { outcome: Outcome | null; seconds: number; sim: RunnerSim } => {
  const sim = new RunnerSim(level, economy);
  sim.configure(policy);
  const frames = Math.ceil((sim.replayWait + 2) / STEP);
  for (let i = 0; i < frames && !sim.finished; i++) sim.frame();
  return { outcome: sim.outcome, seconds: sim.elapsed, sim };
};
