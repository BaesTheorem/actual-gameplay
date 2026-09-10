import CoreGraphics
import Foundation

/// A draw-a-line level. Coordinates are canvas points (402 x 874, origin bottom-left).
/// Rects give their bottom-left corner; dynamic objects give their center.
struct DrawLevel: Decodable {
    struct Rect: Decodable {
        var x: CGFloat
        var y: CGFloat
        var w: CGFloat
        var h: CGFloat
        var cgRect: CGRect { CGRect(x: x, y: y, width: w, height: h) }
    }

    struct Static: Decodable {
        var type: String
        var x: CGFloat?
        var y: CGFloat?
        var w: CGFloat?
        var h: CGFloat?
        var r: CGFloat?
        var points: [[CGFloat]]?
        /// False for scenery with no physics body (a fulcrum drawn under a pinned plank).
        var solid: Bool?
    }

    struct Dynamic: Decodable {
        var id: String
        var shape: String
        var x: CGFloat
        var y: CGFloat
        var r: CGFloat?
        var w: CGFloat?
        var h: CGFloat?
        /// Wall thickness for the "cup" shape.
        var t: CGFloat?
        var friction: CGFloat?
        var restitution: CGFloat?
        var density: CGFloat?
        var vx: CGFloat?
        var vy: CGFloat?
    }

    struct Region: Decodable {
        var id: String
        var x: CGFloat
        var y: CGFloat
        var w: CGFloat
        var h: CGFloat
        var cgRect: CGRect { CGRect(x: x, y: y, width: w, height: h) }
    }

    struct Mover: Decodable {
        var id: String
        var x: CGFloat
        var y: CGFloat
        var w: CGFloat
        var h: CGFloat
        var dx: CGFloat
        var dy: CGFloat
        var period: CGFloat
    }

    struct Joint: Decodable {
        var type: String
        var a: String
        var b: String
        var x: CGFloat
        var y: CGFloat
        /// Resistance at the pivot, so a balanced body stays put until it is really loaded.
        var frictionTorque: CGFloat?
    }

    indirect enum Goal: Decodable {
        case contact(object: String, target: String)
        case dwell(object: String, zone: String, seconds: Double)
        case tilt(object: String, degrees: Double)
        case fallOut(object: String)
        case allOf([Goal])

        private enum Keys: String, CodingKey { case type, object, target, zone, seconds, degrees, goals }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            let type = try c.decode(String.self, forKey: .type)
            switch type {
            case "contact":
                self = .contact(object: try c.decode(String.self, forKey: .object),
                                target: try c.decode(String.self, forKey: .target))
            case "dwell":
                self = .dwell(object: try c.decode(String.self, forKey: .object),
                              zone: try c.decode(String.self, forKey: .zone),
                              seconds: try c.decodeIfPresent(Double.self, forKey: .seconds) ?? 3)
            case "tilt":
                self = .tilt(object: try c.decode(String.self, forKey: .object),
                             degrees: try c.decodeIfPresent(Double.self, forKey: .degrees) ?? 45)
            case "fallOut":
                self = .fallOut(object: try c.decode(String.self, forKey: .object))
            case "allOf":
                self = .allOf(try c.decode([Goal].self, forKey: .goals))
            default:
                throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "unknown goal type \(type)")
            }
        }

        /// Every object id the goal refers to.
        var objects: Set<String> {
            switch self {
            case .contact(let o, _), .dwell(let o, _, _), .tilt(let o, _), .fallOut(let o): return [o]
            case .allOf(let goals): return goals.reduce(into: Set<String>()) { $0.formUnion($1.objects) }
            }
        }

        var targets: Set<String> {
            switch self {
            case .contact(_, let t): return [t]
            case .allOf(let goals): return goals.reduce(into: Set<String>()) { $0.formUnion($1.targets) }
            default: return []
            }
        }

        var zones: Set<String> {
            switch self {
            case .dwell(_, let z, _): return [z]
            case .allOf(let goals): return goals.reduce(into: Set<String>()) { $0.formUnion($1.zones) }
            default: return []
            }
        }

        func allowsFallOut(_ object: String) -> Bool {
            switch self {
            case .fallOut(let o): return o == object
            case .allOf(let goals): return goals.contains { $0.allowsFallOut(object) }
            default: return false
            }
        }
    }

    struct Stroke: Decodable {
        var delay: Double?
        var points: [[CGFloat]]
        var cgPoints: [CGPoint] { points.map { CGPoint(x: $0[0], y: $0[1]) } }
    }

    struct Solution: Decodable {
        var delay: Double?
        var strokes: [Stroke]
        var waitSeconds: Double?
        var totalLength: CGFloat { strokes.reduce(0) { $0 + Geometry.polylineLength($1.cgPoints) } }
    }

    var id: String
    var name: String
    var hint: String?
    var gravity: CGFloat?
    var inkBudget: CGFloat
    /// Ink thresholds for three and two stars.
    var stars: [CGFloat]
    /// Physics runs from the start instead of waiting for the first stroke.
    var liveStart: Bool?
    /// Drawn strokes stay where they are put instead of falling.
    var pinnedInk: Bool?
    var statics: [Static]?
    var dynamics: [Dynamic]?
    var targets: [Region]?
    var zones: [Region]?
    var killers: [Rect]?
    var movers: [Mover]?
    var forbidden: [Rect]?
    var joints: [Joint]?
    var goal: Goal
    var solution: Solution?

    func stars(forInk ink: CGFloat) -> Int {
        if stars.count > 0, ink <= stars[0] { return 3 }
        if stars.count > 1, ink <= stars[1] { return 2 }
        return 1
    }
}
