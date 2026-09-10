import Combine
import Foundation

/// Debug-only switches surfaced in Settings. Read when a game opens.
final class DeveloperFlags: ObservableObject {
    static let shared = DeveloperFlags()

    @Published var showsStats = false
    @Published var showsPhysics = false
    /// Print and copy the strokes that solved a level, ready to paste into its JSON.
    @Published var logSolutions = false
}

/// Process arguments that steer the app for automation.
///
///     --mode saveDog        open that mode on launch
///     --level 3              with --mode, open level 3 straight away
///     --replay               with --level, play the stored solution
///     --autoplay saveDog    replay every level of the mode and write a results file
///     --only 04,07           limit --autoplay to those level ids
///     --audit pinPull        run scripts/audit.py's trial plan instead of the stored solutions
///     --silent               never start the music
enum LaunchArguments {
    static var mode: GameMode? { value(after: "--mode").flatMap(GameMode.init(rawValue:)) }
    static var level: Int? { value(after: "--level").flatMap(Int.init) }
    static var replay: Bool { ProcessInfo.processInfo.arguments.contains("--replay") }
    static var autoplay: GameMode? { value(after: "--autoplay").flatMap(GameMode.init(rawValue:)) }
    /// No music: automation, screenshots, and test hosts must not make a sound.
    static var silent: Bool {
        ProcessInfo.processInfo.arguments.contains("--silent")
            || ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }
    /// Run the trial plan the audit script wrote into the app's container.
    static var audit: GameMode? { value(after: "--audit").flatMap(GameMode.init(rawValue:)) }
    /// With --autoplay, only these level ids (comma separated), e.g. `--only 04,07`.
    static var only: Set<String>? { value(after: "--only").map { Set($0.split(separator: ",").map(String.init)) } }

    static func value(after flag: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
}
