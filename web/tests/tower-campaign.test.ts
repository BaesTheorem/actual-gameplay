import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkLevel, piecesOf, playThrough, solve, validateLevel, type TowerLevel,
} from "../src/sim/tower";
import { CHAPTERS, SEEDS, TOWER_DIR, campaignFiles, recipeOf, writeCampaign } from "../scripts/tower-gen";
import { audit, loadTower, replay, show, stats } from "../scripts/tower-suite";

const campaign = loadTower();

describe("the campaign files", () => {
  it("are four chapters of eight levels, named by slug", () => {
    expect(campaign.chapters.map((c) => c.id)).toEqual(["1", "2", "3", "4"]);
    for (const chapter of campaign.chapters) {
      expect(chapter.levels).toHaveLength(8);
      expect(chapter.title).not.toBe("");
      expect(chapter.blurb).not.toBe("");
    }
    expect(campaign.levels).toHaveLength(32);
    const onDisk = readdirSync(TOWER_DIR).filter((f) => f !== "chapters.json").map((f) => f.slice(0, -5)).sort();
    expect(onDisk).toEqual(campaign.levels.map((l) => l.level.id as string).sort());
  });

  it("validate, with an id that equals the file stem", () => {
    for (const { level } of campaign.levels) {
      expect(() => validateLevel(level, true)).not.toThrow();
      const raw = JSON.parse(readFileSync(join(TOWER_DIR, `${level.id}.json`), "utf8")) as TowerLevel;
      expect(raw.id).toBe(level.id);
    }
  });

  it("replay their stored solution through TowerSim to best, with three stars", () => {
    for (const { level } of campaign.levels) {
      const { sim } = playThrough(level, level.solution as number[]);
      expect(sim.outcome, level.id).toEqual({ won: true, stars: 3, coins: 0, score: level.best });
    }
  });

  it("store the solver's best, and a solution that is a best order", () => {
    for (const { level } of campaign.levels) {
      const s = solve(level);
      expect(level.best, level.id).toBe(s.best);
      expect(level.hint, level.id).not.toMatch(/!|—/);
    }
  });

  it("follow their chapter's recipe and the rules for every level", () => {
    for (const { chapter, position, level } of campaign.levels) {
      const spec = CHAPTERS.find((c) => c.id === chapter);
      expect(spec).toBeDefined();
      expect(SEEDS[`${chapter}.${position}`], level.id).toBe(level.seed);
      expect(checkLevel(level, recipeOf(spec as typeof CHAPTERS[number], (spec as typeof CHAPTERS[number]).specs[position] as typeof CHAPTERS[number]["specs"][number])), level.id).toEqual([]);
    }
  });

  it("run as the brief says, chapter by chapter", () => {
    const by = (id: string) => campaign.levels.filter((l) => l.chapter === id).map((l) => ({ level: l.level, s: solve(l.level) }));
    const one = by("1");
    expect(one.every(({ level }) => level.w === 1 && level.h >= 3 && level.h <= 6)).toBe(true);
    expect(one.every(({ level }) => level.entries.length === level.rooms.length)).toBe(true);
    expect(one.every(({ level }) => piecesOf(level).every((p) => p === "enemy" || p === "plus"))).toBe(true);
    expect(one.every(({ s }) => s.tier === 0)).toBe(true);
    expect(one[0]?.s.randomWin).toBeGreaterThan(0.45);
    expect(one[0]?.s.randomWin).toBeLessThan(0.75);
    expect(one[7]?.s.randomWin).toBeGreaterThan(0.07);
    expect(one[7]?.s.randomWin).toBeLessThan(0.13);

    const two = by("2");
    expect(two.every(({ level }) => level.w === 2 && level.h >= 2 && level.h <= 4)).toBe(true);
    expect(two.every(({ level }) => level.entries.every((e) => e < level.w))).toBe(true);
    expect(two[0]?.s.tier).toBe(0);
    expect(two[7]?.s.tier).toBe(1);
    expect(two.some(({ level }) => piecesOf(level).includes("halve"))).toBe(true);
    expect(two.some(({ level }) => piecesOf(level).includes("minus"))).toBe(true);

    const three = by("3");
    expect(three.every(({ s }) => s.tier >= 1)).toBe(true);
    for (const piece of ["limit", "mirror", "key", "lock"] as const) {
      expect(three.some(({ level }) => piecesOf(level).includes(piece)), piece).toBe(true);
    }
    expect(three.some(({ level }) => level.walls.length > 0)).toBe(true);

    const four = by("4");
    expect(four.every(({ s }) => s.tier === 2)).toBe(true);
    expect(four.every(({ s }) => s.randomWin <= 0.05)).toBe(true);
    expect(four.every(({ level }) => (level.w === 2 || level.w === 3) && level.w * level.h <= 12)).toBe(true);
    expect(four.every(({ level }) => piecesOf(level).includes("grower"))).toBe(true);
    for (const { s } of four.slice(4)) expect(s.winningOrders).toBeLessThanOrEqual(3);
  });

  it("make randomWin fall through each chapter, with no look-alike neighbours", () => {
    for (const chapter of campaign.chapters) {
      const levels = campaign.levels.filter((l) => l.chapter === chapter.id).map((l) => l.level);
      const rw = levels.map((l) => solve(l).randomWin);
      for (let i = 1; i < levels.length; i++) {
        expect(rw[i] as number, `${chapter.id}.${i + 1}`).toBeLessThanOrEqual(rw[i - 1] as number);
        const a = levels[i - 1] as TowerLevel, b = levels[i] as TowerLevel;
        expect(a.w === b.w && a.h === b.h && piecesOf(a).join() === piecesOf(b).join(), `${chapter.id}.${i + 1}`).toBe(false);
      }
    }
  });

  it("are written again as the same bytes", () => {
    const files = campaignFiles();
    for (const [name, text] of files) expect(readFileSync(join(TOWER_DIR, name), "utf8"), name).toBe(text);
    const dir = mkdtempSync(join(tmpdir(), "tower-"));
    try {
      writeCampaign(dir);
      expect(readdirSync(dir).sort()).toEqual([...files.keys()].sort());
      for (const name of readdirSync(dir)) expect(readFileSync(join(dir, name), "utf8"), name).toBe(files.get(name));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the suite", () => {
  it("replays every level and audits with nothing flagged", () => {
    const log = console.log;
    console.log = () => {};
    try {
      expect(replay()).toEqual({ passed: 32, total: 32 });
      expect(audit()).toBe(0);
    } finally {
      console.log = log;
    }
  });

  it("gives exact statistics", () => {
    const level = campaign.levels[0]?.level as TowerLevel;
    const s = stats(level);
    expect(s.exact).toBe(true);
    expect(s.randomWin).toBe(solve(level).randomWin);
    expect(s.sample).toBeGreaterThan(0);
    expect(s.detail).toMatch(/winning order/);
  });

  it("draws a tower in ASCII", () => {
    const level = campaign.levels.find((l) => l.level.id === "locked-boss")?.level as TowerLevel;
    const text = show(level);
    expect(text).toContain("BOSS 66");
    expect(text).toContain("LOCK");
    expect(text).toContain("max 76");
    expect(text.split("\n").length).toBeGreaterThan(10);
    expect(show(campaign.levels[0]?.level as TowerLevel)).toContain("Every room is an entry");
  });
});
