import CoreGraphics

/// Lane space to screen. x runs across the road in [-1, 1]; z is depth ahead of the camera in
/// lane units. A plain perspective divide gives the trapezoid road and depth-scaled sprites.
enum Projection {
    static let near: CGFloat = 6
    static let nearY: CGFloat = 140
    static let horizonY: CGFloat = 640
    static let halfRoad: CGFloat = 170
    static let centerX: CGFloat = 201
    static let farZ: CGFloat = 40
    /// Where the player's crowd sits, a little up the road so gates approach from above.
    static let anchorZ: CGFloat = 2

    static func scale(_ z: CGFloat) -> CGFloat { near / (near + max(z, -4)) }

    static func point(x: CGFloat, z: CGFloat) -> CGPoint {
        let s = scale(z)
        return CGPoint(x: centerX + x * halfRoad * s, y: nearY + (horizonY - nearY) * (1 - s))
    }

    /// Screen points per lane unit at depth z.
    static func laneWidth(at z: CGFloat) -> CGFloat { halfRoad * scale(z) }

    static var roadPolygon: [CGPoint] {
        [point(x: -1, z: 0), point(x: 1, z: 0), point(x: 1, z: farZ), point(x: -1, z: farZ)]
    }
}
