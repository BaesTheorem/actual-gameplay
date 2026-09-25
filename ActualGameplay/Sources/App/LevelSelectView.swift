import SwiftUI

struct LevelSelection: Identifiable {
    let index: Int
    var id: Int { index }
}

struct LevelSelectView: View {
    let mode: GameMode
    @EnvironmentObject private var store: ProgressStore
    @Environment(\.dismiss) private var dismiss
    @State private var selected: LevelSelection?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)
    private var catalog: LevelCatalog { LevelCatalog.shared }
    private var count: Int { catalog.count(for: mode) }
    private var clearedCount: Int { store.progress.results(for: mode).values.filter(\.cleared).count }

    var body: some View {
        ZStack {
            PaperBackground(name: mode == .pinPull ? "paper_cave" : "paper")
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    IconButton(icon: .arrowBack) { dismiss() }
                    VStack(alignment: .leading, spacing: 0) {
                        Text(mode.title.uppercased()).font(Theme.title(26))
                        Text("\(clearedCount)/\(count) cleared").font(Theme.mono(13)).foregroundStyle(Theme.onSurfaceMuted)
                    }
                    Spacer()
                    ClawdSwatch(clip: mode.preview.clip, frame: mode.preview.frame, art: mode.swatch, size: 52)
                }
                if count == 0 {
                    Text("No levels yet.").font(Theme.body()).foregroundStyle(Theme.onSurfaceMuted)
                }
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(0..<count, id: \.self) { index in
                            let result = store.progress.results(for: mode)[catalog.id(for: mode, index: index)]
                            LevelTile(number: index + 1, result: result, locked: isLocked(index)) {
                                selected = LevelSelection(index: index)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
                Spacer(minLength: 0)
            }
            .padding(20)
            .foregroundStyle(Theme.ink)
        }
        .fullScreenCover(item: $selected) { selection in
            GameContainerView(mode: mode,
                              onNext: nextAction(after: selection.index),
                              onResult: { record($0, index: selection.index) }) {
                makeScene(index: selection.index)
            }
            .id(selection.index)
        }
        .onAppear {
            MusicPlayer.shared.play(mode.track)
            if selected == nil, let level = LaunchArguments.level, level >= 1, level <= count {
                selected = LevelSelection(index: level - 1)
            }
        }
    }

    /// Levels open in order: the first, anything already cleared, and the one after a clear.
    /// Every level is open. The tile knows how to draw a lock, so gating is one line away if it is ever wanted.
    private func isLocked(_ index: Int) -> Bool { false }

    private func nextAction(after index: Int) -> (() -> Void)? {
        guard index + 1 < count else { return nil }
        return { selected = LevelSelection(index: index + 1) }
    }

    private func record(_ phase: GamePhase, index: Int) {
        guard case .won(let stars, _, let score) = phase else { return }
        let id = catalog.id(for: mode, index: index)
        store.update { $0.record(mode: mode, levelID: id, stars: stars, score: score) }
    }

    private func makeScene(index: Int) -> GameSceneBase {
        guard let scene = SceneFactory.makeLevelScene(mode: mode, index: index) else {
            return PlaceholderScene(mode: mode)
        }
        if LaunchArguments.replay { scene.startReplay() }
        return scene
    }
}

struct LevelTile: View {
    let number: Int
    let result: LevelResult?
    var locked: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                if locked {
                    MSIcon(.lock, size: 26)
                        .frame(height: 36)
                    Text("\(number)").font(Theme.label(14))
                } else {
                    Text("\(number)").font(Theme.title(28))
                        .frame(height: 36)
                    StarRow(count: result?.bestStars ?? 0, size: 15)
                }
            }
            .foregroundStyle(Theme.ink.opacity(locked ? 0.4 : 1))
            .frame(maxWidth: .infinity)
            .frame(height: 86)
            .paintedCard()
        }
        .buttonStyle(TileButtonStyle())
        .disabled(locked)
        .accessibilityLabel(locked ? "Level \(number), locked" : "Level \(number), \(result?.bestStars ?? 0) stars")
    }
}

/// Presses dim the tile; a disabled tile is left as drawn, since the lock already says so and the plain style
/// would fade the painted card along with it.
private struct TileButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.75 : 1)
    }
}
