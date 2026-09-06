import Combine
import Foundation

/// Debug-only switches surfaced in Settings. Read when a game opens.
final class DeveloperFlags: ObservableObject {
    static let shared = DeveloperFlags()

    @Published var showsStats = false
    @Published var showsPhysics = false
}

/// Process arguments that steer the app for automation: `--mode pinPull` opens that mode on launch.
enum LaunchArguments {
    static var mode: GameMode? {
        value(after: "--mode").flatMap(GameMode.init(rawValue:))
    }

    static func value(after flag: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
}
