import SwiftUI
import UIKit

enum GameMode: String, CaseIterable, Identifiable, Codable {
    case saveDog
    case pinPull
    case runner

    var id: String { rawValue }

    var title: String {
        switch self {
        case .saveDog: return "Save the Clawd"
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

    /// The painted Clawd on the home card: a clip and the frame of it to show (frame 0 is often mid-blink).
    var preview: (clip: String, frame: Int) {
        switch self {
        case .saveDog: return ("clawd_nervous", 3)
        case .pinPull: return ("clawd_hard_idle", 4)
        case .runner: return ("clawd_run", 3)
        }
    }

    /// The painted swatch Clawd stands on in that card.
    var swatch: String {
        switch self {
        case .saveDog: return "ui_button_sky"
        case .pinPull: return "ui_button_ink"
        case .runner: return "ui_button_sap"
        }
    }

    /// Modes with hand-authored levels; the runner generates its own.
    var hasLevels: Bool { self != .runner }
}
