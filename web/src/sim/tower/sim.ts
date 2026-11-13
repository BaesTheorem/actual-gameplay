// The play simulation for Number Tower, which the renderer drives. Entering a room resolves the
// rules at once (power, keys, cleared and turn are final the moment enter returns) and queues
// beats. frame() plays the beats one after another; shownPower and shownKeys say what to draw at
// this instant, busy is true until the queue is empty, and outcome is set when the last beat ends.
import { Clock, type Emit } from "../clock";
import type { Outcome } from "../sk";
import type { Room, Thing, TowerLevel } from "./level";
import {
  enter, options, startState, starsFor, thingValue, type EnterResult, type Happening, type TowerState,
} from "./rules";
import { solve } from "./solver";

export type BeatKind = "walk" | "fight" | "gain" | "item" | "unlock" | "break" | "lose" | "win";

export interface Beat {
  kind: BeatKind;
  room: number;
  /// Which thing in the room, for fight, gain and item beats.
  thing?: number;
  /// The hero's number before and after this beat.
  from?: number;
  to?: number;
  seconds: number;
  /// For a gain beat, which operation it was.
  op?: "plus" | "times" | "minus" | "halve" | "mirror";
  /// For a fight beat, the other number and whether the hero won.
  n?: number;
  won?: boolean;
  /// For a lose beat, the sentence that says why.
  reason?: string;
}

/// How long each beat lasts, in seconds.
export const BEAT_SECONDS = {
  walk: 0.45,
  fight: 0.6,
  gain: 0.4,
  item: 0.35,
  unlock: 0.4,
  break: 0.7,
  lose: 0.9,
  win: 1.1,
} as const;

/// The pause before a replay enters its next room, once the last move has finished.
export const REPLAY_GAP = 0.15;

const SOUND: Record<BeatKind, string> = {
  walk: "step", fight: "hit", gain: "gain", item: "key", unlock: "unlock", break: "crack", lose: "lose", win: "win",
};
const HAPTIC: Partial<Record<BeatKind, string>> = {
  walk: "tap", fight: "thud", break: "thud", win: "success", lose: "failure",
};

export class TowerSim {
  power: number;
  keys = 0;
  cleared = new Set<number>();
  turn = 0;
  /// The room the hero stands in, or null while he is outside.
  at: number | null = null;
  outcome: Outcome | null = null;
  /// Beats still to play, the first one next.
  timeline: Beat[] = [];
  readonly clock = new Clock();

  private state: TowerState;
  private current: Beat | null = null;
  private beatTime = 0;
  private pending: Outcome | null = null;
  private shown: number;
  private shownKeysNow = 0;
  private replayQueue: number[] = [];
  private gap = 0;
  private bestCache: number | null;

  constructor(readonly level: TowerLevel, private emit: Emit = () => {}) {
    this.state = startState(level);
    this.power = level.start;
    this.shown = level.start;
    this.bestCache = level.best ?? null;
  }

  get busy() { return this.current !== null || this.timeline.length > 0; }
  get finished() { return this.outcome !== null; }

  /// The beat playing now, or null between beats and between moves.
  get beat(): Beat | null { return this.current; }
  /// How far the beat playing now has run, from 0 to 1. It is 0 when no beat is playing.
  get beatProgress(): number {
    return this.current ? Math.min(1, this.beatTime / this.current.seconds) : 0;
  }

  /// The best final number, from the level file or from the solver when the file has none.
  get best(): number {
    if (this.bestCache === null) this.bestCache = solve(this.level).best;
    return this.bestCache;
  }

  /// The number to draw now: the hero's number, counting up or down through the beat in progress.
  get shownPower(): number {
    const beat = this.current;
    if (!beat || beat.from === undefined || beat.to === undefined) return this.shown;
    const t = Math.min(1, this.beatTime / beat.seconds);
    return Math.round(beat.from + (beat.to - beat.from) * t);
  }

  get shownKeys() { return this.shownKeysNow; }

  /// The heads-up line, for example "power 12   keys 1   best 49".
  get readout(): string {
    return `power ${this.shownPower}   keys ${this.shownKeysNow}   best ${this.best}`;
  }

  /// The rooms the hero can enter now.
  options(): number[] {
    return this.outcome ? [] : options(this.level, this.state);
  }

  /// A grower's number now: its base plus its growth for every room entered so far.
  growerValue(room: number, thing = -1): number {
    const things = (this.level.rooms[room] as Room | null)?.things ?? [];
    const t: Thing | undefined = thing >= 0 ? things[thing] : things.find((x) => x.kind === "grower");
    return t ? thingValue(t, this.state.turn) : 0;
  }

  /// Enter a room. False when it is not an option or a move is still playing.
  enter(room: number): boolean {
    if (this.outcome || this.pending || this.busy) return false;
    if (!options(this.level, this.state).includes(room)) return false;
    const r = enter(this.level, this.state, room);
    this.queue(room, r);
    if (r.result === "loss") {
      this.pending = { won: false, reason: r.reason };
      if (r.events.some((e) => e.kind === "unlock")) this.keys -= 1;
      this.power = r.power;
      return true;
    }
    this.state = r.state;
    this.power = r.state.power;
    this.keys = r.state.keys;
    this.turn = r.state.turn;
    this.cleared.add(room);
    if (r.result === "win") {
      this.pending = { won: true, stars: starsFor(r.final, this.best), coins: 0, score: r.final };
    }
    return true;
  }

  /// Enter these rooms in order, each one when the last move has finished.
  replay(order: number[]) {
    this.replayQueue = [...order];
    this.gap = 0;
  }

  /// Advance by dt seconds.
  frame(dt: number) {
    this.clock.advance(dt);
    let left = dt;
    for (let guard = 0; guard < 1000; guard++) {
      if (!this.current) {
        const next = this.timeline.shift();
        if (next) this.begin(next);
        else if (this.pending) {
          this.outcome = this.pending;
          this.pending = null;
          this.replayQueue = [];
          break;
        } else if (this.replayQueue.length > 0 && !this.outcome) {
          if (this.gap > 0) {
            const wait = Math.min(this.gap, left);
            this.gap -= wait; left -= wait;
            if (this.gap > 0) break;
          }
          const room = this.replayQueue.shift() as number;
          if (!this.enter(room)) { this.replayQueue = []; break; }
          this.gap = REPLAY_GAP;
          continue;
        } else break;
      }
      const beat = this.current as Beat;
      const step = Math.min(left, beat.seconds - this.beatTime);
      this.beatTime += step;
      left -= step;
      if (this.beatTime >= beat.seconds) this.end(beat);
      else break;
    }
  }

  // MARK: beats

  private begin(beat: Beat) {
    this.current = beat;
    this.beatTime = 0;
    this.emit({ type: "sound", name: SOUND[beat.kind] });
    const haptic = HAPTIC[beat.kind];
    if (haptic) this.emit({ type: "haptic", name: haptic });
  }

  private end(beat: Beat) {
    this.current = null;
    this.beatTime = 0;
    if (beat.to !== undefined) this.shown = beat.to;
    if (beat.kind === "walk") this.at = beat.room;
    if (beat.kind === "item") this.shownKeysNow += 1;
    if (beat.kind === "unlock") this.shownKeysNow -= 1;
  }

  private queue(room: number, r: EnterResult) {
    const beats: Beat[] = [{ kind: "walk", room, seconds: BEAT_SECONDS.walk }];
    for (const e of r.events) beats.push(this.beatFor(room, e));
    if (r.result === "win") beats.push({ kind: "win", room, seconds: BEAT_SECONDS.win, from: r.final, to: r.final });
    if (r.result === "loss") {
      beats.push({ kind: "lose", room, seconds: BEAT_SECONDS.lose, reason: r.reason, from: r.power, to: r.power });
    }
    this.timeline.push(...beats);
  }

  private beatFor(room: number, e: Happening): Beat {
    switch (e.kind) {
      case "unlock": return { kind: "unlock", room, seconds: BEAT_SECONDS.unlock };
      case "break": return { kind: "break", room, seconds: BEAT_SECONDS.break, from: e.power, to: e.power };
      case "fight":
        return { kind: "fight", room, thing: e.thing, from: e.from, to: e.to, n: e.n, won: e.won, seconds: BEAT_SECONDS.fight };
      case "gain":
        return { kind: "gain", room, thing: e.thing, from: e.from, to: e.to, op: e.op, seconds: BEAT_SECONDS.gain };
      case "item": return { kind: "item", room, thing: e.thing, seconds: BEAT_SECONDS.item };
    }
  }
}

/// Play a level by entering a list of rooms with no waiting, for tests and scripts. The result is
/// the outcome once every beat has played.
export function playThrough(level: TowerLevel, order: number[], emit?: Emit): { sim: TowerSim; seconds: number } {
  const sim = new TowerSim(level, emit);
  sim.replay(order);
  let seconds = 0;
  while (!sim.outcome && seconds < 600) {
    sim.frame(1 / 30);
    seconds += 1 / 30;
    if (!sim.busy && sim.options().length === 0 && !sim.outcome) break;
  }
  return { sim, seconds };
}
