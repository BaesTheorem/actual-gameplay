import CoreGraphics
import XCTest
@testable import ActualGameplay

/// Every bundled level must decode and be internally consistent. This runs in the app host, so
/// `Bundle.main` is the app bundle and the folder reference is exactly what ships.
final class LevelDecodingTests: XCTestCase {
    private let canvas = CGRect(x: -1, y: -1, width: 404, height: 876)

    func testSaveDogLevelsAreConsistent() throws {
        let catalog = LevelCatalog.shared
        let ids = catalog.ids(for: .saveDog)
        XCTAssertEqual(ids.count, 12, "expected 12 Save the Dog levels, found \(ids)")
        XCTAssertEqual(Set(ids).count, ids.count, "duplicate level ids")

        for (index, id) in ids.enumerated() {
            let level = try catalog.load(DogLevel.self, mode: .saveDog, index: index)
            XCTAssertEqual(level.id, id, "level id must match its filename")
            XCTAssertFalse(level.name.isEmpty)
            XCTAssertGreaterThan(level.inkBudget, 0)
            XCTAssertEqual(level.stars.count, 2, "\(id): two star thresholds")
            XCTAssertLessThan(level.stars[0], level.stars[1], "\(id): star thresholds ascending")
            XCTAssertLessThanOrEqual(level.stars[1], level.inkBudget, "\(id): thresholds within budget")
            XCTAssertFalse(level.dogs.isEmpty, "\(id): needs a dog")
            XCTAssertFalse(level.hives.isEmpty, "\(id): needs bees")
            XCTAssertLessThanOrEqual(level.totalBees, 60, "\(id): \(level.totalBees) bees is a lot of bodies")
            let dogIDs = level.dogs.map(\.id)
            XCTAssertEqual(Set(dogIDs).count, dogIDs.count, "\(id): duplicate dog ids")
            for dog in level.dogs {
                XCTAssertTrue(canvas.contains(CGPoint(x: dog.x, y: dog.y)), "\(id): dog \(dog.id) outside the canvas")
            }
            for hive in level.hives {
                XCTAssertTrue(GameSceneBase.playfield.insetBy(dx: 8, dy: 8).contains(CGPoint(x: hive.x, y: hive.y)), "\(id): hive outside the playfield")
                XCTAssertGreaterThan(hive.count, 0)
            }
            for rect in (level.killers ?? []).map(\.cgRect) + (level.forbidden ?? []).map(\.cgRect) {
                XCTAssertTrue(canvas.contains(rect), "\(id): region \(rect) outside the canvas")
            }
            for saw in level.saws ?? [] {
                XCTAssertTrue(canvas.contains(CGPoint(x: saw.x, y: saw.y)), "\(id): saw outside the canvas")
                XCTAssertGreaterThan(saw.r, 0)
            }
            for prop in level.props ?? [] {
                XCTAssertTrue(prop.shape == "ball" || prop.shape == "box", "\(id): prop shape \(prop.shape)")
                XCTAssertTrue(canvas.contains(CGPoint(x: prop.x, y: prop.y)), "\(id): prop \(prop.id) outside the canvas")
            }
            for decor in level.decor ?? [] {
                XCTAssertNotNil(Sprite(rawValue: decor.sprite), "\(id): unknown decor sprite \(decor.sprite)")
            }
            let solution = try XCTUnwrap(level.solution, "\(id): every level stores a solution")
            XCTAssertFalse(solution.strokes.isEmpty, "\(id): solution has strokes")
            var cost: CGFloat = 0
            for stroke in solution.strokes {
                XCTAssertFalse(stroke.points.isEmpty, "\(id): empty solution stroke")
                for point in stroke.cgPoints {
                    XCTAssertTrue(StrokeScene.drawArea.insetBy(dx: -8, dy: -8).contains(point), "\(id): solution point \(point) outside the draw area")
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
                if pool.liquid == "lava", let treasure = level.actors.treasure {
                    let box = CGRect(x: treasure.x - 14, y: treasure.y - 12, width: 28, height: 24)
                    XCTAssertFalse(pool.cgRect.intersects(box), "\(id): the treasure starts inside lava, which melts it")
                }
            }
            for rect in (level.walls ?? []).map(\.cgRect) + (level.drains ?? []).map(\.cgRect) + (level.grates ?? []).map(\.cgRect) {
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
