import { describe, expect, it } from "vitest";
import { load, loadSet } from "../scripts/levels";
import { folderOf } from "../src/app/modetable";
import { PLAYFIELD } from "../src/sim/sk";
import { DRAW_AREA } from "../src/sim/savedog";
import { contains, containsRect, inset, polylineLength } from "../src/sim/savedog/geometry";
import { SPRITES, strokePoints, totalBees, type DogLevel } from "../src/sim/savedog/level";
import { inkCost } from "../src/sim/savedog/stroke";

/// Every level file must load and be internally consistent. These are the files in web/levels,
/// read in play order through the loader, which has already checked each id against its file name.
describe("Save the Clawd levels", () => {
  const canvas = { x: -1, y: -1, w: 404, h: 876 };
  const levels = load<DogLevel>(folderOf("saveDog"));

  it("has levels", () => {
    expect(levels.length).toBeGreaterThan(0);
  });

  it("is consistent level by level", () => {
    levels.forEach((level) => {
      const id = level.id;
      expect(level.name.length).toBeGreaterThan(0);
      expect(level.inkBudget).toBeGreaterThan(0);
      expect(level.stars.length, `${id}: two star thresholds`).toBe(2);
      expect(level.stars[0], `${id}: star thresholds ascending`).toBeLessThan(level.stars[1]);
      expect(level.stars[1], `${id}: thresholds within budget`).toBeLessThanOrEqual(level.inkBudget);
      expect(level.dogs.length, `${id}: needs a dog`).toBeGreaterThan(0);
      expect(level.hives.length, `${id}: needs bees`).toBeGreaterThan(0);
      expect(totalBees(level), `${id}: ${totalBees(level)} bees is a lot of bodies`).toBeLessThanOrEqual(60);
      const dogIDs = level.dogs.map((dog) => dog.id);
      expect(new Set(dogIDs).size, `${id}: duplicate dog ids`).toBe(dogIDs.length);
      for (const dog of level.dogs) {
        expect(contains(canvas, dog), `${id}: dog ${dog.id} outside the canvas`).toBe(true);
      }
      for (const hive of level.hives) {
        expect(contains(inset(PLAYFIELD, 8, 8), hive), `${id}: hive outside the playfield`).toBe(true);
        expect(hive.count).toBeGreaterThan(0);
      }
      for (const region of [...(level.killers ?? []), ...(level.forbidden ?? [])]) {
        expect(containsRect(canvas, region), `${id}: region ${JSON.stringify(region)} outside the canvas`).toBe(true);
      }
      for (const saw of level.saws ?? []) {
        expect(contains(canvas, saw), `${id}: saw outside the canvas`).toBe(true);
        expect(saw.r).toBeGreaterThan(0);
      }
      for (const prop of level.props ?? []) {
        expect(prop.shape === "ball" || prop.shape === "box", `${id}: prop shape ${prop.shape}`).toBe(true);
        expect(contains(canvas, prop), `${id}: prop ${prop.id} outside the canvas`).toBe(true);
      }
      for (const decor of level.decor ?? []) {
        expect(SPRITES.has(decor.sprite), `${id}: unknown decor sprite ${decor.sprite}`).toBe(true);
      }
      const solution = level.solution!;
      expect(solution, `${id}: every level stores a solution`).toBeDefined();
      expect(solution.strokes.length, `${id}: solution has strokes`).toBeGreaterThan(0);
      let cost = 0;
      for (const stroke of solution.strokes) {
        expect(stroke.points.length, `${id}: empty solution stroke`).toBeGreaterThan(0);
        for (const point of strokePoints(stroke)) {
          expect(contains(inset(DRAW_AREA, -8, -8), point), `${id}: solution point ${JSON.stringify(point)} outside the draw area`).toBe(true);
        }
        cost += inkCost(polylineLength(strokePoints(stroke)));
      }
      expect(cost * 1.05, `${id}: solution needs ${cost} ink of ${level.inkBudget}`).toBeLessThanOrEqual(level.inkBudget);
      expect(cost, `${id}: the stored solution should earn three stars (${cost} vs ${level.stars[0]})`).toBeLessThanOrEqual(level.stars[0] + 0.01);
    });
  });
});

/// The campaign as a whole: its shape, and the rules every level's words and numbers follow.
describe("the Save the Clawd campaign", () => {
  const { chapters, levels } = loadSet<DogLevel>(folderOf("saveDog"));
  const ink = (level: DogLevel) => level.solution!.strokes.reduce((sum, stroke) => sum + polylineLength(strokePoints(stroke)), 0);

  it("is six chapters of five levels", () => {
    expect(chapters.map((chapter) => chapter.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
    for (const chapter of chapters) expect(chapter.levels.length, `chapter ${chapter.id}`).toBe(5);
    expect(levels.length).toBe(30);
    expect(new Set(levels.map((level) => level.name)).size).toBe(30);
  });

  it("speaks plainly: a hint ends with a full stop, never shouts, and fits two lines", () => {
    for (const level of levels) {
      expect(level.hint, level.id).toMatch(/\.$/);
      expect(level.hint, level.id).not.toMatch(/!/);
      // The plate wraps at 350 points, about 48 letters of the marker face at 13 points.
      expect(level.hint!.length, level.id).toBeLessThanOrEqual(100);
    }
    for (const chapter of chapters) {
      expect(chapter.blurb, chapter.id).toMatch(/\.$/);
      expect(`${chapter.title} ${chapter.blurb}`, chapter.id).not.toMatch(/!/);
    }
  });

  it("gives three stars at the stored ink and 15 percent, two at 40 percent, inside the budget", () => {
    for (const level of levels) {
      expect(level.stars[0], level.id).toBe(Math.round(ink(level) * 1.15));
      expect(level.stars[1], level.id).toBe(Math.round(ink(level) * 1.4));
      expect(level.inkBudget, level.id).toBeGreaterThanOrEqual(level.stars[1]);
    }
  });

  it("keeps a hive at the top of a level under the hint plate, and makes a near one wait", () => {
    for (const level of levels) {
      for (const hive of level.hives) {
        expect(hive.y, `${level.id}: a hive at ${hive.y} is behind the hint plate`).toBeLessThanOrEqual(660);
        // A bee flies 260 points a second. One that could reach him in under three seconds
        // comes out late enough that it does not.
        const reach = Math.min(...level.dogs.map((dog) => Math.hypot(dog.x - hive.x, dog.y - hive.y)));
        expect((hive.delay ?? 0) + (reach - 24) / 260, `${level.id}: the hive at ${hive.x},${hive.y}`).toBeGreaterThan(2.6);
      }
    }
  });

  it("uses fire in chapter 5 and boulders, bombs or ice in chapter 6, and none of them before", () => {
    const hazards = (level: DogLevel) => ({
      fire: (level.fires ?? []).length > 0,
      falls: (level.rocks ?? []).length + (level.bombs ?? []).length > 0 || (level.statics ?? []).some((item) => item.skin === "ice"),
    });
    const of = (id: string) => chapters.find((chapter) => chapter.id === id)!.levels.map((slug) => levels.find((level) => level.id === slug)!);
    for (const id of ["1", "2", "3", "4"]) for (const level of of(id)) expect(hazards(level), level.id).toEqual({ fire: false, falls: false });
    for (const level of of("5")) expect(hazards(level), level.id).toEqual({ fire: true, falls: false });
    for (const level of of("6")) expect(hazards(level).falls, level.id).toBe(true);
  });
});

