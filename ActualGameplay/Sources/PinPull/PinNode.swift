import SpriteKit
import UIKit

/// A bar with a knob outside the chamber wall. Tapping it slides the bar out along its length, and
/// whatever rested on it falls. One way: a pulled pin is gone. A pin can be tilted about its centre,
/// so it holds liquid on a slope and lets it pour sideways.
final class PinNode: SKNode {
    static let thickness: CGFloat = 14
    /// Knob center beyond the bar end: past a 14 pt wall with room to spare.
    static let knobOffset: CGFloat = 26

    let pinID: String
    private(set) var pulled = false

    private let direction: CGFloat
    private let width: CGFloat
    /// Radians, counterclockwise.
    private let angle: CGFloat
    /// Tap target in the pin's own frame: the bar with slack above and below, plus the knob.
    private let hitBox: CGRect

    init(id: String, x: CGFloat, y: CGFloat, w: CGFloat, side: String, angle: CGFloat = 0) {
        pinID = id
        width = w
        direction = side == "left" ? -1 : 1
        self.angle = angle
        let knobCenter = CGPoint(x: direction * (w / 2 + PinNode.knobOffset), y: 0)
        let barBox = CGRect(x: -w / 2, y: -PinNode.thickness / 2, width: w, height: PinNode.thickness).insetBy(dx: 0, dy: -14)
        hitBox = barBox.union(CGRect(x: knobCenter.x - 22, y: knobCenter.y - 22, width: 44, height: 44))
        super.init()
        position = CGPoint(x: x + w / 2, y: y + PinNode.thickness / 2)
        zRotation = angle
        zPosition = 4

        // Stem first, so the bar's inked end sits over the joint.
        let stem = SKShapeNode(rectOf: CGSize(width: PinNode.knobOffset, height: 6))
        stem.fillColor = Pigment.cream
        stem.strokeColor = Pigment.ink
        stem.lineWidth = 2
        stem.position = CGPoint(x: direction * (w / 2 + PinNode.knobOffset / 2), y: 0)
        addChild(stem)

        let bar = SKShapeNode(rectOf: CGSize(width: w, height: PinNode.thickness), cornerRadius: 3)
        bar.fillColor = Pigment.cream
        bar.strokeColor = Pigment.ink
        bar.lineWidth = 2
        addChild(bar)

        // 30 pt: the painted disc is 24 pt across, the size of the old knob, so it still clears the screen edge.
        // It stays upright on a tilted pin, so its paint catches the light the same way on every pin.
        let knob = SKSpriteNode(texture: Painted.texture("pin_knob"), size: CGSize(width: 30, height: 30))
        knob.position = knobCenter
        knob.zRotation = -angle
        addChild(knob)

        let body = SKPhysicsBody(rectangleOf: CGSize(width: w, height: PinNode.thickness))
        body.isDynamic = false
        body.friction = 0.3
        body.restitution = 0
        body.categoryBitMask = PinCategory.pin
        physicsBody = body
    }

    required init?(coder aDecoder: NSCoder) { fatalError("built in code") }

    /// Whether a tap at this scene point lands on the pin. Tested in the pin's own frame, so a tilted
    /// pin takes taps along its length and not across a box around it.
    func hits(_ point: CGPoint) -> Bool {
        let dx = point.x - position.x, dy = point.y - position.y
        let c = cos(angle), s = sin(angle)
        return hitBox.contains(CGPoint(x: dx * c + dy * s, y: -dx * s + dy * c))
    }

    func pull() {
        guard !pulled else { return }
        pulled = true
        let travel = direction * (width + 60)
        let slide = SKAction.moveBy(x: travel * cos(angle), y: travel * sin(angle), duration: Motion.decorative(0.25))
        slide.timingMode = .easeIn
        run(.sequence([slide, .removeFromParent()]))
    }
}
