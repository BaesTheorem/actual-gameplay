import SpriteKit
import UIKit

/// The dog. Heavy for his size so a landing shield does not launch him; never rolls.
final class DogNode: SKSpriteNode {
    static let radius: CGFloat = 18
    let dogID: String

    init(id: String) {
        dogID = id
        let texture = Sprite.exists("dog") ? Sprite.dog.texture : Sprite.dogFront.texture
        super.init(texture: texture, color: .clear, size: CGSize(width: 42, height: 42))
        zPosition = 8
        name = id
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

    func panic() {
        guard !Motion.reduced else { return }
        run(.repeatForever(.sequence([.rotate(toAngle: 0.15, duration: 0.06), .rotate(toAngle: -0.15, duration: 0.06)])))
    }

    func relax() {
        removeAllActions()
        zRotation = 0
        if !Motion.reduced {
            run(.sequence([.scaleY(to: 1.15, duration: 0.12), .scaleY(to: 1, duration: 0.12)]))
        }
    }
}
