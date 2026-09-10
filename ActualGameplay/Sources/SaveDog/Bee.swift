import SpriteKit
import UIKit

/// One bee: a small fast body that steers toward the nearest dog.
final class BeeNode: SKSpriteNode {
    static let radius: CGFloat = 6
    let phase: CGFloat

    init(phase: CGFloat) {
        self.phase = phase
        super.init(texture: Sprite.beeA.texture, color: .clear, size: CGSize(width: 20, height: 20))
        zPosition = 12
        if !Motion.reduced {
            run(.repeatForever(.animate(with: [Sprite.beeA.texture, Sprite.beeB.texture], timePerFrame: 0.08)))
        }
        let body = SKPhysicsBody(circleOfRadius: BeeNode.radius)
        body.density = 0.6
        body.friction = 0.1
        body.restitution = 0.2
        body.linearDamping = 3
        body.allowsRotation = false
        body.usesPreciseCollisionDetection = true
        body.categoryBitMask = StrokeCategory.bee
        body.collisionBitMask = StrokeCategory.wall | StrokeCategory.drawn | StrokeCategory.actor
        body.contactTestBitMask = StrokeCategory.actor
        physicsBody = body
    }

    required init?(coder aDecoder: NSCoder) { fatalError("built in code") }
}

/// Spawns bees from the level's hives on schedule and steers the live ones every frame.
///
/// Steering is a force, not a set velocity, so contacts with a shield resolve properly: a bee
/// pressing on a wall stops instead of jittering through it. With linear damping 3 the force
/// below settles at roughly 240 pt/s.
final class BeeSwarm {
    let layer = SKNode()
    private(set) var bees: [BeeNode] = []
    private(set) var spawned = 0
    let total: Int
    private var schedule: [(time: TimeInterval, at: CGPoint)]
    private var rng = SeededRNG(seed: 99)

    init(hives: [DogLevel.Hive]) {
        var plan: [(TimeInterval, CGPoint)] = []
        for hive in hives {
            let interval = hive.interval ?? 0.12
            for i in 0..<hive.count {
                plan.append(((hive.delay ?? 0) + Double(i) * interval, CGPoint(x: hive.x, y: hive.y)))
            }
        }
        schedule = plan.sorted { $0.0 < $1.0 }
        total = plan.count
        layer.zPosition = 12
    }

    var alive: Int { bees.count }

    /// `now` is seconds since the swarm was released.
    func update(dt: TimeInterval, now: TimeInterval, targets: [CGPoint]) {
        while let next = schedule.first, now >= next.time {
            schedule.removeFirst()
            let jitter = CGPoint(x: CGFloat(rng.unit() - 0.5) * 16, y: CGFloat(rng.unit() - 0.5) * 16)
            let bee = BeeNode(phase: CGFloat(rng.unit()) * 6.28)
            bee.position = next.at + jitter
            layer.addChild(bee)
            bees.append(bee)
            spawned += 1
        }
        guard !targets.isEmpty else { return }
        for bee in bees {
            guard let body = bee.physicsBody else { continue }
            let target = targets.min { $0.distance(to: bee.position) < $1.distance(to: bee.position) }!
            let dir = (target - bee.position).normalized
            let wobble = dir.perpendicular * CGFloat(sin(now * 7 + Double(bee.phase))) * 0.35
            let push = (dir + wobble).normalized * (4.8 * body.mass)
            body.applyForce(CGVector(dx: push.x, dy: push.y))
            let speed = hypot(body.velocity.dx, body.velocity.dy)
            if speed > 260 {
                body.velocity = CGVector(dx: body.velocity.dx / speed * 260, dy: body.velocity.dy / speed * 260)
            }
            if abs(body.velocity.dx) > 10 { bee.xScale = body.velocity.dx < 0 ? -1 : 1 }
        }
    }

    func removeAll() {
        layer.removeAllChildren()
        bees = []
        spawned = 0
    }
}

/// The dog. Heavy for his size so a landing shield does not launch him; never rolls.
final class DogNode: SKSpriteNode {
    static let radius: CGFloat = 18
    let dogID: String

    init(id: String) {
        dogID = id
        let texture = Sprite.exists("dog") ? Sprite.dog.texture : Sprite.dogFront.texture
        super.init(texture: texture, color: .clear, size: CGSize(width: 42, height: 42))
        zPosition = 8
        name = id
        let body = SKPhysicsBody(circleOfRadius: DogNode.radius)
        body.density = 3
        body.friction = 0.9
        body.restitution = 0
        body.linearDamping = 0.3
        body.allowsRotation = false
        body.categoryBitMask = StrokeCategory.actor
        body.collisionBitMask = StrokeCategory.wall | StrokeCategory.drawn | StrokeCategory.killer | StrokeCategory.actor
        body.contactTestBitMask = StrokeCategory.bee | StrokeCategory.killer
        physicsBody = body
    }

    required init?(coder aDecoder: NSCoder) { fatalError("built in code") }

    func panic() {
        guard !Motion.reduced else { return }
        run(.repeatForever(.sequence([.rotate(toAngle: 0.15, duration: 0.06), .rotate(toAngle: -0.15, duration: 0.06)])))
    }

    func relax() {
        removeAllActions()
        zRotation = 0
        if !Motion.reduced {
            run(.sequence([.scaleY(to: 1.15, duration: 0.12), .scaleY(to: 1, duration: 0.12)]))
        }
    }
}
