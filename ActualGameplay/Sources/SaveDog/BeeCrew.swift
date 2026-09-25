import SpriteKit

/// How the bees work together once the flow field says there is no way in.
///
/// Pressing wherever they land spreads the swarm over the whole shield, and a shield only ever has
/// to out-weigh the few bees on any one side of it. A crew instead picks the least secure loose
/// body it can reach (light, little fixed footing under it, or resting on the dog), spreads along
/// the side of it that faces the swarm, backs off together, hits it together, and eases off
/// together. Each heave goes somewhere the last one did not: the far end instead of the middle,
/// since torque tips what a straight push cannot slide, and every other pair tilted 30 degrees up,
/// since lifting takes the friction away. Two proper heaves in a row that move nothing, and the
/// crew moves on to the next weakest body. Bees in different pockets of open air (the two holes
/// under level 5's floor) are separate crews with their own targets.
///
/// Nothing here is random: every choice follows from the physics state, so a replay stays
/// reproducible.
final class BeeCrew {
    /// Between neighbours on a face: a bee is 12 pt across.
    static let spacing: CGFloat = 12
    /// This close to its place a bee counts as in position.
    static let ready: CGFloat = 24
    /// Heave once half the living bees are in position, but lean at least this long first, and
    /// never wait longer than `patience` for stragglers.
    static let settle: TimeInterval = 0.6
    static let patience: TimeInterval = 2.5
    static let windup: TimeInterval = 0.5
    static let backOff: CGFloat = 14
    static let heaveLength: TimeInterval = 0.6
    /// After a heave the crew eases off rather than letting go. A body rocked by a heave and
    /// dropped all at once rocks back past where it started: level 10's L, whose outer corner is
    /// only about 1.3 pt of lift from going over, rolled out of the cave mouth that way.
    static let easeLength: TimeInterval = 0.4
    /// The coordinated shove, in pt/s² per bee like the swarm's other accelerations. Level 5 sets
    /// the ceiling: seven bees under a 56 pt bar outweigh it, and a crew that lifts at the far end
    /// tips it. Measured over 12 replays each: 1.2 times `BeeSwarm.shove` never lost level 5, 1.3
    /// lost it twice. Every other stored shield held at 1.6.
    static let heave: CGFloat = BeeSwarm.shove * 1.15
    /// A heave that shifts the body less than this (points, rotation counted at its far end) did nothing.
    static let budged: CGFloat = 10
    static let tilt: CGFloat = .pi / 6

    enum Phase { case gather, windup, heave, ease }

    /// A loose body as the crew sees it.
    struct Body {
        let node: SKNode
        let mass: CGFloat
        /// Points along the middle of the body in its own frame: a stroke's polyline, a box's
        /// corners (closed), a ball's centre.
        let spine: [CGPoint]
        let closed: Bool
        /// From the spine to the surface: half a stroke's width, a ball's radius, 0 for a box outline.
        let thickness: CGFloat
    }

    /// One bee's orders: where to stand, in the body's own frame so the place rides along when the
    /// body moves, and which way the crew pushes.
    private struct Post {
        let node: SKNode
        let local: CGPoint
        let push: CGPoint
    }

    /// What the crew remembers about a body it has worked on.
    private struct Record {
        var play = 0
        var misses = 0
        var done = false
        var reach: CGFloat = 0
        var pose: (position: CGPoint, angle: CGFloat)?
        /// Half its crew was in position at the wind-up, so the heave was a fair test.
        var fair = false
    }

    /// A place a bee could stand against a body.
    private struct Face {
        let spot: CGPoint
        let contact: CGPoint
        let normal: CGPoint
        let region: Int?
        /// The dog's map reaches this side: the body is part of what keeps the bees out.
        let inside: Bool
    }

    private struct Assessment {
        let body: Body
        let center: CGPoint
        let reach: CGFloat
        let security: CGFloat
        let faces: [Face]
    }

    /// The order a crew tries things on one body, one step per heave. Moving a body is not the
    /// same as opening it (a lid on the dog rocks every time it is pushed straight down), so the
    /// crew keeps changing its angle for as long as it stays on a body. Starting with the far end
    /// measured worse: pushing the top of level 10's L down and in pries its outer corner up, and
    /// that order lost 4 of 18 replays of the stored solution where this one lost none of 22.
    private static let plays: [(far: Bool, up: Bool)] = [(false, false), (true, true), (false, true), (true, false)]

    private(set) var phase = Phase.gather
    private var phaseStart: TimeInterval = 0
    /// Share of the heave still in the push while easing off, 1 down to 0.
    private var easing: CGFloat = 0
    private var posts: [ObjectIdentifier: Post] = [:]
    private var records: [ObjectIdentifier: Record] = [:]
    /// Bodies with a crew on them this cycle, in plan order.
    private var working: [SKNode] = []

    var active: Bool { !posts.isEmpty }

    // MARK: - Planning

    /// Re-read the level and hand out places. Runs with every flow field rebuild while the crew
    /// gathers; through a wind-up, heave and ease the places stay put so everyone hits the same thing.
    func plan(bodies: [Body], anchors: [Solid], dogs: [CGPoint], stuck: [BeeNode], field: FlowField) {
        guard phase == .gather else { return }
        posts = [:]
        working = []
        var places: [CGPoint] = []
        defer { field.routeCrew(toward: places) }
        guard !stuck.isEmpty, !bodies.isEmpty, !dogs.isEmpty else { return }
        field.markRegions(seeds: stuck.map(\.position))
        var groups: [(region: Int, bees: [BeeNode])] = []
        for bee in stuck {
            guard let region = field.region(near: bee.position) else { continue }
            if let k = groups.firstIndex(where: { $0.region == region }) {
                groups[k].bees.append(bee)
            } else {
                groups.append((region, [bee]))
            }
        }
        let assessed = bodies.map { assess($0, anchors: anchors, dogs: dogs, field: field) }
        for group in groups {
            guard let order = orders(for: group.bees, in: group.region, assessed: assessed, dogs: dogs, field: field) else { continue }
            let (target, spots, push) = order
            let node = target.body.node
            records[ObjectIdentifier(node), default: Record()].reach = target.reach
            if !working.contains(where: { $0 === node }) { working.append(node) }
            assign(group.bees, to: spots, on: node, push: push)
            places += spots
        }
    }

    /// How hard a body would be to shift, and every place a bee could push it from.
    private func assess(_ body: Body, anchors: [Solid], dogs: [CGPoint], field: FlowField) -> Assessment {
        let node = body.node
        let world = body.spine.map { toWorld($0, node) }
        let path = body.closed ? world + [world[0]] : world
        let samples = path.count > 1 ? Geometry.resample(path, spacing: 4) : world
        let center = body.closed || world.count == 1 ? node.position : Geometry.centroid(samples)
        let reach = (samples.map { $0.distance(to: center) }.max() ?? 0) + body.thickness

        // Footing: where fixed things hold it up from below, and whether the dog is one of them.
        var supports: [CGFloat] = []
        var onDog = false
        for s in samples {
            for anchor in anchors {
                let (c, gap) = anchor.nearest(to: s)
                if gap <= body.thickness + 2.5, c.y < center.y - 2, c.y <= s.y + 1 { supports.append(c.x) }
            }
            if dogs.contains(where: { $0.distance(to: s) <= DogNode.radius + body.thickness + 2.5 }) { onDog = true }
        }
        var footing: CGFloat = 0.2   // held up only by the dog or by other loose ink
        if let lo = supports.min(), let hi = supports.max() {
            // Balanced over a single point or overhanging its support is a tip waiting to happen;
            // a centre of mass well inside a wide stance is not.
            let margin = min(center.x - lo, hi - center.x)
            footing = margin < 3 ? 0.5 : 1 + margin / 20
        }
        if onDog { footing *= 0.5 }

        var faces: [Face] = []
        let standoff = body.thickness + BeeNode.radius + 1
        let probe = body.thickness + BeeNode.radius + field.cell
        func add(_ s: CGPoint, _ n: CGPoint) {
            let out = s + n * probe
            faces.append(Face(spot: s + n * standoff, contact: s + n * body.thickness, normal: n,
                              region: field.region(at: out), inside: field.direction(at: out) != nil))
        }
        if world.count == 1 {
            let count = max(8, Int((2 * .pi * standoff / 6).rounded()))
            for k in 0..<count {
                let a = 2 * CGFloat.pi * CGFloat(k) / CGFloat(count)
                add(world[0], CGPoint(x: cos(a), y: sin(a)))
            }
        } else {
            let points = Geometry.resample(path, spacing: 6)
            for (i, p) in points.enumerated() {
                let t = (points[min(points.count - 1, i + 1)] - points[max(0, i - 1)]).normalized
                guard t != .zero else { continue }
                let n = t.perpendicular
                if body.closed {
                    add(p, dot(n, p - center) >= 0 ? n : n * -1)
                } else {
                    add(p, n)
                    add(p, n * -1)
                }
            }
            if !body.closed, points.count > 1 {
                // The ends: a bar can be pushed lengthways or tipped from its corner.
                let first = points[0], last = points[points.count - 1]
                let ends = [(first, (first - points[1]).normalized), (last, (last - points[points.count - 2]).normalized)]
                for (p, t) in ends where t != .zero {
                    add(p, t)
                    add(p, rotated(t, by: .pi / 4))
                    add(p, rotated(t, by: -.pi / 4))
                }
            }
        }
        return Assessment(body: body, center: center, reach: reach, security: body.mass * footing, faces: faces)
    }

    /// The target, places and push direction for one crew, or nil if it can reach nothing loose.
    private func orders(for bees: [BeeNode], in region: Int, assessed: [Assessment], dogs: [CGPoint],
                        field: FlowField) -> (Assessment, [CGPoint], CGPoint)? {
        let reachable = assessed.filter { $0.faces.contains { $0.region == region } }
        // Bodies that also face the dog are the ones keeping the bees out. Anything else the crew
        // can touch (an outer layer, a stray stroke) is only worth a push when nothing better is left.
        let sealing = reachable.filter { $0.faces.contains(where: \.inside) }
        var pool = sealing.isEmpty ? reachable : sealing
        guard !pool.isEmpty else { return nil }
        if pool.allSatisfy({ records[ObjectIdentifier($0.body.node)]?.done == true }) {
            for a in pool { records[ObjectIdentifier(a.body.node)]?.done = false }
        }
        pool.removeAll { records[ObjectIdentifier($0.body.node)]?.done == true }
        guard let target = pool.min(by: { $0.security < $1.security }),
              let dog = dogs.min(by: { $0.distance(to: target.center) < $1.distance(to: target.center) }) else { return nil }

        let play = BeeCrew.plays[(records[ObjectIdentifier(target.body.node)]?.play ?? 0) % BeeCrew.plays.count]
        let toward = (dog - target.center).normalized
        let faces = target.faces.filter { $0.region == region }
        let pressing = faces.filter { dot($0.normal * -1, toward) > 0.2 }
        let usable = pressing.isEmpty ? faces : pressing
        let middle = Geometry.centroid(bees.map(\.position))
        // Lever arm about the centre of mass for a push toward the dog; ties go to the higher
        // point (tips rather than slides) and then to the side the crew is already on.
        func lever(_ f: Face) -> CGFloat { abs(cross(f.contact - target.center, toward)) }
        func tipping(_ f: Face) -> CGFloat { lever(f) + 0.02 * f.contact.y - 0.01 * f.spot.distance(to: middle) }
        func centred(_ f: Face) -> CGFloat { lever(f) + 0.01 * f.spot.distance(to: middle) }
        guard let anchor = play.far ? usable.max(by: { tipping($0) < tipping($1) })
                                    : usable.min(by: { centred($0) < centred($1) }) else { return nil }
        var push = (dog - anchor.contact).normalized
        if push == .zero { push = toward }
        if play.up { push = BeeCrew.tilted(push) }

        // Places along the face nearest the push point, a bee's width apart, then rows behind
        // them for a crew bigger than the face.
        let lined = faces.filter { dot($0.normal * -1, push) > 0.2 }
        let candidates = (lined.isEmpty ? usable : lined).sorted { $0.spot.distance(to: anchor.spot) < $1.spot.distance(to: anchor.spot) }
        var spots: [CGPoint] = []
        for face in candidates where spots.count < bees.count {
            if spots.allSatisfy({ $0.distance(to: face.spot) >= BeeCrew.spacing }) { spots.append(face.spot) }
        }
        let front = spots
        for row in 1...3 where spots.count < bees.count {
            for spot in front where spots.count < bees.count {
                let p = spot - push * (BeeCrew.spacing * CGFloat(row))
                if field.region(at: p) == region, spots.allSatisfy({ $0.distance(to: p) >= BeeCrew.spacing * 0.9 }) { spots.append(p) }
            }
        }
        guard !spots.isEmpty else { return nil }
        return (target, spots, push)
    }

    /// Nearest bee to nearest place first; a crew bigger than its places doubles up.
    private func assign(_ bees: [BeeNode], to spots: [CGPoint], on node: SKNode, push: CGPoint) {
        var pairs: [(gap: CGFloat, bee: Int, spot: Int)] = []
        for (b, bee) in bees.enumerated() {
            for (s, spot) in spots.enumerated() { pairs.append((bee.position.distance(to: spot), b, s)) }
        }
        pairs.sort { ($0.gap, $0.bee, $0.spot) < ($1.gap, $1.bee, $1.spot) }
        var given = [Int?](repeating: nil, count: bees.count)
        var taken = [Bool](repeating: false, count: spots.count)
        for pair in pairs where given[pair.bee] == nil && !taken[pair.spot] {
            given[pair.bee] = pair.spot
            taken[pair.spot] = true
        }
        for (b, bee) in bees.enumerated() {
            let s = given[b] ?? spots.indices.min { bee.position.distance(to: spots[$0]) < bee.position.distance(to: spots[$1]) }!
            posts[ObjectIdentifier(bee)] = Post(node: node, local: toLocal(spots[s], node), push: push)
        }
    }

    // MARK: - The heave cycle

    /// Advance gather, wind-up, heave and ease. Call every frame with every living bee.
    func tick(now: TimeInterval, bees: [BeeNode]) {
        switch phase {
        case .gather:
            guard active else {
                phaseStart = now   // the wait only counts while there is a crew
                return
            }
            let waited = now - phaseStart
            guard waited >= BeeCrew.settle else { return }
            let placed = bees.filter(inPosition).count
            guard placed * 2 >= bees.count || waited >= BeeCrew.patience else { return }
            for node in working {
                let crew = bees.filter { posts[ObjectIdentifier($0)]?.node === node }
                let key = ObjectIdentifier(node)
                records[key, default: Record()].pose = (node.position, node.zRotation)
                records[key]?.fair = crew.filter(inPosition).count * 2 >= crew.count
            }
            phase = .windup
            phaseStart = now
        case .windup:
            if now - phaseStart >= BeeCrew.windup {
                phase = .heave
                phaseStart = now
            }
        case .heave:
            if now - phaseStart >= BeeCrew.heaveLength {
                phase = .ease
                phaseStart = now
                easing = 1
            }
        case .ease:
            easing = CGFloat(max(0, 1 - (now - phaseStart) / BeeCrew.easeLength))
            if now - phaseStart >= BeeCrew.easeLength {
                judge()
                phase = .gather
                phaseStart = now
            }
        }
    }

    /// Did each target move? After two proper heaves in a row that did nothing, give the body up
    /// for the next weakest.
    private func judge() {
        for node in working {
            let key = ObjectIdentifier(node)
            guard var record = records[key], let pose = record.pose else { continue }
            let turned = abs(atan2(sin(node.zRotation - pose.angle), cos(node.zRotation - pose.angle)))
            let moved = node.position.distance(to: pose.position) + turned * record.reach
            record.play += 1
            if moved > BeeCrew.budged || node.parent == nil {
                record.misses = 0
            } else if record.fair {
                record.misses += 1
                if record.misses >= 2 {
                    record.done = true
                    record.misses = 0
                }
            }
            record.pose = nil
            records[key] = record
        }
    }

    private func inPosition(_ bee: BeeNode) -> Bool {
        guard let post = posts[ObjectIdentifier(bee)] else { return false }
        return bee.position.distance(to: toWorld(post.local, post.node)) <= BeeCrew.ready
    }

    // MARK: - Steering

    /// This frame's acceleration (pt/s²) for a bee with orders, or nil when it has none.
    func steer(_ bee: BeeNode, velocity: CGVector, field: FlowField?) -> CGPoint? {
        guard let post = posts[ObjectIdentifier(bee)], post.node.parent != nil else { return nil }
        let spot = toWorld(post.local, post.node)
        let v = CGPoint(x: velocity.dx, y: velocity.dy)
        let gap = bee.position.distance(to: spot)
        // In position: back off together, hit together, ease off together. A bee still on its
        // way keeps going.
        if gap < 30 {
            switch phase {
            case .heave: return post.push * BeeCrew.heave
            case .ease: return post.push * (BeeSwarm.press + (BeeCrew.heave - BeeSwarm.press) * easing)
            case .windup: return arrive(bee.position, v, at: spot - post.push * BeeCrew.backOff)
            case .gather: break
            }
        }
        // Far off: the crew map, which goes around the shield rather than into it.
        if gap > BeeCrew.ready, let route = field?.crewRoute(at: bee.position), route.steps > 2 {
            let want = CGPoint(x: route.direction.dx, y: route.direction.dy) * BeeSwarm.topSpeed
            return limited((want - v) * 6, to: BeeSwarm.cruise)
        }
        // Close: straight to the place, and lean on the body once there.
        var a = arrive(bee.position, v, at: spot)
        if gap < 10 { a = a + post.push * BeeSwarm.press }
        return a
    }

    /// Fly to `target` and stop there: close the distance in about a sixth of a second, with the
    /// velocity error as the brake.
    private func arrive(_ p: CGPoint, _ v: CGPoint, at target: CGPoint) -> CGPoint {
        let want = limited((target - p) * 6, to: BeeSwarm.topSpeed)
        return limited((want - v) * 10, to: BeeSwarm.cruise)
    }

    /// `d` turned up to 30 degrees toward straight up, the short way round, without passing it.
    static func tilted(_ d: CGPoint) -> CGPoint {
        let angle = atan2(d.y, d.x)
        var delta = CGFloat.pi / 2 - angle
        if delta > .pi { delta -= 2 * .pi }
        if delta < -.pi { delta += 2 * .pi }
        let turned = angle + max(-tilt, min(tilt, delta))
        return CGPoint(x: cos(turned), y: sin(turned))
    }
}

// MARK: - Geometry

private func dot(_ a: CGPoint, _ b: CGPoint) -> CGFloat { a.x * b.x + a.y * b.y }
private func cross(_ a: CGPoint, _ b: CGPoint) -> CGFloat { a.x * b.y - a.y * b.x }

private func rotated(_ p: CGPoint, by angle: CGFloat) -> CGPoint {
    CGPoint(x: p.x * cos(angle) - p.y * sin(angle), y: p.x * sin(angle) + p.y * cos(angle))
}

private func limited(_ p: CGPoint, to length: CGFloat) -> CGPoint {
    p.length > length ? p.normalized * length : p
}

/// A point in `node`'s frame, in scene coordinates (the node is a direct child of the scene).
private func toWorld(_ p: CGPoint, _ node: SKNode) -> CGPoint {
    node.position + rotated(p, by: node.zRotation)
}

private func toLocal(_ p: CGPoint, _ node: SKNode) -> CGPoint {
    rotated(p - node.position, by: -node.zRotation)
}

extension StrokeScene {
    /// What a crew can see: every loose body it could shift, and every fixed surface a body can
    /// stand on (walls, spikes, pinned ink, the edges of the playfield).
    func crewSurvey() -> (bodies: [BeeCrew.Body], anchors: [Solid]) {
        let field = GameSceneBase.playfield
        var anchors: [Solid] = [
            .segment(CGPoint(x: field.minX, y: -300), CGPoint(x: field.minX, y: field.maxY), radius: 0),
            .segment(CGPoint(x: field.minX, y: field.maxY), CGPoint(x: field.maxX, y: field.maxY), radius: 0),
            .segment(CGPoint(x: field.maxX, y: field.maxY), CGPoint(x: field.maxX, y: -300), radius: 0),
        ]
        var bodies: [BeeCrew.Body] = []
        for child in children {
            guard let body = child.physicsBody, let data = child.userData else { continue }
            if let values = data["polyline"] as? [NSValue] {
                let local = values.map(\.cgPointValue)
                if body.isDynamic {
                    bodies.append(BeeCrew.Body(node: child, mass: body.mass, spine: local, closed: false, thickness: StrokeBody.width / 2))
                } else {
                    let points = local.map { toWorld($0, child) }
                    if points.count == 1 { anchors.append(.circle(points[0], radius: StrokeBody.width / 2)) }
                    for i in points.indices.dropFirst() { anchors.append(.segment(points[i - 1], points[i], radius: StrokeBody.width / 2)) }
                }
            } else if body.categoryBitMask == StrokeCategory.prop {
                guard body.isDynamic else { continue }
                if let radius = data["radius"] as? CGFloat {
                    bodies.append(BeeCrew.Body(node: child, mass: body.mass, spine: [.zero], closed: false, thickness: radius))
                } else if let size = (data["box"] as? NSValue)?.cgSizeValue {
                    let hw = size.width / 2, hh = size.height / 2
                    let corners = [CGPoint(x: -hw, y: -hh), CGPoint(x: hw, y: -hh), CGPoint(x: hw, y: hh), CGPoint(x: -hw, y: hh)]
                    bodies.append(BeeCrew.Body(node: child, mass: body.mass, spine: corners, closed: true, thickness: 0))
                }
            } else if !body.isDynamic {
                if let rect = (data["rect"] as? NSValue)?.cgRectValue {
                    anchors.append(.rect(rect))
                } else if let radius = data["radius"] as? CGFloat {
                    anchors.append(.circle(child.position, radius: radius))
                } else if let values = data["points"] as? [NSValue] {
                    let points = values.map(\.cgPointValue)
                    let half = data["halfWidth"] as? CGFloat ?? 3
                    for i in points.indices.dropFirst() { anchors.append(.segment(points[i - 1], points[i], radius: half)) }
                }
            }
        }
        return (bodies, anchors)
    }
}
