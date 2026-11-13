// Everything the game remembers, in the same shape the iPhone app saves, kept in localStorage.
export interface LevelResult { cleared: boolean; bestStars: number; bestScore?: number }
export interface Progress {
  schemaVersion: number;
  saveDog: Record<string, LevelResult>;
  pinPull: Record<string, LevelResult>;
  runner: { level: number; bestLevel: number; coins: number; upgrades: Record<string, number> };
  settings: { haptics: boolean; music: boolean; sound: boolean };
}
export type Mode = "saveDog" | "pinPull" | "runner";

const KEY = "actual-gameplay/progress";
const fresh = (): Progress => ({
  schemaVersion: 1, saveDog: {}, pinPull: {},
  runner: { level: 0, bestLevel: 0, coins: 0, upgrades: {} },
  settings: { haptics: true, music: true, sound: true },
});

/// Fill anything a stored file leaves out, so an older save still loads.
export const decode = (raw: string | null): Progress => {
  const base = fresh();
  if (!raw) return base;
  try {
    const data = JSON.parse(raw) as Partial<Progress>;
    return {
      schemaVersion: data.schemaVersion ?? 1,
      saveDog: data.saveDog ?? {},
      pinPull: data.pinPull ?? {},
      runner: { ...base.runner, ...(data.runner ?? {}) },
      settings: { ...base.settings, ...(data.settings ?? {}) },
    };
  } catch {
    return base;
  }
};

/// Keep the best of the old and new result for a level.
export const record = (progress: Progress, mode: Mode, levelID: string, stars: number, score?: number) => {
  if (mode === "runner") return;
  const result = progress[mode][levelID] ?? { cleared: false, bestStars: 0 };
  result.cleared = true;
  result.bestStars = Math.max(result.bestStars, stars);
  if (score !== undefined) result.bestScore = result.bestScore === undefined ? score : Math.min(result.bestScore, score);
  progress[mode][levelID] = result;
};

class Store {
  progress: Progress = fresh();

  load() {
    try { this.progress = decode(localStorage.getItem(KEY)); } catch { this.progress = fresh(); }
  }

  update(mutate: (p: Progress) => void) {
    mutate(this.progress);
    try { localStorage.setItem(KEY, JSON.stringify(this.progress)); } catch { /* private mode: play on without saving */ }
  }

  resetAll() {
    this.progress = fresh();
    try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
  }
}

export const store = new Store();
