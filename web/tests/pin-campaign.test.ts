import { describe, expect, it } from "vitest";
import { loadSet } from "../scripts/levels";
import { FOLDER, MOST_MOVES, MOST_PARTICLES } from "../scripts/pin-suite";
import { moves, playOut, type PinLevel } from "../src/sim/pinpull";

// The campaign as it ships: six chapters of five levels. What is checked here is cheap to check
// on every run: the shape of the campaign, the limits every level keeps, and that each stored
// solution wins in par. The audit, the delayed replay and the noise replay take minutes and are
// run from scripts/pin-suite.ts.
const campaign = loadSet<PinLevel>(FOLDER);
const TITLES = ["Fire and water", "Company", "Heavy things", "Demolition", "Strings attached", "Bad air"];
const chapterOf = (id: string) => campaign.chapters.findIndex((chapter) => chapter.levels.includes(id)) + 1;

describe("the Pull the Pin campaign", () => {
  it("is six chapters of five levels", () => {
    expect(campaign.chapters.map((chapter) => chapter.title)).toEqual(TITLES);
    expect(campaign.chapters.map((chapter) => chapter.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
    for (const chapter of campaign.chapters) {
      expect(chapter.levels, chapter.title).toHaveLength(5);
      // Plain and dry: a blurb ends with a full stop and never shouts.
      expect(chapter.blurb, chapter.title).toMatch(/\.$/);
      expect(chapter.blurb, chapter.title).not.toMatch(/!/);
    }
    expect(campaign.levels).toHaveLength(30);
  });

  it("gives every level a name of its own and a plain hint that fits its plate", () => {
    const names = campaign.levels.map((level) => level.name);
    expect(new Set(names).size).toBe(names.length);
    for (const level of campaign.levels) {
      // The id is the name in lower case with dashes for spaces.
      expect(level.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), level.id).toBe(level.id);
      expect(level.hint, level.id).toMatch(/\.$/);
      expect(level.hint, level.id).not.toMatch(/!/);
      // One line on the plate holds about 51 characters.
      expect((level.hint ?? "").length, level.id).toBeLessThanOrEqual(51);
    }
  });

  it("keeps every level inside the limits", () => {
    for (const level of campaign.levels) {
      const chapter = chapterOf(level.id);
      expect(level.parPins, level.id).toBeGreaterThanOrEqual(1);
      expect(level.parPins, level.id).toBeLessThanOrEqual(chapter === 1 ? 2 : 4);
      // A group of linked pins is one move.
      expect(moves(level).length, level.id).toBeLessThanOrEqual(MOST_MOVES);
      const particles = (level.pools ?? []).reduce((sum, pool) => sum + pool.count, 0);
      expect(particles, level.id).toBeLessThanOrEqual(MOST_PARTICLES);
      // Nothing a player must see is under the plates at the top of the screen.
      for (const pin of level.pins) expect(pin.y, `${level.id} ${pin.id}`).toBeLessThan(700);
    }
  });

  for (const level of campaign.levels) {
    it(`${level.id} is won by its stored solution, in par`, () => {
      const solution = level.solution ?? [];
      expect(solution.length).toBe(level.parPins);
      for (const id of solution) expect(moves(level), id).toContain(id);
      expect(playOut(level, solution).outcome).toEqual({ won: true, stars: 3, coins: 0, score: level.parPins });
    });
  }
});
