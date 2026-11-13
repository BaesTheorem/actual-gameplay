import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { idNumber, levelHash, load, loadSet } from "../scripts/levels";
import { labelOf, playOrder } from "../src/app/chapters";
import { LEVEL_MODES } from "../src/app/modetable";

/// A folder of levels made for one test: chapters.json and one file per entry of `files`.
const roots: string[] = [];
const folder = (chapters: unknown, files: Record<string, unknown>): string => {
  const root = mkdtempSync(join(tmpdir(), "levels-"));
  roots.push(root);
  mkdirSync(join(root, "mode"));
  writeFileSync(join(root, "mode/chapters.json"), JSON.stringify(chapters));
  for (const [stem, level] of Object.entries(files)) writeFileSync(join(root, `mode/${stem}.json`), JSON.stringify(level));
  return root;
};
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const chapter = (id: string, levels: string[]) => ({ id, title: `Chapter ${id}`, blurb: "A line.", levels });

describe("the level loader", () => {
  it("returns the chapters and the levels in play order", () => {
    const root = folder([chapter("1", ["b-level", "a-level"]), chapter("2", ["c-level"])],
      { "a-level": { id: "a-level" }, "b-level": { id: "b-level" }, "c-level": { id: "c-level" } });
    const set = loadSet<{ id: string }>("mode", root);
    expect(set.levels.map((l) => l.id)).toEqual(["b-level", "a-level", "c-level"]);
    expect(set.chapters.map((c) => c.id)).toEqual(["1", "2"]);
    expect(load<{ id: string }>("mode", root).length).toBe(3);
  });

  it("names a level file that no chapter lists", () => {
    const root = folder([chapter("1", ["a-level"])], { "a-level": { id: "a-level" }, "stray-level": { id: "stray-level" } });
    expect(() => loadSet("mode", root)).toThrow(/stray-level\.json is in no chapter/);
  });

  it("names a chapter entry that has no file", () => {
    const root = folder([chapter("1", ["a-level"]), chapter("2", ["ghost-level"])], { "a-level": { id: "a-level" } });
    expect(() => loadSet("mode", root)).toThrow(/chapter "2" lists "ghost-level", which has no file/);
  });

  it("names a level listed twice", () => {
    const root = folder([chapter("1", ["a-level"]), chapter("2", ["a-level"])], { "a-level": { id: "a-level" } });
    expect(() => loadSet("mode", root)).toThrow(/level "a-level" is listed twice/);
  });

  it("names a file whose id is not its own name", () => {
    const root = folder([chapter("1", ["a-level"])], { "a-level": { id: "01" } });
    expect(() => loadSet("mode", root)).toThrow(/a-level\.json says its id is "01"/);
  });

  it("names an id that is not a slug", () => {
    const root = folder([chapter("1", ["A_Level"])], { A_Level: { id: "A_Level" } });
    expect(() => loadSet("mode", root)).toThrow(/"A_Level", which is not a kebab-case id/);
  });

  it("names a chapter id used twice", () => {
    const root = folder([chapter("1", ["a-level"]), chapter("1", ["b-level"])], { "a-level": { id: "a-level" }, "b-level": { id: "b-level" } });
    expect(() => loadSet("mode", root)).toThrow(/chapter "1" appears twice/);
  });

  it("hashes a level file by its bytes", () => {
    const root = folder([chapter("1", ["a-level", "b-level"])], { "a-level": { id: "a-level" }, "b-level": { id: "b-level" } });
    expect(levelHash("mode", "a-level", root)).toMatch(/^[0-9a-f]{64}$/);
    expect(levelHash("mode", "a-level", root)).not.toBe(levelHash("mode", "b-level", root));
  });

  it("gives every id its own steady number", () => {
    expect(idNumber("two-ways-down")).toBe(idNumber("two-ways-down"));
    expect(idNumber("two-ways-down")).not.toBe(idNumber("two-taps"));
    expect(Number.isInteger(idNumber("lid")) && idNumber("lid") >= 0).toBe(true);
  });
});

describe("chapter labels", () => {
  const chapters = [chapter("1", ["a", "b"]), chapter("2", ["c"])];
  it("come from the chapter and the place in it", () => {
    expect(labelOf(chapters, "a")).toBe("1-1");
    expect(labelOf(chapters, "b")).toBe("1-2");
    expect(labelOf(chapters, "c")).toBe("2-1");
    expect(labelOf(chapters, "missing")).toBe("");
    expect(playOrder(chapters)).toEqual(["a", "b", "c"]);
  });
});

/// The real folders: every mode with levels loads, with a name on every level and words on every chapter.
describe("the levels in web/levels", () => {
  for (const mode of LEVEL_MODES) {
    it(`${mode.id} loads from ${mode.folder}`, () => {
      const set = loadSet<{ id: string; name: string }>(mode.folder);
      expect(set.levels.length).toBeGreaterThan(0);
      for (const level of set.levels) expect(level.name.length, `${level.id} has a name`).toBeGreaterThan(0);
      for (const c of set.chapters) {
        expect(c.levels.length, `chapter ${c.id} has levels`).toBeGreaterThan(0);
        expect(c.blurb.length, `chapter ${c.id} has a blurb`).toBeGreaterThan(0);
      }
    });
  }
});
