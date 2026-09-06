import Foundation

/// Named sound events. There is no audio yet; when SFX land, this file grows a player and nothing else changes.
enum SoundEvent {
    case tap, pinPull, splash, sizzle, win, lose, gate, pop
}

enum Audio {
    static func play(_ event: SoundEvent) {}
}
