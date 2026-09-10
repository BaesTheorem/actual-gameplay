import SwiftUI
import UIKit

enum GameMode: String, CaseIterable, Identifiable, Codable {
    case saveDog
    case pinPull
    case runner

    var id: String { rawValue }

    var title: String {
        switch self {
        case .saveDog: return "Save the Dog"
        case .pinPull: return "Pull the Pin"
        case .runner: return "Crowd Run"
        }
    }

    var blurb: String {
        switch self {
        case .saveDog: return "Draw a shield. Then the bees come."
        case .pinPull: return "Lava up top, hero down below. Mind the order."
        case .runner: return "Pick gates, grow the crowd, storm the finish."
        }
    }

    var icon: MSIconName {
        switch self {
        case .saveDog: return .shield
        case .pinPull: return .waterDrop
        case .runner: return .directionsRun
        }
    }

    var accent: Color {
        switch self {
        case .saveDog: return Theme.draw
        case .pinPull: return Theme.pin
        case .runner: return Theme.runner
        }
    }

    var uiAccent: UIColor { UIColor(accent) }

    /// The sprite on the home card.
    var preview: Sprite {
        switch self {
        case .saveDog: return .dog
        case .pinPull: return .heroIdle
        case .runner: return .runnerA
        }
    }

    /// Modes with hand-authored levels; the runner generates its own.
    var hasLevels: Bool { self != .runner }
}
