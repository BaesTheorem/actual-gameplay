// Everything the game remembers, kept in localStorage. Results are filed by mode and then by the
// level's id, so a mode that is added later, or a level that moves to another chapter, needs no
// change here.
import { addDays } from "./daily";
import { V1_IDS } from "./v1ids";

export interface LevelResult { cleared: boolean; bestStars: number; bestScore?: number }
/// One day's result on a level that is made new each day: the most stars earned that day, and
/// the best number it ended on.
export interface DailyResult { stars: number; final: number }
export interface Progress {
  schemaVersion: number;
  /// Results by mode id, then by level id.
  levels: Record<string, Record<string, LevelResult>>;
  runner: { level: number; bestLevel: number; coins: number; upgrades: Record<string, number> };
  settings: { haptics: boolean; music: boolean; sound: boolean };
  /// Hints taken, by mode id and then level id. A level nobody took a hint on has no entry.
  hints?: Record<string, Record<string, number>>;
  /// The daily level's results, by mode id and then by the player's own date, "2026-11-13". Only
  /// a day that was cleared has an entry. A file from before there was a daily level has none.
  daily: Record<string, Record<string, DailyResult>>;
}

export const SCHEMA_VERSION = 2;
const KEY = "actual-gameplay/progress";
const fresh = (): Progress => ({
  schemaVersion: SCHEMA_VERSION, levels: {},
  runner: { level: 0, bestLevel: 0, coins: 0, upgrades: {} },
  settings: { haptics: true, music: true, sound: true },
  daily: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/// Version 1 kept one map of results per mode at the top of the file, keyed by the level's
/// two-digit number. Each result moves to the level's id; a number the table does not know is dropped.
const levelsFromV1 = (data: Record<string, unknown>): Progress["levels"] => {
  const levels: Progress["levels"] = {};
  for (const [mode, ids] of Object.entries(V1_IDS)) {
    const old = data[mode];
    if (!isRecord(old)) continue;
    for (const [number, result] of Object.entries(old)) {
      const id = ids[number];
      if (id && isRecord(result)) (levels[mode] ??= {})[id] = result as unknown as LevelResult;
    }
  }
  return levels;
};

/// The daily results in a stored file. Anything that is not a result is left out, so a damaged
/// entry costs that one day and nothing else.
const dailyFrom = (value: unknown): Progress["daily"] => {
  const daily: Progress["daily"] = {};
  if (!isRecord(value)) return daily;
  for (const [mode, byDate] of Object.entries(value)) {
    if (!isRecord(byDate)) continue;
    for (const [date, result] of Object.entries(byDate)) {
      if (!isRecord(result) || typeof result.stars !== "number" || typeof result.final !== "number") continue;
      (daily[mode] ??= {})[date] = { stars: result.stars, final: result.final };
    }
  }
  return daily;
};

/// Read a stored file of any version. Anything it leaves out is filled in, and a version 1 file
/// comes back as version 2 with its results under the new level ids. The daily results were added
/// to version 2 without a new version: a file without them reads as no days played.
export const decode = (raw: string | null): Progress => {
  const base = fresh();
  if (!raw) return base;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data)) return base;
    const version = typeof data.schemaVersion === "number" ? data.schemaVersion : 1;
    const levels = version < 2 ? levelsFromV1(data) : isRecord(data.levels) ? (data.levels as Progress["levels"]) : {};
    const progress: Progress = {
      schemaVersion: SCHEMA_VERSION,
      levels,
      runner: { ...base.runner, ...(isRecord(data.runner) ? data.runner : {}) },
      settings: { ...base.settings, ...(isRecord(data.settings) ? data.settings : {}) },
      daily: dailyFrom(data.daily),
    };
    if (isRecord(data.hints)) progress.hints = data.hints as Progress["hints"];
    return progress;
  } catch {
    return base;
  }
};

/// A mode's results by level id. Empty for a mode nothing was saved under.
export const results = (progress: Progress, mode: string): Record<string, LevelResult> => progress.levels[mode] ?? {};

/// Keep the best of the old and new result for a level. The best score is the lowest one (ink
/// used, pins pulled) unless `higher` says a bigger score is the better one.
export const record = (progress: Progress, mode: string, levelID: string, stars: number, score?: number, higher = false) => {
  const byLevel = (progress.levels[mode] ??= {});
  const result = byLevel[levelID] ?? { cleared: false, bestStars: 0 };
  result.cleared = true;
  result.bestStars = Math.max(result.bestStars, stars);
  if (score !== undefined) {
    result.bestScore = result.bestScore === undefined ? score : higher ? Math.max(result.bestScore, score) : Math.min(result.bestScore, score);
  }
  byLevel[levelID] = result;
};

/// Note a daily level cleared on a date, and keep the best of that day's tries.
export const recordDaily = (progress: Progress, mode: string, date: string, stars: number, final: number) => {
  const byDate = (progress.daily[mode] ??= {});
  const old = byDate[date];
  byDate[date] = { stars: Math.max(old?.stars ?? 0, stars), final: Math.max(old?.final ?? 0, final) };
};

/// What a date's daily level ended as, or nothing for a day it was not cleared.
export const dailyResult = (progress: Progress, mode: string, date: string): DailyResult | undefined => progress.daily[mode]?.[date];

/// How many days in a row the daily level has been cleared, counted back from `today`. It is
/// worked out from the dates each time, so it cannot disagree with them. Until today's level is
/// cleared the run that reached yesterday still stands; one missed day ends it.
export const dailyStreak = (progress: Progress, mode: string, today: string): number => {
  const byDate = progress.daily[mode] ?? {};
  let day = byDate[today] ? today : addDays(today, -1), days = 0;
  while (byDate[day]) {
    days += 1;
    day = addDays(day, -1);
  }
  return days;
};

/// Note one more hint taken on a level and return how many that makes.
export const takeHint = (progress: Progress, mode: string, levelID: string): number => {
  const byLevel = ((progress.hints ??= {})[mode] ??= {});
  byLevel[levelID] = (byLevel[levelID] ?? 0) + 1;
  return byLevel[levelID];
};

class Store {
  progress: Progress = fresh();

  load() {
    let raw: string | null = null;
    try { raw = localStorage.getItem(KEY); } catch { /* no storage: start fresh */ }
    this.progress = decode(raw);
    // A file from an older version is written back in today's shape, so it is carried over once.
    if (raw !== null && raw !== JSON.stringify(this.progress)) this.save();
  }

  update(mutate: (p: Progress) => void) {
    mutate(this.progress);
    this.save();
  }

  private save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.progress)); } catch { /* private mode: play on without saving */ }
  }

  resetAll() {
    this.progress = fresh();
    try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
  }
}

export const store = new Store();
