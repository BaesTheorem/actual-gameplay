import CoreGraphics
import XCTest
@testable import ActualGameplay

final class RunnerGeneratorTests: XCTestCase {
    func testTracksAreDeterministic() {
        let a = RunnerGenerator.makeTrack(level: 7, startCrowd: 5)
        let b = RunnerGenerator.makeTrack(level: 7, startCrowd: 5)
        XCTAssertEqual(a, b)
        XCTAssertNotEqual(a, RunnerGenerator.makeTrack(level: 8, startCrowd: 5))
    }

    func testEveryLevelIsSurvivableAtBaseUpgrades() {
        let economy = RunnerEconomy.base
        for level in 0..<300 {
            let track = RunnerGenerator.makeTrack(level: level, startCrowd: economy.startCrowd)
            XCTAssertGreaterThan(track.bestPath, track.finale.strength, "level \(level): finale \(track.finale) vs best \(track.bestPath)")
            XCTAssertGreaterThanOrEqual(track.segments.count, 6)
            XCTAssertLessThanOrEqual(track.segments.count, 14)
            XCTAssertGreaterThan(track.finaleZ, track.segments.last?.z ?? 0)
            var lastZ: CGFloat = 0
            for segment in track.segments {
                XCTAssertGreaterThan(segment.z, lastZ, "level \(level): segments must move away")
                lastZ = segment.z
                if case .gates(let pair) = segment {
                    XCTAssertTrue(pair.left.isGood || pair.right.isGood, "level \(level): a gate pair needs a good side")
                    XCTAssertNotEqual(pair.left, pair.right, "level \(level): identical gates")
                }
                if case .obstacle(let obstacle) = segment {
                    let span = obstacle.hazard.span(at: 0)
                    XCTAssertGreaterThanOrEqual(span.lowerBound, -1.1)
                    XCTAssertLessThanOrEqual(span.upperBound, 1.1)
                    XCTAssertGreaterThanOrEqual(level, 2, "obstacles only from level 3 on")
                }
            }
            if (level + 1) % 5 == 0 {
                if case .boss = track.finale {} else { XCTFail("level \(level) should be a boss") }
            }
        }
    }

    func testBetterGateChangesSidesAtLeastEveryThirdPair() {
        for level in 0..<300 {
            let track = RunnerGenerator.makeTrack(level: level, startCrowd: 5)
            var running = 5
            var lastSide = 0
            var run = 0
            for segment in track.segments {
                guard case .gates(let pair) = segment else { continue }
                let side = pair.right.apply(running) >= pair.left.apply(running) ? 1 : -1
                run = side == lastSide ? run + 1 : 1
                lastSide = side
                XCTAssertLessThanOrEqual(run, 2, "level \(level): better gate stayed on one side too long")
                running = max(pair.left.apply(running), pair.right.apply(running))
            }
        }
    }

    func testGateOps() {
        XCTAssertEqual(GateOp.add(5).apply(10), 15)
        XCTAssertEqual(GateOp.subtract(12).apply(10), 0)
        XCTAssertEqual(GateOp.multiply(3).apply(4), 12)
        XCTAssertEqual(GateOp.divide(2).apply(9), 4)
        XCTAssertTrue(GateOp.multiply(2).isGood)
        XCTAssertFalse(GateOp.divide(2).isGood)
    }

    func testEconomyCurves() {
        let base = RunnerEconomy.base
        XCTAssertEqual(base.startCrowd, 5)
        XCTAssertEqual(base.memberPower, 1)
        XCTAssertEqual(base.coins(forSurvivors: 10), 20)
        let maxed = RunnerEconomy(levels: ["startCrowd": 20, "memberPower": 10, "coinMultiplier": 10])
        XCTAssertEqual(maxed.startCrowd, 45)
        XCTAssertEqual(maxed.memberPower, 2.5, accuracy: 1e-9)
        for upgrade in RunnerEconomy.Upgrade.allCases {
            XCTAssertLessThan(upgrade.cost(atLevel: 0), upgrade.cost(atLevel: 3), "\(upgrade) costs should climb")
        }
    }
}
