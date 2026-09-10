import CoreGraphics
import XCTest
@testable import ActualGameplay

final class ProjectionTests: XCTestCase {
    func testDepthMovesUpAndShrinks() {
        var lastY: CGFloat = -1
        var lastScale: CGFloat = 2
        for z in stride(from: CGFloat(0), through: Projection.farZ, by: 2) {
            let p = Projection.point(x: 0, z: z)
            let s = Projection.scale(z)
            XCTAssertGreaterThan(p.y, lastY)
            XCTAssertLessThan(s, lastScale)
            XCTAssertEqual(p.x, Projection.centerX, accuracy: 1e-9)
            lastY = p.y
            lastScale = s
        }
        XCTAssertLessThan(Projection.point(x: 0, z: Projection.farZ).y, Projection.horizonY)
    }

    func testLaneEdgesConverge() {
        let nearLeft = Projection.point(x: -1, z: 0)
        let farLeft = Projection.point(x: -1, z: Projection.farZ)
        XCTAssertLessThan(nearLeft.x, farLeft.x)
        XCTAssertEqual(Projection.point(x: 1, z: 0).x - nearLeft.x, 2 * Projection.halfRoad, accuracy: 1e-9)
        XCTAssertEqual(Crowd.slot(0).dx, 0)
        XCTAssertGreaterThan(Crowd.slot(50).dx.magnitude + Crowd.slot(50).dz.magnitude, 0)
    }
}
