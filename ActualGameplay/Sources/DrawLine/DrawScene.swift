import SpriteKit
import UIKit

/// Draw-a-line: the player sketches strokes that become rigid bodies, and physics decides the rest.
///
/// By default the world is frozen until the first stroke lands, so a level is a still picture the
/// player gets to think about. Levels that want timing pressure set `liveStart`.
final class DrawScene: GameSceneBase, ReplayableScene {
    /// Where strokes may go: the playfield minus the HUD band under the Dynamic Island.
    static let drawArea = CGRect(x: 0, y: 34, width: 402, height: 720)

    private enum Palette {
        static let solid = UIColor(hex: 0x262A32)
        static let outline = UIColor(hex: 0x3F4553)
        static let outlineStrong = UIColor(hex: 0x6B7280)
        static let ball = UIColor(hex: 0x7BD3FF)
        static let block = UIColor(hex: 0xE2E4EA)
        static let mover = UIColor(hex: 0x9AA0AC)
        static let gold = UIColor(hex: 0xFFD166)
        static let danger = UIColor(hex: 0xFF5C5C)
        static let muted = UIColor(hex: 0x6B7280)
    }

    let level: DrawLevel
    let levelIndex: Int
    /// Strokes committed this attempt, for the developer solution logger.
    private(set) var committedStrokes: [[CGPoint]] = []

    var levelID: String { level.id }
    var levelName: String { level.name }
    var hasSolution: Bool { level.solution != nil }
    var replayWait: TimeInterval { level.solution?.waitSeconds ?? 6 }

    func startReplay() {
        if let solution = level.solution { replay(solution) }
    }

    func describe(score: Double?) -> String { "ink \(Int((score ?? 0).rounded()))" }

    private var capture: StrokeCapture!
    private var goals: GoalTracker!
    private var objects: [String: SKNode] = [:]
    private var zones: [String: CGRect] = [:]
    private var forbidden: [CGRect] = []
    private var frozen = true
    private var elapsed: TimeInterval = 0
    private var replaySolution: DrawLevel.Solution?
    private var pendingReplay: [(time: TimeInterval, points: [CGPoint])] = []
    private weak var activeTouch: UITouch?
    private var shownInk = -1
    private var shownFrozen: Bool?
    private var shownDwell = -1

    init(level: DrawLevel, index: Int) {
        self.level = level
        self.levelIndex = index
        super.init(size: GameSceneBase.canvas)
    }

    required init?(coder aDecoder: NSCoder) { fatalError("scenes are built in code") }

    /// Play the stored solution once the scene runs, and again after every reset.
    func replay(_ solution: DrawLevel.Solution) {
        replaySolution = solution
        scheduleReplay()
    }

    private func scheduleReplay() {
        pendingReplay = []
        guard let solution = replaySolution else { return }
        var time = solution.delay ?? 0
        for stroke in solution.strokes {
            time += stroke.delay ?? 0
            pendingReplay.append((time, stroke.cgPoints))
        }
    }

    // MARK: - Build

    override func buildLevel() {
        elapsed = 0
        frozen = !(level.liveStart ?? false)
        objects = [:]
        zones = [:]
        forbidden = []
        committedStrokes = []
        shownInk = -1
        shownFrozen = nil
        shownDwell = -1
        physicsWorld.gravity = CGVector(dx: 0, dy: level.gravity ?? -9.8)
        physicsWorld.speed = frozen ? 0 : 1
        capture = StrokeCapture(scene: self, drawArea: DrawScene.drawArea, budget: level.inkBudget)
        goals = GoalTracker(goal: level.goal)
        scheduleReplay()

        addBounds()
        for rect in level.forbidden ?? [] { addForbidden(rect.cgRect) }
        for item in level.statics ?? [] { addStatic(item) }
        for rect in level.killers ?? [] { addKiller(rect.cgRect) }
        for region in level.targets ?? [] { addTarget(region) }
        for region in level.zones ?? [] { addZone(region) }
        for mover in level.movers ?? [] { addMover(mover) }
        for object in level.dynamics ?? [] { addDynamic(object) }
        for joint in level.joints ?? [] { addJoint(joint) }
        addHint()
        pushHUD()
    }

    /// Left wall, ceiling under the HUD, right wall. No floor: falling out is a real outcome.
    private func addBounds() {
        let field = GameSceneBase.playfield
        let path = CGMutablePath()
        path.move(to: CGPoint(x: field.minX, y: -300))
        path.addLine(to: CGPoint(x: field.minX, y: field.maxY))
        path.addLine(to: CGPoint(x: field.maxX, y: field.maxY))
        path.addLine(to: CGPoint(x: field.maxX, y: -300))
        let node = SKNode()
        let body = SKPhysicsBody(edgeChainFrom: path)
        body.categoryBitMask = DrawCategory.wall
        body.friction = 0.4
        body.restitution = 0.1
        node.physicsBody = body
        addChild(node)
    }

    private func solidBody(_ body: SKPhysicsBody) -> SKPhysicsBody {
        body.isDynamic = false
        body.friction = 0.5
        body.restitution = 0.1
        body.categoryBitMask = DrawCategory.wall
        return body
    }

    private func addStatic(_ item: DrawLevel.Static) {
        let solid = item.solid ?? true
        switch item.type {
        case "rect":
            let size = CGSize(width: item.w ?? 10, height: item.h ?? 10)
            let node = SKShapeNode(rectOf: size)
            node.position = CGPoint(x: (item.x ?? 0) + size.width / 2, y: (item.y ?? 0) + size.height / 2)
            node.fillColor = Palette.solid
            node.strokeColor = Palette.outline
            node.lineWidth = 1
            if solid { node.physicsBody = solidBody(SKPhysicsBody(rectangleOf: size)) }
            addChild(node)
        case "circle":
            let radius = item.r ?? 10
            let node = SKShapeNode(circleOfRadius: radius)
            node.position = CGPoint(x: item.x ?? 0, y: item.y ?? 0)
            node.fillColor = Palette.solid
            node.strokeColor = Palette.outline
            node.lineWidth = 1
            if solid { node.physicsBody = solidBody(SKPhysicsBody(circleOfRadius: radius)) }
            addChild(node)
        case "chain":
            let points = (item.points ?? []).map { CGPoint(x: $0[0], y: $0[1]) }
            guard points.count >= 2 else { return }
            let path = CGMutablePath()
            path.addLines(between: points)
            let node = SKShapeNode(path: path)
            node.strokeColor = Palette.outlineStrong
            node.lineWidth = 3
            node.lineCap = .round
            node.lineJoin = .round
            node.physicsBody = solidBody(SKPhysicsBody(edgeChainFrom: path))
            addChild(node)
        default:
            break
        }
    }

    private func addKiller(_ rect: CGRect) {
        let path = CGMutablePath()
        let baseTop = rect.minY + rect.height * 0.4
        path.addRect(CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height * 0.4))
        let spike: CGFloat = 12
        var x = rect.minX
        while x + spike <= rect.maxX + 0.5 {
            path.move(to: CGPoint(x: x, y: baseTop))
            path.addLine(to: CGPoint(x: x + spike / 2, y: rect.maxY))
            path.addLine(to: CGPoint(x: x + spike, y: baseTop))
            path.closeSubpath()
            x += spike
        }
        let node = SKShapeNode(path: path)
        node.fillColor = Palette.danger
        node.strokeColor = .clear
        let body = SKPhysicsBody(rectangleOf: rect.size, center: CGPoint(x: rect.midX, y: rect.midY))
        body.isDynamic = false
        body.friction = 0.8
        body.categoryBitMask = DrawCategory.killer
        node.physicsBody = body
        addChild(node)
    }

    private func addTarget(_ region: DrawLevel.Region) {
        let rect = region.cgRect
        let node = SKShapeNode(rect: rect)
        node.fillColor = Palette.gold.withAlphaComponent(0.22)
        node.strokeColor = Palette.gold
        node.lineWidth = 1
        node.name = region.id
        let body = SKPhysicsBody(rectangleOf: rect.size, center: CGPoint(x: rect.midX, y: rect.midY))
        body.isDynamic = false
        body.categoryBitMask = DrawCategory.target
        body.collisionBitMask = 0
        body.contactTestBitMask = DrawCategory.object
        node.physicsBody = body
        addChild(node)
    }

    private func addZone(_ region: DrawLevel.Region) {
        let rect = region.cgRect
        zones[region.id] = rect
        let dashed = CGPath(rect: rect, transform: nil).copy(dashingWithPhase: 0, lengths: [6, 4])
        let node = SKShapeNode(path: dashed)
        node.strokeColor = Palette.ball.withAlphaComponent(0.7)
        node.lineWidth = 1
        node.fillColor = Palette.ball.withAlphaComponent(0.06)
        addChild(node)
    }

    private func addForbidden(_ rect: CGRect) {
        forbidden.append(rect)
        let dashed = CGPath(rect: rect, transform: nil).copy(dashingWithPhase: 0, lengths: [4, 4])
        let node = SKShapeNode(path: dashed)
        node.strokeColor = Palette.danger.withAlphaComponent(0.5)
        node.lineWidth = 1
        node.fillColor = Palette.danger.withAlphaComponent(0.06)
        addChild(node)
        let label = SKLabelNode(fontNamed: "Menlo")
        label.text = "no ink"
        label.fontSize = 11
        label.fontColor = Palette.danger.withAlphaComponent(0.7)
        label.position = CGPoint(x: rect.midX, y: rect.maxY - 18)
        addChild(label)
    }

    private func addMover(_ mover: DrawLevel.Mover) {
        let size = CGSize(width: mover.w, height: mover.h)
        let node = SKShapeNode(rectOf: size)
        node.position = CGPoint(x: mover.x + size.width / 2, y: mover.y + size.height / 2)
        node.fillColor = Palette.mover
        node.strokeColor = .clear
        node.name = mover.id
        let body = SKPhysicsBody(rectangleOf: size)
        body.isDynamic = false
        body.friction = 0.5
        body.categoryBitMask = DrawCategory.mover
        node.physicsBody = body
        let go = SKAction.move(by: CGVector(dx: mover.dx, dy: mover.dy), duration: TimeInterval(mover.period / 2))
        go.timingMode = .easeInEaseOut
        node.run(.repeatForever(.sequence([go, go.reversed()])))
        addChild(node)
    }

    private func addDynamic(_ object: DrawLevel.Dynamic) {
        let node: SKShapeNode
        let body: SKPhysicsBody
        if object.shape == "ball" {
            let radius = object.r ?? 14
            node = SKShapeNode(circleOfRadius: radius)
            node.fillColor = Palette.ball
            body = SKPhysicsBody(circleOfRadius: radius)
            body.usesPreciseCollisionDetection = true
            body.restitution = object.restitution ?? 0.2
            body.friction = object.friction ?? 0.4
        } else if object.shape == "cup" {
            // An open-topped U: two walls and a floor, one compound body.
            let w = object.w ?? 100
            let h = object.h ?? 70
            let t = object.t ?? 8
            let path = CGMutablePath()
            path.addRect(CGRect(x: -w / 2, y: -h / 2, width: t, height: h))
            path.addRect(CGRect(x: w / 2 - t, y: -h / 2, width: t, height: h))
            path.addRect(CGRect(x: -w / 2, y: -h / 2, width: w, height: t))
            node = SKShapeNode(path: path)
            node.fillColor = Palette.block
            body = SKPhysicsBody(bodies: [
                SKPhysicsBody(rectangleOf: CGSize(width: t, height: h), center: CGPoint(x: -w / 2 + t / 2, y: 0)),
                SKPhysicsBody(rectangleOf: CGSize(width: t, height: h), center: CGPoint(x: w / 2 - t / 2, y: 0)),
                SKPhysicsBody(rectangleOf: CGSize(width: w, height: t), center: CGPoint(x: 0, y: -h / 2 + t / 2)),
            ])
            body.mass = (2 * t * h + (w - 2 * t) * t) / 22_500
            body.restitution = object.restitution ?? 0.1
            body.friction = object.friction ?? 0.6
        } else {
            let size = CGSize(width: object.w ?? 30, height: object.h ?? 30)
            node = SKShapeNode(rectOf: size)
            node.fillColor = Palette.block
            body = SKPhysicsBody(rectangleOf: size)
            body.restitution = object.restitution ?? 0.1
            body.friction = object.friction ?? 0.6
        }
        node.strokeColor = .clear
        node.position = CGPoint(x: object.x, y: object.y)
        node.name = object.id
        if let density = object.density { body.density = density }
        body.linearDamping = 0.1
        body.angularDamping = 0.1
        body.categoryBitMask = DrawCategory.object
        body.collisionBitMask = DrawCategory.wall | DrawCategory.drawn | DrawCategory.object | DrawCategory.mover | DrawCategory.killer
        body.contactTestBitMask = DrawCategory.target | DrawCategory.killer
        node.physicsBody = body
        addChild(node)
        body.velocity = CGVector(dx: object.vx ?? 0, dy: object.vy ?? 0)
        objects[object.id] = node
    }

    private func addJoint(_ joint: DrawLevel.Joint) {
        guard joint.type == "pin", let bodyA = objects[joint.a]?.physicsBody else { return }
        let anchor = CGPoint(x: joint.x, y: joint.y)
        let bodyB: SKPhysicsBody
        if joint.b == "world" {
            let pivot = SKNode()
            pivot.position = anchor
            let pivotBody = SKPhysicsBody(circleOfRadius: 2)
            pivotBody.isDynamic = false
            pivotBody.categoryBitMask = 0
            pivotBody.collisionBitMask = 0
            pivot.physicsBody = pivotBody
            addChild(pivot)
            bodyB = pivotBody
        } else if let other = objects[joint.b]?.physicsBody {
            bodyB = other
        } else {
            return
        }
        physicsWorld.add(SKPhysicsJointPin.joint(withBodyA: bodyA, bodyB: bodyB, anchor: anchor))
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
        guard !finished, activeTouch == nil, let touch = touches.first else { return }
        activeTouch = touch
        capture.begin(at: touch.location(in: self))
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = activeTouch, touches.contains(touch) else { return }
        capture.move(to: touch.location(in: self))
        pushHUD()
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = activeTouch, touches.contains(touch) else { return }
        activeTouch = nil
        if let raw = capture.end() { commit(raw: raw) }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = activeTouch, touches.contains(touch) else { return }
        activeTouch = nil
        capture.cancel()
        pushHUD()
    }

    /// The one path every stroke takes, drawn by a finger or replayed from a level file.
    @discardableResult
    func commit(raw: [CGPoint]) -> Bool {
        guard !finished, !raw.isEmpty else { return false }
        let points = StrokeBody.prepare(raw)
        let cost = StrokeBody.inkCost(rawLength: Geometry.polylineLength(raw))
        guard cost <= capture.inkLeft + 0.5 else {
            reject(points, reason: "out of ink")
            return false
        }
        let samples = points.count == 1 ? points : Geometry.resample(points, spacing: 6)
        if samples.contains(where: { p in forbidden.contains { $0.contains(p) } }) {
            reject(points, reason: "no ink here")
            return false
        }
        if samples.contains(where: overlapsBody) {
            reject(points, reason: "blocked")
            return false
        }
        let node = StrokeBody.makeNode(points: points, dynamic: !(level.pinnedInk ?? false))
        addChild(node)
        capture.spend(cost)
        committedStrokes.append(points)
        if frozen {
            frozen = false
            physicsWorld.speed = 1
        }
        Haptics.shared.tap()
        Audio.play(.tap)
        pushHUD()
        return true
    }

    private func overlapsBody(_ point: CGPoint) -> Bool {
        var hit = false
        let solid = DrawCategory.wall | DrawCategory.object | DrawCategory.drawn | DrawCategory.mover | DrawCategory.killer
        physicsWorld.enumerateBodies(at: point) { body, stop in
            if body.categoryBitMask & solid != 0 {
                hit = true
                stop.pointee = true
            }
        }
        return hit
    }

    private func reject(_ points: [CGPoint], reason: String) {
        guard let first = points.first else { return }
        let node = SKShapeNode()
        let path = CGMutablePath()
        if points.count == 1 {
            path.addEllipse(in: CGRect(x: first.x - 4, y: first.y - 4, width: 8, height: 8))
        } else {
            path.addLines(between: points)
        }
        node.path = path
        node.lineWidth = points.count == 1 ? 0 : StrokeBody.width
        node.lineCap = .round
        node.lineJoin = .round
        node.strokeColor = Palette.danger
        node.fillColor = points.count == 1 ? Palette.danger : .clear
        node.zPosition = 60
        addChild(node)
        node.run(.sequence([.wait(forDuration: 0.15), .fadeOut(withDuration: Motion.decorative(0.35)), .removeFromParent()]))

        let label = SKLabelNode(fontNamed: "Menlo-Bold")
        label.text = reason
        label.fontSize = 12
        label.fontColor = Palette.danger
        label.position = CGPoint(x: min(max(first.x, 40), 362), y: min(first.y + 24, 740))
        label.zPosition = 60
        addChild(label)
        label.run(.sequence([.wait(forDuration: 0.7), .fadeOut(withDuration: 0.3), .removeFromParent()]))
        Haptics.shared.thud()
    }

    // MARK: - Simulation

    override func tick(dt: TimeInterval) {
        elapsed += dt
        while let next = pendingReplay.first, elapsed >= next.time {
            pendingReplay.removeFirst()
            commit(raw: next.points)
        }
        guard !finished, !frozen else { return }
        if goals.evaluate(dt: dt, nodes: objects, zones: zones) {
            win()
            return
        }
        for (id, node) in objects
        where node.position.y < -60 && level.goal.objects.contains(id) && !level.goal.allowsFallOut(id) {
            lose("\(displayName(id)) fell out of the world.")
            return
        }
        pushHUD()
    }

    override func handle(contacts: [ContactEvent]) {
        guard !finished else { return }
        for event in contacts {
            if let (object, target) = event.pair(DrawCategory.object, DrawCategory.target),
               let objectID = object.name, let targetID = target.name {
                goals.noteContact(object: objectID, target: targetID)
            }
            if let (object, _) = event.pair(DrawCategory.object, DrawCategory.killer),
               let objectID = object.name, level.goal.objects.contains(objectID) {
                lose("\(displayName(objectID)) hit the spikes.")
                return
            }
        }
    }

    private func win() {
        let ink = capture.inkUsed
        Haptics.shared.success()
        Audio.play(.win)
        #if DEBUG
        if DeveloperFlags.shared.logSolutions { logSolution() }
        #endif
        finish(.won(stars: level.stars(forInk: ink), coins: 0, score: Double(ink)))
        pushHUD()
    }

    private func lose(_ reason: String) {
        Haptics.shared.failure()
        Audio.play(.lose)
        finish(.lost(reason: reason))
    }

    private func displayName(_ id: String) -> String {
        id.hasPrefix("ball") ? "The ball" : "The \(id)"
    }

    private func pushHUD() {
        let ink = Int(capture.inkLeft.rounded())
        let dwell = goals.dwellFraction.map { Int($0 * 100) } ?? -1
        guard ink != shownInk || frozen != shownFrozen || dwell != shownDwell else { return }
        shownInk = ink
        shownFrozen = frozen
        shownDwell = dwell
        var readout = "ink \(ink)"
        if frozen { readout += "   draw to start" }
        if dwell >= 0 { readout += "   hold \(dwell)%" }
        setHUD(HUDState(title: "\(levelIndex + 1). \(level.name)",
                        readout: readout,
                        progress: Double(capture.inkLeft / max(1, level.inkBudget))))
    }

    #if DEBUG
    private func logSolution() {
        let strokes = committedStrokes.map { stroke in
            "{\"points\":[" + stroke.map { "[\(Int($0.x.rounded())),\(Int($0.y.rounded()))]" }.joined(separator: ",") + "]}"
        }
        let json = "\"solution\": {\"strokes\":[\(strokes.joined(separator: ","))], \"waitSeconds\": 6}"
        print("SOLUTION \(level.id): \(json)")
        UIPasteboard.general.string = json
    }
    #endif
}
