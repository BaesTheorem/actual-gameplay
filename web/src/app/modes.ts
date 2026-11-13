// The games as the shell sees them: the table of modes, the levels and chapters the asset build
// bundled, the measured difficulty of each level, and how a mode builds a scene. The shell asks
// everything about a mode through here and never names one itself, so a new level mode is one
// row in modetable.ts and one branch in sceneCode below.
import bundledLevels from "../generated/levels.json";
import bundledStats from "../generated/stats.json";
import type { Cue } from "../sim/clock";
import { RunnerEconomy } from "../sim/runner/economy";
import type { PinLevel } from "../sim/pinpull";
import type { DogLevel } from "../sim/savedog/level";
import type { Scene } from "../scenes/kit";
import { labelOf, playOrder, type Chapter } from "./chapters";
import { MODES, mode as findMode, type ModeInfo } from "./modetable";
import type { LevelStat } from "./odds";
import { store } from "./store";

export { MODES, mode, type LevelMode, type ModeInfo } from "./modetable";
export type { Chapter } from "./chapters";

/// What every level file has, whatever its mode.
interface LevelData { id: string; name: string; decor?: { sprite: string }[] }
interface LevelSet { chapters: Chapter[]; levels: LevelData[] }

const sets = bundledLevels as unknown as Record<string, LevelSet>;
const stats = bundledStats as unknown as Record<string, LevelStat>;

const levelSet = (id: string): LevelSet | undefined => {
  const m = findMode(id);
  return m?.kind === "levels" ? sets[m.folder] : undefined;
};
const findLevel = (id: string, levelId: string): LevelData | undefined => levelSet(id)?.levels.find((level) => level.id === levelId);

/// A mode's chapters in play order. Empty for a mode without levels.
export const chapters = (id: string): Chapter[] => levelSet(id)?.chapters ?? [];
/// Every level id of a mode, first to last.
export const levelIDs = (id: string): string[] => playOrder(chapters(id));
/// The label a player sees for a level, such as "1-3": its chapter and its place in it.
export const levelLabel = (id: string, levelId: string): string => labelOf(chapters(id), levelId);
export const levelName = (id: string, levelId: string): string => findLevel(id, levelId)?.name ?? "";
/// The level after this one in play order, or null after the last.
export const nextLevel = (id: string, levelId: string): string | null => {
  const ids = levelIDs(id), at = ids.indexOf(levelId);
  return at >= 0 && at + 1 < ids.length ? ids[at + 1] : null;
};
/// The measured share of random play that wins a level, when the level has been measured.
export const levelStat = (id: string, levelId: string): LevelStat | undefined => stats[`${id}/${levelId}`];

type OnCue = (cue: Cue) => void;
/// A mode's scene code: the art every level of it uses, and how one level becomes a scene.
/// `level` is the level file's data, or the run number for the endless mode.
interface SceneCode { art: string[]; make: (level: unknown, label: string, onCue: OnCue) => Scene }

/// Load a mode's scene code. This is the one place that knows which scene belongs to which mode.
const sceneCode = async (id: string): Promise<SceneCode> => {
  if (id === "pinPull") {
    const m = await import("../scenes/pin");
    return { art: m.PIN_ART, make: (level, label, onCue) => new m.PinScene(level as PinLevel, label, onCue) };
  }
  if (id === "saveDog") {
    const m = await import("../scenes/dog");
    return { art: m.DOG_ART, make: (level, label, onCue) => new m.DogScene(level as DogLevel, label, onCue) };
  }
  if (id === "runner") {
    const m = await import("../scenes/runner");
    // The upgrades bought in the hub shape the run.
    return { art: m.RUNNER_ART, make: (run, _label, onCue) => new m.RunnerScene(run as number, new RunnerEconomy(store.progress.runner.upgrades), onCue) };
  }
  throw new Error(`no scene for mode "${id}"`);
};

/// Get a mode ready before a level is picked: its code, and its art decoded. Art from another
/// mode is let go first.
let warmed: string | null = null;
export const warm = async (id: string) => {
  const [art, code] = await Promise.all([import("./art"), sceneCode(id)]);
  // Only on a change of mode: within one, a level's own decor stays loaded for the next level.
  if (warmed !== id) await art.release(code.art);
  warmed = id;
  await art.load(code.art);
};

/// Bring every mode's files into the cache while the home screen sits idle. Nothing is decoded.
export const prefetchAll = async () => {
  const art = await import("./art");
  for (const m of MODES) await art.prefetch((await sceneCode(m.id)).art);
};

/// Build the scene for a level. A mode's code and art load when it is first opened. For the
/// endless mode the level id is the run number, counted from 0. An id the mode does not have
/// gives null.
export const makeScene = async (id: string, levelId: string, onCue: OnCue): Promise<Scene | null> => {
  const m: ModeInfo | undefined = findMode(id);
  if (!m) return null;
  const art = await import("./art");
  await warm(id);
  const code = await sceneCode(id);
  if (m.kind === "runner") return code.make(Number(levelId), "", onCue);
  const level = findLevel(id, levelId);
  if (!level) return null;
  await art.load((level.decor ?? []).map((d) => d.sprite));
  return code.make(level, levelLabel(id, levelId), onCue);
};
