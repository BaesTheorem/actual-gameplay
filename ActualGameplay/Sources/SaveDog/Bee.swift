import SpriteKit
import UIKit

/// One bee: a small fast body that hunts the nearest dog.
final class BeeNode: SKSpriteNode {
    static let radius: CGFloat = 6
    let phase: CGFloat
    let bornAt: TimeInterval

    init(phase: CGFloat, bornAt: TimeInterval) {
        self.phase = phase
        self.bornAt = bornAt
        super.init(texture: Sprite.beeA.texture, color: .clear, size: CGSize(width: 20, height: 20))
        zPosition = 12
        if !Motion.reduced {
            run(.repeatForever(.animate(with: [Sprite.beeA.texture, Sprite.beeB.texture], timePerFrame: 0.08)))
        }
        let body = SKPhysicsBody(circleOfRadius: BeeNode.radius)
        body.density = 0.6
        body.friction = 0.1
        body.restitution = 0.2
        // Near zero: the swarm's own speed clamp is the terminal velocity. Damping here acts far
        // harder than a per-second fraction and 0.5 left the bees crawling.
        body.linearDamping = 0.05
        body.affectedByGravity = false   // it flies; the steering force is the whole story
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
/// Two behaviours. With a route to the dog (the flow field), a bee follows it, which takes it
/// around walls and through any gap it fits through. With no route, it presses on whatever is
/// between it and the dog, crawls sideways along the surface looking for a way in, and joins
/// the swarm's periodic shove. Steering is a force, not a set velocity, so contacts resolve
/// properly and a shove is a real push the shield's mass and footing have to answer.
final class BeeSwarm {
    // Accelerations in points per second squared (times mass gives the impulse per second).
    static let cruise: CGFloat = 720          // open air: 0 to the 260 pt/s clamp in about a third of a second
    static let press: CGFloat = 220           // steady lean on a surface
    static let shove: CGFloat = 900           // the burst
    static let shovePeriod: TimeInterval = 3.0
    static let shoveLength: TimeInterval = 0.6

    let layer = SKNode()
    private(set) var bees: [BeeNode] = []
    private(set) var spawned = 0
    private(set) var shoving = false
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
    func update(dt: TimeInterval, now: TimeInterval, targets: [CGPoint], field: FlowField?) {
        while let next = schedule.first, now >= next.time {
            schedule.removeFirst()
            let jitter = CGPoint(x: CGFloat(rng.unit() - 0.5) * 28, y: CGFloat(rng.unit() - 0.5) * 16)
            let bee = BeeNode(phase: CGFloat(rng.unit()) * 6.28, bornAt: now)
            bee.position = next.at + jitter
            layer.addChild(bee)
            bees.append(bee)
            spawned += 1
        }
        guard !targets.isEmpty else { return }
        shoving = now > 2 && now.truncatingRemainder(dividingBy: BeeSwarm.shovePeriod) < BeeSwarm.shoveLength
        for bee in bees {
            guard let body = bee.physicsBody else { continue }
            let target = targets.min { $0.distance(to: bee.position) < $1.distance(to: bee.position) }!
            let direct = (target - bee.position).normalized
            let speed = Physics.speed(body)
            let age = now - bee.bornAt
            var desired: CGPoint
            var strength = BeeSwarm.cruise
            if let route = field?.nearbyDirection(at: bee.position) {
                // A way in exists: follow it, with a little pull straight at the dog so the path
                // does not read as a grid walk.
                desired = (CGPoint(x: route.dx, y: route.dy) * 0.85 + direct * 0.15).normalized
                if speed < 25, age > 0.6 { strength = BeeSwarm.press * 1.5 }   // nudged off a corner
            } else {
                // No way in. Lean on the structure, probe along it, shove on the beat.
                let probe = direct.perpendicular * CGFloat(sin(now * 2.2 + Double(bee.phase))) * 0.7
                desired = (direct + probe).normalized
                let pressing = speed < 25 && age > 0.6
                strength = pressing ? (shoving ? BeeSwarm.shove : BeeSwarm.press) : BeeSwarm.cruise
            }
            let wobble = desired.perpendicular * CGFloat(sin(now * 7 + Double(bee.phase))) * 0.25
            // As an impulse per frame: strength is an acceleration in pt/s², so this is m·a·dt.
            let push = (desired + wobble).normalized * (strength * body.mass * CGFloat(dt))
            body.isResting = false
            body.applyImpulse(CGVector(dx: push.x, dy: push.y))
            Physics.clamp(body, to: 260)
            if abs(body.velocity.dx) * Physics.pointsPerMeter > 10 { bee.xScale = body.velocity.dx < 0 ? -1 : 1 }
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
