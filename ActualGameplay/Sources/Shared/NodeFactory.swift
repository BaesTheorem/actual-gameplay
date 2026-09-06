import SpriteKit
import UIKit

/// Texture cache. Sprites that share a texture batch into one draw call, which is the difference
/// between 320 liquid particles at 60 fps and 320 shape nodes at 20.
final class NodeFactory {
    static let shared = NodeFactory()

    private var textures: [String: SKTexture] = [:]

    func circle(radius: CGFloat, color: UIColor, view: SKView) -> SKTexture {
        let key = "circle:\(radius):\(color.description)"
        if let cached = textures[key] { return cached }
        let shape = SKShapeNode(circleOfRadius: radius)
        shape.fillColor = color
        shape.strokeColor = .clear
        shape.isAntialiased = true
        let texture = view.texture(from: shape) ?? SKTexture()
        textures[key] = texture
        return texture
    }
}
