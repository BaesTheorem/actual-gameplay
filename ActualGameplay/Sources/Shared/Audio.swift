import AVFoundation
import Foundation

/// Named sound events. No effects ship yet; when they do, this enum is where they hang.
enum SoundEvent {
    case tap, pinPull, splash, sizzle, win, lose, gate, pop
}

enum Audio {
    static func play(_ event: SoundEvent) {}
}

/// The soundtrack: Kevin MacLeod (incompetech.com), Creative Commons BY 4.0. Files live in
/// `Audio/` next to `CREDITS.txt`, named exactly as the track titles.
enum MusicTrack: String, CaseIterable {
    case menu = "Wallpaper"
    case saveDog = "Pixelland"
    case pinPull = "Investigations"
    case runner = "Digital Lemonade"

    var title: String { rawValue }
}

extension GameMode {
    var track: MusicTrack {
        switch self {
        case .saveDog: return .saveDog
        case .pinPull: return .pinPull
        case .runner: return .runner
        }
    }
}

/// One looping track at a time, with a short crossfade between them. Ambient category, so the
/// ring switch mutes it and other audio keeps playing.
final class MusicPlayer {
    static let shared = MusicPlayer()
    static let volume: Float = 0.35

    var enabled = true {
        didSet {
            guard enabled != oldValue else { return }
            if enabled, let current { start(current) } else { stop() }
        }
    }

    private var player: AVAudioPlayer?
    private var current: MusicTrack?
    private var sessionReady = false

    func play(_ track: MusicTrack) {
        current = track
        guard enabled else { return }
        if let player, player.url?.deletingPathExtension().lastPathComponent == track.rawValue {
            if !player.isPlaying { player.play() }
            return
        }
        start(track)
    }

    func pause() { player?.pause() }

    func resume() {
        guard enabled else { return }
        player?.play()
    }

    private func start(_ track: MusicTrack) {
        prepareSession()
        guard let url = Bundle.main.url(forResource: track.rawValue, withExtension: "mp3", subdirectory: "Audio"),
              let next = try? AVAudioPlayer(contentsOf: url) else { return }
        let previous = player
        previous?.setVolume(0, fadeDuration: 0.4)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { previous?.stop() }
        next.numberOfLoops = -1
        next.volume = 0
        next.prepareToPlay()
        next.play()
        next.setVolume(MusicPlayer.volume, fadeDuration: 0.8)
        player = next
    }

    private func stop() {
        let previous = player
        player = nil
        previous?.setVolume(0, fadeDuration: 0.3)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { previous?.stop() }
    }

    private func prepareSession() {
        guard !sessionReady else { return }
        sessionReady = true
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
        try? session.setActive(true)
    }
}
