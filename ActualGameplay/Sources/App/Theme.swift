import SwiftUI
import UIKit

/// Flat and sharp: square corners, hairline outlines, tonal surfaces, no shadows.
enum Theme {
    static let surface = Color(hex: 0x111318)
    static let surfaceContainer = Color(hex: 0x1B1E24)
    static let surfaceHigh = Color(hex: 0x262A32)
    static let outline = Color(hex: 0x3F4553)
    static let outlineStrong = Color(hex: 0x6B7280)
    static let onSurface = Color(hex: 0xE2E4EA)
    static let onSurfaceMuted = Color(hex: 0x9AA0AC)
    static let draw = Color(hex: 0x7BD3FF)
    static let pin = Color(hex: 0xFF8A5B)
    static let runner = Color(hex: 0x9CE37D)
    static let danger = Color(hex: 0xFF5C5C)
    static let gold = Color(hex: 0xFFD166)

    static func title(_ size: CGFloat = 28) -> Font { .system(size: size, weight: .heavy) }
    static func label(_ size: CGFloat = 15) -> Font { .system(size: size, weight: .semibold) }
    static func body(_ size: CGFloat = 14) -> Font { .system(size: size, weight: .regular) }
    static func mono(_ size: CGFloat = 15) -> Font { .system(size: size, weight: .bold, design: .monospaced) }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

/// A Material Symbols Sharp glyph, drawn from its codepoint so no ligature lookup is involved.
struct MSIcon: View {
    let name: MSIconName
    var size: CGFloat = 24

    init(_ name: MSIconName, size: CGFloat = 24) {
        self.name = name
        self.size = size
    }

    var body: some View {
        Text(name.glyph)
            .font(.custom(MSIconName.fontName, size: size))
            .frame(width: size, height: size)
    }
}

struct OutlinedButtonStyle: ButtonStyle {
    var tint: Color = Theme.onSurface
    var filled: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.label())
            .foregroundStyle(filled ? Theme.surface : tint)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
            .background(filled ? tint : (configuration.isPressed ? Theme.surfaceHigh : Theme.surfaceContainer))
            .overlay(Rectangle().stroke(filled ? tint : Theme.outline, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

struct IconButton: View {
    let icon: MSIconName
    var tint: Color = Theme.onSurface
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            MSIcon(icon, size: 24)
                .foregroundStyle(tint)
                .frame(width: 44, height: 44)
                .background(Theme.surfaceContainer)
                .overlay(Rectangle().stroke(Theme.outline, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

struct HairlineDivider: View {
    var body: some View { Rectangle().fill(Theme.outline).frame(height: 1) }
}

struct StarShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let outer = min(rect.width, rect.height) / 2
        let inner = outer * 0.45
        for i in 0..<10 {
            let angle = -CGFloat.pi / 2 + CGFloat(i) * .pi / 5
            let radius = i % 2 == 0 ? outer : inner
            let point = CGPoint(x: center.x + cos(angle) * radius, y: center.y + sin(angle) * radius)
            if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        path.closeSubpath()
        return path
    }
}

struct StarRow: View {
    let count: Int
    var size: CGFloat = 34

    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<3, id: \.self) { i in
                StarShape()
                    .fill(i < count ? Theme.gold : Theme.surfaceHigh)
                    .overlay(StarShape().stroke(i < count ? Theme.gold : Theme.outline, lineWidth: 1))
                    .frame(width: size, height: size)
            }
        }
    }
}
