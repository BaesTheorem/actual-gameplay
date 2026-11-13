// The daily level's dates and its streak.
import { describe, expect, it } from "vitest";
import { addDays, dateWords, localDate, streakWords } from "../src/app/daily";
import { dailyResult, dailyStreak, decode, recordDaily } from "../src/app/store";

describe("dates", () => {
  it("writes a moment as the player's own calendar day", () => {
    expect(localDate(new Date(2026, 10, 13, 23, 59))).toBe("2026-11-13");
    expect(localDate(new Date(2027, 0, 1, 0, 0))).toBe("2027-01-01");
  });

  it("steps over month ends, year ends and leap days", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("leaves a date that is not real as it is", () => {
    expect(addDays("2026-02-30", 1)).toBe("2026-02-30");
    expect(addDays("soon", 1)).toBe("soon");
  });

  it("says a date and a streak in words", () => {
    expect(dateWords("2026-11-13")).toBe("13 November");
    expect(dateWords("2027-01-01")).toBe("1 January");
    expect(streakWords(0)).toBe("No streak yet");
    expect(streakWords(1)).toBe("1 day running");
    expect(streakWords(3)).toBe("3 days running");
  });
});

describe("the daily result and the streak", () => {
  const cleared = (...dates: string[]) => {
    const progress = decode(null);
    for (const date of dates) recordDaily(progress, "tower", date, 2, 40);
    return progress;
  };

  it("keeps the best of a day's tries", () => {
    const progress = decode(null);
    recordDaily(progress, "tower", "2026-11-13", 1, 30);
    recordDaily(progress, "tower", "2026-11-13", 3, 20);
    expect(dailyResult(progress, "tower", "2026-11-13")).toEqual({ stars: 3, final: 30 });
    expect(dailyResult(progress, "tower", "2026-11-12")).toBeUndefined();
  });

  it("counts days in a row back from today", () => {
    expect(dailyStreak(cleared(), "tower", "2026-11-13")).toBe(0);
    expect(dailyStreak(cleared("2026-11-13"), "tower", "2026-11-13")).toBe(1);
    expect(dailyStreak(cleared("2026-11-11", "2026-11-12", "2026-11-13"), "tower", "2026-11-13")).toBe(3);
  });

  it("lets yesterday's run stand until today is played", () => {
    expect(dailyStreak(cleared("2026-11-11", "2026-11-12"), "tower", "2026-11-13")).toBe(2);
  });

  it("ends a run at one missed day", () => {
    expect(dailyStreak(cleared("2026-11-10", "2026-11-11"), "tower", "2026-11-13")).toBe(0);
    expect(dailyStreak(cleared("2026-11-09", "2026-11-10", "2026-11-12", "2026-11-13"), "tower", "2026-11-13")).toBe(2);
  });

  it("runs across the end of a month and of a year", () => {
    expect(dailyStreak(cleared("2026-11-29", "2026-11-30", "2026-12-01"), "tower", "2026-12-01")).toBe(3);
    expect(dailyStreak(cleared("2026-12-30", "2026-12-31", "2027-01-01"), "tower", "2027-01-01")).toBe(3);
  });

  it("keeps each mode's days apart", () => {
    const progress = cleared("2026-11-13");
    expect(dailyStreak(progress, "pinPull", "2026-11-13")).toBe(0);
  });

  it("reads a save with daily results and one from before there were any", () => {
    const stored = JSON.stringify({ schemaVersion: 2, levels: {}, daily: { tower: { "2026-11-13": { stars: 3, final: 49 }, bad: "x" } } });
    expect(dailyResult(decode(stored), "tower", "2026-11-13")).toEqual({ stars: 3, final: 49 });
    expect(decode(JSON.stringify({ schemaVersion: 2, levels: {} })).daily).toEqual({});
  });
});
