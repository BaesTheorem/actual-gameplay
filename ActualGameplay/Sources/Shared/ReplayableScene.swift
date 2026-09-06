import SpriteKit
import UIKit

/// A level scene that can play its stored solution, so autoplay and `--replay` treat every
/// puzzle mode the same way.
protocol ReplayableScene: AnyObject {
    var levelID: String { get }
    var levelName: String { get }
    var hasSolution: Bool { get }
    /// How long a replay may take before autoplay gives up on it.
    var replayWait: TimeInterval { get }
    /// Queue the stored solution. Safe to call before the scene is presented.
    func startReplay()
    /// Human wording for the score a win carries (ink used, pins pulled).
    func describe(score: Double?) -> String
}

enum SceneFactory {
    static func makeLevelScene(mode: GameMode, index: Int) -> (GameSceneBase & ReplayableScene)? {
        let catalog = LevelCatalog.shared
        switch mode {
        case .drawLine:
            guard let level = try? catalog.load(DrawLevel.self, mode: mode, index: index) else { return nil }
            return DrawScene(level: level, index: index)
        case .pinPull:
            guard let level = try? catalog.load(PinLevel.self, mode: mode, index: index) else { return nil }
            return PinScene(level: level, index: index)
        case .runner:
            return nil
        }
    }
}
