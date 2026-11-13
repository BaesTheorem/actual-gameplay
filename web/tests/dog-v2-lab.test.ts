import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { trials } from "../scripts/savedog-suite";
import { DRAW_AREA, playOut, type DogLevel } from "../src/sim/savedog";
import { contains, inset, polylineLength } from "../src/sim/savedog/geometry";
import { strokePoints } from "../src/sim/savedog/level";
import { inkCost } from "../src/sim/savedog/stroke";

// The levels in the lab: one small level for each hazard, played in the game at
// #/saveDog/~<file name>. They are in no chapter, so nothing else replays them.
const LAB = join(dirname(fileURLToPath(import.meta.url)), "../public/lab/savedog");
const levels = readdirSync(LAB).filter((file) => file.endsWith(".json")).sort()
  .map((file) => ({ file, level: JSON.parse(readFileSync(join(LAB, file), "utf8")) as DogLevel }));

/// What each level is there to show.
const HAZARD: Record<string, (level: DogLevel) => boolean> = {
  fire: (level) => (level.fires ?? []).length > 0,
  rock: (level) => (level.rocks ?? []).length > 0,
  bomb: (level) => (level.bombs ?? []).length > 0,
  ice: (level) => (level.statics ?? []).some((item) => item.skin === "ice"),
};

describe("the lab levels", () => {
  it("are there, one to a hazard, each named by its file", () => {
    expect(levels.map((l) => l.file)).toEqual(["bomb.json", "fire.json", "ice.json", "rock.json"]);
    for (const { file, level } of levels) {
      expect(`${level.id}.json`, file).toBe(file);
      expect(HAZARD[level.id](level), file).toBe(true);
      expect(level.name.length, file).toBeGreaterThan(0);
      // Plain and dry: a hint ends with a full stop and never shouts.
      expect(level.hint, file).toMatch(/\.$/);
      expect(level.hint, file).not.toMatch(/!/);
      // The same rules the campaign's levels are held to.
      expect(level.stars.length, file).toBe(2);
      expect(level.stars[0], file).toBeLessThan(level.stars[1]);
      expect(level.stars[1], file).toBeLessThanOrEqual(level.inkBudget);
      let cost = 0;
      for (const stroke of level.solution!.strokes) {
        for (const point of strokePoints(stroke)) expect(contains(inset(DRAW_AREA, -8, -8), point), file).toBe(true);
        cost += inkCost(polylineLength(strokePoints(stroke)));
      }
      expect(cost * 1.05, file).toBeLessThanOrEqual(level.inkBudget);
      expect(cost, file).toBeLessThanOrEqual(level.stars[0] + 0.01);
    }
  });

  for (const { file, level } of levels) {
    it(`${file} is won by its stored solution at three stars, and by no naive stroke`, () => {
      const plan = trials(level);
      const solved = playOut(level, plan.get("solution")!);
      expect(solved.outcome, file).toMatchObject({ won: true, stars: 3 });
      for (const [name, attempt] of plan) {
        if (name.startsWith("dumb:")) expect(playOut(level, attempt).outcome?.won, name).not.toBe(true);
      }
    }, 30_000);
  }
});
