import SwiftUI

struct ResultOverlay: View {
    @ObservedObject var session: GameSession
    let onRetry: () -> Void
    let onNext: (() -> Void)?
    let onExit: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            VStack(spacing: 16) {
                switch session.phase {
                case .won(let stars, let coins):
                    Text("CLEARED").font(Theme.title(30)).foregroundStyle(session.mode.accent)
                    StarRow(count: stars)
                    if coins > 0 {
                        Text("+\(coins) coins").font(Theme.mono(16)).foregroundStyle(Theme.gold)
                    }
                case .lost(let reason):
                    Text("NOPE").font(Theme.title(30)).foregroundStyle(Theme.danger)
                    Text(reason)
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.onSurfaceMuted)
                        .multilineTextAlignment(.center)
                case .playing, .paused:
                    EmptyView()
                }
                HStack(spacing: 10) {
                    Button("Retry", action: onRetry).buttonStyle(OutlinedButtonStyle())
                    if case .won = session.phase, let onNext {
                        Button("Next", action: onNext).buttonStyle(OutlinedButtonStyle(tint: session.mode.accent, filled: true))
                    }
                }
                Button("Back to menu", action: onExit).buttonStyle(OutlinedButtonStyle(tint: Theme.onSurfaceMuted))
            }
            .padding(24)
            .frame(maxWidth: 320)
            .background(Theme.surfaceContainer)
            .overlay(Rectangle().stroke(Theme.outline, lineWidth: 1))
        }
    }
}
