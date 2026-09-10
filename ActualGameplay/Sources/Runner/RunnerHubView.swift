import SwiftUI

struct RunSelection: Identifiable {
    let id = UUID()
}

/// Between runs: the level counter, the coin purse, and the three upgrades.
struct RunnerHubView: View {
    @EnvironmentObject private var store: ProgressStore
    @Environment(\.dismiss) private var dismiss
    @State private var run: RunSelection?

    private var runner: RunnerProgress { store.progress.runner }
    private var economy: RunnerEconomy { RunnerEconomy(levels: runner.upgrades) }

    var body: some View {
        ZStack {
            Theme.surface.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    IconButton(icon: .arrowBack) { dismiss() }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("CROWD RUN").font(Theme.title(24))
                        Text("run \(runner.level + 1)   best \(runner.bestLevel)")
                            .font(Theme.mono(12)).foregroundStyle(Theme.runner)
                    }
                    Spacer()
                    HStack(spacing: 6) {
                        SpriteImage(sprite: .coin, size: 22)
                        Text("\(runner.coins)").font(Theme.mono(16)).foregroundStyle(Theme.gold)
                    }
                }
                Button("RUN \(runner.level + 1)") { run = RunSelection() }
                    .buttonStyle(OutlinedButtonStyle(tint: Theme.runner, filled: true))
                Text("Drag to steer. Green gates grow the crowd, red ones shrink it. Whatever is left fights at the end.")
                    .font(Theme.body(13)).foregroundStyle(Theme.onSurfaceMuted)
                HairlineDivider()
                Text("UPGRADES").font(Theme.mono(12)).foregroundStyle(Theme.onSurfaceMuted)
                ForEach(RunnerEconomy.Upgrade.allCases) { upgrade in
                    UpgradeRow(upgrade: upgrade, level: economy.level(of: upgrade), coins: runner.coins) { buy(upgrade) }
                }
                Spacer(minLength: 0)
            }
            .padding(20)
            .foregroundStyle(Theme.onSurface)
        }
        .fullScreenCover(item: $run) { selection in
            GameContainerView(mode: .runner, onNext: { run = RunSelection() }, onResult: record) {
                let scene = RunnerScene(level: store.progress.runner.level, economy: economy)
                if LaunchArguments.replay { scene.startReplay() }
                return scene
            }
            .id(selection.id)
        }
        .onAppear {
            MusicPlayer.shared.play(.runner)
            if run == nil, LaunchArguments.replay || LaunchArguments.level != nil { run = RunSelection() }
        }
    }

    private func record(_ phase: GamePhase) {
        guard case .won(_, let coins, _) = phase else { return }
        store.update { progress in
            progress.runner.coins += coins
            progress.runner.level += 1
            progress.runner.bestLevel = max(progress.runner.bestLevel, progress.runner.level)
        }
    }

    private func buy(_ upgrade: RunnerEconomy.Upgrade) {
        let current = economy.level(of: upgrade)
        let cost = upgrade.cost(atLevel: current)
        guard current < upgrade.maxLevel, runner.coins >= cost else { return }
        store.update { progress in
            progress.runner.coins -= cost
            progress.runner.upgrades[upgrade.rawValue] = current + 1
        }
        Haptics.shared.tap()
    }
}

struct UpgradeRow: View {
    let upgrade: RunnerEconomy.Upgrade
    let level: Int
    let coins: Int
    let action: () -> Void

    private var maxed: Bool { level >= upgrade.maxLevel }
    private var cost: Int { upgrade.cost(atLevel: level) }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(upgrade.title).font(Theme.label(15))
                Text("Lv \(level)/\(upgrade.maxLevel)   \(upgrade.effectText(atLevel: level))")
                    .font(Theme.mono(11)).foregroundStyle(Theme.onSurfaceMuted)
            }
            Spacer()
            Button(action: action) {
                Text(maxed ? "MAX" : "\(cost)")
                    .font(Theme.mono(13))
                    .foregroundStyle(maxed ? Theme.onSurfaceMuted : (coins >= cost ? Theme.surface : Theme.onSurfaceMuted))
                    .frame(width: 72, height: 36)
                    .background(!maxed && coins >= cost ? Theme.gold : Theme.surfaceContainer)
                    .overlay(Rectangle().stroke(Theme.outline, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(maxed || coins < cost)
        }
        .padding(10)
        .background(Theme.surfaceContainer)
        .overlay(Rectangle().stroke(Theme.outline, lineWidth: 1))
    }
}
