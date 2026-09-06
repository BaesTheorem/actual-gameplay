import SpriteKit

/// Evaluates a level's goal frame by frame. Leaf goals latch once met, so a ball that touched the
/// target and bounced away still counts.
final class GoalTracker {
    let goal: DrawLevel.Goal
    private var latched = Set<String>()
    private var dwell: [String: TimeInterval] = [:]

    init(goal: DrawLevel.Goal) { self.goal = goal }

    func noteContact(object: String, target: String) {
        latched.insert("contact:\(object):\(target)")
    }

    func evaluate(dt: TimeInterval, nodes: [String: SKNode], zones: [String: CGRect]) -> Bool {
        check(goal, dt: dt, nodes: nodes, zones: zones)
    }

    /// Longest running dwell as a fraction, for the HUD. Nil when the goal has no dwell part.
    var dwellFraction: Double? {
        var best: Double?
        func visit(_ g: DrawLevel.Goal) {
            switch g {
            case .dwell(let o, let z, let seconds):
                let key = "dwell:\(o):\(z)"
                let value = latched.contains(key) ? 1 : min(1, (dwell[key] ?? 0) / seconds)
                best = max(best ?? 0, value)
            case .allOf(let goals): goals.forEach(visit)
            default: break
            }
        }
        visit(goal)
        return best
    }

    private func check(_ g: DrawLevel.Goal, dt: TimeInterval, nodes: [String: SKNode], zones: [String: CGRect]) -> Bool {
        switch g {
        case .contact(let o, let t):
            return latched.contains("contact:\(o):\(t)")
        case .dwell(let o, let z, let seconds):
            let key = "dwell:\(o):\(z)"
            if latched.contains(key) { return true }
            guard let node = nodes[o], let rect = zones[z] else { return false }
            let time = rect.contains(node.position) ? (dwell[key] ?? 0) + dt : 0
            dwell[key] = time
            if time >= seconds { latched.insert(key); return true }
            return false
        case .tilt(let o, let degrees):
            let key = "tilt:\(o)"
            if latched.contains(key) { return true }
            guard let node = nodes[o] else { return false }
            let angle = abs(atan2(sin(node.zRotation), cos(node.zRotation)))
            if angle >= CGFloat(degrees) * .pi / 180 { latched.insert(key); return true }
            return false
        case .fallOut(let o):
            let key = "fall:\(o)"
            if latched.contains(key) { return true }
            if let node = nodes[o], node.position.y < -40 { latched.insert(key); return true }
            return false
        case .allOf(let goals):
            var all = true
            for sub in goals where !check(sub, dt: dt, nodes: nodes, zones: zones) { all = false }
            return all
        }
    }
}
