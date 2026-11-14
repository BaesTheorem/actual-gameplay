import { describe, expect, it } from "vitest";
import { load } from "../scripts/levels";
import { folderOf } from "../src/app/modetable";
import { SCHEMA_VERSION, decode, record, results, takeHint } from "../src/app/store";
import { V1_IDS } from "../src/app/v1ids";

describe("the save", () => {
  const v1 = {
    schemaVersion: 1,
    saveDog: { "01": { cleared: true, bestStars: 3, bestScore: 236 }, "06": { cleared: true, bestStars: 2, bestScore: 90 }, "10": { cleared: true, bestStars: 3, bestScore: 590 }, "99": { cleared: true, bestStars: 1 } },
    pinPull: { "09": { cleared: true, bestStars: 3, bestScore: 2 } },
    runner: { level: 4, bestLevel: 5, coins: 120, upgrades: { startCrowd: 2 } },
    settings: { haptics: false, music: true, sound: false },
  };

  it("carries a version 1 file over to level ids", () => {
    const p = decode(JSON.stringify(v1));
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.levels.saveDog["first-shield"]).toEqual({ cleared: true, bestStars: 3, bestScore: 236 });
    expect(p.levels.saveDog["roll-it-in"]).toEqual({ cleared: true, bestStars: 2, bestScore: 90 });
    // Pull the Pin's version 1 levels were replaced, so its old results are dropped.
    expect(p.levels.pinPull).toBeUndefined();
    expect(Object.keys(p.levels)).toEqual(["saveDog"]);
    // A number the table does not know has nowhere to go: 99 was never a level, and 10 was
    // No ink overhead, which the campaign no longer has.
    expect(Object.keys(p.levels.saveDog).sort()).toEqual(["first-shield", "roll-it-in"]);
    expect(p.runner).toEqual(v1.runner);
    expect(p.settings).toEqual(v1.settings);
    expect("saveDog" in p).toBe(false);
  });

  it("reads a file with no version as version 1", () => {
    const { schemaVersion: _, ...unversioned } = v1;
    const p = decode(JSON.stringify(unversioned));
    expect(p.levels.saveDog["first-shield"]?.bestStars).toBe(3);
    expect(p.levels.pinPull).toBeUndefined();
  });

  it("keeps a version 2 file as it is, and fills what it leaves out", () => {
    const v2 = { schemaVersion: 2, levels: { tower: { "first-floor": { cleared: true, bestStars: 1 } } }, runner: { coins: 7 }, hints: { pinPull: { "the-dam": 2 } } };
    const p = decode(JSON.stringify(v2));
    expect(p.levels).toEqual(v2.levels);
    expect(p.hints).toEqual(v2.hints);
    expect(p.runner).toEqual({ level: 0, bestLevel: 0, coins: 7, upgrades: {} });
    expect(p.settings).toEqual({ haptics: true, music: true, sound: true });
  });

  it("starts fresh from nothing or from nonsense", () => {
    for (const raw of [null, "", "not json", "[1,2]", "7"]) {
      const p = decode(raw);
      expect(p.schemaVersion).toBe(SCHEMA_VERSION);
      expect(p.levels).toEqual({});
      expect(p.hints).toBeUndefined();
    }
  });

  it("records results under any mode, and keeps the best", () => {
    const p = decode(null);
    record(p, "tower", "first-floor", 2, 9);
    record(p, "tower", "first-floor", 3, 12);
    record(p, "tower", "first-floor", 1, 5);
    expect(results(p, "tower")["first-floor"]).toEqual({ cleared: true, bestStars: 3, bestScore: 5 });
    expect(results(p, "nobody")).toEqual({});
  });

  it("counts hints by level", () => {
    const p = decode(null);
    expect(takeHint(p, "pinPull", "the-dam")).toBe(1);
    expect(takeHint(p, "pinPull", "the-dam")).toBe(2);
    expect(takeHint(p, "pinPull", "the-stack")).toBe(1);
    expect(decode(JSON.stringify(p)).hints).toEqual({ pinPull: { "the-dam": 2, "the-stack": 1 } });
  });

  it("has a slug for every version 1 number of a mode that still has those levels", () => {
    // Pull the Pin's version 1 levels are gone, and so is its table.
    expect(V1_IDS.pinPull).toBeUndefined();
    // Save the Clawd kept fifteen of its sixteen, and each slug is a level of the campaign now.
    expect(Object.keys(V1_IDS.saveDog).length).toBe(15);
    expect(V1_IDS.saveDog["10"]).toBeUndefined();
    const campaign = new Set(load<{ id: string }>(folderOf("saveDog")).map((level) => level.id));
    for (const slug of Object.values(V1_IDS.saveDog)) expect(campaign.has(slug), slug).toBe(true);
    for (const ids of Object.values(V1_IDS)) {
      for (const [number, slug] of Object.entries(ids)) {
        expect(number).toMatch(/^\d\d$/);
        expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
      expect(new Set(Object.values(ids)).size).toBe(Object.keys(ids).length);
    }
  });
});
