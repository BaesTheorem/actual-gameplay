import SwiftUI

/// Chrome above the scene. Only the buttons take touches; everything else passes through.
struct HUDOverlay: View {
    @ObservedObject var session: GameSession
    let onBack: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                IconButton(icon: .arrowBack, action: onBack)
                VStack(alignment: .leading, spacing: 1) {
                    Text(session.hud.title).font(Theme.label(15)).foregroundStyle(Theme.onSurface)
                    if !session.hud.readout.isEmpty {
                        Text(session.hud.readout).font(Theme.mono(12)).foregroundStyle(session.mode.accent)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Theme.surfaceContainer.opacity(0.92))
                .overlay(Rectangle().stroke(Theme.outline, lineWidth: 1))
                .allowsHitTesting(false)
                Spacer(minLength: 0).allowsHitTesting(false)
                IconButton(icon: .refresh) { session.reset() }
            }
            if let progress = session.hud.progress {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Rectangle().fill(Theme.surfaceHigh)
                        Rectangle().fill(session.mode.accent).frame(width: geo.size.width * max(0, min(1, progress)))
                    }
                }
                .frame(height: 4)
                .allowsHitTesting(false)
            }
            Spacer(minLength: 0).allowsHitTesting(false)
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
    }
}
