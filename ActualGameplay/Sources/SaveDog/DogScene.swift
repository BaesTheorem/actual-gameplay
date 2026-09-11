import SpriteKit
import UIKit

/// Save the Dog: draw a shield, then the bees come. Survive the swarm and the dog is safe.
final class DogScene: StrokeScene, ReplayableScene {
    let level: DogLevel
    let levelIndex: Int

    override var inkBudget: CGFloat { level.inkBudget }
    override var pinnedInk: Bool { level.pinnedInk ?? false }
    override var forbiddenRects: [LevelRect] { level.forbidden ?? [] }
    override var hintText: String? { level.hint }
    override var strokeColor: UIColor { UIColor(hex: 0x2B303A) }

    var levelID: String { level.id }
    var levelName: String { level.name }
    var hasSolution: Bool { level.solution != nil }
    var replayWait: TimeInterval { (level.solution?.delay ?? 0) + level.swarmDelay + level.surviveSeconds + 4 }

    func startReplay() {
        if let solution = level.solution { replay(solution) }
    }

    func describe(score: Double?) -> String { "ink \(Int((score ?? 0).rounded()))" }

    private var dogs: [DogNode] = []
    private var swarm: BeeSwarm!
    private var field = FlowField(bounds: GameSceneBase.playfield)
    private var fieldCountdown: TimeInterval = 0
    private var launchAt: TimeInterval?
    private var launchedAt: TimeInterval?
    private var lastHUD = ""
    private var routeOpen = false

    init(level: DogLevel, index: Int) {
        self.level = level
        self.levelIndex = index
        super.init(size: GameSceneBase.canvas)
        backgroundColor = UIColor(hex: 0xC3E3FF)
    }

    required init?(coder aDecoder: NSCoder) { fatalError("scenes are built in code") }

    // MARK: - Build

    override func buildLevel() {
        resetStrokeState()
        dogs = []
        launchAt = nil
        launchedAt = nil
        lastHUD = ""
        physicsWorld.gravity = CGVector(dx: 0, dy: -9.8)

        addBackdrop()
        addBounds(floor: false)
        for decor in level.decor ?? [] { addDecor(decor) }
        for item in level.statics ?? [] { addStatic(item) }
        for rect in level.killers ?? [] { addKiller(rect.cgRect) }
        for saw in level.saws ?? [] { addSaw(saw) }
        for prop in level.props ?? [] { addProp(prop) }
        for spot in level.dogs {
            let dog = DogNode(id: spot.id)
            dog.position = CGPoint(x: spot.x, y: spot.y)
            addChild(dog)
            dogs.append(dog)
        }
        for hive in level.hives { addHiveMarker(hive) }
        swarm = BeeSwarm(hives: level.hives)
        addChild(swarm.layer)
        addHint()
        pushHUD()
    }

    private func addBackdrop() {
        let clouds = SKSpriteNode(texture: Sprite.cloudsBackdrop.texture, size: CGSize(width: 402, height: 402 * 0.7))
        clouds.position = CGPoint(x: 201, y: 74 + 402 * 0.35 - 30)
        clouds.alpha = 0.9
        clouds.zPosition = -10
        addChild(clouds)
        for (i, sprite) in [Sprite.cloud1, .cloud3, .cloud2].enumerated() {
            let cloud = SKSpriteNode(texture: sprite.texture)
            let scale: CGFloat = 0.35 + 0.1 * CGFloat(i)
            cloud.size = CGSize(width: cloud.size.width * scale, height: cloud.size.height * scale)
            cloud.position = CGPoint(x: 60 + CGFloat(i) * 140, y: 660 - CGFloat(i) * 60)
            cloud.alpha = 0.85
            cloud.zPosition = -9
            addChild(cloud)
            if !Motion.reduced {
                let drift = SKAction.moveBy(x: 12 + CGFloat(i) * 4, y: 0, duration: 6 + Double(i))
                drift.timingMode = .easeInEaseOut
                cloud.run(.repeatForever(.sequence([drift, drift.reversed()])))
            }
        }
    }

    private func addHiveMarker(_ hive: DogLevel.Hive) {
        let marker = SKSpriteNode(texture: Sprite.beeRest.texture, size: CGSize(width: 26, height: 26))
        marker.position = CGPoint(x: hive.x, y: hive.y)
        marker.zPosition = 4
        marker.alpha = 0.9
        marker.name = "hive"
        addChild(marker)
        let count = SKLabelNode(fontNamed: "HelveticaNeue-Bold")
        count.text = "\(hive.count)"
        count.fontSize = 11
        count.fontColor = UIColor(hex: 0x3B2A10)
        count.verticalAlignmentMode = .center
        count.position = CGPoint(x: hive.x, y: hive.y - 20)
        count.zPosition = 4
        count.name = "hive"
        addChild(count)
    }

    // MARK: - Flow

    override func strokeDidCommit() {
        if launchAt == nil { launchAt = elapsed + level.swarmDelay }
    }

    override func tick(dt: TimeInterval) {
        super.tick(dt: dt)
        guard !finished else { return }
        if let at = launchAt, launchedAt == nil, elapsed >= at { release() }
        if let started = launchedAt {
            let now = elapsed - started
            let targets = dogs.map(\.position)
            fieldCountdown -= dt
            if fieldCountdown <= 0 {
                rebuildField()
                fieldCountdown = 0.4
            }
            swarm.update(dt: dt, now: now, targets: targets, field: field)
            if now >= level.surviveSeconds {
                win()
                return
            }
        }
        for dog in dogs where dog.position.y < -60 {
            lose("\(dog.dogID.capitalized) fell out of the world.")
            return
        }
        pushHUD()
    }

    /// The bees' map: everything solid, inflated by a bee, flooded from the dogs.
    private func rebuildField() {
        field.rebuild(solids: solids(),
                      targets: dogs.map { (center: $0.position, radius: DogNode.radius) },
                      clearance: BeeNode.radius)
        routeOpen = swarm.bees.contains { field.nearbyDirection(at: $0.position) != nil }
    }

    private func release() {
        launchedAt = elapsed
        rebuildField()
        fieldCountdown = 0.4
        for dog in dogs { dog.panic() }
        for child in children where child.name == "hive" {
            child.run(.fadeAlpha(to: 0.35, duration: 0.3))
        }
        Haptics.shared.slam()
        Audio.play(.pop)
    }

    override func handle(contacts: [ContactEvent]) {
        guard !finished else { return }
        for event in contacts {
            if let (stroke, killer) = event.pair(StrokeCategory.drawn, StrokeCategory.killer), killer.name == "saw" {
                cut(stroke, at: event.contact.contactPoint)
                continue
            }
            if let (dog, _) = event.pair(StrokeCategory.actor, StrokeCategory.bee), let node = dog as? DogNode {
                lose("The bees got \(node.dogID).")
                return
            }
            if let (dog, killer) = event.pair(StrokeCategory.actor, StrokeCategory.killer), let node = dog as? DogNode {
                lose(killer.name == "saw" ? "\(node.dogID.capitalized) met the saw." : "\(node.dogID.capitalized) landed on the spikes.")
                return
            }
        }
    }

    /// A saw took a stroke. It goes in a puff of sawdust and the map is rebuilt at once.
    private func cut(_ stroke: SKNode, at point: CGPoint) {
        guard stroke.parent != nil else { return }
        stroke.physicsBody = nil
        stroke.run(.sequence([.group([.fadeOut(withDuration: Motion.decorative(0.2)), .scale(to: 0.9, duration: 0.2)]), .removeFromParent()]))
        for _ in 0..<6 {
            let chip = SKShapeNode(rectOf: CGSize(width: 4, height: 2))
            chip.fillColor = strokeColor
            chip.strokeColor = .clear
            chip.position = point
            chip.zPosition = 20
            addChild(chip)
            let dx = CGFloat.random(in: -40...40)
            let dy = CGFloat.random(in: 10...60)
            chip.run(.sequence([.group([.moveBy(x: dx, y: dy, duration: 0.35), .fadeOut(withDuration: 0.35)]), .removeFromParent()]))
        }
        Haptics.shared.thud()
        fieldCountdown = 0
    }

    private func win() {
        let ink = inkUsed
        for dog in dogs { dog.relax() }
        Haptics.shared.success()
        Audio.play(.win)
        finish(.won(stars: level.stars(forInk: ink), coins: 0, score: Double(ink)))
        pushHUD()
    }

    private func lose(_ reason: String) {
        Haptics.shared.failure()
        Audio.play(.lose)
        finish(.lost(reason: reason))
        pushHUD()
    }

    override func pushHUD() {
        let ink = Int(inkLeft.rounded())
        var readout = "ink \(ink)"
        if let started = launchedAt {
            let left = max(0, level.surviveSeconds - (elapsed - started))
            readout += String(format: "   %.1fs   %d bees", left, swarm.alive)
            if swarm.shoving { readout += "   shove!" } else if routeOpen { readout += "   way in!" }
        } else if let at = launchAt {
            readout += String(format: "   bees in %.1f", max(0, at - elapsed))
        } else {
            readout += "   draw a shield"
        }
        let key = readout
        guard key != lastHUD else { return }
        lastHUD = key
        let progress: Double
        if let started = launchedAt {
            progress = min(1, (elapsed - started) / level.surviveSeconds)
        } else {
            progress = Double(inkLeft / max(1, level.inkBudget))
        }
        setHUD(HUDState(title: "\(levelIndex + 1). \(level.name)", readout: readout, progress: progress))
    }
}
