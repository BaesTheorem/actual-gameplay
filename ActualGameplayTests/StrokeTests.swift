import CoreGraphics
import XCTest
@testable import ActualGameplay

final class StrokeTests: XCTestCase {
    func testSimplifyCollapsesNearlyStraightLine() {
        var points: [CGPoint] = []
        for i in 0...100 {
            let jitter: CGFloat = (i % 2 == 0) ? 0.4 : -0.4
            points.append(CGPoint(x: CGFloat(i) * 2, y: 100 + jitter))
        }
        let simplified = Geometry.simplify(points, epsilon: 1.5)
        XCTAssertEqual(simplified.count, 2)
        XCTAssertEqual(simplified.first, points.first)
        XCTAssertEqual(simplified.last, points.last)
    }

    func testSimplifyKeepsCorners() {
        let corner = [CGPoint(x: 0, y: 0), CGPoint(x: 50, y: 0), CGPoint(x: 100, y: 0), CGPoint(x: 100, y: 50), CGPoint(x: 100, y: 100)]
        let simplified = Geometry.simplify(corner, epsilon: 1.5)
        XCTAssertEqual(simplified, [CGPoint(x: 0, y: 0), CGPoint(x: 100, y: 0), CGPoint(x: 100, y: 100)])
    }

    func testMergeShortSegmentsKeepsEndpoints() {
        let points = [CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 0), CGPoint(x: 2, y: 0), CGPoint(x: 30, y: 0), CGPoint(x: 31, y: 0)]
        let merged = Geometry.mergeShortSegments(points, minLength: 4)
        XCTAssertEqual(merged.first, points.first)
        XCTAssertEqual(merged.last, points.last)
        for i in 1..<merged.count {
            XCTAssertGreaterThanOrEqual(merged[i - 1].distance(to: merged[i]), 4 - 0.001)
        }
    }

    func testResampleSpacing() {
        let line = [CGPoint(x: 0, y: 0), CGPoint(x: 100, y: 0), CGPoint(x: 100, y: 40)]
        let samples = Geometry.resample(line, spacing: 6)
        XCTAssertEqual(samples.first, line.first)
        XCTAssertEqual(samples.last, line.last)
        for i in 1..<samples.count {
            XCTAssertLessThanOrEqual(samples[i - 1].distance(to: samples[i]), 6.001)
        }
        XCTAssertEqual(Geometry.polylineLength(line), 140)
    }

    func testPrepareTurnsTinyStrokeIntoDot() {
        let tiny = [CGPoint(x: 10, y: 10), CGPoint(x: 12, y: 11), CGPoint(x: 13, y: 12)]
        XCTAssertEqual(StrokeBody.prepare(tiny).count, 1)
        XCTAssertEqual(StrokeBody.inkCost(rawLength: Geometry.polylineLength(tiny)), StrokeBody.dotCost)
    }
}
