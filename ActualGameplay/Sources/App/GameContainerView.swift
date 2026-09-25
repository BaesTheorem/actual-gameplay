import SpriteKit
import SwiftUI

/// Full-screen host for one game: the SpriteView, the HUD above it, and the result card.
struct GameContainerView: View {
    @StateObject private var session: GameSession
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    private let onNext: (() -> Void)?
    private let onResult: ((GamePhase) -> Void)?
    private let debugOptions: SpriteView.DebugOptions

    init(mode: GameMode,
         onNext: (() -> Void)? = nil,
         onResult: ((GamePhase) -> Void)? = nil,
         makeScene: @escaping () -> GameSceneBase) {
        _session = StateObject(wrappedValue: GameSession(mode: mode, scene: makeScene()))
        self.onNext = onNext
        self.onResult = onResult
        var options: SpriteView.DebugOptions = []
        #if DEBUG
        if DeveloperFlags.shared.showsStats { options.formUnion([.showsFPS, .showsNodeCount, .showsDrawCount]) }
        if DeveloperFlags.shared.showsPhysics { options.insert(.showsPhysics) }
        #endif
        debugOptions = options
    }

    var body: some View {
        ZStack {
            // Only shows where a screen of another shape letterboxes the scene.
            PaperBackground(name: session.mode == .pinPull ? "paper_cave" : "paper")
            SpriteView(scene: session.scene, preferredFramesPerSecond: 60, debugOptions: debugOptions)
                .ignoresSafeArea()
            HUDOverlay(session: session, onBack: { dismiss() })
            if session.phase.isOver {
                ResultOverlay(session: session, onRetry: { session.reset() }, onNext: onNext, onExit: { dismiss() })
            }
        }
        .statusBarHidden(true)
        .defersSystemGestures(on: .bottom)
        .onAppear { MusicPlayer.shared.play(session.mode.track) }
        .onDisappear { Audio.stopAllLoops() }
        .onChange(of: scenePhase) { _, phase in
            session.setPaused(phase != .active)
        }
        .onChange(of: session.phase) { _, phase in
            if phase.isOver { onResult?(phase) }
        }
    }
}
