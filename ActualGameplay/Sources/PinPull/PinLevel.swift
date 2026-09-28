import CoreGraphics
import Foundation

/// A pin-pull level. Canvas coordinates; rects give their bottom-left corner, actors their center.
/// Pins are bars 14 pt thick whose `y` is the bar's bottom edge before any tilt.
struct PinLevel: Decodable {
    struct Rect: Decodable {
        var x: CGFloat
        var y: CGFloat
        var w: CGFloat
        var h: CGFloat
        var cgRect: CGRect { CGRect(x: x, y: y, width: w, height: h) }
    }

    /// A thick tilted wall from (x1, y1) to (x2, y2). Zero-thickness edges let fast particles through.
    struct Slab: Decodable {
        var x1: CGFloat
        var y1: CGFloat
        var x2: CGFloat
        var y2: CGFloat
        var t: CGFloat?
    }

    struct Pin: Decodable {
        var id: String
        var x: CGFloat
        var y: CGFloat
        var w: CGFloat
        /// Which way the pin slides out, and where its knob sits: "left" or "right".
        var side: String
        /// Tilt in degrees about the bar's centre, counterclockwise. The pin slides out along its own length.
        var angle: CGFloat?

        var radians: CGFloat { (angle ?? 0) * .pi / 180 }
        var center: CGPoint { CGPoint(x: x + w / 2, y: y + PinNode.thickness / 2) }

        /// The bar's four corners in the scene, counterclockwise.
        var corners: [CGPoint] {
            let c = center, cs = cos(radians), sn = sin(radians)
            let hw = w / 2, ht = PinNode.thickness / 2
            return [CGPoint(x: -hw, y: -ht), CGPoint(x: hw, y: -ht), CGPoint(x: hw, y: ht), CGPoint(x: -hw, y: ht)].map { p in
                CGPoint(x: c.x + p.x * cs - p.y * sn, y: c.y + p.x * sn + p.y * cs)
            }
        }
    }

    struct Pool: Decodable {
        var liquid: String
        var x: CGFloat
        var y: CGFloat
        var w: CGFloat
        var h: CGFloat
        var count: Int
        var cgRect: CGRect { CGRect(x: x, y: y, width: w, height: h) }
    }

    struct Point: Decodable {
        var x: CGFloat
        var y: CGFloat
    }

    struct Actors: Decodable {
        var hero: Point?
        var treasure: Point?
        var goal: Rect?
        /// Goblins. Liquid ends them; touching one ends the hero.
        var foes: [Point]?
    }

    var id: String
    var name: String
    var hint: String?
    /// Pulls the intended solution needs. Three stars at or under it, two for one extra pull.
    var parPins: Int
    /// treasureReachesHero, heroReachesGoal, treasureReachesGoal, or both (treasure to hero and hero to goal).
    var winWhen: String
    /// Draw the standard outer walls and floor. Defaults to true.
    var frame: Bool?
    var walls: [Rect]?
    var slabs: [Slab]?
    var pins: [Pin]
    var pools: [Pool]?
    var drains: [Rect]?
    /// Liquid that touches a grate is gone; the hero and the treasure pass through untouched.
    var grates: [Rect]?
    /// Scenery with no physics (torches, signs).
    var decor: [DogLevel.Decor]?
    var actors: Actors
    /// Pin ids in pull order.
    var solution: [String]?
    var settleSeconds: Double?

    var totalParticles: Int { (pools ?? []).reduce(0) { $0 + $1.count } }

    func stars(forPulls pulls: Int) -> Int {
        if pulls <= parPins { return 3 }
        if pulls == parPins + 1 { return 2 }
        return 1
    }
}
