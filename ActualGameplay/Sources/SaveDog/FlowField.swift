import CoreGraphics
import Foundation

/// A shape the bees have to get around, in scene coordinates.
enum Solid {
    case segment(CGPoint, CGPoint, radius: CGFloat)
    case rect(CGRect)
    case circle(CGPoint, radius: CGFloat)
}

/// A coarse distance map from the dogs through the open space of the level. Bees follow it
/// downhill, which routes them around walls and through any gap wide enough for a bee. Cells
/// with no route at all are where the shield is doing its job.
final class FlowField {
    let cell: CGFloat
    let origin: CGPoint
    let columns: Int
    let rows: Int
    private var blocked: [Bool]
    private var distance: [Int32]
    private var directions: [CGVector]
    private var targets: [(CGPoint, CGFloat)] = []

    init(bounds: CGRect, cell: CGFloat = 6) {
        self.cell = cell
        origin = bounds.origin
        columns = Int((bounds.width / cell).rounded(.up))
        rows = Int((bounds.height / cell).rounded(.up))
        blocked = Array(repeating: false, count: columns * rows)
        distance = Array(repeating: -1, count: columns * rows)
        directions = Array(repeating: .zero, count: columns * rows)
    }

    private func index(_ c: Int, _ r: Int) -> Int { r * columns + c }

    private func cellOf(_ p: CGPoint) -> (Int, Int)? {
        let c = Int((p.x - origin.x) / cell)
        let r = Int((p.y - origin.y) / cell)
        guard c >= 0, c < columns, r >= 0, r < rows else { return nil }
        return (c, r)
    }

    private func center(_ c: Int, _ r: Int) -> CGPoint {
        CGPoint(x: origin.x + (CGFloat(c) + 0.5) * cell, y: origin.y + (CGFloat(r) + 0.5) * cell)
    }

    /// Rasterize the solids (inflated by the bee radius), then flood from the targets.
    func rebuild(solids: [Solid], targets: [(center: CGPoint, radius: CGFloat)], clearance: CGFloat) {
        for i in blocked.indices {
            blocked[i] = false
            distance[i] = -1
        }
        // The playfield edges: a bee cannot center itself closer than its radius to a wall.
        for c in 0..<columns {
            blocked[index(c, rows - 1)] = true
            blocked[index(c, 0)] = true
        }
        for r in 0..<rows {
            blocked[index(0, r)] = true
            blocked[index(columns - 1, r)] = true
        }
        for solid in solids {
            switch solid {
            case .segment(let a, let b, let radius):
                mark(bbox: CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(b.x - a.x), height: abs(b.y - a.y))
                    .insetBy(dx: -(radius + clearance), dy: -(radius + clearance))) { p in
                    Geometry.distanceToSegment(p, a, b) <= radius + clearance
                }
            case .rect(let rect):
                let grown = rect.insetBy(dx: -clearance, dy: -clearance)
                mark(bbox: grown) { grown.contains($0) }
            case .circle(let c, let radius):
                let grown = radius + clearance
                mark(bbox: CGRect(x: c.x - grown, y: c.y - grown, width: 2 * grown, height: 2 * grown)) { $0.distance(to: c) <= grown }
            }
        }
        self.targets = targets.map { ($0.center, $0.radius) }
        var queue: [Int] = []
        queue.reserveCapacity(columns * rows / 4)
        for (target, radius) in targets {
            let reach = radius + clearance
            let box = CGRect(x: target.x - reach, y: target.y - reach, width: 2 * reach, height: 2 * reach)
            forEachCell(in: box) { c, r in
                guard center(c, r).distance(to: target) <= reach else { return }
                let i = index(c, r)
                blocked[i] = false
                if distance[i] != 0 {
                    distance[i] = 0
                    queue.append(i)
                }
            }
        }
        var head = 0
        while head < queue.count {
            let i = queue[head]
            head += 1
            let c = i % columns
            let r = i / columns
            let d = distance[i] + 1
            for (dc, dr) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let nc = c + dc
                let nr = r + dr
                guard nc >= 0, nc < columns, nr >= 0, nr < rows else { continue }
                let n = index(nc, nr)
                guard !blocked[n], distance[n] < 0 else { continue }
                distance[n] = d
                queue.append(n)
            }
        }
        // Each reachable cell points at its lowest neighbour, diagonals included, for smooth paths.
        for r in 0..<rows {
            for c in 0..<columns {
                let i = index(c, r)
                guard distance[i] > 0 else {
                    directions[i] = .zero
                    continue
                }
                var best = distance[i]
                var bestVector = CGVector.zero
                for dr in -1...1 {
                    for dc in -1...1 where dc != 0 || dr != 0 {
                        let nc = c + dc
                        let nr = r + dr
                        guard nc >= 0, nc < columns, nr >= 0, nr < rows else { continue }
                        let n = index(nc, nr)
                        guard distance[n] >= 0, distance[n] < best else { continue }
                        // A diagonal step must not cut a blocked corner.
                        if dc != 0, dr != 0, blocked[index(c + dc, r)] || blocked[index(c, r + dr)] { continue }
                        best = distance[n]
                        let length = hypot(CGFloat(dc), CGFloat(dr))
                        bestVector = CGVector(dx: CGFloat(dc) / length, dy: CGFloat(dr) / length)
                    }
                }
                directions[i] = bestVector
            }
        }
    }

    private func forEachCell(in box: CGRect, _ body: (Int, Int) -> Void) {
        let c0 = max(0, Int((box.minX - origin.x) / cell))
        let c1 = min(columns - 1, Int((box.maxX - origin.x) / cell))
        let r0 = max(0, Int((box.minY - origin.y) / cell))
        let r1 = min(rows - 1, Int((box.maxY - origin.y) / cell))
        guard c0 <= c1, r0 <= r1 else { return }
        for r in r0...r1 {
            for c in c0...c1 { body(c, r) }
        }
    }

    private func mark(bbox: CGRect, _ inside: (CGPoint) -> Bool) {
        forEachCell(in: bbox) { c, r in
            if inside(center(c, r)) { blocked[index(c, r)] = true }
        }
    }

    /// Unit direction to follow from `point`, or nil when there is no route from here.
    func direction(at point: CGPoint) -> CGVector? {
        guard let (c, r) = cellOf(point) else { return nil }
        let i = index(c, r)
        if distance[i] == 0 {
            let target = targets.min { $0.0.distance(to: point) < $1.0.distance(to: point) }?.0 ?? point
            let d = (target - point).normalized
            return CGVector(dx: d.x, dy: d.y)
        }
        guard distance[i] > 0 else { return nil }
        return directions[i]
    }

    /// Whether any open cell next to `point` has a route, for bees sitting in a blocked cell.
    func nearbyDirection(at point: CGPoint) -> CGVector? {
        if let d = direction(at: point) { return d }
        for (dx, dy) in [(cell, 0), (-cell, 0), (0, cell), (0, -cell), (cell, cell), (-cell, cell), (cell, -cell), (-cell, -cell)] {
            if let d = direction(at: CGPoint(x: point.x + dx, y: point.y + dy)) { return d }
        }
        return nil
    }

    /// True when at least one target can be reached from anywhere along the top edge, which is
    /// what the developer overlay uses to show whether a shield is closed.
    var anyRoute: Bool { distance.contains { $0 > 0 } }
}
