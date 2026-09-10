import SpriteKit
import UIKit

/// The person at the bottom of the chamber. Lava ends him; treasure or the exit saves him.
final class HeroNode: SKSpriteNode {
    static let radius: CGFloat = 16
    private(set) var isDead = false

    init() {
        super.init(texture: Sprite.heroIdle.texture, color: .clear, size: CGSize(width: 38, height: 38))
        zPosition = 6
        let body = SKPhysicsBody(circleOfRadius: HeroNode.radius)
        // High enough that arriving liquid does not shove him along a pin; slabs he must slide down
        // are cut steep enough to beat the mixed friction with the wall's 0.4.
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
        texture = Sprite.heroHit.texture
        color = UIColor(hex: 0xFF5C5C)
        colorBlendFactor = 0.5
        let duration = Motion.decorative(0.5)
        run(.sequence([
            .group([.scale(to: 0.2, duration: duration), .fadeOut(withDuration: duration)]),
            .run(completion),
        ]))
    }

    func celebrate() {
        texture = Sprite.heroJump.texture
        guard !Motion.reduced else { return }
        run(.sequence([.scaleY(to: 1.18, duration: 0.1), .scaleY(to: 1, duration: 0.12)]))
    }
}

final class TreasureNode: SKSpriteNode {
    static let size = CGSize(width: 28, height: 24)

    init() {
        super.init(texture: Sprite.gem.texture, color: .clear, size: TreasureNode.size)
        zPosition = 6
        let body = SKPhysicsBody(rectangleOf: CGSize(width: 26, height: 22))
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
