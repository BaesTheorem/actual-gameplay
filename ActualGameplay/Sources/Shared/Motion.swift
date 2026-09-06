import UIKit

/// Reduce Motion is the default rendering here, not an edge case. Decorative motion asks first.
enum Motion {
    static var reduced: Bool { UIAccessibility.isReduceMotionEnabled }

    /// Decorative animation duration: full length normally, near-instant under Reduce Motion.
    static func decorative(_ full: TimeInterval) -> TimeInterval { reduced ? min(full, 0.1) : full }
}
