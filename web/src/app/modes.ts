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

/// Build the scene for a level. Each mode's code and art load when it is first opened.
export const makeScene = async (id: Mode, index: number, onCue: (cue: Cue) => void): Promise<Scene | null> => {
  const art = await import("./art");
  if (id === "pinPull") {
    const { PinScene, PIN_ART } = await import("../scenes/pin");
    const level = levels.pinpull[index];
    if (!level) return null;
    await art.load([...PIN_ART, ...(level.decor ?? []).map((d) => d.sprite)]);
    return new PinScene(level, index, onCue);
  }
  if (id === "saveDog") {
    const { DogScene, DOG_ART } = await import("../scenes/dog");
    const level = levels.savedog[index];
    if (!level) return null;
    await art.load([...DOG_ART, ...(level.decor ?? []).map((d) => d.sprite)]);
    return new DogScene(level, index, onCue);
  }
  if (id === "runner") {
    const { RunnerScene, RUNNER_ART } = await import("../scenes/runner");
    await art.load(RUNNER_ART);
    // `index` is the 0-based run. The upgrades bought in the hub shape the run.
    return new RunnerScene(index, new RunnerEconomy(store.progress.runner.upgrades), onCue);
  }
  return null;
};
