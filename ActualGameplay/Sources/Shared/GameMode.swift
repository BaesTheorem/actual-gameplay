import SwiftUI
import UIKit

enum GameMode: String, CaseIterable, Identifiable, Codable {
    case drawLine
    case pinPull
    case runner

    var id: String { rawValue }

    var title: String {
        switch self {
        case .drawLine: return "Draw a Line"
        case .pinPull: return "Pull the Pin"
        case .runner: return "Crowd Run"
        }
    }

    var blurb: String {
        switch self {
        case .drawLine: return "Sketch a shape. Physics does the rest."
        case .pinPull: return "Lava up top, hero down below. Mind the order."
        case .runner: return "Pick gates, grow the crowd, storm the finish."
        }
    }

    var icon: MSIconName {
        switch self {
        case .drawLine: return .gesture
        case .pinPull: return .waterDrop
        case .runner: return .directionsRun
        }
    }

    var accent: Color {
        switch self {
        case .drawLine: return Theme.draw
        case .pinPull: return Theme.pin
        case .runner: return Theme.runner
        }
    }

    var uiAccent: UIColor { UIColor(accent) }

    /// Modes with hand-authored levels; the runner generates its own.
    var hasLevels: Bool { self != .runner }
}
