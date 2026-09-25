import SpriteKit
import UIKit

enum PinCategory {
    static let wall: UInt32 = 1 << 0
    static let pin: UInt32 = 1 << 1
    static let water: UInt32 = 1 << 2
    static let lava: UInt32 = 1 << 3
    static let hero: UInt32 = 1 << 4
    static let treasure: UInt32 = 1 << 5
    static let goal: UInt32 = 1 << 6
    static let drain: UInt32 = 1 << 7
    /// Swallows liquid like a drain, but the hero and the treasure fall straight through it.
    static let grate: UInt32 = 1 << 8
    static let liquid: UInt32 = water | lava
}

enum LiquidKind: String {
    case water
    case lava

    var category: UInt32 { self == .water ? PinCategory.water : PinCategory.lava }

    /// Body color, and the lighter band the surface shader paints along the edge.
    var core: vector_float3 { self == .water ? LiquidKind.rgb(0x3A9C98) : LiquidKind.rgb(0xD97757) }
    var rim: vector_float3 { self == .water ? LiquidKind.rgb(0x8EC3E6) : LiquidKind.rgb(0xE8AA38) }

    private static func rgb(_ hex: UInt32) -> vector_float3 {
        vector_float3(Float((hex >> 16) & 0xFF) / 255, Float((hex >> 8) & 0xFF) / 255, Float(hex & 0xFF) / 255)
    }
}

/// Liquids as swarms of small circles that are drawn as one surface. SpriteKit has no fluid, but a
/// few hundred low-friction bodies pour, pile, and spill the way the puzzles need, and a metaball
/// pass hides the particles: each one draws a soft blob into an offscreen layer with additive
/// blending, and a shader on that layer keeps only the region where the summed blobs pass a
/// threshold. Neighbours merge into a continuous body with a smooth edge; a lone drop stays a drop.
///
/// One layer per liquid kind, so water and lava keep their own colors and rims. Speed is clamped
/// every frame because SpriteKit does not sub-step: a particle moving more than its diameter per
/// frame can pass through a 14 pt wall.
final class LiquidSystem {
    static let radius: CGFloat = 3.5
    /// Each blob sprite extends this many physics radii; two particles merge when they are closer
    /// than about two diameters.
    static let blobScale: CGFloat = 3
    static let maxSpeed: CGFloat = 700

    let layer = SKNode()
    private(set) var particles: [SKSpriteNode] = []
    private var surfaces: [LiquidKind: SKEffectNode] = [:]

    /// A white disc whose alpha falls off as (1 - (d/R)^2)^2, peaking at 0.75. The shader's cut at
    /// 0.5 shows a lone particle at about 0.43 R and merges neighbours whose falloffs overlap.
    static let blobTexture: SKTexture = {
        let size = 64
        var pixels = [UInt8](repeating: 0, count: size * size * 4)
        let half = Double(size) / 2
        for y in 0..<size {
            for x in 0..<size {
                let dx = (Double(x) + 0.5 - half) / half
                let dy = (Double(y) + 0.5 - half) / half
                let d2 = dx * dx + dy * dy
                let falloff = d2 >= 1 ? 0 : pow(1 - d2, 2) * 0.75
                let value = UInt8(min(255, max(0, falloff * 255)))
                let i = (y * size + x) * 4
                pixels[i] = value      // premultiplied white
                pixels[i + 1] = value
                pixels[i + 2] = value
                pixels[i + 3] = value
            }
        }
        let data = Data(pixels)
        let texture = SKTexture(data: data, size: CGSize(width: size, height: size))
        texture.filteringMode = .linear
        return texture
    }()

    static let surfaceSource = """
    void main() {
        vec4 s = texture2D(u_texture, v_tex_coord);
        float body = smoothstep(0.46, 0.54, s.a);
        float depth = smoothstep(0.54, 0.85, s.a);
        vec3 color = mix(u_rim, u_core, depth);
        gl_FragColor = vec4(color * body, body);
    }
    """

    init() {
        layer.zPosition = 5
        for kind in [LiquidKind.water, .lava] {
            let surface = SKEffectNode()
            surface.shouldRasterize = false
            surface.shouldEnableEffects = true
            let shader = SKShader(source: LiquidSystem.surfaceSource)
            shader.uniforms = [SKUniform(name: "u_core", vectorFloat3: kind.core),
                               SKUniform(name: "u_rim", vectorFloat3: kind.rim)]
            surface.shader = shader
            surface.zPosition = kind == .lava ? 1 : 0
            layer.addChild(surface)
            surfaces[kind] = surface
        }
    }

    var count: Int { particles.count }

    func spawn(in rect: CGRect, count: Int, kind: LiquidKind) {
        let r = LiquidSystem.radius
        let dx = 2 * r * 0.95
        let dy = dx * 0.866
        var y = rect.minY + r
        var row = 0
        var made = 0
        while made < count {
            var x = rect.minX + r + (row % 2 == 1 ? dx / 2 : 0)
            var placed = false
            while x + r <= rect.maxX && made < count {
                add(kind: kind, at: CGPoint(x: x, y: y))
                made += 1
                placed = true
                x += dx
            }
            if !placed { break }
            y += dy
            row += 1
        }
    }

    private func add(kind: LiquidKind, at point: CGPoint) {
        let size = 2 * LiquidSystem.radius * LiquidSystem.blobScale
        let node = SKSpriteNode(texture: LiquidSystem.blobTexture, size: CGSize(width: size, height: size))
        node.blendMode = .add
        node.position = point
        node.name = kind.rawValue
        let body = SKPhysicsBody(circleOfRadius: LiquidSystem.radius)
        body.friction = 0.05
        body.restitution = 0
        body.linearDamping = 0.2
        body.angularDamping = 0
        body.allowsRotation = false
        body.density = 1
        body.categoryBitMask = kind.category
        body.collisionBitMask = PinCategory.wall | PinCategory.pin | PinCategory.water | PinCategory.lava
            | PinCategory.hero | PinCategory.treasure
        body.contactTestBitMask = kind == .water
            ? PinCategory.lava | PinCategory.drain
            : PinCategory.water | PinCategory.hero | PinCategory.drain
        node.physicsBody = body
        (surfaces[kind] ?? layer).addChild(node)
        particles.append(node)
    }

    func remove(_ node: SKNode) {
        node.removeFromParent()
    }

    func removeAll() {
        for surface in surfaces.values { surface.removeAllChildren() }
        particles.removeAll()
    }

    /// Clamp speeds, drop removed particles from the list, and report the fastest one.
    /// Runs from `update`, which is before the physics step.
    func step() -> CGFloat {
        var fastest: CGFloat = 0
        var compact = false
        for particle in particles {
            guard particle.parent != nil, let body = particle.physicsBody else {
                compact = true
                continue
            }
            let speed = Physics.speed(body)
            if speed > LiquidSystem.maxSpeed {
                Physics.clamp(body, to: LiquidSystem.maxSpeed)
                fastest = max(fastest, LiquidSystem.maxSpeed)
            } else if speed > fastest {
                fastest = speed
            }
        }
        if compact { particles.removeAll { $0.parent == nil } }
        return fastest
    }
}
