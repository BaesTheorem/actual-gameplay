import SpriteKit
import UIKit

enum StrokeCategory {
    static let wall: UInt32 = 1 << 0
    static let drawn: UInt32 = 1 << 1
    static let actor: UInt32 = 1 << 2
    static let killer: UInt32 = 1 << 3
    static let bee: UInt32 = 1 << 4
}

/// Everything a draw-a-stroke level shares: ink capture, the commit path (trimmed around
/// bodies and no-ink zones), replayed solutions, the frozen-until-first-stroke world, calm
/// tracking, and the shared level builders. Subclasses supply the objective.
class StrokeScene: GameSceneBase {
    /// Where strokes may go: the playfield minus the HUD band under the Dynamic Island.
    static let drawArea = CGRect(x: 0, y: 34, width: 402, height: 720)

    enum Palette {
        static let solid = UIColor(hex: 0x262A32)
        static let outline = UIColor(hex: 0x3F4553)
        static let danger = UIColor(hex: 0xFF5C5C)
        static let muted = UIColor(hex: 0x5B6470)
    }

    // Subclasses override these from their level.
    var inkBudget: CGFloat { 0 }
    var pinnedInk: Bool { false }
    var forbiddenRects: [LevelRect] { [] }
    var hintText: String? { nil }
    var strokeColor: UIColor { StrokeBody.color }

    private(set) var capture: StrokeCapture!
    private(set) var committedStrokes: [[CGPoint]] = []
    private(set) var frozen = true
    private(set) var elapsed: TimeInterval = 0
    private(set) var calmFrames = 0
    private var forbidden: [CGRect] = []
    private var replayTemplate: [(time: TimeInterval, points: [CGPoint])] = []
    private var pendingReplay: [(time: TimeInterval, points: [CGPoint])] = []
    private weak var activeTouch: UITouch?

    var replaying: Bool { !replayTemplate.isEmpty }
    var replayDrained: Bool { pendingReplay.isEmpty }
    var inkUsed: CGFloat { capture?.inkUsed ?? 0 }
    var inkLeft: CGFloat { capture?.inkLeft ?? 0 }

    // MARK: - Replay

    /// Play the stored solution once the scene runs, and again after every reset.
    func replay(_ solution: StrokeSolution, transform: StrokeTransform = .identity) {
        var time = solution.delay ?? 0
        var template: [(time: TimeInterval, points: [CGPoint])] = []
        for stroke in solution.strokes {
            time += stroke.delay ?? 0
            template.append((time, transform.apply(to: stroke.cgPoints)))
        }
        replayTemplate = template
        pendingReplay = template
    }

    /// Play arbitrary strokes, 0.4 s apart. The audit uses this for its naive attempts.
    func replay(strokes: [[CGPoint]]) {
        replayTemplate = strokes.enumerated().map { (0.3 + 0.4 * Double($0.offset), $0.element) }
        pendingReplay = replayTemplate
    }

    // MARK: - Build helpers

    /// Call first in `buildLevel`. Resets stroke state and the frozen world.
    func resetStrokeState(liveStart: Bool = false) {
        elapsed = 0
        calmFrames = 0
        frozen = !liveStart
        committedStrokes = []
        forbidden = []
        physicsWorld.speed = frozen ? 0 : 1
        capture = StrokeCapture(scene: self, drawArea: StrokeScene.drawArea, budget: inkBudget)
        capture.color = strokeColor
        pendingReplay = replayTemplate
        for rect in forbiddenRects { addForbidden(rect.cgRect) }
    }

    /// Left wall, ceiling under the HUD, right wall. No floor unless asked: falling out is real.
    func addBounds(floor: Bool) {
        let field = GameSceneBase.playfield
        let path = CGMutablePath()
        path.move(to: CGPoint(x: field.minX, y: floor ? field.minY : -300))
        path.addLine(to: CGPoint(x: field.minX, y: field.maxY))
        path.addLine(to: CGPoint(x: field.maxX, y: field.maxY))
        path.addLine(to: CGPoint(x: field.maxX, y: floor ? field.minY : -300))
        if floor { path.closeSubpath() }
        let node = SKNode()
        let body = floor ? SKPhysicsBody(edgeLoopFrom: path) : SKPhysicsBody(edgeChainFrom: path)
        body.categoryBitMask = StrokeCategory.wall
        body.friction = 0.6
        body.restitution = 0.1
        node.physicsBody = body
        addChild(node)
    }

    private func solidBody(_ body: SKPhysicsBody) -> SKPhysicsBody {
        body.isDynamic = false
        body.friction = 0.7
        body.restitution = 0.05
        body.categoryBitMask = StrokeCategory.wall
        return body
    }

    func addStatic(_ item: LevelStatic) {
        let solid = item.solid ?? true
        switch item.type {
        case "rect":
            let rect = CGRect(x: item.x ?? 0, y: item.y ?? 0, width: item.w ?? 10, height: item.h ?? 10)
            let node = Terrain.node(rect: rect, skin: item.skin)
            node.zPosition = 2
            if solid {
                let body = SKPhysicsBody(rectangleOf: rect.size, center: CGPoint(x: rect.midX, y: rect.midY))
                node.physicsBody = solidBody(body)
            }
            addChild(node)
        case "circle":
            let radius = item.r ?? 10
            let node = SKSpriteNode(texture: Sprite.rock.texture, size: CGSize(width: radius * 2.1, height: radius * 2.1))
            node.position = CGPoint(x: item.x ?? 0, y: item.y ?? 0)
            node.zPosition = 2
            if solid { node.physicsBody = solidBody(SKPhysicsBody(circleOfRadius: radius)) }
            addChild(node)
        case "chain":
            let points = (item.points ?? []).map { CGPoint(x: $0[0], y: $0[1]) }
            guard points.count >= 2 else { return }
            let path = CGMutablePath()
            path.addLines(between: points)
            let node = SKShapeNode(path: path)
            node.strokeColor = UIColor(hex: 0x6B4F2A)
            node.lineWidth = 6
            node.lineCap = .round
            node.lineJoin = .round
            node.zPosition = 2
            if solid { node.physicsBody = solidBody(SKPhysicsBody(edgeChainFrom: path)) }
            addChild(node)
        default:
            break
        }
    }

    func addKiller(_ rect: CGRect) {
        let node = Terrain.spikes(rect: rect)
        node.zPosition = 2
        let body = SKPhysicsBody(rectangleOf: rect.size, center: CGPoint(x: rect.midX, y: rect.midY))
        body.isDynamic = false
        body.friction = 0.8
        body.categoryBitMask = StrokeCategory.killer
        node.physicsBody = body
        addChild(node)
    }

    func addForbidden(_ rect: CGRect) {
        forbidden.append(rect)
        let dashed = CGPath(rect: rect, transform: nil).copy(dashingWithPhase: 0, lengths: [4, 4])
        let node = SKShapeNode(path: dashed)
        node.strokeColor = Palette.danger.withAlphaComponent(0.6)
        node.lineWidth = 1
        node.fillColor = Palette.danger.withAlphaComponent(0.08)
        node.zPosition = 3
        addChild(node)
        let label = SKLabelNode(fontNamed: "Menlo")
        label.text = "no ink"
        label.fontSize = 11
        label.fontColor = Palette.danger.withAlphaComponent(0.8)
        label.position = CGPoint(x: rect.midX, y: rect.maxY - 18)
        label.zPosition = 3
        addChild(label)
    }

    func addHint() {
        addHintLabel(hintText, color: Palette.muted, backdrop: backgroundColor)
    }

    // MARK: - Hooks for subclasses

    /// A stroke landed. The first one also unfreezes the world.
    func strokeDidCommit() {}

    /// Nothing is moving and either the replay is spent or the ink is gone.
    func strokesSettled() {}

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
    ///
    /// Parts of the stroke that cross a body or a no-ink zone are cut out rather than refusing the
    /// whole stroke: a shield drawn a hair into the ground still becomes a shield. Bodies that
    /// spawn overlapping explode, so the pieces also step back a little from whatever they touched.
    @discardableResult
    func commit(raw: [CGPoint]) -> Bool {
        guard !finished, !raw.isEmpty else { return false }
        let points = StrokeBody.prepare(raw)
        let requested = StrokeBody.inkCost(rawLength: Geometry.polylineLength(raw))
        guard requested <= capture.inkLeft + 0.5 else {
            reject(points, reason: "out of ink")
            return false
        }
        let (pieces, removed, hitForbidden) = trim(points)
        guard !pieces.isEmpty else {
            reject(points, reason: hitForbidden ? "no ink here" : "blocked")
            return false
        }
        if !removed.isEmpty { flashTrimmed(removed) }
        var cost: CGFloat = 0
        for piece in pieces {
            let node = StrokeBody.makeNode(points: piece, dynamic: !pinnedInk, color: strokeColor)
            addChild(node)
            cost += StrokeBody.inkCost(rawLength: Geometry.polylineLength(piece))
            committedStrokes.append(piece)
        }
        capture.spend(min(cost, requested))
        if frozen {
            frozen = false
            physicsWorld.speed = 1
        }
        calmFrames = 0
        Haptics.shared.tap()
        Audio.play(.tap)
        strokeDidCommit()
        pushHUD()
        return true
    }

    /// Split a stroke into the runs that lie clear of bodies and no-ink zones.
    private func trim(_ points: [CGPoint]) -> (pieces: [[CGPoint]], removed: [CGPoint], hitForbidden: Bool) {
        func blocked(_ p: CGPoint) -> (Bool, Bool) {
            let forbid = forbidden.contains { $0.contains(p) }
            return (forbid || overlapsBody(p), forbid)
        }
        if points.count == 1 {
            let (bad, forbid) = blocked(points[0])
            return bad ? ([], points, forbid) : ([points], [], false)
        }
        let samples = Geometry.resample(points, spacing: 3)
        var flags: [Bool] = []
        var hitForbidden = false
        for sample in samples {
            let (bad, forbid) = blocked(sample)
            flags.append(bad)
            if forbid { hitForbidden = true }
        }
        guard flags.contains(true) else { return ([points], [], false) }
        var widened = flags
        for i in flags.indices where flags[i] {
            for j in max(0, i - 2)...min(flags.count - 1, i + 2) { widened[j] = true }
        }
        var pieces: [[CGPoint]] = []
        var run: [CGPoint] = []
        for (sample, bad) in zip(samples, widened) {
            if bad {
                if Geometry.polylineLength(run) >= StrokeBody.minLength { pieces.append(StrokeBody.prepare(run)) }
                run = []
            } else {
                run.append(sample)
            }
        }
        if Geometry.polylineLength(run) >= StrokeBody.minLength { pieces.append(StrokeBody.prepare(run)) }
        let removed = zip(samples, widened).filter { $0.1 }.map { $0.0 }
        return (pieces.filter { !$0.isEmpty }, removed, hitForbidden)
    }

    private func overlapsBody(_ point: CGPoint) -> Bool {
        var hit = false
        let solid = StrokeCategory.wall | StrokeCategory.actor | StrokeCategory.drawn | StrokeCategory.killer
        physicsWorld.enumerateBodies(at: point) { body, stop in
            if body.categoryBitMask & solid != 0 {
                hit = true
                stop.pointee = true
            }
        }
        return hit
    }

    private func flashTrimmed(_ points: [CGPoint]) {
        let path = CGMutablePath()
        for p in points { path.addEllipse(in: CGRect(x: p.x - 2, y: p.y - 2, width: 4, height: 4)) }
        let node = SKShapeNode(path: path)
        node.fillColor = Palette.danger.withAlphaComponent(0.8)
        node.strokeColor = .clear
        node.zPosition = 60
        addChild(node)
        node.run(.sequence([.wait(forDuration: 0.2), .fadeOut(withDuration: Motion.decorative(0.4)), .removeFromParent()]))
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

    // MARK: - Frame

    /// Advances time, commits due replay strokes, tracks calm. Subclasses call super first.
    override func tick(dt: TimeInterval) {
        elapsed += dt
        while let next = pendingReplay.first, elapsed >= next.time {
            pendingReplay.removeFirst()
            commit(raw: next.points)
        }
        guard !finished, !frozen else { return }
        var fastest: CGFloat = 0
        for child in children {
            guard let body = child.physicsBody, body.isDynamic else { continue }
            fastest = max(fastest, hypot(body.velocity.dx, body.velocity.dy), abs(body.angularVelocity) * 20)
        }
        calmFrames = fastest < 6 ? calmFrames + 1 : 0
        if calmFrames == 45, replaying ? pendingReplay.isEmpty : (capture.inkLeft < 1 && !capture.isDrawing) {
            strokesSettled()
        }
    }

    /// Freeze strokes that have come to rest, so a swarm cannot shove a settled shield.
    func freezeSettledStrokes() {
        for child in children where child.name == "stroke" {
            guard let body = child.physicsBody, body.isDynamic else { continue }
            if hypot(body.velocity.dx, body.velocity.dy) < 6, abs(body.angularVelocity) < 0.3 {
                body.isDynamic = false
            }
        }
    }

    /// Subclasses publish their own HUD; the base only knows about ink.
    func pushHUD() {}
}
