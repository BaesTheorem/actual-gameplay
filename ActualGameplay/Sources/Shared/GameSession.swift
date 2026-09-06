import Combine
import Foundation

enum GamePhase: Equatable {
    case playing
    case paused
    case won(stars: Int, coins: Int)
    case lost(reason: String)

    var isOver: Bool {
        switch self {
        case .won, .lost: return true
        case .playing, .paused: return false
        }
    }
}

/// What the SwiftUI chrome shows above a scene. Scenes publish it; they never draw chrome themselves.
struct HUDState: Equatable {
    var title: String = ""
    var readout: String = ""
    var progress: Double? = nil
}

/// The contract between a SpriteKit scene and the SwiftUI shell around it.
///
/// One session per opened game. The container view owns it as a `@StateObject`, and it owns the
/// scene, so SwiftUI re-renders never hand `SpriteView` a fresh scene.
final class GameSession: ObservableObject {
    let mode: GameMode
    let scene: GameSceneBase
    @Published private(set) var phase: GamePhase = .playing
    @Published var hud = HUDState()

    init(mode: GameMode, scene: GameSceneBase) {
        self.mode = mode
        self.scene = scene
        scene.session = self
    }

    /// Called by the scene, once per attempt. Ignored unless the game is still in play.
    func finish(_ outcome: GamePhase) {
        guard case .playing = phase else { return }
        phase = outcome
    }

    func reset() {
        phase = .playing
        scene.resetLevel()
    }

    func setPaused(_ paused: Bool) {
        switch (phase, paused) {
        case (.playing, true):
            phase = .paused
            scene.isPaused = true
        case (.paused, false):
            phase = .playing
            scene.isPaused = false
        default:
            break
        }
    }
}
