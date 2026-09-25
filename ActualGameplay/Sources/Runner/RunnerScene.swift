import SpriteKit
import UIKit

/// Crowd Run: steer a crowd down a road, pick the better gate, dodge what kills, storm the finish.
/// Pure kinematics in lane space; nothing here uses the physics engine.
final class RunnerScene: GameSceneBase, ReplayableScene {
    private enum Palette {
        static let road = UIColor(hex: 0xCDB894)   // a dusty path: light enough that brush flecks near the runners vanish and the violet rivals read
        static let edge = Pigment.ink
        /// Sap mixed into the paper, so the verge sits behind the road instead of competing with it.
        static let ground = UIColor(hex: 0xA9C48F)
        static let stripe = Pigment.ink.withAlphaComponent(0.45)
        static let good = Pigment.sap
        static let bad = UIColor(hex: 0xE2476E)
        static let bossBar = Pigment.clay
        static let bossTrack = Pigment.night
        static let label = Pigment.ink
    }

    /// Crowd runners, in clip-frame points at depth scale 1.
    private static let runnerHeight: CGFloat = 40

    /// One gate pair on the road: two panels that scale with depth.
    private final class GateNode: SKNode {
        let pair: GatePair
        var consumed = false
        let left: SKSpriteNode
        let right: SKSpriteNode

        init(pair: GatePair) {
            self.pair = pair
            left = GateNode.panel(for: pair.left)
            right = GateNode.panel(for: pair.right)
            super.init()
            addChild(left)
            addChild(right)
        }

        required init?(coder aDecoder: NSCoder) { fatalError("built in code") }

        static func panel(for op: GateOp) -> SKSpriteNode {
            let color = op.isGood ? Palette.good : Palette.bad
            let node = SKSpriteNode(color: color.withAlphaComponent(0.8), size: CGSize(width: Projection.halfRoad - 8, height: 96))
            let frame = SKShapeNode(rectOf: node.size, cornerRadius: 6)
            frame.strokeColor = Palette.edge
            frame.lineWidth = 2.5
            frame.fillColor = .clear
            node.addChild(frame)
            let label = SKLabelNode(fontNamed: Painted.font)
            label.text = op.label
            label.fontSize = 36
            label.fontColor = Palette.label
            label.verticalAlignmentMode = .center
            node.addChild(label)
            return node
        }

        func choose(leftSide: Bool) {
            consumed = true
            let taken = leftSide ? left : right
            let other = leftSide ? right : left
            taken.run(.sequence([.fadeAlpha(to: 1, duration: 0.05), .fadeOut(withDuration: 0.3)]))
            other.run(.fadeOut(withDuration: 0.3))
        }
    }

    private final class ObstacleNode: SKNode {
        let obstacle: Obstacle
        var resolved = false
        let sprite: SKSpriteNode

        init(obstacle: Obstacle) {
            self.obstacle = obstacle
            switch obstacle.hazard {
            case .wall:
                sprite = SKSpriteNode(color: .clear, size: CGSize(width: 100, height: 44))
                for i in 0..<3 {
                    let block = SKSpriteNode(texture: Sprite.dangerBlock.texture, size: CGSize(width: 34, height: 44))
                    block.position = CGPoint(x: -33 + CGFloat(i) * 33, y: 0)
                    sprite.addChild(block)
                }
            case .blade:
                sprite = SKSpriteNode(texture: Sprite.sawA.texture, size: CGSize(width: 64, height: 64))
                if !Motion.reduced {
                    sprite.run(.repeatForever(.animate(with: [Sprite.sawA.texture, Sprite.sawB.texture], timePerFrame: 0.08)))
                }
            case .spikes:
                sprite = SKSpriteNode(color: .clear, size: CGSize(width: 100, height: 24))
                for i in 0..<4 {
                    let spike = SKSpriteNode(texture: Sprite.spikes.texture, size: CGSize(width: 25, height: 24))
                    spike.position = CGPoint(x: -37.5 + CGFloat(i) * 25, y: 0)
                    sprite.addChild(spike)
                }
            }
            super.init()
            addChild(sprite)
        }

        required init?(coder aDecoder: NSCoder) { fatalError("built in code") }
    }

    let level: Int
    let economy: RunnerEconomy
    let track: Track

    var levelID: String { String(format: "%02d", level + 1) }
    var levelName: String { "Run \(level + 1)" }
    var hasSolution: Bool { true }
    var replayWait: TimeInterval { Double(track.finaleZ / track.speed) + 14 }

    /// How the autopilot steers. Greedy is the reference player; the others exist so the audit
    /// can ask whether steering matters at all.
    enum SteerPolicy: String {
        case greedy
        case straight
        case left
        case random
    }

    private(set) var policy: SteerPolicy = .greedy
    private var randomPicks: [ObjectIdentifier: CGFloat] = [:]
    private var rng = SeededRNG(seed: 7)

    func startReplay() { autopilot = true }

    func configure(policy: SteerPolicy) {
        self.policy = policy
        autopilot = true
    }

    func describe(score: Double?) -> String { "survivors \(Int((score ?? 0).rounded()))" }

    private var autopilot = false
    private var travel: CGFloat = 0
    private var time: TimeInterval = 0
    private var anchorX: CGFloat = 0
    private var targetX: CGFloat = 0
    private var drag: (touchX: CGFloat, anchorX: CGFloat)?
    private var crowd: Crowd!
    private var enemy: Crowd?
    private var boss: SKNode?
    private var bossSprite: PaintedSprite?
    private var bossBar: SKSpriteNode?
    private var enemyStrength = 0
    private var gates: [GateNode] = []
    private var obstacles: [ObstacleNode] = []
    private var stripes: [SKSpriteNode] = []
    private var countLabel: SKLabelNode!
    private var enemyLabel: SKLabelNode?
    private var fighting = false
    private var fightClock: TimeInterval = 0
    private var lastHUD = ""

    init(level: Int, economy: RunnerEconomy) {
        self.level = level
        self.economy = economy
        track = RunnerGenerator.makeTrack(level: level, startCrowd: economy.startCrowd)
        super.init(size: GameSceneBase.canvas)
    }

    required init?(coder aDecoder: NSCoder) { fatalError("scenes are built in code") }

    // MARK: - Build

    override func buildLevel() {
        travel = 0
        time = 0
        anchorX = 0
        targetX = 0
        drag = nil
        randomPicks = [:]
        fighting = false
        fightClock = 0
        lastHUD = ""
        gates = []
        obstacles = []
        stripes = []
        enemy = nil
        boss = nil
        bossSprite = nil
        bossBar = nil
        enemyLabel = nil
        physicsWorld.gravity = .zero

        let roadPath = CGMutablePath()
        roadPath.addLines(between: Projection.roadPolygon)
        roadPath.closeSubpath()
        addPaper("paper")
        let sky = SKSpriteNode(texture: Sprite.hills.texture, size: CGSize(width: 402, height: 260))
        sky.position = CGPoint(x: 201, y: Projection.horizonY + 130 - 60)
        sky.zPosition = -20
        addChild(sky)
        let ground = SKSpriteNode(color: Palette.ground, size: CGSize(width: 402, height: Projection.horizonY))
        ground.position = CGPoint(x: 201, y: Projection.horizonY / 2)
        ground.zPosition = -19
        addChild(ground)
        let road = SKShapeNode(path: roadPath)
        road.fillColor = Palette.road
        road.strokeColor = Palette.edge
        road.lineWidth = 2
        road.zPosition = -18
        addChild(road)
        let horizon = SKShapeNode(rectOf: CGSize(width: 402, height: 1.5))
        horizon.position = CGPoint(x: 201, y: Projection.horizonY)
        horizon.fillColor = Palette.edge
        horizon.strokeColor = .clear
        addChild(horizon)
        for _ in 0..<10 {
            let stripe = SKSpriteNode(color: Palette.stripe, size: CGSize(width: 6, height: 20))
            stripe.zPosition = 1
            addChild(stripe)
            stripes.append(stripe)
        }

        for segment in track.segments {
            switch segment {
            case .gates(let pair):
                let node = GateNode(pair: pair)
                node.isHidden = true
                addChild(node)
                gates.append(node)
            case .obstacle(let obstacle):
                let node = ObstacleNode(obstacle: obstacle)
                node.isHidden = true
                addChild(node)
                obstacles.append(node)
            }
        }

        guard let view else { return }
        _ = view
        crowd = Crowd(count: track.startCrowd, anchorZ: Projection.anchorZ, clip: "clawd_run", height: RunnerScene.runnerHeight)
        addChild(crowd.layer)

        enemyStrength = track.finale.strength
        switch track.finale {
        case .crowd(let n):
            // The rivals are mirrored so the two crowds face each other.
            let foes = Crowd(count: n, anchorZ: track.finaleZ + 4, clip: "clawd_foe_run", height: RunnerScene.runnerHeight, facing: -1)
            addChild(foes.layer)
            enemy = foes
        case .boss(let hp):
            let node = SKNode()
            let body = PaintedSprite(clip: "clawd_boss_idle", height: 110)
            node.addChild(body)
            bossSprite = body
            let track = SKShapeNode(rectOf: CGSize(width: 90, height: 9), cornerRadius: 4.5)
            track.fillColor = Palette.bossTrack
            track.strokeColor = Palette.edge
            track.lineWidth = 1.5
            track.position = CGPoint(x: 0, y: 96)
            track.zPosition = 1
            node.addChild(track)
            let bar = SKSpriteNode(color: Palette.bossBar, size: CGSize(width: 87, height: 6))
            bar.anchorPoint = CGPoint(x: 0, y: 0.5)
            bar.position = CGPoint(x: -43.5, y: 96)
            bar.zPosition = 2
            node.addChild(bar)
            bossBar = bar
            addChild(node)
            boss = node
            _ = hp
        }

        countLabel = SKLabelNode(fontNamed: Painted.font)
        countLabel.fontSize = 22
        countLabel.fontColor = Palette.label
        countLabel.zPosition = 200
        addChild(countLabel)
        let foeLabel = SKLabelNode(fontNamed: Painted.font)
        foeLabel.fontSize = 20
        foeLabel.fontColor = Palette.label
        foeLabel.zPosition = 200
        addChild(foeLabel)
        enemyLabel = foeLabel

        layoutTrack()
        pushHUD()
    }

    private var roadPoints: [CGPoint] { Projection.roadPolygon }

    // MARK: - Input

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard !finished, let touch = touches.first else { return }
        drag = (touch.location(in: self).x, anchorX)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let drag, let touch = touches.first else { return }
        let dx = touch.location(in: self).x - drag.touchX
        targetX = min(0.85, max(-0.85, drag.anchorX + dx / Projection.laneWidth(at: Projection.anchorZ)))
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { drag = nil }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { drag = nil }

    // MARK: - Simulation

    override func tick(dt: TimeInterval) {
        time += dt
        guard !finished, crowd != nil else { return }
        if !fighting {
            travel += track.speed * CGFloat(dt)
            if autopilot { targetX = autopilotTarget() }
            anchorX += (targetX - anchorX) * CGFloat(min(1, 12 * dt))
            crossGates()
            crossObstacles()
            if track.finaleZ - travel <= Projection.anchorZ + 2.5 { startFight() }
        } else {
            fight(dt: dt)
        }
        crowd.anchorX = anchorX
        crowd.update(dt: dt, time: time, wobble: Motion.reduced ? 0.03 : 0.06)
        enemy?.update(dt: dt, time: time, wobble: Motion.reduced ? 0.03 : 0.06)
        layoutTrack()
        pushHUD()
    }

    private func crossGates() {
        for gate in gates where !gate.consumed && gate.pair.z - travel <= Projection.anchorZ {
            let leftSide = anchorX < 0
            let op = leftSide ? gate.pair.left : gate.pair.right
            crowd.setCount(op.apply(crowd.count))
            gate.choose(leftSide: leftSide)
            if op.isGood { Haptics.shared.tap() } else { Haptics.shared.thud() }
            Audio.play(.gate)
            if crowd.count == 0 {
                lose("The gate wiped out the crowd.")
                return
            }
        }
    }

    private func crossObstacles() {
        for node in obstacles where !node.resolved && node.obstacle.z - travel <= Projection.anchorZ {
            node.resolved = true
            let killed = crowd.kill(inside: node.obstacle.hazard.span(at: time))
            if killed > 0 {
                Haptics.shared.thud()
                Audio.play(.pop)
            }
            if crowd.count == 0 {
                lose("Nobody made it past the hazard.")
                return
            }
        }
    }

    private func startFight() {
        fighting = true
        fightClock = 0
        // The crowd hits the boss from the first tick of the fight to the last.
        bossSprite?.play("clawd_boss_hit")
        Haptics.shared.slam()
    }

    /// Attrition: each 0.05 s both sides lose a slice of the bigger side, ours divided by strength.
    /// Whoever is larger (after strength) wins, which is what the generator sized the finale for.
    private func fight(dt: TimeInterval) {
        if let enemy {
            enemy.anchorZ = max(Projection.anchorZ + 1.2, enemy.anchorZ - 8 * CGFloat(dt))
        }
        fightClock += dt
        while fightClock >= 0.05, !finished {
            fightClock -= 0.05
            let before = (mine: crowd.count, theirs: enemyStrength)
            let slice = max(1, Int((Double(max(before.mine, before.theirs)) / 30).rounded(.up)))
            let myLoss = max(1, Int((Double(slice) / economy.memberPower).rounded(.up)))
            enemyStrength = max(0, enemyStrength - slice)
            crowd.setCount(before.mine - myLoss)
            enemy?.setCount(enemyStrength)
            if let bossBar {
                bossBar.xScale = CGFloat(enemyStrength) / CGFloat(max(1, track.finale.strength))
            }
            Haptics.shared.tap()
            if enemyStrength <= 0 && crowd.count > 0 {
                win()
            } else if crowd.count <= 0 && enemyStrength > 0 {
                lose(boss == nil ? "Their crowd was bigger." : "The boss was too much.")
            } else if crowd.count <= 0 && enemyStrength <= 0 {
                if Double(before.mine) * economy.memberPower >= Double(before.theirs) { win(survivors: 1) } else { lose("It came down to the last runner.") }
            }
        }
    }

    private func win(survivors: Int? = nil) {
        let alive = survivors ?? crowd.count
        let coins = economy.coins(forSurvivors: alive)
        // Stars measure the run against the best a player with these upgrades could do: the
        // finale costs about strength / memberPower runners no matter how well you steer, so a
        // perfect run is three stars at any upgrade level.
        let fightCost = Double(track.finale.strength) / economy.memberPower
        let attainable = max(1.0, Double(track.bestPath) - fightCost)
        let share = Double(alive) / attainable
        let stars = share >= 0.85 ? 3 : share >= 0.5 ? 2 : 1
        Haptics.shared.success()
        Audio.play(.win)
        finish(.won(stars: stars, coins: coins, score: Double(alive)))
        pushHUD()
    }

    private func lose(_ reason: String) {
        bossSprite?.play("clawd_boss_idle")
        Haptics.shared.failure()
        Audio.play(.lose)
        finish(.lost(reason: reason))
        pushHUD()
    }

    // MARK: - Autopilot

    /// Greedy steering for the replay harness and the demo: best gate, widest free lane.
    private func autopilotTarget() -> CGFloat {
        if policy == .straight { return 0 }
        let ahead = Projection.anchorZ - 0.5
        var best: (z: CGFloat, target: CGFloat)?
        for gate in gates where !gate.consumed {
            let z = gate.pair.z - travel
            guard z > ahead, best == nil || z < best!.z else { continue }
            let goLeft: Bool
            switch policy {
            case .greedy, .straight:
                goLeft = gate.pair.left.apply(crowd.count) >= gate.pair.right.apply(crowd.count)
            case .left:
                goLeft = true
            case .random:
                let key = ObjectIdentifier(gate)
                if randomPicks[key] == nil { randomPicks[key] = rng.unit() < 0.5 ? -0.5 : 0.5 }
                goLeft = randomPicks[key]! < 0
            }
            best = (z, goLeft ? -0.5 : 0.5)
        }
        for node in obstacles where !node.resolved {
            let z = node.obstacle.z - travel
            guard z > ahead, best == nil || z < best!.z else { continue }
            let eta = max(0, Double((z - Projection.anchorZ) / track.speed))
            let span = node.obstacle.hazard.span(at: time + eta)
            let radius = crowd.radius + 0.08
            let leftRoom = (span.lowerBound - radius) - (-0.9)
            let rightRoom = 0.9 - (span.upperBound + radius)
            let target = leftRoom >= rightRoom
                ? max(-0.85, (span.lowerBound - radius - 0.9) / 2)
                : min(0.85, (span.upperBound + radius + 0.9) / 2)
            best = (z, target)
        }
        return best?.target ?? 0
    }

    // MARK: - Layout

    private func layoutTrack() {
        for (i, stripe) in stripes.enumerated() {
            var z = (CGFloat(i) * 4 - travel).truncatingRemainder(dividingBy: Projection.farZ)
            if z < 0 { z += Projection.farZ }
            let s = Projection.scale(z)
            stripe.position = Projection.point(x: 0, z: z)
            stripe.setScale(s)
            stripe.alpha = z > 1 ? 1 : 0
        }
        for gate in gates {
            let z = gate.pair.z - travel
            let visible = z > -3 && z < Projection.farZ
            gate.isHidden = !visible
            guard visible else { continue }
            let s = Projection.scale(z)
            gate.left.position = Projection.point(x: -0.5, z: z)
            gate.right.position = Projection.point(x: 0.5, z: z)
            gate.left.setScale(s)
            gate.right.setScale(s)
            gate.zPosition = 100 - z
        }
        for node in obstacles {
            let z = node.obstacle.z - travel
            let visible = z > -3 && z < Projection.farZ
            node.isHidden = !visible
            guard visible else { continue }
            let s = Projection.scale(z)
            let span = node.obstacle.hazard.span(at: time)
            let center = (span.lowerBound + span.upperBound) / 2
            let widthPoints = (span.upperBound - span.lowerBound) * Projection.laneWidth(at: z)
            node.sprite.position = Projection.point(x: center, z: z)
            switch node.obstacle.hazard {
            case .wall, .spikes:
                node.sprite.xScale = widthPoints / 100
                node.sprite.yScale = s
            case .blade:
                node.sprite.setScale(s)
            }
            node.zPosition = 100 - z
        }
        if let enemy {
            if !fighting { enemy.anchorZ = track.finaleZ + 4 - travel }
            enemy.layer.isHidden = enemy.anchorZ > Projection.farZ
            if let enemyLabel {
                let p = Projection.point(x: 0, z: enemy.anchorZ)
                enemyLabel.position = CGPoint(x: p.x, y: p.y + 30 + 40 * Projection.scale(enemy.anchorZ))
                enemyLabel.text = "\u{00D7}\(enemyStrength)"
                enemyLabel.isHidden = enemy.layer.isHidden
            }
        }
        if let boss {
            let z = fighting ? Projection.anchorZ + 1.5 : track.finaleZ - travel
            let s = Projection.scale(z)
            boss.position = Projection.point(x: 0, z: z)
            boss.setScale(s)
            boss.isHidden = z > Projection.farZ
            boss.zPosition = 100 - z
            if let enemyLabel {
                enemyLabel.position = CGPoint(x: boss.position.x, y: boss.position.y + 104 * s + 6)
                enemyLabel.text = "HP \(enemyStrength)"
                enemyLabel.isHidden = boss.isHidden
            }
        }
        let anchor = Projection.point(x: anchorX, z: Projection.anchorZ)
        // A boss fights from just up the road, where the count would sit on its face; it drops below then.
        let countY = fighting && boss != nil ? anchor.y - 30 : anchor.y + 34 + crowd.radius * 90
        countLabel.position = CGPoint(x: anchor.x, y: countY)
        countLabel.text = "\u{00D7}\(crowd.count)"
    }

    private func pushHUD() {
        let progress = Double(min(1, travel / track.finaleZ))
        var readout = "crowd \u{00D7}\(crowd?.count ?? 0)"
        if fighting { readout += "   vs \(enemyStrength)" }
        let key = readout + "\(Int(progress * 100))"
        guard key != lastHUD else { return }
        lastHUD = key
        setHUD(HUDState(title: "Run \(level + 1)", readout: readout, progress: progress))
    }
}
