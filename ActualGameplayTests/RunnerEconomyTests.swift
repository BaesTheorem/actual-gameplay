import XCTest
@testable import ActualGameplay

final class RunnerEconomyTests: XCTestCase {
    func testPriceTablesCoverEveryLevelAndClimb() {
        for upgrade in RunnerEconomy.Upgrade.allCases {
            let tiers = upgrade.tiers
            XCTAssertEqual(tiers.count, upgrade.maxLevel, "\(upgrade)")
            for (a, b) in zip(tiers, tiers.dropFirst()) {
                XCTAssertGreaterThan(b.cost, a.cost, "\(upgrade) prices must climb")
                XCTAssertGreaterThanOrEqual(b.run, a.run, "\(upgrade) is bought in order")
            }
            XCTAssertTrue(tiers.allSatisfy { $0.gain > 0 }, "\(upgrade): every level buys something")
        }
    }

    /// A level costs a handful of three-star purses of the run it is meant for, never a fraction
    /// of one (the old curve) and never a grind.
    func testEachLevelCostsASaneShareOfItsRunsIncome() {
        for upgrade in RunnerEconomy.Upgrade.allCases {
            for (level, tier) in upgrade.tiers.enumerated() {
                let purses = Double(tier.cost) / Double(RunnerEconomy.purse(forLevel: tier.run - 1))
                XCTAssertGreaterThanOrEqual(purses, 2, "\(upgrade) level \(level + 1)")
                XCTAssertLessThanOrEqual(purses, 40, "\(upgrade) level \(level + 1)")
            }
        }
    }

    func testTotalCostToMaxIsInRange() {
        let total = { (u: RunnerEconomy.Upgrade) in u.tiers.reduce(0) { $0 + $1.cost } }
        XCTAssertTrue((20_000...200_000).contains(total(.startCrowd)), "\(total(.startCrowd))")
        XCTAssertTrue((20_000...200_000).contains(total(.memberPower)), "\(total(.memberPower))")
        XCTAssertTrue((10_000...100_000).contains(total(.coinMultiplier)), "\(total(.coinMultiplier))")
        XCTAssertEqual(RunnerEconomy.Upgrade.startCrowd.cost(atLevel: 99), RunnerEconomy.Upgrade.startCrowd.tiers.last?.cost)
    }

    func testCoinsFollowTheRunTheStarsAndTheBonus() {
        let base = RunnerEconomy.base
        XCTAssertEqual(base.coins(level: 0, stars: 3), 30)
        XCTAssertEqual(base.coins(level: 0, stars: 1), 15)
        XCTAssertEqual(base.coins(level: 10, stars: 2), 45)
        let bonus = RunnerEconomy(levels: ["coinMultiplier": 5])
        XCTAssertEqual(bonus.coins(level: 10, stars: 3), 120)
    }

    func testPreviewNamesWhatTheNextLevelBuys() {
        for upgrade in RunnerEconomy.Upgrade.allCases {
            for level in 0..<upgrade.maxLevel {
                let text = upgrade.previewText(atLevel: level) ?? ""
                XCTAssertTrue(text.hasSuffix("at run \(upgrade.tiers[level].run)"), text)
                XCTAssertTrue(text.contains(upgrade == .coinMultiplier ? "coins a win" : "% odds"), text)
            }
            XCTAssertNil(upgrade.previewText(atLevel: upgrade.maxLevel))
        }
    }

    func testMemberStrengthCountsInSmallFights() {
        // The old fight rounded every tick's loss up to a whole runner, so 1.15x changed nothing here.
        XCTAssertEqual(FinaleFight.survivors(mine: 25, theirs: 20, power: 1), 5)
        XCTAssertEqual(FinaleFight.survivors(mine: 25, theirs: 20, power: 1.15), 8)
        XCTAssertEqual(FinaleFight.survivors(mine: 80, theirs: 60, power: 1), 20)
        XCTAssertEqual(FinaleFight.survivors(mine: 80, theirs: 60, power: 1.15), 28)
        XCTAssertEqual(FinaleFight.survivors(mine: 20, theirs: 25, power: 1), 0)
    }

    func testFightAtPowerOneIsTheOldRule() {
        for mine in 1...200 {
            for theirs in stride(from: 1, through: 200, by: 7) {
                var old = (mine: mine, theirs: theirs)
                var expected = 0
                while true {
                    let slice = max(1, Int((Double(max(old.mine, old.theirs)) / 30).rounded(.up)))
                    let loss = slice
                    let next = (mine: max(0, old.mine - loss), theirs: max(0, old.theirs - slice))
                    if next.theirs <= 0 && next.mine > 0 { expected = next.mine; break }
                    if next.mine <= 0 && next.theirs > 0 { expected = 0; break }
                    if next.mine <= 0 && next.theirs <= 0 { expected = old.mine >= old.theirs ? 1 : 0; break }
                    old = next
                }
                XCTAssertEqual(FinaleFight.survivors(mine: mine, theirs: theirs, power: 1), expected, "\(mine) v \(theirs)")
            }
        }
    }
}
