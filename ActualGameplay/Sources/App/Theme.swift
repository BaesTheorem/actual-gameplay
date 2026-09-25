import SwiftUI
import UIKit

/// The painted look from the animation kit: paper, ink and soft washes, painted cards and buttons, and
/// Permanent Marker for anything that shouts. Flat colour only: no gradients, no drop shadows.
enum Theme {
    static let paper = Color(uiColor: Pigment.paper)
    static let ink = Color(uiColor: Pigment.ink)
    static let clay = Color(uiColor: Pigment.clay)
    static let clayDark = Color(uiColor: Pigment.clayDark)
    static let clayLight = Color(uiColor: Pigment.clayLight)
    static let cream = Color(uiColor: Pigment.cream)
    static let sky = Color(uiColor: Pigment.sky)
    static let sap = Color(uiColor: Pigment.sap)
    static let rose = Color(uiColor: Pigment.rose)
    static let ochre = Color(uiColor: Pigment.ochre)
    static let teal = Color(uiColor: Pigment.teal)
    static let violet = Color(uiColor: Pigment.violet)
    static let indigo = Color(uiColor: Pigment.indigo)
    static let night = Color(uiColor: Pigment.night)

    // The names the screens were written against, now mapped onto the palette.
    static let surface = paper
    static let surfaceContainer = cream
    static let surfaceHigh = ink.opacity(0.12)
    static let outline = ink.opacity(0.6)
    static let outlineStrong = ink
    static let onSurface = ink
    static let onSurfaceMuted = ink.opacity(0.65)
    static let draw = sky
    static let pin = clay
    static let runner = sap
    static let danger = rose
    static let gold = ochre

    // Fixed sizes, like the system fonts they replace: the HUD and the cards are laid out to them.
    static func title(_ size: CGFloat = 28) -> Font { .custom(Painted.font, fixedSize: size) }
    static func label(_ size: CGFloat = 15) -> Font { .custom(Painted.font, fixedSize: size) }
    static func body(_ size: CGFloat = 14) -> Font { .system(size: size, weight: .regular, design: .rounded) }
    /// Rounded bold with tabular digits, so counters do not jitter as they tick.
    static func mono(_ size: CGFloat = 15) -> Font { .system(size: size, weight: .bold, design: .rounded).monospacedDigit() }
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

/// A painted button: clay when filled, paper when not. `tint` is kept so call sites compile, but the paint
/// carries the colour now; `art` swaps in another painted piece (the rose one for destructive actions).
/// A press plays the UI tap.
struct OutlinedButtonStyle: PrimitiveButtonStyle {
    var tint: Color = Theme.onSurface
    var filled: Bool = false
    var art: String? = nil

    func makeBody(configuration: Configuration) -> some View {
        configuration.sounding(.tap).buttonStyle(OutlinedButtonFace(filled: filled, art: art))
    }
}

/// The paint behind `OutlinedButtonStyle`, dimmed while pressed.
private struct OutlinedButtonFace: ButtonStyle {
    let filled: Bool
    let art: String?

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.label(17))
            .foregroundStyle(filled ? Theme.cream : Theme.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
            .background(PaintedFrame(art ?? (filled ? "ui_button_clay" : "ui_button_paper")))
            .opacity(configuration.isPressed ? 0.8 : 1)
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
                .background(PaintedFrame("ui_button_paper"))
        }
        .buttonStyle(PlainTapButtonStyle())
    }
}

/// The plain style plus a sound, for buttons that paint their own face.
struct PlainTapButtonStyle: PrimitiveButtonStyle {
    var sound: SoundEvent = .tap

    func makeBody(configuration: Configuration) -> some View {
        configuration.sounding(sound).buttonStyle(.plain)
    }
}

extension PrimitiveButtonStyleConfiguration {
    /// The same button, playing `sound` as its action fires, so the sound means the press counted. Always
    /// give the result a style of its own rather than letting it inherit the one being defined.
    func sounding(_ sound: SoundEvent) -> Button<Label> {
        Button(role: role) {
            Audio.play(sound)
            trigger()
        } label: {
            label
        }
    }
}

struct HairlineDivider: View {
    var body: some View { Rectangle().fill(Theme.ink.opacity(0.6)).frame(height: 1) }
}

struct StarRow: View {
    let count: Int
    var size: CGFloat = 34

    var body: some View {
        HStack(spacing: max(2, size * 0.2)) {
            ForEach(0..<3, id: \.self) { i in
                PaintedImage(i < count ? "ui_star_on" : "ui_star_off")
                    .frame(width: size, height: size)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(count) of 3 stars")
    }
}

extension View {
    /// Sits the view on a painted card.
    func paintedCard(_ name: String = "ui_card") -> some View {
        background(PaintedFrame(name))
    }
}

/// A painted Clawd frame standing on a coloured painted swatch, for the mode cards.
struct ClawdSwatch: View {
    let clip: String
    var frame: Int = 0
    var art: String = "ui_button_sky"
    var size: CGFloat = 64

    var body: some View {
        ZStack(alignment: .bottom) {
            PaintedFrame(art, insets: 14)
            // The clip frames leave room above Clawd for hats and emotes; the swatch only has to hold him,
            // so the frame is sized off his width and stood on the swatch floor.
            PaintedImage(clip, frame: frame)
                .frame(width: size * 0.95, height: size * 0.95 * 360 / 320)
                .offset(y: size * 0.03)
        }
        .frame(width: size, height: size)
    }
}
