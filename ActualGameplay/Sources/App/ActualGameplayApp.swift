import SwiftUI

@main
struct ActualGameplayApp: App {
    @StateObject private var store = ProgressStore.shared

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .onAppear {
                    Haptics.shared.enabled = store.progress.settings.haptics
                    Haptics.shared.prepare()
                }
        }
    }
}
