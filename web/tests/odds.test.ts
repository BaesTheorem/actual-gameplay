import { describe, expect, it } from "vitest";
import { oddsText } from "../src/app/odds";

const pulls = { tries: "pulls", win: "win" }, doodles = { tries: "doodles", win: "survive" };
const stat = (randomWin: number, sample = 48, exact = false) => ({ randomWin, sample, exact });

describe("the measured difficulty in words", () => {
  it("says ONLY under a half", () => {
    const text = oddsText(stat(0.08, 19, true), pulls);
    expect(text.big).toBe("ONLY 8%");
    expect(text.small).toBe("of random pulls win");
    expect(text.tone).toBe("hard");
    expect(text.tag).toBe("8%");
    expect(text.lost).toBe("92% of random pulls fail here too.");
    expect(text.won).toBe("Random pulls win this 8% of the time. You are not random.");
  });

  it("uses the mode's own words", () => {
    const text = oddsText(stat(0.125), doodles);
    expect(text.big).toBe("ONLY 13%");
    expect(text.small).toBe("of random doodles survive");
    expect(text.lost).toBe("87% of random doodles fail here too.");
    expect(text.won).toBe("Random doodles survive this 13% of the time. You are not random.");
  });

  it("says UNDER one win in the sample when no random try won", () => {
    const text = oddsText(stat(0, 48), doodles);
    expect(text.big).toBe("UNDER 2%");
    expect(text.small).toBe("of random doodles survive");
    expect(text.tag).toBe("<2%");
    expect(text.lost).toBe("Over 98% of random doodles fail here too.");
    expect(text.won).toBe("Random doodles survive this less than 2% of the time. You are not random.");
    expect(oddsText(stat(0, 300), pulls).big).toBe("UNDER 1%");
  });

  it("never shows a share that won as nothing", () => {
    const text = oddsText(stat(0.004, 400, true), pulls);
    expect(text.big).toBe("UNDER 1%");
    expect(text.tag).toBe("<1%");
  });

  it("calls a level random play wins half the time a warm-up", () => {
    const text = oddsText(stat(0.62), pulls);
    expect(text.big).toBe("WARM-UP");
    expect(text.small).toBe("62% of random pulls win");
    expect(text.tone).toBe("warm");
    expect(text.tag).toBeNull();
    expect(text.lost).toBe("38% of random pulls fail here too.");
    expect(text.won).toBeNull();
    expect(oddsText(stat(0.5), pulls).big).toBe("WARM-UP");
    expect(oddsText(stat(0.49), pulls).big).toBe("ONLY 49%");
    expect(oddsText(stat(1, 3, true), pulls).lost).toBeNull();
  });

  it("tags a tile when the share shows as 10% or less", () => {
    expect(oddsText(stat(0.03), pulls).tag).toBe("3%");
    expect(oddsText(stat(0.1), pulls).tag).toBe("10%");
    // Five of 48 shows as 10% on the sticker, so the tile says 10% too.
    expect(oddsText(stat(0.104167), doodles).tag).toBe("10%");
    expect(oddsText(stat(0.105), doodles).tag).toBeNull();
    expect(oddsText(stat(0.33), pulls).tag).toBeNull();
  });

  it("never speaks of players", () => {
    for (const share of [0, 0.004, 0.08, 0.3, 0.62, 1]) {
      const text = oddsText(stat(share), doodles);
      for (const line of [text.big, text.small, text.tag, text.lost, text.won]) expect(line ?? "").not.toMatch(/player|people|!/i);
    }
  });
});
