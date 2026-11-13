// What the tests of Save the Clawd's hazards share: a small level to build on and a way to play one.
// Every level here has grass from wall to wall with its top at y 74, so a Clawd standing on it has
// his middle at y 92 and a bar lying on it has its middle near y 80.
import type { Cue } from "../src/sim/clock";
import { DogSim, type DogLevel } from "../src/sim/savedog";
import { STEP, type Vec } from "../src/sim/sk";

export const GROUND = 74;
export const GRASS = { type: "rect", x: 0, y: 34, w: 402, h: 40, skin: "grass" };

/// Where Clawd stands when a test wants him in the middle, under the dome below.
export const MIDDLE = { id: "clawd", x: 201, y: GROUND + 18 };

/// A level with flat grass, a Clawd standing out of the way by the right wall, and one bee that
/// comes late, so that for nine seconds nothing happens but the level's own hazards. `parts` adds
/// to it or replaces what is here.
export const level = (parts: Partial<DogLevel>): DogLevel => ({
  id: "a-level", name: "A level", inkBudget: 600, stars: [300, 400],
  statics: [GRASS],
  dogs: [{ id: "clawd", x: 372, y: GROUND + 18 }],
  hives: [{ x: 30, y: 760, count: 1, delay: 9 }],
  ...parts,
});

/// A bar lying on the grass from x to x + length.
export const lying = (x: number, length: number): Vec[] => [{ x, y: GROUND + 6.3 }, { x: x + length, y: GROUND + 6.3 }];

/// A dome that stands over a Clawd at x 201 with room to spare.
export const DOME: Vec[] = [[150, 78], [152, 120], [170, 150], [201, 160], [232, 150], [250, 120], [252, 78]].map(([x, y]) => ({ x, y }));

export interface Run {
  sim: DogSim;
  /// The name of every moment the simulation reported, with the level time it came at.
  moments: { name: string; at: number }[];
  /// Every sound it asked for, by name.
  sounds: string[];
  /// The level time of the first moment with this name, or -1.
  when(name: string): number;
  count(name: string): number;
  reason: string | null;
  won: boolean;
}

/// Play a level with these strokes, the first at 0.3 s as the audit draws them, until it ends or
/// `seconds` of level time have passed. `each` is called after every frame. The bees are released
/// 1.5 s after the first stroke, so their clock reads 0 at level time 1.8 s.
export const play = (lvl: DogLevel, strokes: Vec[][], options: { seconds?: number; each?: (sim: DogSim) => void } = {}): Run => {
  const moments: Run["moments"] = [], sounds: string[] = [];
  const sim: DogSim = new DogSim(lvl, (cue: Cue) => {
    if (cue.type === "fx") moments.push({ name: cue.name, at: sim.elapsed });
    else if (cue.type === "sound") sounds.push(cue.name);
  });
  sim.replayStrokes(strokes);
  const frames = Math.round((options.seconds ?? 14) / STEP);
  for (let i = 0; i < frames && !sim.finished; i++) {
    sim.frame();
    options.each?.(sim);
  }
  const outcome = sim.outcome;
  return {
    sim, moments, sounds,
    when: (name) => moments.find((m) => m.name === name)?.at ?? -1,
    count: (name) => moments.filter((m) => m.name === name).length,
    reason: outcome && !outcome.won ? outcome.reason : null,
    won: outcome?.won === true,
  };
};

/// The level time at which the bees come out when the first stroke is drawn at 0.3 s.
export const RELEASE = 0.3 + 1.5;
