// The three games: their names, their look on the home screen, and how each builds a scene.
import levelData from "../generated/levels.json";
import type { Cue } from "../sim/clock";
import { RunnerEconomy } from "../sim/runner/economy";
import type { PinLevel } from "../sim/pinpull";
import type { DogLevel } from "../sim/savedog/level";
import type { Scene } from "../scenes/kit";
import type { Track } from "./audio";
import { store, type Mode } from "./store";

export interface ModeInfo {
  id: Mode;
  title: string;
  blurb: string;
  accent: string;
  /// The painted Clawd on the home card: a clip and the frame of it to show (frame 0 is often mid-blink).
  preview: [string, number];
  swatch: string;
  track: Track;
  paper: string;
  scoreLabel: string;
}

export const MODES: ModeInfo[] = [
  { id: "saveDog", title: "Save the Clawd", blurb: "Draw a shield. Then the bees come.", accent: "var(--sky)",
    preview: ["clawd_nervous", 3], swatch: "ui_button_sky", track: "saveDog", paper: "paper", scoreLabel: "ink used" },
  { id: "pinPull", title: "Pull the Pin", blurb: "Lava up top, hero down below. Mind the order.", accent: "var(--clay)",
    preview: ["clawd_hard_idle", 4], swatch: "ui_button_ink", track: "pinPull", paper: "paper_cave", scoreLabel: "pins pulled" },
  { id: "runner", title: "Crowd Run", blurb: "Pick gates, grow the crowd, storm the finish.", accent: "var(--sap)",
    preview: ["clawd_run", 3], swatch: "ui_button_sap", track: "runner", paper: "paper", scoreLabel: "survivors" },
];
export const mode = (id: string) => MODES.find((m) => m.id === id);

const levels = levelData as unknown as { savedog: DogLevel[]; pinpull: PinLevel[] };
export const levelCount = (id: Mode) => (id === "saveDog" ? levels.savedog.length : id === "pinPull" ? levels.pinpull.length : 0);
export const levelID = (id: Mode, index: number) =>
  (id === "saveDog" ? levels.savedog[index]?.id : levels.pinpull[index]?.id) ?? String(index + 1).padStart(2, "0");

/// A mode's scene code and the art every level of it uses.
const parts = async (id: Mode) => {
  if (id === "pinPull") { const m = await import("../scenes/pin"); return { art: m.PIN_ART, make: m }; }
  if (id === "saveDog") { const m = await import("../scenes/dog"); return { art: m.DOG_ART, make: m }; }
  const m = await import("../scenes/runner");
  return { art: m.RUNNER_ART, make: m };
};

/// Get a mode ready before a level is picked: its code, and its art decoded. Art from another
/// mode is let go first.
let warmed: Mode | null = null;
export const warm = async (id: Mode) => {
  const [art, mode] = await Promise.all([import("./art"), parts(id)]);
  // Only on a change of mode: within one, a level's own decor stays loaded for the next level.
  if (warmed !== id) await art.release(mode.art);
  warmed = id;
  await art.load(mode.art);
};

/// Bring every mode's files into the cache while the home screen sits idle. Nothing is decoded.
export const prefetchAll = async () => {
  const art = await import("./art");
  for (const id of ["pinPull", "saveDog", "runner"] as Mode[]) await art.prefetch((await parts(id)).art);
};

/// Build the scene for a level. A mode's code and art load when it is first opened.
export const makeScene = async (id: Mode, index: number, onCue: (cue: Cue) => void): Promise<Scene | null> => {
  const art = await import("./art");
  await warm(id);
  if (id === "pinPull") {
    const { PinScene } = await import("../scenes/pin");
    const level = levels.pinpull[index];
    if (!level) return null;
    await art.load((level.decor ?? []).map((d) => d.sprite));
    return new PinScene(level, index, onCue);
  }
  if (id === "saveDog") {
    const { DogScene } = await import("../scenes/dog");
    const level = levels.savedog[index];
    if (!level) return null;
    await art.load((level.decor ?? []).map((d) => d.sprite));
    return new DogScene(level, index, onCue);
  }
  if (id === "runner") {
    const { RunnerScene } = await import("../scenes/runner");
    // `index` is the 0-based run. The upgrades bought in the hub shape the run.
    return new RunnerScene(index, new RunnerEconomy(store.progress.runner.upgrades), onCue);
  }
  return null;
};
