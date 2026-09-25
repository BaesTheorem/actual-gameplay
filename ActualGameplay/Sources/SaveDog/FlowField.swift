import CoreGraphics
import Foundation

/// A shape the bees have to get around, in scene coordinates.
enum Solid {
    case segment(CGPoint, CGPoint, radius: CGFloat)
    case rect(CGRect)
    case circle(CGPoint, radius: CGFloat)

    /// The point on the shape's surface nearest `p`, and how far `p` is from it (0 inside).
    func nearest(to p: CGPoint) -> (point: CGPoint, distance: CGFloat) {
        switch self {
        case .segment(let a, let b, let radius):
            let ab = b - a
            let len2 = ab.x * ab.x + ab.y * ab.y
            let t = len2 == 0 ? 0 : max(0, min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2))
            let core = a + ab * t
            let away = p - core
            return (core + away.normalized * radius, max(0, away.length - radius))
        case .rect(let rect):
            let c = CGPoint(x: min(max(p.x, rect.minX), rect.maxX), y: min(max(p.y, rect.minY), rect.maxY))
            return (c, p.distance(to: c))
        case .circle(let center, let radius):
            let away = p - center
            return (center + away.normalized * radius, max(0, away.length - radius))
        }
    }
}

/// A coarse distance map from the dogs through the open space of the level. Bees follow it
/// downhill, which routes them around walls and through any gap wide enough for a bee. Cells
/// with no route at all are where the shield is doing its job.
///
/// The same obstacles also carry two maps for the bees that have no route (see `BeeCrew`): which
/// pocket of open air each of them is in, and the way to their places on the structure.
final class FlowField {
    let cell: CGFloat
    let origin: CGPoint
    let columns: Int
    let rows: Int
    private var blocked: [Bool]
    private var distance: [Int32]
    private var directions: [CGVector]
    private var targets: [(CGPoint, CGFloat)] = []
    private var regions: [Int32]
    private var crewDistance: [Int32]
    private var crewDirections: [CGVector]

    init(bounds: CGRect, cell: CGFloat = 6) {
        self.cell = cell
        origin = bounds.origin
        columns = Int((bounds.width / cell).rounded(.up))
        rows = Int((bounds.height / cell).rounded(.up))
        blocked = Array(repeating: false, count: columns * rows)
        distance = Array(repeating: -1, count: columns * rows)
        directions = Array(repeating: .zero, count: columns * rows)
        regions = Array(repeating: -1, count: columns * rows)
        crewDistance = Array(repeating: -1, count: columns * rows)
        crewDirections = Array(repeating: .zero, count: columns * rows)
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
        flood(&distance, from: queue)
        pointDownhill(distance, into: &directions)
    }

    /// Breadth-first step counts through open cells, outward from `queue` (already at 0).
    private func flood(_ distance: inout [Int32], from queue: [Int]) {
        var queue = queue
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
    }

    /// Each reachable cell points at its lowest neighbour, diagonals included, for smooth paths.
    private func pointDownhill(_ distance: [Int32], into directions: inout [CGVector]) {
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

    // MARK: - Crews

    /// The cell at `point` if it is open, else the first open neighbour: a bee pressed flat on a
    /// shield sits inside the shield's inflated border.
    private func openCell(near point: CGPoint) -> Int? {
        for (dx, dy) in [(0, 0), (cell, 0), (-cell, 0), (0, cell), (0, -cell), (cell, cell), (-cell, cell), (cell, -cell), (-cell, -cell)] {
            guard let (c, r) = cellOf(CGPoint(x: point.x + dx, y: point.y + dy)) else { continue }
            let i = index(c, r)
            if !blocked[i] { return i }
        }
        return nil
    }

    /// Split the open space into the pockets the given bees are in: every cell a bee at
    /// `seeds[k]` could fly to gets the smallest such k. Level 5's two holes under the floor come
    /// out as two regions, so each crew only plans around what its own bees can touch.
    func markRegions(seeds: [CGPoint]) {
        for i in regions.indices { regions[i] = -1 }
        for (label, seed) in seeds.enumerated() {
            guard let start = openCell(near: seed), regions[start] < 0 else { continue }
            regions[start] = Int32(label)
            var queue = [start]
            var head = 0
            while head < queue.count {
                let i = queue[head]
                head += 1
                let c = i % columns
                let r = i / columns
                for (dc, dr) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    let nc = c + dc
                    let nr = r + dr
                    guard nc >= 0, nc < columns, nr >= 0, nr < rows else { continue }
                    let n = index(nc, nr)
                    guard !blocked[n], regions[n] < 0 else { continue }
                    regions[n] = Int32(label)
                    queue.append(n)
                }
            }
        }
    }

    /// The region of the cell under `point`, or nil for a blocked or unvisited cell.
    func region(at point: CGPoint) -> Int? {
        guard let (c, r) = cellOf(point) else { return nil }
        let label = regions[index(c, r)]
        return label >= 0 ? Int(label) : nil
    }

    /// The region a bee is in, looking one cell around it when it is pressed against something.
    func region(near point: CGPoint) -> Int? {
        guard let i = openCell(near: point) else { return nil }
        return regions[i] >= 0 ? Int(regions[i]) : nil
    }

    /// Flood from the crew's places on a structure, through the same open space. A bee on its way
    /// to a place follows this; the dog's map would walk it into the shield instead.
    func routeCrew(toward points: [CGPoint]) {
        for i in crewDistance.indices { crewDistance[i] = -1 }
        var queue: [Int] = []
        for p in points {
            guard let (c, r) = cellOf(p) else { continue }
            let i = index(c, r)
            if crewDistance[i] != 0 {
                crewDistance[i] = 0
                queue.append(i)
            }
        }
        flood(&crewDistance, from: queue)
        pointDownhill(crewDistance, into: &crewDirections)
    }

    /// Direction toward the nearest crew place and how many cells away it is, looking one cell
    /// around for bees in a blocked cell. Nil where no place can be reached.
    func crewRoute(at point: CGPoint) -> (direction: CGVector, steps: Int)? {
        for (dx, dy) in [(0, 0), (cell, 0), (-cell, 0), (0, cell), (0, -cell), (cell, cell), (-cell, cell), (cell, -cell), (-cell, -cell)] {
            guard let (c, r) = cellOf(CGPoint(x: point.x + dx, y: point.y + dy)) else { continue }
            let i = index(c, r)
            if crewDistance[i] >= 0 { return (crewDirections[i], Int(crewDistance[i])) }
        }
        return nil
    }
}
