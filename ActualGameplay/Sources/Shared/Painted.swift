import ImageIO
import SpriteKit
import SwiftUI
import UIKit

/// The painted art: Clawd and every prop, rendered from the animation kit by `tools/painted/render.mjs` into
/// `Art/painted/`. Files are 3x pixel density. Multi-frame clips are `name_00.png ... name_NN.png`, and
/// `manifest.json` records each asset's frame count, playback rate, pixel size and anchor point.
enum Painted {
    static let pixelsPerPoint: CGFloat = 3

    /// Permanent Marker, for titles, HUD numbers and button labels.
    static let font = "PermanentMarker-Regular"

    struct Entry: Decodable {
        let frames: Int
        let fps: Double
        /// Pixel size. The renderer has shipped manifests without it, so `size` falls back to the PNG itself.
        let w: CGFloat?
        let h: CGFloat?
        let anchor: [CGFloat]
    }

    /// A playable set of frames, sized in points.
    struct Clip {
        let name: String
        let textures: [SKTexture]
        let fps: Double
        let anchor: CGPoint
        let size: CGSize
        var isLoopable: Bool { textures.count > 1 }
    }

    private static let manifest: [String: Entry] = {
        guard let url = Bundle.main.url(forResource: "manifest", withExtension: "json", subdirectory: "Art/painted"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([String: Entry].self, from: data) else { return [:] }
        return decoded
    }()
    private static var clips: [String: Clip] = [:]
    private static var pixelSizes: [String: CGSize] = [:]
    private static let images = NSCache<NSString, UIImage>()

    static func exists(_ name: String) -> Bool { manifest[name] != nil }

    static func entry(_ name: String) -> Entry? { manifest[name] }

    /// Point size of an asset at its native scale.
    static func size(_ name: String) -> CGSize {
        let pixels = pixelSize(name)
        return CGSize(width: pixels.width / pixelsPerPoint, height: pixels.height / pixelsPerPoint)
    }

    /// Pixel size from the manifest, or from the first frame's PNG header when the manifest leaves it out.
    private static func pixelSize(_ name: String) -> CGSize {
        if let cached = pixelSizes[name] { return cached }
        guard let e = manifest[name] else { return CGSize(width: 32 * pixelsPerPoint, height: 32 * pixelsPerPoint) }
        var size = CGSize(width: e.w ?? 0, height: e.h ?? 0)
        if size.width <= 0 || size.height <= 0,
           let url = fileURL(name, frame: 0),
           let source = CGImageSourceCreateWithURL(url as CFURL, nil),
           let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
           let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
           let height = properties[kCGImagePropertyPixelHeight] as? NSNumber {
            size = CGSize(width: width.doubleValue, height: height.doubleValue)
        }
        if size.width <= 0 || size.height <= 0 { size = CGSize(width: 32 * pixelsPerPoint, height: 32 * pixelsPerPoint) }
        pixelSizes[name] = size
        return size
    }

    private static func fileURL(_ name: String, frame: Int) -> URL? {
        guard let e = manifest[name] else { return nil }
        let file = e.frames > 1 ? String(format: "%@_%02d", name, min(max(frame, 0), e.frames - 1)) : name
        return Bundle.main.url(forResource: file, withExtension: "png", subdirectory: "Art/painted")
    }

    static func clip(_ name: String) -> Clip? {
        if let cached = clips[name] { return cached }
        guard let e = manifest[name] else { return nil }
        let files = e.frames > 1 ? (0..<e.frames).map { String(format: "%@_%02d", name, $0) } : [name]
        let textures = atlasTextures(files) ?? files.map { Sprite.texture(named: $0) }
        let clip = Clip(name: name, textures: textures, fps: e.fps,
                        anchor: CGPoint(x: e.anchor[0], y: e.anchor[1]),
                        size: size(name))
        clips[name] = clip
        return clip
    }

    /// A clip's frames packed into one atlas, so sprites on different frames of it still draw as one batch:
    /// that is what keeps a crowd of 150 runners, each on its own step of the cycle, to a single draw call.
    private static func atlasTextures(_ files: [String]) -> [SKTexture]? {
        guard files.count > 1 else { return nil }
        var images: [String: UIImage] = [:]
        for file in files {
            guard let url = Bundle.main.url(forResource: file, withExtension: "png", subdirectory: "Art/painted"),
                  let image = UIImage(contentsOfFile: url.path) else { return nil }
            images[file] = image
        }
        let atlas = SKTextureAtlas(dictionary: images)
        return files.map { atlas.textureNamed($0) }
    }

    /// The first frame, for still uses.
    static func texture(_ name: String) -> SKTexture { clip(name)?.textures.first ?? Sprite.texture(named: name) }

    /// For SwiftUI: a frame as a UIImage at 3x, so `Image(uiImage:)` lays out in points. Cached, since the
    /// result card flips through a clip and the level grid asks for the same stars dozens of times.
    static func image(_ name: String, frame: Int = 0) -> UIImage? {
        guard let url = fileURL(name, frame: frame) else { return nil }
        let key = url.lastPathComponent as NSString
        if let cached = images.object(forKey: key) { return cached }
        guard let cg = UIImage(contentsOfFile: url.path)?.cgImage else { return nil }
        let image = UIImage(cgImage: cg, scale: pixelsPerPoint, orientation: .up)
        images.setObject(image, forKey: key)
        return image
    }

    /// Frames per second a clip was drawn for.
    static func fps(_ name: String) -> Double { manifest[name]?.fps ?? 1 }

    static func frameCount(_ name: String) -> Int { manifest[name]?.frames ?? 1 }
}

/// The kit's palette (PAL in the animation kit), for the chrome and for anything a scene draws in code.
/// Soft washes and an ink that is never pure black; there is no pure white either, cream stands in for it.
enum Pigment {
    static let paper = UIColor(hex: 0xF3EBDC)
    static let ink = UIColor(hex: 0x2B2233)
    static let clay = UIColor(hex: 0xD97757)
    static let clayDark = UIColor(hex: 0xA84D33)
    static let clayLight = UIColor(hex: 0xF2A283)
    static let cream = UIColor(hex: 0xFFF5E2)
    static let sky = UIColor(hex: 0x8EC3E6)
    static let sap = UIColor(hex: 0x6E9F58)
    static let rose = UIColor(hex: 0xE27A92)
    static let ochre = UIColor(hex: 0xE8AA38)
    static let teal = UIColor(hex: 0x3A9C98)
    static let violet = UIColor(hex: 0x7B5CA8)
    static let indigo = UIColor(hex: 0x2F3C7A)
    static let night = UIColor(hex: 0x1F2550)
}

/// A sprite that plays painted clips: a looping idle, a one-shot reaction, and clean switches between them.
/// Its size follows the clip's native point size times `scale`, and its anchor comes from the manifest, so the
/// ground point stays put when the clip changes.
final class PaintedSprite: SKSpriteNode {
    private(set) var current: String = ""
    var clipScale: CGFloat

    /// `height` sizes the first clip in points; later clips keep the same scale so a bigger frame stays proportional.
    init(clip name: String, height: CGFloat) {
        let native = Painted.size(name)
        clipScale = height / max(1, native.height)
        super.init(texture: nil, color: .clear, size: CGSize(width: native.width * clipScale, height: height))
        play(name)
    }

    required init?(coder aDecoder: NSCoder) { fatalError("built in code") }

    /// Play a clip. Loops by default; a one-shot ends on its last frame and calls `completion`.
    func play(_ name: String, loop: Bool = true, completion: (() -> Void)? = nil) {
        guard name != current || !loop else { return }
        guard let clip = Painted.clip(name) else { return }
        current = name
        removeAction(forKey: "clip")
        anchorPoint = clip.anchor
        size = CGSize(width: clip.size.width * clipScale, height: clip.size.height * clipScale)
        texture = clip.textures.first
        guard clip.isLoopable else { completion?(); return }
        let frames = SKAction.animate(with: clip.textures, timePerFrame: 1 / max(1, clip.fps), resize: false, restore: false)
        if loop {
            run(.repeatForever(frames), withKey: "clip")
        } else {
            run(.sequence([frames, .run { completion?() }]), withKey: "clip")
        }
    }
}

/// A painted asset in SwiftUI. Falls back to a pink square when the file is missing, so a gap shows.
struct PaintedImage: View {
    let name: String
    var frame: Int = 0

    var body: some View {
        if let image = Painted.image(name, frame: frame) {
            Image(uiImage: image).resizable().scaledToFit()
        } else {
            Rectangle().fill(Color.pink)
        }
    }
}

extension PaintedImage {
    init(_ name: String, frame: Int = 0) {
        self.init(name: name, frame: frame)
    }
}

/// A painted 9-slice frame (cards and buttons) that stretches to any size.
struct PaintedFrame: View {
    let name: String
    var insets: CGFloat = 20

    var body: some View {
        if let image = Painted.image(name) {
            // The buttons are 32 pt tall, so an inset is capped short of half the piece: there has to be a
            // middle band left to stretch, and a thin one smears the brush texture into streaks.
            let v = min(insets, image.size.height * 0.375)
            let h = min(insets, image.size.width * 0.375)
            Image(uiImage: image)
                .resizable(capInsets: EdgeInsets(top: v, leading: h, bottom: v, trailing: h), resizingMode: .stretch)
        } else {
            Rectangle().stroke(Color.pink, lineWidth: 2)
        }
    }
}

extension PaintedFrame {
    init(_ name: String, insets: CGFloat = 20) {
        self.init(name: name, insets: insets)
    }
}

/// A looping clip in SwiftUI, at the rate it was drawn for. It plays under Reduce Motion too, as the scenes'
/// clips do: it is Clawd acting in place, and a held first frame is often a blink.
struct PaintedClip: View {
    let name: String

    init(_ name: String) {
        self.name = name
    }

    var body: some View {
        let count = Painted.frameCount(name)
        if count < 2 {
            PaintedImage(name: name)
        } else {
            let fps = Painted.fps(name)
            TimelineView(.animation(minimumInterval: 1 / fps)) { context in
                let t = context.date.timeIntervalSinceReferenceDate
                PaintedImage(name: name, frame: Int(t * fps) % count)
            }
        }
    }
}

/// The paper every screen sits on. The sheet is landscape, so it is stood on end before it fills a phone,
/// which keeps the grain the same size as in the scenes. It hangs off a flat colour as an overlay, so the
/// oversized image never widens the screen's layout.
struct PaperBackground: View {
    var name: String = "paper"

    var body: some View {
        Color(Pigment.paper)
            .overlay {
                if let cg = Painted.image(name)?.cgImage {
                    Image(decorative: cg, scale: Painted.pixelsPerPoint, orientation: .right)
                        .resizable()
                        .scaledToFill()
                }
            }
            .clipped()
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
