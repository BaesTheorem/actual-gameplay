import SpriteKit
import UIKit

/// The miner, Clawd in a hard hat. Lava or a goblin ends him; treasure or the exit saves him.
/// The node keeps the body; a painted child plays the moods, standing on the bottom of the body circle.
final class HeroNode: SKSpriteNode {
    static let radius: CGFloat = 16
    private(set) var isDead = false
    /// The clip frames leave room above him for emotes; at 48 pt his hat-to-feet height matches the body circle.
    private let clawd = PaintedSprite(clip: "clawd_hard_idle", height: 48)

    init() {
        super.init(texture: nil, color: .clear, size: CGSize(width: 38, height: 38))
        zPosition = 6
        clawd.position = CGPoint(x: 0, y: -HeroNode.radius)
        addChild(clawd)
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
            | PinCategory.foe
        body.contactTestBitMask = PinCategory.goal | PinCategory.treasure | PinCategory.lava | PinCategory.foe
        physicsBody = body
    }

    required init?(coder aDecoder: NSCoder) { fatalError("built in code") }

    func die(completion: @escaping () -> Void) {
        guard !isDead else { return }
        isDead = true
        clawd.play("clawd_hard_ko")
        let duration = Motion.decorative(0.5)
        // A beat on the knocked-out pose, so the take reads before he goes.
        run(.sequence([
            .wait(forDuration: 0.6),
            .group([.scale(to: 0.2, duration: duration), .fadeOut(withDuration: duration)]),
            .run(completion),
        ]))
    }

    func celebrate() {
        clawd.play("clawd_hard_excited")
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
            | PinCategory.foe
        body.contactTestBitMask = PinCategory.goal | PinCategory.hero | PinCategory.drain | PinCategory.lava
        physicsBody = body
    }

    required init?(coder aDecoder: NSCoder) { fatalError("built in code") }
}

/// A goblin, the violet Clawd, waiting in a chamber. Water or lava knocks him out; if he touches the
/// hero, the hero is done. He falls like the hero when his floor goes, drops through a grate, and is
/// lost down a drain. The gem can rest on him.
final class FoeNode: SKSpriteNode {
    static let radius: CGFloat = 16
    /// Alive and dangerous. Knocked out or sunk, he stops counting at once, before his exit plays.
    private(set) var isActive = true
    /// The same scale as the hero's clips, so the two Clawds read as the same size.
    private let clawd = PaintedSprite(clip: "clawd_foe_idle", height: 48)

    init() {
        super.init(texture: nil, color: .clear, size: CGSize(width: 38, height: 38))
        zPosition = 6
        clawd.position = CGPoint(x: 0, y: -FoeNode.radius)
        addChild(clawd)
        let body = SKPhysicsBody(circleOfRadius: FoeNode.radius)
        body.friction = 0.8
        body.restitution = 0.05
        body.linearDamping = 0.2
        body.allowsRotation = false
        body.usesPreciseCollisionDetection = true
        body.categoryBitMask = PinCategory.foe
        body.collisionBitMask = PinCategory.wall | PinCategory.pin | PinCategory.water | PinCategory.lava
            | PinCategory.hero | PinCategory.treasure | PinCategory.foe
        body.contactTestBitMask = PinCategory.liquid | PinCategory.hero | PinCategory.drain
        physicsBody = body
    }

    required init?(coder aDecoder: NSCoder) { fatalError("built in code") }

    /// Take him out of play: nothing touches him any more, but he still rests on the stone while he goes.
    private func retire() {
        isActive = false
        guard let body = physicsBody else { return }
        body.categoryBitMask = 0
        body.contactTestBitMask = 0
        body.collisionBitMask = PinCategory.wall | PinCategory.pin
    }

    /// Liquid got him: a beat of the dizzy clip, then he fades.
    func knockOut() {
        guard isActive else { return }
        retire()
        clawd.play("clawd_foe_ko", loop: false)
        let duration = Motion.decorative(0.4)
        run(.sequence([
            .wait(forDuration: 0.7),
            .group([.fadeOut(withDuration: duration), .scale(to: 0.6, duration: duration)]),
            .removeFromParent(),
        ]))
    }

    /// Down the drain: he shrinks into it and is gone.
    func sink() {
        guard isActive else { return }
        retire()
        physicsBody = nil
        let duration = Motion.decorative(0.35)
        run(.sequence([
            .group([.scale(to: 0.2, duration: duration), .fadeOut(withDuration: duration)]),
            .removeFromParent(),
        ]))
    }
}
