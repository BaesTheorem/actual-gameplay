import CoreGraphics
import XCTest
@testable import ActualGameplay

final class StrokeBodyTests: XCTestCase {
    func testSegmentQuadIsConvexAndCounterClockwise() {
        let quad = Geometry.segmentQuad(CGPoint(x: 0, y: 0), CGPoint(x: 30, y: 10), halfWidth: 4)
        XCTAssertEqual(quad.count, 4)
        XCTAssertTrue(Geometry.isConvex(quad))
        XCTAssertTrue(Geometry.isCounterClockwise(quad))
        XCTAssertEqual(Geometry.signedArea(quad), 8 * hypot(30, 10), accuracy: 0.01)
    }

    func testMassFollowsLength() {
        XCTAssertEqual(StrokeBody.mass(forLength: 200), 200 * 8 / 22_500, accuracy: 1e-9)
        XCTAssertEqual(StrokeBody.mass(forLength: 0), 8 * 8 / 22_500, accuracy: 1e-9)
    }

    func testNodeHasBodyCenteredOnCentroid() {
        let points = [CGPoint(x: 100, y: 100), CGPoint(x: 160, y: 100), CGPoint(x: 160, y: 160)]
        let node = StrokeBody.makeNode(points: points, dynamic: true)
        XCTAssertEqual(node.position, CGPoint(x: 140, y: 120))
        let body = try! XCTUnwrap(node.physicsBody)
        XCTAssertTrue(body.isDynamic)
        XCTAssertEqual(body.categoryBitMask, DrawCategory.drawn)
        XCTAssertEqual(body.mass, StrokeBody.mass(forLength: 120), accuracy: 1e-6)
    }

    func testPinnedNodeIsStatic() {
        let node = StrokeBody.makeNode(points: [CGPoint(x: 0, y: 0), CGPoint(x: 50, y: 0)], dynamic: false)
        XCTAssertEqual(node.physicsBody?.isDynamic, false)
    }

    func testDotNode() {
        let node = StrokeBody.makeNode(points: [CGPoint(x: 20, y: 30)], dynamic: true)
        XCTAssertEqual(node.position, CGPoint(x: 20, y: 30))
        XCTAssertEqual(node.physicsBody?.mass ?? 0, StrokeBody.mass(forLength: 0), accuracy: 1e-6)
    }
}
