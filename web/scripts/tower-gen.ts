// Number Tower's campaign generator. This file is the source of web/levels/tower: the recipes and
// the fixed seeds are here, and so are the names and hints. Run it to write the level files:
//   npx tsx scripts/tower-gen.ts            write web/levels/tower (the same bytes every run)
//   npx tsx scripts/tower-gen.ts --search   look for seeds, print the table to paste into SEEDS
//   npx tsx scripts/tower-gen.ts --out DIR  write somewhere else
// Importing this file runs nothing.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  generateDetailed, piecesOf, roomCount, solve, validateLevel,
  type Piece, type Recipe, type PaletteKind, type TowerLevel,
} from "../src/sim/tower";

export const TOWER_DIR = join(dirname(fileURLToPath(import.meta.url)), "../levels/tower");

type Tier = 0 | 1 | 2;

/// One level's recipe, in the short form the table below uses.
export interface Spec {
  grids: [number, number][];
  palette: Partial<Record<PaletteKind, number>>;
  featured: Piece[];
  /// The band for the chance that a random player wins.
  rw: [number, number];
  tiers: Tier[];
  orders?: [number, number];
  boss?: [number, number];
  limit?: number;
  lock?: number;
  wall?: number;
  two?: [number, number];
  minSolution?: number;
}

export interface ChapterSpec {
  id: string;
  title: string;
  blurb: string;
  allEntries: boolean;
  specs: Spec[];
}

/// Fill a chapter's levels in with what they share.
const fill = (list: Partial<Spec>[], shared: Partial<Spec>): Spec[] => list.map((s) => ({ ...shared, ...s }) as Spec);

const ENEMY_PLUS = { enemy: 6, plus: 3 };
const STAIRS = { enemy: 6, plus: 3, times: 2, minus: 1.5, halve: 1 };
const HOUSE = { ...STAIRS, mirror: 1.5, key: 1.5 };
const GROWING = { ...HOUSE, grower: 3 };

export const CHAPTERS: ChapterSpec[] = [
  {
    id: "1",
    title: "As advertised",
    blurb: "Exactly what the ad showed. Pick any floor.",
    allEntries: true,
    specs: fill([
      { grids: [[1, 3]], rw: [0.5, 0.7] },
      { grids: [[1, 4]], rw: [0.38, 0.46] },
      { grids: [[1, 5]], rw: [0.28, 0.36] },
      { grids: [[1, 4]], rw: [0.21, 0.27] },
      { grids: [[1, 5]], rw: [0.16, 0.2] },
      { grids: [[1, 6]], rw: [0.125, 0.155] },
      { grids: [[1, 5]], rw: [0.105, 0.125] },
      { grids: [[1, 6]], rw: [0.08, 0.105] },
    ], { palette: ENEMY_PLUS, featured: ["enemy", "plus"], tiers: [0] }).map((s) => ({ ...s, minSolution: (s.grids[0] as [number, number])[1] - 1 })),
  },
  {
    id: "2",
    title: "The stairs",
    blurb: "The ad left out the stairs. Rooms connect, and you walk.",
    allEntries: false,
    specs: fill([
      { grids: [[2, 2]], rw: [0.25, 0.5], tiers: [0], featured: ["times"] },
      { grids: [[2, 3]], rw: [0.15, 0.3], tiers: [0], featured: ["minus"] },
      { grids: [[2, 2]], rw: [0.1, 0.2], tiers: [0], featured: ["halve"] },
      { grids: [[2, 4]], rw: [0.06, 0.12], tiers: [0], featured: ["times", "minus"] },
      { grids: [[2, 3]], rw: [0.04, 0.09], tiers: [1], featured: ["times", "halve"] },
      { grids: [[2, 4]], rw: [0.025, 0.05], tiers: [1], featured: ["minus", "halve"] },
      { grids: [[2, 3]], rw: [0.012, 0.03], tiers: [1], featured: ["times", "minus", "halve"] },
      { grids: [[2, 4]], rw: [0.004, 0.015], tiers: [1], featured: ["times", "minus", "halve"] },
    ], { palette: STAIRS, minSolution: 3 }),
  },
  {
    id: "3",
    title: "House rules",
    blurb: "The tower has rules. Some floors will not hold a big number.",
    allEntries: false,
    specs: fill([
      { grids: [[2, 3]], rw: [0.05, 0.2], tiers: [1], featured: ["limit"] },
      { grids: [[2, 4]], rw: [0.03, 0.06], tiers: [1], featured: ["limit", "mirror"] },
      { grids: [[3, 2]], rw: [0.02, 0.05], tiers: [1], featured: ["key", "lock"] },
      { grids: [[3, 3]], rw: [0.015, 0.03], tiers: [1, 2], featured: ["mirror", "limit"] },
      { grids: [[2, 4]], rw: [0.01, 0.02], tiers: [2], featured: ["key", "lock", "limit"] },
      { grids: [[3, 3]], rw: [0.006, 0.012], tiers: [2], featured: ["mirror", "key", "lock"] },
      { grids: [[3, 3]], rw: [0.003, 0.006], tiers: [2], featured: ["limit", "mirror", "lock", "key"] },
      { grids: [[2, 4]], rw: [0.0005, 0.003], tiers: [2], featured: ["limit", "mirror", "lock", "key"] },
    ], { palette: HOUSE, limit: 0.25, lock: 0.12, wall: 0.2, minSolution: 4 }),
  },
  {
    id: "4",
    title: "They grow",
    blurb: "Some of them train while you wander. The longer you take, the bigger they get.",
    allEntries: false,
    specs: fill([
      { grids: [[2, 4]], rw: [0.03, 0.05], orders: [1, 50] },
      { grids: [[3, 3]], rw: [0.02, 0.03], orders: [1, 50] },
      { grids: [[2, 5]], rw: [0.012, 0.02], orders: [1, 50] },
      { grids: [[3, 3]], rw: [0.008, 0.012], orders: [1, 50] },
      { grids: [[3, 4]], rw: [0.005, 0.008], orders: [1, 3] },
      { grids: [[2, 5]], rw: [0.003, 0.005], orders: [1, 3] },
      { grids: [[3, 4]], rw: [0.0015, 0.003], orders: [1, 3] },
      { grids: [[3, 4]], rw: [0.0003, 0.0015], orders: [1, 3] },
    ], { palette: GROWING, featured: ["grower"], tiers: [2], limit: 0.2, lock: 0.1, wall: 0.2, minSolution: 5 }),
  },
];

/// The generator seed of each level, by chapter and position in the table above ("1.0" is the
/// first level of chapter 1). `--search` prints a fresh table. Empty means search.
export const SEEDS: Record<string, number> = {
  "1.0": 1000, "1.1": 1100, "1.2": 1200, "1.3": 1300, "1.4": 1400, "1.5": 1500, "1.6": 1600, "1.7": 1700,
  "2.0": 2000, "2.1": 2100, "2.2": 2200, "2.3": 2300, "2.4": 2400, "2.5": 2500, "2.6": 2600, "2.7": 2700,
  "3.0": 3000, "3.1": 3100, "3.2": 3200, "3.3": 3300, "3.4": 3400, "3.5": 3500, "3.6": 3601, "3.7": 3700,
  "4.0": 4000, "4.1": 4100, "4.2": 4200, "4.3": 4300, "4.4": 4400, "4.5": 4500, "4.6": 4600, "4.7": 4700,
};

/// A name and a hint for each level, by chapter and position in play order.
export const TEXT: Record<string, [string, string]> = {
  "1.0": ["Ground floor", "Beat anything smaller than you and add it to your number."],
  "1.1": ["Warm-up", "The boss is 17. You are 6. Collect before you fight."],
  "1.2": ["Odd jobs", "Four rooms to clear before a 20."],
  "1.3": ["Tiny", "You need every room. The boss is 9 and the rest add up to 6."],
  "1.4": ["Big shoes", "A 12 stands over you. Take the plus 8 first."],
  "1.5": ["Plus twelve", "A 9 is bigger than you. The plus 12 is not."],
  "1.6": ["Pocket change", "You are 3. The 7 is out of reach until you collect."],
  "1.7": ["Fine print", "A 10 and an 8 stand over you. The 5 and the plus 5 come first."],
  "2.0": ["Stairs", "You may enter the ground floor, or a room next to one you cleared."],
  "2.1": ["Right side up", "A times 2 sits beside the boss. Reach it first."],
  "2.2": ["Skip the half", "One room here only costs you."],
  "2.3": ["Cheap tickets", "The minus 16 stays where it is."],
  "2.4": ["Last step", "Two floors up, a times 2 beside the boss. The halve is not worth it."],
  "2.5": ["Shortcut", "Four rooms, then the boss. Skip the rest."],
  "2.6": ["Halve first", "A halve is cheap when you are small. Times six is not."],
  "2.7": ["Only one way", "One order wins. It skips three rooms."],
  "3.0": ["Weight limit", "Some rooms have a weight limit, and a hero above it falls."],
  "3.1": ["Key and lock", "A locked room needs a key. The key is above it."],
  "3.2": ["Spare key", "Two keys, one lock, and a floor that holds 10."],
  "3.3": ["Light on your feet", "Every limit here is small. Stay light."],
  "3.4": ["Locked boss", "The boss is behind a lock."],
  "3.5": ["One key", "One key, one lock, one mirror."],
  "3.6": ["Behind the door", "The boss is locked in. The key shares a room with a mirror."],
  "3.7": ["Five or less", "Enter the times 3 while you are 5 or less."],
  "4.0": ["Growing pains", "A grower gets bigger by its second number each time you enter a room."],
  "4.1": ["Early bird", "The grower is 1 now. It is 10 after three rooms."],
  "4.2": ["Late fee", "The grower starts at 29 and gains 3 a room."],
  "4.3": ["Big boss", "The boss is 840. The plus 60 is locked."],
  "4.4": ["Thin margins", "Low numbers, low limits, and a boss of 11."],
  "4.5": ["Shared room", "A grower and a times 2 share one room."],
  "4.6": ["Easy boss", "The boss is only 5. Getting to it is the problem."],
  "4.7": ["Overgrown", "Four growers, two locks, one way through."],
};

export const recipeOf = (chapter: ChapterSpec, spec: Spec): Recipe => ({
  grids: spec.grids.map(([w, h]) => ({ w, h })),
  allEntries: chapter.allEntries,
  palette: spec.palette,
  limitShare: spec.limit,
  lockShare: spec.lock,
  wallShare: spec.wall ?? 0,
  twoThings: spec.two ?? (chapter.id === "1" ? [0, 0] : [0, 2]),
  tiers: spec.tiers,
  randomWin: spec.rw,
  orders: spec.orders ?? [1, Infinity],
  minSolution: spec.minSolution ?? 3,
  featured: spec.featured,
  bossShare: spec.boss,
  maxCandidates: 20000,
});

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const sameLook = (a: TowerLevel, b: TowerLevel) => a.w === b.w && a.h === b.h && piecesOf(a).join() === piecesOf(b).join();

/// Find seeds for every level by trying seeds in order from a fixed base. Returns the table and
/// the number of candidates each chapter needed.
export function searchSeeds(): { seeds: Record<string, number>; candidates: Record<string, number> } {
  const seeds: Record<string, number> = {};
  const candidates: Record<string, number> = {};
  for (const chapter of CHAPTERS) {
    candidates[chapter.id] = 0;
    let before: TowerLevel | null = null;
    chapter.specs.forEach((spec, p) => {
      const recipe = recipeOf(chapter, spec);
      const first = Number(chapter.id) * 1000 + p * 100;
      for (let seed = first; seed <= first + 40; seed++) {
        const g = generateDetailed(recipe, seed);
        candidates[chapter.id] = (candidates[chapter.id] ?? 0) + g.candidates;
        // A neighbour with the same grid and the same pieces is not allowed.
        if (!g.level || (before && sameLook(before, g.level))) continue;
        seeds[`${chapter.id}.${p}`] = seed;
        before = g.level;
        return;
      }
      throw new Error(`no level for ${chapter.id}.${p}`);
    });
  }
  return { seeds, candidates };
}

export interface Built {
  chapter: ChapterSpec;
  levels: TowerLevel[];
  candidates: number;
}

/// Build the whole campaign from the seeds, in play order, with names and hints applied.
export function buildCampaign(seeds: Record<string, number> = SEEDS): Built[] {
  return CHAPTERS.map((chapter) => {
    let candidates = 0;
    const made = chapter.specs.map((spec, p) => {
      const seed = seeds[`${chapter.id}.${p}`];
      if (seed === undefined) throw new Error(`no seed for ${chapter.id}.${p}; run with --search`);
      const g = generateDetailed(recipeOf(chapter, spec), seed);
      if (!g.level) throw new Error(`seed ${seed} no longer makes level ${chapter.id}.${p}`);
      candidates += g.candidates;
      const s = solve(g.level);
      return { level: g.level, rw: s.randomWin, tier: s.tier, size: roomCount(g.level) };
    });
    made.sort((a, b) => b.rw - a.rw || a.tier - b.tier || a.size - b.size);
    const levels = made.map((m, p) => {
      const [name, hint] = TEXT[`${chapter.id}.${p}`] ?? [`Tower ${chapter.id}-${p + 1}`, "No hint yet."];
      return { id: slug(name), name, hint, ...m.level } as TowerLevel;
    });
    levels.forEach((level, p) => {
      validateLevel(level, true);
      const next = levels[p + 1];
      if (next && sameLook(level, next)) {
        throw new Error(`levels ${level.id} and ${next.id} have the same grid and the same pieces`);
      }
    });
    return { chapter, levels, candidates };
  });
}

const room = (r: TowerLevel["rooms"][number]) => (r === null ? "null" : JSON.stringify(r));

/// One level file: fixed key order, one room to a line.
export const serialize = (level: TowerLevel): string => {
  const field = (key: string, value: unknown) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  const lines = [
    field("id", level.id), field("name", level.name), field("hint", level.hint), field("start", level.start),
    field("w", level.w), field("h", level.h),
    `  "rooms": [\n${level.rooms.map((r) => `    ${room(r)}`).join(",\n")}\n  ]`,
    field("walls", level.walls), field("entries", level.entries), field("solution", level.solution),
    field("best", level.best), field("seed", level.seed),
  ];
  return `{\n${lines.join(",\n")}\n}\n`;
};

/// The file names and contents of the whole campaign.
export function campaignFiles(seeds: Record<string, number> = SEEDS): Map<string, string> {
  const files = new Map<string, string>();
  const chapters = buildCampaign(seeds).map(({ chapter, levels }) => {
    for (const level of levels) files.set(`${level.id}.json`, serialize(level));
    return { id: chapter.id, title: chapter.title, blurb: chapter.blurb, levels: levels.map((l) => l.id as string) };
  });
  const ids = [...files.keys()];
  if (new Set(ids).size !== ids.length) throw new Error("two levels share a name");
  files.set("chapters.json", `${JSON.stringify(chapters, null, 2)}\n`);
  return files;
}

/// Write the campaign into a folder, removing level files that are no longer part of it.
export function writeCampaign(dir = TOWER_DIR, seeds: Record<string, number> = SEEDS) {
  const files = campaignFiles(seeds);
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) if (name.endsWith(".json") && !files.has(name)) rmSync(join(dir, name));
  for (const [name, text] of files) writeFileSync(join(dir, name), text);
}

const main = () => {
  const args = process.argv.slice(2);
  if (args.includes("--search")) {
    const { seeds, candidates } = searchSeeds();
    process.stdout.write(`${JSON.stringify(seeds)}\ncandidates ${JSON.stringify(candidates)}\n`);
    return;
  }
  const out = args.indexOf("--out");
  writeCampaign(out >= 0 ? (args[out + 1] as string) : TOWER_DIR);
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
