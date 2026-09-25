import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: ProgressStore
    @ObservedObject private var dev = DeveloperFlags.shared
    @Environment(\.dismiss) private var dismiss
    @State private var confirmReset = false
    @State private var autoplayMode: GameMode?

    var body: some View {
        ZStack {
            PaperBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Text("SETTINGS").font(Theme.title(28))
                        Spacer()
                        IconButton(icon: .close) { dismiss() }
                    }
                    VStack(spacing: 10) {
                        Toggle(isOn: hapticsBinding) { Text("Haptics").font(Theme.label(17)) }
                        HairlineDivider()
                        Toggle(isOn: musicBinding) { Text("Music").font(Theme.label(17)) }
                    }
                    .tint(Theme.sap)
                    .padding(16)
                    .paintedCard()
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Music by Kevin MacLeod (incompetech.com)").font(Theme.label(14))
                        Text("Licensed under Creative Commons: By Attribution 4.0")
                            .font(Theme.body(12)).foregroundStyle(Theme.onSurfaceMuted)
                        Text(MusicTrack.allCases.map(\.title).joined(separator: ", "))
                            .font(Theme.mono(11)).foregroundStyle(Theme.onSurfaceMuted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .paintedCard()
                    Text(Motion.reduced
                         ? "Reduce Motion is on. Shakes and bounces stay off."
                         : "Reduce Motion is off.")
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.onSurfaceMuted)
                    #if DEBUG
                    VStack(alignment: .leading, spacing: 12) {
                        Toggle(isOn: $dev.showsStats) { Text("Show FPS and draw count").font(Theme.body(15)) }
                        Toggle(isOn: $dev.showsPhysics) { Text("Show physics outlines").font(Theme.body(15)) }
                        Toggle(isOn: $dev.logSolutions) { Text("Copy solving strokes to clipboard").font(Theme.body(15)) }
                    }
                    .tint(Theme.sap)
                    .padding(16)
                    .paintedCard()
                    HStack(spacing: 10) {
                        Button("Auto-play Save the Dog") { autoplayMode = .saveDog }
                            .buttonStyle(OutlinedButtonStyle())
                        Button("Auto-play Pull the Pin") { autoplayMode = .pinPull }
                            .buttonStyle(OutlinedButtonStyle())
                    }
                    Button("Autopilot five Crowd Runs") { autoplayMode = .runner }
                        .buttonStyle(OutlinedButtonStyle())
                    HairlineDivider()
                    #endif
                    Button("Reset all progress") { confirmReset = true }
                        .buttonStyle(OutlinedButtonStyle(art: "ui_button_rose"))
                    Text("No ads. No purchases. No network.")
                        .font(Theme.mono(12))
                        .foregroundStyle(Theme.onSurfaceMuted)
                        .padding(.top, 8)
                }
                .padding(20)
                .foregroundStyle(Theme.ink)
            }
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
