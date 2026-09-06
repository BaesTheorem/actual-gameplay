import SpriteKit

/// One physics contact, captured during the simulation step and handled after it.
struct ContactEvent {
    let a: SKNode
    let b: SKNode
    let contact: SKPhysicsContact

    /// Both nodes ordered to match the given categories, or nil if the pair does not match.
    func pair(_ maskA: UInt32, _ maskB: UInt32) -> (SKNode, SKNode)? {
        let ca = a.physicsBody?.categoryBitMask ?? 0
        let cb = b.physicsBody?.categoryBitMask ?? 0
        if ca & maskA != 0 && cb & maskB != 0 { return (a, b) }
        if cb & maskA != 0 && ca & maskB != 0 { return (b, a) }
        return nil
    }

    func matches(_ maskA: UInt32, _ maskB: UInt32) -> Bool { pair(maskA, maskB) != nil }
}

private struct PairKey: Hashable {
    let lo: ObjectIdentifier
    let hi: ObjectIdentifier

    init(_ a: AnyObject, _ b: AnyObject) {
        let x = ObjectIdentifier(a)
        let y = ObjectIdentifier(b)
        if x < y { lo = x; hi = y } else { lo = y; hi = x }
    }
}

/// Collects contacts inside `didBegin` and hands them over once per frame, one entry per node pair.
///
/// Mutating the physics world during the step (removing nodes, swapping bodies) corrupts the
/// simulation, so nothing touches the world until `drain()` runs from `didSimulatePhysics`.
/// Compound bodies report one contact per touching fixture; the pair key collapses those.
final class ContactQueue {
    private var events: [ContactEvent] = []
    private var seen = Set<PairKey>()

    func record(_ contact: SKPhysicsContact) {
        guard let a = contact.bodyA.node, let b = contact.bodyB.node else { return }
        guard seen.insert(PairKey(a, b)).inserted else { return }
        events.append(ContactEvent(a: a, b: b, contact: contact))
    }

    func drain() -> [ContactEvent] {
        defer {
            events.removeAll(keepingCapacity: true)
            seen.removeAll(keepingCapacity: true)
        }
        return events
    }

    func clear() {
        events.removeAll()
        seen.removeAll()
    }
}
