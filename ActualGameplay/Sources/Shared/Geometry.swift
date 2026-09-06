import CoreGraphics

extension CGPoint {
    static func + (l: CGPoint, r: CGPoint) -> CGPoint { CGPoint(x: l.x + r.x, y: l.y + r.y) }
    static func - (l: CGPoint, r: CGPoint) -> CGPoint { CGPoint(x: l.x - r.x, y: l.y - r.y) }
    static func * (l: CGPoint, s: CGFloat) -> CGPoint { CGPoint(x: l.x * s, y: l.y * s) }

    var length: CGFloat { hypot(x, y) }
    var normalized: CGPoint { let l = length; return l > 0 ? CGPoint(x: x / l, y: y / l) : .zero }
    /// Left-hand normal in a y-up space.
    var perpendicular: CGPoint { CGPoint(x: -y, y: x) }

    func distance(to p: CGPoint) -> CGFloat { hypot(p.x - x, p.y - y) }
}

enum Geometry {
    static func polylineLength(_ points: [CGPoint]) -> CGFloat {
        guard points.count > 1 else { return 0 }
        var total: CGFloat = 0
        for i in 1..<points.count { total += points[i - 1].distance(to: points[i]) }
        return total
    }

    static func distanceToSegment(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
        let ab = b - a
        let len2 = ab.x * ab.x + ab.y * ab.y
        if len2 == 0 { return p.distance(to: a) }
        let t = max(0, min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2))
        return p.distance(to: a + ab * t)
    }

    /// Ramer-Douglas-Peucker, iterative so a long stroke cannot blow the stack.
    static func simplify(_ points: [CGPoint], epsilon: CGFloat) -> [CGPoint] {
        guard points.count > 2 else { return points }
        var keep = [Bool](repeating: false, count: points.count)
        keep[0] = true
        keep[points.count - 1] = true
        var stack = [(0, points.count - 1)]
        while let (s, e) = stack.popLast() {
            guard e > s + 1 else { continue }
            var maxDistance: CGFloat = 0
            var index = s
            for i in (s + 1)..<e {
                let d = distanceToSegment(points[i], points[s], points[e])
                if d > maxDistance { maxDistance = d; index = i }
            }
            if maxDistance > epsilon {
                keep[index] = true
                stack.append((s, index))
                stack.append((index, e))
            }
        }
        return points.enumerated().filter { keep[$0.offset] }.map(\.element)
    }

    /// Drop interior points that would make a segment shorter than `minLength`. Endpoints always survive.
    static func mergeShortSegments(_ points: [CGPoint], minLength: CGFloat) -> [CGPoint] {
        guard points.count > 2 else { return points }
        var out = [points[0]]
        for p in points.dropFirst().dropLast() where p.distance(to: out[out.count - 1]) >= minLength {
            out.append(p)
        }
        let last = points[points.count - 1]
        if out.count > 1 && last.distance(to: out[out.count - 1]) < minLength {
            out[out.count - 1] = last
        } else {
            out.append(last)
        }
        return out
    }

    /// Points spaced `spacing` apart along a polyline, endpoints included.
    static func resample(_ points: [CGPoint], spacing: CGFloat) -> [CGPoint] {
        guard points.count > 1, spacing > 0 else { return points }
        var out = [points[0]]
        var carry: CGFloat = 0
        for i in 1..<points.count {
            let a = points[i - 1], b = points[i]
            let segment = a.distance(to: b)
            guard segment > 0 else { continue }
            var d = spacing - carry
            while d <= segment {
                out.append(a + (b - a) * (d / segment))
                d += spacing
            }
            carry = segment - (d - spacing)
        }
        if let last = points.last, out[out.count - 1] != last { out.append(last) }
        return out
    }

    /// Corners of the rectangle that thickens segment a-b, counterclockwise in a y-up space.
    static func segmentQuad(_ a: CGPoint, _ b: CGPoint, halfWidth: CGFloat) -> [CGPoint] {
        let n = (b - a).normalized.perpendicular * halfWidth
        return [a - n, b - n, b + n, a + n]
    }

    static func signedArea(_ polygon: [CGPoint]) -> CGFloat {
        guard polygon.count >= 3 else { return 0 }
        var sum: CGFloat = 0
        for i in 0..<polygon.count {
            let a = polygon[i], b = polygon[(i + 1) % polygon.count]
            sum += a.x * b.y - b.x * a.y
        }
        return sum / 2
    }

    static func isCounterClockwise(_ polygon: [CGPoint]) -> Bool { signedArea(polygon) > 0 }

    static func isConvex(_ polygon: [CGPoint]) -> Bool {
        guard polygon.count >= 3 else { return false }
        var sign = 0
        for i in 0..<polygon.count {
            let a = polygon[i], b = polygon[(i + 1) % polygon.count], c = polygon[(i + 2) % polygon.count]
            let cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
            if abs(cross) < 1e-9 { continue }
            let s = cross > 0 ? 1 : -1
            if sign == 0 { sign = s } else if sign != s { return false }
        }
        return true
    }

    static func centroid(_ points: [CGPoint]) -> CGPoint {
        guard !points.isEmpty else { return .zero }
        let sum = points.reduce(CGPoint.zero, +)
        return sum * (1 / CGFloat(points.count))
    }
}
