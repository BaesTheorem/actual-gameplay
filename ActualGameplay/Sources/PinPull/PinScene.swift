import SpriteKit
import UIKit

/// Pull the Pin: chambers of water and lava held up by pins. Pull order is the puzzle.
final class PinScene: GameSceneBase, ReplayableScene {
    private enum Palette {
        static let wall = UIColor(hex: 0x262A32)
        static let outline = UIColor(hex: 0x3F4553)
        static let drain = UIColor(hex: 0x0B0D10)
        static let goal = UIColor(hex: 0xFF8A5B)
        static let muted = UIColor(hex: 0x6B7280)
        static let steam = UIColor(hex: 0x9AA0AC)
    }

    static let frameThickness: CGFloat = 14

    let level: PinLevel
    let levelIndex: Int

    var levelID: String { level.id }
    var levelName: String { level.name }
    var hasSolution: Bool { level.solution != nil }
    var replayWait: TimeInterval { 1 + Double(level.solution?.count ?? 0) * 8.5 + (level.settleSeconds ?? 5) }

    private let liquid = LiquidSystem()
    private var pins: [String: PinNode] = [:]
    private var pulled: [String] = []
    private var hero: HeroNode?
    private var treasure: TreasureNode?
    private var latched = Set<String>()
    private var winLatchedAt: TimeInterval?
    private var dying = false
    private var calmFrames = 0
    private var elapsed: TimeInterval = 0
    private var lastPullTime: TimeInterval = -10
    private var replayTemplate: [String]?
    private var replayArmed: Bool { replayTemplate != nil }
    private var replayQueue: [String] = []
    private var lastHUD = ""
    private var steamBudget = 0

    init(level: PinLevel, index: Int) {
        self.level = level
        self.levelIndex = index
        super.init(size: GameSceneBase.canvas)
    }

    required init?(coder aDecoder: NSCoder) { fatalError("scenes are built in code") }

    func startReplay() { replay(pins: level.solution ?? []) }

    /// Pull these pins in order once the scene runs, and again after every reset.
    func replay(pins: [String]) {
        replayTemplate = pins
        replayQueue = pins
    }

    func describe(score: Double?) -> String { "pulls \(Int((score ?? 0).rounded()))" }

    // MARK: - Build

    override func buildLevel() {
        elapsed = 0
        pulled = []
        pins = [:]
        latched = []
        winLatchedAt = nil
        dying = false
        calmFrames = 0
        lastPullTime = -10
        lastHUD = ""
        hero = nil
        treasure = nil
        liquid.removeAll()
        replayQueue = replayTemplate ?? []
        physicsWorld.gravity = CGVector(dx: 0, dy: -6)
        physicsWorld.speed = 1

        addBounds()
        if level.frame ?? true { addFrame() }
        for wall in level.walls ?? [] { addWall(wall.cgRect) }
        for slab in level.slabs ?? [] { addSlab(slab) }
        for drain in level.drains ?? [] { addDrain(drain.cgRect) }
        if let goal = level.actors.goal { addGoal(goal.cgRect) }
        for pin in level.pins { addPin(pin) }
        liquid.layer.removeFromParent()
        addChild(liquid.layer)
        if let view {
            for pool in level.pools ?? [] {
                let kind = LiquidKind(rawValue: pool.liquid) ?? .water
                let texture = NodeFactory.shared.circle(radius: LiquidSystem.radius * LiquidSystem.visualScale,
                                                        color: kind.color, view: view)
                liquid.spawn(in: pool.cgRect, count: pool.count, kind: kind, texture: texture)
            }
        }
        if let spot = level.actors.hero {
            let node = HeroNode()
            node.position = CGPoint(x: spot.x, y: spot.y)
            addChild(node)
            hero = node
        }
        if let spot = level.actors.treasure {
            let node = TreasureNode()
            node.position = CGPoint(x: spot.x, y: spot.y)
            addChild(node)
            treasure = node
        }
        addHint()
        pushHUD()
    }

    private func addBounds() {
        let node = SKNode()
        let body = SKPhysicsBody(edgeLoopFrom: GameSceneBase.playfield)
        body.categoryBitMask = PinCategory.wall
        body.friction = 0.4
        body.restitution = 0
        node.physicsBody = body
        addChild(node)
    }

    private func addFrame() {
        let t = PinScene.frameThickness
        addWall(CGRect(x: 24, y: 54, width: t, height: 660))
        addWall(CGRect(x: 364, y: 54, width: t, height: 660))
        addWall(CGRect(x: 24, y: 54, width: 354, height: t))
    }

    private func wallBody(_ body: SKPhysicsBody) -> SKPhysicsBody {
        body.isDynamic = false
        body.friction = 0.4
        body.restitution = 0
        body.categoryBitMask = PinCategory.wall
        return body
    }

    private func addWall(_ rect: CGRect) {
        let node = SKShapeNode(rectOf: rect.size)
        node.position = CGPoint(x: rect.midX, y: rect.midY)
        node.fillColor = Palette.wall
        node.strokeColor = Palette.outline
        node.lineWidth = 1
        node.physicsBody = wallBody(SKPhysicsBody(rectangleOf: rect.size))
        addChild(node)
    }

    private func addSlab(_ slab: PinLevel.Slab) {
        let quad = Geometry.segmentQuad(CGPoint(x: slab.x1, y: slab.y1), CGPoint(x: slab.x2, y: slab.y2),
                                        halfWidth: (slab.t ?? PinScene.frameThickness) / 2)
        let path = CGMutablePath()
        path.addLines(between: quad)
        path.closeSubpath()
        let node = SKShapeNode(path: path)
        node.fillColor = Palette.wall
        node.strokeColor = Palette.outline
        node.lineWidth = 1
        node.physicsBody = wallBody(SKPhysicsBody(polygonFrom: path))
        addChild(node)
    }

    private func addDrain(_ rect: CGRect) {
        let node = SKShapeNode(rect: rect)
        node.fillColor = Palette.drain
        node.strokeColor = Palette.muted
        node.lineWidth = 1
        addChild(node)
        let hatch = CGMutablePath()
        var x = rect.minX
        while x < rect.maxX {
            hatch.move(to: CGPoint(x: x, y: rect.minY))
            hatch.addLine(to: CGPoint(x: min(x + rect.height, rect.maxX), y: min(rect.minY + rect.height, rect.maxY)))
            x += 10
        }
        let lines = SKShapeNode(path: hatch)
        lines.strokeColor = Palette.muted.withAlphaComponent(0.6)
        lines.lineWidth = 1
        addChild(lines)
        let body = SKPhysicsBody(rectangleOf: rect.size, center: CGPoint(x: rect.midX, y: rect.midY))
        body.isDynamic = false
        body.categoryBitMask = PinCategory.drain
        body.collisionBitMask = 0
        body.contactTestBitMask = PinCategory.liquid | PinCategory.treasure
        node.physicsBody = body
    }

    private func addGoal(_ rect: CGRect) {
        let dashed = CGPath(rect: rect, transform: nil).copy(dashingWithPhase: 0, lengths: [6, 4])
        let node = SKShapeNode(path: dashed)
        node.strokeColor = Palette.goal
        node.lineWidth = 1
        node.fillColor = Palette.goal.withAlphaComponent(0.08)
        addChild(node)
        let label = SKLabelNode(fontNamed: "Menlo-Bold")
        label.text = "EXIT"
        label.fontSize = 11
        label.fontColor = Palette.goal.withAlphaComponent(0.8)
        label.position = CGPoint(x: rect.midX, y: rect.minY + 6)
        addChild(label)
        let body = SKPhysicsBody(rectangleOf: rect.size, center: CGPoint(x: rect.midX, y: rect.midY))
        body.isDynamic = false
        body.categoryBitMask = PinCategory.goal
        body.collisionBitMask = 0
        body.contactTestBitMask = PinCategory.hero | PinCategory.treasure
        node.physicsBody = body
    }

    private func addPin(_ pin: PinLevel.Pin) {
        let node = PinNode(id: pin.id, x: pin.x, y: pin.y, w: pin.w, side: pin.side)
        pins[pin.id] = node
        addChild(node)
    }

    private func addHint() {
        guard let hint = level.hint, !hint.isEmpty else { return }
        let label = SKLabelNode(fontNamed: "Menlo")
        label.text = hint
        label.fontSize = 12
        label.fontColor = Palette.muted
        label.numberOfLines = 2
        label.preferredMaxLayoutWidth = 360
        label.horizontalAlignmentMode = .center
        label.verticalAlignmentMode = .top
        label.position = CGPoint(x: 201, y: 742)
        addChild(label)
    }

    // MARK: - Input

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard !finished, !dying, let touch = touches.first else { return }
        let point = touch.location(in: self)
        if let pin = pins.values.first(where: { !$0.pulled && $0.hitRect.contains(point) }) {
            pull(pin.pinID)
        }
    }

    @discardableResult
    func pull(_ id: String) -> Bool {
        guard !finished, !dying, let pin = pins[id], !pin.pulled else { return false }
        pin.pull()
        pulled.append(id)
        lastPullTime = elapsed
        calmFrames = 0
        Haptics.shared.thud()
        Audio.play(.pinPull)
        pushHUD()
        return true
    }

    // MARK: - Simulation

    override func tick(dt: TimeInterval) {
        elapsed += dt
        steamBudget = 6
        var fastest = liquid.step()
        for node in [hero as SKNode?, treasure as SKNode?].compactMap({ $0 }) {
            if let v = node.physicsBody?.velocity { fastest = max(fastest, hypot(v.dx, v.dy)) }
        }
        calmFrames = fastest < 6 ? calmFrames + 1 : 0

        guard !finished, !dying else { return }
        // The goal is met, but lava may still be on its way. The win lands when the world has
        // settled, or after a few seconds if it never quite does. Lava that arrives first still
        // ends him, which is the whole point. This comes before any replayed pull so a settled
        // win is not undone by the next tap.
        if let at = winLatchedAt {
            if calmFrames >= 30 || elapsed - at > 4 { win() } else { pushHUD() }
            return
        }

        if replayArmed, !replayQueue.isEmpty {
            let since = elapsed - lastPullTime
            let ready = pulled.isEmpty ? elapsed >= 0.8 : (since >= 1.0 && (calmFrames >= 30 || since >= 8.0))
            if ready { pull(replayQueue.removeFirst()) }
        }
        if !pins.isEmpty, pins.values.allSatisfy(\.pulled), calmFrames >= 45, elapsed - lastPullTime > 1.5 {
            lose("Nothing left to pull.")
            return
        }
        // A replay has no more moves; once the world stops, its outcome is known.
        if replayArmed, replayQueue.isEmpty, calmFrames >= 45, elapsed - lastPullTime > 1.5, elapsed > 3 {
            lose("Settled short of the goal.")
            return
        }
        pushHUD()
    }

    override func handle(contacts: [ContactEvent]) {
        guard !finished, !dying else { return }
        var heroBurned = false
        var treasureLost = false
        for event in contacts {
            if event.matches(PinCategory.lava, PinCategory.hero) {
                heroBurned = true
            } else if let (water, lava) = event.pair(PinCategory.water, PinCategory.lava) {
                annihilate(water: water, lava: lava)
            } else if let (particle, _) = event.pair(PinCategory.liquid, PinCategory.drain) {
                liquid.remove(particle)
            } else if event.matches(PinCategory.treasure, PinCategory.drain) {
                treasureLost = true
            } else if event.matches(PinCategory.hero, PinCategory.goal) {
                latched.insert("heroGoal")
            } else if event.matches(PinCategory.treasure, PinCategory.hero) {
                latched.insert("treasureHero")
            } else if event.matches(PinCategory.treasure, PinCategory.goal) {
                latched.insert("treasureGoal")
            }
        }
        if heroBurned {
            heroDies()
        } else if treasureLost {
            lose("The treasure went down the drain.")
        } else if winConditionMet, winLatchedAt == nil {
            winLatchedAt = elapsed
            calmFrames = 0
        }
    }

    private func annihilate(water: SKNode, lava: SKNode) {
        guard water.parent != nil, lava.parent != nil else { return }
        let mid = CGPoint(x: (water.position.x + lava.position.x) / 2, y: (water.position.y + lava.position.y) / 2)
        liquid.remove(water)
        liquid.remove(lava)
        if steamBudget > 0 {
            steamBudget -= 1
            puff(at: mid)
        }
    }

    private func puff(at point: CGPoint) {
        let node = SKShapeNode(circleOfRadius: 4)
        node.fillColor = Palette.steam.withAlphaComponent(0.7)
        node.strokeColor = .clear
        node.position = point
        node.zPosition = 8
        addChild(node)
        let duration = Motion.decorative(0.45)
        node.run(.sequence([
            .group([.moveBy(x: 0, y: 14, duration: duration), .scale(to: 2, duration: duration), .fadeOut(withDuration: duration)]),
            .removeFromParent(),
        ]))
    }

    private var winConditionMet: Bool {
        switch level.winWhen {
        case "heroReachesGoal": return latched.contains("heroGoal")
        case "treasureReachesGoal": return latched.contains("treasureGoal")
        case "both": return latched.contains("treasureHero") && latched.contains("heroGoal")
        default: return latched.contains("treasureHero")
        }
    }

    private func heroDies() {
        guard let hero, !dying else { return }
        dying = true
        Haptics.shared.slam()
        Audio.play(.sizzle)
        hero.die { [weak self] in self?.lose("The hero got cooked.") }
    }

    private func win() {
        hero?.celebrate()
        Haptics.shared.success()
        Audio.play(.win)
        finish(.won(stars: level.stars(forPulls: pulled.count), coins: 0, score: Double(pulled.count)))
        pushHUD()
    }

    private func lose(_ reason: String) {
        Haptics.shared.failure()
        Audio.play(.lose)
        finish(.lost(reason: reason))
        pushHUD()
    }

    private func pushHUD() {
        let remaining = pins.values.filter { !$0.pulled }.count
        var readout = "pins \(remaining) left   pulled \(pulled.count)   par \(level.parPins)"
        if winLatchedAt != nil, !finished { readout += "   waiting for calm" }
        guard readout != lastHUD else { return }
        lastHUD = readout
        setHUD(HUDState(title: "\(levelIndex + 1). \(level.name)", readout: readout, progress: nil))
    }
}
