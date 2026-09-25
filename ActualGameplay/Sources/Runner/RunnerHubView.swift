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
            PaperBackground()
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    IconButton(icon: .arrowBack) { dismiss() }
                    VStack(alignment: .leading, spacing: 0) {
                        Text("CROWD RUN").font(Theme.title(26))
                        Text("run \(runner.level + 1)   best \(runner.bestLevel)")
                            .font(Theme.mono(13)).foregroundStyle(Theme.onSurfaceMuted)
                    }
                    Spacer()
                    CoinCount(coins: runner.coins)
                }
                VStack(spacing: 12) {
                    // The frame's top third is headroom for emotes this clip does not use.
                    PaintedClip("clawd_determined")
                        .frame(height: 150)
                        .padding(.top, -40)
                        .padding(.bottom, -16)
                    Text("Drag to steer. Green gates grow the crowd, red ones shrink it. Whatever is left fights at the end.")
                        .font(Theme.body(14)).foregroundStyle(Theme.onSurfaceMuted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("RUN \(runner.level + 1)") { run = RunSelection() }
                        .buttonStyle(OutlinedButtonStyle(filled: true))
                }
                .padding(16)
                .paintedCard()
                Text("UPGRADES").font(Theme.label(15)).foregroundStyle(Theme.onSurfaceMuted)
                    .padding(.top, 4)
                ForEach(RunnerEconomy.Upgrade.allCases) { upgrade in
                    UpgradeRow(upgrade: upgrade, level: economy.level(of: upgrade), coins: runner.coins) { buy(upgrade) }
                }
                Spacer(minLength: 0)
            }
            .padding(20)
            .foregroundStyle(Theme.ink)
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
    private var affordable: Bool { !maxed && coins >= cost }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                Text(upgrade.title).font(Theme.label(17))
                Text("Lv \(level)/\(upgrade.maxLevel)   \(upgrade.effectText(atLevel: level))")
                    .font(Theme.mono(12)).foregroundStyle(Theme.onSurfaceMuted)
            }
            Spacer()
            Button(action: action) {
                HStack(spacing: 4) {
                    if !maxed { PaintedImage("coin_gold").frame(width: 18, height: 18) }
                    Text(maxed ? "MAX" : "\(cost)").font(Theme.label(16))
                }
                .foregroundStyle(affordable ? Theme.cream : Theme.ink.opacity(0.45))
                .frame(width: 84, height: 40)
                .background(PaintedFrame(affordable ? "ui_button_clay" : "ui_button_paper"))
            }
            .buttonStyle(.plain)
            .disabled(!affordable)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .paintedCard()
    }
}

/// The coin purse: the painted coin and the count beside it.
struct CoinCount: View {
    let coins: Int

    var body: some View {
        HStack(spacing: 6) {
            PaintedImage("coin_gold").frame(width: 26, height: 26)
            Text("\(coins)").font(Theme.label(20)).foregroundStyle(Theme.ink)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(coins) coins")
    }
}
