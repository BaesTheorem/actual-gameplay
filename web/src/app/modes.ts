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
import type { TowerLevel } from "../sim/tower/level";
import type { Scene } from "../scenes/kit";
import { labelOf, playOrder, type Chapter } from "./chapters";
import { dateWords } from "./daily";
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
/// Levels made while the game runs, such as a daily level, under "<mode>/<level id>": the level,
/// and the difficulty that was worked out for it when it was made.
const made = new Map<string, { level: LevelData; stat: LevelStat }>();

const levelSet = (id: string): LevelSet | undefined => {
  const m = findMode(id);
  return m?.kind === "levels" ? sets[m.folder] : undefined;
};
const findLevel = (id: string, levelId: string): LevelData | undefined =>
  made.get(`${id}/${levelId}`)?.level ?? levelSet(id)?.levels.find((level) => level.id === levelId);

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
export const levelStat = (id: string, levelId: string): LevelStat | undefined => made.get(`${id}/${levelId}`)?.stat ?? stats[`${id}/${levelId}`];

/// Make a mode's level for a date and return its id, ready for makeScene and levelStat. Nothing
/// about a daily level is in a file: it is generated from the date, so it is the same for
/// everyone that day, and it is solved here. The solver gives the best final number, the order
/// that reaches it, which is what a hint shows, and the exact share of random play that wins.
export const dailyLevel = async (id: string, date: string): Promise<string> => {
  const m = findMode(id);
  if (m?.kind !== "levels" || !m.daily || id !== "tower") throw new Error(`no daily level for mode "${id}"`);
  const tower = await import("../sim/tower");
  const level = tower.daily(date), solved = tower.solve(level);
  const ready = { ...level, id: level.id ?? `daily-${date}`, name: `${m.daily.title}, ${dateWords(date)}`, best: solved.best, solution: solved.bestOrder };
  made.set(`${id}/${ready.id}`, { level: ready, stat: { randomWin: solved.randomWin, sample: solved.states, exact: true } });
  return ready.id;
};

/// The lab: a level file that is in no chapter, looked at in the real game. A level id that
/// starts with "~" names a file, public/lab/<mode folder>/<name>.json, which is fetched from the
/// site each time it is opened. It has no label, no measured number and no place in play order,
/// and nothing about it is saved. Any mode with levels can be looked at this way.
export const isLab = (levelId: string): boolean => levelId.startsWith("~");
export const labName = (levelId: string): string => levelId.slice(1);
const labLevel = async (folder: string, levelId: string): Promise<LevelData | undefined> => {
  // Only a plain file name: the route is typed by hand, and it must not reach outside the lab.
  if (!/^[a-z0-9-]+$/.test(labName(levelId))) return undefined;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}lab/${folder}/${labName(levelId)}.json`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as LevelData) : undefined;
  } catch {
    return undefined;
  }
};

type OnCue = (cue: Cue) => void;
/// A mode's scene code: the art every level of it uses, and how one level becomes a scene.
/// `level` is the level file's data, or the run number for the endless mode. `artFor` names the
/// art one level needs on top of the mode's, for a mode whose levels do not all use the same pieces.
interface SceneCode { art: string[]; artFor?: (level: unknown) => string[]; make: (level: unknown, label: string, onCue: OnCue) => Scene }

/// Load a mode's scene code. This is the one place that knows which scene belongs to which mode.
const sceneCode = async (id: string): Promise<SceneCode> => {
  if (id === "pinPull") {
    const m = await import("../scenes/pin");
    return { art: m.PIN_ART, artFor: (level) => m.pinArt(level as PinLevel), make: (level, label, onCue) => new m.PinScene(level as PinLevel, label, onCue) };
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
  if (id === "tower") {
    const [m, tower] = await Promise.all([import("../scenes/tower"), import("../sim/tower")]);
    // The pieces each campaign level is the first to show, which that level explains. A level
    // from outside the campaign, such as the daily one, explains nothing.
    const campaign = (levelSet(id)?.levels ?? []) as unknown as TowerLevel[];
    const fresh = tower.firstAppearances(campaign);
    return {
      art: m.TOWER_ART,
      make: (level, label, onCue) => new m.TowerScene(level as TowerLevel, label, onCue, fresh[campaign.indexOf(level as TowerLevel)] ?? []),
    };
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
  for (const m of MODES) {
    const code = await sceneCode(m.id);
    // With the mode's own art goes whatever its levels ask for on top of it.
    await art.prefetch([...code.art, ...(levelSet(m.id)?.levels ?? []).flatMap((level) => code.artFor?.(level) ?? [])]);
  }
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
  const level = isLab(levelId) ? await labLevel(m.folder, levelId) : findLevel(id, levelId);
  if (!level) return null;
  await art.load([...(level.decor ?? []).map((d) => d.sprite), ...(code.artFor?.(level) ?? [])]);
  return code.make(level, levelLabel(id, levelId), onCue);
};
