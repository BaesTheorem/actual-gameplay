// What the tests of the walking rules share: a small level to build on and a way to play one.
// Every level here has the standard frame, so its floor's top is at y 68 and the room runs from
// x 38 to x 364. A hero standing on that floor has his middle at y 84, the gem at y 79.
import type { Cue } from "../src/sim/clock";
import { PinSim, type PinLevel, type Rect } from "../src/sim/pinpull";
import { STEP } from "../src/sim/sk";

export const FLOOR = 68;

/// A level under the walking rules. `parts` adds to it or replaces what is here.
export const level = (parts: Partial<PinLevel>): PinLevel =>
  ({ id: "a-level", name: "A level", rules: 2, parPins: 1, winWhen: "treasureReachesHero", pins: [], actors: {}, ...parts });

/// A pin stood on end on the floor at x, to be a door: 40 points tall, and it slides up and out.
export const doorPin = (id: string, x: number, group?: string) =>
  ({ id, x: x - 20, y: FLOOR + 13, w: 40, side: "right", angle: 90, ...(group ? { group } : {}) });

/// A cup that holds a pool at height y between x and x + w: two walls, and the pin `id` under it.
export const cup = (id: string, x: number, y: number, w: number): { walls: Rect[]; pin: PinLevel["pins"][number]; inside: Rect } => ({
  walls: [{ x: x - 14, y, w: 14, h: 50 }, { x: x + w, y, w: 14, h: 50 }],
  pin: { id, x, y, w, side: "right" },
  inside: { x: x + 2, y: y + 14, w: w - 4, h: 30 },
});

export interface Run {
  sim: PinSim;
  /// The name of every moment the simulation reported, with the game time it came at.
  moments: { name: string; at: number }[];
  /// The time of the first moment with this name, or -1.
  when(name: string): number;
  reason: string | null;
  won: boolean;
}

/// Play a level with these pulls, by the replay's own timing, until it ends or `seconds` of game
/// time have passed. `each` is called after every frame.
export const play = (lvl: PinLevel, pins: string[] = [], options: { seconds?: number; each?: (sim: PinSim) => void } = {}): Run => {
  const moments: Run["moments"] = [];
  const sim: PinSim = new PinSim(lvl, (cue: Cue) => { if (cue.type === "fx") moments.push({ name: cue.name, at: sim.elapsed }); });
  sim.replay(pins);
  const frames = Math.ceil((options.seconds ?? 60) / STEP);
  for (let i = 0; i < frames && !sim.finished; i++) {
    sim.frame();
    options.each?.(sim);
  }
  const outcome = sim.outcome;
  return {
    sim, moments,
    when: (name) => moments.find((m) => m.name === name)?.at ?? -1,
    reason: outcome && !outcome.won ? outcome.reason : null,
    won: outcome?.won === true,
  };
};

/// A flat slab whose top face runs from one point to another, for a slope to walk or roll on.
export const ramp = (x1: number, y1: number, x2: number, y2: number, t = 14) => {
  const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
  // The slab is drawn by its middle line, which lies half its thickness under the face.
  let nx = (dy / length) * (t / 2), ny = (-dx / length) * (t / 2);
  if (ny > 0) { nx = -nx; ny = -ny; }
  return { x1: x1 + nx, y1: y1 + ny, x2: x2 + nx, y2: y2 + ny, t };
};
