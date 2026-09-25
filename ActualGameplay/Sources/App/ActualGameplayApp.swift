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
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { MusicPlayer.shared.resume() } else { MusicPlayer.shared.pause() }
                }
        }
    }
}
