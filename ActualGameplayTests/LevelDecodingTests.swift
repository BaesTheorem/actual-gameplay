import CoreGraphics
import XCTest
@testable import ActualGameplay

/// Every bundled level must decode and be internally consistent. This runs in the app host, so
/// `Bundle.main` is the app bundle and the folder reference is exactly what ships.
final class LevelDecodingTests: XCTestCase {
    private let canvas = CGRect(x: -1, y: -1, width: 404, height: 876)

    func testDrawLineLevelsAreConsistent() throws {
        let catalog = LevelCatalog.shared
        let ids = catalog.ids(for: .drawLine)
        XCTAssertEqual(ids.count, 12, "expected 12 draw-a-line levels, found \(ids)")
        XCTAssertEqual(Set(ids).count, ids.count, "duplicate level ids")

        for (index, id) in ids.enumerated() {
            let level = try catalog.load(DrawLevel.self, mode: .drawLine, index: index)
            XCTAssertEqual(level.id, id, "level id must match its filename")
            XCTAssertFalse(level.name.isEmpty)
            XCTAssertGreaterThan(level.inkBudget, 0)
            XCTAssertEqual(level.stars.count, 2, "\(id): two star thresholds")
            XCTAssertLessThan(level.stars[0], level.stars[1], "\(id): star thresholds ascending")
            XCTAssertLessThanOrEqual(level.stars[1], level.inkBudget, "\(id): thresholds within budget")

            let objectIDs = Set((level.dynamics ?? []).map(\.id))
            let targetIDs = Set((level.targets ?? []).map(\.id))
            let zoneIDs = Set((level.zones ?? []).map(\.id))
            XCTAssertEqual(objectIDs.count, level.dynamics?.count ?? 0, "\(id): duplicate object ids")
            for object in level.goal.objects { XCTAssertTrue(objectIDs.contains(object), "\(id): goal object \(object) missing") }
            for target in level.goal.targets { XCTAssertTrue(targetIDs.contains(target), "\(id): goal target \(target) missing") }
            for zone in level.goal.zones { XCTAssertTrue(zoneIDs.contains(zone), "\(id): goal zone \(zone) missing") }
            for joint in level.joints ?? [] {
                XCTAssertTrue(objectIDs.contains(joint.a), "\(id): joint body \(joint.a) missing")
                XCTAssertTrue(joint.b == "world" || objectIDs.contains(joint.b), "\(id): joint body \(joint.b) missing")
            }
            for mover in level.movers ?? [] { XCTAssertGreaterThan(mover.period, 0, "\(id): mover period") }

            for rect in (level.targets ?? []).map(\.cgRect) + (level.zones ?? []).map(\.cgRect)
                + (level.killers ?? []).map(\.cgRect) + (level.forbidden ?? []).map(\.cgRect) {
                XCTAssertTrue(canvas.contains(rect), "\(id): region \(rect) outside the canvas")
            }
            for object in level.dynamics ?? [] {
                XCTAssertTrue(canvas.contains(CGPoint(x: object.x, y: object.y)), "\(id): object \(object.id) outside the canvas")
            }
            for item in level.statics ?? [] where item.type == "chain" {
                XCTAssertGreaterThanOrEqual(item.points?.count ?? 0, 2, "\(id): chain needs two points")
            }

            let solution = try XCTUnwrap(level.solution, "\(id): every level stores a solution")
            XCTAssertFalse(solution.strokes.isEmpty, "\(id): solution has strokes")
            var cost: CGFloat = 0
            for stroke in solution.strokes {
                XCTAssertFalse(stroke.points.isEmpty, "\(id): empty solution stroke")
                for point in stroke.cgPoints {
                    XCTAssertTrue(DrawScene.drawArea.insetBy(dx: -8, dy: -8).contains(point), "\(id): solution point \(point) outside the draw area")
                }
                cost += StrokeBody.inkCost(rawLength: Geometry.polylineLength(stroke.cgPoints))
            }
            XCTAssertLessThanOrEqual(cost * 1.05, level.inkBudget, "\(id): solution needs \(cost) ink of \(level.inkBudget)")
            XCTAssertLessThanOrEqual(cost, level.stars[0] + 0.01, "\(id): the stored solution should earn three stars (\(cost) vs \(level.stars[0]))")
        }
    }

    func testPinPullLevelsAreConsistent() throws {
        let catalog = LevelCatalog.shared
        let ids = catalog.ids(for: .pinPull)
        XCTAssertEqual(ids.count, 12, "expected 12 pin-pull levels, found \(ids)")
        XCTAssertEqual(Set(ids).count, ids.count, "duplicate level ids")
        let winConditions: Set<String> = ["treasureReachesHero", "heroReachesGoal", "treasureReachesGoal", "both"]

        for (index, id) in ids.enumerated() {
            let level = try catalog.load(PinLevel.self, mode: .pinPull, index: index)
            XCTAssertEqual(level.id, id, "level id must match its filename")
            XCTAssertFalse(level.name.isEmpty)
            XCTAssertTrue(winConditions.contains(level.winWhen), "\(id): unknown winWhen \(level.winWhen)")
            XCTAssertGreaterThan(level.parPins, 0, "\(id): par")
            XCTAssertLessThanOrEqual(level.totalParticles, 320, "\(id): \(level.totalParticles) particles is over the budget")

            let pinIDs = level.pins.map(\.id)
            XCTAssertEqual(Set(pinIDs).count, pinIDs.count, "\(id): duplicate pin ids")
            for pin in level.pins {
                XCTAssertTrue(pin.side == "left" || pin.side == "right", "\(id): pin \(pin.id) side")
                XCTAssertGreaterThan(pin.w, 0, "\(id): pin \(pin.id) width")
                XCTAssertTrue(canvas.contains(CGRect(x: pin.x, y: pin.y, width: pin.w, height: 14)), "\(id): pin \(pin.id) outside the canvas")
            }
            for pool in level.pools ?? [] {
                XCTAssertTrue(pool.liquid == "water" || pool.liquid == "lava", "\(id): pool liquid \(pool.liquid)")
                XCTAssertTrue(canvas.contains(pool.cgRect), "\(id): pool outside the canvas")
            }
            for rect in (level.walls ?? []).map(\.cgRect) + (level.drains ?? []).map(\.cgRect) {
                XCTAssertTrue(canvas.contains(rect), "\(id): rect \(rect) outside the canvas")
            }
            for pin in level.pins {
                let bar = CGRect(x: pin.x, y: pin.y, width: pin.w, height: 14).insetBy(dx: 0.5, dy: 0.5)
                for wall in (level.walls ?? []).map(\.cgRect) where bar.intersects(wall) {
                    XCTFail("\(id): pin \(pin.id) passes through a wall at \(wall)")
                }
            }

            let needsHero = level.winWhen != "treasureReachesGoal"
            let needsTreasure = level.winWhen != "heroReachesGoal"
            let needsGoal = level.winWhen == "heroReachesGoal" || level.winWhen == "treasureReachesGoal" || level.winWhen == "both"
            if needsHero { XCTAssertNotNil(level.actors.hero, "\(id): win condition needs a hero") }
            if needsTreasure { XCTAssertNotNil(level.actors.treasure, "\(id): win condition needs treasure") }
            if needsGoal { XCTAssertNotNil(level.actors.goal, "\(id): win condition needs a goal") }

            let solution = try XCTUnwrap(level.solution, "\(id): every level stores a solution")
            XCTAssertFalse(solution.isEmpty, "\(id): solution has pulls")
            XCTAssertEqual(Set(solution).count, solution.count, "\(id): solution pulls a pin twice")
            for pinID in solution { XCTAssertTrue(pinIDs.contains(pinID), "\(id): solution pin \(pinID) missing") }
            XCTAssertLessThanOrEqual(solution.count, level.parPins, "\(id): the stored solution should earn three stars")
        }
    }
}
