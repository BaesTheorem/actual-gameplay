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
}
