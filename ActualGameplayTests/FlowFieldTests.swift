import CoreGraphics
import XCTest
@testable import ActualGameplay

final class FlowFieldTests: XCTestCase {
    private let bounds = CGRect(x: 0, y: 0, width: 300, height: 300)
    private let dog = (center: CGPoint(x: 150, y: 40), radius: CGFloat(18))

    /// Follow the field from `start` for a while; true if it arrives within reach of the dog.
    private func arrives(_ field: FlowField, from start: CGPoint) -> Bool {
        var p = start
        for _ in 0..<600 {
            guard let d = field.direction(at: p) else { return false }
            p = CGPoint(x: p.x + d.dx * 3, y: p.y + d.dy * 3)
            if p.distance(to: dog.center) <= dog.radius + 8 { return true }
        }
        return false
    }

    func testOpenFieldRoutesStraightToTheDog() {
        let field = FlowField(bounds: bounds)
        field.rebuild(solids: [], targets: [dog], clearance: 6)
        XCTAssertTrue(arrives(field, from: CGPoint(x: 150, y: 280)))
        XCTAssertTrue(arrives(field, from: CGPoint(x: 20, y: 200)))
    }

    func testClosedShieldLeavesNoRoute() {
        // A box around the dog: floor plus three strokes.
        let floor = Solid.rect(CGRect(x: 0, y: 0, width: 300, height: 20))
        let left = Solid.segment(CGPoint(x: 100, y: 20), CGPoint(x: 100, y: 120), radius: 4)
        let top = Solid.segment(CGPoint(x: 100, y: 120), CGPoint(x: 200, y: 120), radius: 4)
        let right = Solid.segment(CGPoint(x: 200, y: 120), CGPoint(x: 200, y: 20), radius: 4)
        let field = FlowField(bounds: bounds)
        field.rebuild(solids: [floor, left, top, right], targets: [dog], clearance: 6)
        XCTAssertNil(field.direction(at: CGPoint(x: 150, y: 280)), "outside the box there must be no route")
        XCTAssertNotNil(field.direction(at: CGPoint(x: 150, y: 90)), "inside the box the dog is reachable")
        XCTAssertFalse(arrives(field, from: CGPoint(x: 150, y: 280)))
    }

    func testAGapWideEnoughForABeeIsFound() {
        let floor = Solid.rect(CGRect(x: 0, y: 0, width: 300, height: 20))
        let left = Solid.segment(CGPoint(x: 100, y: 20), CGPoint(x: 100, y: 120), radius: 4)
        // The top has a 30 pt hole in it.
        let topA = Solid.segment(CGPoint(x: 100, y: 120), CGPoint(x: 135, y: 120), radius: 4)
        let topB = Solid.segment(CGPoint(x: 165, y: 120), CGPoint(x: 200, y: 120), radius: 4)
        let right = Solid.segment(CGPoint(x: 200, y: 120), CGPoint(x: 200, y: 20), radius: 4)
        let field = FlowField(bounds: bounds)
        field.rebuild(solids: [floor, left, topA, topB, right], targets: [dog], clearance: 6)
        XCTAssertTrue(arrives(field, from: CGPoint(x: 40, y: 280)), "the bee should route through the hole")
    }

    func testAGapTooNarrowForABeeIsNotARoute() {
        let floor = Solid.rect(CGRect(x: 0, y: 0, width: 300, height: 20))
        let left = Solid.segment(CGPoint(x: 100, y: 20), CGPoint(x: 100, y: 120), radius: 4)
        // 12 pt between stroke centres: 4 pt of ink each side leaves 4 pt of air, not a bee's 12.
        let topA = Solid.segment(CGPoint(x: 100, y: 120), CGPoint(x: 144, y: 120), radius: 4)
        let topB = Solid.segment(CGPoint(x: 156, y: 120), CGPoint(x: 200, y: 120), radius: 4)
        let right = Solid.segment(CGPoint(x: 200, y: 120), CGPoint(x: 200, y: 20), radius: 4)
        let field = FlowField(bounds: bounds)
        field.rebuild(solids: [floor, left, topA, topB, right], targets: [dog], clearance: 6)
        XCTAssertNil(field.direction(at: CGPoint(x: 150, y: 280)))
    }

    func testRoutesAroundAWallInsteadOfThroughIt() {
        let wall = Solid.rect(CGRect(x: 60, y: 100, width: 180, height: 14))
        let field = FlowField(bounds: bounds)
        field.rebuild(solids: [wall], targets: [dog], clearance: 6)
        var p = CGPoint(x: 150, y: 250)
        var crossedThroughWall = false
        for _ in 0..<600 {
            guard let d = field.direction(at: p) else { break }
            p = CGPoint(x: p.x + d.dx * 3, y: p.y + d.dy * 3)
            if CGRect(x: 60, y: 100, width: 180, height: 14).insetBy(dx: -2, dy: -2).contains(p) { crossedThroughWall = true }
            if p.distance(to: dog.center) <= dog.radius + 8 { break }
        }
        XCTAssertFalse(crossedThroughWall)
        XCTAssertLessThanOrEqual(p.distance(to: dog.center), dog.radius + 8, "should still arrive, around the end of the wall")
    }
}
