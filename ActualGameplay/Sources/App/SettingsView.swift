import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: ProgressStore
    @ObservedObject private var dev = DeveloperFlags.shared
    @Environment(\.dismiss) private var dismiss
    @State private var confirmReset = false
    @State private var autoplayMode: GameMode?

    var body: some View {
        ZStack {
            Theme.surface.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Text("SETTINGS").font(Theme.title(24))
                    Spacer()
                    IconButton(icon: .close) { dismiss() }
                }
                Toggle(isOn: hapticsBinding) { Text("Haptics").font(Theme.label()) }
                    .tint(Theme.draw)
                Toggle(isOn: musicBinding) { Text("Music").font(Theme.label()) }
                    .tint(Theme.draw)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Music by Kevin MacLeod (incompetech.com)").font(Theme.label(13))
                    Text("Licensed under Creative Commons: By Attribution 4.0")
                        .font(Theme.body(12)).foregroundStyle(Theme.onSurfaceMuted)
                    Text(MusicTrack.allCases.map(\.title).joined(separator: ", "))
                        .font(Theme.mono(11)).foregroundStyle(Theme.onSurfaceMuted)
                }
                Text(Motion.reduced
                     ? "Reduce Motion is on. Shakes and bounces stay off."
                     : "Reduce Motion is off.")
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.onSurfaceMuted)
                HairlineDivider()
                #if DEBUG
                Toggle(isOn: $dev.showsStats) { Text("Show FPS and draw count").font(Theme.label()) }
                    .tint(Theme.runner)
                Toggle(isOn: $dev.showsPhysics) { Text("Show physics outlines").font(Theme.label()) }
                    .tint(Theme.runner)
                Toggle(isOn: $dev.logSolutions) { Text("Copy solving strokes to clipboard").font(Theme.label()) }
                    .tint(Theme.runner)
                HStack(spacing: 10) {
                    Button("Auto-play Save the Dog") { autoplayMode = .saveDog }
                        .buttonStyle(OutlinedButtonStyle(tint: Theme.runner))
                    Button("Auto-play Pull the Pin") { autoplayMode = .pinPull }
                        .buttonStyle(OutlinedButtonStyle(tint: Theme.runner))
                }
                Button("Autopilot five Crowd Runs") { autoplayMode = .runner }
                    .buttonStyle(OutlinedButtonStyle(tint: Theme.runner))
                HairlineDivider()
                #endif
                Button("Reset all progress") { confirmReset = true }
                    .buttonStyle(OutlinedButtonStyle(tint: Theme.danger))
                Spacer()
                Text("No ads. No purchases. No network.")
                    .font(Theme.mono(12))
                    .foregroundStyle(Theme.onSurfaceMuted)
            }
            .padding(20)
            .foregroundStyle(Theme.onSurface)
        }
        .confirmationDialog("Reset all progress?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Reset everything", role: .destructive) { store.resetAll() }
        }
        .fullScreenCover(item: $autoplayMode) { mode in
            AutoplayView(mode: mode)
        }
    }

    private var musicBinding: Binding<Bool> {
        Binding(
            get: { store.progress.settings.music },
            set: { value in
                store.update { $0.settings.music = value }
                MusicPlayer.shared.enabled = value && !LaunchArguments.silent
            }
        )
    }

    private var hapticsBinding: Binding<Bool> {
        Binding(
            get: { store.progress.settings.haptics },
            set: { value in
                store.update { $0.settings.haptics = value }
                Haptics.shared.enabled = value
            }
        )
    }
}
