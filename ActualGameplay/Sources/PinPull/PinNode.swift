import SpriteKit
import UIKit

/// A horizontal bar with a knob outside the chamber wall. Tapping it slides the bar out, and
/// whatever rested on it falls. One way: a pulled pin is gone.
final class PinNode: SKNode {
    static let thickness: CGFloat = 14
    /// Knob center beyond the bar end: past a 14 pt wall with room to spare.
    static let knobOffset: CGFloat = 26

    let pinID: String
    private(set) var pulled = false
    /// Tap target in scene coordinates: the bar with slack above and below, plus the knob.
    let hitRect: CGRect

    private let direction: CGFloat
    private let width: CGFloat

    init(id: String, x: CGFloat, y: CGFloat, w: CGFloat, side: String) {
        pinID = id
        width = w
        direction = side == "left" ? -1 : 1
        let center = CGPoint(x: x + w / 2, y: y + PinNode.thickness / 2)
        let knobCenter = CGPoint(x: center.x + direction * (w / 2 + PinNode.knobOffset), y: center.y)
        let barRect = CGRect(x: x, y: y, width: w, height: PinNode.thickness).insetBy(dx: 0, dy: -14)
        let knobRect = CGRect(x: knobCenter.x - 22, y: knobCenter.y - 22, width: 44, height: 44)
        hitRect = barRect.union(knobRect)
        super.init()
        position = center
        zPosition = 4

        let bar = SKShapeNode(rectOf: CGSize(width: w, height: PinNode.thickness))
        bar.fillColor = UIColor(hex: 0xE2E4EA)
        bar.strokeColor = .clear
        addChild(bar)

        let stem = SKShapeNode(rectOf: CGSize(width: PinNode.knobOffset, height: 6))
        stem.fillColor = UIColor(hex: 0xE2E4EA)
        stem.strokeColor = .clear
        stem.position = CGPoint(x: direction * (w / 2 + PinNode.knobOffset / 2), y: 0)
        addChild(stem)

        let knob = SKShapeNode(circleOfRadius: 11)
        knob.fillColor = UIColor(hex: 0xE2E4EA)
        knob.strokeColor = UIColor(hex: 0x111318)
        knob.lineWidth = 2
        knob.position = CGPoint(x: direction * (w / 2 + PinNode.knobOffset), y: 0)
        addChild(knob)

        let dot = SKShapeNode(circleOfRadius: 4)
        dot.fillColor = UIColor(hex: 0xFF8A5B)
        dot.strokeColor = .clear
        dot.position = knob.position
        addChild(dot)

        let body = SKPhysicsBody(rectangleOf: CGSize(width: w, height: PinNode.thickness))
        body.isDynamic = false
        body.friction = 0.3
        body.restitution = 0
        body.categoryBitMask = PinCategory.pin
        physicsBody = body
    }

    required init?(coder aDecoder: NSCoder) { fatalError("built in code") }

    func pull() {
        guard !pulled else { return }
        pulled = true
        let slide = SKAction.moveBy(x: direction * (width + 60), y: 0, duration: Motion.decorative(0.25))
        slide.timingMode = .easeIn
        run(.sequence([slide, .removeFromParent()]))
    }
}
