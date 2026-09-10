import CoreGraphics
import Foundation

/// A stored solution for any stroke-drawing level: strokes with optional delays.
struct StrokeSolution: Decodable {
    struct Stroke: Decodable {
        var delay: Double?
        var points: [[CGFloat]]
        var cgPoints: [CGPoint] { points.map { CGPoint(x: $0[0], y: $0[1]) } }
    }

    var delay: Double?
    var strokes: [Stroke]
    var waitSeconds: Double?
    var totalLength: CGFloat { strokes.reduce(0) { $0 + Geometry.polylineLength($1.cgPoints) } }
}

/// Static geometry shared by stroke levels. Rects give their bottom-left corner.
struct LevelStatic: Decodable {
    var type: String
    var x: CGFloat?
    var y: CGFloat?
    var w: CGFloat?
    var h: CGFloat?
    var r: CGFloat?
    var points: [[CGFloat]]?
    /// False for scenery with no physics body.
    var solid: Bool?
    /// Terrain look: grass (default), stone, dirt, purple.
    var skin: String?
}

struct LevelRect: Decodable {
    var x: CGFloat
    var y: CGFloat
    var w: CGFloat
    var h: CGFloat
    var cgRect: CGRect { CGRect(x: x, y: y, width: w, height: h) }
}

/// A rigid nudge applied to a replayed stroke: shift it, or scale it about its own centroid.
struct StrokeTransform {
    var dx: CGFloat = 0
    var dy: CGFloat = 0
    var scale: CGFloat = 1

    static let identity = StrokeTransform()

    func apply(to points: [CGPoint]) -> [CGPoint] {
        let center = Geometry.centroid(points)
        return points.map { center + ($0 - center) * scale + CGPoint(x: dx, y: dy) }
    }
}
