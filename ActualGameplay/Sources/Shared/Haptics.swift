import QuartzCore
import UIKit

/// Prepared feedback generators with a rate limit, so a swarm of contacts is one tap, not a buzz.
final class Haptics {
    static let shared = Haptics()

    var enabled = true

    private let light = UIImpactFeedbackGenerator(style: .light)
    private let medium = UIImpactFeedbackGenerator(style: .medium)
    private let heavy = UIImpactFeedbackGenerator(style: .heavy)
    private let notice = UINotificationFeedbackGenerator()
    private var recent: [CFTimeInterval] = []
    private var lastFire: CFTimeInterval = 0

    func prepare() {
        light.prepare()
        medium.prepare()
        heavy.prepare()
        notice.prepare()
    }

    func tap() { fire { light.impactOccurred(); light.prepare() } }
    func thud() { fire { medium.impactOccurred(); medium.prepare() } }
    func slam() { fire { heavy.impactOccurred(); heavy.prepare() } }

    func success() {
        guard enabled else { return }
        notice.notificationOccurred(.success)
        notice.prepare()
    }

    func failure() {
        guard enabled else { return }
        notice.notificationOccurred(.error)
        notice.prepare()
    }

    /// At most one impact per frame and 15 per second.
    private func fire(_ body: () -> Void) {
        guard enabled else { return }
        let now = CACurrentMediaTime()
        recent.removeAll { now - $0 > 1 }
        guard recent.count < 15, now - lastFire > 1.0 / 60 else { return }
        recent.append(now)
        lastFire = now
        body()
    }
}
