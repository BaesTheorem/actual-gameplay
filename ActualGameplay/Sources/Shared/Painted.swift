import SpriteKit
import SwiftUI
import UIKit

/// The painted art: Clawd and every prop, rendered from the animation kit by `tools/painted/render.mjs` into
/// `Art/painted/`. Files are 3x pixel density. Multi-frame clips are `name_00.png ... name_NN.png`, and
/// `manifest.json` records each asset's frame count, playback rate, pixel size and anchor point.
enum Painted {
    static let pixelsPerPoint: CGFloat = 3

    struct Entry: Decodable {
        let frames: Int
        let fps: Double
        let w: CGFloat
        let h: CGFloat
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

    static func exists(_ name: String) -> Bool { manifest[name] != nil }

    static func entry(_ name: String) -> Entry? { manifest[name] }

    /// Point size of an asset at its native scale.
    static func size(_ name: String) -> CGSize {
        guard let e = manifest[name] else { return CGSize(width: 32, height: 32) }
        return CGSize(width: e.w / pixelsPerPoint, height: e.h / pixelsPerPoint)
    }

    static func clip(_ name: String) -> Clip? {
        if let cached = clips[name] { return cached }
        guard let e = manifest[name] else { return nil }
        let files = e.frames > 1 ? (0..<e.frames).map { String(format: "%@_%02d", name, $0) } : [name]
        let textures = files.map { Sprite.texture(named: $0) }
        let clip = Clip(name: name, textures: textures, fps: e.fps,
                        anchor: CGPoint(x: e.anchor[0], y: e.anchor[1]),
                        size: CGSize(width: e.w / pixelsPerPoint, height: e.h / pixelsPerPoint))
        clips[name] = clip
        return clip
    }

    /// The first frame, for still uses.
    static func texture(_ name: String) -> SKTexture { clip(name)?.textures.first ?? Sprite.texture(named: name) }

    /// For SwiftUI: the first frame as a UIImage at 3x, so `Image(uiImage:)` lays out in points.
    static func image(_ name: String, frame: Int = 0) -> UIImage? {
        guard let e = manifest[name] else { return nil }
        let file = e.frames > 1 ? String(format: "%@_%02d", name, min(frame, e.frames - 1)) : name
        guard let url = Bundle.main.url(forResource: file, withExtension: "png", subdirectory: "Art/painted"),
              let cg = UIImage(contentsOfFile: url.path)?.cgImage else { return nil }
        return UIImage(cgImage: cg, scale: pixelsPerPoint, orientation: .up)
    }
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

/// A painted asset in SwiftUI. Falls back to a pink square when the file is missing, like `SpriteImage`.
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

/// A painted 9-slice frame (cards and buttons) that stretches to any size.
struct PaintedFrame: View {
    let name: String
    var insets: CGFloat = 20

    var body: some View {
        if let image = Painted.image(name) {
            Image(uiImage: image)
                .resizable(capInsets: EdgeInsets(top: insets, leading: insets, bottom: insets, trailing: insets), resizingMode: .stretch)
        } else {
            Rectangle().stroke(Color.pink, lineWidth: 2)
        }
    }
}
