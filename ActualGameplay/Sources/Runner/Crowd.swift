import SpriteKit
import UIKit

/// A crowd of runners. `count` is the truth; at most 150 of them are drawn, arranged on a
/// sunflower spiral around the anchor so any number reads as one blob. Each runner plays a painted
/// clip from its own frame, so the crowd does not stride in lockstep.
final class Crowd {
    final class Member {
        let node: SKSpriteNode
        var x: CGFloat
        var dz: CGFloat
        let phase: CGFloat

        init(node: SKSpriteNode, x: CGFloat, dz: CGFloat, phase: CGFloat) {
            self.node = node
            self.x = x
            self.dz = dz
            self.phase = phase
        }
    }

    static let maxVisible = 150
    static let slotSpacing: CGFloat = 0.05

    let layer = SKNode()
    private(set) var count: Int
    private(set) var members: [Member] = []
    var anchorX: CGFloat = 0
    var anchorZ: CGFloat
    private let frames: [SKTexture]
    private let timePerFrame: TimeInterval
    private let anchor: CGPoint
    private let size: CGSize
    /// 1 faces the clip's way (screen right), -1 mirrors it.
    private let facing: CGFloat

    /// `height` is the clip frame's height in points at depth scale 1; the anchor is the clip's ground point.
    init(count: Int, anchorZ: CGFloat, clip name: String, height: CGFloat, facing: CGFloat = 1) {
        self.count = 0
        self.anchorZ = anchorZ
        let clip = Painted.clip(name)
        let native = clip?.size ?? CGSize(width: height, height: height)
        frames = clip?.textures ?? []
        timePerFrame = 1 / max(1, clip?.fps ?? 10)
        anchor = clip?.anchor ?? CGPoint(x: 0.5, y: 0)
        size = CGSize(width: native.width * height / max(1, native.height), height: height)
        self.facing = facing
        setCount(count, animated: false)
    }

    /// Formation slot i as an offset from the anchor, in lane units.
    static func slot(_ i: Int) -> (dx: CGFloat, dz: CGFloat) {
        guard i > 0 else { return (0, 0) }
        let r = slotSpacing * sqrt(CGFloat(i))
        let angle = CGFloat(i) * 2.399963
        return (r * cos(angle), r * sin(angle) * 0.6)
    }

    /// Radius of the visible formation in lane units.
    var radius: CGFloat { Crowd.slotSpacing * sqrt(CGFloat(min(count, Crowd.maxVisible))) }

    func setCount(_ newCount: Int, animated: Bool = true) {
        count = max(0, newCount)
        let visible = min(count, Crowd.maxVisible)
        while members.count < visible { addMember(index: members.count, animated: animated) }
        while members.count > visible { removeLastMember(animated: animated) }
    }

    private func addMember(index: Int, animated: Bool) {
        let node = SKSpriteNode(texture: frames.first, size: size)
        node.anchorPoint = anchor
        if frames.count > 1 {
            // Start each runner on a different frame of the cycle.
            let start = (index * 5) % frames.count
            let cycle = Array(frames[start...] + frames[..<start])
            node.texture = cycle[0]
            node.run(.repeatForever(.animate(with: cycle, timePerFrame: timePerFrame)))
        }
        let slot = Crowd.slot(index)
        let member = Member(node: node,
                            x: anchorX + (animated ? 0 : slot.dx),
                            dz: animated ? 0 : slot.dz,
                            phase: CGFloat(index) * 0.7)
        node.position = Projection.point(x: member.x, z: anchorZ + member.dz)
        layer.addChild(node)
        members.append(member)
        if animated {
            node.alpha = 0
            node.run(.fadeIn(withDuration: Motion.decorative(0.15)))
        }
    }

    private func removeLastMember(animated: Bool) {
        let member = members.removeLast()
        if animated {
            member.node.run(.sequence([
                .group([.fadeOut(withDuration: 0.25), .moveBy(x: 0, y: -24, duration: 0.25)]),
                .removeFromParent(),
            ]))
        } else {
            member.node.removeFromParent()
        }
    }

    /// Kill the drawn members inside `span` and scale the loss up to the true count.
    @discardableResult
    func kill(inside span: ClosedRange<CGFloat>) -> Int {
        guard !members.isEmpty else { return 0 }
        let hit = members.filter { span.contains($0.x) }
        guard !hit.isEmpty else { return 0 }
        let fraction = Double(hit.count) / Double(members.count)
        let killed = min(count, max(hit.count, Int((Double(count) * fraction).rounded())))
        for member in hit {
            member.node.run(.sequence([
                .group([.fadeOut(withDuration: 0.2), .moveBy(x: 0, y: -20, duration: 0.2)]),
                .removeFromParent(),
            ]))
        }
        members.removeAll { member in hit.contains { $0 === member } }
        count -= killed
        return killed
    }

    func update(dt: TimeInterval, time: TimeInterval, wobble: CGFloat) {
        let k = CGFloat(min(1, 10 * dt))
        for (i, member) in members.enumerated() {
            let slot = Crowd.slot(i)
            member.x += (anchorX + slot.dx - member.x) * k
            member.dz += (slot.dz - member.dz) * k
            let z = anchorZ + member.dz
            let scale = Projection.scale(z)
            member.node.position = Projection.point(x: member.x, z: z)
            member.node.zPosition = 100 - z
            member.node.xScale = scale * facing
            member.node.yScale = scale * (1 + wobble * CGFloat(sin(time * 16 + Double(member.phase))))
        }
    }

    func removeAll() {
        layer.removeAllChildren()
        members = []
        count = 0
    }
}
