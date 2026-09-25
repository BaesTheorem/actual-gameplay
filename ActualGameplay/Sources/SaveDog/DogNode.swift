import SpriteKit
import UIKit

/// The dog, played by Clawd. Heavy for his size so a landing shield does not launch him; never rolls.
/// The node keeps the body; a painted child plays the moods, standing on the bottom of the body circle.
final class DogNode: SKSpriteNode {
    static let radius: CGFloat = 18
    let dogID: String
    /// The clip frames leave room above him for emotes, so a 58 pt frame is what makes his body as wide as
    /// the 36 pt body circle.
    private let clawd = PaintedSprite(clip: "clawd_nervous", height: 58)

    init(id: String) {
        dogID = id
        super.init(texture: nil, color: .clear, size: CGSize(width: 42, height: 42))
        zPosition = 8
        name = id
        clawd.position = CGPoint(x: 0, y: -DogNode.radius)
        addChild(clawd)
        let body = SKPhysicsBody(circleOfRadius: DogNode.radius)
        body.density = 3
        body.friction = 0.9
        body.restitution = 0
        body.linearDamping = 0.3
        body.allowsRotation = false
        body.categoryBitMask = StrokeCategory.actor
        body.collisionBitMask = StrokeCategory.wall | StrokeCategory.drawn | StrokeCategory.killer | StrokeCategory.actor | StrokeCategory.prop
        body.contactTestBitMask = StrokeCategory.bee | StrokeCategory.killer
        physicsBody = body
    }

    required init?(coder aDecoder: NSCoder) { fatalError("built in code") }

    /// The bees are out.
    func panic() {
        clawd.play("clawd_scared")
        guard !Motion.reduced else { return }
        run(.repeatForever(.sequence([.rotate(toAngle: 0.15, duration: 0.06), .rotate(toAngle: -0.15, duration: 0.06)])))
    }

    func relax() {
        settle()
        clawd.play("clawd_happy")
    }

    /// The swarm gave up: the level is won.
    func saved() {
        settle()
        clawd.play("clawd_excited")
    }

    /// A bee, a saw or the spikes got him.
    func caught() {
        removeAllActions()
        zRotation = 0
        clawd.play("clawd_ko")
    }

    private func settle() {
        removeAllActions()
        zRotation = 0
        if !Motion.reduced {
            run(.sequence([.scaleY(to: 1.15, duration: 0.12), .scaleY(to: 1, duration: 0.12)]))
        }
    }
}
