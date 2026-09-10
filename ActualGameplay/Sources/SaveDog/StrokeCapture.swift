import SpriteKit

/// Owns the stroke being drawn: samples touch points, meters ink, renders the live path, and hands
/// the finished polyline back to the scene. Injected (replayed) strokes skip this and go straight
/// to the scene's commit path, which is the same code a finished touch stroke runs through.
final class StrokeCapture {
    static let sampleSpacing: CGFloat = 1.5

    let drawArea: CGRect
    let budget: CGFloat
    var color: UIColor = StrokeBody.color
    private(set) var inkUsed: CGFloat = 0
    private(set) var isDrawing = false
    private weak var scene: SKScene?
    private var points: [CGPoint] = []
    private var live: SKShapeNode?

    init(scene: SKScene, drawArea: CGRect, budget: CGFloat) {
        self.scene = scene
        self.drawArea = drawArea
        self.budget = budget
    }

    /// Ink still available, counting the stroke in progress.
    var inkLeft: CGFloat { max(0, budget - inkUsed - (isDrawing ? Geometry.polylineLength(points) : 0)) }

    func begin(at p: CGPoint) {
        guard !isDrawing, drawArea.contains(p), budget - inkUsed >= 1 else { return }
        isDrawing = true
        points = [p]
        let node = SKShapeNode()
        node.lineWidth = StrokeBody.width
        node.lineCap = .round
        node.lineJoin = .round
        node.strokeColor = color.withAlphaComponent(0.7)
        node.zPosition = 50
        scene?.addChild(node)
        live = node
        refreshLive()
    }

    func move(to p: CGPoint) {
        guard isDrawing, let last = points.last else { return }
        let clamped = CGPoint(x: min(max(p.x, drawArea.minX), drawArea.maxX),
                              y: min(max(p.y, drawArea.minY), drawArea.maxY))
        let d = last.distance(to: clamped)
        guard d >= StrokeCapture.sampleSpacing else { return }
        let remaining = budget - inkUsed - Geometry.polylineLength(points)
        guard remaining > 0 else { return }
        if d > remaining {
            points.append(last + (clamped - last) * (remaining / d))
        } else {
            points.append(clamped)
        }
        refreshLive()
    }

    /// Ends the stroke and returns the raw sampled polyline, or nil if nothing was in progress.
    func end() -> [CGPoint]? {
        guard isDrawing else { return nil }
        isDrawing = false
        live?.removeFromParent()
        live = nil
        defer { points = [] }
        return points
    }

    func cancel() {
        isDrawing = false
        live?.removeFromParent()
        live = nil
        points = []
    }

    func spend(_ ink: CGFloat) { inkUsed += ink }

    private func refreshLive() {
        guard let first = points.first else { return }
        let path = CGMutablePath()
        path.move(to: first)
        if points.count == 1 { path.addLine(to: first) } else { path.addLines(between: Array(points.dropFirst())) }
        live?.path = path
    }
}
