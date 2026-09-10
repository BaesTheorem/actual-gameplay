import SpriteKit
import UIKit

/// The bundled art, by role. Files live in `Art/` (a folder reference) under these names;
/// see `Art/CREDITS.txt` for where they come from. Textures load once and stay cached.
enum Sprite: String {
    case dog
    case beeA = "bee_a", beeB = "bee_b", beeRest = "bee_rest"
    case sawA = "saw_a", sawB = "saw_b"
    case spikes, bomb, bush, rock, mushroomRed = "mushroom_red"
    case coin = "coin_gold", gem = "gem_yellow", gemBlue = "gem_blue"
    case signExit = "sign_exit", flagA = "flag_green_a", flagB = "flag_green_b"
    case torchA = "torch_on_a", torchB = "torch_on_b", planks = "block_planks", dangerBlock = "block_danger"
    case heroIdle = "character_green_idle", heroJump = "character_green_jump", heroHit = "character_green_hit"
    case heroFront = "character_green_front"
    case runnerA = "character_yellow_walk_a", runnerB = "character_yellow_walk_b", runnerFront = "character_yellow_front"
    case enemyA = "character_pink_walk_a", enemyB = "character_pink_walk_b", enemyFront = "character_pink_front"
    case boss = "character_purple_front", bossHit = "character_purple_hit"
    case dogFront = "character_beige_front"
    case sky = "background_solid_sky", cloudsBackdrop = "background_clouds", hills = "background_color_hills"
    case cloud1 = "cloud_1", cloud2 = "cloud_2", cloud3 = "cloud_3"

    private static var cache: [String: SKTexture] = [:]

    var texture: SKTexture { Sprite.texture(named: rawValue) }

    /// Texture by file stem, for terrain tiles assembled from a skin and a part name.
    static func texture(named name: String) -> SKTexture {
        if let cached = cache[name] { return cached }
        let texture: SKTexture
        if let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "Art"),
           let image = UIImage(contentsOfFile: url.path) {
            texture = SKTexture(image: image)
        } else {
            // A missing file draws a visible magenta square instead of crashing a level.
            let renderer = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8))
            texture = SKTexture(image: renderer.image { ctx in
                UIColor.magenta.setFill()
                ctx.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
            })
        }
        cache[name] = texture
        return texture
    }

    static func exists(_ name: String) -> Bool {
        Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "Art") != nil
    }
}

/// Builds terrain out of Kenney tiles: a one-tile strip for thin platforms, a block grid for
/// anything thicker, cropped to the exact rectangle so level geometry stays authoritative.
enum Terrain {
    static let skins = ["grass", "stone", "dirt", "purple"]

    static func node(rect: CGRect, skin: String?) -> SKNode {
        let skin = skins.contains(skin ?? "") ? skin! : "grass"
        let crop = SKCropNode()
        let mask = SKSpriteNode(color: .white, size: rect.size)
        mask.position = CGPoint(x: rect.midX, y: rect.midY)
        crop.maskNode = mask
        if rect.width <= 36 && rect.height > 36 {
            let tile = rect.width
            var y = rect.maxY
            while y > rect.minY {
                let sprite = SKSpriteNode(texture: Sprite.texture(named: "terrain_\(skin)_block_center"), size: CGSize(width: tile, height: tile))
                sprite.position = CGPoint(x: rect.midX, y: y - tile / 2)
                crop.addChild(sprite)
                y -= tile
            }
        } else if rect.height <= 36 {
            let tile = rect.height
            var x = rect.minX
            var index = 0
            let count = Int((rect.width / tile).rounded(.up))
            while x < rect.maxX {
                let part = index == 0 ? "horizontal_left" : (index == count - 1 ? "horizontal_right" : "horizontal_middle")
                let sprite = SKSpriteNode(texture: Sprite.texture(named: "terrain_\(skin)_\(part)"), size: CGSize(width: tile, height: tile))
                sprite.position = CGPoint(x: x + tile / 2, y: rect.midY)
                crop.addChild(sprite)
                x += tile
                index += 1
            }
        } else {
            let tile: CGFloat = 32
            let columns = Int((rect.width / tile).rounded(.up))
            let rows = Int((rect.height / tile).rounded(.up))
            for row in 0..<rows {
                for column in 0..<columns {
                    let top = row == 0
                    let left = column == 0
                    let right = column == columns - 1
                    var part = top ? "block_top" : "block_center"
                    if top && left && columns > 1 { part = "block_top_left" }
                    else if top && right && columns > 1 { part = "block_top_right" }
                    else if !top && left && columns > 1 { part = "block_left" }
                    else if !top && right && columns > 1 { part = "block_right" }
                    let sprite = SKSpriteNode(texture: Sprite.texture(named: "terrain_\(skin)_\(part)"), size: CGSize(width: tile, height: tile))
                    sprite.position = CGPoint(x: rect.minX + CGFloat(column) * tile + tile / 2,
                                              y: rect.maxY - CGFloat(row) * tile - tile / 2)
                    crop.addChild(sprite)
                }
            }
        }
        return crop
    }

    /// A row of spike tiles across the top of a rect, on a stone base.
    static func spikes(rect: CGRect) -> SKNode {
        let node = SKNode()
        let base = CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: max(4, rect.height * 0.4))
        node.addChild(Terrain.node(rect: base, skin: "stone"))
        let tile = rect.height * 0.6
        let crop = SKCropNode()
        let mask = SKSpriteNode(color: .white, size: CGSize(width: rect.width, height: tile))
        mask.position = CGPoint(x: rect.midX, y: base.maxY + tile / 2)
        crop.maskNode = mask
        var x = rect.minX
        while x < rect.maxX {
            let spike = SKSpriteNode(texture: Sprite.spikes.texture, size: CGSize(width: tile, height: tile))
            spike.position = CGPoint(x: x + tile / 2, y: base.maxY + tile / 2)
            crop.addChild(spike)
            x += tile
        }
        node.addChild(crop)
        return node
    }
}

import SwiftUI

/// A bundled sprite as a SwiftUI image, for the shell (mode cards, the coin purse).
struct SpriteImage: View {
    let sprite: Sprite
    var size: CGFloat = 32

    var body: some View {
        Group {
            if let url = Bundle.main.url(forResource: sprite.rawValue, withExtension: "png", subdirectory: "Art"),
               let image = UIImage(contentsOfFile: url.path) {
                Image(uiImage: image).resizable().scaledToFit()
            } else {
                Rectangle().fill(Color.pink)
            }
        }
        .frame(width: size, height: size)
    }
}
