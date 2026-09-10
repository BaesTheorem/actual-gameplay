import CoreGraphics
import Foundation

enum GateOp: Equatable {
    case add(Int)
    case subtract(Int)
    case multiply(Int)
    case divide(Int)

    func apply(_ count: Int) -> Int {
        switch self {
        case .add(let n): return count + n
        case .subtract(let n): return max(0, count - n)
        case .multiply(let m): return count * m
        case .divide(let m): return max(0, count / m)
        }
    }

    var label: String {
        switch self {
        case .add(let n): return "+\(n)"
        case .subtract(let n): return "-\(n)"
        case .multiply(let m): return "\u{00D7}\(m)"
        case .divide(let m): return "\u{00F7}\(m)"
        }
    }

    var isGood: Bool {
        switch self {
        case .add, .multiply: return true
        case .subtract, .divide: return false
        }
    }
}

struct GatePair: Equatable {
    let z: CGFloat
    let left: GateOp
    let right: GateOp
}

enum Hazard: Equatable {
    case wall(x0: CGFloat, x1: CGFloat)
    case blade(center: CGFloat, halfWidth: CGFloat, amplitude: CGFloat, speed: CGFloat)
    case spikes(x0: CGFloat, x1: CGFloat)

    /// The deadly stretch of lane at a moment in time.
    func span(at time: TimeInterval) -> ClosedRange<CGFloat> {
        switch self {
        case .wall(let x0, let x1), .spikes(let x0, let x1):
            return x0...x1
        case .blade(let center, let halfWidth, let amplitude, let speed):
            let x = center + amplitude * CGFloat(sin(time * Double(speed)))
            return (x - halfWidth)...(x + halfWidth)
        }
    }
}

struct Obstacle: Equatable {
    let z: CGFloat
    let hazard: Hazard
}

enum Segment: Equatable {
    case gates(GatePair)
    case obstacle(Obstacle)

    var z: CGFloat {
        switch self {
        case .gates(let pair): return pair.z
        case .obstacle(let obstacle): return obstacle.z
        }
    }
}

enum Finale: Equatable {
    case crowd(Int)
    case boss(hp: Int)

    /// Both finales resolve as attrition against this many "hit points".
    var strength: Int {
        switch self {
        case .crowd(let n): return n
        case .boss(let hp): return hp
        }
    }
}

struct Track: Equatable {
    let level: Int
    let segments: [Segment]
    let finale: Finale
    let finaleZ: CGFloat
    let speed: CGFloat
    let startCrowd: Int
    /// The crowd a perfect run arrives with: best gate every time, no obstacle losses.
    let bestPath: Int
}
