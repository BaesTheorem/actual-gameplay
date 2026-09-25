import SwiftUI

struct ResultOverlay: View {
    @ObservedObject var session: GameSession
    let onRetry: () -> Void
    let onNext: (() -> Void)?
    let onExit: () -> Void

    var body: some View {
        ZStack {
            Theme.ink.opacity(0.4).ignoresSafeArea()
            // The clip frames keep headroom for emotes; the negative top padding lets it overlap the card's.
            VStack(spacing: 12) {
                switch session.phase {
                case .won(let stars, let coins, let score):
                    PaintedClip(session.mode == .pinPull ? "clawd_hard_excited" : "clawd_excited")
                        .frame(height: 124)
                        .padding(.top, -18)
                    Text("CLEARED").font(Theme.title(36)).foregroundStyle(Theme.ink)
                    StarRow(count: stars, size: 40)
                    if let score {
                        Text(scoreLabel(score)).font(Theme.mono(14)).foregroundStyle(Theme.onSurfaceMuted)
                    }
                    if coins > 0 {
                        HStack(spacing: 6) {
                            PaintedImage("coin_gold").frame(width: 22, height: 22)
                            Text("+\(coins)").font(Theme.label(18)).foregroundStyle(Theme.ink)
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(coins) coins")
                    }
                case .lost(let reason):
                    PaintedClip(session.mode == .pinPull ? "clawd_hard_ko" : "clawd_ko")
                        .frame(height: 124)
                        .padding(.top, -18)
                    Text("NOPE").font(Theme.title(36)).foregroundStyle(Theme.ink)
                    Text(reason)
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.onSurfaceMuted)
                        .multilineTextAlignment(.center)
                case .playing, .paused:
                    EmptyView()
                }
                // Clay marks the obvious next step: Next after a win, Retry after a loss, Back after the last level.
                VStack(spacing: 10) {
                    HStack(spacing: 10) {
                        Button("Retry", action: onRetry).buttonStyle(OutlinedButtonStyle(filled: !won))
                        if won, let onNext {
                            Button("Next", action: onNext).buttonStyle(OutlinedButtonStyle(filled: true))
                        }
                    }
                    Button(session.mode == .runner ? "Back" : "Back to levels", action: onExit)
                        .buttonStyle(OutlinedButtonStyle(filled: won && onNext == nil))
                }
                .padding(.top, 4)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 22)
            .frame(maxWidth: 320)
            .paintedCard()
        }
    }

    private var won: Bool {
        if case .won = session.phase { return true }
        return false
    }

    private func scoreLabel(_ score: Double) -> String {
        switch session.mode {
        case .saveDog: return "ink used \(Int(score.rounded()))"
        case .pinPull: return "pins pulled \(Int(score.rounded()))"
        case .runner: return "survivors \(Int(score.rounded()))"
        }
    }
}
