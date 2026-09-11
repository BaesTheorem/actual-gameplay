import SpriteKit



/// Turns a finished polyline into a rendered stroke with a matching rigid body.
///
/// One convex quad per segment plus a disc at each interior joint, combined into a compound body.
/// The render path and the quads come from the same points, so the visible stroke and the
/// collision silhouette coincide. Below about a point Box2D's slop tolerances take over, hence the
/// minimum segment length and width.
enum StrokeBody {
    static let width: CGFloat = 8
    static let minSegment: CGFloat = 4
    /// Shorter than this and the stroke becomes a dot.
    static let minLength: CGFloat = 6
    static let epsilon: CGFloat = 1.5
    static let dotCost: CGFloat = 8
    static let color = UIColor(hex: 0xE2E4EA)
    static let pinnedColor = UIColor(hex: 0x7BD3FF)

    /// Natural mass at density 1 for a stroke of this length. Compounds double-count overlaps, so
    /// the mass is set explicitly instead of trusting what SpriteKit computes.
    static func mass(forLength length: CGFloat) -> CGFloat {
        max(length, width) * width / 22_500
    }

    /// Simplified, de-jittered points for a raw touch polyline. A single point means "dot".
    static func prepare(_ raw: [CGPoint]) -> [CGPoint] {
        guard let first = raw.first else { return [] }
        if Geometry.polylineLength(raw) < minLength { return [first] }
        let simplified = Geometry.simplify(raw, epsilon: epsilon)
        let merged = Geometry.mergeShortSegments(simplified, minLength: minSegment)
        return merged.count >= 2 ? merged : [first]
    }

    static func inkCost(rawLength: CGFloat) -> CGFloat {
        rawLength < minLength ? dotCost : rawLength
    }

    static func makeNode(points: [CGPoint], dynamic: Bool, color: UIColor = StrokeBody.color) -> SKNode {
        let center = Geometry.centroid(points)
        let local = points.map { $0 - center }
        let node = SKShapeNode()
        let path = CGMutablePath()
        if local.count == 1 {
            path.addEllipse(in: CGRect(x: -width / 2, y: -width / 2, width: width, height: width))
        } else {
            path.addLines(between: local)
        }
        node.path = path
        node.lineWidth = local.count == 1 ? 0 : width
        node.lineCap = .round
        node.lineJoin = .round
        node.strokeColor = dynamic ? color : pinnedColor
        node.fillColor = local.count == 1 ? (dynamic ? color : pinnedColor) : .clear
        node.lineJoin = .round
        node.position = center
        node.zPosition = 10
        node.name = "stroke"
        node.userData = ["polyline": local.map { NSValue(cgPoint: $0) }]
        node.physicsBody = makeBody(local: local, dynamic: dynamic)
        return node
    }

    static func makeBody(local: [CGPoint], dynamic: Bool) -> SKPhysicsBody {
        var parts: [SKPhysicsBody] = []
        if local.count == 1 {
            parts.append(SKPhysicsBody(circleOfRadius: width / 2, center: local[0]))
        } else {
            for i in 1..<local.count {
                let quad = Geometry.segmentQuad(local[i - 1], local[i], halfWidth: width / 2)
                let path = CGMutablePath()
                path.addLines(between: quad)
                path.closeSubpath()
                parts.append(SKPhysicsBody(polygonFrom: path))
                if i < local.count - 1 {
                    parts.append(SKPhysicsBody(circleOfRadius: width / 2, center: local[i]))
                }
            }
        }
        let body = parts.count == 1 ? parts[0] : SKPhysicsBody(bodies: parts)
        body.isDynamic = dynamic
        body.mass = mass(forLength: Geometry.polylineLength(local))
        body.friction = 0.9
        body.restitution = 0.05
        body.linearDamping = 0.1
        body.angularDamping = 0.1
        body.allowsRotation = true
        body.categoryBitMask = StrokeCategory.drawn
        body.collisionBitMask = StrokeCategory.wall | StrokeCategory.drawn | StrokeCategory.actor | StrokeCategory.killer | StrokeCategory.bee
        body.contactTestBitMask = 0
        return body
    }
}
