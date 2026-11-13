import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moves, playOut, walks, type PinLevel } from "../src/sim/pinpull";

// The levels in the lab: one small level for each of the newer pieces, played in the game at
// #/pinPull/~<file name>. They are in no chapter, so nothing else replays them.
const LAB = join(dirname(fileURLToPath(import.meta.url)), "../public/lab/pinpull");
const levels = readdirSync(LAB).filter((file) => file.endsWith(".json")).sort()
  .map((file) => ({ file, level: JSON.parse(readFileSync(join(LAB, file), "utf8")) as PinLevel }));

describe("the lab levels", () => {
  it("are there, one file to a level, each named by its file", () => {
    expect(levels.length).toBeGreaterThan(0);
    for (const { file, level } of levels) {
      expect(`${level.id}.json`, file).toBe(file);
      expect(walks(level), file).toBe(true);
      expect(level.name.length, file).toBeGreaterThan(0);
      expect((level.hint ?? "").length, file).toBeGreaterThan(0);
      // Plain and dry: a hint ends with a full stop and never shouts.
      expect(level.hint, file).toMatch(/\.$/);
      expect(level.hint, file).not.toMatch(/!/);
    }
  });

  for (const { file, level } of levels) {
    it(`${file} is won by its stored solution, in par, and by no single pull`, () => {
      const solution = level.solution ?? [];
      expect(solution.length).toBe(level.parPins);
      for (const id of solution) expect(level.pins.some((pin) => pin.id === id), id).toBe(true);
      expect(playOut(level, solution).outcome).toEqual({ won: true, stars: 3, coins: 0, score: level.parPins });
      // Every level here takes two pulls, so one pull of anything wins nothing.
      for (const move of moves(level)) expect(playOut(level, [move]).outcome?.won, move).not.toBe(true);
    });
  }
});
