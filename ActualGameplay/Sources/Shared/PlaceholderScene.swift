import SpriteKit

/// Stand-in scene that proves the pipeline (presentation, physics, HUD messaging, input) before the
/// real modes land. One ball, one box, tap to shove.
final class PlaceholderScene: GameSceneBase {
    private let mode: GameMode

    init(mode: GameMode) {
        self.mode = mode
        super.init(size: GameSceneBase.canvas)
    }

    required init?(coder aDecoder: NSCoder) { fatalError("scenes are built in code") }

    override func buildLevel() {
        let field = GameSceneBase.playfield
        physicsWorld.gravity = CGVector(dx: 0, dy: -9.8)

        let frame = SKShapeNode(rect: field)
        frame.strokeColor = UIColor(hex: 0x3F4553)
        frame.lineWidth = 1
        frame.fillColor = .clear
        frame.physicsBody = SKPhysicsBody(edgeLoopFrom: field)
        addChild(frame)

        let label = SKLabelNode(fontNamed: "HelveticaNeue-Bold")
        label.text = mode.title.uppercased()
        label.fontSize = 22
        label.fontColor = UIColor(hex: 0x9AA0AC)
        label.position = CGPoint(x: field.midX, y: field.midY + 40)
        addChild(label)

        let sub = SKLabelNode(fontNamed: "Menlo")
        sub.text = "placeholder scene. tap to shove."
        sub.fontSize = 13
        sub.fontColor = UIColor(hex: 0x6B7280)
        sub.position = CGPoint(x: field.midX, y: field.midY + 12)
        addChild(sub)

        let ball = SKShapeNode(circleOfRadius: 22)
        ball.fillColor = mode.uiAccent
        ball.strokeColor = .clear
        ball.position = CGPoint(x: field.midX - 60, y: field.maxY - 120)
        let ballBody = SKPhysicsBody(circleOfRadius: 22)
        ballBody.restitution = 0.85
        ballBody.friction = 0.2
        ballBody.linearDamping = 0.05
        ball.physicsBody = ballBody
        addChild(ball)
        ballBody.applyImpulse(CGVector(dx: 6, dy: 0))

        let box = SKShapeNode(rectOf: CGSize(width: 44, height: 44))
        box.fillColor = UIColor(hex: 0xE2E4EA)
        box.strokeColor = .clear
        box.position = CGPoint(x: field.midX + 80, y: field.maxY - 200)
        let boxBody = SKPhysicsBody(rectangleOf: CGSize(width: 44, height: 44))
        boxBody.restitution = 0.3
        boxBody.friction = 0.6
        box.physicsBody = boxBody
        addChild(box)

        setHUD(HUDState(title: mode.title, readout: "placeholder", progress: nil))
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first else { return }
        let p = touch.location(in: self)
        for child in children {
            guard let body = child.physicsBody, body.isDynamic else { continue }
            let dx = child.position.x - p.x
            let dy = child.position.y - p.y
            let len = max(1, hypot(dx, dy))
            body.applyImpulse(CGVector(dx: dx / len * 10, dy: dy / len * 10 + 5))
        }
        Haptics.shared.tap()
    }
}
