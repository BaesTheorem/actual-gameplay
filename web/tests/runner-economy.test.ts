import { describe, expect, it } from "vitest";
import { baked, design, render } from "../scripts/runner-economy";
import { decode } from "../src/app/store";
import { FinaleFight, RunnerEconomy, Upgrade } from "../src/sim/runner";

describe("runner economy", () => {
  it("has four upgrades, a price for every level, and prices that climb", () => {
    expect(Upgrade.allCases).toEqual(["startCrowd", "memberPower", "fireRate", "coinMultiplier"]);
    for (const upgrade of Upgrade.allCases) {
      const tiers = Upgrade.tiers(upgrade);
      expect(tiers.length, upgrade).toBe(Upgrade.maxLevel(upgrade));
      for (let i = 0; i + 1 < tiers.length; i++) {
        const a = tiers[i]!, b = tiers[i + 1]!;
        expect(b.cost, `${upgrade} prices must climb`).toBeGreaterThan(a.cost);
        expect(b.run, `${upgrade} is bought in order`).toBeGreaterThanOrEqual(a.run);
      }
      expect(tiers.every((t) => t.gain > 0), `${upgrade}: every level buys something`).toBe(true);
      expect(Upgrade.cost(upgrade, 99)).toBe(tiers[tiers.length - 1]?.cost);
    }
  });

  // A level costs some wins' worth of the run it is meant for: never a fraction of one purse,
  // and never a grind of a hundred.
  it("prices each level at a sane share of its run's income", () => {
    for (const upgrade of Upgrade.allCases) {
      Upgrade.tiers(upgrade).forEach((tier, level) => {
        const purses = tier.cost / RunnerEconomy.purse(tier.run - 1);
        expect(purses, `${upgrade} level ${level + 1}`).toBeGreaterThanOrEqual(1.5);
        expect(purses, `${upgrade} level ${level + 1}`).toBeLessThanOrEqual(80);
      });
    }
  });

  it("follows the upgrade curves", () => {
    const base = RunnerEconomy.base;
    expect([base.startCrowd, base.memberPower, base.fireRate, base.coinMultiplier]).toEqual([5, 1, 1, 1]);
    const maxed = new RunnerEconomy({ startCrowd: 20, memberPower: 10, coinMultiplier: 10, fireRate: 10 });
    expect(maxed.startCrowd).toBe(45);
    expect(maxed.memberPower).toBeCloseTo(2.5, 9);
    expect(maxed.fireRate).toBeCloseTo(2, 9);
    expect(maxed.coinMultiplier).toBeCloseTo(3, 9);
    expect(Upgrade.maxLevel("fireRate")).toBe(10);
    expect(Upgrade.effectText("fireRate", 3)).toBe("130% fire rate");
  });

  it("pays coins by the run, the stars, the crates and the bonus", () => {
    const base = RunnerEconomy.base;
    expect(base.coins(0, 3)).toBe(30);
    expect(base.coins(0, 1)).toBe(15);
    expect(base.coins(10, 2)).toBe(45);
    expect(base.coins(0, 3, 12)).toBe(42);
    expect(base.consolation(12)).toBe(12);
    const bonus = new RunnerEconomy({ coinMultiplier: 5 });
    expect(bonus.coins(10, 3)).toBe(120);
    expect(bonus.consolation(12)).toBe(24);
    expect(base.consolation(0)).toBe(0);
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
    expect(FinaleFight.survivors(25, 20, 1)).toBe(5);
    expect(FinaleFight.survivors(25, 20, 1.15)).toBe(8);
    expect(FinaleFight.survivors(80, 60, 1)).toBe(20);
    expect(FinaleFight.survivors(80, 60, 1.15)).toBe(28);
    expect(FinaleFight.survivors(20, 25, 1)).toBe(0);
  });

  it("reads an old save with its coins, its run and its three upgrades, and the new one at 0", () => {
    const old = { schemaVersion: 2, levels: {}, runner: { level: 41, bestLevel: 41, coins: 730, upgrades: { startCrowd: 4, memberPower: 2, coinMultiplier: 1 } } };
    const runner = decode(JSON.stringify(old)).runner;
    expect(runner).toEqual(old.runner);
    const economy = new RunnerEconomy(runner.upgrades);
    expect(Upgrade.allCases.map((upgrade) => economy.level(upgrade))).toEqual([4, 2, 0, 1]);
    expect(economy.fireRate).toBe(1);
    expect(economy.startCrowd).toBe(13);
    // A version 1 file keeps them too.
    const v1 = decode(JSON.stringify({ schemaVersion: 1, runner: old.runner })).runner;
    expect(v1).toEqual(old.runner);
  });

  // The script plays about 145000 runs, which takes 20 to 40 seconds. The simulation is the
  // same arithmetic on every processor, so the tables are compared exactly.
  it("holds the tier tables scripts/runner-economy.ts works out", { timeout: 600_000 }, () => {
    const { tables } = design();
    expect(render(baked())).toBe(render(tables));
    for (const upgrade of Upgrade.allCases) expect(Upgrade.tiers(upgrade), upgrade).toEqual(tables[upgrade]);
  });
});
