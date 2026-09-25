import SwiftUI

@main
struct ActualGameplayApp: App {
    @StateObject private var store = ProgressStore.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environmentObject(store)
                .preferredColorScheme(.light)
                .onAppear {
                    Haptics.shared.enabled = store.progress.settings.haptics
                    Haptics.shared.prepare()
                    MusicPlayer.shared.enabled = store.progress.settings.music && !LaunchArguments.silent
                    Audio.enabled = store.progress.settings.sound && !LaunchArguments.silent
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        MusicPlayer.shared.resume()
                    } else {
                        MusicPlayer.shared.pause()
                        // The game pauses with the app, so its loops stop too. A scene restarts its own on its next tick.
                        Audio.stopAllLoops()
                    }
                }
        }
    }
}
