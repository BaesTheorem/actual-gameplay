import CoreGraphics
import Foundation

/// A Save the Dog level. Draw a shield, then bees swarm the dog for `duration` seconds.
/// Canvas coordinates (402 x 874, origin bottom-left).
struct DogLevel: Decodable {
    struct Dog: Decodable {
        var id: String
        var x: CGFloat
        var y: CGFloat
    }

    /// Where bees come from. They stream in `count` at a time, one every `interval` seconds.
    struct Hive: Decodable {
        var x: CGFloat
        var y: CGFloat
        var count: Int
        var interval: Double?
        /// Seconds after the swarm starts before this hive opens.
        var delay: Double?
    }

    var id: String
    var name: String
    var hint: String?
    var inkBudget: CGFloat
    /// Ink thresholds for three and two stars.
    var stars: [CGFloat]
    /// Seconds the dog has to survive once the bees are out.
    var duration: Double?
    /// Seconds between the first stroke landing and the first bee.
    var beeDelay: Double?
    /// Drawn strokes stay where they are put instead of falling.
    var pinnedInk: Bool?
    var statics: [LevelStatic]?
    var killers: [LevelRect]?
    var forbidden: [LevelRect]?
    var dogs: [Dog]
    var hives: [Hive]
    var solution: StrokeSolution?

    var surviveSeconds: Double { duration ?? 10 }
    var swarmDelay: Double { beeDelay ?? 1.5 }
    var totalBees: Int { hives.reduce(0) { $0 + $1.count } }

    func stars(forInk ink: CGFloat) -> Int {
        if stars.count > 0, ink <= stars[0] { return 3 }
        if stars.count > 1, ink <= stars[1] { return 2 }
        return 1
    }
}
