import SpriteKit
import UIKit

/// The person at the bottom of the chamber. Lava ends him; treasure or the exit saves him.
final class HeroNode: SKNode {
    static let radius: CGFloat = 16

    private let face: SKShapeNode
    private(set) var isDead = false

    override init() {
        face = SKShapeNode(circleOfRadius: HeroNode.radius)
        super.init()
        zPosition = 6
        face.fillColor = UIColor(hex: 0xE2E4EA)
        face.strokeColor = .clear
        addChild(face)
        for dx in [-5.5, 5.5] as [CGFloat] {
            let eye = SKShapeNode(circleOfRadius: 2.4)
            eye.fillColor = UIColor(hex: 0x111318)
            eye.strokeColor = .clear
            eye.position = CGPoint(x: dx, y: 4)
            addChild(eye)
        }
        let mouth = SKShapeNode(rectOf: CGSize(width: 8, height: 2))
        mouth.fillColor = UIColor(hex: 0x111318)
        mouth.strokeColor = .clear
        mouth.position = CGPoint(x: 0, y: -5)
        addChild(mouth)

        let body = SKPhysicsBody(circleOfRadius: HeroNode.radius)
        body.friction = 0.8
        body.restitution = 0.05
        body.linearDamping = 0.2
        body.allowsRotation = false
        body.usesPreciseCollisionDetection = true
        body.categoryBitMask = PinCategory.hero
        body.collisionBitMask = PinCategory.wall | PinCategory.pin | PinCategory.water | PinCategory.lava | PinCategory.treasure
        body.contactTestBitMask = PinCategory.goal | PinCategory.treasure | PinCategory.lava
        physicsBody = body
    }

    required init?(coder aDecoder: NSCoder) { fatalError("built in code") }

    func die(completion: @escaping () -> Void) {
        guard !isDead else { return }
        isDead = true
        face.fillColor = UIColor(hex: 0xFF5C5C)
        let duration = Motion.decorative(0.5)
        run(.sequence([
            .group([.scale(to: 0.2, duration: duration), .fadeOut(withDuration: duration)]),
            .run(completion),
        ]))
    }

    func celebrate() {
        guard !Motion.reduced else { return }
        run(.sequence([.scaleY(to: 1.18, duration: 0.1), .scaleY(to: 1, duration: 0.12)]))
    }
}

final class TreasureNode: SKShapeNode {
    static let size = CGSize(width: 28, height: 22)

    override init() {
        super.init()
        zPosition = 6
        path = CGPath(rect: CGRect(origin: CGPoint(x: -14, y: -11), size: TreasureNode.size), transform: nil)
        fillColor = UIColor(hex: 0xFFD166)
        strokeColor = .clear
        let band = SKShapeNode(rectOf: CGSize(width: 28, height: 4))
        band.fillColor = UIColor(hex: 0xB8862B)
        band.strokeColor = .clear
        band.position = CGPoint(x: 0, y: 2)
        addChild(band)
        let clasp = SKShapeNode(rectOf: CGSize(width: 6, height: 6))
        clasp.fillColor = UIColor(hex: 0x111318)
        clasp.strokeColor = .clear
        clasp.position = CGPoint(x: 0, y: 2)
        addChild(clasp)

        let body = SKPhysicsBody(rectangleOf: TreasureNode.size)
        body.friction = 0.6
        body.restitution = 0.05
        body.linearDamping = 0.1
        body.usesPreciseCollisionDetection = true
        body.categoryBitMask = PinCategory.treasure
        body.collisionBitMask = PinCategory.wall | PinCategory.pin | PinCategory.water | PinCategory.lava | PinCategory.hero | PinCategory.treasure
        body.contactTestBitMask = PinCategory.goal | PinCategory.hero | PinCategory.drain
        physicsBody = body
    }

    required init?(coder aDecoder: NSCoder) { fatalError("built in code") }
}
