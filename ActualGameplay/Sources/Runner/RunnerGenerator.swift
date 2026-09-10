import CoreGraphics
import Foundation

/// Deterministic tracks from the level number. The same level is the same track on every device,
/// and the finale is sized from the best possible run so a good player can always win.
enum RunnerGenerator {
    /// How many runs the autoplay harness drives at base upgrades.
    static let replayLevels = 5

    static func seed(for level: Int) -> UInt64 { 1_000_003 &* UInt64(level + 1) }

    static func speed(for level: Int) -> CGFloat { min(7 + 0.15 * CGFloat(level), 12) }

    static func makeTrack(level: Int, startCrowd: Int) -> Track {
        var rng = SeededRNG(seed: seed(for: level))
        let count = min(6 + level / 2, 14)
        let tier = min(level / 5, 4)
        var segments: [Segment] = []
        var z: CGFloat = 12
        var running = 5
        var betterSide = 0   // +1 right, -1 left
        var sameSideRun = 0
        for _ in 0..<count {
            let wantsGates = level < 2 || rng.unit() < 0.7
            if wantsGates {
                var left = randomOp(&rng, tier: tier)
                var right = randomOp(&rng, tier: tier, forceGood: !left.isGood)
                var tries = 0
                while right == left && tries < 20 {
                    right = randomOp(&rng, tier: tier, forceGood: !left.isGood)
                    tries += 1
                }
                // Never let the better gate sit on the same side three times running: a player
                // hugging one wall should not stumble through a level.
                var side = right.apply(running) >= left.apply(running) ? 1 : -1
                if side == betterSide && sameSideRun >= 2 {
                    swap(&left, &right)
                    side = -side
                }
                sameSideRun = side == betterSide ? sameSideRun + 1 : 1
                betterSide = side
                running = max(left.apply(running), right.apply(running))
                segments.append(.gates(GatePair(z: z, left: left, right: right)))
            } else {
                segments.append(.obstacle(Obstacle(z: z, hazard: randomHazard(&rng, tier: tier))))
            }
            z += 6
        }
        let finaleZ = z + 4

        var best = startCrowd
        for segment in segments {
            if case .gates(let pair) = segment {
                best = max(pair.left.apply(best), pair.right.apply(best))
            }
        }
        best = max(best, 2)

        let finale: Finale
        if (level + 1) % 5 == 0 {
            finale = .boss(hp: max(1, min(best - 1, Int((0.75 * Double(best)).rounded(.down)))))
        } else {
            let ratio = 0.6 + 0.02 * Double(min(level, 12))
            finale = .crowd(max(1, min(best - 1, Int((Double(best) * ratio).rounded(.down)))))
        }
        return Track(level: level, segments: segments, finale: finale, finaleZ: finaleZ,
                     speed: speed(for: level), startCrowd: startCrowd, bestPath: best)
    }

    private static func randomOp(_ rng: inout SeededRNG, tier: Int, forceGood: Bool = false) -> GateOp {
        let roll = rng.unit()
        let kind: Int
        if forceGood {
            kind = roll < 0.65 ? 0 : 2
        } else if roll < 0.4 {
            kind = 0
        } else if roll < 0.65 {
            kind = 1
        } else if roll < 0.85 {
            kind = 2
        } else {
            kind = 3
        }
        switch kind {
        case 0: return .add(rng.int(in: (3 + 2 * tier)...(10 + 5 * tier)))
        case 1: return .subtract(rng.int(in: (2 + tier)...(6 + 3 * tier)))
        case 2: return .multiply(tier >= 2 && rng.unit() < 0.3 ? 3 : 2)
        default: return .divide(rng.unit() < 0.7 ? 2 : 3)
        }
    }

    private static func randomHazard(_ rng: inout SeededRNG, tier: Int) -> Hazard {
        let roll = rng.unit()
        if roll < 0.45 {
            let width = 0.5 + 0.08 * CGFloat(tier)
            let center = CGFloat(rng.unit() - 0.5)
            return .wall(x0: center - width / 2, x1: center + width / 2)
        }
        if roll < 0.75 {
            return .blade(center: 0, halfWidth: 0.18 + 0.02 * CGFloat(tier), amplitude: 0.55, speed: 1.4 + 0.2 * CGFloat(tier))
        }
        let center = CGFloat(rng.unit() * 1.2 - 0.6)
        return .spikes(x0: center - 0.16, x1: center + 0.16)
    }
}
