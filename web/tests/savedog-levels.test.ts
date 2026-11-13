import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEVELS, load } from "../scripts/levels";
import { PLAYFIELD } from "../src/sim/sk";
import { DRAW_AREA } from "../src/sim/savedog";
import { contains, containsRect, inset, polylineLength } from "../src/sim/savedog/geometry";
import { SPRITES, strokePoints, totalBees, type DogLevel } from "../src/sim/savedog/level";
import { inkCost } from "../src/sim/savedog/stroke";

/// Every level file must load and be internally consistent. These are the files the iPhone app ships.
describe("Save the Clawd levels", () => {
  const canvas = { x: -1, y: -1, w: 404, h: 876 };
  const ids = readdirSync(join(LEVELS, "savedog")).filter((f) => f.endsWith(".json")).sort().map((f) => f.slice(0, -5));
  const levels = load<DogLevel>("savedog");

  it("has sixteen levels with distinct ids", () => {
    expect(ids.length, `expected 16 Save the Clawd levels, found ${ids}`).toBe(16);
    expect(new Set(ids).size, "duplicate level ids").toBe(ids.length);
  });

  it("is consistent level by level", () => {
    ids.forEach((id, index) => {
      const level = levels[index];
      expect(level.id, "level id must match its filename").toBe(id);
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
