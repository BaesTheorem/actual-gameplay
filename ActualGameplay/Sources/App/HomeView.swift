import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var store: ProgressStore
    @State private var activeMode: GameMode?
    @State private var autoplayMode: GameMode?
    @State private var showSettings = false

    var body: some View {
        ZStack {
            Theme.surface.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                header
                ForEach(GameMode.allCases) { mode in
                    ModeCard(mode: mode, summary: summary(for: mode)) { activeMode = mode }
                }
                Spacer(minLength: 0)
                footer
            }
            .padding(20)
        }
        .fullScreenCover(item: $activeMode) { mode in
            if mode.hasLevels {
                LevelSelectView(mode: mode).environmentObject(store)
            } else {
                GameContainerView(mode: mode) { PlaceholderScene(mode: mode) }
            }
        }
        .fullScreenCover(item: $autoplayMode) { mode in
            AutoplayView(mode: mode, only: LaunchArguments.only)
        }
        .sheet(isPresented: $showSettings) {
            SettingsView().environmentObject(store)
        }
        .onAppear {
            if let mode = LaunchArguments.autoplay {
                autoplayMode = mode
            } else if let mode = LaunchArguments.mode {
                activeMode = mode
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: -4) {
                    Text("ACTUAL").font(Theme.title(36))
                    Text("GAMEPLAY").font(Theme.title(36))
                }
                .foregroundStyle(Theme.onSurface)
                Spacer()
                IconButton(icon: .settings) { showSettings = true }
            }
            Text("The games from the ads. Without the ads.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.onSurfaceMuted)
            HairlineDivider().padding(.top, 10)
        }
    }

    private var footer: some View {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        return Text("v\(version)")
            .font(Theme.mono(11))
            .foregroundStyle(Theme.onSurfaceMuted)
    }

    private func summary(for mode: GameMode) -> String {
        switch mode {
        case .drawLine, .pinPull:
            let total = LevelCatalog.shared.count(for: mode)
            let cleared = store.progress.results(for: mode).values.filter(\.cleared).count
            if total == 0 { return "Coming soon" }
            return cleared == 0 ? "\(total) levels" : "\(cleared)/\(total) cleared"
        case .runner:
            let runner = store.progress.runner
            if runner.bestLevel == 0 && runner.coins == 0 { return "Not started" }
            return "Level \(runner.level + 1), \(runner.coins) coins"
        }
    }
}

struct ModeCard: View {
    let mode: GameMode
    let summary: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                MSIcon(mode.icon, size: 30)
                    .foregroundStyle(Theme.surface)
                    .frame(width: 60, height: 60)
                    .background(mode.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text(mode.title).font(Theme.label(18)).foregroundStyle(Theme.onSurface)
                    Text(mode.blurb).font(Theme.body(13)).foregroundStyle(Theme.onSurfaceMuted).lineLimit(2)
                    Text(summary).font(Theme.mono(12)).foregroundStyle(mode.accent)
                }
                Spacer(minLength: 0)
                MSIcon(.chevronRight, size: 24).foregroundStyle(Theme.onSurfaceMuted)
            }
            .padding(12)
            .background(Theme.surfaceContainer)
            .overlay(Rectangle().stroke(Theme.outline, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
