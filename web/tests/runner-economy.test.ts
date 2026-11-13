import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FinaleFight, RunnerEconomy, Upgrade } from "../src/sim/runner";

describe("runner economy", () => {
  it("has a price for every level, and prices climb", () => {
    for (const upgrade of Upgrade.allCases) {
      const tiers = Upgrade.tiers(upgrade);
      expect(tiers.length, upgrade).toBe(Upgrade.maxLevel(upgrade));
      for (let i = 0; i + 1 < tiers.length; i++) {
        const a = tiers[i]!, b = tiers[i + 1]!;
        expect(b.cost, `${upgrade} prices must climb`).toBeGreaterThan(a.cost);
        expect(b.run, `${upgrade} is bought in order`).toBeGreaterThanOrEqual(a.run);
      }
      expect(tiers.every((t) => t.gain > 0), `${upgrade}: every level buys something`).toBe(true);
    }
  });

  // A level costs a handful of three-star purses of the run it is meant for, never a fraction
  // of one (the old curve) and never a grind.
  it("prices each level at a sane share of its run's income", () => {
    for (const upgrade of Upgrade.allCases) {
      Upgrade.tiers(upgrade).forEach((tier, level) => {
        const purses = tier.cost / RunnerEconomy.purse(tier.run - 1);
        expect(purses, `${upgrade} level ${level + 1}`).toBeGreaterThanOrEqual(2);
        expect(purses, `${upgrade} level ${level + 1}`).toBeLessThanOrEqual(40);
      });
    }
  });

  it("keeps the total cost to max in range", () => {
    const total = (u: Upgrade) => Upgrade.tiers(u).reduce((sum, t) => sum + t.cost, 0);
    const within = (n: number, lo: number, hi: number) => n >= lo && n <= hi;
    expect(within(total("startCrowd"), 20_000, 200_000), `${total("startCrowd")}`).toBe(true);
    expect(within(total("memberPower"), 20_000, 200_000), `${total("memberPower")}`).toBe(true);
    expect(within(total("coinMultiplier"), 10_000, 100_000), `${total("coinMultiplier")}`).toBe(true);
    const tiers = Upgrade.tiers("startCrowd");
    expect(Upgrade.cost("startCrowd", 99)).toBe(tiers[tiers.length - 1]?.cost);
  });

  it("pays coins by the run, the stars and the bonus", () => {
    const base = RunnerEconomy.base;
    expect(base.coins(0, 3)).toBe(30);
    expect(base.coins(0, 1)).toBe(15);
    expect(base.coins(10, 2)).toBe(45);
    const bonus = new RunnerEconomy({ coinMultiplier: 5 });
    expect(bonus.coins(10, 3)).toBe(120);
  });

  it("names what the next level buys", () => {
    for (const upgrade of Upgrade.allCases) {
      for (let level = 0; level < Upgrade.maxLevel(upgrade); level++) {
        const text = Upgrade.previewText(upgrade, level) ?? "";
        expect(text.endsWith(`at run ${Upgrade.tiers(upgrade)[level]!.run}`), text).toBe(true);
        expect(text.includes(upgrade === "coinMultiplier" ? "coins a win" : "% odds"), text).toBe(true);
      }
      expect(Upgrade.previewText(upgrade, Upgrade.maxLevel(upgrade))).toBeNull();
    }
  });

  it("counts member strength in small fights", () => {
    // The old fight rounded every tick's loss up to a whole runner, so 1.15x changed nothing here.
    expect(FinaleFight.survivors(25, 20, 1)).toBe(5);
    expect(FinaleFight.survivors(25, 20, 1.15)).toBe(8);
    expect(FinaleFight.survivors(80, 60, 1)).toBe(20);
    expect(FinaleFight.survivors(80, 60, 1.15)).toBe(28);
    expect(FinaleFight.survivors(20, 25, 1)).toBe(0);
  });

  it("fights by the old rule at power one", () => {
    for (let mine = 1; mine <= 200; mine++) {
      for (let theirs = 1; theirs <= 200; theirs += 7) {
        let old = { mine, theirs };
        let expected = 0;
        for (;;) {
          const slice = Math.max(1, Math.ceil(Math.max(old.mine, old.theirs) / 30));
          const loss = slice;
          const next = { mine: Math.max(0, old.mine - loss), theirs: Math.max(0, old.theirs - slice) };
          if (next.theirs <= 0 && next.mine > 0) { expected = next.mine; break; }
          if (next.mine <= 0 && next.theirs > 0) { expected = 0; break; }
          if (next.mine <= 0 && next.theirs <= 0) { expected = old.mine >= old.theirs ? 1 : 0; break; }
          old = next;
        }
        expect(FinaleFight.survivors(mine, theirs, 1), `${mine} v ${theirs}`).toBe(expected);
      }
    }
  });

  // Not in the iPhone tests: the tables here are a copy, so read the Swift file and compare.
  it("holds the same tier tables as RunnerEconomy.swift", () => {
    const swift = readFileSync(new URL("../../ActualGameplay/Sources/Runner/RunnerEconomy.swift", import.meta.url), "utf8");
    for (const upgrade of Upgrade.allCases) {
      const start = swift.indexOf(`static let ${upgrade}Tiers`);
      expect(start, upgrade).toBeGreaterThan(0);
      const block = swift.slice(start, swift.indexOf("]", start + 40));
      const rows = [...block.matchAll(/Tier\(cost: (\d+), run: (\d+), gain: ([\d.]+)\)/g)]
        .map((m) => ({ cost: Number(m[1]), run: Number(m[2]), gain: Number(m[3]) }));
      expect(rows.length, upgrade).toBe(Upgrade.maxLevel(upgrade));
      expect(Upgrade.tiers(upgrade), upgrade).toEqual(rows);
    }
  });
});
