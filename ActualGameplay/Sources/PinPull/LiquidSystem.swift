import SpriteKit
import UIKit

enum PinCategory {
    static let wall: UInt32 = 1 << 0
    static let pin: UInt32 = 1 << 1
    static let water: UInt32 = 1 << 2
    static let lava: UInt32 = 1 << 3
    static let hero: UInt32 = 1 << 4
    static let treasure: UInt32 = 1 << 5
    static let goal: UInt32 = 1 << 6
    static let drain: UInt32 = 1 << 7
    static let liquid: UInt32 = water | lava
}

enum LiquidKind: String {
    case water
    case lava

    var color: UIColor { self == .water ? UIColor(hex: 0x4FB8FF) : UIColor(hex: 0xFF6A3D) }
    var category: UInt32 { self == .water ? PinCategory.water : PinCategory.lava }
}

/// Liquids as swarms of small discs. SpriteKit has no fluid, but a few hundred low-friction circles
/// drawn a little larger than their bodies read as liquid well enough, and they pour, pile, and
/// spill the way the puzzles need.
///
/// Every particle is a sprite sharing one texture under one parent node, so the whole swarm is a
/// single draw call. Speed is clamped every frame because SpriteKit does not sub-step: a particle
/// moving more than its diameter per frame can pass through a 14 pt wall.
final class LiquidSystem {
    static let radius: CGFloat = 3.5
    static let visualScale: CGFloat = 1.6
    static let maxSpeed: CGFloat = 700

    let layer = SKNode()
    private(set) var particles: [SKSpriteNode] = []

    init() { layer.zPosition = 5 }

    var count: Int { particles.count }

    func spawn(in rect: CGRect, count: Int, kind: LiquidKind, texture: SKTexture) {
        let r = LiquidSystem.radius
        let dx = 2 * r * 0.95
        let dy = dx * 0.866
        var y = rect.minY + r
        var row = 0
        var made = 0
        while made < count {
            var x = rect.minX + r + (row % 2 == 1 ? dx / 2 : 0)
            var placed = false
            while x + r <= rect.maxX && made < count {
                add(kind: kind, at: CGPoint(x: x, y: y), texture: texture)
                made += 1
                placed = true
                x += dx
            }
            if !placed { break }
            y += dy
            row += 1
        }
    }

    private func add(kind: LiquidKind, at point: CGPoint, texture: SKTexture) {
        let size = 2 * LiquidSystem.radius * LiquidSystem.visualScale
        let node = SKSpriteNode(texture: texture, size: CGSize(width: size, height: size))
        node.position = point
        node.name = kind.rawValue
        let body = SKPhysicsBody(circleOfRadius: LiquidSystem.radius)
        body.friction = 0.05
        body.restitution = 0
        body.linearDamping = 0.2
        body.angularDamping = 0
        body.allowsRotation = false
        body.density = 1
        body.categoryBitMask = kind.category
        body.collisionBitMask = PinCategory.wall | PinCategory.pin | PinCategory.water | PinCategory.lava
            | PinCategory.hero | PinCategory.treasure
        body.contactTestBitMask = kind == .water
            ? PinCategory.lava | PinCategory.drain
            : PinCategory.water | PinCategory.hero | PinCategory.drain
        node.physicsBody = body
        layer.addChild(node)
        particles.append(node)
    }

    func remove(_ node: SKNode) {
        node.removeFromParent()
    }

    func removeAll() {
        layer.removeAllChildren()
        particles.removeAll()
    }

    /// Clamp speeds, drop removed particles from the list, and report the fastest one.
    /// Runs from `update`, which is before the physics step.
    func step() -> CGFloat {
        var fastest: CGFloat = 0
        var compact = false
        for particle in particles {
            guard particle.parent != nil, let body = particle.physicsBody else {
                compact = true
                continue
            }
            let v = body.velocity
            let speed = hypot(v.dx, v.dy)
            if speed > LiquidSystem.maxSpeed {
                let scale = LiquidSystem.maxSpeed / speed
                body.velocity = CGVector(dx: v.dx * scale, dy: v.dy * scale)
                fastest = max(fastest, LiquidSystem.maxSpeed)
            } else if speed > fastest {
                fastest = speed
            }
        }
        if compact { particles.removeAll { $0.parent == nil } }
        return fastest
    }
}
