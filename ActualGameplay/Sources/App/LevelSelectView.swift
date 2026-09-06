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

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 4)
    private var catalog: LevelCatalog { LevelCatalog.shared }
    private var count: Int { catalog.count(for: mode) }
    private var clearedCount: Int { store.progress.results(for: mode).values.filter(\.cleared).count }

    var body: some View {
        ZStack {
            Theme.surface.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    IconButton(icon: .arrowBack) { dismiss() }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(mode.title.uppercased()).font(Theme.title(24))
                        Text("\(clearedCount)/\(count) cleared").font(Theme.mono(12)).foregroundStyle(mode.accent)
                    }
                    Spacer()
                }
                if count == 0 {
                    Text("No levels yet.").font(Theme.body()).foregroundStyle(Theme.onSurfaceMuted)
                }
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(0..<count, id: \.self) { index in
                            let result = store.progress.results(for: mode)[catalog.id(for: mode, index: index)]
                            LevelTile(number: index + 1, result: result, accent: mode.accent) {
                                selected = LevelSelection(index: index)
                            }
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(20)
            .foregroundStyle(Theme.onSurface)
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
    let accent: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Text("\(number)")
                    .font(Theme.title(24))
                    .foregroundStyle(result?.cleared == true ? accent : Theme.onSurface)
                StarRow(count: result?.bestStars ?? 0, size: 10)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 76)
            .background(Theme.surfaceContainer)
            .overlay(Rectangle().stroke(result?.cleared == true ? accent : Theme.outline, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
