import SwiftUI

/// Chrome above the scene. Only the buttons take touches; everything else passes through.
struct HUDOverlay: View {
    @ObservedObject var session: GameSession
    let onBack: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                IconButton(icon: .arrowBack, action: onBack)
                VStack(alignment: .leading, spacing: -2) {
                    Text(session.hud.title).font(Theme.label(16)).foregroundStyle(Theme.ink)
                        .lineLimit(1).minimumScaleFactor(0.7)
                    if !session.hud.readout.isEmpty {
                        Text(session.hud.readout).font(Theme.label(13)).foregroundStyle(Theme.ink.opacity(0.8))
                            .lineLimit(1).minimumScaleFactor(0.6)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .paintedCard()
                .allowsHitTesting(false)
                IconButton(icon: .refresh) { session.reset() }
            }
            if let progress = session.hud.progress {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.cream)
                        Capsule().fill(session.mode.accent).frame(width: geo.size.width * max(0, min(1, progress)))
                        Capsule().stroke(Theme.ink, lineWidth: 1.5)
                    }
                }
                .frame(height: 9)
                .padding(.horizontal, 2)
                .allowsHitTesting(false)
            }
            Spacer(minLength: 0).allowsHitTesting(false)
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
    }
}
