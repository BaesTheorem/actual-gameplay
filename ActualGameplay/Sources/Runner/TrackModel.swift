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

/// The finale as arithmetic, one 0.05 s tick at a time: both sides lose a thirtieth of the bigger
/// side, ours divided by member power. The fraction of a runner that division leaves is carried to
/// the next tick, so power counts in a fight of any size; at power 1 nothing is ever carried.
struct FinaleFight: Equatable {
    enum Outcome: Equatable {
        case going
        case won(survivors: Int)
        case lost(lastRunner: Bool)
    }

    private(set) var mine: Int
    private(set) var theirs: Int
    let power: Double
    private var owed: Double = 0

    init(mine: Int, theirs: Int, power: Double) {
        self.mine = mine
        self.theirs = theirs
        self.power = power
    }

    mutating func tick() -> Outcome {
        let before = (mine: mine, theirs: theirs)
        let slice = max(1, Int((Double(max(mine, theirs)) / 30).rounded(.up)))
        owed += Double(slice) / power
        let loss = Int(owed.rounded(.down))
        owed -= Double(loss)
        theirs = max(0, theirs - slice)
        mine = max(0, mine - loss)
        if theirs <= 0 && mine > 0 { return .won(survivors: mine) }
        if mine <= 0 && theirs > 0 { return .lost(lastRunner: false) }
        if mine <= 0 && theirs <= 0 {
            return Double(before.mine) * power >= Double(before.theirs) ? .won(survivors: 1) : .lost(lastRunner: true)
        }
        return .going
    }

    /// Survivors of the whole fight, 0 for a loss.
    static func survivors(mine: Int, theirs: Int, power: Double) -> Int {
        var fight = FinaleFight(mine: mine, theirs: theirs, power: power)
        while true {
            switch fight.tick() {
            case .going: continue
            case .won(let survivors): return survivors
            case .lost: return 0
            }
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
    /// The crowd a perfect run arrives with at these upgrades: best gate every time, no obstacle losses.
    let bestPath: Int
}
